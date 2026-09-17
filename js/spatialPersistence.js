import { SHAPES, WORKSPACE, isLine, clamp } from "./spatialModel.js";
import { HOLO_TOOLS, isHoloTool } from "./spatial3DModel.js";

export const WORKSPACE_SCHEMA = "voids-vision-workspace";
export const WORKSPACE_VERSION = 1;
const PORTS = new Set(["top", "right", "bottom", "left"]);
const SHAPE_TYPES = new Set(SHAPES.map(shape => shape.type));
const HOLO_TYPES = new Set(HOLO_TOOLS.map(tool => tool.type));
const copy = value => structuredClone(value);
const finite = value => Number.isFinite(Number(value));
const number = (value, fallback = 0) => finite(value) ? Number(value) : fallback;
const safeText = value => String(value ?? "").slice(0, 300);
const safeColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#45dbff";
const normalizeDeg = value => ((number(value) + 180) % 360 + 360) % 360 - 180;

export function timestampToken(date = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function projectFilename(date = new Date()) { return `voids-vision-project-${timestampToken(date)}.json`; }
export function pngFilename(date = new Date()) { return `voids-vision-export-${timestampToken(date)}.png`; }
export function svgFilename(date = new Date()) { return `voids-vision-2d-${timestampToken(date)}.svg`; }

function sanitizeAnchor(anchor, validTargets) {
  if (!anchor || typeof anchor !== "object" || !validTargets.has(anchor.objectId) || !PORTS.has(anchor.port)) return null;
  return { objectId: anchor.objectId, port: anchor.port };
}

function sanitize2D(raw, index) {
  if (!raw || typeof raw !== "object" || !SHAPE_TYPES.has(raw.type)) throw new Error(`Invalid 2D object at index ${index}.`);
  const definition = SHAPES.find(shape => shape.type === raw.type);
  const id = typeof raw.id === "string" && /^S\d+$/.test(raw.id) ? raw.id : `S${index + 1}`;
  const width = clamp(number(raw.width, definition.width || 120), isLine(raw) ? 1 : WORKSPACE.minSize, WORKSPACE.width);
  const height = isLine(raw) ? 0 : clamp(number(raw.height, definition.height || 90), WORKSPACE.minSize, WORKSPACE.height);
  const object = {
    id, type: raw.type,
    x: clamp(number(raw.x, WORKSPACE.width / 2), 0, WORKSPACE.width),
    y: clamp(number(raw.y, WORKSPACE.height / 2), 0, WORKSPACE.height),
    width, height,
    rotation: normalizeDeg(raw.rotation),
    stroke: safeColor(raw.stroke),
    fill: raw.fill === "none" ? "none" : safeColor(raw.fill || "#102b40"),
    strokeWidth: clamp(number(raw.strokeWidth, 2), 1, 12),
    opacity: clamp(number(raw.opacity, 1), 0.2, 1),
    text: safeText(raw.text),
    fontSize: clamp(number(raw.fontSize, 22), 10, 72),
    arrows: ["none", "end", "both"].includes(raw.arrows) ? raw.arrows : "none",
    dashed: Boolean(raw.dashed),
    z: Number.isInteger(raw.z) ? raw.z : index
  };
  if (isLine(object)) {
    const fallbackHalf = Math.max(1, width) / 2;
    const a = raw.a || { x: object.x - fallbackHalf, y: object.y };
    const b = raw.b || { x: object.x + fallbackHalf, y: object.y };
    object.a = { x: clamp(number(a.x, object.x - fallbackHalf), 0, WORKSPACE.width), y: clamp(number(a.y, object.y), 0, WORKSPACE.height) };
    object.b = { x: clamp(number(b.x, object.x + fallbackHalf), 0, WORKSPACE.width), y: clamp(number(b.y, object.y), 0, WORKSPACE.height) };
    object.anchors = { a: raw.anchors?.a || null, b: raw.anchors?.b || null };
  }
  return object;
}

function sanitize3D(raw, index) {
  if (!raw || typeof raw !== "object" || !HOLO_TYPES.has(raw.type)) throw new Error(`Invalid 3D object at index ${index}.`);
  const id = typeof raw.id === "string" && /^H\d+$/.test(raw.id) ? raw.id : `H${index + 1}`;
  const position = raw.position || {}, rotation = raw.rotation || {}, scale = raw.scale || {};
  const uniform = clamp(number(scale.x, 0.8), 0.28, 2.8);
  return {
    id, type: raw.type,
    position: { x: clamp(number(position.x), -4.4, 4.4), y: clamp(number(position.y), -3.0, 3.0), z: clamp(number(position.z), -2.2, 2.2) },
    rotation: { x: normalizeDeg(rotation.x), y: normalizeDeg(rotation.y), z: normalizeDeg(rotation.z) },
    scale: {
      x: clamp(number(scale.x, uniform), 0.28, 2.8),
      y: clamp(number(scale.y, uniform), 0.28, 2.8),
      z: clamp(number(scale.z, uniform), 0.28, 2.8)
    },
    opacity: clamp(number(raw.opacity, 0.82), 0.15, 1),
    visible: raw.visible !== false,
    idlePhase: Number.isFinite(raw.idlePhase) ? raw.idlePhase : 0
  };
}

export function createWorkspaceProject(state, date = new Date()) {
  return {
    schema: WORKSPACE_SCHEMA,
    version: WORKSPACE_VERSION,
    app: "VOIDS VISION",
    savedAt: date.toISOString(),
    workspace: { width: WORKSPACE.width, height: WORKSPACE.height },
    view: {
      zoom: clamp(number(state.zoom, 1), 0.5, 2.5),
      pan: { x: number(state.pan?.x), y: number(state.pan?.y) },
      grid: state.grid !== false,
      snap: Boolean(state.snap),
      background: state.background === "camera" ? "camera" : "dark"
    },
    objects2D: copy(state.objects || []),
    objects3D: copy(state.objects3D || [])
  };
}

export function validateWorkspaceProject(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Project file is not a JSON object.");
  if (raw.schema !== WORKSPACE_SCHEMA) throw new Error("This is not a VOIDS VISION workspace file.");
  if (raw.version !== WORKSPACE_VERSION) throw new Error(`Unsupported workspace version: ${raw.version ?? "unknown"}.`);
  if (!Array.isArray(raw.objects2D) || !Array.isArray(raw.objects3D)) throw new Error("Workspace object lists are missing.");
  if (raw.objects2D.length > WORKSPACE.maxObjects) throw new Error(`2D object limit exceeded (${WORKSPACE.maxObjects}).`);
  if (raw.objects3D.length > 24) throw new Error("3D object limit exceeded (24).");

  const objects2D = raw.objects2D.map(sanitize2D);
  const objects3D = raw.objects3D.map(sanitize3D);
  const ids = [...objects2D, ...objects3D].map(object => object.id);
  if (new Set(ids).size !== ids.length) throw new Error("Project contains duplicate object IDs.");

  const connectable = new Set(objects2D.filter(object => !isLine(object)).map(object => object.id));
  for (const object of objects2D) {
    if (!isLine(object)) continue;
    object.anchors = {
      a: sanitizeAnchor(object.anchors?.a, connectable),
      b: sanitizeAnchor(object.anchors?.b, connectable)
    };
  }
  objects2D.sort((a, b) => a.z - b.z).forEach((object, index) => { object.z = index; });

  const view = raw.view || {};
  return {
    schema: WORKSPACE_SCHEMA,
    version: WORKSPACE_VERSION,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : null,
    view: {
      zoom: clamp(number(view.zoom, 1), 0.5, 2.5),
      pan: { x: number(view.pan?.x), y: number(view.pan?.y) },
      grid: view.grid !== false,
      snap: Boolean(view.snap),
      background: view.background === "camera" ? "camera" : "dark"
    },
    objects2D,
    objects3D
  };
}

export function parseWorkspaceText(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new Error("Project JSON is invalid or corrupted."); }
  return validateWorkspaceProject(raw);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadProject(project, filename = projectFilename()) {
  const blob = new Blob([JSON.stringify(project, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, filename); return filename;
}

function cleanSvgClone(surface, { fullDocument = false, includeGrid = true } = {}) {
  const clone = surface.cloneNode(true);
  clone.removeAttribute("tabindex"); clone.removeAttribute("role"); clone.removeAttribute("aria-label");
  clone.querySelector("#spatial-selection")?.remove();
  clone.querySelector("#spatial-viewport-hit")?.remove();
  for (const node of clone.querySelectorAll("[data-gesture-target], [tabindex], [role]")) {
    node.removeAttribute("data-gesture-target"); node.removeAttribute("tabindex"); node.removeAttribute("role"); node.removeAttribute("aria-label");
  }
  const grid = clone.querySelector("#spatial-grid-lines"); if (grid && !includeGrid) grid.remove();
  if (fullDocument) clone.querySelector("#spatial-world")?.removeAttribute("transform");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(WORKSPACE.width)); clone.setAttribute("height", String(WORKSPACE.height));
  clone.setAttribute("viewBox", `0 0 ${WORKSPACE.width} ${WORKSPACE.height}`);
  return clone;
}

export function serialize2DSvg(surface, options = {}) {
  const clone = cleanSvgClone(surface, { fullDocument: true, includeGrid: options.includeGrid !== false });
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("x", "0"); background.setAttribute("y", "0"); background.setAttribute("width", String(WORKSPACE.width)); background.setAttribute("height", String(WORKSPACE.height));
  background.setAttribute("fill", options.transparent ? "none" : "#040c16");
  const defs = clone.querySelector("defs"); clone.insertBefore(background, defs?.nextSibling || clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export function download2DSvg(surface, options = {}) {
  const source = serialize2DSvg(surface, options), filename = options.filename || svgFilename();
  downloadBlob(new Blob([source], { type: "image/svg+xml;charset=utf-8" }), filename); return filename;
}

function svgImage(svgText) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), url = URL.createObjectURL(blob), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not rasterize the 2D workspace.")); };
    image.src = url;
  });
}

export async function exportWorkspacePng({ board, surface, cameraCanvas, threeDLayers = [], includeCamera = false, includeGrid = true, filename = pngFilename() }) {
  const rect = board.getBoundingClientRect(), aspect = rect.width > 1 && rect.height > 1 ? rect.width / rect.height : WORKSPACE.width / WORKSPACE.height;
  const width = 1600, height = Math.max(800, Math.round(width / aspect));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#040c16"; ctx.fillRect(0, 0, width, height);
  if (includeCamera && cameraCanvas && !cameraCanvas.hidden && cameraCanvas.width && cameraCanvas.height) {
    ctx.save(); ctx.globalAlpha = 0.7; ctx.drawImage(cameraCanvas, 0, 0, width, height); ctx.restore();
  }
  for (const layer of threeDLayers.filter(Boolean)) {
    if (!layer.width || !layer.height || layer.hidden) continue;
    try { ctx.drawImage(layer, 0, 0, width, height); } catch { /* A tainted/cleared WebGL buffer should not block 2D export. */ }
  }
  const svgText = new XMLSerializer().serializeToString(cleanSvgClone(surface, { fullDocument: false, includeGrid }));
  const svg = await svgImage(svgText); ctx.drawImage(svg, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG encoder unavailable in this browser.");
  downloadBlob(blob, filename); return { filename, width, height };
}
