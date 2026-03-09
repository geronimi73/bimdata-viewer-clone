# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A minimal IFC (Industry Foundation Classes) 3D viewer that runs entirely in the browser. It's a single-file SPA with no build tooling.

## Running the App

Since there's no build step, just serve `index.html` over HTTP:

```bash
# Python (usually available)
python3 -m http.server 8080

# Node.js
npx serve .

# Or open index.html directly in a browser (may have CORS issues with WASM)
```

## Architecture

**Single file:** `index.html` contains all HTML, CSS, and JavaScript (~315 lines).

**External CDN dependencies (no local installs):**
- `@xeokit/xeokit-sdk@2.6.106` — 3D rendering via WebGL (`Viewer`, `WebIFCLoaderPlugin`, `NavCubePlugin`)
- `web-ifc@0.0.51` — WebAssembly IFC parser (`IfcAPI`)

**Application flow:**
1. xeokit `Viewer` is created on `#myCanvas` with camera and lighting config
2. `IfcAPI` (web-ifc) initializes its WASM module asynchronously from CDN
3. Once WASM is ready, `WebIFCLoaderPlugin` is instantiated using the `IfcAPI`
4. User uploads or drags an `.ifc` file → read as `ArrayBuffer` → passed to `loadIFC()`
5. `loadIFC()` destroys any previous model, then loads the new one, filtering out `IfcSpace` entities

**Key implementation details:**
- IFC files are read as `ArrayBuffer` (not text) before being passed to xeokit
- Edge rendering is enabled on the loaded model
- Previous model is destroyed before loading a new one to free memory
- Performance metrics (load time, object count) are shown in the UI after loading

## Task Requirements (TASK.md)

- Simple SPA, JavaScript only — no frameworks
- Fully client-side, no API calls
- User uploads `.ifc` file which renders in browser
- Simple UI, mobile-friendly
