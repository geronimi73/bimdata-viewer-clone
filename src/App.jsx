import { useEffect, useRef, useState } from 'react';
import { Viewer, WebIFCLoaderPlugin, NavCubePlugin, OBJLoaderPlugin, LASLoaderPlugin } from '@xeokit/xeokit-sdk';
import * as WebIFC from 'web-ifc';
import JSZip from 'jszip';

export default function App() {
    const canvasRef    = useRef(null);
    const navCubeRef   = useRef(null);
    const fileInputRef = useRef(null);

    const viewerRef       = useRef(null);
    const ifcLoaderRef    = useRef(null);
    const objLoaderRef    = useRef(null);
    const lasLoaderRef    = useRef(null);
    const modelCounterRef = useRef(0);
    const loadedModelsRef = useRef({});

    const [status, setStatus]               = useState('No models loaded');
    const [models, setModels]               = useState({});
    const [showOverlay, setShowOverlay]     = useState(true);
    const [isDragOver, setIsDragOver]       = useState(false);
    const [listCollapsed, setListCollapsed] = useState(false);
    const [isLoading, setIsLoading]         = useState(false);
    const [captureProgress, setCaptureProgress] = useState(null); // null | { current, total }

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
        if (Object.keys(loadedModelsRef.current).length === 0) setShowOverlay(true);
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
        setIsLoading(true);
        setShowOverlay(false);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const t0    = performance.now();
            const model = ifcLoaderRef.current.load({
                id, ifc: arrayBuffer, loadMetadata: true, excludeTypes: ['IfcSpace'], edges: true,
            });
            model.on('loaded', () => {
                const secs = ((performance.now() - t0) / 1000).toFixed(2);
                loadedModelsRef.current[id] = { name: filename, ext: 'ifc', entity: model, blobUrl: null };
                syncModels();
                setIsLoading(false);
                setStatus(`${filename}  ·  ${model.numEntities} objects  ·  loaded in ${secs}s`);
                viewerRef.current.cameraFlight.jumpTo(model);
            });
            model.on('error', e => { setIsLoading(false); setStatus('Error loading IFC: ' + e); });
        }));
    }

    function _loadOBJ(blobUrl, filename) {
        if (!objLoaderRef.current) { setStatus('Initialising — please wait…'); return; }
        const id = 'model-' + (++modelCounterRef.current);
        setStatus('Loading ' + filename + '…');
        setIsLoading(true);
        setShowOverlay(false);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const t0    = performance.now();
            const model = objLoaderRef.current.load({ id, src: blobUrl, edges: true });
            model.on('loaded', () => {
                const secs = ((performance.now() - t0) / 1000).toFixed(2);
                loadedModelsRef.current[id] = { name: filename, ext: 'obj', entity: model, blobUrl };
                syncModels();
                setIsLoading(false);
                setStatus(`${filename}  ·  ${model.numEntities} objects  ·  loaded in ${secs}s`);
                viewerRef.current.cameraFlight.jumpTo(model);
            });
            model.on('error', e => {
                URL.revokeObjectURL(blobUrl);
                setIsLoading(false);
                setStatus('Error loading OBJ: ' + e);
            });
        }));
    }

    function _loadLAS(arrayBuffer, filename, ext) {
        if (!lasLoaderRef.current) { setStatus('Initialising — please wait…'); return; }
        const id = 'model-' + (++modelCounterRef.current);
        setStatus('Loading ' + filename + '…');
        setIsLoading(true);
        setShowOverlay(false);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const t0    = performance.now();
            const model = lasLoaderRef.current.load({ id, las: arrayBuffer, rotation: [-90, 0, 0] });
            model.on('loaded', () => {
                const secs = ((performance.now() - t0) / 1000).toFixed(2);
                loadedModelsRef.current[id] = { name: filename, ext, entity: model, blobUrl: null };
                syncModels();
                setIsLoading(false);
                setStatus(`${filename}  ·  loaded in ${secs}s`);
                viewerRef.current.cameraFlight.jumpTo(model);
            });
            model.on('error', e => { setIsLoading(false); setStatus('Error loading LAS/LAZ: ' + e); });
        }));
    }

    async function captureScreenshots() {
        const N = 8;
        const angleStep = 360 / N;
        setCaptureProgress({ current: 0, total: N });

        const camera = viewerRef.current.camera;
        const savedEye  = [...camera.eye];
        const savedLook = [...camera.look];
        const savedUp   = [...camera.up];

        camera.orbitPitch(25);

        const snapshots = [];
        for (let i = 0; i < N; i++) {
            setCaptureProgress({ current: i + 1, total: N });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            snapshots.push(viewerRef.current.getSnapshot({ format: 'png' }));
            if (i < N - 1) camera.orbitYaw(angleStep);
        }

        camera.eye  = savedEye;
        camera.look = savedLook;
        camera.up   = savedUp;

        const zip = new JSZip();
        snapshots.forEach((dataUrl, i) => {
            zip.file(`screenshot-${String(i + 1).padStart(2, '0')}.png`, dataUrl.split(',')[1], { base64: true });
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'screenshots.zip';
        a.click();
        URL.revokeObjectURL(a.href);

        setCaptureProgress(null);
    }

    async function loadExample(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        setStatus('Loading ' + filename + '…');
        try {
            const res = await fetch('/' + filename);
            const buf = await res.arrayBuffer();
            if (ext === 'ifc') _loadIFC(buf, filename);
            else if (ext === 'las' || ext === 'laz') _loadLAS(buf, filename, ext);
        } catch (e) {
            setStatus('Failed to load example: ' + e.message);
        }
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
            {/* Top bar */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200 shrink-0 z-10">
                <h1 className="text-base font-semibold text-accent tracking-wide whitespace-nowrap">3D Viewer</h1>
                <button
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
                    onClick={() => fileInputRef.current.click()}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Open File
                </button>
                {Object.keys(models).length > 0 && (
                    <button
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 border border-slate-200 rounded-md text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
                        onClick={captureScreenshots}
                        disabled={captureProgress !== null || isLoading}
                    >
                        {captureProgress ? (
                            <>
                                <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                                {captureProgress.current}/{captureProgress.total}
                            </>
                        ) : (
                            <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                    <circle cx="12" cy="13" r="4"/>
                                </svg>
                                Capture
                            </>
                        )}
                    </button>
                )}

                <input
                    ref={fileInputRef}
                    className="hidden"
                    type="file"
                    accept=".ifc,.obj,.las,.laz"
                    multiple
                    onChange={onFileInputChange}
                />
                <div className="flex items-center gap-2 overflow-hidden flex-1">
                    {isLoading && (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-200 border-t-accent animate-spin shrink-0" />
                    )}
                    <span className="text-xs text-slate-500 overflow-hidden text-ellipsis whitespace-nowrap">{status}</span>
                </div>
            </div>

            {/* Viewer */}
            <div
                className={`relative flex-1 overflow-hidden bg-slate-100 ${isDragOver ? 'outline outline-[3px] outline-dashed outline-accent -outline-offset-[3px]' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <canvas ref={canvasRef} className="w-full h-full block touch-none" />
                <canvas ref={navCubeRef} className="absolute w-[120px] h-[120px] min-[600px]:w-[180px] min-[600px]:h-[180px] bottom-4 right-4 z-20 rounded-md overflow-hidden" />

                {/* Model list */}
                {modelEntries.length > 0 && (
                    <div className="absolute top-2 left-2 z-[25] bg-white/95 border border-slate-200 rounded-lg min-w-[200px] max-w-[300px] max-h-[calc(100%-16px)] overflow-y-auto flex flex-col shadow-sm">
                        <div
                            className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 text-[0.72rem] font-bold text-slate-400 uppercase tracking-widest cursor-pointer select-none hover:text-slate-700"
                            onClick={() => setListCollapsed(c => !c)}
                        >
                            <span>Loaded Models</span>
                            <span className="text-[0.6rem]">{listCollapsed ? '▼' : '▲'}</span>
                        </div>
                        <div className={listCollapsed ? 'hidden' : 'py-1'}>
                            {modelEntries.map(([id, entry]) => (
                                <div key={id} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-700 border-b border-slate-100 last:border-b-0">
                                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap" title={entry.name}>{entry.name}</span>
                                    <span className="text-[0.62rem] px-1 py-0.5 rounded bg-slate-200 text-slate-500 uppercase shrink-0">{entry.ext}</span>
                                    <button
                                        className="bg-transparent border-none text-accent cursor-pointer text-base leading-none px-0.5 opacity-60 hover:opacity-100 shrink-0"
                                        title="Remove"
                                        onClick={() => removeModel(id)}
                                    >×</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Drop overlay */}
                {showOverlay && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/90 z-30 gap-5 pointer-events-none">
                        <svg className="w-16 h-16 opacity-50 pointer-events-auto cursor-pointer hover:opacity-80 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="#e94560" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" onClick={() => fileInputRef.current.click()}>
                            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                        </svg>
                        <p className="text-lg text-slate-500 text-center px-6">
                            Click <strong className="text-accent">Open File</strong> or drop a file here<br/>
                            <strong className="text-accent">IFC · OBJ · LAS/LAZ</strong>
                        </p>
                        <div className="flex flex-col items-center gap-2 pointer-events-auto">
                            <span className="text-xs text-slate-400 uppercase tracking-widest">or try an example</span>
                            <div className="flex gap-2">
                                {[
                                    { file: 'walls.ifc',              label: 'Walls',    ext: 'IFC' },
                                    { file: 'AC20-Institute-Var-2.ifc', label: 'Office Building', ext: 'IFC' },
                                    { file: 'Monkey.las',             label: 'Monkey',   ext: 'LAS' },
                                ].map(({ file, label, ext }) => (
                                    <button
                                        key={file}
                                        onClick={() => loadExample(file)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-600 cursor-pointer transition-colors shadow-sm"
                                    >
                                        {label}
                                        <span className="text-[0.6rem] px-1 py-0.5 rounded bg-slate-100 text-slate-400 uppercase">{ext}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Loading overlay */}
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-40 pointer-events-none gap-4">
                        <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-accent animate-spin" />
                        <span className="text-sm text-slate-500 bg-white/80 px-3 py-1 rounded-full">{status}</span>
                    </div>
                )}

                {/* Controls hint */}
                <div className="absolute bottom-4 left-4 text-[0.7rem] text-slate-400 leading-relaxed z-20 pointer-events-none">
                    🖱 Left drag: orbit &nbsp;·&nbsp; Right drag: pan &nbsp;·&nbsp; Scroll: zoom<br/>
                    📱 One finger: orbit &nbsp;·&nbsp; Two fingers: pan / pinch-zoom
                </div>
            </div>
        </>
    );
}
