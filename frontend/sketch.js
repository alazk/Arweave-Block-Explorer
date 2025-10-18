import * as THREE from 'three';

// ---- Global Variables ----
let scene, camera, renderer, raycaster, mouse;
let monolith, ws = null;
let isDragging = false, previousMousePosition = { x: 0, y: 0 };
let isRotating = false;
let cameraMode = 'default'; // 'default', 'top', 'iso'
let currentlyDisplayedDate = new Date();
let currentPreviewableTxs = [];
let currentTxIndex = 0;
let audioSymbolTexture, videoSymbolTexture;
const frustum = new THREE.Frustum();
const cameraMatrix = new THREE.Matrix4();
let activeFilterType = null;
const CAMERA_PAN_STEP = 2; // vertical pan amount for keyboard

// UI state
let tooltip = null, hoveredBlock = null;

// Orbit state for isometric camera interaction
let orbitTarget = new THREE.Vector3(0, 0, 0);
let orbitYaw = 0;     // horizontal angle around target (radians)
let orbitPitch = 0;   // vertical angle (radians), clamp to avoid flipping
let orbitRadius = 100; // distance from target

// Block stats
const blockBaseSize = 25;
let blockCount = 0;
let dailyTotalSize = 0;
let startYOffset = -200;
const verticalStep = 2;

// Content type styles
const contentTypeDataStyles = {
    image: { name: 'Image', outlineColor: 0xFFFFFF, cubeColor: 0xCCCCCC },       // Whitish
    video: { name: 'Video', outlineColor: 0xFFFFFF, cubeColor: 0xCCCCCC },       // Whitish
    audio: { name: 'Audio', outlineColor: 0xFFFFFF, cubeColor: 0xCCCCCC },       // Whitish
    other: { name: 'Other', outlineColor: 0x808080, cubeColor: 0x1C1C1C },       // Black/Grey
};

function createSymbolTextures() {
    const textureSize = 256;
    const backgroundColor = '#CCCCCC';
    const symbolColor = '#1C1C1C';

    // Audio Symbol (Musical Note - G Clef)
    const audioCanvas = document.createElement('canvas');
    audioCanvas.width = textureSize;
    audioCanvas.height = textureSize;
    const audioCtx = audioCanvas.getContext('2d');
    audioCtx.fillStyle = backgroundColor;
    audioCtx.fillRect(0, 0, textureSize, textureSize);
    audioCtx.font = `${textureSize * 0.8}px serif`;
    audioCtx.fillStyle = symbolColor;
    audioCtx.textAlign = 'center';
    audioCtx.textBaseline = 'middle';
    audioCtx.fillText('𝄞', textureSize / 2, textureSize / 2);
    audioSymbolTexture = new THREE.CanvasTexture(audioCanvas);

    // Video Symbol (Play Button)
    const videoCanvas = document.createElement('canvas');
    videoCanvas.width = textureSize;
    videoCanvas.height = textureSize;
    const videoCtx = videoCanvas.getContext('2d');
    videoCtx.fillStyle = backgroundColor;
    videoCtx.fillRect(0, 0, textureSize, textureSize);
    videoCtx.font = `${textureSize * 0.8}px sans-serif`;
    videoCtx.fillStyle = symbolColor;
    videoCtx.textAlign = 'center';
    videoCtx.textBaseline = 'middle';
    videoCtx.fillText('▶', textureSize / 2, textureSize / 2);
    videoSymbolTexture = new THREE.CanvasTexture(videoCanvas);
}

// ---- Keyboard Controls ----
function onKeyDown(e) {
    if (!camera) return;
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        camera.position.y += CAMERA_PAN_STEP;
        orbitTarget.y += CAMERA_PAN_STEP;
        camera.lookAt(orbitTarget);
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        camera.position.y -= CAMERA_PAN_STEP;
        orbitTarget.y -= CAMERA_PAN_STEP;
        camera.lookAt(orbitTarget);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        teleportToCenter();
    } else if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        closeBlockInfo();
        closeContentPreview();
    }
}

function teleportToCenter() {
    if (!monolith || monolith.children.length === 0 || !camera) return;
    const box = new THREE.Box3().setFromObject(monolith);
    const center = box.getCenter(new THREE.Vector3());
    // Place camera at center and look slightly forward along +Z to avoid zero-length look vector
    camera.position.set(center.x, center.y, center.z);
    orbitTarget.set(center.x, center.y, center.z + 1);
    camera.lookAt(orbitTarget);
}

// ---- Helper Functions ----
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getTransactionContentType(tx) {
    if (!tx || !tx.tags) return 'other';

    if (Array.isArray(tx.tags) || typeof tx.tags.find === 'function') {
        const t = tx.tags.find(tag => tag.name === 'Content-Type' || tag.name === 'content-type');
        const v = t && (typeof t.value === 'string' ? t.value : null);
        if (!v) return 'other';
        if (v.startsWith('image/')) return 'image';
        if (v.startsWith('video/')) return 'video';
        if (v.startsWith('audio/')) return 'audio';
        return 'other';
    } else {
        const v = tx.tags['Content-Type'] || tx.tags['content-type'] || '';
        if (typeof v !== 'string') return 'other';
        if (v.startsWith('image/')) return 'image';
        if (v.startsWith('video/')) return 'video';
        if (v.startsWith('audio/')) return 'audio';
        return 'other';
    }
}

function updateStatsDisplay() {
    const statsElement = document.getElementById('stats');
    if (statsElement) {
        statsElement.textContent = `${blockCount} blocks (${formatBytes(dailyTotalSize)})`;
        statsElement.style.fontSize = '24px';
        statsElement.style.textAlign = 'center';
        statsElement.style.color = '#fff';
        statsElement.style.opacity = '0.5';
    }
}

function updateDateDisplay(date) {
    const dateText = document.getElementById('date-text');
    if (dateText && date) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        dateText.textContent = date.toLocaleDateString('en-US', options);
    }
}

// ---- Animation Functions ----
function startPulsingAnimation(mesh) {
    if (!mesh || !mesh.scale) return;
    const start = Date.now();
    const duration = 1200;
    const minScale = 1.0;
    const maxScale = 1.06;
    
    function step() {
        const t = (Date.now() - start) / duration;
        if (t >= 1) {
            mesh.scale.set(1, 1, 1);
            return;
        }
        const s = minScale + (maxScale - minScale) * 0.5 * (1 - Math.cos(2 * Math.PI * t));
        mesh.scale.set(s, s, s);
        requestAnimationFrame(step);
    }
    
    requestAnimationFrame(step);
}

function flashOutline(outline) {
    if (!outline || !outline.material) return;
    
    const originalOpacity = outline.material.opacity || 1.0;
    const duration = 800;
    const startTime = Date.now();
    
    function step() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const opacity = originalOpacity + (1.0 - originalOpacity) * (1 - progress);
        outline.material.opacity = opacity;
        
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            outline.material.opacity = originalOpacity;
        }
    }
    
    requestAnimationFrame(step);
}

// ---- Block Management ----
function clearMonolith() {
    if (monolith) {
        while (monolith.children.length > 0) {
            monolith.remove(monolith.children[0]);
        }
    }
    blockCount = 0;
    dailyTotalSize = 0;
}

function addNewBlock(blockData) {
    if (!blockData) return;
    
    console.log('Adding new block:', blockData.height);
    
    const { transactions, height, block_size } = blockData;
    
    const blockGroup = new THREE.Group();
    blockGroup.userData.blockHeight = height;
    blockGroup.userData.timestamp = blockData.timestamp;
    
    let blockTotalSize = parseInt(block_size || '0', 10);
    if (blockTotalSize === 0 && transactions && transactions.length > 0) {
        blockTotalSize = transactions.reduce((sum, tx) => sum + (parseInt(tx.data_size || '0', 10) || 0), 0);
    }
    
    blockGroup.userData.totalSize = blockTotalSize;
    blockGroup.userData.transactions = transactions || [];
    
    dailyTotalSize += blockTotalSize;
    updateStatsDisplay();
    
    // Compute cube size
    const baseCubeSize = blockBaseSize * 0.6;
    const sizeMultiplier = Math.min(2.0, Math.max(0.5, 1 + Math.log10(Math.max(1, blockTotalSize / 1000000))));
    const cubeSize = baseCubeSize * sizeMultiplier;

    // Position blocks in helix
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const spacing = 8;
    const radius = spacing * Math.sqrt(blockCount);
    const angle = blockCount * goldenAngle;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    const y = startYOffset + blockCount * verticalStep;
    
    blockGroup.position.set(x, y, z);
    
    // Determine content type mix
    const contentTypeCounts = {};
    transactions.forEach(tx => {
        const contentType = getTransactionContentType(tx);
        contentTypeCounts[contentType] = (contentTypeCounts[contentType] || 0) + 1;
    });

    const uniqueContentTypes = Object.keys(contentTypeCounts);
    const isHomogenous = uniqueContentTypes.length === 1;
    const dominantType = uniqueContentTypes[0] || 'other';
    blockGroup.userData.dominantType = dominantType; // Still useful for filtering
    blockGroup.userData.contentTypes = uniqueContentTypes;

    // Default to neutral 'other' style unless block is homogenous
    const style = isHomogenous ? (contentTypeDataStyles[dominantType] || contentTypeDataStyles.other) : contentTypeDataStyles.other;
    blockGroup.userData.originalColor = style.cubeColor;
    blockGroup.userData.originalOutline = style.outlineColor;
    
    // Create block mesh
    const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    let material;
    const opacity = 0.35; // Increased slightly for better visibility of symbols
    if (isHomogenous && dominantType === 'audio') {
        material = new THREE.MeshPhongMaterial({ map: audioSymbolTexture, transparent: true, opacity });
    } else if (isHomogenous && dominantType === 'video') {
        material = new THREE.MeshPhongMaterial({ map: videoSymbolTexture, transparent: true, opacity });
    } else {
        material = new THREE.MeshPhongMaterial({
            color: style.cubeColor,
            transparent: true,
            opacity,
            shininess: 20
        });
    }
    const cube = new THREE.Mesh(cubeGeometry, material);
    
    const edges = new THREE.EdgesGeometry(cubeGeometry);
    const baseCol = new THREE.Color(style.outlineColor);
    const brightCol = baseCol.clone().lerp(new THREE.Color(0xffffff), 0.4);
    const lineMaterial = new THREE.LineBasicMaterial({ color: brightCol, transparent: true, opacity: 1.0 });
    const outline = new THREE.LineSegments(edges, lineMaterial);
    blockGroup.add(cube);
    blockGroup.add(outline);
    
    cube.userData.transactionCount = transactions.length;
    cube.userData.dominantType = dominantType;
    cube.userData.transactions = transactions;
    cube.userData.blockHeight = height;
    
    // Animate block entrance
    const animateBlockEntrance = () => {
        const duration = 500;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            const easeOutBack = (t) => {
                const c1 = 1.70158;
                const c3 = c1 + 1;
                return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
            };
            
            const scale = easeOutBack(progress) * 1.0;
            cube.scale.set(scale, scale, scale);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                startPulsingAnimation(cube);
            }
        };
        
        animate();
    };
    
    setTimeout(animateBlockEntrance, Math.random() * 200);
    flashOutline(outline);
    
    monolith.add(blockGroup);
    blockCount++;

    // Adjust camera on the first block and every 100 blocks thereafter
    if (blockCount === 1 || blockCount % 100 === 0) {
        fitCameraToMonolith();
    }
    
    // Apply active filter to the new block
    if (activeFilterType) {
        if (activeFilterType === 'render') {
            const hasImages = blockGroup.userData.contentTypes.includes('image');
            if (!hasImages) {
                blockGroup.visible = false;
            }
            // Hide outline during render mode; animate loop will handle materials
            outline.visible = false;
        } else {
            const hasType = blockGroup.userData.contentTypes.includes(activeFilterType);
            if (hasType) {
                const style = contentTypeDataStyles[activeFilterType];
                cube.material.color.set(style.cubeColor);
                outline.material.color.set(style.outlineColor);
            } else {
                blockGroup.visible = false;
            }
        }
    }

    console.log('Block added successfully. Total blocks:', blockCount);
}

// ---- Camera Management ----
function fitCameraToMonolith() {
    if (!camera || !monolith || monolith.children.length === 0) return;
    cameraMode = 'default';

    const box = new THREE.Box3().setFromObject(monolith);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / Math.sin(fov / 2)) * 1.2;
    
    camera.position.set(center.x, center.y, cameraZ);
    camera.lookAt(center);

    // Reset orbit state to match new camera placement
    orbitTarget.copy(center);
    const offset = new THREE.Vector3().subVectors(camera.position, orbitTarget);
    orbitRadius = Math.max(10, offset.length());
    orbitYaw = Math.atan2(offset.x, offset.z);
    const horizLen = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
    orbitPitch = Math.atan2(offset.y, horizLen);
}

// ---- WebSocket Management ----
function requestDayData(date) {
    console.log('Requesting data for date:', date.toISOString());
    if (ws && ws.readyState === WebSocket.OPEN) {
        clearMonolith();
        updateDateDisplay(date);
        
        const y = date.getUTCFullYear();
        const m = date.getUTCMonth();
        const d = date.getUTCDate();
        const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
        const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
        
        const request = { type: 'get_day', start: start.toISOString(), end: end.toISOString() };
        console.log('Sending WebSocket request:', request);
        ws.send(JSON.stringify(request));
    } else {
        console.error('WebSocket not ready');
    }
}

function connectWebSocket() {
    console.log('Connecting to WebSocket server...');
    
    if (ws) {
        ws.close();
    }

    // Use the backend URL from config instead of current location
    const wsUrl = 'wss://arweave-block-explorer.onrender.com';
    console.log('Connecting to backend:', wsUrl);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected successfully');
        const commsElement = document.getElementById('comms');
        if (commsElement) {
            commsElement.textContent = 'Connected to server';
            commsElement.style.color = '#4CAF50';
        }
        
        // Request blocks for the contemporary day using UTC
        const now = new Date();
        currentlyDisplayedDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        requestDayData(currentlyDisplayedDate);
    };
    
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Received:', message.type);
            
            switch (message.type) {
                case 'newBlock':
                    addNewBlock(message.data);
                    break;
                case 'dayStreamComplete':
                    console.log('Day stream complete. Finalizing camera position.');
                    fitCameraToMonolith();
                    break;
                case 'loadingStatus':
                    console.log('Status:', message.message);
                    break;
                case 'error':
                    console.error('Server error:', message.message);
                    break;
            }
        } catch (e) {
            console.error('Error processing WebSocket message:', e);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        const commsElement = document.getElementById('comms');
        if (commsElement) {
            commsElement.textContent = 'Connection error';
            commsElement.style.color = '#f44336';
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket connection closed');
        const commsElement = document.getElementById('comms');
        if (commsElement) {
            commsElement.textContent = 'Disconnected';
            commsElement.style.color = '#ff9800';
        }
    };
}

// ---- Mouse Interaction ----
function onMouseMove(event) {
    if (event.buttons !== 1) { // Not dragging
        // Handle hover effects
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(monolith.children, true);

        if (intersects.length > 0) {
            // Prefer mesh hit to avoid selecting outlines
            const meshHit = intersects.find(h => h.object && h.object.isMesh);
            const intersected = (meshHit ? meshHit.object : intersects[0].object);
            if (hoveredBlock !== intersected) {
                clearHoverState();
                hoveredBlock = intersected;
                setBlockHoverVisuals(hoveredBlock, true);
            }
        } else {
            clearHoverState();
        }
        return;
    }

    // Handle dragging
    const deltaMove = {
        x: event.clientX - previousMousePosition.x,
        y: event.clientY - previousMousePosition.y
    };

    switch (cameraMode) {
        case 'top': {
            // Pan in top view: move camera and target together on XZ plane
            const panSpeed = 0.5;
            const dx = -deltaMove.x * panSpeed;
            const dz =  deltaMove.y * panSpeed;
            camera.position.x += dx;
            camera.position.z += dz;
            orbitTarget.x += dx;
            orbitTarget.z += dz;
            camera.lookAt(orbitTarget);
            break;
        }
        case 'iso': {
            // True orbit around target using spherical coordinates
            const yawSpeed = 0.005;
            const pitchSpeed = 0.005;
            orbitYaw += deltaMove.x * yawSpeed;
            orbitPitch -= deltaMove.y * pitchSpeed;
            const maxPitch = THREE.MathUtils.degToRad(89);
            orbitPitch = Math.max(-maxPitch, Math.min(maxPitch, orbitPitch));
            const cosPitch = Math.cos(orbitPitch);
            const sinPitch = Math.sin(orbitPitch);
            const sinYaw = Math.sin(orbitYaw);
            const cosYaw = Math.cos(orbitYaw);
            const px = orbitTarget.x + orbitRadius * sinYaw * cosPitch;
            const py = orbitTarget.y + orbitRadius * sinPitch;
            const pz = orbitTarget.z + orbitRadius * cosYaw * cosPitch;
            camera.position.set(px, py, pz);
            camera.lookAt(orbitTarget);
            break;
        }
        case 'default':
        default: {
            // Rotate sculpture horizontally; adjust vertical viewing with camera pitch
            const rotationSpeed = 0.005;
            monolith.rotation.y += deltaMove.x * rotationSpeed;
            const newRotX = camera.rotation.x - deltaMove.y * rotationSpeed;
            camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, newRotX));
            break;
        }
    }

    previousMousePosition = { x: event.clientX, y: event.clientY };
}


function clearHoverState() {
    if (hoveredBlock) {
        setBlockHoverVisuals(hoveredBlock, false);
        hoveredBlock = null;
    }
}

function setBlockHoverVisuals(block, isHovered) {
    // Ensure we are acting on the main cube mesh, not the outline
    const root = getBlockRoot(block);
    if (!root) return;

    const cube = root.children.find(child => child.isMesh);
    if (!cube || !cube.material) return;

    if (typeof cube.material.emissive !== 'undefined') {
        cube.material.emissive.setHex(isHovered ? 0x555555 : 0x000000);
    }

    // In render mode, outlines are hidden globally. Temporarily show a white outline for hovered block.
    const outline = root.children.find(child => child.isLineSegments);
    if (outline) {
        if (activeFilterType === 'render') {
            if (isHovered) {
                outline.visible = true;
                if (outline.material && outline.material.color) outline.material.color.set(0xFFFFFF);
                if (outline.material) { outline.material.transparent = true; outline.material.opacity = 1.0; }
            } else {
                outline.visible = false;
            }
        }
    }
}

function onMouseDown(event) {
    isDragging = false;
    previousMousePosition = { x: event.clientX, y: event.clientY };
}

function onMouseUp() {
    isDragging = false;
}

function onMouseClick(event) {
    if (isDragging) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(monolith.children, true);

    if (intersects.length > 0) {
        // Prefer hits on meshes to avoid selecting edges/lines first
        const meshHit = intersects.find(hit => hit.object && hit.object.isMesh);
        const intersected = (meshHit ? meshHit.object : intersects[0].object);
        const blockGroup = getBlockRoot(intersected);
        if (blockGroup) {
            // Default: open Preview. Modifier-click opens Block Info.
            if (event.ctrlKey || event.metaKey || event.altKey) {
                showBlockInfo(blockGroup);
            } else {
                openMediaPreview(blockGroup);
            }
        }
    }
}

function getBlockRoot(obj) {
    let o = obj;
    while (o && o.parent !== monolith) {
        o = o.parent;
    }
    return o;
}

function showBlockInfo(group) {
    const panel = document.getElementById('block-info-panel');
    if (!panel || !group) return;

    const h = group.userData.blockHeight;
    const totalSize = group.userData.totalSize;
    const txs = group.userData.transactions || [];

    document.getElementById('block-height').textContent = h;
    document.getElementById('block-total-size').textContent = formatBytes(totalSize);

    const txList = document.getElementById('transaction-list');
    txList.innerHTML = '';

    txs.forEach(tx => {
        const txDiv = document.createElement('div');
        txDiv.className = 'transaction-item';
        const shortId = `${tx.id.substring(0, 10)}...`;
        const viewblockUrl = `https://viewblock.io/arweave/tx/${tx.id}`;
        txDiv.innerHTML = `ID: ${shortId} | Size: ${formatBytes(tx.data_size)} ` +
            `<a href="${viewblockUrl}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;">Viewblock</a>`;
        txDiv.style.cursor = 'pointer';
        // Clicking a transaction opens preview and replaces any existing preview
        txDiv.addEventListener('click', () => {
            // Build media list for this block
            const mediaTxs = txs.filter(t => {
                const mime = (t.tags && (t.tags['Content-Type'] || t.tags['content-type'])) || '';
                return typeof mime === 'string' && (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/'));
            });
            currentPreviewableTxs = mediaTxs;
            currentTxIndex = Math.max(0, mediaTxs.findIndex(t => t.id === tx.id));
            renderPreview(mediaTxs[currentTxIndex] || tx);
            // Show preview panel (renderPreview already does) and keep info panel hidden
            panel.style.display = 'none';
        });
        txList.appendChild(txDiv);
    });

    panel.style.display = 'block';
}

function closeBlockInfo() {
    const panel = document.getElementById('block-info-panel');
    if (panel) panel.style.display = 'none';
}

function onMouseWheel(event) {
    event.preventDefault();
    if (!camera) return;

    const direction = event.deltaY < 0 ? 1 : -1;

    switch (cameraMode) {
        case 'top': {
            // Zoom by changing height
            const zoomSpeedTop = 5;
            camera.position.y -= direction * zoomSpeedTop;
            camera.position.y = Math.max(5, Math.min(500, camera.position.y));
            camera.lookAt(orbitTarget);
            break;
        }
        case 'iso': {
            // Zoom by changing orbit radius, keep looking at target
            const zoomSpeedOrbit = 5;
            orbitRadius = Math.max(10, orbitRadius - direction * zoomSpeedOrbit);
            const cosPitch = Math.cos(orbitPitch);
            const sinPitch = Math.sin(orbitPitch);
            const sinYaw = Math.sin(orbitYaw);
            const cosYaw = Math.cos(orbitYaw);
            const px = orbitTarget.x + orbitRadius * sinYaw * cosPitch;
            const py = orbitTarget.y + orbitRadius * sinPitch;
            const pz = orbitTarget.z + orbitRadius * cosYaw * cosPitch;
            camera.position.set(px, py, pz);
            camera.lookAt(orbitTarget);
            break;
        }
        case 'default':
        default: {
            // Dolly zoom
            const zoomSpeedDolly = 0.1;
            const vector = new THREE.Vector3();
            camera.getWorldDirection(vector);
            camera.position.add(vector.multiplyScalar(direction * zoomSpeedDolly * 100));
            break;
        }
    }
}

function openMediaPreview(blockGroup) {
    const txs = blockGroup.userData.transactions || [];
    
    // Treat 'render' mode as the 'image' filter for preview purposes
    const filter = (activeFilterType === 'render') ? 'image' : activeFilterType;
    currentPreviewableTxs = txs.filter(tx => {
        const ct = getTransactionContentType(tx);
        if (filter && ct !== filter) {
            return false;
        }
        const mime = (tx.tags && (tx.tags['Content-Type'] || tx.tags['content-type'])) || '';
        return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
    });

    if (currentPreviewableTxs.length > 0) {
        currentTxIndex = 0;
        renderPreview(currentPreviewableTxs[currentTxIndex]);
        preloadMedia(currentPreviewableTxs); // Preload other media
        // Hide Block Info panel if open when showing preview
        const infoPanel = document.getElementById('block-info-panel');
        if (infoPanel) infoPanel.style.display = 'none';
    } else {
        // Fallback to block info if no matching media is found
        console.log('No media found for block; opening Block Info. txs length =', txs.length);
        showBlockInfo(blockGroup);
    }
}

function renderPreview(tx) {
    const previewPanel = document.getElementById('content-preview-panel');
    const display = document.getElementById('content-display');
    const counter = document.getElementById('tx-counter');
    if (!display || !previewPanel || !counter) return;

    const ct = (tx.tags && (tx.tags['Content-Type'] || tx.tags['content-type'])) || '';
    const url = `https://arweave.net/${tx.id}`;
    const viewblockUrl = `https://viewblock.io/arweave/tx/${tx.id}`;

    display.innerHTML = '';
    counter.textContent = `${currentTxIndex + 1} / ${currentPreviewableTxs.length}`;

    // Set title with Viewblock link
    const title = document.getElementById('content-title');
    if (title) {
        const shortId = `${tx.id.substring(0, 10)}...`;
        title.innerHTML = `Transaction: ${shortId} ` +
            `<a href="${viewblockUrl}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;">Viewblock</a>`;
    }

    const errorFallback = (msg = 'Preview unavailable') => {
        display.textContent = msg;
    };

    if (ct.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '60vh';
        img.onerror = () => errorFallback();
        display.appendChild(img);
    } else if (ct.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        video.style.maxWidth = '100%';
        video.style.maxHeight = '60vh';
        video.onerror = () => errorFallback();
        display.appendChild(video);
    } else if (ct.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.controls = true;
        audio.autoplay = true;
        display.appendChild(audio);
    }

    previewPanel.style.display = 'block';
}

// ---- Draggable UI ----
function makeDraggable(panelEl, handleEl) {
    if (!panelEl || !handleEl) return;
    panelEl.style.position = 'absolute';
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    const onMouseDown = (e) => {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panelEl.getBoundingClientRect();
        // initialize left/top if not set
        if (!panelEl.style.left) panelEl.style.left = rect.left + 'px';
        if (!panelEl.style.top) panelEl.style.top = rect.top + 'px';
        startLeft = parseInt(panelEl.style.left, 10) || rect.left;
        startTop = parseInt(panelEl.style.top, 10) || rect.top;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    };
    const onMouseMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panelEl.style.left = (startLeft + dx) + 'px';
        panelEl.style.top = (startTop + dy) + 'px';
    };
    const onMouseUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };
    handleEl.style.cursor = 'move';
    handleEl.addEventListener('mousedown', onMouseDown);
}


function closeContentPreview() {
    const panel = document.getElementById('content-preview-panel');
    if (panel) panel.style.display = 'none';
    // Stop any playing media
    const display = document.getElementById('content-display');
    if (display && display.firstChild && typeof display.firstChild.pause === 'function') {
        display.firstChild.pause();
    }
}

function preloadMedia(txs) {
    txs.forEach((tx, index) => {
        // Don't preload the currently visible one
        if (index === currentTxIndex) return;

        const ct = (tx.tags && (tx.tags['Content-Type'] || tx.tags['content-type'])) || '';
        const url = `https://arweave.net/${tx.id}`;

        if (ct.startsWith('image/')) {
            const img = new Image();
            img.src = url;
        } else if (ct.startsWith('video/')) {
            // Videos are trickier to preload fully, but this helps
            const video = document.createElement('video');
            video.preload = 'auto';
            video.src = url;
        } else if (ct.startsWith('audio/')) {
            const audio = document.createElement('audio');
            audio.preload = 'auto';
            audio.src = url;
        }
    });

    // If entering render mode, kickstart some immediate renders for visible blocks
    if (activeFilterType === 'render' && camera) {
        try {
            camera.updateMatrixWorld();
            cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(cameraMatrix);
            let kickBudget = 12;
            for (let i = 0; i < monolith.children.length && kickBudget > 0; i++) {
                const blockGroup = monolith.children[i];
                const cube = blockGroup.children.find(child => child.isMesh);
                if (!cube || !blockGroup.visible) continue;
                if (frustum.intersectsObject(cube) && !blockGroup.userData.isRendered) {
                    applyRenderMode(blockGroup);
                    kickBudget--;
                }
            }
        } catch (e) {
            console.warn('Kickstart render failed:', e);
        }
    }
}

function onWindowResize() {
    if (!camera || !renderer) return;
    
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function setTopView() {
    if (!camera || !monolith) return;
    cameraMode = 'top';
    const box = new THREE.Box3().setFromObject(monolith);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    const distance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.1;
    camera.position.set(center.x, center.y + distance, center.z);
    orbitTarget.copy(center);
    camera.lookAt(orbitTarget);
}

function setIsometricView() {
    if (!camera || !monolith || monolith.children.length === 0) return;
    cameraMode = 'iso';
    // Classic isometric: ~35° elevation and 45° yaw relative to scene bounds
    const box = new THREE.Box3().setFromObject(monolith);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(1, 1, 1).normalize();
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const distance = (sphere.radius / Math.sin(fovRad / 2)) * 1.15;
    const targetPos = dir.multiplyScalar(distance).add(sphere.center);
    camera.position.copy(targetPos);
    orbitTarget.copy(sphere.center);
    camera.lookAt(orbitTarget);

    // Initialize orbit parameters from current camera pose
    const offset = new THREE.Vector3().subVectors(camera.position, orbitTarget);
    orbitRadius = Math.max(10, offset.length());
    orbitYaw = Math.atan2(offset.x, offset.z);
    const horizontalLen = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
    orbitPitch = Math.atan2(offset.y, horizontalLen);
}

// ---- Main Animation Loop ----
function animate() {
    try {
        if (isRotating) {
            monolith.rotation.y += 0.001;
        }

        // On-demand texture loading for render mode (with per-frame budget)
        if (activeFilterType === 'render') {
            camera.updateMatrixWorld();
            cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(cameraMatrix);

            let budget = 10; // limit renders per frame for responsiveness
            for (let i = 0; i < monolith.children.length; i++) {
                const blockGroup = monolith.children[i];
                const cube = blockGroup.children.find(child => child.isMesh);
                if (!cube) continue;

                if (frustum.intersectsObject(cube)) {
                    if (!blockGroup.userData.isRendered) {
                        if (budget > 0) {
                            applyRenderMode(blockGroup);
                            budget--;
                        }
                    }
                } else {
                    if (blockGroup.userData.isRendered) {
                        disposeRenderedBlock(blockGroup);
                    }
                }
                if (budget === 0) break;
            }
        }
        
        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
        requestAnimationFrame(animate);
    } catch (error) {
        console.error('Error in animation loop:', error);
    }
}

function updateLegend() {
    const legendItems = document.getElementById('legend-items');
    legendItems.innerHTML = '';

    // Add Reset button
    const resetItem = document.createElement('div');
    resetItem.className = 'legend-item';
    resetItem.dataset.type = 'reset';
    resetItem.style.cursor = 'pointer';
    resetItem.innerHTML = `<span>Reset Filters</span>`;
    resetItem.addEventListener('click', () => toggleLegendType(null));
    legendItems.appendChild(resetItem);

    // Render legend item removed (auto-render on Image)

    for (const type in contentTypeDataStyles) {
        const style = contentTypeDataStyles[type];
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.type = type;
        item.style.cursor = 'pointer';
        item.innerHTML = `<span class="legend-color-box" style="border-color: #${style.outlineColor.toString(16).padStart(6, '0')};"></span><span>${style.name}</span>`;
        
        item.addEventListener('click', () => {
            toggleLegendType(type);
        });
        legendItems.appendChild(item);
    }
    highlightLegendSelection();
}

function toggleLegendType(type) {
    if (type === null) { // Handle Reset button
        activeFilterType = null;
    } else {
        // Auto-render when selecting Image: map image -> render
        if (type === 'image') {
            activeFilterType = (activeFilterType === 'render') ? null : 'render';
        } else {
            activeFilterType = (activeFilterType === type) ? null : type;
        }
    }
    applySceneFilter();
    highlightLegendSelection();
    // Fit camera when entering render mode so visible blocks render immediately
    if (activeFilterType === 'render') {
        fitCameraToMonolith();
    }
}

function applySceneFilter() {
    monolith.children.forEach(blockGroup => {
        const cube = blockGroup.children.find(child => child.isMesh);
        const outline = blockGroup.children.find(child => child.isLineSegments);

        // STAGE 1: CLEANUP
        // Always dispose of rendered materials if they exist.
        if (blockGroup.userData.isRendered) {
            disposeRenderedBlock(blockGroup);
        }
        // Ensure material is a single object, not an array, before proceeding.
        if (cube && Array.isArray(cube.material)) {
            cube.material = new THREE.MeshPhongMaterial({
                color: blockGroup.userData.originalColor,
                transparent: true, opacity: 0.35
            });
        }
        
        // CRITICAL: When resetting filters, ensure isRendered is completely cleared
        if (activeFilterType !== 'render' && blockGroup.userData.isRendered) {
            blockGroup.userData.isRendered = false;
        }

        // STAGE 2: APPLY NEW FILTER
        if (activeFilterType === 'render') {
            const hasImages = blockGroup.userData.contentTypes.includes('image');
            blockGroup.visible = hasImages;
            // The animate loop will handle the actual rendering.
        } else if (activeFilterType) {
            const hasType = blockGroup.userData.contentTypes.includes(activeFilterType);
            blockGroup.visible = hasType;
            if (hasType && cube && outline) {
                const style = contentTypeDataStyles[activeFilterType];
                cube.material.color.set(style.cubeColor);
                outline.material.color.set(style.outlineColor);
            }
        } else {
            // No filter active: reset to original state.
            blockGroup.visible = true;
            if (cube) cube.material.color.set(blockGroup.userData.originalColor);
            if (outline) outline.material.color.set(blockGroup.userData.originalOutline);
        }

        // STAGE 3: FINAL UI STATE
        if (outline) outline.visible = activeFilterType !== 'render';
    });
}

function disposeRenderedBlock(blockGroup) {
    const cube = blockGroup.children.find(child => child.isMesh);
    if (!cube || !blockGroup.userData.isRendered) return;

    if (Array.isArray(cube.material)) {
        cube.material.forEach(mat => {
            if (mat.map) {
                mat.map.dispose();
            }
            mat.dispose();
        });
    } else if (cube.material.map) {
        cube.material.map.dispose();
        cube.material.dispose();
    }

    // Restore original material
    cube.material = new THREE.MeshPhongMaterial({
        color: blockGroup.userData.originalColor,
        transparent: true,
        opacity: 0.35
    });

    blockGroup.userData.isRendered = false;
}

const tintedImageShader = {
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D uTexture;
        varying vec2 vUv;
        void main() {
            vec4 texColor = texture2D(uTexture, vUv);
            // Convert to grayscale (luminance)
            float gray = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
            // Output the grayscale color with transparency
            gl_FragColor = vec4(vec3(gray), 0.35);
        }
    `
};

async function applyRenderMode(blockGroup) {
    if (blockGroup.userData.isRendered) return; // Already rendering or rendered
    blockGroup.userData.isRendered = true;

    const cube = blockGroup.children.find(child => child.isMesh);
    if (!cube) return;

    const imageTxs = blockGroup.userData.transactions.filter(tx => 
        ((tx.tags && (tx.tags['Content-Type'] || tx.tags['content-type'])) || '').startsWith('image/')
    );

    if (imageTxs.length > 0) {
        const imageLoader = new THREE.ImageLoader();
        imageLoader.setCrossOrigin('');
        const materials = [];
        const promises = [];

        for (let i = 0; i < 6; i++) {
            const tx = imageTxs[i % imageTxs.length];
            const url = `https://arweave.net/${tx.id}`;

            const promise = new Promise(async (resolve) => {
                try {
                    const image = await imageLoader.loadAsync(url);
                    const canvas = document.createElement('canvas');
                    const textureSize = 256;
                    canvas.width = textureSize;
                    canvas.height = textureSize;
                    const context = canvas.getContext('2d');
                    context.drawImage(image, 0, 0, textureSize, textureSize);
                    
                    const texture = new THREE.CanvasTexture(canvas);

                    materials[i] = new THREE.ShaderMaterial({
                        uniforms: {
                            uTexture: { value: texture }
                        },
                        vertexShader: tintedImageShader.vertexShader,
                        fragmentShader: tintedImageShader.fragmentShader,
                        transparent: true
                    });
                } catch (error) {
                    console.error(`Failed to load or process image: ${url}`, error);
                    materials[i] = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.35 });
                }
                resolve();
            });
            promises.push(promise);
        }

        await Promise.all(promises);
        cube.material = materials;

    } else {
        cube.material = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.35 });
    }
}

function highlightLegendSelection() {
    const items = document.querySelectorAll('.legend-item');
    const activeTypeForMark = (activeFilterType === 'render') ? 'image' : activeFilterType;

    items.forEach(item => {
        const isActive = !!activeTypeForMark && item.dataset.type === activeTypeForMark;
        if (!activeTypeForMark || isActive) {
            item.classList.remove('inactive');
        } else {
            item.classList.add('inactive');
        }
        const box = item.querySelector('.legend-color-box');
        if (box) {
            box.textContent = isActive ? 'X' : '';
            box.style.display = 'flex';
            box.style.alignItems = 'center';
            box.style.justifyContent = 'center';
            box.style.fontWeight = 'bold';
            box.style.color = '#FFFFFF';
        }
    });
}

// ---- Initialization ----
function init() {
    console.log('Initializing Arweave Block Explorer...');
    createSymbolTextures();
    
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a12);
    
    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Add renderer to DOM
    const container = document.getElementById('three-container');
    if (container) {
        container.appendChild(renderer.domElement);
    }
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);
    
    // Initialize monolith for blocks
    monolith = new THREE.Group();
    scene.add(monolith);
    
    // Initialize raycaster and mouse
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    // Add event listeners
    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('keydown', onKeyDown, false);
    const canvas = renderer.domElement;
    canvas.addEventListener('mousemove', onMouseMove, false);
    canvas.addEventListener('mousedown', onMouseDown, false);
    canvas.addEventListener('mouseup', onMouseUp, false);
    canvas.addEventListener('click', onMouseClick, false);
    canvas.addEventListener('wheel', onMouseWheel, { passive: false });

    // Initial Legend Update
    updateLegend();
    
    // Start animation loop
    animate();
    
    console.log('Scene initialized successfully');
    
    // Connect to WebSocket
    connectWebSocket();
}

// ---- DOM Ready ----
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    init();

    // Attach ALL DOM element event listeners after the DOM is fully loaded to prevent race conditions
    document.getElementById('close-block-info').addEventListener('click', closeBlockInfo);
    document.getElementById('close-content-preview').addEventListener('click', closeContentPreview);

    document.getElementById('prev-day').addEventListener('click', () => {
        currentlyDisplayedDate.setDate(currentlyDisplayedDate.getDate() - 1);
        requestDayData(currentlyDisplayedDate);
    });

    document.getElementById('next-day').addEventListener('click', () => {
        currentlyDisplayedDate.setDate(currentlyDisplayedDate.getDate() + 1);
        requestDayData(currentlyDisplayedDate);
    });

    const rotBtn = document.getElementById('toggle-rotation');
    if (rotBtn) {
        rotBtn.addEventListener('click', () => {
            isRotating = !isRotating;
            rotBtn.textContent = isRotating ? 'STOP ROTATION' : 'START ROTATION';
        });
        // Start rotating by default
        isRotating = true;
        rotBtn.textContent = 'STOP ROTATION';
    }

    document.getElementById('top-view').addEventListener('click', setTopView);
    document.getElementById('reset-view').addEventListener('click', () => {
        fitCameraToMonolith();
    });
    document.getElementById('iso-view').addEventListener('click', () => {
        setIsometricView();
    });

    document.getElementById('prev-tx-btn').addEventListener('click', () => {
        if (currentPreviewableTxs.length > 0) {
            currentTxIndex = (currentTxIndex - 1 + currentPreviewableTxs.length) % currentPreviewableTxs.length;
            renderPreview(currentPreviewableTxs[currentTxIndex]);
        }
    });

    document.getElementById('next-tx-btn').addEventListener('click', () => {
        if (currentPreviewableTxs.length > 0) {
            currentTxIndex = (currentTxIndex + 1) % currentPreviewableTxs.length;
            renderPreview(currentPreviewableTxs[currentTxIndex]);
        }
    });

    // Make preview panel draggable via its title
    const previewPanel = document.getElementById('content-preview-panel');
    const previewTitle = document.getElementById('content-title');
    makeDraggable(previewPanel, previewTitle);
});
