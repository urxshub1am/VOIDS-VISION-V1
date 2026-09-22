import { HOLO_TOOLS, Spatial3DModel, holoName, isHoloTool } from "./spatial3DModel.js";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
const GLTF_LOADER_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";
const OBJ_LOADER_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js";
const STL_LOADER_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/STLLoader.js";
const FBX_LOADER_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/FBXLoader.js";
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const noop = () => {};
const shortestDeg = (from, to) => {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
};
const MODULE_LOAD_TIMEOUT_MS = 12000;
const FREE_CONTROL_WIDTH = 1000;
const FREE_CONTROL_HEIGHT = 750;
const FREE_CONTROL_MIN_SEPARATION = 56;
const SPATIAL_CONTROL_GRACE_MS = 600;
const SPATIAL_RECOVERY_MS = 620;
const CONTROL_FILTER_GAP_MS = 360;
const importWithTimeout = (url, label) => new Promise((resolve, reject) => {
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`${label} loading timed out. Check internet/CDN access; Canvas fallback remains available.`)); } }, MODULE_LOAD_TIMEOUT_MS);
  import(url).then(value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } }, error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
});

// Small projected geometry fallback. It keeps the 3D workspace functional if WebGL or
// the pinned Three.js module cannot load, while the preferred renderer is real WebGL.
function rotatePoint(p, r) {
  let { x, y, z } = p;
  const cx = Math.cos(r.x * DEG), sx = Math.sin(r.x * DEG);
  const cy = Math.cos(r.y * DEG), sy = Math.sin(r.y * DEG);
  const cz = Math.cos(r.z * DEG), sz = Math.sin(r.z * DEG);
  let y1 = y * cx - z * sx, z1 = y * sx + z * cx; y = y1; z = z1;
  let x1 = x * cy + z * sy; z1 = -x * sy + z * cy; x = x1; z = z1;
  x1 = x * cz - y * sz; y1 = x * sz + y * cz;
  return { x: x1, y: y1, z };
}
function transformPoint(p, object) {
  const q = rotatePoint({ x: p.x * object.scale.x, y: p.y * object.scale.y, z: p.z * object.scale.z }, object.rotation);
  return { x: q.x + object.position.x, y: q.y + object.position.y, z: q.z + object.position.z };
}
function cubeGeometry() {
  const v = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([x,y,z])=>({x,y,z}));
  return { vertices:v, edges:[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]], faces:[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]] };
}
function pyramidGeometry() {
  const v=[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[0,1,0]].map(([x,y,z])=>({x,y,z}));
  return { vertices:v, edges:[[0,1],[1,2],[2,3],[3,0],[0,4],[1,4],[2,4],[3,4]], faces:[[0,1,2,3],[0,1,4],[1,2,4],[2,3,4],[3,0,4]] };
}
function panelGeometry() {
  const vertices=[], edges=[], faces=[];
  for (let layer=0; layer<4; layer++) {
    const z=(layer-1.5)*0.42, base=vertices.length;
    vertices.push({x:-1.35,y:-0.78,z},{x:1.35,y:-0.78,z},{x:1.35,y:0.78,z},{x:-1.35,y:0.78,z});
    edges.push([base,base+1],[base+1,base+2],[base+2,base+3],[base+3,base]); faces.push([base,base+1,base+2,base+3]);
  }
  return {vertices,edges,faces};
}
function loopsToGeometry(loops) {
  const vertices=[], edges=[];
  for (const loop of loops) {
    const base=vertices.length; loop.forEach(p=>vertices.push(p));
    for (let i=0;i<loop.length;i++) edges.push([base+i,base+(i+1)%loop.length]);
  }
  return {vertices,edges,faces:[]};
}
function sphereGeometry(detail=12, latitudes=5) {
  const loops=[];
  for (let li=1;li<=latitudes;li++) {
    const phi=-Math.PI/2 + li*Math.PI/(latitudes+1), c=Math.cos(phi), s=Math.sin(phi), loop=[];
    for(let i=0;i<detail;i++){const a=i*2*Math.PI/detail;loop.push({x:c*Math.cos(a),y:s,z:c*Math.sin(a)});} loops.push(loop);
  }
  for(let lon=0;lon<6;lon++){
    const a=lon*Math.PI/6, loop=[];
    for(let i=0;i<detail;i++){const phi=-Math.PI/2+i*Math.PI*2/detail;loop.push({x:Math.cos(phi)*Math.cos(a),y:Math.sin(phi),z:Math.cos(phi)*Math.sin(a)});} loops.push(loop);
  }
  return loopsToGeometry(loops);
}
function ringGeometry(major=1.15, minor=.34, seg=20, tube=6) {
  const loops=[];
  for(let j=0;j<tube;j++){
    const b=j*2*Math.PI/tube, loop=[];
    for(let i=0;i<seg;i++){const a=i*2*Math.PI/seg,r=major+minor*Math.cos(b);loop.push({x:r*Math.cos(a),y:r*Math.sin(a),z:minor*Math.sin(b)});} loops.push(loop);
  }
  for(let i=0;i<seg;i+=4){
    const a=i*2*Math.PI/seg,loop=[];
    for(let j=0;j<tube;j++){const b=j*2*Math.PI/tube,r=major+minor*Math.cos(b);loop.push({x:r*Math.cos(a),y:r*Math.sin(a),z:minor*Math.sin(b)});} loops.push(loop);
  }
  return loopsToGeometry(loops);
}
function cylinderGeometry(seg=16) {
  const vertices=[], edges=[], faces=[];
  for (const y of [-1,1]) {
    const base=vertices.length;
    for(let i=0;i<seg;i++){const a=i*2*Math.PI/seg;vertices.push({x:Math.cos(a),y,z:Math.sin(a)});}
    for(let i=0;i<seg;i++)edges.push([base+i,base+(i+1)%seg]);
    faces.push(Array.from({length:seg},(_,i)=>base+i));
  }
  for(let i=0;i<seg;i+=2)edges.push([i,seg+i]);
  return {vertices,edges,faces};
}
function diamondGeometry() {
  const vertices=[{x:0,y:1.35,z:0},{x:0,y:-1.35,z:0},{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}];
  const edges=[]; for(const pole of [0,1])for(const equator of [2,4,3,5])edges.push([pole,equator]);
  return {vertices,edges,faces:[[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,4,2],[1,3,4],[1,5,3],[1,2,5]]};
}
const FALLBACK_GEOMETRIES = {
  "holo-cube": cubeGeometry(), "holo-pyramid": pyramidGeometry(), "holo-panels": panelGeometry(),
  "holo-orb": sphereGeometry(14,4), "holo-globe": sphereGeometry(18,7), "holo-ring": ringGeometry(),
  "holo-cylinder": cylinderGeometry(), "holo-diamond": diamondGeometry(), "holo-knot": ringGeometry(1.05,.25,24,6),
  "holo-beacon": pyramidGeometry(), "holo-image": panelGeometry(), "holo-model": cubeGeometry()
};

export function createSpatial3D({ state, spatialModel, action, interaction, ui, notify = noop }) {
  const model = new Spatial3DModel(spatialModel);
  const overlay = ui.element("spatial-3d-canvas") || { width: 1, height: 1, hidden: true, style: {}, getContext: () => null };
  const board = ui.element("spatial-board") || ui.element("spatial-surface");
  const overlayCtx = overlay.getContext?.("2d", { alpha: true, desynchronized: true }) || {
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    fill: noop, stroke: noop, arc: noop, fillRect: noop, fillText: noop, save: noop, restore: noop,
    setLineDash: noop, strokeRect: noop, lineCap: "round", lineJoin: "round", strokeStyle: "", fillStyle: "", lineWidth: 1, font: "", textAlign: "center"
  };
  const diagnostic = state.runtime.modeData.spatial3D = {
    active:false, selectedId:null, objectCount:0, anchorHandId:null, manipulatorHandId:null,
    phase:"IDLE", rayHit:false, rayObjectId:null, rayPoint:null, scaleRatio:1, yaw:0, pitch:0, roll:0,
    transformIntent:"NONE", scaleEvidence:0, rotateEvidence:0, trackingGuard:"READY",
    renderFps:0, quality:"FULL", backend:"LOADING", webglReady:false, lastReason:null, error:null
  };

  let active=false, cssWidth=1, cssHeight=1, dpr=1, dirty=true, lastRender=0, frameCount=0, fpsStart=0, lastSelectionBoundsAt=0, lastSelectionBoundsId=null;
  let anchor=null, manipulator=null, manipulatorArming=null, blockedManipulator=null;
  let mouseAnchor=false, hoverId=null, lastHoverProbe="";
  const controlFilters = new Map();

  // WebGL renderer state. Three.js is lazy-loaded only when Spatial/Holo is entered.
  let THREE=null, webglCanvas=null, renderer=null, scene=null, camera3D=null, raycaster=null, ndc=null;
  let threeLoading=null, gltfLoaderPromise=null, GLTFLoaderClass=null, backend="FALLBACK", sceneDirty=true, qualityKey="";
  const formatLoaderPromises = new Map(), formatLoaderClasses = new Map();
  let disposed=false;
  const nodes = new Map();
  const shared = new Map();
  let selectionBox=null, selectionBounds=null;
  let starField=null, starGeometry=null, starMaterial=null;
  let cameraFocus={x:0,y:0,z:0};

  function quality() {
    const protectedMode = state.settings.visualEffects === "reduced" ||
      (state.settings.autoPerformanceMode && state.performance.effectsReduced);
    if (protectedMode) return "REDUCED";
    const requested = state.settings.holoQuality || "auto";
    if (requested === "performance") return "PERFORMANCE";
    if (requested === "balanced") return "BALANCED";
    if (requested === "visual") return "VISUAL";
    return "FULL";
  }
  function reduced() { return ["REDUCED", "PERFORMANCE"].includes(quality()); }
  function idleAllowed() {
    const trackingFps = state.performance.fps;
    // Idle 3D animation is decoration. Disable it immediately when hand
    // inference is struggling instead of waiting for the global reducer timer.
    return !reduced() && !(Number.isFinite(trackingFps) && trackingFps < 18);
  }
  function desiredDpr() {
    const trackingFps = state.performance.fps;
    if (Number.isFinite(trackingFps) && trackingFps < 10) return Math.min(window.devicePixelRatio || 1, 0.58);
    if (Number.isFinite(trackingFps) && trackingFps < 14) return Math.min(window.devicePixelRatio || 1, 0.7);
    const cap = ({ REDUCED: 0.78, PERFORMANCE: 0.82, BALANCED: 1.0, VISUAL: 1.25, FULL: 1.25 })[quality()] || 1;
    return Math.min(window.devicePixelRatio || 1, cap);
  }
  function renderCadence() {
    const trackingFps = state.performance.fps;
    // V1.5.3 protected inference by dropping the 3D layer as low as 6 FPS.
    // That helped stability but made transforms visibly step. V1.5.4 removes
    // expensive per-frame material work, so we can resample visual motion at a
    // modestly higher cadence without restoring decorative idle animation.
    const manipulating = Boolean(anchor || manipulator || manipulatorArming);
    if (Number.isFinite(trackingFps) && trackingFps < 10) return 1000/(manipulating ? 12 : 9);
    if (Number.isFinite(trackingFps) && trackingFps < 14) return 1000/(manipulating ? 15 : 11);
    if (Number.isFinite(trackingFps) && trackingFps < 18) return 1000/(manipulating ? 18 : 14);
    const mode = quality();
    if (mode === "REDUCED" || mode === "PERFORMANCE") return 1000/(manipulating ? 20 : 14);
    if (mode === "BALANCED") return 1000/20;
    return 1000/24;
  }

  function ensureWebglCanvas() {
    if (!board?.insertBefore || webglCanvas) return webglCanvas;
    webglCanvas = document.createElement("canvas");
    webglCanvas.id = "spatial-3d-webgl";
    webglCanvas.setAttribute("aria-hidden", "true");
    webglCanvas.hidden = !active;
    webglCanvas.addEventListener("webglcontextlost", onContextLost, false);
    webglCanvas.addEventListener("webglcontextrestored", onContextRestored, false);
    board.insertBefore(webglCanvas, overlay);
    return webglCanvas;
  }

  function fallBackFromWebGL(error, reason = "WEBGL RUNTIME FAILURE") {
    const message = String(error?.message || error || reason);
    diagnostic.error = message;
    diagnostic.webglReady = false;
    diagnostic.backend = "CANVAS FALLBACK";
    diagnostic.lastReason = reason;
    backend = "FALLBACK";
    try { renderer?.dispose?.(); } catch { /* Runtime recovery must stay safe. */ }
    for (const id of [...nodes.keys()]) disposeNode(id);
    try { selectionBox?.geometry?.dispose?.(); selectionBox?.material?.dispose?.(); } catch { /* Runtime recovery only. */ }
    selectionBox = null; selectionBounds = null;
    try { starGeometry?.dispose?.(); starMaterial?.dispose?.(); } catch { /* Ambient cleanup only. */ }
    starField = null; starGeometry = null; starMaterial = null;
    renderer = null; scene = null; camera3D = null; raycaster = null; ndc = null;
    qualityKey = ""; sceneDirty = true; dirty = true;
    if (webglCanvas) webglCanvas.hidden = true;
    action(`3D ${reason} · CANVAS FALLBACK ACTIVE`);
    console.warn("[VOIDS VISION] Spatial 3D switched to Canvas fallback", error);
    return null;
  }

  function safeWebGLRender(now = performance.now()) {
    if (backend !== "WEBGL" || !renderer || !scene || !camera3D) return false;
    try {
      syncScene(now);
      renderer.render(scene, camera3D);
      sceneDirty = false;
      drawOverlay();
      return true;
    } catch (error) {
      fallBackFromWebGL(error, "WEBGL RENDER RECOVERY");
      return false;
    }
  }

  function applyCameraFocus() {
    if (!camera3D) return;
    camera3D.position.set(cameraFocus.x, cameraFocus.y, cameraFocus.z + 8.8);
    camera3D.lookAt(cameraFocus.x, cameraFocus.y, cameraFocus.z);
    camera3D.updateMatrixWorld?.();
  }

  function loadThree() {
    if (THREE && renderer && scene && camera3D) return Promise.resolve(THREE);
    if (threeLoading) return threeLoading;
    if (typeof window === "undefined" || disposed) return Promise.resolve(null);
    diagnostic.backend = "LOADING";
    threeLoading = importWithTimeout(THREE_URL, "Three.js").then(module => {
      if (disposed) return null;
      THREE = module;
      const canvas = ensureWebglCanvas();
      renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:true, powerPreference:"high-performance", preserveDrawingBuffer:false });
      renderer.setClearColor(0x000000, 0);
      renderer.sortObjects = true;
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xbfefff, 0x07101a, 1.6));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.15); keyLight.position.set(3.5, 5, 6); scene.add(keyLight);
      camera3D = new THREE.PerspectiveCamera(50, 1, 0.1, 30);
      applyCameraFocus();
      raycaster = new THREE.Raycaster();
      raycaster.params.Line.threshold = 0.12;
      ndc = new THREE.Vector2();
      selectionBounds = new THREE.Box3();
      selectionBox = new THREE.Box3Helper(selectionBounds, 0x8ff0ff);
      selectionBox.visible = false;
      selectionBox.material.transparent = true;
      selectionBox.material.opacity = 0.75;
      selectionBox.material.depthTest = false;
      scene.add(selectionBox);
      const starPositions = [];
      for (let i = 0; i < 84; i++) starPositions.push((Math.random()-.5)*13, (Math.random()-.5)*8, -1.2-Math.random()*4.8);
      starGeometry = new THREE.BufferGeometry();
      starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
      starMaterial = new THREE.PointsMaterial({ color:0xbcefff, size:.026, transparent:true, opacity:.22, depthWrite:false, blending:THREE.AdditiveBlending });
      starField = new THREE.Points(starGeometry, starMaterial);
      starField.frustumCulled = false; scene.add(starField);
      backend = "WEBGL";
      diagnostic.backend = "WEBGL";
      diagnostic.webglReady = true;
      diagnostic.error = null;
      resize(true);
      sceneDirty = true; dirty = true;
      action("3D WEBGL LAYER READY");
      return THREE;
    }).catch(error => {
      if (disposed) return null;
      try { renderer?.dispose?.(); } catch { /* Canvas fallback remains available. */ }
      try { selectionBox?.geometry?.dispose?.(); selectionBox?.material?.dispose?.(); } catch { /* Partial init only. */ }
      for (const resources of shared.values()) for (const resource of resources) {
        try { resource?.dispose?.(); } catch { /* Partial init cleanup only. */ }
      }
      renderer = null; scene = null; camera3D = null; raycaster = null; ndc = null;
      selectionBox = null; selectionBounds = null; nodes.clear(); shared.clear(); THREE = null; threeLoading = null;
      backend = "FALLBACK";
      diagnostic.backend = "CANVAS FALLBACK";
      diagnostic.webglReady = false;
      diagnostic.error = String(error?.message || error || "Three.js unavailable");
      if (webglCanvas) webglCanvas.hidden = true;
      action("3D WEBGL UNAVAILABLE · CANVAS FALLBACK ACTIVE");
      return null;
    }).finally(() => { threeLoading = null; });
    return threeLoading;
  }

  function resize(force=false) {
    const rect=board?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return false;
    const changed = force || Math.abs(cssWidth-rect.width)>.5 || Math.abs(cssHeight-rect.height)>.5;
    cssWidth=rect.width; cssHeight=rect.height;
    const nextDpr=desiredDpr();
    const w=Math.max(1,Math.round(cssWidth*nextDpr)), h=Math.max(1,Math.round(cssHeight*nextDpr));
    if (overlay.width!==w || overlay.height!==h || dpr!==nextDpr) {
      overlay.width=w; overlay.height=h; dpr=nextDpr; overlay.style.width=cssWidth+"px"; overlay.style.height=cssHeight+"px"; dirty=true;
    }
    if (renderer && camera3D) {
      const key=`${Math.round(cssWidth)}:${Math.round(cssHeight)}:${nextDpr.toFixed(2)}:${quality()}`;
      if (force || changed || key!==qualityKey) {
        renderer.setPixelRatio(nextDpr);
        renderer.setSize(cssWidth, cssHeight, false);
        camera3D.aspect=cssWidth/Math.max(1,cssHeight);
        camera3D.updateProjectionMatrix();
        qualityKey=key; sceneDirty=true; dirty=true;
      }
    }
    return true;
  }

  // Exact ray-to-Z-plane mapping when WebGL is ready; matching manual projection otherwise.
  function fallbackCamera() { return { x:cameraFocus.x, y:cameraFocus.y, z:cameraFocus.z+8.8, focal:Math.min(cssWidth,cssHeight)*1.08 }; }
  function fallbackProject(world) {
    const cam=fallbackCamera(), depth=Math.max(2.2,cam.z-world.z), k=cam.focal/depth;
    return {x:cssWidth/2+(world.x-cam.x)*k,y:cssHeight/2-(world.y-cam.y)*k,z:world.z,k};
  }
  function fallbackScreenToPlane(point,z=0) {
    const rect=board?.getBoundingClientRect?.(); if(!rect)return{x:cameraFocus.x,y:cameraFocus.y,z};
    const cam=fallbackCamera(), x=point.x-rect.left-cssWidth/2, y=point.y-rect.top-cssHeight/2, depth=cam.z-z, k=cam.focal/depth;
    return {x:cam.x+x/k,y:cam.y-y/k,z};
  }
  function screenNdc(point) {
    const rect=board?.getBoundingClientRect?.(); if(!rect?.width||!rect?.height)return null;
    return {x:((point.x-rect.left)/rect.width)*2-1,y:-((point.y-rect.top)/rect.height)*2+1};
  }
  function setRay(point) {
    if (!THREE||!raycaster||!camera3D||!ndc)return false;
    const p=screenNdc(point); if(!p)return false;
    ndc.set(p.x,p.y); raycaster.setFromCamera(ndc,camera3D); return true;
  }
  function screenToPlane(point,z=0) {
    if (backend==="WEBGL"&&setRay(point)) {
      const dz=raycaster.ray.direction.z;
      if (Math.abs(dz)>1e-5) {
        const t=(z-raycaster.ray.origin.z)/dz;
        if (t>0) {
          const hit=raycaster.ray.at(t,new THREE.Vector3());
          return {x:hit.x,y:hit.y,z};
        }
      }
    }
    return fallbackScreenToPlane(point,z);
  }

  function material(color=0x45dbff,opacity=.075) {
    const m=new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
    return m;
  }
  function lineMaterial(color=0x45dbff,opacity=.68) {
    return new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false,blending:THREE.AdditiveBlending});
  }
  async function loadGltfSupport() {
    if (GLTFLoaderClass) return GLTFLoaderClass;
    if (gltfLoaderPromise) return gltfLoaderPromise;
    gltfLoaderPromise = importWithTimeout(GLTF_LOADER_URL, "GLTFLoader").then(module => {
      GLTFLoaderClass = module.GLTFLoader;
      if (!GLTFLoaderClass) throw new Error("GLTFLoader did not initialize.");
      return GLTFLoaderClass;
    }).catch(error => {
      gltfLoaderPromise = null;
      diagnostic.lastReason = "GLTF_LOADER_UNAVAILABLE";
      throw error;
    });
    return gltfLoaderPromise;
  }
  async function loadFormatSupport(format) {
    if (format === "glb" || format === "gltf") return loadGltfSupport();
    const urls = { obj: OBJ_LOADER_URL, stl: STL_LOADER_URL, fbx: FBX_LOADER_URL };
    const names = { obj: "OBJLoader", stl: "STLLoader", fbx: "FBXLoader" };
    if (!urls[format]) throw new Error(`Unsupported imported 3D format: ${format}.`);
    if (formatLoaderClasses.has(format)) return formatLoaderClasses.get(format);
    if (formatLoaderPromises.has(format)) return formatLoaderPromises.get(format);
    const promise = importWithTimeout(urls[format], names[format]).then(module => {
      const Loader = module[names[format]];
      if (!Loader) throw new Error(`${names[format]} did not initialize.`);
      formatLoaderClasses.set(format, Loader);
      return Loader;
    }).catch(error => { formatLoaderPromises.delete(format); throw error; });
    formatLoaderPromises.set(format, promise);
    return promise;
  }
  function disposeDetachedModelTree(root) {
    if (!root?.traverse) return;
    const disposed = new Set();
    const disposeOnce = resource => {
      if (!resource || disposed.has(resource)) return;
      disposed.add(resource);
      try { resource.dispose?.(); } catch { /* Detached loader cleanup only. */ }
    };
    root.traverse(child => {
      disposeOnce(child?.geometry);
      const materials = Array.isArray(child?.material) ? child.material : (child?.material ? [child.material] : []);
      for (const mat of materials) {
        for (const value of Object.values(mat || {})) if (value?.isTexture) disposeOnce(value);
        disposeOnce(mat);
      }
    });
  }
  function assetResourceMap(asset) {
    const map = new Map();
    for (const resource of asset?.resources || []) {
      const clean = String(resource.name || "").replace(/\\/g, "/").replace(/^\.\//, "");
      const base = clean.split("/").pop();
      if (clean) map.set(clean.toLowerCase(), resource.dataUrl);
      if (base && !map.has(base.toLowerCase())) map.set(base.toLowerCase(), resource.dataUrl);
    }
    return map;
  }
  async function hydrateImportedModel(object, group) {
    const asset = model.getAsset(object.model?.assetId);
    if (!asset) { group.userData.modelStatus = "MISSING ASSET"; diagnostic.lastReason = `MODEL_ASSET_MISSING:${object.id}`; return; }
    const token = `${object.id}:${object.model?.assetId}:${performance.now()}`;
    group.userData.modelLoadToken = token; group.userData.modelStatus = "LOADING";
    try {
      const format = asset.format || object.model?.format || "glb";
      const Loader = await loadFormatSupport(format);
      if (!THREE || nodes.get(object.id) !== group || group.userData.modelLoadToken !== token) return;
      const manager = new THREE.LoadingManager(), resourceMap = assetResourceMap(asset);
      manager.setURLModifier(url => {
        if (/^(?:data:|blob:)/i.test(url)) return url;
        const clean = decodeURIComponent(String(url).split(/[?#]/)[0]).replace(/\\/g, "/").replace(/^\.\//, "");
        const base = clean.split("/").pop()?.toLowerCase();
        return resourceMap.get(clean.toLowerCase()) || (base ? resourceMap.get(base) : null) || url;
      });
      const loader = new Loader(manager);
      const response = await fetch(asset.root.dataUrl);
      if (!response.ok) throw new Error("Embedded model data could not be read.");
      let sceneRoot = null, clips = [];
      if (format === "glb" || format === "gltf") {
        const source = format === "glb" ? await response.arrayBuffer() : await response.text();
        const gltf = await new Promise((resolve, reject) => loader.parse(source, "", resolve, reject));
        sceneRoot = gltf.scene || gltf.scenes?.[0];
        clips = Array.isArray(gltf.animations) ? gltf.animations : [];
      } else if (format === "obj") {
        sceneRoot = loader.parse(await response.text());
      } else if (format === "stl") {
        const geometry = loader.parse(await response.arrayBuffer());
        geometry.computeVertexNormals?.();
        const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .72, metalness: .06 });
        sceneRoot = new THREE.Group(); sceneRoot.add(new THREE.Mesh(geometry, baseMaterial));
      } else if (format === "fbx") {
        sceneRoot = loader.parse(await response.arrayBuffer(), "");
        clips = Array.isArray(sceneRoot?.animations) ? sceneRoot.animations : [];
      }
      if (nodes.get(object.id) !== group || group.userData.modelLoadToken !== token) {
        // The object may have been deleted while an async loader was parsing. Dispose the
        // detached scene immediately instead of leaving its geometry/textures for GC alone.
        disposeDetachedModelTree(sceneRoot);
        return;
      }
      if (!sceneRoot) throw new Error("Model contains no renderable scene.");
      const pivot = new THREE.Group(), normalized = new THREE.Group();
      pivot.add(sceneRoot); normalized.add(pivot); group.add(normalized);
      sceneRoot.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(sceneRoot), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(maxDim) || maxDim <= 1e-6) throw new Error("Model has invalid or empty geometry bounds.");
      pivot.position.copy(center).multiplyScalar(-1);
      normalized.scale.setScalar(2.15 / maxDim);
      let meshCount = 0, triangleCount = 0;
      sceneRoot.traverse(child => {
        if (!child?.isMesh) return;
        meshCount++;
        const geometryCount = child.geometry?.index?.count ?? child.geometry?.attributes?.position?.count ?? 0;
        triangleCount += Math.floor(geometryCount / 3);
        child.userData.holoId = object.id; child.userData.importedSurface = true;
        const original = Array.isArray(child.material) ? child.material : [child.material];
        const sourceMaterials = original.filter(Boolean);
        const materials = (sourceMaterials.length ? sourceMaterials.map(mat => mat.clone()) : [new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .72, metalness: .06 })]).map(clone => {
          clone.transparent = true; clone.depthWrite = false;
          clone.userData.holoBaseOpacity = Number.isFinite(clone.opacity) ? clone.opacity : 1;
          clone.userData.holoBaseColor = clone.color?.clone?.() || null;
          if (clone.emissive?.clone) clone.userData.holoBaseEmissive = clone.emissive.clone();
          const textures = [];
          for (const value of Object.values(clone)) if (value?.isTexture && !textures.includes(value)) textures.push(value);
          remember(object.id, clone, textures);
          return clone;
        });
        child.material = Array.isArray(child.material) ? materials : materials[0];
        remember(object.id, child.geometry);
      });
      if (!meshCount) throw new Error("Model contains no mesh geometry.");
      for (const placeholder of group.children.filter(child => child.userData?.modelPlaceholder)) group.remove(placeholder);
      object.model.animations = clips.length;
      if (clips.length) {
        // Auto-play one clip only. Playing Idle/Walk/Run together creates invalid blended motion on many assets.
        const clip = clips.find(candidate => Array.isArray(candidate?.tracks) && candidate.tracks.length) || clips[0];
        if (clip) {
          const mixer = new THREE.AnimationMixer(sceneRoot);
          mixer.clipAction(clip).play();
          group.userData.mixer = mixer; group.userData.mixerAt = performance.now();
          group.userData.activeAnimation = clip.name || "Animation 1";
        }
      }
      group.userData.modelStatus = "READY"; group.userData.modelMeshes = meshCount; group.userData.geometryStats = { meshes: meshCount, triangles: triangleCount };
      diagnostic.lastReason = `MODEL_READY:${object.id}:${meshCount}`;
      model.model.changed(); sceneDirty = true; dirty = true;
      if (active) render(performance.now(), true);
    } catch (error) {
      if (nodes.get(object.id) !== group) return;
      group.userData.modelStatus = "ERROR"; group.userData.modelError = String(error?.message || error || "Model load failed");
      diagnostic.lastReason = `MODEL_ERROR:${object.id}`; diagnostic.error = group.userData.modelError;
      action(`3D MODEL LOAD FAILED → ${object.model?.name || object.id}`);
      notify(`Could not render ${object.model?.name || "the imported 3D model"}: ${group.userData.modelError}`, "warning");
      console.warn("[VOIDS VISION] Imported 3D model failed to load", error);
      sceneDirty = true; dirty = true;
    }
  }
  function remember(id,...resources) {
    const list=shared.get(id)||[]; for(const resource of resources.flat()) if(resource&&!list.includes(resource))list.push(resource); shared.set(id,list);
  }
  function makeNode(object) {
    const group=new THREE.Group();
    group.userData.holoId=object.id;
    group.userData.displayTransform={
      position:{...object.position}, rotation:{...object.rotation}, scale:{...object.scale}, at:performance.now()
    };
    group.userData.visualKey="";
    const meshParts=[];
    const tint=object.color||"#45dbff";
    const addMesh=(geometry,{faceOpacity=.055,edgeOpacity=.68,wireframe=false,z=0,color=tint}={})=>{
      const face=material(color,faceOpacity); face.wireframe=wireframe;
      const mesh=new THREE.Mesh(geometry,face); mesh.position.z=z; mesh.userData.holoId=object.id; mesh.userData.baseOpacity=faceOpacity; mesh.userData.holoTint=true; mesh.userData.holoRole="face"; meshParts.push(mesh); group.add(mesh);
      const edgeGeo=new THREE.EdgesGeometry(geometry,22); const edges=new THREE.LineSegments(edgeGeo,lineMaterial(color,edgeOpacity)); edges.position.z=z; edges.userData.holoId=object.id; edges.userData.baseOpacity=edgeOpacity; edges.userData.holoTint=true; edges.userData.holoRole="edge"; group.add(edges);
      remember(object.id,geometry,face,edgeGeo,edges.material);
      return mesh;
    };
    const addAccent=(geometry,{opacity=.32,color=tint,rotation=null,z=0}={})=>{
      const mat=material(color,opacity), mesh=new THREE.Mesh(geometry,mat); mesh.position.z=z; if(rotation)mesh.rotation.set(...rotation);
      mesh.userData.holoId=object.id; mesh.userData.baseOpacity=opacity; mesh.userData.holoTint=true; mesh.userData.holoRole="accent"; group.add(mesh); remember(object.id,geometry,mat); return mesh;
    };
    if(object.type==="holo-cube") addMesh(new THREE.BoxGeometry(2,2,2),{faceOpacity:.055});
    else if(object.type==="holo-pyramid") addMesh(new THREE.ConeGeometry(1.15,2.1,4,1,false),{faceOpacity:.055});
    else if(object.type==="holo-cylinder") addMesh(new THREE.CylinderGeometry(.92,.92,2.05,14,1,false),{faceOpacity:.045,edgeOpacity:.72});
    else if(object.type==="holo-diamond") addMesh(new THREE.OctahedronGeometry(1.18,0),{faceOpacity:.045,edgeOpacity:.76});
    else if(object.type==="holo-knot") addMesh(new THREE.TorusKnotGeometry(.82,.23,48,8,2,3),{faceOpacity:.026,edgeOpacity:.66});
    else if(object.type==="holo-beacon") {
      addMesh(new THREE.ConeGeometry(.8,1.65,8,1,false),{faceOpacity:.035,edgeOpacity:.72});
      addAccent(new THREE.TorusGeometry(.92,.025,4,32),{opacity:.35,rotation:[Math.PI/2,0,0],z:-.65});
      addAccent(new THREE.TorusGeometry(1.18,.018,4,36),{opacity:.2,rotation:[Math.PI/2,0,0],z:-.72});
    }
    else if(object.type==="holo-ring") addMesh(new THREE.TorusGeometry(1.25,.27,8,28),{faceOpacity:.04,edgeOpacity:.8});
    else if(object.type==="holo-globe") {
      addMesh(new THREE.SphereGeometry(1.12,14,9),{faceOpacity:.018,edgeOpacity:.62,wireframe:true});
      addAccent(new THREE.TorusGeometry(1.13,.016,4,42),{opacity:.32});
    } else if(object.type==="holo-orb") {
      addMesh(new THREE.IcosahedronGeometry(1.02,1),{faceOpacity:.04,edgeOpacity:.74});
      addAccent(new THREE.IcosahedronGeometry(.18,1),{opacity:.55,color:"#c7fbff"});
      for(const rotation of [[Math.PI/2,0,0],[0,Math.PI/2,0]]) addAccent(new THREE.TorusGeometry(1.28,.018,4,40),{opacity:.34,rotation});
    } else if(object.type==="holo-model") {
      const start=group.children.length, geometry=new THREE.BoxGeometry(1.7,1.7,1.7);
      addMesh(geometry,{faceOpacity:.025,edgeOpacity:.72});
      for(const child of group.children.slice(start)) child.userData.modelPlaceholder=true;
      group.userData.modelStatus="QUEUED";
    } else if(object.type==="holo-image") {
      const aspect=clamp(Number(object.image?.aspect)||1.6,.35,3.5), height=1.65, width=height*aspect;
      const geometry=new THREE.PlaneGeometry(width,height);
      const texture=new THREE.TextureLoader().load(object.image?.dataUrl||"", loaded=>{
        if (THREE?.SRGBColorSpace) loaded.colorSpace=THREE.SRGBColorSpace;
        sceneDirty=true; dirty=true; if(active) render(performance.now(),true);
      }, undefined, ()=>{ diagnostic.lastReason=`IMAGE_TEXTURE:${object.id}`; });
      if (THREE?.SRGBColorSpace) texture.colorSpace=THREE.SRGBColorSpace;
      const imageMat=new THREE.MeshBasicMaterial({map:texture,color:0xffffff,transparent:true,opacity:object.opacity??.92,depthWrite:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,imageMat); mesh.userData.holoId=object.id; mesh.userData.imageSurface=true; mesh.userData.baseOpacity=object.opacity??.92; group.add(mesh);
      const edgeGeo=new THREE.EdgesGeometry(geometry); const edges=new THREE.LineSegments(edgeGeo,lineMaterial(tint,.92)); edges.userData.holoId=object.id; edges.userData.baseOpacity=.92; edges.userData.holoTint=true; edges.userData.holoRole="edge"; group.add(edges);
      const haloGeo=new THREE.PlaneGeometry(width*1.045,height*1.075), haloMat=material(tint,.045); const halo=new THREE.Mesh(haloGeo,haloMat); halo.position.z=-.025; halo.userData.holoId=object.id; halo.userData.baseOpacity=.045; halo.userData.holoTint=true; halo.userData.holoRole="halo"; group.add(halo);
      remember(object.id,geometry,texture,imageMat,edgeGeo,edges.material,haloGeo,haloMat);
    } else {
      for(let i=0;i<4;i++) addMesh(new THREE.BoxGeometry(2.7,1.5,.06),{faceOpacity:.038,edgeOpacity:.68,z:(i-1.5)*.32});
    }
    group.userData.meshParts=meshParts;
    nodes.set(object.id,group); scene.add(group);
    if(object.type==="holo-model") void hydrateImportedModel(object,group);
    return group;
  }
  function disposeNode(id) {
    const node=nodes.get(id); if(node?.userData?.mixer){try{node.userData.mixer.stopAllAction();node.userData.mixer.uncacheRoot?.(node);}catch{}}
    if(node&&scene)scene.remove(node);
    for(const resource of shared.get(id)||[])resource.dispose?.();
    shared.delete(id); nodes.delete(id);
  }
  function syncScene(now=performance.now()) {
    if(!scene||!THREE)return;
    const ids=new Set();
    for(const object of model.objects){
      ids.add(object.id); let node=nodes.get(object.id)||makeNode(object);
      const selected=object.id===model.state.selected3DId, hovered=object.id===hoverId;
      node.visible=object.visible!==false;

      // Display-only transform resampling. Model state remains authoritative and
      // is still committed only on real tracking samples, but WebGL nodes ease
      // between those samples so a 10–15 FPS webcam does not make objects step.
      let display=node.userData.displayTransform;
      if(!display){display=node.userData.displayTransform={position:{...object.position},rotation:{...object.rotation},scale:{...object.scale},at:now};}
      const dtMs=clamp(now-(display.at||now),0,120), activeObject=anchor?.objectId===object.id&&!anchor?.mouse;
      // Only live hand manipulation is resampled. Button/keyboard edits should
      // land exactly on their committed transform in a single render.
      const tau=42, a=activeObject&&dtMs>0?1-Math.exp(-dtMs/tau):1;
      for(const axis of ["x","y","z"]){
        display.position[axis]+= (object.position[axis]-display.position[axis])*a;
        display.scale[axis]+= (object.scale[axis]-display.scale[axis])*a;
        display.rotation[axis]+= shortestDeg(display.rotation[axis],object.rotation[axis])*a;
      }
      display.at=now;
      node.position.set(display.position.x,display.position.y,display.position.z);
      const idle=!selected&&!anchor&&idleAllowed()&&["holo-orb","holo-globe","holo-ring","holo-knot","holo-beacon"].includes(object.type);
      const idleYaw=idle?Math.sin(now/2200+object.idlePhase)*4:0;
      node.rotation.set(display.rotation.x*DEG,(display.rotation.y+idleYaw)*DEG,display.rotation.z*DEG);
      node.scale.set(display.scale.x,display.scale.y,display.scale.z);

      const glow=clamp(Number(object.glow??.7),0,1), objectOpacity=clamp(Number(object.opacity??.82),.15,1), tint=object.color||"#45dbff";
      // Imported models may contain hundreds of materials. V1.5.3 traversed the
      // whole hierarchy on every pointer movement. Re-style only when a visual
      // property / selected / hover state actually changes.
      const visualKey=[selected?1:0,hovered?1:0,object.visible===false?0:1,tint,glow.toFixed(3),objectOpacity.toFixed(3)].join("|");
      if(node.userData.visualKey!==visualKey){
        const tintColor=new THREE.Color(tint);
        node.traverse(child=>{
          const materials=Array.isArray(child.material)?child.material:(child.material?[child.material]:[]);
          for(const mat of materials){
            if(child.userData?.importedSurface){
              const baseColor=mat.userData?.holoBaseColor;
              if(mat.color&&baseColor?.clone)mat.color.copy(baseColor).lerp(tintColor,.18+glow*.26);
              if(mat.emissive?.set){mat.emissive.set(tint);if("emissiveIntensity" in mat)mat.emissiveIntensity=.12+glow*.6;}
              mat.opacity=clamp((mat.userData?.holoBaseOpacity??1)*objectOpacity,.08,1);
              continue;
            }
            if(child.userData?.holoTint&&mat.color?.set)mat.color.set(tint);
            if(child.userData?.imageSurface){ mat.opacity=objectOpacity; continue; }
            const isLine=child.isLineSegments, role=child.userData?.holoRole;
            const baseOpacity=child.userData?.baseOpacity ?? (isLine ? .68 : .055);
            const glowScale=role==="halo" ? (.35+glow*1.35) : (.72+glow*.42);
            const base=baseOpacity*objectOpacity*glowScale;
            mat.opacity=selected ? Math.max(base, isLine ? .96 : role==="halo"?.075:.105) : hovered ? Math.max(base, isLine ? .84 : role==="halo"?.062:.075) : base;
          }
        });
        node.userData.visualKey=visualKey;
      }
      if(node.userData?.mixer&&idleAllowed()){const last=node.userData.mixerAt||now,dt=clamp((now-last)/1000,0,.08);node.userData.mixerAt=now;node.userData.mixer.update(dt);}
    }
    if(starField){
      starField.visible=idleAllowed()&&["FULL","VISUAL","BALANCED"].includes(quality());
      if(starField.visible){starField.rotation.y=now*.000018;starField.rotation.z=Math.sin(now*.00008)*.015;}
    }
    for(const id of [...nodes.keys()])if(!ids.has(id))disposeNode(id);
    const selectedNode=model.selected?nodes.get(model.selected.id):null;
    if(selectionBox){
      selectionBox.visible=Boolean(selectedNode?.visible);
      const selectedId=model.selected?.id||null, movingSelected=Boolean(anchor&&anchor.objectId===selectedId);
      const interval=movingSelected?70:220;
      if(selectedNode?.visible&&(selectedId!==lastSelectionBoundsId||now-lastSelectionBoundsAt>=interval)){
        selectionBounds.setFromObject(selectedNode);lastSelectionBoundsAt=now;lastSelectionBoundsId=selectedId;
      }
      if(!selectedNode?.visible){lastSelectionBoundsId=null;lastSelectionBoundsAt=0;}
    }
  }

  function raycast(point,{padding=0}={}) {
    if(backend!=="WEBGL"||!setRay(point)||!nodes.size)return null;
    const targets=[]; for(const node of nodes.values())if(node.visible)targets.push(node);
    const hits=raycaster.intersectObjects(targets,true);
    if(hits.length){
      let object=hits[0].object;
      while(object&&!object.userData?.holoId)object=object.parent;
      const id=object?.userData?.holoId;
      const record=id?model.get(id):null;
      if(record){diagnostic.rayHit=true;diagnostic.rayObjectId=id;diagnostic.rayPoint={x:hits[0].point.x,y:hits[0].point.y,z:hits[0].point.z};return record;}
    }
    // Magnetic aim fallback: compare projected group centers in screen space.
    if(padding>0&&camera3D){
      const rect=board.getBoundingClientRect(), cursor={x:point.x-rect.left,y:point.y-rect.top}; let best=null,bestD=Infinity;
      const v=new THREE.Vector3();
      for(const object of model.objects){
        if(object.visible===false)continue;
        v.set(object.position.x,object.position.y,object.position.z).project(camera3D);
        const sx=(v.x*.5+.5)*rect.width, sy=(-v.y*.5+.5)*rect.height, d=Math.hypot(cursor.x-sx,cursor.y-sy);
        const radius=padding+Math.max(20,object.scale.x*42);
        if(d<radius&&d<bestD){best=object;bestD=d;}
      }
      if(best){diagnostic.rayHit=true;diagnostic.rayObjectId=best.id;diagnostic.rayPoint={...best.position};return best;}
    }
    diagnostic.rayHit=false; diagnostic.rayObjectId=null; diagnostic.rayPoint=null; return null;
  }

  function fallbackProjected(object) {
    const geo=FALLBACK_GEOMETRIES[object.type]||FALLBACK_GEOMETRIES["holo-cube"];
    return geo.vertices.map(v=>fallbackProject(transformPoint(v,object)));
  }
  function fallbackBounds(object) {
    const pts=fallbackProjected(object); if(!pts.length)return null;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    return{minX,minY,maxX,maxY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
  }
  function fallbackHitTest(point,{padding=18}={}) {
    const rect=board?.getBoundingClientRect?.(); if(!rect)return null;
    const x=point.x-rect.left,y=point.y-rect.top; let best=null,bestScore=Infinity;
    for(const object of model.objects){if(!object.visible)continue;const b=fallbackBounds(object);if(!b)continue;const p=padding+(object.type==="holo-ring"?12:0);
      if(x>=b.minX-p&&x<=b.maxX+p&&y>=b.minY-p&&y<=b.maxY+p){const score=Math.hypot(x-b.cx,y-b.cy)-object.position.z*4;if(score<bestScore){bestScore=score;best=object;}}}
    diagnostic.rayHit=Boolean(best); diagnostic.rayObjectId=best?.id||null; diagnostic.rayPoint=best?{...best.position}:null; return best;
  }
  function hitTest(point,options={}) {
    if(!active||!resize())return null;
    return backend==="WEBGL"?raycast(point,options):fallbackHitTest(point,options);
  }
  function isPointNearSelected(point,padding=38){
    const o=model.selected;if(!o||o.visible===false)return false;
    if(backend==="WEBGL"){
      const hit=raycast(point,{padding}); if(hit?.id===o.id)return true;
      if(!camera3D||!THREE)return false;
      const rect=board.getBoundingClientRect(), v=new THREE.Vector3(o.position.x,o.position.y,o.position.z).project(camera3D);
      const sx=rect.left+(v.x*.5+.5)*rect.width, sy=rect.top+(-v.y*.5+.5)*rect.height;
      return Math.hypot(point.x-sx,point.y-sy)<=padding+Math.max(28,o.scale.x*65);
    }
    const rect=board?.getBoundingClientRect?.(),b=fallbackBounds(o);if(!rect||!b)return false;
    const x=point.x-rect.left,y=point.y-rect.top;return x>=b.minX-padding&&x<=b.maxX+padding&&y>=b.minY-padding&&y<=b.maxY+padding;
  }

  function handRecord(id){return id?state.hands.find(hand=>hand.id===id)||null:null;}
  function handLive(id){
    const hand=handRecord(id);
    return Boolean(hand?.tracking?.visible&&!hand.tracking.ambiguous&&hand.tracking.state==="TRACKING");
  }
  function handControlPoint(id,now=performance.now()){
    const hand=handRecord(id), point=hand?.geometry?.viewCenter;
    if(!handLive(id)||!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
    const raw={x:clamp(point.x,-0.12,1.12)*FREE_CONTROL_WIDTH,y:clamp(point.y,-0.12,1.12)*FREE_CONTROL_HEIGHT};
    let filter=controlFilters.get(id);
    if(filter&&Number.isFinite(filter.at)&&now===filter.at)return{x:filter.x,y:filter.y};
    if(!filter||!Number.isFinite(filter.at)||now<filter.at||now-filter.at>CONTROL_FILTER_GAP_MS){
      filter={x:raw.x,y:raw.y,rawX:raw.x,rawY:raw.y,at:now};controlFilters.set(id,filter);return{x:raw.x,y:raw.y};
    }
    const dt=Math.max(0.001,(now-filter.at)/1000),speed=Math.hypot(raw.x-filter.rawX,raw.y-filter.rawY)/dt/1000;
    const activity=clamp(speed/1.15,0,1),tauMs=118-activity*70;
    const alpha=1-Math.exp(-(now-filter.at)/tauMs);
    filter.x+= (raw.x-filter.x)*alpha;filter.y+=(raw.y-filter.y)*alpha;
    filter.rawX=raw.x;filter.rawY=raw.y;filter.at=now;
    return{x:filter.x,y:filter.y};
  }
  function handRecent(id,now,grace=SPATIAL_CONTROL_GRACE_MS){
    const hand=handRecord(id), seen=hand?.tracking?.lastSeenAt;
    return Boolean(hand&&Number.isFinite(seen)&&now>=seen&&now-seen<=grace);
  }
  function controlPair(secondaryId,now=performance.now()){
    const primary=handControlPoint(anchor?.handId,now),secondary=handControlPoint(secondaryId,now);
    if(!primary||!secondary)return null;
    return {primary,secondary,separation:Math.hypot(secondary.x-primary.x,secondary.y-primary.y)};
  }

  function select(id){model.select(id);diagnostic.selectedId=model.state.selected3DId;sceneDirty=true;dirty=true;}
  function clearSelection(){model.select(null);diagnostic.selectedId=null;sceneDirty=true;dirty=true;}
  function create(type,screenPoint){const p=screenToPlane(screenPoint,0),object=model.create(type,p);if(object){action("3D OBJECT CREATED → "+type);sceneDirty=true;dirty=true;}return object;}
  function startPrimary({handId,screenPoint,now,mouse=false}){
    const object=hitTest(screenPoint,{padding:22});if(!object)return false;
    if(object.locked){select(object.id);action("3D OBJECT LOCKED → "+object.id);sceneDirty=true;dirty=true;return false;}
    const plane=screenToPlane(screenPoint,object.position.z);
    if(!mouse&&!interaction.claim(handId,"OBJECT_CAPTURE","spatial",object.id,{pending:true}))return false;
    if(!model.startAnchor(object.id,plane,screenPoint)){if(!mouse)interaction.release(handId,"TARGET_UNAVAILABLE",false);return false;}
    anchor={handId,objectId:object.id,mouse,screen:{...screenPoint},plane,startedAt:now,lastGoodAt:now,recovering:false,recoveryUntil:null,resumedAt:null};mouseAnchor=mouse;select(object.id);
    if(handId)controlFilters.delete(handId);
    diagnostic.anchorHandId=handId||"MOUSE";diagnostic.manipulatorHandId=null;diagnostic.phase="ANCHOR";diagnostic.lastReason=null;diagnostic.trackingGuard="READY";
    action("3D ANCHOR → "+(handId||"MOUSE")+" · "+object.id);sceneDirty=true;dirty=true;return true;
  }
  function moveAnchor(screenPoint){if(!anchor)return;const object=model.get(anchor.objectId);if(!object)return;anchor.screen={...screenPoint};anchor.plane=screenToPlane(screenPoint,object.position.z);model.moveAnchor(anchor.plane);sceneDirty=true;dirty=true;}
  function canJoinManipulator(screenPoint){
    // V1.5.1 free-space controller: once an object is anchored, the second hand
    // may join from anywhere in the camera/viewport. Object hit-testing is no
    // longer part of the transform join path. `screenPoint` is kept only as a
    // sanity check for the central interaction arbiter.
    return Boolean(anchor&&!manipulator&&screenPoint&&Number.isFinite(screenPoint.x)&&Number.isFinite(screenPoint.y));
  }
  function startManipulator(handId,screenPoint,now){
    if(!anchor||manipulator||handId===anchor.handId||!canJoinManipulator(screenPoint))return false;
    const pair=controlPair(handId,now);
    if(!pair)return false;
    manipulatorArming={handId,startedAt:now,samples:1,lastSeenAt:now,lastPair:pair,recovering:false,recoveryUntil:null};
    diagnostic.phase="MANIPULATOR_ARMING";
    diagnostic.lastReason=pair.separation<FREE_CONTROL_MIN_SEPARATION?"FREE HAND · SPREAD HANDS SLIGHTLY":"FREE-SPACE SECONDARY";
    dirty=true;return true;
  }
  function activateManipulator(){
    if(!anchor||!manipulatorArming)return false;
    const pair=controlPair(manipulatorArming.handId,performance.now());
    if(!pair)return false;
    if(pair.separation<FREE_CONTROL_MIN_SEPARATION){
      diagnostic.lastReason="FREE HAND · SPREAD HANDS SLIGHTLY";
      diagnostic.phase="MANIPULATOR_ARMING";dirty=true;return false;
    }
    if(!model.beginManipulator(pair.primary,pair.secondary)){manipulatorArming=null;diagnostic.phase="ANCHOR";return false;}
    manipulator={handId:manipulatorArming.handId,lastPair:pair,lastSeenAt:performance.now(),recovering:false,recoveryUntil:null};
    diagnostic.manipulatorHandId=manipulator.handId;diagnostic.phase="MANIPULATOR";
    diagnostic.transformIntent = String(state.settings.spatial3DTransformMode || "auto").toUpperCase() === "AUTO" ? "WAITING" : String(state.settings.spatial3DTransformMode || "auto").toUpperCase();
    diagnostic.scaleEvidence = diagnostic.rotateEvidence = 0;diagnostic.lastReason="FREE-SPACE MANIPULATOR";diagnostic.trackingGuard="READY";
    action("3D FREE-SPACE MANIPULATOR → "+manipulator.handId+" · "+diagnostic.transformIntent);manipulatorArming=null;sceneDirty=true;dirty=true;return true;
  }
  function updateManipulator(now){
    if(!anchor||!manipulator)return false;
    const pair=controlPair(manipulator.handId,now);if(!pair)return false;
    manipulator.lastPair=pair;manipulator.lastSeenAt=now;
    const sensitivity = ({ low: 0.78, medium: 1, high: 1.22 })[state.settings.transformSensitivity] || 1;
    const result=model.applyManipulator(pair.primary,pair.secondary,{width:FREE_CONTROL_WIDTH,height:FREE_CONTROL_HEIGHT},{
      snap:spatialModel.state.snap, sensitivity, mode:state.settings.spatial3DTransformMode || "auto", now
    });
    if(result){
      diagnostic.scaleRatio=result.scale;diagnostic.yaw=result.yaw;diagnostic.pitch=result.pitch;diagnostic.roll=result.roll;
      diagnostic.transformIntent=result.intent||"WAITING";diagnostic.scaleEvidence=result.scaleEvidence||0;diagnostic.rotateEvidence=result.rotateEvidence||0;
      sceneDirty=true;dirty=true;return true;
    }
    return false;
  }
  function releaseManipulator(reason="RELEASED",lost=false){
    if(!anchor)return false;
    if(manipulatorArming&&(!manipulator||manipulatorArming.handId===manipulator?.handId)){blockedManipulator=manipulatorArming.handId;manipulatorArming=null;}
    if(!manipulator){diagnostic.phase="ANCHOR";return false;}
    const id=manipulator.handId;blockedManipulator=id;model.endManipulator(anchor.plane);manipulator=null;diagnostic.manipulatorHandId=null;diagnostic.phase="ANCHOR";diagnostic.lastReason=reason;
    diagnostic.transformIntent="NONE";diagnostic.scaleEvidence=diagnostic.rotateEvidence=0;diagnostic.trackingGuard=lost?"SECONDARY LOST":"READY";
    action(lost?"3D MANIPULATOR LOST · ANCHOR CONTINUES":"3D MANIPULATOR RELEASED · ANCHOR CONTINUES");sceneDirty=true;dirty=true;return true;
  }
  function endPrimary(reason="RELEASED",lost=false){
    if(!anchor)return false;const old=anchor;const result=model.finishAnchor();
    if(manipulator)interaction.release(manipulator.handId,reason,false);if(!old.mouse&&old.handId)interaction.release(old.handId,reason,false);
    anchor=null;manipulator=null;manipulatorArming=null;mouseAnchor=false;diagnostic.anchorHandId=null;diagnostic.manipulatorHandId=null;diagnostic.phase=lost?"LOST":"IDLE";diagnostic.lastReason=reason;
    diagnostic.transformIntent="NONE";diagnostic.scaleEvidence=diagnostic.rotateEvidence=0;diagnostic.trackingGuard=lost?"ANCHOR LOST":"READY";
    action((lost?"3D ANCHOR LOST → ":"3D OBJECT DROP → ")+old.objectId+(result?.changed?" · one edit committed":" · unchanged"));sceneDirty=true;dirty=true;return true;
  }
  function activeControl(){return{anchorHandId:anchor?.handId||null,manipulatorHandId:manipulator?.handId||manipulatorArming?.handId||null};}
  function update({cursors,now}){
    if(!anchor||anchor.mouse)return;
    const primary=cursors.primary,anchorHand=handRecord(anchor.handId);
    const anchorLive=handLive(anchor.handId)&&primary.visible&&primary.handId===anchor.handId;

    if(!anchorLive){
      if(handRecent(anchor.handId,now)){
        if(!anchor.recovering){anchor.recovering=true;anchor.recoveryUntil=now+SPATIAL_RECOVERY_MS;diagnostic.trackingGuard="ANCHOR REACQUIRING";diagnostic.phase="ANCHOR_RECOVERY";}
        // The transform baseline also depends on the Anchor palm. Even if the
        // Manipulator stayed perfectly visible, it must rebase after the Anchor
        // gap or the pair geometry can jump on resume.
        if(manipulator&&!manipulator.recovering){manipulator.recovering=true;manipulator.recoveryUntil=now+SPATIAL_RECOVERY_MS;}
        return; // Freeze ALL spatial motion until the anchor is trustworthy again.
      }
      endPrimary("ANCHOR_LOST",true);return;
    }

    if(anchor.recovering){
      if(anchorHand?.interactionPinch?.releasedThisFrame){endPrimary("ANCHOR_RELEASED_DURING_GAP");return;}
      if(!anchorHand?.interactionPinch?.surfaceReady){
        if(now>(anchor.recoveryUntil||0)){endPrimary("ANCHOR_RECOVERY_TIMEOUT",true);}
        return;
      }
      const object=model.get(anchor.objectId),plane=object?screenToPlane(primary.position,object.position.z):null;
      if(!plane||!model.rebaseAnchor(plane)){endPrimary("ANCHOR_REBASE_FAILED",true);return;}
      anchor.plane=plane;anchor.screen={...primary.position};anchor.recovering=false;anchor.recoveryUntil=null;anchor.lastGoodAt=now;anchor.resumedAt=now;
      diagnostic.trackingGuard="ANCHOR RESUMED";diagnostic.phase=manipulator?"MANIPULATOR":"ANCHOR";sceneDirty=true;dirty=true;
    }else{
      anchor.lastGoodAt=now;moveAnchor(primary.position);
      if(anchor.resumedAt!==null&&now-anchor.resumedAt>240&&diagnostic.trackingGuard==="ANCHOR RESUMED")diagnostic.trackingGuard="READY";
    }

    if(manipulator){
      const hand=handRecord(manipulator.handId),live=handLive(manipulator.handId);
      if(!live){
        if(handRecent(manipulator.handId,now)){
          if(!manipulator.recovering){manipulator.recovering=true;manipulator.recoveryUntil=now+SPATIAL_RECOVERY_MS;diagnostic.trackingGuard="MANIPULATOR REACQUIRING";diagnostic.phase="MANIPULATOR_RECOVERY";}
          return;
        }
        releaseManipulator("SECONDARY_LOST",true);return;
      }
      manipulator.lastSeenAt=now;
      if(manipulator.recovering){
        if(hand?.interactionPinch?.releasedThisFrame){releaseManipulator("SECONDARY_RELEASED_DURING_GAP");return;}
        if(!hand?.interactionPinch?.on){
          if(now>(manipulator.recoveryUntil||0))releaseManipulator("SECONDARY_RECOVERY_TIMEOUT",true);
          return;
        }
        const pair=controlPair(manipulator.handId,now);
        if(!pair||pair.separation<FREE_CONTROL_MIN_SEPARATION){
          if(now>(manipulator.recoveryUntil||0))releaseManipulator("SECONDARY_REBASE_FAILED",true);
          return;
        }
        if(!model.rebaseManipulator(pair.primary,pair.secondary)){releaseManipulator("SECONDARY_REBASE_FAILED",true);return;}
        manipulator.lastPair=pair;manipulator.recovering=false;manipulator.recoveryUntil=null;
        diagnostic.trackingGuard="MANIPULATOR RESUMED";diagnostic.phase="MANIPULATOR";sceneDirty=true;dirty=true;return;
      }
      if(!hand.interactionPinch?.on){releaseManipulator();return;}
      diagnostic.trackingGuard="READY";updateManipulator(now);return;
    }

    if(manipulatorArming){
      const hand=handRecord(manipulatorArming.handId);
      if(handLive(manipulatorArming.handId)){
        manipulatorArming.lastSeenAt=now;
        if(!hand.interactionPinch?.on){manipulatorArming=null;diagnostic.phase="ANCHOR";diagnostic.trackingGuard="READY";return;}
        const pair=controlPair(manipulatorArming.handId,now);
        if(pair){
          manipulatorArming.lastPair=pair;manipulatorArming.samples++;
          if(pair.separation>=FREE_CONTROL_MIN_SEPARATION&&now-manipulatorArming.startedAt>=130&&manipulatorArming.samples>=2)activateManipulator();
        }
        return;
      }
      if(handRecent(manipulatorArming.handId,now)){diagnostic.trackingGuard="SECONDARY ARMING · REACQUIRING";return;}
      manipulatorArming=null;diagnostic.phase="ANCHOR";diagnostic.lastReason="SECONDARY LOST BEFORE JOIN";diagnostic.trackingGuard="READY";return;
    }

    // Do not depend on the secondary pointer hovering the selected object. Any
    // other clearly tracked pinching hand may become the free-space controller.
    if(blockedManipulator){const blocked=handRecord(blockedManipulator);if(!blocked?.interactionPinch?.on)blockedManipulator=null;}
    const candidate=state.hands.find(hand=>hand.id!==anchor.handId&&handLive(hand.id)&&hand.interactionPinch?.on);
    if(!candidate||blockedManipulator===candidate.id)return;
    const cursor=Object.values(cursors).find(c=>c.handId===candidate.id&&c.visible);
    const point=cursor?.position||{x:0,y:0};
    startManipulator(candidate.id,point,now);
  }
  function watchdog(now){
    if(!anchor||anchor.mouse)return;
    const anchorHand=handRecord(anchor.handId);
    if(handLive(anchor.handId)){
      if(anchor.recovering){
        if(anchorHand?.interactionPinch?.releasedThisFrame){endPrimary("ANCHOR_RELEASED_DURING_GAP");return;}
        if(now>(anchor.recoveryUntil||0)&&!anchorHand?.interactionPinch?.surfaceReady){endPrimary("ANCHOR_RECOVERY_TIMEOUT",true);return;}
      }else if(!anchorHand.interactionPinch?.surfaceReady){endPrimary();return;}
    }else if(!handRecent(anchor.handId,now)){endPrimary("ANCHOR_LOST",true);return;}
    if(manipulator){
      const other=handRecord(manipulator.handId);
      if(handLive(manipulator.handId)){
        if(manipulator.recovering){
          if(other?.interactionPinch?.releasedThisFrame){releaseManipulator("SECONDARY_RELEASED_DURING_GAP");return;}
          if(now>(manipulator.recoveryUntil||0)&&!other?.interactionPinch?.on)releaseManipulator("SECONDARY_RECOVERY_TIMEOUT",true);
        }else if(!other.interactionPinch?.on)releaseManipulator();
      }else if(!handRecent(manipulator.handId,now))releaseManipulator("SECONDARY_LOST",true);
    }
  }
  function cancel(){if(anchor)endPrimary("CANCELLED");else{manipulator=null;manipulatorArming=null;}controlFilters.clear();diagnostic.trackingGuard="READY";hoverId=null;sceneDirty=true;dirty=true;}
  function resetTransform(){const id=model.selected?.id;if(model.resetTransform()){action("3D TRANSFORM RESET → "+id);sceneDirty=true;dirty=true;return true;}return false;}
  function adjustDepth(amount){const id=model.selected?.id;if(model.adjustDepth(amount)){action("3D DEPTH → "+id+" · "+model.selected.position.z.toFixed(2));sceneDirty=true;dirty=true;return true;}return false;}
  function adjustTransform(kind,axis,amount){
    const id=model.selected?.id;if(!id)return false;
    if(model.adjustTransform(kind,axis,amount)){
      const object=model.selected, label=kind==="position"?`${axis.toUpperCase()} ${object.position[axis].toFixed(2)}`:kind==="rotation"?`${axis.toUpperCase()} ${Math.round(object.rotation[axis])}°`:`${object.scale.x.toFixed(2)}×`;
      action(`3D ${kind.toUpperCase()} → ${id} · ${label}`);sceneDirty=true;dirty=true;return true;
    }return false;
  }
  function rename(value){const id=model.selected?.id;if(id&&model.setName(value)){action("3D RENAMED → "+id+" · "+model.selected.name);sceneDirty=true;dirty=true;return true;}return false;}
  function toggleVisibility(){const id=model.selected?.id;if(id&&model.toggleVisible()){action("3D VISIBILITY → "+id+" · "+(model.selected.visible===false?"HIDDEN":"VISIBLE"));sceneDirty=true;dirty=true;return true;}return false;}
  function toggleLocked(){const id=model.selected?.id;if(id&&model.toggleLocked()){action("3D LOCK → "+id+" · "+(model.selected.locked?"LOCKED":"UNLOCKED"));sceneDirty=true;dirty=true;return true;}return false;}
  function focusSelected(){
    const object=model.selected;if(!object||object.visible===false)return false;
    cameraFocus={x:object.position.x,y:object.position.y,z:object.position.z};applyCameraFocus();sceneDirty=true;dirty=true;
    action("3D CAMERA FOCUS → "+object.id);render(performance.now(),true);return true;
  }
  function centerCamera(log=true){cameraFocus={x:0,y:0,z:0};applyCameraFocus();sceneDirty=true;dirty=true;if(log)action("3D CAMERA → SCENE CENTER");render(performance.now(),true);return true;}
  function duplicate(){const object=model.duplicate();if(object){action("3D OBJECT DUPLICATED → "+object.id);sceneDirty=true;dirty=true;}return object;}
  function remove(){const id=model.selected?.id;if(id&&model.delete(id)){action("3D OBJECT DELETED → "+id);sceneDirty=true;dirty=true;return true;}return false;}
  function nodeStats(id){
    const root=nodes.get(id);if(!root)return{meshes:null,triangles:null};
    if(root.userData?.modelStatus && root.userData.modelStatus !== "READY") return {meshes:null,triangles:null};
    if(root.userData?.geometryStats) return root.userData.geometryStats;
    let meshes=0,triangles=0;
    root.traverse?.(child=>{const geometry=child?.isMesh?child.geometry:null;if(!geometry)return;meshes++;const count=geometry.index?.count??geometry.attributes?.position?.count??0;triangles+=Math.floor(count/3);});
    root.userData.geometryStats={meshes,triangles};return root.userData.geometryStats;
  }
  function sceneStats(){
    let meshes=0,triangles=0,available=0;for(const object of model.objects){const stats=nodeStats(object.id);if(stats.meshes===null)continue;available++;meshes+=stats.meshes;triangles+=stats.triangles;}
    const complete=available===model.objects.length&&model.objects.length>0;
    return{objects:model.objects.length,visible:model.objects.filter(object=>object.visible!==false).length,locked:model.objects.filter(object=>object.locked).length,meshes:complete?meshes:null,triangles:complete?triangles:null};
  }
  function afterLoad(){
    cancel(); model.syncAfterLoad(); hoverId=null; lastHoverProbe=""; cameraFocus={x:0,y:0,z:0}; applyCameraFocus();
    for(const id of [...nodes.keys()]) disposeNode(id);
    diagnostic.selectedId=model.state.selected3DId; diagnostic.objectCount=model.objects.length;
    diagnostic.anchorHandId=null; diagnostic.manipulatorHandId=null; diagnostic.phase="IDLE";
    lastSelectionBoundsAt=0;lastSelectionBoundsId=null;
    sceneDirty=true; dirty=true; if(active) render(performance.now(),true);
  }
  function setAppearance(key,value){const changed=model.setAppearance(key,value);if(changed){sceneDirty=true;dirty=true;}return changed;}
  function createImage(payload,position={x:0,y:0,z:0}){const object=model.createImage(payload,position);if(object){sceneDirty=true;dirty=true;render(performance.now(),true);}return object;}
  function createImportedModel(payload,position={x:0,y:0,z:0}){const object=model.createImportedModel(payload,position);if(object){sceneDirty=true;dirty=true;render(performance.now(),true);}return object;}
  function captureLayers(){
    if(!active) return [];
    resize(true);
    const now=performance.now();
    if(backend==="WEBGL"&&renderer&&scene&&camera3D){
      if (safeWebGLRender(now)) {
        // Copy immediately after render. WebGL uses preserveDrawingBuffer:false for performance,
        // so exporting the live canvas later can be blank on some browsers/GPUs.
        try {
          const snapshot=document.createElement("canvas");snapshot.width=webglCanvas.width;snapshot.height=webglCanvas.height;
          const ctx=snapshot.getContext("2d",{alpha:true});if(ctx){ctx.drawImage(webglCanvas,0,0);return [snapshot,overlay].filter(Boolean);}
        } catch (error) { diagnostic.lastReason="EXPORT_WEBGL_SNAPSHOT_FAILED"; console.warn("[VOIDS VISION] WebGL export snapshot failed",error); }
      }
      // A lost/failed WebGL context is non-fatal: export from the Canvas fallback.
    }
    render(now,true); return [overlay].filter(Boolean);
  }

  function drawFallbackObject(object,now){
    const geo=FALLBACK_GEOMETRIES[object.type]||FALLBACK_GEOMETRIES["holo-cube"],selected=object.id===model.state.selected3DId,hovered=object.id===hoverId;
    const idle=!selected&&!anchor&&idleAllowed()&&["holo-orb","holo-globe","holo-ring","holo-knot","holo-beacon"].includes(object.type);
    const idleRotation=idle?Math.sin(now/2200+object.idlePhase)*4:0;
    const visual=idle?{...object,rotation:{...object.rotation,y:object.rotation.y+idleRotation}}:object;
    const verts=geo.vertices.map(v=>transformPoint(v,visual)),pts=verts.map(fallbackProject);
    const hex=String(object.color||"#45dbff"), rgb=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    const color=rgb?`${parseInt(rgb[1],16)},${parseInt(rgb[2],16)},${parseInt(rgb[3],16)}`:"69,219,255";
    const glow=clamp(Number(object.glow??.7),0,1), alpha=clamp(Number(object.opacity??.82),.15,1);
    if(geo.faces.length){const faces=geo.faces.map(face=>({face,z:face.reduce((s,i)=>s+verts[i].z,0)/face.length})).sort((a,b)=>a.z-b.z);
      for(const {face} of faces){overlayCtx.beginPath();face.forEach((i,n)=>n?overlayCtx.lineTo(pts[i].x,pts[i].y):overlayCtx.moveTo(pts[i].x,pts[i].y));overlayCtx.closePath();overlayCtx.fillStyle=`rgba(${color},${(selected?.09:.045)*alpha})`;overlayCtx.fill();}}
    overlayCtx.lineCap="round";overlayCtx.lineJoin="round";overlayCtx.strokeStyle=`rgba(${color},${(selected?.98:hovered?.9:.56+.18*glow)*alpha})`;overlayCtx.lineWidth=selected?1.8:hovered?1.45:1;
    for(const [a,b] of geo.edges){overlayCtx.beginPath();overlayCtx.moveTo(pts[a].x,pts[a].y);overlayCtx.lineTo(pts[b].x,pts[b].y);overlayCtx.stroke();}
    if(object.type==="holo-orb"){const center=fallbackProject(object.position);overlayCtx.beginPath();overlayCtx.arc(center.x,center.y,Math.max(2,4.5*object.scale.x),0,Math.PI*2);overlayCtx.fillStyle="rgba(130,245,255,.72)";overlayCtx.fill();}
    if(object.type==="holo-image"||object.type==="holo-model"){const center=fallbackProject(object.position);overlayCtx.fillStyle=`rgba(${color},.82)`;overlayCtx.font="10px ui-monospace, monospace";overlayCtx.textAlign="center";overlayCtx.fillText(object.type==="holo-model"?"3D MODEL · WEBGL REQUIRED":"IMAGE HOLOGRAM",center.x,center.y);}
  }
  function selectedScreenPoint() {
    const object=model.selected;if(!object||object.visible===false)return null;
    if(backend==="WEBGL"&&THREE&&camera3D){const v=new THREE.Vector3(object.position.x,object.position.y,object.position.z).project(camera3D);return{x:(v.x*.5+.5)*cssWidth,y:(-v.y*.5+.5)*cssHeight};}
    return fallbackProject(object.position);
  }
  function drawOverlay() {
    overlayCtx.setTransform(dpr,0,0,dpr,0,0);overlayCtx.clearRect(0,0,cssWidth,cssHeight);
    if(anchor&&manipulator){const pair=controlPair(manipulator.handId);if(pair){const a={x:pair.primary.x/FREE_CONTROL_WIDTH*cssWidth,y:pair.primary.y/FREE_CONTROL_HEIGHT*cssHeight},b={x:pair.secondary.x/FREE_CONTROL_WIDTH*cssWidth,y:pair.secondary.y/FREE_CONTROL_HEIGHT*cssHeight};overlayCtx.strokeStyle="rgba(91,228,255,.50)";overlayCtx.lineWidth=1;overlayCtx.setLineDash([4,5]);overlayCtx.beginPath();overlayCtx.moveTo(a.x,a.y);overlayCtx.lineTo(b.x,b.y);overlayCtx.stroke();overlayCtx.setLineDash([]);overlayCtx.font="10px ui-monospace, monospace";overlayCtx.textAlign="center";overlayCtx.fillStyle="rgba(154,242,255,.92)";overlayCtx.fillText("ANCHOR PALM",a.x,a.y-12);overlayCtx.fillText((diagnostic.transformIntent||"FREE HAND")+" · FREE",b.x,b.y-12);}}
    if(backend==="WEBGL"&&model.selected){const p=selectedScreenPoint();if(p){overlayCtx.fillStyle="rgba(5,18,29,.82)";overlayCtx.fillRect(p.x-58,p.y+20,116,20);overlayCtx.fillStyle="#9af2ff";overlayCtx.font="10px ui-monospace, monospace";overlayCtx.textAlign="center";overlayCtx.fillText(model.selected.id+" · "+holoName(model.selected.type).replace("Holo ",""),p.x,p.y+34);}}
  }

  function render(now=performance.now(),force=false){
    if(!active||!resize())return;
    const cadence=renderCadence();
    const animatedModel=idleAllowed()&&!anchor&&[...nodes.values()].some(node=>Boolean(node?.userData?.mixer));
    const idle=idleAllowed()&&!anchor&&(animatedModel||model.objects.some(o=>o.id!==model.state.selected3DId&&["holo-orb","holo-globe","holo-ring","holo-knot","holo-beacon"].includes(o.type)));
    if(!force&&!dirty&&!sceneDirty&&!idle)return;
    if(!force&&now-lastRender<cadence)return;
    lastRender=now;dirty=false;

    // Hover follows the visible aim ring, not a hidden filtered point ahead of
    // it. This fixes the subtle "cursor is here but another object highlights"
    // feeling that becomes obvious when low-FPS display resampling is active.
    const previousHover=hoverId;hoverId=null;
    for(const p of Object.values(state.runtime.handPointers||{})){
      if(!p.visible||p.captureKind)continue;
      const aim=p.rendered||p.filtered;
      if(!aim)continue;
      const hit=hitTest(aim,{padding:12});if(hit){hoverId=hit.id;break;}
    }
    if(previousHover!==hoverId)sceneDirty=true;

    // Pointer travel over empty space used to redraw the complete 3D scene even
    // when no visual state changed. Raycast the aim, then skip the GPU frame if
    // the hover result is unchanged and nothing is animating/manipulating.
    const needsSceneFrame=force||sceneDirty||previousHover!==hoverId||Boolean(anchor||manipulator||manipulatorArming)||idle;
    if(!needsSceneFrame)return;

    let renderedWebGL = false;
    if(backend==="WEBGL"&&renderer&&scene&&camera3D) renderedWebGL = safeWebGLRender(now);
    if(!renderedWebGL){
      overlayCtx.setTransform(dpr,0,0,dpr,0,0);overlayCtx.clearRect(0,0,cssWidth,cssHeight);
      const sorted=[...model.objects].filter(o=>o.visible).sort((a,b)=>(Number(a.position?.z)||0)-(Number(b.position?.z)||0));
      for(const object of sorted) {
        try { drawFallbackObject(object,now); }
        catch (error) {
          diagnostic.error = String(error?.message || error || "3D object render failed");
          diagnostic.lastReason = `OBJECT_RENDER:${object?.id || "UNKNOWN"}`;
          console.warn("[VOIDS VISION] Skipped malformed 3D object during fallback render", object?.id, error);
        }
      }
      if(anchor&&manipulator){const pair=controlPair(manipulator.handId);if(pair){const a={x:pair.primary.x/FREE_CONTROL_WIDTH*cssWidth,y:pair.primary.y/FREE_CONTROL_HEIGHT*cssHeight},b={x:pair.secondary.x/FREE_CONTROL_WIDTH*cssWidth,y:pair.secondary.y/FREE_CONTROL_HEIGHT*cssHeight};overlayCtx.strokeStyle="rgba(91,228,255,.45)";overlayCtx.lineWidth=1;overlayCtx.setLineDash([4,5]);overlayCtx.beginPath();overlayCtx.moveTo(a.x,a.y);overlayCtx.lineTo(b.x,b.y);overlayCtx.stroke();overlayCtx.setLineDash([]);}}
    }
    frameCount++;if(!fpsStart)fpsStart=now;if(now-fpsStart>=1000){diagnostic.renderFps=frameCount*1000/(now-fpsStart);fpsStart=now;frameCount=0;}
    diagnostic.active=active;diagnostic.selectedId=model.state.selected3DId;diagnostic.objectCount=model.objects.length;diagnostic.quality=quality();diagnostic.backend=backend==="WEBGL"?"WEBGL":"CANVAS FALLBACK";
  }

  function enter(){
    if(disposed)return;
    active=true;overlay.hidden=false;if(webglCanvas)webglCanvas.hidden=false;diagnostic.active=true;dirty=true;sceneDirty=true;
    // A previous CDN/loader failure should not permanently poison an imported model.
    // Re-entering Spatial retries failed model nodes while keeping successful nodes intact.
    for(const [id,node] of [...nodes.entries()]) if(node?.userData?.modelStatus==="ERROR") disposeNode(id);
    frameCount=0;fpsStart=0;lastRender=0;diagnostic.renderFps=0;
    resize(true);render(performance.now(),true);
    loadThree().then(()=>{if(active&&!disposed){if(webglCanvas)webglCanvas.hidden=backend!=="WEBGL";sceneDirty=true;dirty=true;render(performance.now(),true);}});
  }
  function exit(){
    cancel();active=false;overlay.hidden=true;if(webglCanvas)webglCanvas.hidden=true;diagnostic.active=false;
    frameCount=0;fpsStart=0;lastRender=0;diagnostic.renderFps=0;
    overlayCtx.clearRect(0,0,overlay.width,overlay.height);
  }
  function tick(now){
    if(!active)return;
    const moving=Boolean(anchor||manipulator||manipulatorArming);
    const pointer=Object.values(state.runtime.handPointers||{}).find(p=>p.visible&&!p.captureKind);
    const aim=pointer?.rendered||pointer?.filtered;
    const probe=pointer&&aim?`${pointer.handId}:${Math.round(aim.x/4)}:${Math.round(aim.y/4)}`:"";
    const animatedModel=idleAllowed()&&!anchor&&[...nodes.values()].some(node=>Boolean(node?.userData?.mixer));
    const idle=idleAllowed()&&!anchor&&(animatedModel||model.objects.some(o=>o.id!==model.state.selected3DId&&["holo-orb","holo-globe","holo-ring","holo-knot","holo-beacon"].includes(o.type)));
    if(moving||idle||probe!==lastHoverProbe){dirty=true;lastHoverProbe=probe;}
    // Model edits mark sceneDirty themselves. Pointer movement only needs a
    // hover probe/render; do not force a full scene restyle for every 4 px.
    render(now);
  }
  function onResize(){dirty=true;sceneDirty=true;resize(true);}
  function onContextLost(event) {
    event?.preventDefault?.();
    if (backend === "WEBGL") fallBackFromWebGL(new Error("WebGL context lost"), "WEBGL CONTEXT LOST");
  }
  function onContextRestored() {
    if (disposed || !active) return;
    diagnostic.error = null; diagnostic.lastReason = "WEBGL CONTEXT RESTORED";
    THREE = null; renderer = null; scene = null; camera3D = null; raycaster = null; ndc = null; threeLoading = null;
    loadThree().then(() => { dirty = true; sceneDirty = true; render(performance.now(), true); });
  }
  window?.addEventListener?.("resize",onResize);document?.addEventListener?.("fullscreenchange",onResize);

  return {
    model,diagnostic,enter,exit,tick,render,hitTest,isPointNearSelected,canJoinManipulator,screenToPlane,create,createImage,createImportedModel,setAppearance,select,clearSelection,startPrimary,moveAnchor,startManipulator,releaseManipulator,endPrimary,update,watchdog,cancel,resetTransform,adjustDepth,adjustTransform,rename,toggleVisibility,toggleLocked,focusSelected,centerCamera,duplicate,remove,afterLoad,captureLayers,sceneStats,nodeStats,
    recover(error, reason="SPATIAL_3D_RECOVERY"){ fallBackFromWebGL(error, reason); render(performance.now(), true); return true; },
    get holding(){return Boolean(anchor);},get anchorHandId(){return anchor?.handId||null;},get manipulatorHandId(){return manipulator?.handId||manipulatorArming?.handId||null;},get selected(){return model.selected;},activeControl,
    modelStatus(id){const node=nodes.get(id);return node?.userData?.modelStatus||null;},
    modelError(id){const node=nodes.get(id);return node?.userData?.modelError||null;},
    importCapacity(assetId=null){return model.importCapacity(assetId);},
    get importedAssetCount(){return model.liveImportedAssetIds.size;},
    setHover(point){hoverId=hitTest(point,{padding:12})?.id||null;sceneDirty=true;dirty=true;return hoverId;},
    tools:HOLO_TOOLS,isTool:isHoloTool,
    dispose(){
      if(disposed)return; disposed=true; cancel(); active=false;
      window?.removeEventListener?.("resize",onResize);document?.removeEventListener?.("fullscreenchange",onResize);
      for(const id of [...nodes.keys()])disposeNode(id);
      selectionBox?.geometry?.dispose?.();selectionBox?.material?.dispose?.();selectionBox=null;selectionBounds=null;
      try { starGeometry?.dispose?.(); starMaterial?.dispose?.(); } catch { /* Ambient teardown only. */ }
      starField=null;starGeometry=null;starMaterial=null;
      try { renderer?.dispose?.(); } catch { /* Page teardown must remain safe. */ }
      renderer=null;scene=null;camera3D=null;raycaster=null;ndc=null;THREE=null;GLTFLoaderClass=null;gltfLoaderPromise=null;formatLoaderClasses.clear();formatLoaderPromises.clear();backend="FALLBACK";threeLoading=null;
      if(webglCanvas){
        webglCanvas.removeEventListener?.("webglcontextlost", onContextLost, false);
        webglCanvas.removeEventListener?.("webglcontextrestored", onContextRestored, false);
        webglCanvas.remove?.();
      }
      webglCanvas=null;
      overlay.hidden=true;diagnostic.active=false;diagnostic.webglReady=false;diagnostic.backend="DISPOSED";diagnostic.renderFps=0;
    }
  };
}
