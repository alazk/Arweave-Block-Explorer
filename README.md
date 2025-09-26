# Arweave Block Explorer

An immersive 3D data sculpture that transforms the Arweave blockchain into a living, interactive visualization. Experience the permanent web as a dynamic architectural structure where each block becomes a translucent cube, revealing the rich tapestry of data flowing through the network.

![Arweave Block Explorer](https://img.shields.io/badge/Status-Live-brightgreen) ![Version](https://img.shields.io/badge/Version-4.4-blue) ![Three.js](https://img.shields.io/badge/Three.js-0.158.0-orange) ![WebGL](https://img.shields.io/badge/WebGL-Enabled-red)

## ✨ Features

###  **Artistic Data Visualization**
- **3D Block Architecture**: Each Arweave block is rendered as a translucent cube, creating a mesmerizing data sculpture
- **Content-Aware Styling**: Blocks are visually differentiated by their dominant content type with intuitive color coding
- **Ethereal Aesthetics**: Semi-transparent materials create a holographic, futuristic appearance

###  **Intelligent Content Recognition**
- **Smart Categorization**: Automatically identifies and categorizes transactions by content type (Image, Video, Audio, Other)
- **Visual Symbols**: Pure media blocks display iconic symbols - musical notes (𝄞) for audio and play buttons (▶) for video
- **Content Filtering**: Advanced filtering system allows you to focus on specific data types

###  **Render Mode**
- **Image Projection**: Transform image-containing blocks into textured surfaces displaying actual content
- **Artistic Processing**: Images are converted to high-contrast monochrome with custom GPU shaders
- **Performance Optimized**: Intelligent on-demand rendering with frustum culling and texture caching
- **Memory Management**: Automatic texture disposal prevents browser crashes during extended use

###  **Intuitive Interaction**
- **Seamless Navigation**: Smooth mouse controls for rotation, zoom, and panning
- **Multiple Camera Modes**: Switch between default, top-down, and isometric views
- **Media Previews**: Click any media block to view/play content with full-screen preview
- **Day Navigation**: Travel through time to explore historical blockchain data

### **Real-Time Data Streaming**
- **Live WebSocket Connection**: Real-time streaming of new blocks as they're added to the network
- **Adaptive Rendering**: New blocks automatically inherit the current filter and render settings
- **Intelligent Filtering**: In Render mode, only image-containing blocks are streamed for optimal performance

### **Advanced Controls**
- **Content Type Legend**: Interactive legend with one-click filtering
- **Reset Functionality**: Instant return to unfiltered view
- **Contextual UI**: Render mode only appears when relevant (after selecting Image filter)
- **Responsive Design**: Fully responsive interface that adapts to any screen size

### **Frontend Architecture**
- **Three.js WebGL Rendering**: Hardware-accelerated 3D graphics
- **Custom GLSL Shaders**: Real-time image processing and artistic effects
- **Frustum Culling**: Optimized rendering of only visible elements
- **Texture Caching**: Intelligent memory management for smooth performance

### **Data Processing**
- **WebSocket Streaming**: Real-time blockchain data integration
- **Content-Type Analysis**: Advanced MIME type detection and categorization
- **Transaction Parsing**: Efficient processing of Arweave transaction metadata
- **Cross-Origin Handling**: Robust CORS management for Arweave gateway access

### **Performance Optimizations**
- **Lazy Loading**: On-demand texture loading for optimal memory usage
- **GPU Acceleration**: Hardware-accelerated rendering and image processing
- **Memory Leak Prevention**: Automatic cleanup of Three.js resources
- **Efficient Filtering**: Smart visibility management without object recreation

### **Prerequisites**
- Modern web browser with WebGL support
- Internet connection for real-time data streaming

### **Installation**
1. Clone the repository:
   ```bash
   git clone https://github.com/alazk/Arweave-Block-Explorer.git
   cd Arweave-Block-Explorer
   ```

2. Serve the files using any static web server:
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Using Node.js http-server
   npx http-server
   
   # Using PHP
   php -S localhost:8000
   ```

3. Open your browser to `http://localhost:8000`

## 🎮 **How to Use**

### **Basic Navigation**
- **Rotate**: Left-click and drag to rotate the sculpture
- **Zoom**: Mouse wheel to zoom in/out
- **Pan**: Right-click and drag to pan the view

### **Exploring Content**
1. **Filter by Type**: Click any content type in the legend to filter blocks
2. **Activate Render Mode**: Click "Image" filter, then click "Render" to see image projections
3. **View Media**: Click any media block to open the preview panel
4. **Navigate Time**: Use arrow buttons to explore different days

### **Advanced Features**
- **Camera Views**: Switch between Default, Top, and Isometric perspectives
- **Reset Filters**: Use the "Reset Filters" button to return to full view
- **Media Navigation**: Use Previous/Next buttons in preview panel for multi-media blocks

## 🎨 **Visual Guide**

### **Color Coding**
- 🤍 **White/Translucent**: Image, Video, and Audio content
- ⚫ **Dark Gray**: Other/Unknown content types
- 🎵 **Musical Note Symbol**: Pure audio blocks
- ▶️ **Play Button Symbol**: Pure video blocks

### **Render Mode**
When activated, Render mode transforms the sculpture into an artistic visualization where:
- Only image-containing blocks remain visible
- Block faces display actual image content in monochrome
- Custom shaders create a unique "data scan" aesthetic
- Performance is optimized through intelligent culling

## 🔧 **Configuration**

The application includes several configurable parameters in `sketch.js`:

```javascript
// Visual Settings
const blockBaseSize = 25;        // Base size of blocks
const verticalStep = 2;          // Vertical spacing between blocks
const opacity = 0.35;           // Block transparency

// Performance Settings
const textureSize = 256;         // Render mode texture resolution
const frustumCulling = true;     // Enable/disable frustum culling
```

## 🌐 **Browser Compatibility**

- ✅ **Chrome 90+** (Recommended)
- ✅ **Firefox 88+**
- ✅ **Safari 14+**
- ✅ **Edge 90+**

**Requirements**: WebGL 1.0, ES6 Modules support

## 🤝 **Contributing**

We welcome contributions! Here are some areas where you can help:

- **New Visualization Modes**: Additional rendering styles and effects
- **Data Sources**: Integration with other blockchain networks
- **Performance Optimizations**: Further memory and rendering improvements
- **UI Enhancements**: Additional controls and customization options

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 **Acknowledgments**

- **Arweave Team**: For building the permanent web infrastructure
- **Three.js Community**: For the incredible 3D graphics library
- **WebGL Contributors**: For enabling hardware-accelerated web graphics

## 🔗 **Links**

- **Arweave Network**: [arweave.org](https://arweave.org)
- **Three.js Documentation**: [threejs.org](https://threejs.org)

---

**Built with ❤️ for the decentralized web**

*Transform data into art. Explore the permanent web like never before.*
