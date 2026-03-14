import { useEffect, useRef, useState } from 'react';
import { Viewer, WebIFCLoaderPlugin, NavCubePlugin, OBJLoaderPlugin, LASLoaderPlugin } from '@xeokit/xeokit-sdk';
import * as WebIFC from 'web-ifc';
import './App.css';

export default function App() {
    const canvasRef    = useRef(null);
    const navCubeRef   = useRef(null);
    const fileInputRef = useRef(null);

    const viewerRef      = useRef(null);
    const ifcLoaderRef   = useRef(null);
    const objLoaderRef   = useRef(null);
    const lasLoaderRef   = useRef(null);
    const modelCounterRef = useRef(0);
    const loadedModelsRef = useRef({});

    const [status, setStatus]         = useState('No models loaded');
    const [models, setModels]         = useState({});
    const [showOverlay, setShowOverlay] = useState(true);
    const [isDragOver, setIsDragOver]  = useState(false);
    const [listCollapsed, setListCollapsed] = useState(false);

    useEffect(() => {
        const viewer = new Viewer({
            canvasElement: canvasRef.current,
            transparent: true,
            dtxEnabled: true,
        });

        viewer.camera.eye  = [-3.933, 2.855, 27.018];
        viewer.camera.look = [4.400,  3.724,  8.899];
        viewer.camera.up   = [-0.018, 0.999,  0.039];

        viewer.cameraControl.pivotingEnabled = true;

        new NavCubePlugin(viewer, {
            canvasElement: navCubeRef.current,
            visible: true,
            size: 180,
            alignment: 'bottomRight',
            bottomMargin: 0,
            rightMargin: 0,
        });

        viewerRef.current = viewer;

        const IfcAPI = new WebIFC.IfcAPI();
        IfcAPI.SetWasmPath('https://cdn.jsdelivr.net/npm/web-ifc@0.0.51/');

        IfcAPI.Init().then(() => {
            ifcLoaderRef.current = new WebIFCLoaderPlugin(viewer, { WebIFC, IfcAPI });
            objLoaderRef.current = new OBJLoaderPlugin(viewer);
            lasLoaderRef.current = new LASLoaderPlugin(viewer);
            setStatus('Ready — open a file to begin');
        }).catch(err => {
            setStatus('Failed to initialise web-ifc: ' + err.message);
        });

        return () => { viewer.destroy(); };
    }, []);

    function syncModels() {
        setModels({ ...loadedModelsRef.current });
        const count = Object.keys(loadedModelsRef.current).length;
        if (count === 0) setShowOverlay(true);
    }

    function removeModel(id) {
        const entry = loadedModelsRef.current[id];
        if (!entry) return;
        if (entry.entity?.destroy) entry.entity.destroy();
        if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
        delete loadedModelsRef.current[id];
        syncModels();
        const count = Object.keys(loadedModelsRef.current).length;
        setStatus(count === 0 ? 'No models loaded' : `${count} model(s) loaded`);
    }

    function _loadIFC(arrayBuffer, filename) {
        if (!ifcLoaderRef.current) { setStatus('Initialising — please wait…'); return; }
        const id = 'model-' + (++modelCounterRef.current);
        setStatus('Loading ' + filename + '…');
        setShowOverlay(false);
        const t0    = performance.now();
        const model = ifcLoaderRef.current.load({
            id,
            ifc: arrayBuffer,
            loadMetadata: true,
            excludeTypes: ['IfcSpace'],
            edges: true,
        });
        model.on('loaded', () => {
            const secs = ((performance.now() - t0) / 1000).toFixed(2);
            loadedModelsRef.current[id] = { name: filename, ext: 'ifc', entity: model, blobUrl: null };
            syncModels();
            setStatus(`${filename}  ·  ${model.numEntities} objects  ·  loaded in ${secs}s`);
            viewerRef.current.cameraFlight.jumpTo(model);
        });
        model.on('error', e => setStatus('Error loading IFC: ' + e));
    }

    function _loadOBJ(blobUrl, filename) {
        if (!objLoaderRef.current) { setStatus('Initialising — please wait…'); return; }
        const id = 'model-' + (++modelCounterRef.current);
        setStatus('Loading ' + filename + '…');
        setShowOverlay(false);
        const t0    = performance.now();
        const model = objLoaderRef.current.load({ id, src: blobUrl, edges: true });
        model.on('loaded', () => {
            const secs = ((performance.now() - t0) / 1000).toFixed(2);
            loadedModelsRef.current[id] = { name: filename, ext: 'obj', entity: model, blobUrl };
            syncModels();
            setStatus(`${filename}  ·  ${model.numEntities} objects  ·  loaded in ${secs}s`);
            viewerRef.current.cameraFlight.jumpTo(model);
        });
        model.on('error', e => {
            URL.revokeObjectURL(blobUrl);
            setStatus('Error loading OBJ: ' + e);
        });
    }

    function _loadLAS(arrayBuffer, filename, ext) {
        if (!lasLoaderRef.current) { setStatus('Initialising — please wait…'); return; }
        const id = 'model-' + (++modelCounterRef.current);
        setStatus('Loading ' + filename + '…');
        setShowOverlay(false);
        const t0    = performance.now();
        const model = lasLoaderRef.current.load({ id, las: arrayBuffer, rotation: [-90, 0, 0] });
        model.on('loaded', () => {
            const secs = ((performance.now() - t0) / 1000).toFixed(2);
            loadedModelsRef.current[id] = { name: filename, ext, entity: model, blobUrl: null };
            syncModels();
            setStatus(`${filename}  ·  loaded in ${secs}s`);
            viewerRef.current.cameraFlight.jumpTo(model);
        });
        model.on('error', e => setStatus('Error loading LAS/LAZ: ' + e));
    }

    function handleFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'ifc') {
            const reader = new FileReader();
            reader.onload = ev => _loadIFC(ev.target.result, file.name);
            reader.readAsArrayBuffer(file);
        } else if (ext === 'obj') {
            _loadOBJ(URL.createObjectURL(file), file.name);
        } else if (ext === 'las' || ext === 'laz') {
            const reader = new FileReader();
            reader.onload = ev => _loadLAS(ev.target.result, file.name, ext);
            reader.readAsArrayBuffer(file);
        } else {
            setStatus('Unsupported format: ' + file.name);
        }
    }

    function onFileInputChange(e) {
        Array.from(e.target.files).forEach(handleFile);
        e.target.value = '';
    }

    function onDragOver(e) {
        e.preventDefault();
        setIsDragOver(true);
    }

    function onDragLeave(e) {
        if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
            setIsDragOver(false);
        }
    }

    function onDrop(e) {
        e.preventDefault();
        setIsDragOver(false);
        Array.from(e.dataTransfer.files).forEach(handleFile);
    }

    const modelEntries = Object.entries(models);

    return (
        <>
            <div className="topbar">
                <h1>3D Viewer</h1>
                <button className="upload-btn" onClick={() => fileInputRef.current.click()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Open File
                </button>
                <input
                    ref={fileInputRef}
                    className="file-input"
                    type="file"
                    accept=".ifc,.obj,.las,.laz"
                    multiple
                    onChange={onFileInputChange}
                />
                <span className="status">{status}</span>
            </div>

            <div
                className={`viewer-wrap${isDragOver ? ' drag-over' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <canvas ref={canvasRef} className="main-canvas" />
                <canvas ref={navCubeRef} className="navcube-canvas" />

                {modelEntries.length > 0 && (
                    <div className="model-list-panel">
                        <div className="model-list-header" onClick={() => setListCollapsed(c => !c)}>
                            <span>Loaded Models</span>
                            <span className="model-list-toggle-icon">{listCollapsed ? '▼' : '▲'}</span>
                        </div>
                        <div className={`model-list-body${listCollapsed ? ' collapsed' : ''}`}>
                            {modelEntries.map(([id, entry]) => (
                                <div key={id} className="model-item">
                                    <span className="model-item-name" title={entry.name}>{entry.name}</span>
                                    <span className="model-item-type">{entry.ext}</span>
                                    <button className="model-item-remove" title="Remove" onClick={() => removeModel(id)}>×</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {showOverlay && (
                    <div className="drop-overlay">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#e94560" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                        </svg>
                        <p>Click <strong>Open File</strong> or drop a file here<br/>
                        <strong>IFC · OBJ · LAS/LAZ</strong></p>
                    </div>
                )}

                <div className="hint">
                    🖱 Left drag: orbit &nbsp;·&nbsp; Right drag: pan &nbsp;·&nbsp; Scroll: zoom<br/>
                    📱 One finger: orbit &nbsp;·&nbsp; Two fingers: pan / pinch-zoom
                </div>
            </div>
        </>
    );
}
