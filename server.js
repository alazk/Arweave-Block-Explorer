const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');
const app = express();
const port = parseInt(process.env.PORT || '3002', 10);
const server = http.createServer(app);
app.use(express.static(path.join(__dirname)));

// Explicit root and health endpoints for Render
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const wss = new WebSocket.Server({ noServer: true });
// Scan from current head backward for a fixed number of blocks, collecting recent media
async function streamRecentTransactionsQuick(ws, blockScanLimit = 750, perTypeLimit = 250) {
    try {
        const info = await axios.get('https://arweave.net/info');
        let currentHeight = info.data.height;
        let scanned = 0;
        const maxScans = Math.max(10, Math.min(20000, blockScanLimit));
        const buckets = { image: [], video: [], audio: [], application: [], other: [] };
        let additionsSinceLastSend = 0;

        const wantMore = () => (
            buckets.image.length < perTypeLimit ||
            buckets.video.length < perTypeLimit ||
            buckets.audio.length < perTypeLimit
        );

        while (currentHeight > 0 && scanned < maxScans) {
            if (ws.readyState !== WebSocket.OPEN) break;
            console.log('Starting quick scan for', maxScans, 'blocks from height', currentHeight);
            
            // Fetch block metadata (for timestamp)
            let blockRes;
            try {
                blockRes = await axios.get(`https://arweave.net/block/height/${currentHeight}`);
            } catch (e) {
                currentHeight--; scanned++; continue;
            }
            const block = blockRes.data;
            if (!block) { currentHeight--; scanned++; continue; }
            
            console.log('Processing height', currentHeight, 'scanned', scanned);
            // Fetch txs for this height and bucket by content-type
            try {
                const edges = await fetchAllBlockTransactions(currentHeight);
                console.log('Fetched', edges.length, 'transactions for height', currentHeight);
                for (const edge of edges) {
                    if (!wantMore()) break;
                    const node = edge.node;
                    const tagsObj = (node.tags || []).reduce((acc, t) => { acc[t.name] = t.value; return acc; }, {});
                    const ct = (tagsObj['Content-Type'] || tagsObj['content-type'] || 'other');
                    console.log('Transaction ID:', node.id, 'Content-Type:', ct);
                    const main = (typeof ct === 'string' && ct.includes('/')) ? ct.split('/')[0] : (ct || 'other');
                    const key = ['image','video','audio','application'].includes(main) ? main : 'other';
                    if (buckets[key] && buckets[key].length < perTypeLimit) {
                        buckets[key].push({
                            id: node.id,
                            data_size: node.data?.size || 0,
                            tags: tagsObj,
                            height: currentHeight,
                            timestamp: block.timestamp
                        });
                        additionsSinceLastSend++;
                    }
                }
            } catch (e) {
                // ignore this height
            }

            // advance
            currentHeight--; scanned++;

            if (scanned === 1 || scanned % 25 === 0 || additionsSinceLastSend >= 20) {
                console.log(`Scanned ${scanned}/${maxScans} blocks, current buckets: ${JSON.stringify(Object.keys(buckets).map(k => ({[k]: buckets[k].length})))}`);
                ws.send(JSON.stringify({ type: 'loadingStatus', message: `Quick scanned ${scanned}/${maxScans}… (h~${currentHeight})` }));
                ws.send(JSON.stringify({ type: 'towers_partial', data: buckets }));
                additionsSinceLastSend = 0;
            }

            await new Promise(r => setTimeout(r, 2));
        }

        ws.send(JSON.stringify({ type: 'towers', data: buckets }));
        console.log('Final buckets:', Object.keys(buckets).map(k => ({[k]: buckets[k].length})));
        ws.send(JSON.stringify({ type: 'loadingStatus', message: `Media tower ready! (${buckets.image.length} images, ${buckets.audio.length} audio, ${buckets.video.length} video)` }));
    } catch (err) {
        console.error('streamRecentTransactionsQuick failed:', err.message);
        console.error('Full error:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Quick towers failed: ' + err.message }));
    }
}

// Fetch all transactions for a given block height using GraphQL
async function fetchAllBlockTransactions(height) {
    const url = 'https://arweave.net/graphql';
    let edges = [];
    let after = null;
    let hasNextPage = true;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (hasNextPage && attempts < maxAttempts) {
        const body = {
            query: `query($min: Int!, $max: Int!, $after: String) {
                transactions(block: {min: $min, max: $max}, sort: HEIGHT_ASC, first: 100, after: $after) {
                    pageInfo { hasNextPage }
                    edges { 
                        cursor
                        node { 
                            id 
                            data { size } 
                            tags { name value } 
                        } 
                    }
                }
            }`,
            variables: { min: height, max: height, after }
        };
        let resp;
        try {
            resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
        } catch (err) {
            // Log GraphQL errors and fallback to single page (first:100)
            const data = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
            console.error('GraphQL page request failed:', data);
            const fallbackBody = {
                query: `query($min: Int!, $max: Int!) {
                    transactions(block: {min: $min, max: $max}, sort: HEIGHT_ASC, first: 100) {
                        edges { node { id data { size } tags { name value } } }
                    }
                }`,
                variables: { min: height, max: height }
            };
            try {
                const fbResp = await axios.post(url, fallbackBody, { headers: { 'Content-Type': 'application/json' } });
                const fbPage = fbResp.data && fbResp.data.data && fbResp.data.data.transactions;
                if (fbPage && fbPage.edges) edges = edges.concat(fbPage.edges);
            } catch (fbErr) {
                console.error('GraphQL fallback failed:', fbErr.response && fbErr.response.data ? fbErr.response.data : fbErr.message);
            }
            break;
        }
        const page = resp.data && resp.data.data && resp.data.data.transactions;
        if (!page) break;
        edges = edges.concat(page.edges || []);
        hasNextPage = page.pageInfo?.hasNextPage;
        // Use the last cursor as the after value for next page
        const lastEdge = page.edges && page.edges[page.edges.length - 1];
        after = lastEdge?.cursor || null;
        attempts++;
        // Be polite to the endpoint
        if (hasNextPage) await new Promise(r => setTimeout(r, 100));
    }
    return edges;
}

// Stream recent media transactions using targeted GraphQL query
async function streamMediaTransactions(ws, days = 30, perTypeLimit = 500) {
    try {
        const now = new Date();
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const startTs = Math.floor(startDate.getTime() / 1000);
        const url = 'https://arweave.net/graphql';
        const buckets = { image: [], video: [], audio: [], application: [], other: [] };
        let additionsSinceLastSend = 0;

        const wantMore = () => (
            buckets.image.length < perTypeLimit ||
            buckets.video.length < perTypeLimit ||
            buckets.audio.length < perTypeLimit
        );

        ws.send(JSON.stringify({ type: 'loadingStatus', message: `Searching for media transactions in the last ${days} days...` }));
        console.log('Starting media search for last', days, 'days from', startTs);

        const contentTypes = ['image/', 'video/', 'audio/'];
        for (const ct of contentTypes) {
            let after = null;
            let hasNextPage = true;
            let page = 1;

            while (hasNextPage && wantMore()) {
                const body = {
                    query: `query($after: String) {
                        transactions(
                            tags: [
                                { name: "Content-Type", values: ["${ct}*"] }
                            ],
                            sort: HEIGHT_ASC,
                            first: 100,
                            after: $after
                        ) {
                            pageInfo { hasNextPage }
                            edges {
                                cursor
                                node {
                                    id
                                    data { size }
                                    tags { name value }
                                    block { timestamp }
                                }
                            }
                        }
                    }`,
                    variables: { after }
                };
                let resp;
                try {
                    resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
                } catch (err) {
                    console.error('GraphQL query failed for', ct, ':', err.message);
                    break;
                }
                const page = resp.data && resp.data.data && resp.data.data.transactions;
                if (!page) break;
                for (const edge of page.edges) {
                    const node = edge.node;
                    const tagsObj = (node.tags || []).reduce((acc, t) => { acc[t.name] = t.value; return acc; }, {});
                    const ct = tagsObj['Content-Type'] || 'other';
                    const main = (typeof ct === 'string' && ct.includes('/')) ? ct.split('/')[0] : 'other';
                    const key = ['image','video','audio'].includes(main) ? main : 'other';
                    if (buckets[key] && buckets[key].length < perTypeLimit) {
                        buckets[key].push({
                            id: node.id,
                            data_size: node.data?.size || 0,
                            tags: tagsObj,
                            height: node.block?.timestamp || 0,
                            timestamp: node.block?.timestamp || 0
                        });
                        additionsSinceLastSend++;
                    }
                }
                hasNextPage = page.pageInfo?.hasNextPage;
                const lastEdge = page.edges && page.edges[page.edges.length - 1];
                after = lastEdge?.cursor || null;
                if (additionsSinceLastSend >= 20) {
                    ws.send(JSON.stringify({ type: 'towers_partial', data: buckets }));
                    additionsSinceLastSend = 0;
                }
                await new Promise(r => setTimeout(r, 100));
            }
        }
        ws.send(JSON.stringify({ type: 'towers', data: buckets }));
        console.log('Final buckets:', Object.keys(buckets).map(k => ({[k]: buckets[k].length})));
    } catch (err) {
        console.error('streamMediaTransactions failed:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to search for media transactions.' }));
    }
}

function getTxColor(tx) {
    const contentTypeTag = tx.tags.find(tag => tag.name === 'Content-Type');
    const fullContentType = contentTypeTag ? contentTypeTag.value : 'other';
    const mainContentType = fullContentType.split('/')[0];
    const style = contentTypeDataStyles[fullContentType] || contentTypeDataStyles[mainContentType] || contentTypeDataStyles.other;
    return style.color;
}


// Helper to find the first block height of a given UTC day
async function findStartHeightForDate(targetDate, ws) {
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000);
    ws.send(JSON.stringify({ type: 'loadingStatus', message: 'Finding start block for the day...' }));

    try {
        const info = await axios.get('https://arweave.net/info');
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        // Remove future date check - fetch blocks for any requested date

        let high = info.data.height;
        let low = 0;
        let startHeight = -1;

        while (low <= high) {
            let mid = Math.floor(low + (high - low) / 2);
            try {
                const block = (await axios.get(`https://arweave.net/block/height/${mid}`)).data;
                if (block.timestamp >= targetTimestamp) {
                    startHeight = mid;
                    high = mid - 1; // Found a potential start, try to find an even earlier one
                } else {
                    low = mid + 1; // Block is too early, search higher
                }
            } catch (blockError) {
                // This height might not exist, so search lower.
                high = mid - 1;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (startHeight === -1) {
            console.log(`No blocks found at or after the target timestamp. The blockchain may not have reached this date.`);
            return info.data.height + 1; // Return a height that will result in 0 blocks streamed
        }

        console.log(`Found start height for ${targetDate.toDateString()}: ${startHeight}`);
        return startHeight;

    } catch (error) {
        console.error('Error in findStartHeightForDate:', error.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to find start block.' }));
        return 0;
    }
}

async function streamBlocksForDay(ws, date, streamControl, visualOnly = false, endTimestampOverride = null) {
    let visualBlockSent = false;
    try {
        ws.send(JSON.stringify({ type: 'loadingStatus', message: `Finding start block for ${date.toDateString()}...` }));
        const startHeight = await findStartHeightForDate(date, ws);

        // Calculate end-of-day timestamp (or use explicit override from client)
        let endOfDayTimestamp;
        if (typeof endTimestampOverride === 'number' && isFinite(endTimestampOverride)) {
            endOfDayTimestamp = endTimestampOverride;
        } else {
            const endOfDay = new Date(date);
            endOfDay.setUTCHours(23, 59, 59, 999);
            endOfDayTimestamp = Math.floor(endOfDay.getTime() / 1000);
        }

        ws.send(JSON.stringify({ type: 'loadingStatus', message: `Streaming blocks for ${date.toDateString()}...` }));

        let currentHeight = startHeight;
        while (true) {
            if (ws.readyState !== WebSocket.OPEN || streamControl.stop) {
                console.log('WebSocket closed or stream stopped, stopping stream.');
                break;
            }

            try {
                const blockRes = await axios.get(`https://arweave.net/block/height/${currentHeight}`);

                // Check if block timestamp is past the end of the day
                if (blockRes.data.timestamp > endOfDayTimestamp) {
                    console.log(`End of day reached at block ${currentHeight}. Stopping stream.`);
                    break;
                }

                // Fetch full list of transactions for this block (GraphQL pages default to 10)
                const edges = await fetchAllBlockTransactions(currentHeight);
                const transactions = edges.map(edge => ({
                    id: edge.node.id,
                    data_size: edge.node.data.size,
                    tags: edge.node.tags.reduce((acc, tag) => { acc[tag.name] = tag.value; return acc; }, {})
                }));

                const hasVisual = transactions.some(tx => tx.tags['Content-Type'] && tx.tags['Content-Type'].startsWith('image/'));

                if (!visualOnly || hasVisual) {
                    const payload = {
                        type: 'newBlock',
                        data: { ...blockRes.data, height: currentHeight, transactions: transactions, isVisual: hasVisual }
                    };
                    ws.send(JSON.stringify(payload));
                    if (visualOnly && hasVisual) {
                        visualBlockSent = true;
                    }
                }

                currentHeight++;
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                console.error(`Failed to process block ${currentHeight}:`, error.message);
                currentHeight++; // Skip failed block
            }
        }

        console.log(`Finished streaming ${date.toDateString()}`);

        if (!visualOnly) {
             ws.send(JSON.stringify({ type: 'dayStreamComplete' }));
        }

        return visualBlockSent;

    } catch (error) {
        console.error('Error in streamBlocksForDay:', error.message);
        ws.send(JSON.stringify({ type: 'error', message: 'An error occurred while streaming blocks.' }));
    }
}

let activeStreams = new Map(); // Track active streams per connection

wss.on('connection', ws => {
    console.log('Client connected.');
    
    ws.on('message', message => {
        console.log('Received message from client:', message);
        const parsed = JSON.parse(message);
        console.log('Parsed client message:', parsed);
        if (parsed.type === 'get_day') {
            // Stop any existing stream for this connection
            if (activeStreams.has(ws)) {
                activeStreams.get(ws).stop = true;
            }
            // Support either {date: 'yyyy-mm-dd'} or {start: ISO, end: ISO}
            let date;
            let endOverride = null;
            if (parsed.start) {
                date = new Date(parsed.start);
                if (parsed.end) {
                    const end = new Date(parsed.end);
                    endOverride = Math.floor(end.getTime() / 1000);
                }
            } else {
                date = new Date(parsed.date);
            }
            console.log(`Requesting data for date: ${date.toUTCString()}${endOverride ? ` (end=${endOverride})` : ''}`);
            
            // Create stream control object
            const streamControl = { stop: false };
            activeStreams.set(ws, streamControl);
            
            streamBlocksForDay(ws, date, streamControl, false, endOverride);
        } else if (parsed.type === 'get_day_visual') {
            if (activeStreams.has(ws)) {
                activeStreams.get(ws).stop = true;
            }
            const date = new Date(parsed.date);
            const streamControl = { stop: false };
            activeStreams.set(ws, streamControl);

            // Search backwards for a day with visual content
            (async () => {
                let searchDate = date;
                for (let i = 0; i < 7; i++) { // Limit search to 7 days
                    const found = await streamBlocksForDay(ws, searchDate, streamControl, true);
                    if (found) {
                        ws.send(JSON.stringify({ type: 'dayStreamComplete' }));
                        break;
                    }
                    if (i === 6) { // If no content found after 7 days
                         ws.send(JSON.stringify({ type: 'error', message: 'No visual content found in the last 7 days.' }));
                    }
                    searchDate.setDate(searchDate.getDate() - 1);
                }
            })();
        } else if (parsed.type === 'get_towers_recent_30d') {
            const limit = Math.max(1, Math.min(2000, parseInt(parsed.perTypeLimit || '500', 10) || 500));
            if (activeStreams.has(ws)) {
                activeStreams.get(ws).stop = true;
                activeStreams.delete(ws);
            }
            streamMediaTransactions(ws, 30, limit);
        } else if (parsed.type === 'get_towers_quick') {
            console.log('Received get_towers_quick with perType:', parsed.perTypeLimit, 'blockLimit:', parsed.blockScanLimit);
            const perType = Math.max(50, Math.min(1000, parseInt(parsed.perTypeLimit || '200', 10) || 200));
            const blockLimit = Math.max(200, Math.min(20000, parseInt(parsed.blockScanLimit || '3000', 10) || 3000));
            // Stop any existing stream
            if (activeStreams.has(ws)) {
                activeStreams.get(ws).stop = true;
                activeStreams.delete(ws);
            }
            streamRecentTransactionsQuick(ws, blockLimit, perType);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
        // Clean up active streams for this connection
        if (activeStreams.has(ws)) {
            activeStreams.get(ws).stop = true;
            activeStreams.delete(ws);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// SPA fallback: serve index.html for any other GET to avoid 404s on refresh/deep links
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
