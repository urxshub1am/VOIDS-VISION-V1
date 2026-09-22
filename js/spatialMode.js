import { SpatialModel, SHAPES, PALETTE, WORKSPACE, isLine, vertices, corners, worldPoint, rotate, clamp } from "./spatialModel.js";
import { createSpatialTwoHand } from "./spatialTwoHand.js";
import { createSpatialPointers } from "./spatialPointers.js";
import { createSpatial3D } from "./spatial3D.js";
import { HOLO_TOOLS, HOLO_COLORS, MAX_IMPORTED_MODEL_ASSETS, holoName, isHoloTool } from "./spatial3DModel.js";
import { createWorkspaceProject, parseWorkspaceText, downloadProject, download2DSvg, exportWorkspacePng,
  estimateWorkspaceProjectBytes, estimateModelAssetBytes, MAX_PORTABLE_WORKSPACE_BYTES, WARN_PORTABLE_WORKSPACE_BYTES } from "./spatialPersistence.js";

const NS = "http://www.w3.org/2000/svg";
const nameOf = (type) => SHAPES.find(s => s.type === type)?.label || type;
function attributes(node, values) {
  for (const [key, value] of Object.entries(values)) {
    const next = String(value);
    if (node.getAttribute(key) !== next) node.setAttribute(key, next);
  }
}
function svgNode(name, values = {}) {
  const node = document.createElementNS(NS, name); attributes(node, values); return node;
}
function polygonPath(points) { return "M" + points.map(p => p.join(",")).join("L") + "Z"; }
function shapePath(object) {
  const w = object.width, h = object.height, x = -w / 2, y = -h / 2;
  if (isLine(object)) return `M${x} 0H${w / 2}`;
  const polygon = vertices(object.type);
  if (polygon) return polygonPath(polygon.map(([px, py]) => [px * w, py * h]));
  if (["circle", "ellipse"].includes(object.type)) return `M${x} 0a${w / 2} ${h / 2} 0 1 0 ${w} 0a${w / 2} ${h / 2} 0 1 0 ${-w} 0`;
  if (object.type === "database") {
    const r = Math.min(20, h * 0.14);
    return `M${x} ${y + r}a${w / 2} ${r} 0 0 1 ${w} 0v${h - 2 * r}a${w / 2} ${r} 0 0 1 ${-w} 0Z M${x} ${y + r}a${w / 2} ${r} 0 0 0 ${w} 0`;
  }
  const r = object.type === "terminal" ? h / 2 : ["rounded", "process"].includes(object.type) ? Math.min(18, h / 5) : 0;
  return `M${x + r} ${y}H${w / 2 - r}Q${w / 2} ${y} ${w / 2} ${y + r}V${h / 2 - r}Q${w / 2} ${h / 2} ${w / 2 - r} ${h / 2}H${x + r}Q${x} ${h / 2} ${x} ${h / 2 - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}
function arrowPath(object) {
  if (!isLine(object) || object.arrows === "none") return "";
  const length = Math.min(object.width / 3, 12 + object.strokeWidth * 2), half = length * 0.45, end = object.width / 2;
  let path = polygonPath([[end, 0], [end - length, -half], [end - length, half]]);
  if (object.arrows === "both") path += polygonPath([[-end, 0], [-end + length, -half], [-end + length, half]]);
  return path;
}
function wrapText(value, width, fontSize) {
  const count = Math.max(3, Math.floor(width / (fontSize * 0.6))), lines = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && (line + " " + word).length > count) { lines.push(line); line = ""; }
      let rest = word;
      while (rest.length > count) { if (line) { lines.push(line); line = ""; } lines.push(rest.slice(0, count)); rest = rest.slice(count); }
      line += (line ? " " : "") + rest;
    }
    lines.push(line);
  }
  return lines;
}

// Receives granted per-ID captures. Geometry/history remain in SpatialModel.
export function createSpatialMode(context) {
  const { state, ui, video, action, notify, manualAllowed, interaction } = context;
  const model = new SpatialModel(), data = state.runtime.modeData.spatial = model.state;
  const panel = ui.element("mode-spatial"), surface = ui.element("spatial-surface"), world = ui.element("spatial-world"), board = ui.element("spatial-board");
  const objectLayer = ui.element("spatial-objects"), selectionLayer = ui.element("spatial-selection");
  const cameraCanvas = ui.element("spatial-camera"), cameraContext = cameraCanvas.getContext("2d");
  const textInput = ui.element("spatial-text-input"), name3DInput = ui.element("spatial-3d-name-input"), scene3DList = ui.element("spatial-3d-scene-list"), projectFile = ui.element("spatial-project-file"), imageFile = ui.element("spatial-image-file"), modelFile = ui.element("spatial-model-file"), modelDrop = ui.element("spatial-model-dropzone"), loadNotice = ui.element("spatial-load-confirmation");
  const nodes = new Map(), handles = new Map();
  let layoutDirty = true, frameMatrix = null, readingFrame = false;
  const screenMatrix = () => readingFrame ? frameMatrix : surface.getScreenCTM();
  const markLayout = () => { layoutDirty = true; };
  const layoutObserver = new ResizeObserver(markLayout); layoutObserver.observe(surface);
  document.addEventListener("fullscreenchange", markLayout);
  window.addEventListener("resize", markLayout);
  const outline = svgNode("path", { class: "spatial-selection-outline", "pointer-events": "none", "vector-effect": "non-scaling-stroke" });
  const stem = svgNode("path", { class: "spatial-rotation-stem", "pointer-events": "none", "vector-effect": "non-scaling-stroke" });
  const guides = [svgNode("line", { class: "spatial-alignment-guide", "pointer-events": "none" }),
    svgNode("line", { class: "spatial-alignment-guide", "pointer-events": "none" })];
  const magneticZone = svgNode("circle", { class: "spatial-magnetic-zone", "pointer-events": "none", "vector-effect": "non-scaling-stroke" });
  selectionLayer.append(...guides, outline, stem, magneticZone);
  for (const key of ["nw", "ne", "se", "sw", "rotate", "a", "b"]) {
    const handle = svgNode("g", { "data-gesture-target": "", "data-spatial-handle": key,
      "aria-label": key === "rotate" ? "Rotate selected object" : ["a", "b"].includes(key) ? "Connector endpoint " + key.toUpperCase() : "Resize " + key.toUpperCase(), tabindex: "0", role: "button", class: "spatial-handle" });
    const hit = svgNode("circle", { fill: "transparent", "pointer-events": "all" });
    const dot = svgNode("circle", { class: "spatial-handle-dot", "pointer-events": "none", "vector-effect": "non-scaling-stroke" });
    handle.append(hit, dot); selectionLayer.append(handle); handles.set(key, { handle, hit, dot });
  }
  let active = false, revision = -1, scaleKey = "", selectedTextId = null, pendingLoad = null, scene3DKey = "";
  let nativeId = null, owner = null, panDrag = null, lastBackgroundAt = 0, lastVideoFrame = -1;
  const pointers = createSpatialPointers({ state, data, interaction });
  const holo3D = createSpatial3D({ state, spatialModel: model, action, interaction, ui, notify });
  const twoHand = createSpatialTwoHand({ state, model, action, viewContext, interaction,
    toWorld: point => point && coordinates(point)?.world,
    joinTarget, workspaceTarget,
    beforeWorkspace() { finish(); },
    onManipulatorJoin: pointers.lockSecondary, onManipulatorExit: pointers.releaseSecondary });
  state.runtime.modeData.spatialPointer = { status: "Either hand may aim and grab" };
  const activeControl = () => holo3D.holding ? holo3D.activeControl() : data.twoHand;

  function viewContext() {
    if (!active || !allowed() || data.editing || nativeId !== null) return null;
    const matrix = screenMatrix(), width = video.videoWidth, height = video.videoHeight;
    if (!matrix || !width || !height) return null;
    return { width, height, key: [width, height, state.settings.cameraMirror,
      matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(":") };
  }
  function workspaceTarget() {
    if (twoHand.holding || holo3D.holding || !["select", "pan"].includes(data.tool) || data.pendingDeleteId || data.pending3DDeleteId || data.editing || nativeId !== null) return false;
    const ids = [state.spatial.primaryHandId, state.spatial.secondaryHandId];
    return ids.every(id => {
      const pointer = state.runtime.handPointers?.[id];
      if (!pointer?.visible || !pointer.armed) return false;
      const target = ui.hitTarget(pointer.filtered.x, pointer.filtered.y), p = coordinates(pointer.filtered);
      return target && surface.contains(target) && p && p.view.x >= 0 && p.view.y >= 0 &&
        p.view.x <= WORKSPACE.width && p.view.y <= WORKSPACE.height &&
        (data.tool === "pan" || (!target.closest("[data-spatial-object], [data-spatial-handle]") && !holo3D.hitTest(pointer.filtered, { padding: 18 })));
    });
  }
  function joinTarget(position, id) {
    if (!position) return null;
    const target = ui.hitTarget(position.x, position.y), p = coordinates(position), object = model.get(id);
    if (!object || !p || !target || !surface.contains(target)) return null;
    const hitId = target.closest("[data-spatial-object]")?.dataset.spatialObject;
    if (hitId && hitId !== id) return { kind: "DIFFERENT" };
    const local = rotate({ x: p.world.x - object.x, y: p.world.y - object.y }, -object.rotation);
    const pad = (state.settings.magneticAimAssist !== false ? 24 : 10) / scale();
    const near = (point, tolerance = pad) => Math.hypot(local.x - point.x, local.y - point.y) <= tolerance;
    const rotation = { x: 0, y: -(object.height / 2 + 32 / scale()) };
    if (near(rotation)) return { kind: "ROTATION", key: "rotation", point: worldPoint(object, rotation) };
    if (!isLine(object)) {
      for (const [x, y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        const point = { x: x * object.width / 2, y: y * object.height / 2 };
        if (near(point)) return { kind: "CORNER", key: x + ":" + y, axes: [x,y], point: worldPoint(object, point) };
      }
      for (const [kind,x,y] of [["LEFT_EDGE",-1,0],["RIGHT_EDGE",1,0],["TOP_EDGE",0,-1],["BOTTOM_EDGE",0,1]]) {
        const edge = { x: x ? x * object.width / 2 : clamp(local.x, -object.width / 2, object.width / 2),
          y: y ? y * object.height / 2 : clamp(local.y, -object.height / 2, object.height / 2) };
        if (near(edge)) return { kind, key: kind, axes: [x,y], point: worldPoint(object, edge) };
      }
    }
    if (Math.abs(local.x) <= object.width / 2 + pad && Math.abs(local.y) <= object.height / 2 + pad)
      return { kind: "BODY", key: "body", point: { ...p.world } };
    return null;
  }

  function coordinates(point) {
    const matrix = screenMatrix();
    if (!matrix) return null;
    // The inverse CTM includes responsive SVG letterboxing and browser fullscreen scale.
    const local = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
    return { view: { x: local.x, y: local.y }, world: { x: (local.x - data.pan.x) / data.zoom,
      y: (local.y - data.pan.y) / data.zoom } };
  }
  function scale() {
    const m = screenMatrix();
    return m ? Math.max(0.01, Math.hypot(m.a, m.b) * data.zoom) : 1;
  }
  function markSelection(id) {
    const old = data.selectedId; model.select(id);
    if (data.selectedId && data.selectedId !== old) action("OBJECT SELECTED → " + data.selectedId);
  }
  function begin(target, position, input, forcePan = false, event = null) {
    const p = coordinates(position); if (!p) return "consume";
    if (forcePan || data.tool === "pan") {
      owner = input; panDrag = { handId: event?.handId || null, point: p.view, original: { ...data.pan } };
      data.manipulation = "pan"; data.status = "PANNING"; model.changed(); paint(); return "drag";
    }
    if (isHoloTool(data.tool)) {
      const object = holo3D.create(data.tool, position);
      if (!object) notify("The 3D workspace holds up to 24 holograms. Delete one before adding another.");
      data.tool = "select"; paint(); render(); return "consume";
    }
    if (SHAPES.some(s => s.type === data.tool)) {
      if (p.world.x < 0 || p.world.y < 0 || p.world.x > WORKSPACE.width || p.world.y > WORKSPACE.height) {
        notify("Place shapes inside the outlined board, or reset the view."); return "consume";
      }
      holo3D.clearSelection();
      const object = model.create(data.tool, p.world);
      if (object) action("SHAPE CREATED → " + nameOf(object.type).toUpperCase());
      else notify("The workspace holds up to 120 objects. Delete an object before adding another.");
      paint(); render(); return "consume";
    }
    const handle = target.closest("[data-spatial-handle]")?.dataset.spatialHandle;
    const id = handle ? data.selectedId : target.closest("[data-spatial-object]")?.dataset.spatialObject;
    if (!id) {
      const hit3D = holo3D.hitTest(position, { padding: 20 });
      if (hit3D) {
        markSelection(null); holo3D.select(hit3D.id);
        if (hit3D.locked) { action("3D OBJECT SELECTED · LOCKED → " + hit3D.id); paint(); render(); return "consume"; }
        const started3D = holo3D.startPrimary({ handId: event?.handId || null, screenPoint: position, now: event?.at || performance.now(), mouse: input === "mouse" });
        if (started3D) { owner = input; paint(); render(); return "drag"; }
        paint(); render(); return "consume";
      }
      markSelection(null); holo3D.clearSelection(); paint(); render(); return "consume";
    }
    holo3D.clearSelection(); markSelection(id);
    const kind = handle === "rotate" ? "rotate" : ["a", "b"].includes(handle) ? "endpoint" : handle ? "resize" : "move";
    const corner = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[handle] || handle;
    const started = input === "gesture"
      ? twoHand.startPrimary({ handId: event.handId, objectId: id, kind, handle: corner, point: p.world, now: event.at })
      : model.start(id, kind, p.world, corner);
    if (!started) return "consume";
    owner = input;
    paint(); render(); return "drag";
  }
  function move(position) {
    if (holo3D.holding && owner === "mouse") { holo3D.moveAnchor(position); holo3D.render(performance.now(), true); return; }
    const p = coordinates(position); if (!p) { finish(); return; }
    if (panDrag) model.pan({ x: panDrag.original.x + p.view.x - panDrag.point.x, y: panDrag.original.y + p.view.y - panDrag.point.y });
    else model.move(p.world, { threshold: 2 / scale(), portTolerance: 16 / scale() });
    paint();
  }
  function finish() {
    if (holo3D.holding && owner === "mouse") holo3D.endPrimary("MOUSE_RELEASE");
    const result = model.finish();
    if (result?.changed) action(({ move: "OBJECT MOVED", resize: "OBJECT RESIZED", rotate: "OBJECT ROTATED", endpoint: "CONNECTOR UPDATED" }[result.kind]) + " → " + result.id);
    if (panDrag) { panDrag = null; data.manipulation = null; data.status = model.selected || holo3D.selected ? "SELECTED" : "READY"; model.changed(); }
    owner = null;
    const id = nativeId; nativeId = null;
    if (id !== null && surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id);
    paint();
  }
  function cancel() {
    twoHand.cancel(); holo3D.cancel();
    for (const p of Object.values(state.runtime.handPointers || {})) {
      if (p.owner === "spatial") interaction.release(p.handId, "CANCELLED", false);
    }
    pointers.cancel(); finish();
  }
  function allowed() { return active && state.currentMode === "spatial" && manualAllowed(); }
  surface.addEventListener("pointerdown", (event) => {
    if (!allowed() || data.editing || nativeId !== null || ![0, 1].includes(event.button)) return;
    event.preventDefault(); cancel();
    const result = begin(event.target, { x: event.clientX, y: event.clientY }, "mouse", event.button === 1);
    surface.focus({ preventScroll: true });
    if (result === "drag") { nativeId = event.pointerId; surface.setPointerCapture(event.pointerId); }
  });
  surface.addEventListener("pointermove", (event) => {
    if (event.pointerId !== nativeId) return;
    if (!allowed()) { cancel(); return; }
    move({ x: event.clientX, y: event.clientY });
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) surface.addEventListener(name, (event) => {
    if (event.pointerId === nativeId) { finish(); render(); }
  });
  surface.addEventListener("wheel", (event) => {
    if (!allowed() || data.manipulation || data.editing || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault(); interaction.cancel("VIEW_CHANGED");
    if (model.zoom(data.zoom + (event.deltaY < 0 ? 0.1 : -0.1))) { action("ZOOM → " + Math.round(data.zoom * 100) + "%"); paint(); render(); }
  }, { passive: false });
  textInput.addEventListener("focus", () => { cancel(); data.editing = true; });
  textInput.addEventListener("blur", () => { data.editing = false; interaction.cancel("TEXT_EDIT_ENDED"); });
  textInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); textInput.value = model.selected?.text || "";
      delete textInput.dataset.draft; textInput.blur();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); onAction("spatial-apply-text");
    }
  });

  function buildPalette() {
    const library = ui.element("spatial-library");
    // Idempotent rebuild: a runtime recovery or DOM pressure event must never
    // leave the tool library as an empty shell.
    library.replaceChildren();
    ui.element("spatial-3d-colors")?.replaceChildren();
    ui.element("spatial-stroke-colors")?.replaceChildren();
    ui.element("spatial-fill-colors")?.replaceChildren();
    for (const group of ["basic", "diagram"]) {
      const label = document.createElement("h3"); label.className = "section-label";
      label.textContent = group === "basic" ? "BASIC SHAPES" : "DIAGRAM / FLOW"; library.append(label);
      for (const definition of SHAPES.filter(s => s.category === group)) {
        const button = document.createElement("button");
        attributes(button, { type: "button", class: "button spatial-tool", "data-gesture-target": "", "data-action": "spatial-tool", "data-value": definition.type, "aria-pressed": "false" });
        const icon = svgNode("svg", { viewBox: "-60 -45 120 90", "aria-hidden": "true" });
        const object = { ...definition, width: 90, height: definition.height ? 60 : 0, strokeWidth: 2,
          arrows: definition.type === "double-connector" ? "both" : definition.type === "arrow" ? "end" : "none" };
        icon.append(svgNode("path", { d: shapePath(object), fill: definition.height ? "#102b40" : "none", stroke: "currentColor", "stroke-width": "3" }),
          svgNode("path", { d: arrowPath(object), fill: "currentColor" }));
        const text = document.createElement("span"); text.textContent = definition.label; button.append(icon, text); library.append(button);
      }
    }
    const holoLabel = document.createElement("h3"); holoLabel.className = "section-label"; holoLabel.textContent = "3D / HOLOGRAMS"; library.append(holoLabel);
    for (const definition of HOLO_TOOLS.filter(tool => !tool.importOnly)) {
      const button = document.createElement("button");
      attributes(button, { type: "button", class: "button spatial-tool spatial-holo-tool", "data-gesture-target": "", "data-action": "spatial-tool", "data-value": definition.type, "aria-pressed": "false" });
      const icon = document.createElement("span"); icon.className = "spatial-holo-icon"; icon.textContent = ({
        "holo-cube": "◇", "holo-orb": "◉", "holo-ring": "◎", "holo-pyramid": "△", "holo-globe": "◌", "holo-panels": "▱",
        "holo-cylinder": "⬡", "holo-diamond": "◆", "holo-knot": "∞", "holo-beacon": "⌁"
      })[definition.type] || "◇";
      const text = document.createElement("span"); text.textContent = definition.label; button.append(icon, text); library.append(button);
    }
    const holoPalette = ui.element("spatial-3d-colors");
    for (const color of HOLO_COLORS) {
      const button = document.createElement("button");
      attributes(button, { type: "button", class: "button spatial-swatch spatial-holo-swatch", "data-gesture-target": "", "data-spatial-3d-selected": "",
        "data-action": "spatial-3d-color", "data-value": color, "aria-label": "Hologram color " + color, "aria-pressed": "false", title: "Hologram color " + color });
      const swatch = document.createElement("span"); swatch.style.background = color; button.append(swatch); holoPalette?.append(button);
    }
    for (const property of ["stroke", "fill"]) {
      const palette = ui.element("spatial-" + property + "-colors");
      for (const color of property === "fill" ? [...PALETTE, "none"] : PALETTE) {
        const button = document.createElement("button");
        attributes(button, { type: "button", class: "button spatial-swatch", "data-gesture-target": "", "data-spatial-selected": "",
          "data-action": "spatial-color", "data-property": property, "data-value": color, "aria-label": property + " " + color, "aria-pressed": "false", title: property + " " + color });
        const swatch = document.createElement("span"); swatch.style.background = color === "none" ? "transparent" : color;
        swatch.textContent = color === "none" ? "∅" : ""; button.append(swatch); palette.append(button);
      }
    }
  }
  function ensurePalette() {
    const library = ui.element("spatial-library");
    if (!library?.querySelector?.('[data-action="spatial-tool"]')) {
      buildPalette();
      action("SPATIAL TOOL LIBRARY RESTORED");
    }
  }
  function makeObject(object) {
    const group = svgNode("g", { "data-gesture-target": "", "data-spatial-object": object.id, "aria-label": nameOf(object.type) + " " + object.id, tabindex: "0", role: "button", class: "spatial-object" });
    // A filled transparent area gives horizontal lines a nonzero SVG bounding box.
    // A thick stroke alone is insufficient for bounding-box-based hover validation.
    const hit = svgNode("path", { fill: "transparent", stroke: "none", "pointer-events": "all" });
    const body = svgNode("path", { "pointer-events": isLine(object) ? "stroke" : "all" });
    const arrows = svgNode("path", { "pointer-events": "none" });
    const label = svgNode("text", { "text-anchor": "middle", "pointer-events": "none", fill: "#edf6ff", "font-family": "Segoe UI, system-ui, sans-serif" });
    group.append(hit, body, arrows, label); objectLayer.append(group);
    const record = { group, hit, body, arrows, label, signature: "" }; nodes.set(object.id, record); return record;
  }
  function paintObject(object, record) {
    const signature = JSON.stringify(object); if (record.signature === signature) return;
    record.signature = signature;
    attributes(record.group, { transform: `translate(${object.x} ${object.y}) rotate(${object.rotation})`, opacity: object.opacity });
    attributes(record.body, { d: shapePath(object), fill: isLine(object) || object.fill === "none" ? "transparent" : object.fill,
      stroke: object.stroke, "stroke-width": object.strokeWidth, "stroke-dasharray": object.dashed ? "8 5" : "none", "stroke-linejoin": "round", "stroke-linecap": "round" });
    attributes(record.arrows, { d: arrowPath(object), fill: object.stroke });
    attributes(record.label, { "font-size": object.fontSize });
    const labelWidth = ["decision", "diamond"].includes(object.type) ? 0.72
      : ["triangle", "star"].includes(object.type) ? 0.48 : 0.8;
    const width = object.width * labelWidth;
    const maxLines = isLine(object) ? 2 : Math.max(1, Math.min(8, Math.floor(object.height * 0.65 / (object.fontSize * 1.2))));
    const all = wrapText(object.text, width, object.fontSize), lines = all.slice(0, maxLines);
    if (all.length > maxLines) lines[lines.length - 1] += "…";
    const labelKey = JSON.stringify([lines, object.fontSize, object.type]);
    if (record.labelKey !== labelKey) {
      record.labelKey = labelKey; record.label.replaceChildren();
      lines.forEach((line, i) => {
        const tspan = svgNode("tspan", { x: 0, y: (i - (lines.length - 1) / 2) * object.fontSize * 1.2 + object.fontSize * 0.34 - (isLine(object) ? object.fontSize : object.type === "callout" ? object.height * 0.1 : 0) });
        tspan.textContent = line; record.label.append(tspan);
      });
    }
  }
  function paintSelection() {
    const object = model.selected, zoomScale = scale();
    selectionLayer.style.display = object ? "" : "none";
    if (!object) return;
    attributes(selectionLayer, { "data-grabbed": String(Boolean(data.manipulation && !panDrag)) });
    const alignment = model.alignmentGuides(5 / zoomScale);
    guides.forEach((line, index) => {
      const guide = alignment[index]; line.style.display = guide ? "" : "none";
      if (guide) attributes(line, guide.axis === "x" ? { x1: guide.value, x2: guide.value, y1: 0, y2: WORKSPACE.height }
        : { x1: 0, x2: WORKSPACE.width, y1: guide.value, y2: guide.value });
    });
    const zone = data.twoHand?.joinZone;
    magneticZone.style.display = zone?.point && data.twoHand.phase === "SECONDARY_ARMING" ? "" : "none";
    if (zone?.point) attributes(magneticZone, { cx: zone.point.x, cy: zone.point.y, r: 16 / zoomScale });
    const positions = {};
    let rotationBase;
    if (isLine(object)) {
      positions.a = object.a; positions.b = object.b; rotationBase = { x: object.x, y: object.y };
      attributes(outline, { d: `M${object.a.x} ${object.a.y}L${object.b.x} ${object.b.y}` });
    } else {
      const points = corners(object); ["nw", "ne", "se", "sw"].forEach((key, i) => { positions[key] = points[i]; });
      attributes(outline, { d: polygonPath(points.map(p => [p.x, p.y])) });
      rotationBase = worldPoint(object, { x: 0, y: -object.height / 2 });
    }
    // Handle sizes stay comfortable in screen pixels at every zoom level.
    positions.rotate = worldPoint(object, { x: 0, y: -(object.height / 2 + 32 / zoomScale) });
    attributes(stem, { d: `M${rotationBase.x} ${rotationBase.y}L${positions.rotate.x} ${positions.rotate.y}` });
    for (const [key, parts] of handles) {
      const p = positions[key]; parts.handle.style.display = p ? "" : "none";
      if (!p) continue;
      attributes(parts.handle, { transform: `translate(${p.x} ${p.y})` });
      attributes(parts.hit, { r: 13 / zoomScale }); attributes(parts.dot, { r: (key === "rotate" ? 7 : 6) / zoomScale });
    }
  }
  function paint() {
    if (!active || revision === data.revision && !layoutDirty) return;
    const viewScale = scale(), nextScale = String(viewScale);
    if (revision === data.revision && scaleKey === nextScale) { layoutDirty = false; return; }
    revision = data.revision; scaleKey = nextScale; layoutDirty = false;
    attributes(world, { transform: `translate(${data.pan.x} ${data.pan.y}) scale(${data.zoom})` });
    ui.element("spatial-grid-lines").style.display = data.grid ? "" : "none";
    const ids = new Set(data.objects.map(o => o.id));
    for (const [id, record] of nodes) if (!ids.has(id)) { record.group.remove(); nodes.delete(id); }
    for (let i = 0; i < data.objects.length; i++) {
      const object = data.objects[i], record = nodes.get(object.id) || makeObject(object);
      paintObject(object, record);
      const pad = 11 / viewScale;
      attributes(record.hit, { d: isLine(object) ? polygonPath([
        [-object.width / 2, -pad], [object.width / 2, -pad],
        [object.width / 2, pad], [-object.width / 2, pad]
      ]) : "" });
      if (objectLayer.children[i] !== record.group) objectLayer.insertBefore(record.group, objectLayer.children[i] || null);
    }
    paintSelection();
  }
  function renderBackground() {
    const enabled = data.background === "camera";
    cameraCanvas.hidden = !enabled;
    ui.element("spatial-background-note").hidden = !enabled || state.camera.active;
    if (!cameraContext) return;
    const reduced = state.settings.visualEffects === "reduced" ||
      (state.settings.autoPerformanceMode && state.performance.effectsReduced);
    const width = reduced ? 600 : 1200, height = reduced ? 400 : 800;
    if (cameraCanvas.width !== width) cameraCanvas.width = width;
    if (cameraCanvas.height !== height) cameraCanvas.height = height;
    cameraContext.clearRect(0, 0, width, height);
    if (!enabled || !state.camera.active || video.readyState < 2 || !video.videoWidth) return;
    const ratio = Math.min(width / video.videoWidth, height / video.videoHeight);
    const w = video.videoWidth * ratio, h = video.videoHeight * ratio;
    cameraContext.save();
    if (state.settings.cameraMirror) { cameraContext.translate(width, 0); cameraContext.scale(-1, 1); }
    cameraContext.drawImage(video, (width - w) / 2, (height - h) / 2, w, h); cameraContext.restore();
  }
  function render3DSceneList() {
    if (!scene3DList) return;
    const selectedId = data.selected3DId || null;
    const key = (data.objects3D || []).map(object => [object.id, object.name || holoName(object.type), object.visible === false ? 0 : 1, object.locked ? 1 : 0, object.id === selectedId ? 1 : 0].join(":" )).join("|");
    if (key === scene3DKey) return;
    scene3DKey = key; scene3DList.replaceChildren();
    const objects = data.objects3D || [];
    if (!objects.length) {
      const empty = document.createElement("p"); empty.className = "spatial-scene-empty"; empty.textContent = "No 3D objects yet."; scene3DList.append(empty); return;
    }
    for (const object of [...objects].reverse()) {
      const row = document.createElement("div"); row.className = "spatial-scene-row"; row.dataset.selected = String(object.id === selectedId);
      const select = document.createElement("button"); select.type = "button"; select.className = "spatial-scene-select"; select.dataset.action = "spatial-3d-select"; select.dataset.value = object.id; select.setAttribute("data-gesture-target", "");
      const title = document.createElement("strong"); title.textContent = object.name || holoName(object.type);
      const meta = document.createElement("span"); meta.textContent = `${object.id} · ${holoName(object.type).replace("Holo ", "")}`; select.append(title, meta);
      const visibility = document.createElement("button"); visibility.type = "button"; visibility.className = "button spatial-scene-icon"; visibility.dataset.action = "spatial-3d-scene-visibility"; visibility.dataset.value = object.id; visibility.setAttribute("data-gesture-target", ""); visibility.setAttribute("aria-label", `${object.visible === false ? "Show" : "Hide"} ${object.name || object.id}`); visibility.setAttribute("aria-pressed", String(object.visible !== false)); visibility.textContent = object.visible === false ? "SHOW" : "EYE";
      const lock = document.createElement("button"); lock.type = "button"; lock.className = "button spatial-scene-icon"; lock.dataset.action = "spatial-3d-scene-lock"; lock.dataset.value = object.id; lock.setAttribute("data-gesture-target", ""); lock.setAttribute("aria-label", `${object.locked ? "Unlock" : "Lock"} ${object.name || object.id}`); lock.setAttribute("aria-pressed", String(Boolean(object.locked))); lock.textContent = object.locked ? "LOCK" : "FREE";
      row.append(select, visibility, lock); scene3DList.append(row);
    }
  }

  function render() {
    ensurePalette();
    const selected = model.selected, selected3D = holo3D.selected;
    const optionalText = (id, value) => { if (ui.element(id)) ui.setText(id, value); };
    ui.setText("spatial-workspace-status", state.runtime.paused ? "PAUSED" : data.editing ? (document.activeElement === name3DInput ? "EDITING 3D NAME" : "EDITING TEXT") : data.status);
    ui.setText("spatial-selected-name", selected ? selected.id + " · " + nameOf(selected.type) : selected3D ? selected3D.id + " · " + (selected3D.name || holoName(selected3D.type)) : "No object selected");
    ui.setText("spatial-object-count", data.objects.length + " 2D · " + (data.objects3D?.length || 0) + " 3D");
    render3DSceneList();
    const sceneStats = holo3D.sceneStats();
    optionalText("spatial-3d-scene-stats", `${sceneStats.visible}/${sceneStats.objects} visible · ${sceneStats.locked} locked${sceneStats.triangles == null ? "" : ` · ${sceneStats.meshes} meshes · ${sceneStats.triangles.toLocaleString()} tri`}`);
    optionalText("spatial-3d-gesture-mode", String(state.settings.spatial3DTransformMode || "auto").toUpperCase());
    optionalText("spatial-3d-gesture-status", holo3D.holding
      ? (holo3D.diagnostic.trackingGuard && holo3D.diagnostic.trackingGuard !== "READY"
        ? holo3D.diagnostic.trackingGuard : (holo3D.diagnostic.transformIntent || "MOVE"))
      : "IDLE");
    for (const button of panel.querySelectorAll('[data-preference="spatial3DTransformMode"]'))
      attributes(button, { "aria-pressed": String(button.dataset.value === (state.settings.spatial3DTransformMode || "auto")) });
    ui.setText("spatial-tool-name", data.tool === "select" ? "SELECT / GRAB" : data.tool === "pan" ? "PAN VIEW" : "PLACE → " + (isHoloTool(data.tool) ? holoName(data.tool) : nameOf(data.tool)).toUpperCase());
    ui.setText("spatial-zoom-value", Math.round(data.zoom * 100) + "%");
    const control = holo3D.holding ? holo3D.diagnostic : data.twoHand, cursorData = data.pointers;
    const pinching = pinch => pinch?.confirmed ? "ACTIVE" : pinch?.raw ? "CONFIRMING" : "OPEN";
    ui.setText("spatial-primary-pinch", cursorData.primary.visible ? pinching(cursorData.primary.pinch) : "--");
    ui.setText("spatial-secondary-pinch", cursorData.secondary.visible ? pinching(cursorData.secondary.pinch) : "--");
    if (holo3D.holding) {
      ui.setText("spatial-both-pinch", holo3D.diagnostic.manipulatorHandId ? "3D LOCKED" : "3D ANCHOR ACTIVE");
      attributes(ui.element("spatial-two-hand-feedback"), { "data-locked": String(Boolean(holo3D.diagnostic.manipulatorHandId)) });
      const intent3D = holo3D.diagnostic.transformIntent || "NONE";
      const trackingGuard = holo3D.diagnostic.trackingGuard || "READY";
      ui.setText("spatial-two-hand-message", trackingGuard.includes("REACQUIR") || trackingGuard.includes("RECOVERY")
        ? `${trackingGuard} · transform frozen · keep the pinch steady`
        : trackingGuard.includes("RESUMED")
          ? `${trackingGuard} · fresh baseline applied · continue motion`
          : holo3D.diagnostic.manipulatorHandId
            ? intent3D === "WAITING" ? "FREE HAND JOINED · move deliberately to choose SCALE or ROTATE"
            : `3D ${intent3D} LOCKED · free hand controls transform · Anchor moves XY`
            : "3D ANCHOR LOCKED · pinch other hand anywhere to transform");
      ui.setText("spatial-two-hand-values", holo3D.diagnostic.manipulatorHandId ? holo3D.diagnostic.scaleRatio.toFixed(2) + "× · Y " + Math.round(holo3D.diagnostic.yaw) + "° · P " + Math.round(holo3D.diagnostic.pitch) + "° · R " + Math.round(holo3D.diagnostic.roll) + "°" : "");
      ui.setText("spatial-transform-intent", holo3D.diagnostic.manipulatorHandId ? "3D " + intent3D : "3D MOVE");
      ui.setText("spatial-transform-size", selected3D ? selected3D.scale.x.toFixed(2) + "× · Z " + selected3D.position.z.toFixed(2) : "--");
    } else {
      ui.setText("spatial-both-pinch", ["SECONDARY_ARMING", "WORKSPACE_ARMING"].includes(control.phase) ? "ARMING " + Math.round(control.progress * 100) + "%"
        : ["DUAL_TRANSFORM", "TWO_HAND_WORKSPACE"].includes(control.phase) ? "LOCKED" : control.anchorHandId ? "ANCHOR ACTIVE" : "AIM / GRAB");
      attributes(ui.element("spatial-two-hand-feedback"), { "data-locked": String(control.phase === "DUAL_TRANSFORM" || control.phase === "TWO_HAND_WORKSPACE") });
      ui.setText("spatial-two-hand-message", control.message);
      ui.setText("spatial-two-hand-values", Number.isFinite(control.appliedScale) ? control.appliedScale.toFixed(2) + "× · " + Math.round((control.appliedAngle || 0) * 180 / Math.PI) + "°" + (control.limited ? " · LIMIT" : "") : "");
      ui.setText("spatial-transform-intent", control.anchorHandId || twoHand.exclusive ? control.intent || "MOVE" : "NONE");
      ui.setText("spatial-transform-size", selected ? Math.round(selected.width) + " × " + Math.round(selected.height) : "--");
    }
    ui.setText("spatial-grid", data.grid ? "Grid ON" : "Grid OFF");
    ui.setText("spatial-snap", data.snap ? "Snap ON" : "Snap OFF");
    ui.setText("spatial-background", data.background === "camera" ? "Camera background ON" : "Camera background OFF");
    for (const key of ["grid", "snap", "background"]) attributes(ui.element("spatial-" + key), { "aria-pressed": String(key === "background" ? data.background === "camera" : data[key]) });
    for (const button of panel.querySelectorAll('[data-action="spatial-tool"]')) attributes(button, { "aria-pressed": String(data.tool === button.dataset.value) });
    for (const button of panel.querySelectorAll("[data-spatial-selected]")) button.disabled = !selected;
    for (const button of panel.querySelectorAll("[data-spatial-3d-selected]")) button.disabled = !selected3D;
    for (const button of panel.querySelectorAll("[data-spatial-3d-transform]")) button.disabled = !selected3D || Boolean(selected3D?.locked) || selected3D?.visible === false;
    const focus3D = panel.querySelector('[data-action="spatial-3d-focus"]');
    if (focus3D) focus3D.disabled = !selected3D || selected3D.visible === false;
    ui.element("spatial-arrows").disabled = !selected || !isLine(selected);
    ui.setText("spatial-arrows", "Arrows: " + (selected?.arrows || "none"));
    ui.setText("spatial-dashed", selected?.dashed ? "Dashed line" : "Solid line");
    ui.setText("spatial-width-value", selected ? selected.strokeWidth + " px" : "--");
    ui.setText("spatial-opacity-value", selected ? Math.round(selected.opacity * 100) + "%" : "--");
    ui.setText("spatial-font-value", selected ? selected.fontSize + " px" : "--");
    optionalText("spatial-3d-position", selected3D ? `${selected3D.position.x.toFixed(2)}, ${selected3D.position.y.toFixed(2)}, ${selected3D.position.z.toFixed(2)}` : "--");
    optionalText("spatial-3d-rotation", selected3D ? `${Math.round(selected3D.rotation.x)}°, ${Math.round(selected3D.rotation.y)}°, ${Math.round(selected3D.rotation.z)}°` : "--");
    optionalText("spatial-3d-scale", selected3D ? selected3D.scale.x.toFixed(2) + "×" : "--");
    optionalText("spatial-3d-appearance", selected3D ? `${selected3D.color || "#45dbff"} · glow ${Math.round((selected3D.glow ?? .7) * 100)}% · opacity ${Math.round((selected3D.opacity ?? .82) * 100)}%` : "--");
    optionalText("spatial-3d-image-name", selected3D?.type === "holo-image" ? (selected3D.image?.name || "Imported image") : selected3D?.type === "holo-model" ? (selected3D.model?.name || "Imported 3D model") : "--");
    const selectedModelStatus = selected3D?.type === "holo-model" ? (holo3D.modelStatus(selected3D.id) || "LOADING") : null;
    const selectedModelError = selected3D?.type === "holo-model" ? holo3D.modelError(selected3D.id) : null;
    optionalText("spatial-3d-model-status", selected3D?.type === "holo-model" ? `${selectedModelStatus} · ${String(selected3D.model?.format || "GLB").toUpperCase()} · ${Math.round((selected3D.model?.byteLength || 0) / 1024)} KB · ${selected3D.model?.animations || 0} animation(s) · assets ${holo3D.importedAssetCount}/${MAX_IMPORTED_MODEL_ASSETS}${selectedModelError ? ` · ${selectedModelError.slice(0, 90)}` : ""}` : "--");
    const selectedStats = selected3D ? holo3D.nodeStats(selected3D.id) : null;
    optionalText("spatial-3d-geometry", selected3D ? (selectedStats?.triangles == null ? "Renderer data pending / fallback" : `${selectedStats.meshes} mesh(es) · ${selectedStats.triangles.toLocaleString()} triangles`) : "--");
    optionalText("spatial-3d-glow-value", selected3D ? Math.round((selected3D.glow ?? .7) * 100) + "%" : "--");
    optionalText("spatial-3d-lock-value", selected3D ? (selected3D.locked ? "LOCKED" : "UNLOCKED") : "--");
    optionalText("spatial-3d-visible-value", selected3D ? (selected3D.visible === false ? "HIDDEN" : "VISIBLE") : "--");
    const lockButton = panel.querySelector('[data-action="spatial-3d-lock"]'); if (lockButton) { lockButton.setAttribute("aria-pressed", String(Boolean(selected3D?.locked))); lockButton.textContent = selected3D?.locked ? "Unlock object" : "Lock object"; }
    const visibleButton = panel.querySelector('[data-action="spatial-3d-visibility"]'); if (visibleButton) { visibleButton.setAttribute("aria-pressed", String(selected3D?.visible !== false)); visibleButton.textContent = selected3D?.visible === false ? "Show object" : "Hide object"; }
    if (name3DInput) { name3DInput.disabled = !selected3D; if (document.activeElement !== name3DInput) name3DInput.value = selected3D?.name || ""; }
    optionalText("spatial-3d-opacity-value", selected3D ? Math.round((selected3D.opacity ?? .82) * 100) + "%" : "--");
    ui.element("spatial-undo").disabled = !data.undoCount; ui.element("spatial-redo").disabled = !data.redoCount;
    ui.element("spatial-zoom-in").disabled = data.zoom >= 2.5; ui.element("spatial-zoom-out").disabled = data.zoom <= 0.5;
    const deleting = data.pendingDeleteId && data.pendingDeleteId === selected?.id;
    ui.element("spatial-delete-confirmation").hidden = !deleting;
    if (deleting) ui.setText("spatial-delete-question", "Delete " + selected.id + " · " + nameOf(selected.type) + "? Undo can restore it.");
    const deleting3D = data.pending3DDeleteId && data.pending3DDeleteId === selected3D?.id;
    const delete3DBox = ui.element("spatial-3d-delete-confirmation"); if (delete3DBox) delete3DBox.hidden = !deleting3D;
    if (deleting3D) optionalText("spatial-3d-delete-question", "Delete " + selected3D.id + " · " + (selected3D.name || holoName(selected3D.type)) + "? Undo can restore it.");
    if (loadNotice) loadNotice.hidden = !pendingLoad;
    for (const button of panel.querySelectorAll('[data-action="spatial-color"]')) attributes(button, { "aria-pressed": String(Boolean(selected && selected[button.dataset.property] === button.dataset.value)) });
    for (const button of panel.querySelectorAll('[data-action="spatial-3d-color"]')) attributes(button, { "aria-pressed": String(Boolean(selected3D && (selected3D.color || "#45dbff") === button.dataset.value)) });
    textInput.disabled = !selected;
    if (selectedTextId !== (selected?.id || null)) { selectedTextId = selected?.id || null; textInput.value = selected?.text || ""; delete textInput.dataset.draft; }
    else if (!data.editing && document.activeElement !== textInput && !textInput.dataset.draft) textInput.value = selected?.text || "";
    ui.setText("spatial-pointer-status", holo3D.holding ? "3D ANCHOR · " + holo3D.anchorHandId : twoHand.holding ? "ANCHOR · " + twoHand.anchorHandId : "Either hand · aim / pinch / release");
    paint(); holo3D.render(performance.now(), true);
  }
  textInput.addEventListener("input", () => { textInput.dataset.draft = "true"; });
  async function onProjectFileChange() {
    const file = projectFile?.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_PORTABLE_WORKSPACE_BYTES + 1024 * 1024) {
        throw new Error(`Project file is too large for reliable browser loading (${Math.ceil(file.size / 1024 / 1024)} MB; ${Math.round(MAX_PORTABLE_WORKSPACE_BYTES / 1024 / 1024)} MB portable limit).`);
      }
      const project = parseWorkspaceText(await file.text());
      if (!active) return;
      pendingLoad = { project, name: file.name || "workspace.json" };
      const question = `Load ${pendingLoad.name}? Replace ${data.objects.length} 2D + ${(data.objects3D?.length || 0)} 3D objects with ${project.objects2D.length} 2D + ${project.objects3D.length} 3D objects.`;
      ui.setText("spatial-load-question", question);
      if (loadNotice) loadNotice.hidden = false;
      action("PROJECT FILE READY → " + pendingLoad.name);
    } catch (error) {
      pendingLoad = null; if (loadNotice) loadNotice.hidden = true;
      notify(error?.message || "Could not read that VOIDS VISION project.", "warning");
      action("PROJECT LOAD REJECTED");
    } finally {
      if (projectFile) projectFile.value = "";
    }
  }
  projectFile?.addEventListener("change", onProjectFileChange);

  async function imageFileToHologram(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type || "")) throw new Error("Use a PNG, JPG/JPEG or WebP image.");
    if (file.size > 6 * 1024 * 1024) throw new Error("Image is too large. Use an image under 6 MB.");
    let source = null, width = 0, height = 0, dispose = () => {};
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file); width = source.width; height = source.height; dispose = () => source.close?.();
    } else {
      source = await new Promise((resolve, reject) => {
        const image = new Image(), url = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not decode that image.")); };
        image.src = url;
      });
      width = source.naturalWidth; height = source.naturalHeight;
    }
    if (!width || !height) { dispose(); throw new Error("Image dimensions are invalid."); }
    const maxDimension = 1024, ratio = Math.min(1, maxDimension / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * ratio)), outH = Math.max(1, Math.round(height * ratio));
    const canvas = document.createElement("canvas"); canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) { dispose(); throw new Error("Canvas image encoder is unavailable."); }
    try { ctx.drawImage(source, 0, 0, outW, outH); }
    finally { dispose(); }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .86));
    if (!blob) throw new Error("Could not compress the image for the hologram.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("Could not read compressed image data.")); reader.readAsDataURL(blob);
    });
    if (dataUrl.length > 2_800_000) throw new Error("Compressed image is still too large for project Save/Load. Try a smaller image.");
    return { dataUrl, name: file.name || "Imported image", aspect: outW / outH, width: outW, height: outH };
  }
  async function onImageFileChange() {
    const file = imageFile?.files?.[0];
    if (!file) return;
    try {
      const payload = await imageFileToHologram(file);
      if (!active) return;
      const projectedBytes = estimateWorkspaceProjectBytes(data) + String(payload.dataUrl || "").length + 4096;
      if (projectedBytes > MAX_PORTABLE_WORKSPACE_BYTES) throw new Error(`This image would push the portable workspace above ${Math.round(MAX_PORTABLE_WORKSPACE_BYTES / 1024 / 1024)} MB. Remove a large imported asset first.`);
      const object = holo3D.createImage(payload, { x: 0, y: 0, z: 0 });
      if (!object) throw new Error("3D object limit reached (24).");
      action(`IMAGE HOLOGRAM CREATED → ${object.id} · ${payload.width}×${payload.height}`);
      notify("Image imported as a floating hologram panel. Use Anchor / Manipulator to move, scale and rotate it.");
      paint(); render();
    } catch (error) {
      console.error("[VOIDS VISION] Image hologram import failed", error);
      notify(error?.message || "Could not import that image.", "warning");
      action("IMAGE HOLOGRAM IMPORT REJECTED");
    } finally { if (imageFile) imageFile.value = ""; }
  }
  imageFile?.addEventListener("change", onImageFileChange);

  const MODEL_MAX_TOTAL_BYTES = 14 * 1024 * 1024;
  const MODEL_UNSUPPORTED_EXTENSIONS = new Set(["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]);
  const fileExt = name => String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const fileToDataUrl = async (file, forcedType = "") => {
    // File.slice() re-labels the Blob MIME type without materializing a second full ArrayBuffer.
    // This matters for large GLB/STL/FBX imports where validation already holds one inspection buffer.
    const blob = forcedType && file.type !== forcedType ? file.slice(0, file.size, forcedType) : file;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error(`Could not read ${file.name}.`)); reader.readAsDataURL(blob);
    });
  };
  const inspectGltfJson = json => {
    if (!json || typeof json !== "object" || String(json.asset?.version || "").split(".")[0] !== "2") throw new Error("Only glTF 2.0 models are supported.");
    const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
    const used = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
    const blocked = [...new Set([...required, ...used])].find(name => MODEL_UNSUPPORTED_EXTENSIONS.has(name));
    if (blocked) throw new Error(`${blocked} compressed models are not supported yet. Export/download a standard uncompressed GLB.`);
    const uris = [...(json.buffers || []).map(x => x?.uri), ...(json.images || []).map(x => x?.uri)].filter(uri => typeof uri === "string" && uri && !uri.startsWith("data:"));
    for (const uri of uris) if (/^(?:https?:|blob:|file:|\/\/)/i.test(uri)) throw new Error("Remote URLs inside GLTF are blocked. Select a self-contained GLB or local companion files.");
    return { uris, animations: Array.isArray(json.animations) ? json.animations.length : 0 };
  };
  function inspectGlb(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) throw new Error("GLB file is incomplete or corrupted.");
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error("Only valid GLB / glTF 2.0 files are supported.");
    const declaredLength = view.getUint32(8, true);
    if (declaredLength > buffer.byteLength || declaredLength < 20) throw new Error("GLB length header is invalid.");
    const chunkLength = view.getUint32(12, true), chunkType = view.getUint32(16, true);
    if (chunkType !== 0x4e4f534a || 20 + chunkLength > buffer.byteLength) throw new Error("GLB JSON chunk is missing or corrupted.");
    const text = new TextDecoder().decode(new Uint8Array(buffer, 20, chunkLength)).replace(/\u0000+$/g, "").trim();
    let json; try { json = JSON.parse(text); } catch { throw new Error("GLB metadata JSON is corrupted."); }
    return inspectGltfJson(json);
  }
  const inspectObj = text => {
    const source = String(text || "");
    const vertices = (source.match(/^v\s+/gm) || []).length;
    const faces = (source.match(/^f\s+/gm) || []).length;
    if (vertices < 3 || faces < 1) throw new Error("OBJ contains no usable mesh geometry.");
    return { animations: 0, vertices, faces };
  };
  const inspectStl = buffer => {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 84) throw new Error("STL file is incomplete or corrupted.");
    const bytes = new Uint8Array(buffer), head = new TextDecoder().decode(bytes.slice(0, Math.min(256, bytes.length))).trim().toLowerCase();
    if (head.startsWith("solid") && head.includes("facet")) return { animations: 0 };
    const triangles = new DataView(buffer).getUint32(80, true);
    if (!triangles || 84 + triangles * 50 > buffer.byteLength + 8) throw new Error("STL triangle data is invalid.");
    return { animations: 0 };
  };
  const inspectFbx = buffer => {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 64) throw new Error("FBX file is incomplete or corrupted.");
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength)));
    if (!head.includes("Kaydara FBX Binary") && !head.includes("FBXHeaderExtension")) throw new Error("FBX header is not recognized.");
    return { animations: 0 };
  };
  async function modelFilesToHologram(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) throw new Error("Choose a 3D model file.");
    const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
    if (totalBytes > MODEL_MAX_TOTAL_BYTES) throw new Error("3D import is limited to 14 MB total for reliable browser performance. Try a lighter model.");
    const supported = new Set(["glb", "gltf", "obj", "stl", "fbx"]);
    const roots = files.filter(file => supported.has(fileExt(file.name)));
    if (roots.length !== 1) {
      if (!roots.length) {
        const names = files.slice(0, 3).map(file => `.${fileExt(file.name) || "unknown"}`).join(", ");
        throw new Error(`Unsupported 3D format (${names || "unknown"}). Use GLB, GLTF, OBJ, STL, or FBX. GLB is recommended.`);
      }
      throw new Error("Select one root 3D model at a time. GLTF companion BIN/textures may be selected alongside it.");
    }
    const root = roots[0], format = fileExt(root.name);
    const assetId = "M" + (crypto.randomUUID?.().replace(/-/g, "").slice(0, 16) || Math.random().toString(36).slice(2, 18));
    if (format === "glb") {
      const buffer = await root.arrayBuffer(), meta = inspectGlb(buffer);
      const dataUrl = await fileToDataUrl(root, "model/gltf-binary");
      return { assetId, asset: { format, root: { name: root.name, dataUrl }, resources: [] }, name: root.name, format, byteLength: root.size, animations: meta.animations };
    }
    if (format === "obj") {
      const text = await root.text(), meta = inspectObj(text);
      const dataUrl = await fileToDataUrl(root, "model/obj");
      return { assetId, asset: { format, root: { name: root.name, dataUrl }, resources: [] }, name: root.name, format, byteLength: root.size, animations: meta.animations };
    }
    if (format === "stl") {
      const buffer = await root.arrayBuffer(), meta = inspectStl(buffer);
      const dataUrl = await fileToDataUrl(root, "model/stl");
      return { assetId, asset: { format, root: { name: root.name, dataUrl }, resources: [] }, name: root.name, format, byteLength: root.size, animations: meta.animations };
    }
    if (format === "fbx") {
      const buffer = await root.arrayBuffer(), meta = inspectFbx(buffer);
      const dataUrl = await fileToDataUrl(root, "application/x-fbx");
      return { assetId, asset: { format, root: { name: root.name, dataUrl }, resources: [] }, name: root.name, format, byteLength: root.size, animations: meta.animations };
    }
    let json; try { json = JSON.parse(await root.text()); } catch { throw new Error("GLTF JSON is invalid or corrupted."); }
    const meta = inspectGltfJson(json), companions = files.filter(file => file !== root), resources = [];
    const byName = new Map();
    for (const file of companions) {
      const base = file.name.toLowerCase();
      if (byName.has(base)) throw new Error(`Duplicate companion filename ${file.name}. Use a GLB when asset names collide.`);
      byName.set(base, file);
    }
    for (const uri of [...new Set(meta.uris)]) {
      const clean = decodeURIComponent(uri.split(/[?#]/)[0]).replace(/\\/g, "/"), base = clean.split("/").pop()?.toLowerCase() || "";
      const file = byName.get(base);
      if (!file) throw new Error(`GLTF needs companion file "${clean}". Select the .GLTF, .BIN and textures together, or use a self-contained GLB.`);
      const ext = fileExt(file.name), mime = ext === "png" ? "image/png" : ["jpg", "jpeg"].includes(ext) ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "bin" ? "application/octet-stream" : "";
      if (!mime) throw new Error(`Unsupported GLTF companion type: ${file.name}. Use BIN + PNG/JPG/WebP resources or export GLB.`);
      resources.push({ name: clean, dataUrl: await fileToDataUrl(file, mime) });
    }
    const rootDataUrl = await fileToDataUrl(root, "model/gltf+json");
    return { assetId, asset: { format, root: { name: root.name, dataUrl: rootDataUrl }, resources }, name: root.name, format, byteLength: totalBytes, animations: meta.animations };
  }
  let modelImportBusy = false;
  function setModelImportBusy(on) {
    modelImportBusy = Boolean(on);
    modelDrop?.classList.toggle("is-importing", modelImportBusy);
    modelDrop?.setAttribute("aria-busy", String(modelImportBusy));
    const importButton = panel.querySelector('[data-action="spatial-import-model"]');
    if (importButton) importButton.disabled = modelImportBusy;
  }
  async function importModelFiles(fileList, source = "picker") {
    const files = [...(fileList || [])];
    if (!files.length) return false;
    if (modelImportBusy) { notify("A 3D model import is already being prepared.", "warning"); return false; }
    const capacity = holo3D.importCapacity();
    if (!capacity.ok) { notify(capacity.reason, "warning"); action("3D MODEL IMPORT REJECTED · CAPACITY"); return false; }
    const rawBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file?.size) || 0), 0);
    if (rawBytes > MODEL_MAX_TOTAL_BYTES) {
      notify("3D import is limited to 14 MB total for reliable browser performance. Try a lighter model.", "warning");
      action("3D MODEL IMPORT REJECTED · SIZE");
      return false;
    }
    // Base64 grows binary data by roughly 4/3. Reject impossible portable saves before
    // allocating/encoding the full payload, which avoids a preventable transient RAM spike.
    const conservativeEncodedBytes = Math.ceil(rawBytes * 4 / 3) + files.length * 1024 + 4096;
    if (estimateWorkspaceProjectBytes(data) + conservativeEncodedBytes > MAX_PORTABLE_WORKSPACE_BYTES) {
      notify(`This model would push the portable workspace above ${Math.round(MAX_PORTABLE_WORKSPACE_BYTES / 1024 / 1024)} MB. Remove or replace a large imported asset first.`, "warning");
      action("3D MODEL IMPORT REJECTED · PORTABLE SIZE");
      return false;
    }
    setModelImportBusy(true);
    try {
      notify(`Preparing real 3D model${source === "drop" ? " from drop" : ""}…`, "info");
      const payload = await modelFilesToHologram(files);
      if (!active) return false;
      const projectedBytes = estimateWorkspaceProjectBytes(data) + estimateModelAssetBytes(payload.asset) + 4096;
      if (projectedBytes > MAX_PORTABLE_WORKSPACE_BYTES) throw new Error(`This model would push the portable workspace above ${Math.round(MAX_PORTABLE_WORKSPACE_BYTES / 1024 / 1024)} MB. Remove or replace a large imported asset first.`);
      const object = holo3D.createImportedModel(payload, { x: 0, y: 0, z: 0 });
      if (!object) throw new Error(holo3D.importCapacity(payload.assetId).reason || "3D model import capacity changed. Try again.");
      action(`REAL 3D MODEL IMPORTED → ${object.id} · ${payload.name}`);
      notify(`${payload.name} accepted. Loading real meshes/materials…`);
      paint(); render();
      return true;
    } catch (error) {
      console.error("[VOIDS VISION] 3D model import failed", error);
      notify(error?.message || "Could not import that 3D model.", "warning");
      action("3D MODEL IMPORT REJECTED");
      return false;
    } finally { setModelImportBusy(false); }
  }
  async function onModelFileChange() {
    const files = modelFile?.files;
    if (!files?.length) return;
    try { await importModelFiles(files, "picker"); }
    finally { if (modelFile) modelFile.value = ""; }
  }
  modelFile?.addEventListener("change", onModelFileChange);

  // Windows/Chromium can apply an unexpected native file-type filter. The visible
  // drop zone is a browser-independent fallback and also makes multi-file GLTF import easier.
  const modelDropTargets = [modelDrop, board].filter(Boolean);
  function hasDraggedFiles(event) {
    return [...(event.dataTransfer?.types || [])].includes("Files");
  }
  function setModelDropActive(on) {
    modelDrop?.classList.toggle("is-dragging", !!on);
    board?.classList.toggle("model-drop-active", !!on);
  }
  for (const target of modelDropTargets) {
    target.addEventListener("dragenter", event => {
      if (!active || !hasDraggedFiles(event)) return;
      event.preventDefault(); setModelDropActive(true);
    });
    target.addEventListener("dragover", event => {
      if (!active || !hasDraggedFiles(event)) return;
      event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = modelImportBusy ? "none" : "copy";
      setModelDropActive(true);
    });
    target.addEventListener("dragleave", event => {
      if (!hasDraggedFiles(event)) return;
      const next = event.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      setModelDropActive(false);
    });
    target.addEventListener("drop", event => {
      if (!active || !hasDraggedFiles(event)) return;
      event.preventDefault(); event.stopPropagation(); setModelDropActive(false);
      void importModelFiles(event.dataTransfer?.files, "drop");
    });
  }
  const onWindowDragEnd = () => setModelDropActive(false);
  const onWindowDragOver = event => {
    if (!active || !hasDraggedFiles(event)) return;
    // Prevent Chromium from navigating away if a model file misses the intended drop target.
    event.preventDefault();
    if (event.dataTransfer && !board?.contains(event.target) && !modelDrop?.contains(event.target)) event.dataTransfer.dropEffect = "none";
  };
  const onWindowDrop = event => {
    if (!active || !hasDraggedFiles(event)) { setModelDropActive(false); return; }
    event.preventDefault(); setModelDropActive(false);
    if (!board?.contains(event.target) && !modelDrop?.contains(event.target)) notify("Model drop cancelled. Drop files on the Holo board or 3D Model Drop Zone.", "warning");
  };
  window.addEventListener("dragend", onWindowDragEnd);
  window.addEventListener("dragover", onWindowDragOver);
  window.addEventListener("drop", onWindowDrop);
  modelDrop?.addEventListener("click", event => {
    if (!active) return;
    if (!event.isTrusted || navigator.userActivation && !navigator.userActivation.isActive) {
      notify("Opening the native 3D file picker requires a mouse click or keyboard activation. Drag/drop also works.", "warning");
      return;
    }
    if (modelFile) { modelFile.value = ""; modelFile.click(); }
  });
  modelDrop?.addEventListener("keydown", event => {
    if (!active || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); if (modelFile) { modelFile.value = ""; modelFile.click(); }
  });

  function saveProject() {
    try {
      const estimatedBytes = estimateWorkspaceProjectBytes(data);
      if (estimatedBytes > MAX_PORTABLE_WORKSPACE_BYTES) {
        notify(`Workspace is about ${Math.ceil(estimatedBytes / 1024 / 1024)} MB and exceeds the reliable portable Save/Load limit. Remove large imported assets first.`, "warning");
        action("PROJECT SAVE BLOCKED · PORTABLE SIZE LIMIT");
        return false;
      }
      if (estimatedBytes > WARN_PORTABLE_WORKSPACE_BYTES) notify(`Large workspace: about ${Math.ceil(estimatedBytes / 1024 / 1024)} MB. Saving may take a moment.`, "warning");
      const project = createWorkspaceProject(data);
      const filename = downloadProject(project);
      action(`PROJECT SAVED → ${filename} · ${project.objects2D.length} 2D · ${project.objects3D.length} 3D · ~${Math.max(1, Math.round(estimatedBytes / 1024 / 1024))} MB`);
      return true;
    } catch (error) {
      console.error("[VOIDS VISION] Project save failed", error);
      notify("Project save failed: " + (error?.message || "unknown error"), "warning");
      action("PROJECT SAVE FAILED");
      return false;
    }
  }
  function confirmProjectLoad() {
    if (!pendingLoad) return false;
    cancel();
    const record = pendingLoad; pendingLoad = null; if (loadNotice) loadNotice.hidden = true;
    model.loadWorkspace(record.project); holo3D.afterLoad();
    revision = -1; scaleKey = ""; selectedTextId = null; layoutDirty = true;
    delete textInput.dataset.draft; textInput.value = "";
    renderBackground(); paint(); render();
    action(`PROJECT LOADED → ${record.name} · ${data.objects.length} 2D · ${(data.objects3D?.length || 0)} 3D`);
    notify("Workspace loaded. Undo history was reset for the new project.");
    return true;
  }
  async function exportPng() {
    try {
      renderBackground(); holo3D.render(performance.now(), true);
      const result = await exportWorkspacePng({ board, surface, cameraCanvas, threeDLayers: holo3D.captureLayers(), includeCamera: data.background === "camera", includeGrid: data.grid });
      action(`WORKSPACE PNG EXPORTED → ${result.filename} · ${result.width}×${result.height}`);
    } catch (error) {
      console.error("[VOIDS VISION] Workspace PNG export failed", error);
      notify("PNG export failed: " + (error?.message || "unknown error"), "warning");
    }
  }
  function onAction(name, control) {
    if (!name?.startsWith("spatial-")) return false;
    if (!allowed()) return true;
    cancel();
    const selected = model.selected, selected3D = holo3D.selected, value = control?.dataset.value;
    if (name === "spatial-tool" && (["select", "pan"].includes(value) || SHAPES.some(s => s.type === value) || isHoloTool(value))) {
      data.tool = value; data.pendingDeleteId = null; data.pending3DDeleteId = null;
      data.status = value === "pan" ? "PAN TOOL" : value === "select" ? "READY TO SELECT" : isHoloTool(value) ? "READY TO PLACE 3D" : "READY TO PLACE";
    } else if (name === "spatial-grid" || name === "spatial-snap") { const key = name.slice(8); data[key] = !data[key]; model.changed(); }
    else if (name === "spatial-background") { data.background = data.background === "camera" ? "dark" : "camera"; renderBackground(); }
    else if (name === "spatial-focus") surface.focus({ preventScroll: true });
    else if (name === "spatial-save-project") saveProject();
    else if (name === "spatial-load-project") {
      if (navigator.userActivation && !navigator.userActivation.isActive) notify("Load Project uses the browser file picker. Click this button with mouse/keyboard to choose a JSON file.");
      else projectFile?.click();
    }
    else if (name === "spatial-import-image") {
      if (navigator.userActivation && !navigator.userActivation.isActive) notify("Image Import uses the browser file picker. Click this button with mouse/keyboard to choose an image.");
      else imageFile?.click();
    }
    else if (name === "spatial-import-model") {
      if (navigator.userActivation && !navigator.userActivation.isActive) notify("3D Model Import supports GLB, GLTF, OBJ, STL and FBX. If Windows hides a file, drag it onto the 3D Model Drop Zone. GLB is recommended.");
      else modelFile?.click();
    }
    else if (name === "spatial-confirm-load") confirmProjectLoad();
    else if (name === "spatial-cancel-load") { pendingLoad = null; if (loadNotice) loadNotice.hidden = true; action("PROJECT LOAD CANCELLED"); }
    else if (name === "spatial-export-png") void exportPng();
    else if (name === "spatial-export-svg") {
      try { const filename = download2DSvg(surface, { includeGrid: data.grid }); action("2D SVG EXPORTED → " + filename); }
      catch (error) { console.error("[VOIDS VISION] SVG export failed", error); notify("SVG export failed: " + (error?.message || "unknown error"), "warning"); }
    }
    else if (name === "spatial-undo" || name === "spatial-redo") { if (model[name.slice(8)]()) action("SPATIAL → " + name.slice(8).toUpperCase()); }
    else if (name === "spatial-zoom-in" || name === "spatial-zoom-out") { if (model.zoom(data.zoom + (name.endsWith("in") ? 0.25 : -0.25))) action("ZOOM → " + Math.round(data.zoom * 100) + "%"); }
    else if (name === "spatial-reset-view") { model.resetView(); holo3D.centerCamera(false); action("ZOOM → 100% / PAN RESET / 3D CENTER"); }
    else if (name === "spatial-3d-select" && value) { holo3D.select(value); action("3D OBJECT SELECTED → " + value); }
    else if (name === "spatial-3d-scene-visibility" && value) { holo3D.select(value); holo3D.toggleVisibility(); }
    else if (name === "spatial-3d-scene-lock" && value) { holo3D.select(value); holo3D.toggleLocked(); }
    else if (name === "spatial-3d-rename" && selected3D && name3DInput) { if (!holo3D.rename(name3DInput.value)) name3DInput.value = selected3D.name || holoName(selected3D.type); }
    else if (name === "spatial-3d-visibility" && selected3D) holo3D.toggleVisibility();
    else if (name === "spatial-3d-lock" && selected3D) holo3D.toggleLocked();
    else if (name === "spatial-3d-focus" && selected3D) holo3D.focusSelected();
    else if (name === "spatial-3d-center-camera") holo3D.centerCamera();
    else if (name === "spatial-3d-adjust" && selected3D) holo3D.adjustTransform(control?.dataset.transformKind, control?.dataset.axis, Number(control?.dataset.step));
    else if (name === "spatial-3d-duplicate" && selected3D) holo3D.duplicate();
    else if (name === "spatial-3d-delete" && selected3D) { if (selected3D.locked) notify("Unlock this 3D object before deleting it.", "warning"); else data.pending3DDeleteId = selected3D.id; }
    else if (name === "spatial-3d-cancel-delete") data.pending3DDeleteId = null;
    else if (name === "spatial-3d-confirm-delete" && selected3D && data.pending3DDeleteId === selected3D.id) holo3D.remove();
    else if (name === "spatial-3d-reset" && selected3D) holo3D.resetTransform();
    else if (name === "spatial-3d-depth-in" && selected3D) holo3D.adjustDepth(0.25);
    else if (name === "spatial-3d-depth-out" && selected3D) holo3D.adjustDepth(-0.25);
    else if (name === "spatial-3d-color" && selected3D) { if (holo3D.setAppearance("color", value)) action("3D COLOR → " + value); }
    else if (name === "spatial-3d-glow-minus" && selected3D) { if (holo3D.setAppearance("glow", Math.round(((selected3D.glow ?? .7) - .1) * 10) / 10)) action("3D GLOW UPDATED"); }
    else if (name === "spatial-3d-glow-plus" && selected3D) { if (holo3D.setAppearance("glow", Math.round(((selected3D.glow ?? .7) + .1) * 10) / 10)) action("3D GLOW UPDATED"); }
    else if (name === "spatial-3d-opacity-minus" && selected3D) { if (holo3D.setAppearance("opacity", Math.round(((selected3D.opacity ?? .82) - .1) * 10) / 10)) action("3D OPACITY UPDATED"); }
    else if (name === "spatial-3d-opacity-plus" && selected3D) { if (holo3D.setAppearance("opacity", Math.round(((selected3D.opacity ?? .82) + .1) * 10) / 10)) action("3D OPACITY UPDATED"); }
    else if (selected) {
      if (name === "spatial-duplicate") { const object = model.duplicate(); if (object) action("OBJECT DUPLICATED → " + object.id); else notify("Object limit reached (120)."); }
      else if (name === "spatial-delete") data.pendingDeleteId = selected.id;
      else if (name === "spatial-cancel-delete") data.pendingDeleteId = null;
      else if (name === "spatial-confirm-delete" && data.pendingDeleteId === selected.id) { model.delete(selected.id); action("OBJECT DELETED → " + selected.id); }
      else if (name === "spatial-layer") { if (model.layer(value)) action("OBJECT LAYER → " + value.toUpperCase()); }
      else if (name === "spatial-edit-text") { textInput.focus(); textInput.select(); }
      else if (name === "spatial-apply-text") { if (model.property("text", textInput.value)) action("OBJECT TEXT UPDATED → " + selected.id); delete textInput.dataset.draft; textInput.blur(); }
      else {
        const adjustments = { "spatial-width-minus": ["strokeWidth", -1], "spatial-width-plus": ["strokeWidth", 1],
          "spatial-opacity-minus": ["opacity", -0.1], "spatial-opacity-plus": ["opacity", 0.1], "spatial-font-minus": ["fontSize", -2], "spatial-font-plus": ["fontSize", 2] };
        let changed = false;
        if (adjustments[name]) { const [key, amount] = adjustments[name]; changed = model.property(key, Math.round((selected[key] + amount) * 100) / 100); }
        else if (name === "spatial-color") changed = model.property(control.dataset.property, value);
        else if (name === "spatial-arrows") changed = model.property("arrows", { none: "end", end: "both", both: "none" }[selected.arrows]);
        else if (name === "spatial-dashed") changed = model.property("dashed", !selected.dashed);
        if (changed) action("OBJECT PROPERTY UPDATED → " + selected.id);
      }
    }
    paint(); render(); return true;
  }
  function onKey(event) {
    if (!allowed() || data.editing) return false;
    const focusedControl = document.activeElement;
    if (focusedControl && (["INPUT", "TEXTAREA", "SELECT"].includes(focusedControl.tagName) || focusedControl.isContentEditable)) return false;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "z") { onAction(event.shiftKey ? "spatial-redo" : "spatial-undo"); return true; }
      if (event.key.toLowerCase() === "y") { onAction("spatial-redo"); return true; }
      if (event.key.toLowerCase() === "d") { onAction(holo3D.selected ? "spatial-3d-duplicate" : "spatial-duplicate"); return true; }
      return false;
    }
    if (event.key === "Delete") { onAction(holo3D.selected ? "spatial-3d-delete" : "spatial-delete"); return true; }
    const selected3D = holo3D.selected;
    if (selected3D) {
      if (event.key.toLowerCase() === "f") { onAction("spatial-3d-focus"); return true; }
      if (event.key.toLowerCase() === "l") { onAction("spatial-3d-lock"); return true; }
      const step = event.shiftKey ? 0.25 : 0.1;
      const move3D = { ArrowLeft: ["x", -step], ArrowRight: ["x", step], ArrowUp: ["y", step], ArrowDown: ["y", -step], PageUp: ["z", step], PageDown: ["z", -step] }[event.key];
      if (move3D) { holo3D.adjustTransform("position", move3D[0], move3D[1]); render(); return true; }
      if (event.key === "[") { holo3D.adjustTransform("rotation", "y", -15); render(); return true; }
      if (event.key === "]") { holo3D.adjustTransform("rotation", "y", 15); render(); return true; }
      if (["-", "_"].includes(event.key)) { holo3D.adjustTransform("scale", "all", -0.1); render(); return true; }
      if (["=", "+"].includes(event.key)) { holo3D.adjustTransform("scale", "all", 0.1); render(); return true; }
    }
    const focused = document.activeElement;
    if (focused !== surface && !surface.contains(focused)) return false;
    const target = focused?.closest("[data-spatial-object]");
    if (target && ["Enter", " "].includes(event.key)) { cancel(); markSelection(target.dataset.spatialObject); paint(); render(); return true; }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const selected = model.selected;
    if (nudge && selected) {
      cancel(); const step = data.snap ? WORKSPACE.grid : event.shiftKey ? 10 : 2, origin = { x: selected.x, y: selected.y };
      model.start(selected.id, "move", origin); model.move({ x: origin.x + nudge[0] * step, y: origin.y + nudge[1] * step }); finish(); render(); return true;
    }
    return false;
  }
  name3DInput?.addEventListener("focus", () => { cancel(); data.editing = true; render(); });
  name3DInput?.addEventListener("blur", () => { data.editing = false; interaction.cancel("3D_NAME_EDIT_ENDED"); render(); });
  name3DInput?.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !active) return;
    event.preventDefault(); data.editing = false; onAction("spatial-3d-rename", panel.querySelector('[data-action="spatial-3d-rename"]')); name3DInput.blur();
  });
  buildPalette();
  return {
    enter() { active = true; revision = -1; cancel(); ensurePalette(); holo3D.enter(); renderBackground(); render(); },
    exit() { cancel(); holo3D.exit(); active = false; data.editing = false; pendingLoad = null; if (loadNotice) loadNotice.hidden = true; }, cancel,
    captureTarget(handId, target, point) {
      if (data.editing || nativeId !== null || twoHand.exclusive || !allowed()) return "blocked";
      if (panDrag && panDrag.handId !== handId) return "workspace";
      if (holo3D.holding) {
        if (handId === holo3D.anchorHandId) return "object";
        if (state.settings.spatialDualPointer === false) return "blocked";
        return holo3D.canJoinManipulator(point) ? "manipulator" : "blocked";
      }
      if (twoHand.holding) {
        if (handId === twoHand.anchorHandId) return "object";
        if (state.settings.spatialDualPointer === false) return "blocked";
        const zone = joinTarget(point, data.selectedId);
        return zone && zone.kind !== "DIFFERENT" ? "manipulator" : "blocked";
      }
      if (SHAPES.some(s => s.type === data.tool) || isHoloTool(data.tool)) return "place";
      if (data.tool === "pan") return "workspace";
      if (target?.closest("[data-spatial-object], [data-spatial-handle]")) return "object";
      if (holo3D.hitTest(point, { padding: 20 })) return "object";
      return "workspace";
    },
    beginPointer(target, point, event) {
      if (!allowed() || data.editing || nativeId !== null || twoHand.exclusive) return "reject";
      if (twoHand.holding && event.handId !== twoHand.anchorHandId) return "reject";
      if (holo3D.holding && event.handId !== holo3D.anchorHandId) return "reject";
      if (panDrag && panDrag.handId !== event.handId) return "consume";
      return begin(target, point, "gesture", false, event);
    },
    endPointer(id, reason) {
      const lost = ["TRACKING_LOST", "ANCHOR_LOST"].includes(reason);
      if (id === holo3D.anchorHandId) { holo3D.endPrimary(reason, lost); finish(); }
      else if (id === holo3D.manipulatorHandId) holo3D.releaseManipulator(reason, lost);
      else if (id === twoHand.anchorHandId) { twoHand.endPrimary(reason, lost); finish(); }
      else if (id === twoHand.manipulatorHandId) twoHand.releaseManipulator(reason, lost);
      else if (owner === "gesture" && panDrag?.handId === id) finish();
      render();
    },
    update(frame) {
      if (data.editing || nativeId !== null) return;
      readingFrame = true; frameMatrix = surface.getScreenCTM();
      try {
        const cursors = pointers.update(activeControl());
        if (holo3D.holding) holo3D.update({ cursors, now: frame.now });
        else twoHand.update({ cursors, now: frame.now });
        if (!twoHand.holding && !holo3D.holding && !twoHand.exclusive && panDrag && owner === "gesture") {
          const held = Object.values(state.runtime.handPointers || {}).find(p => p.handId === panDrag.handId && p.owner === "spatial" && p.captureKind === "OBJECT_CAPTURE");
          if (held) move(held.filtered);
        }
        paint();
        try { holo3D.render(frame.now); }
        catch (error) {
          console.warn("[VOIDS VISION] Spatial 3D frame recovered", error);
          holo3D.recover?.(error, "FRAME_RENDER");
        }
      } finally { readingFrame = false; frameMatrix = null; }
    },
    recover(error, method) {
      // Generic input/UI failures are NOT WebGL failures. Only faults whose stack
      // actually originates in the 3D renderer are allowed to demote WebGL. This
      // prevents a bad SVG/UI activation from destroying a healthy 3D scene.
      try {
        if (["update", "tick", "render", "captureTarget", "beginPointer", "endPointer", "onAction"].includes(method)) {
          twoHand.cancel?.(); holo3D.cancel?.();
          ensurePalette();
          const detail = `${error?.message || ""}\n${error?.stack || ""}`;
          const rendererFault = /spatial3D\.js|webgl|three\b|renderer|gl_context/i.test(detail);
          if (rendererFault) holo3D.recover?.(error, `MODE_${String(method).toUpperCase()}`);
          data.status = rendererFault ? "3D RECOVERED · READY" : "INPUT RECOVERED · READY";
          render();
          return true;
        }
      } catch (recoveryError) { console.error("[VOIDS VISION] Spatial local recovery failed", recoveryError); }
      return false;
    },
    onAction, onKey, render,
    navigationLocked() {
      return Boolean(data.editing || nativeId !== null || panDrag || twoHand.holding || holo3D.holding || twoHand.exclusive);
    },
    tick(now) {
      if (!active) return;
      if (holo3D.holding) holo3D.watchdog(now); else twoHand.watchdog(now);
      paint(); holo3D.tick(now);
      const fresh = state.camera.active ? video.currentTime : null;
      const reduced = state.settings.visualEffects === "reduced" ||
        (state.settings.autoPerformanceMode && state.performance.effectsReduced);
      const rate = reduced ? 6 : 15;
      if (data.background === "camera" && (fresh !== lastVideoFrame) && now - lastBackgroundAt >= 1000 / rate) {
        const started = performance.now(); renderBackground();
        context.recordPerformance?.("background", performance.now() - started); lastBackgroundAt = now; lastVideoFrame = fresh;
      }
    },
    dispose() {
      cancel(); active = false;
      layoutObserver.disconnect?.();
      document.removeEventListener("fullscreenchange", markLayout);
      window.removeEventListener("resize", markLayout);
      projectFile?.removeEventListener("change", onProjectFileChange);
      imageFile?.removeEventListener("change", onImageFileChange);
      modelFile?.removeEventListener("change", onModelFileChange);
      window.removeEventListener("dragend", onWindowDragEnd);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      holo3D.dispose();
    }
  };
}
