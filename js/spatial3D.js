import { HOLO_TOOLS, Spatial3DModel, holoName, isHoloTool } from "./spatial3DModel.js";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const noop = () => {};

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
const FALLBACK_GEOMETRIES = {
  "holo-cube": cubeGeometry(), "holo-pyramid": pyramidGeometry(), "holo-panels": panelGeometry(),
  "holo-orb": sphereGeometry(14,4), "holo-globe": sphereGeometry(18,7), "holo-ring": ringGeometry()
};

export function createSpatial3D({ state, spatialModel, action, interaction, ui }) {
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
    renderFps:0, quality:"FULL", backend:"LOADING", webglReady:false, lastReason:null, error:null
  };

  let active=false, cssWidth=1, cssHeight=1, dpr=1, dirty=true, lastRender=0, frameCount=0, fpsStart=0;
  let anchor=null, manipulator=null, manipulatorArming=null, blockedManipulator=null;
  let mouseAnchor=false, hoverId=null, lastHoverProbe="";

  // WebGL renderer state. Three.js is lazy-loaded only when Spatial/Holo is entered.
  let THREE=null, webglCanvas=null, renderer=null, scene=null, camera3D=null, raycaster=null, ndc=null;
  let threeLoading=null, backend="FALLBACK", sceneDirty=true, qualityKey="";
  let disposed=false;
  const nodes = new Map();
  const shared = new Map();
  let selectionBox=null, selectionBounds=null;

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
  function idleAllowed() { return !reduced(); }
  function desiredDpr() {
    const cap = ({ REDUCED: 0.8, PERFORMANCE: 0.85, BALANCED: 1.0, VISUAL: 1.25, FULL: 1.25 })[quality()] || 1;
    return Math.min(window.devicePixelRatio || 1, cap);
  }
  function renderCadence() {
    const mode = quality();
    if (mode === "REDUCED" || mode === "PERFORMANCE") return 1000/12;
    if (mode === "BALANCED") return 1000/18;
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

  function loadThree() {
    if (THREE && renderer && scene && camera3D) return Promise.resolve(THREE);
    if (threeLoading) return threeLoading;
    if (typeof window === "undefined" || disposed) return Promise.resolve(null);
    diagnostic.backend = "LOADING";
    threeLoading = import(THREE_URL).then(module => {
      if (disposed) return null;
      THREE = module;
      const canvas = ensureWebglCanvas();
      renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:true, powerPreference:"high-performance", preserveDrawingBuffer:false });
      renderer.setClearColor(0x000000, 0);
      renderer.sortObjects = true;
      scene = new THREE.Scene();
      camera3D = new THREE.PerspectiveCamera(50, 1, 0.1, 30);
      camera3D.position.set(0,0,8.8);
      camera3D.lookAt(0,0,0);
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
  function fallbackCamera() { return { z:8.8, focal:Math.min(cssWidth,cssHeight)*1.08 }; }
  function fallbackProject(world) {
    const cam=fallbackCamera(), depth=Math.max(2.2,cam.z-world.z), k=cam.focal/depth;
    return {x:cssWidth/2+world.x*k,y:cssHeight/2-world.y*k,z:world.z,k};
  }
  function fallbackScreenToPlane(point,z=0) {
    const rect=board?.getBoundingClientRect?.(); if(!rect)return{x:0,y:0,z};
    const cam=fallbackCamera(), x=point.x-rect.left-cssWidth/2, y=point.y-rect.top-cssHeight/2, depth=cam.z-z, k=cam.focal/depth;
    return {x:x/k,y:-y/k,z};
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
  function remember(id,...resources) {
    const list=shared.get(id)||[]; for(const resource of resources.flat()) if(resource&&!list.includes(resource))list.push(resource); shared.set(id,list);
  }
  function makeNode(object) {
    const group=new THREE.Group();
    group.userData.holoId=object.id;
    const meshParts=[];
    const addMesh=(geometry,{faceOpacity=.055,edgeOpacity=.68,wireframe=false,z=0}={})=>{
      const face=material(0x45dbff,faceOpacity); face.wireframe=wireframe;
      const mesh=new THREE.Mesh(geometry,face); mesh.position.z=z; mesh.userData.holoId=object.id; mesh.userData.baseOpacity=faceOpacity; meshParts.push(mesh); group.add(mesh);
      const edgeGeo=new THREE.EdgesGeometry(geometry,22); const edges=new THREE.LineSegments(edgeGeo,lineMaterial(0x45dbff,edgeOpacity)); edges.position.z=z; edges.userData.holoId=object.id; edges.userData.baseOpacity=edgeOpacity; group.add(edges);
      remember(object.id,geometry,face,edgeGeo,edges.material);
      return mesh;
    };
    if(object.type==="holo-cube") addMesh(new THREE.BoxGeometry(2,2,2),{faceOpacity:.055});
    else if(object.type==="holo-pyramid") addMesh(new THREE.ConeGeometry(1.15,2.1,4,1,false),{faceOpacity:.055});
    else if(object.type==="holo-ring") addMesh(new THREE.TorusGeometry(1.25,.27,8,28),{faceOpacity:.04,edgeOpacity:.8});
    else if(object.type==="holo-globe") {
      addMesh(new THREE.SphereGeometry(1.12,14,9),{faceOpacity:.018,edgeOpacity:.62,wireframe:true});
      const equatorGeo=new THREE.TorusGeometry(1.13,.016,4,42); const eq=new THREE.Mesh(equatorGeo,material(0x79eaff,.32)); eq.userData.holoId=object.id; group.add(eq); remember(object.id,equatorGeo,eq.material);
    } else if(object.type==="holo-orb") {
      addMesh(new THREE.IcosahedronGeometry(1.02,1),{faceOpacity:.04,edgeOpacity:.74});
      const coreGeo=new THREE.IcosahedronGeometry(.18,1), coreMat=material(0xc7fbff,.55); const core=new THREE.Mesh(coreGeo,coreMat); core.userData.holoId=object.id; core.userData.baseOpacity=.55; group.add(core); remember(object.id,coreGeo,coreMat);
      for(const rotation of [[Math.PI/2,0,0],[0,Math.PI/2,0]]){
        const ringGeo=new THREE.TorusGeometry(1.28,.018,4,40), ringMat=material(0x79eaff,.34); const ring=new THREE.Mesh(ringGeo,ringMat); ring.rotation.set(...rotation); ring.userData.holoId=object.id; ring.userData.baseOpacity=.34; group.add(ring); remember(object.id,ringGeo,ringMat);
      }
    } else {
      for(let i=0;i<4;i++) addMesh(new THREE.BoxGeometry(2.7,1.5,.06),{faceOpacity:.038,edgeOpacity:.68,z:(i-1.5)*.32});
    }
    group.userData.meshParts=meshParts;
    nodes.set(object.id,group); scene.add(group); return group;
  }
  function disposeNode(id) {
    const node=nodes.get(id); if(node&&scene)scene.remove(node);
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
      node.position.set(object.position.x,object.position.y,object.position.z);
      const idle=!selected&&!anchor&&idleAllowed()&&["holo-orb","holo-globe","holo-ring"].includes(object.type);
      const idleYaw=idle?Math.sin(now/2200+object.idlePhase)*4:0;
      node.rotation.set(object.rotation.x*DEG,(object.rotation.y+idleYaw)*DEG,object.rotation.z*DEG);
      node.scale.set(object.scale.x,object.scale.y,object.scale.z);
      for(const child of node.children){
        const mat=child.material; if(!mat)continue;
        const isLine=child.isLineSegments;
        const baseOpacity=child.userData?.baseOpacity ?? (isLine ? .68 : .055);
        mat.opacity=selected ? Math.max(baseOpacity, isLine ? 1 : .11) : hovered ? Math.max(baseOpacity, isLine ? .88 : .08) : baseOpacity;
      }
    }
    for(const id of [...nodes.keys()])if(!ids.has(id))disposeNode(id);
    const selectedNode=model.selected?nodes.get(model.selected.id):null;
    if(selectionBox){
      selectionBox.visible=Boolean(selectedNode);
      if(selectedNode){selectionBounds.setFromObject(selectedNode);}
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
    const o=model.selected;if(!o)return false;
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

  function select(id){model.select(id);diagnostic.selectedId=model.state.selected3DId;sceneDirty=true;dirty=true;}
  function clearSelection(){model.select(null);diagnostic.selectedId=null;sceneDirty=true;dirty=true;}
  function create(type,screenPoint){const p=screenToPlane(screenPoint,0),object=model.create(type,p);if(object){action("3D OBJECT CREATED → "+type);sceneDirty=true;dirty=true;}return object;}
  function startPrimary({handId,screenPoint,now,mouse=false}){
    const object=hitTest(screenPoint,{padding:22});if(!object)return false;const plane=screenToPlane(screenPoint,object.position.z);
    if(!mouse&&!interaction.claim(handId,"OBJECT_CAPTURE","spatial",object.id,{pending:true}))return false;
    if(!model.startAnchor(object.id,plane,screenPoint)){if(!mouse)interaction.release(handId,"TARGET_UNAVAILABLE",false);return false;}
    anchor={handId,objectId:object.id,mouse,screen:{...screenPoint},plane,startedAt:now};mouseAnchor=mouse;select(object.id);
    diagnostic.anchorHandId=handId||"MOUSE";diagnostic.manipulatorHandId=null;diagnostic.phase="ANCHOR";diagnostic.lastReason=null;
    action("3D ANCHOR → "+(handId||"MOUSE")+" · "+object.id);sceneDirty=true;dirty=true;return true;
  }
  function moveAnchor(screenPoint){if(!anchor)return;const object=model.get(anchor.objectId);if(!object)return;anchor.screen={...screenPoint};anchor.plane=screenToPlane(screenPoint,object.position.z);model.moveAnchor(anchor.plane);sceneDirty=true;dirty=true;}
  function startManipulator(handId,screenPoint,now){
    if(!anchor||manipulator||handId===anchor.handId||!isPointNearSelected(screenPoint,42))return false;
    manipulatorArming={handId,screen:{...screenPoint},startedAt:now,samples:1};diagnostic.phase="MANIPULATOR_ARMING";dirty=true;return true;
  }
  function activateManipulator(screenPoint){
    if(!anchor||!manipulatorArming)return false;
    if(!model.beginManipulator(anchor.screen,screenPoint)){manipulatorArming=null;diagnostic.phase="ANCHOR";return false;}
    manipulator={handId:manipulatorArming.handId,screen:{...screenPoint}};diagnostic.manipulatorHandId=manipulator.handId;diagnostic.phase="MANIPULATOR";
    action("3D MANIPULATOR JOINED → "+manipulator.handId);manipulatorArming=null;sceneDirty=true;dirty=true;return true;
  }
  function updateManipulator(screenPoint){
    if(!anchor||!manipulator)return;manipulator.screen={...screenPoint};
    const result=model.applyManipulator(anchor.screen,screenPoint,{width:cssWidth,height:cssHeight},{snap:spatialModel.state.snap});
    if(result){diagnostic.scaleRatio=result.scale;diagnostic.yaw=result.yaw;diagnostic.pitch=result.pitch;diagnostic.roll=result.roll;sceneDirty=true;dirty=true;}
  }
  function releaseManipulator(reason="RELEASED",lost=false){
    if(!anchor)return false;
    if(manipulatorArming&&(!manipulator||manipulatorArming.handId===manipulator?.handId)){blockedManipulator=manipulatorArming.handId;manipulatorArming=null;}
    if(!manipulator){diagnostic.phase="ANCHOR";return false;}
    const id=manipulator.handId;blockedManipulator=id;model.endManipulator(anchor.plane);manipulator=null;diagnostic.manipulatorHandId=null;diagnostic.phase="ANCHOR";diagnostic.lastReason=reason;
    action(lost?"3D MANIPULATOR LOST · ANCHOR CONTINUES":"3D MANIPULATOR RELEASED · ANCHOR CONTINUES");sceneDirty=true;dirty=true;return true;
  }
  function endPrimary(reason="RELEASED",lost=false){
    if(!anchor)return false;const old=anchor;const result=model.finishAnchor();
    if(manipulator)interaction.release(manipulator.handId,reason,false);if(!old.mouse&&old.handId)interaction.release(old.handId,reason,false);
    anchor=null;manipulator=null;manipulatorArming=null;mouseAnchor=false;diagnostic.anchorHandId=null;diagnostic.manipulatorHandId=null;diagnostic.phase=lost?"LOST":"IDLE";diagnostic.lastReason=reason;
    action((lost?"3D ANCHOR LOST → ":"3D OBJECT DROP → ")+old.objectId+(result?.changed?" · one edit committed":" · unchanged"));sceneDirty=true;dirty=true;return true;
  }
  function activeControl(){return{anchorHandId:anchor?.handId||null,manipulatorHandId:manipulator?.handId||manipulatorArming?.handId||null};}
  function update({cursors,now}){
    if(!anchor||anchor.mouse)return;
    const primary=cursors.primary,secondary=cursors.secondary;
    if(!primary.visible||primary.handId!==anchor.handId)return;
    moveAnchor(primary.position);
    if(manipulator){
      if(!secondary.visible||secondary.handId!==manipulator.handId){releaseManipulator("SECONDARY_LOST",true);return;}
      const hand=state.hands.find(h=>h.id===manipulator.handId);if(!hand?.interactionPinch?.on){releaseManipulator();return;}updateManipulator(secondary.position);return;
    }
    if(manipulatorArming){
      if(!secondary.visible||secondary.handId!==manipulatorArming.handId){manipulatorArming=null;diagnostic.phase="ANCHOR";return;}
      const hand=state.hands.find(h=>h.id===manipulatorArming.handId);
      if(!hand?.interactionPinch?.on||!isPointNearSelected(secondary.position,48)){manipulatorArming=null;diagnostic.phase="ANCHOR";return;}
      manipulatorArming.samples++;if(now-manipulatorArming.startedAt>=170&&manipulatorArming.samples>=2)activateManipulator(secondary.position);return;
    }
    if(!secondary.visible||secondary.handId===anchor.handId)return;
    const hand=state.hands.find(h=>h.id===secondary.handId);
    if(blockedManipulator===secondary.handId){if(!hand?.interactionPinch?.on)blockedManipulator=null;else return;}
    if(!hand?.interactionPinch?.on)return;
    if(isPointNearSelected(secondary.position,48))startManipulator(secondary.handId,secondary.position,now);
  }
  function watchdog(now){
    if(!anchor||anchor.mouse)return;const hand=interaction.trustedHand(anchor.handId,now);if(!hand){endPrimary("ANCHOR_LOST",true);return;}if(!hand.interactionPinch?.surfaceReady){endPrimary();return;}
    if(manipulator){const other=interaction.trustedHand(manipulator.handId,now);if(!other)releaseManipulator("SECONDARY_LOST",true);else if(!other.interactionPinch?.on)releaseManipulator();}
  }
  function cancel(){if(anchor)endPrimary("CANCELLED");else{manipulator=null;manipulatorArming=null;}hoverId=null;sceneDirty=true;dirty=true;}
  function resetTransform(){const id=model.selected?.id;if(model.resetTransform()){action("3D TRANSFORM RESET → "+id);sceneDirty=true;dirty=true;return true;}return false;}
  function adjustDepth(amount){const id=model.selected?.id;if(model.adjustDepth(amount)){action("3D DEPTH → "+id+" · "+model.selected.position.z.toFixed(2));sceneDirty=true;dirty=true;return true;}return false;}
  function duplicate(){const object=model.duplicate();if(object){action("3D OBJECT DUPLICATED → "+object.id);sceneDirty=true;dirty=true;}return object;}
  function remove(){const id=model.selected?.id;if(id&&model.delete(id)){action("3D OBJECT DELETED → "+id);sceneDirty=true;dirty=true;return true;}return false;}
  function afterLoad(){
    cancel(); model.syncAfterLoad(); hoverId=null; lastHoverProbe="";
    for(const id of [...nodes.keys()]) disposeNode(id);
    diagnostic.selectedId=model.state.selected3DId; diagnostic.objectCount=model.objects.length;
    diagnostic.anchorHandId=null; diagnostic.manipulatorHandId=null; diagnostic.phase="IDLE";
    sceneDirty=true; dirty=true; if(active) render(performance.now(),true);
  }
  function captureLayers(){
    if(!active) return [];
    resize(true);
    const now=performance.now();
    if(backend==="WEBGL"&&renderer&&scene&&camera3D){
      if (safeWebGLRender(now)) return [webglCanvas, overlay].filter(Boolean);
      // A lost/failed WebGL context is non-fatal: export from the Canvas fallback.
    }
    render(now,true); return [overlay].filter(Boolean);
  }

  function drawFallbackObject(object,now){
    const geo=FALLBACK_GEOMETRIES[object.type]||FALLBACK_GEOMETRIES["holo-cube"],selected=object.id===model.state.selected3DId,hovered=object.id===hoverId;
    const idle=!selected&&!anchor&&idleAllowed()&&["holo-orb","holo-globe","holo-ring"].includes(object.type);
    const idleRotation=idle?Math.sin(now/2200+object.idlePhase)*4:0;
    const visual=idle?{...object,rotation:{...object.rotation,y:object.rotation.y+idleRotation}}:object;
    const verts=geo.vertices.map(v=>transformPoint(v,visual)),pts=verts.map(fallbackProject);
    if(geo.faces.length){const faces=geo.faces.map(face=>({face,z:face.reduce((s,i)=>s+verts[i].z,0)/face.length})).sort((a,b)=>a.z-b.z);
      for(const {face} of faces){overlayCtx.beginPath();face.forEach((i,n)=>n?overlayCtx.lineTo(pts[i].x,pts[i].y):overlayCtx.moveTo(pts[i].x,pts[i].y));overlayCtx.closePath();overlayCtx.fillStyle=selected?"rgba(26,180,225,.085)":"rgba(10,95,135,.045)";overlayCtx.fill();}}
    overlayCtx.lineCap="round";overlayCtx.lineJoin="round";overlayCtx.strokeStyle=selected?"rgba(106,235,255,.98)":hovered?"rgba(81,221,255,.92)":"rgba(69,219,255,.62)";overlayCtx.lineWidth=selected?1.8:hovered?1.45:1;
    for(const [a,b] of geo.edges){overlayCtx.beginPath();overlayCtx.moveTo(pts[a].x,pts[a].y);overlayCtx.lineTo(pts[b].x,pts[b].y);overlayCtx.stroke();}
    if(object.type==="holo-orb"){const center=fallbackProject(object.position);overlayCtx.beginPath();overlayCtx.arc(center.x,center.y,Math.max(2,4.5*object.scale.x),0,Math.PI*2);overlayCtx.fillStyle="rgba(130,245,255,.72)";overlayCtx.fill();}
  }
  function selectedScreenPoint() {
    const object=model.selected;if(!object)return null;
    if(backend==="WEBGL"&&THREE&&camera3D){const v=new THREE.Vector3(object.position.x,object.position.y,object.position.z).project(camera3D);return{x:(v.x*.5+.5)*cssWidth,y:(-v.y*.5+.5)*cssHeight};}
    return fallbackProject(object.position);
  }
  function drawOverlay() {
    overlayCtx.setTransform(dpr,0,0,dpr,0,0);overlayCtx.clearRect(0,0,cssWidth,cssHeight);
    if(anchor&&manipulator){const r=board?.getBoundingClientRect?.();if(r){const a={x:anchor.screen.x-r.left,y:anchor.screen.y-r.top},b={x:manipulator.screen.x-r.left,y:manipulator.screen.y-r.top};overlayCtx.strokeStyle="rgba(91,228,255,.50)";overlayCtx.lineWidth=1;overlayCtx.setLineDash([4,5]);overlayCtx.beginPath();overlayCtx.moveTo(a.x,a.y);overlayCtx.lineTo(b.x,b.y);overlayCtx.stroke();overlayCtx.setLineDash([]);}}
    if(backend==="WEBGL"&&model.selected){const p=selectedScreenPoint();if(p){overlayCtx.fillStyle="rgba(5,18,29,.82)";overlayCtx.fillRect(p.x-58,p.y+20,116,20);overlayCtx.fillStyle="#9af2ff";overlayCtx.font="10px ui-monospace, monospace";overlayCtx.textAlign="center";overlayCtx.fillText(model.selected.id+" · "+holoName(model.selected.type).replace("Holo ",""),p.x,p.y+34);}}
  }

  function render(now=performance.now(),force=false){
    if(!active||!resize())return;
    const cadence=renderCadence();
    const idle=idleAllowed()&&!anchor&&model.objects.some(o=>o.id!==model.state.selected3DId&&["holo-orb","holo-globe","holo-ring"].includes(o.type));
    if(!force&&!dirty&&!sceneDirty&&!idle)return;
    if(!force&&now-lastRender<cadence)return;
    lastRender=now;dirty=false;

    // Hover is driven from trusted hand pointers and uses WebGL raycasting when available.
    hoverId=null;
    for(const p of Object.values(state.runtime.handPointers||{})){
      if(!p.visible||p.captureKind)continue;
      const hit=hitTest(p.filtered,{padding:12});if(hit){hoverId=hit.id;break;}
    }

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
      if(anchor&&manipulator){const r=board?.getBoundingClientRect?.();if(r){const a={x:anchor.screen.x-r.left,y:anchor.screen.y-r.top},b={x:manipulator.screen.x-r.left,y:manipulator.screen.y-r.top};overlayCtx.strokeStyle="rgba(91,228,255,.45)";overlayCtx.lineWidth=1;overlayCtx.setLineDash([4,5]);overlayCtx.beginPath();overlayCtx.moveTo(a.x,a.y);overlayCtx.lineTo(b.x,b.y);overlayCtx.stroke();overlayCtx.setLineDash([]);}}
    }
    frameCount++;if(!fpsStart)fpsStart=now;if(now-fpsStart>=1000){diagnostic.renderFps=frameCount*1000/(now-fpsStart);fpsStart=now;frameCount=0;}
    diagnostic.active=active;diagnostic.selectedId=model.state.selected3DId;diagnostic.objectCount=model.objects.length;diagnostic.quality=quality();diagnostic.backend=backend==="WEBGL"?"WEBGL":"CANVAS FALLBACK";
  }

  function enter(){
    if(disposed)return;
    active=true;overlay.hidden=false;if(webglCanvas)webglCanvas.hidden=false;diagnostic.active=true;dirty=true;sceneDirty=true;
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
    const probe=pointer?`${pointer.handId}:${Math.round(pointer.filtered.x/4)}:${Math.round(pointer.filtered.y/4)}`:"";
    const idle=idleAllowed()&&!anchor&&model.objects.some(o=>o.id!==model.state.selected3DId&&["holo-orb","holo-globe","holo-ring"].includes(o.type));
    if(moving||idle||probe!==lastHoverProbe){dirty=true;sceneDirty=true;lastHoverProbe=probe;}
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
    model,diagnostic,enter,exit,tick,render,hitTest,isPointNearSelected,screenToPlane,create,select,clearSelection,startPrimary,moveAnchor,startManipulator,releaseManipulator,endPrimary,update,watchdog,cancel,resetTransform,adjustDepth,duplicate,remove,afterLoad,captureLayers,
    recover(error, reason="SPATIAL_3D_RECOVERY"){ fallBackFromWebGL(error, reason); render(performance.now(), true); return true; },
    get holding(){return Boolean(anchor);},get anchorHandId(){return anchor?.handId||null;},get manipulatorHandId(){return manipulator?.handId||manipulatorArming?.handId||null;},get selected(){return model.selected;},activeControl,
    setHover(point){hoverId=hitTest(point,{padding:12})?.id||null;sceneDirty=true;dirty=true;return hoverId;},
    tools:HOLO_TOOLS,isTool:isHoloTool,
    dispose(){
      if(disposed)return; disposed=true; cancel(); active=false;
      window?.removeEventListener?.("resize",onResize);document?.removeEventListener?.("fullscreenchange",onResize);
      for(const id of [...nodes.keys()])disposeNode(id);
      selectionBox?.geometry?.dispose?.();selectionBox?.material?.dispose?.();selectionBox=null;selectionBounds=null;
      try { renderer?.dispose?.(); } catch { /* Page teardown must remain safe. */ }
      renderer=null;scene=null;camera3D=null;raycaster=null;ndc=null;THREE=null;backend="FALLBACK";threeLoading=null;
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
