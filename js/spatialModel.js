// Retained document geometry. This module has no DOM, camera, or gesture rules.
export const WORKSPACE = Object.freeze({ width: 1200, height: 800, grid: 25, minSize: 24, maxObjects: 120, historyLimit: 40 });
export const SHAPES = Object.freeze([
  ["line", "Line", "basic", 180, 0], ["arrow", "Arrow", "basic", 180, 0],
  ["rectangle", "Rectangle", "basic", 180, 110], ["rounded", "Rounded Rectangle", "basic", 180, 110],
  ["square", "Square", "basic", 120, 120], ["circle", "Circle", "basic", 120, 120],
  ["ellipse", "Ellipse", "basic", 180, 110], ["triangle", "Triangle", "basic", 150, 130],
  ["diamond", "Diamond", "basic", 140, 130], ["pentagon", "Pentagon", "basic", 140, 140],
  ["hexagon", "Hexagon", "basic", 150, 130], ["octagon", "Octagon", "basic", 140, 140],
  ["star", "Star", "basic", 150, 150], ["text", "Text Box", "diagram", 220, 90],
  ["connector", "Connector Line", "diagram", 200, 0], ["double-connector", "Double Arrow Connector", "diagram", 200, 0],
  ["decision", "Decision Diamond", "diagram", 180, 140], ["process", "Process Block", "diagram", 190, 110],
  ["terminal", "Start / End Block", "diagram", 190, 90], ["input", "Input / Output", "diagram", 200, 110],
  ["database", "Database / Cylinder", "diagram", 170, 150], ["callout", "Callout / Label", "diagram", 200, 120]
].map(([type, label, category, width, height]) => Object.freeze({ type, label, category, width, height })));
export const PALETTE = Object.freeze(["#45dbff", "#edf6ff", "#b99cff", "#5ef0b5", "#ffbd70", "#102b40"]);
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const copy = (value) => structuredClone(value);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const radians = (angle) => angle * Math.PI / 180;
export const isLine = (object) => ["line", "arrow", "connector", "double-connector"].includes(object.type);
const isConnector = (object) => ["connector", "double-connector"].includes(object.type);
const lockedAspect = (object) => ["circle", "square"].includes(object.type);
export function rotate(point, angle) {
  const a = radians(angle), c = Math.cos(a), s = Math.sin(a);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}
export function worldPoint(object, local) {
  const p = rotate(local, object.rotation);
  return { x: object.x + p.x, y: object.y + p.y };
}
export function corners(object) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
    worldPoint(object, { x: x * object.width / 2, y: y * object.height / 2 }));
}
function extent(object) {
  const points = isLine(object) ? [object.a, object.b] : corners(object);
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
}
function inside(object) {
  const b = extent(object);
  return b.minX >= 0 && b.minY >= 0 && b.maxX <= WORKSPACE.width && b.maxY <= WORKSPACE.height;
}
function lineGeometry(object) {
  object.x = (object.a.x + object.b.x) / 2; object.y = (object.a.y + object.b.y) / 2;
  object.width = distance(object.a, object.b); object.height = 0;
  object.rotation = Math.atan2(object.b.y - object.a.y, object.b.x - object.a.x) * 180 / Math.PI;
}
function translate(object, dx, dy) {
  object.x += dx; object.y += dy;
  if (isLine(object)) {
    object.a.x += dx; object.a.y += dy; object.b.x += dx; object.b.y += dy;
    object.anchors = { a: null, b: null }; lineGeometry(object);
  }
}
function fit(object) {
  const b = extent(object);
  translate(object, clamp(0, -b.minX, WORKSPACE.width - b.maxX), clamp(0, -b.minY, WORKSPACE.height - b.maxY));
}

// Normalized vertices are shared by drawing and connector edge intersections.
export function vertices(type) {
  if (["diamond", "decision"].includes(type)) return [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]];
  if (type === "triangle") return [[0, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  if (type === "input") return [[-0.32, -0.5], [0.5, -0.5], [0.32, 0.5], [-0.5, 0.5]];
  if (type === "callout") return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.28], [-0.1, 0.28], [-0.35, 0.5], [-0.29, 0.28], [-0.5, 0.28]];
  const sides = { pentagon: 5, hexagon: 6, octagon: 8, star: 10 }[type];
  if (!sides) return null;
  return Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / sides, r = type === "star" && i % 2 ? 0.23 : 0.5;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}
export function portPosition(object, port) {
  const direction = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[port];
  if (!direction) return null;
  const polygon = vertices(object.type);
  let radius = 0.5;
  if (polygon) {
    // Intersect a center ray with the polygon boundary; no routing graph needed.
    const hits = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], e = [b[0] - a[0], b[1] - a[1]];
      const cross = direction[0] * e[1] - direction[1] * e[0];
      if (Math.abs(cross) < 1e-8) continue;
      const t = (a[0] * e[1] - a[1] * e[0]) / cross;
      const u = (a[0] * direction[1] - a[1] * direction[0]) / cross;
      if (t >= 0 && u >= 0 && u <= 1) hits.push(t);
    }
    if (hits.length) radius = Math.min(...hits);
  }
  return worldPoint(object, { x: direction[0] * radius * object.width, y: direction[1] * radius * object.height });
}

export class SpatialModel {
  constructor() {
    this.state = { objects: [], selectedId: null, objects3D: [], selected3DId: null, tool: "select", zoom: 1, pan: { x: 0, y: 0 },
      grid: true, snap: false, background: "dark", status: "READY", manipulation: null,
      editing: false, pendingDeleteId: null, pending3DDeleteId: null, undoCount: 0, redoCount: 0, revision: 0 };
    this.nextId = 1; this.past = []; this.future = []; this.transaction = null; this.drag = null;
    this.anchorEdit = null;
  }
  get selected() { return this.state.objects.find(o => o.id === this.state.selectedId) || null; }
  get(id) { return this.state.objects.find(o => o.id === id) || null; }
  snapshot() { return copy({ objects: this.state.objects, selectedId: this.state.selectedId,
    objects3D: this.state.objects3D || [], selected3DId: this.state.selected3DId || null }); }
  changed() { this.state.revision++; this.state.undoCount = this.past.length; this.state.redoCount = this.future.length; }
  begin() { if (!this.transaction) this.transaction = this.snapshot(); }
  commit() {
    if (!this.transaction) return false;
    const before = this.transaction, after = this.snapshot(); this.transaction = null;
    // Selection alone is not an edit and must not fill undo history.
    if (JSON.stringify(before.objects) === JSON.stringify(after.objects) &&
        JSON.stringify(before.objects3D || []) === JSON.stringify(after.objects3D || [])) return false;
    this.past.push({ before, after });
    if (this.past.length > WORKSPACE.historyLimit) this.past.shift();
    this.future.length = 0; this.changed(); return true;
  }
  select(id) {
    const next = this.get(id)?.id || null;
    if (this.state.selectedId !== next) {
      this.state.selectedId = next; this.state.pendingDeleteId = null; this.changed();
    }
    this.state.status = next ? "SELECTED" : "READY";
  }
  gridPoint(p) {
    return this.state.snap ? { x: Math.round(p.x / WORKSPACE.grid) * WORKSPACE.grid,
      y: Math.round(p.y / WORKSPACE.grid) * WORKSPACE.grid } : { ...p };
  }
  create(type, position) {
    const definition = SHAPES.find(s => s.type === type);
    if (!definition || this.state.objects.length >= WORKSPACE.maxObjects) return null;
    this.begin();
    const p = this.gridPoint(position);
    const object = { id: "S" + this.nextId++, type, x: p.x, y: p.y, width: definition.width,
      height: definition.height, rotation: 0, stroke: "#45dbff", fill: type === "text" ? "none" : "#102b40",
      strokeWidth: 2, opacity: 1, text: definition.category === "diagram" && !["connector", "double-connector"].includes(type)
        ? ({ text: "Your text", decision: "Decision?", process: "Process", terminal: "Start / End", input: "Input / Output", database: "Data", callout: "Label" }[type] || "") : "",
      fontSize: 22, arrows: ["arrow"].includes(type) ? "end" : type === "double-connector" ? "both" : "none",
      dashed: false, z: this.state.objects.length };
    if (isLine(object)) {
      object.a = { x: p.x - object.width / 2, y: p.y }; object.b = { x: p.x + object.width / 2, y: p.y };
      object.anchors = { a: null, b: null };
    }
    fit(object); this.state.objects.push(object); this.select(object.id); this.state.tool = "select";
    this.changed(); this.commit(); return object;
  }
  nearestPort(point, excludedId, tolerance) {
    let nearest = null, best = tolerance;
    for (const object of this.state.objects) {
      if (object.id === excludedId || isLine(object)) continue;
      for (const port of ["top", "right", "bottom", "left"]) {
        const p = portPosition(object, port), d = distance(point, p);
        if (d < best) { best = d; nearest = { point: p, anchor: { objectId: object.id, port } }; }
      }
    }
    return nearest;
  }
  updateConnections() {
    for (const line of this.state.objects) {
      if (!isConnector(line)) continue;
      for (const end of ["a", "b"]) {
        const anchor = line.anchors[end], block = anchor && this.get(anchor.objectId);
        if (block) line[end] = portPosition(block, anchor.port);
        else line.anchors[end] = null;
      }
      lineGeometry(line);
    }
  }
  start(id, kind, point, handle = null) {
    const object = this.get(id);
    if (!object || this.drag || this.anchorEdit) return false;
    this.select(id); this.begin();
    this.drag = { id, kind, handle, start: { ...point }, original: copy(object), moved: false };
    this.state.manipulation = kind; this.state.status = { move: "MOVING", resize: "RESIZING", rotate: "ROTATING", endpoint: "CONNECTING" }[kind];
    this.changed(); return true;
  }
  move(point, { threshold = 1, portTolerance = 16 } = {}) {
    const drag = this.drag, object = drag && this.get(drag.id);
    if (!object) return;
    if (!drag.moved && distance(point, drag.start) < threshold) return;
    drag.moved = true;
    const old = drag.original, dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (drag.kind === "move") {
      const p = this.gridPoint({ x: old.x + dx, y: old.y + dy });
      Object.assign(object, copy(old)); translate(object, p.x - old.x, p.y - old.y); fit(object);
    } else if (drag.kind === "endpoint" && isLine(object)) {
      const end = drag.handle, other = end === "a" ? "b" : "a";
      let p = this.gridPoint({ x: old[end].x + dx, y: old[end].y + dy });
      p = { x: clamp(p.x, 0, WORKSPACE.width), y: clamp(p.y, 0, WORKSPACE.height) };
      const snap = isConnector(object) ? this.nearestPort(p, object.id, portTolerance) : null;
      if (snap) p = snap.point;
      if (distance(p, object[other]) >= 12) {
        object[end] = p; object.anchors[end] = snap?.anchor || null; lineGeometry(object);
      }
    } else if (drag.kind === "resize" && !isLine(object)) {
      const [sx, sy] = drag.handle, d = rotate({ x: dx, y: dy }, -old.rotation);
      let width = clamp(old.width + sx * d.x, WORKSPACE.minSize, WORKSPACE.width);
      let height = clamp(old.height + sy * d.y, WORKSPACE.minSize, WORKSPACE.height);
      if (this.state.snap) { width = Math.max(WORKSPACE.minSize, Math.round(width / WORKSPACE.grid) * WORKSPACE.grid);
        height = Math.max(WORKSPACE.minSize, Math.round(height / WORKSPACE.grid) * WORKSPACE.grid); }
      if (lockedAspect(old)) width = height = Math.max(WORKSPACE.minSize, (width + height) / 2);
      const anchor = worldPoint(old, { x: -sx * old.width / 2, y: -sy * old.height / 2 });
      const resized = (t) => {
        const w = old.width + (width - old.width) * t, h = old.height + (height - old.height) * t;
        const offset = rotate({ x: sx * w / 2, y: sy * h / 2 }, old.rotation);
        return { ...old, x: anchor.x + offset.x, y: anchor.y + offset.y, width: w, height: h };
      };
      let candidate = resized(1);
      if (!inside(candidate)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inside(resized(mid))) lo = mid; else hi = mid; }
        candidate = resized(lo);
      }
      Object.assign(object, candidate);
    } else if (drag.kind === "rotate") {
      if (distance(point, old) < 12 || distance(drag.start, old) < 12) return;
      const a = Math.atan2(point.y - old.y, point.x - old.x) - Math.atan2(drag.start.y - old.y, drag.start.x - old.x);
      let angle = old.rotation + a * 180 / Math.PI;
      if (this.state.snap) angle = Math.round(angle / 15) * 15;
      const candidate = copy(old); candidate.rotation = ((angle + 180) % 360 + 360) % 360 - 180;
      if (isLine(candidate)) {
        for (const end of ["a", "b"]) {
          const p = rotate({ x: old[end].x - old.x, y: old[end].y - old.y }, candidate.rotation - old.rotation);
          candidate[end] = { x: old.x + p.x, y: old.y + p.y };
        }
        candidate.anchors = { a: null, b: null }; lineGeometry(candidate);
      }
      if (inside(candidate)) Object.assign(object, candidate);
    }
    this.updateConnections(); this.changed();
  }
  finish() {
    if (!this.drag) return null;
    const { id, kind } = this.drag; this.drag = null; this.state.manipulation = null;
    this.state.status = this.selected ? "SELECTED" : "READY";
    const changed = this.commit(); this.changed(); return { id, kind, changed };
  }
  // One transaction starts at PRIMARY grab and closes only when the anchor drops.
  // Joining/releasing a manipulator merely changes the geometry baseline.
  startAnchor(id, point) {
    const object = this.get(id);
    if (!object || this.drag || this.anchorEdit || this.transaction ||
        ![point?.x, point?.y].every(Number.isFinite)) return false;
    this.select(id); this.begin();
    this.anchorEdit = { id, original: copy(object), moveBase: copy(object),
      pointBase: { ...point }, transform: null, applied: null };
    this.state.manipulation = "anchor"; this.state.status = "ANCHOR LOCKED";
    this.changed(); return true;
  }
  moveAnchor(point) {
    const edit = this.anchorEdit, object = edit && this.get(edit.id);
    if (!object || edit.transform || ![point?.x, point?.y].every(Number.isFinite)) return;
    const delta = this.gridPoint({ x: point.x - edit.pointBase.x, y: point.y - edit.pointBase.y });
    const candidate = copy(edit.moveBase);
    if (Math.hypot(delta.x, delta.y) >= 0.001) { translate(candidate, delta.x, delta.y); fit(candidate); }
    if (JSON.stringify(object) === JSON.stringify(candidate)) return;
    Object.assign(object, candidate); this.updateConnections(); this.changed();
  }
  beginManipulator(primary, secondary, zone = { kind: "BODY" }) {
    const edit = this.anchorEdit, object = edit && this.get(edit.id);
    if (!object || ![primary?.x, primary?.y, secondary?.x, secondary?.y].every(Number.isFinite)) return false;
    const anchorLocal = rotate({ x: primary.x - object.x, y: primary.y - object.y }, -object.rotation);
    edit.transform = { original: copy(object), primary: { ...primary }, secondary: { ...secondary },
      anchorLocal, zone: { ...zone } };
    this.state.manipulation = "anchor-manipulator"; this.changed(); return true;
  }
  applyAnchoredTransform(primary, { scaleX = 1, scaleY = scaleX, rotation = 0 } = {}) {
    const edit = this.anchorEdit, base = edit?.transform, object = edit && this.get(edit.id);
    if (!base || !object || ![primary?.x, primary?.y, scaleX, scaleY, rotation].every(Number.isFinite) ||
        scaleX <= 0 || scaleY <= 0) return null;
    const old = base.original, line = isLine(old), uniform = line || lockedAspect(old) || base.zone.kind === "BODY" || base.zone.kind === "ROTATION";
    const minW = line ? 12 : old.type === "text" ? Math.max(60, old.fontSize * 2) : WORKSPACE.minSize;
    const minH = old.type === "text" ? Math.max(36, old.fontSize * 1.7) : WORKSPACE.minSize;
    let sx, sy;
    if (uniform) {
      sx = sy = clamp(scaleX, Math.max(minW / old.width, line ? 0 : minH / old.height), 4);
    } else {
      sx = clamp(scaleX, minW / old.width, 4); sy = clamp(scaleY, minH / old.height, 4);
    }
    if (!uniform && this.state.snap) {
      // Quantize changed stretch axes only; joining must not realign the baseline.
      if (Math.abs(sx - 1) > 1e-4) sx = clamp(Math.round(old.width * sx / WORKSPACE.grid) * WORKSPACE.grid / old.width, minW / old.width, 4);
      if (Math.abs(sy - 1) > 1e-4) sy = clamp(Math.round(old.height * sy / WORKSPACE.grid) * WORKSPACE.grid / old.height, minH / old.height, 4);
    }
    const angleDelta = this.state.snap ? Math.round(rotation / 15) * 15 : rotation;
    const angle = old.rotation + angleDelta, a = radians(angle);
    // Preserve the picked point under PRIMARY. SECONDARY-only movement never
    // introduces a midpoint translation. Bounds are the only placement override.
    const delta = this.gridPoint({ x: primary.x - base.primary.x, y: primary.y - base.primary.y });
    const anchor = { x: base.primary.x + delta.x, y: base.primary.y + delta.y };
    let halfX = (Math.abs(Math.cos(a)) * old.width * sx + Math.abs(Math.sin(a)) * old.height * sy) / 2;
    let halfY = (Math.abs(Math.sin(a)) * old.width * sx + Math.abs(Math.cos(a)) * old.height * sy) / 2;
    const fitRatio = Math.min(1, WORKSPACE.width / Math.max(1e-8, 2 * halfX), WORKSPACE.height / Math.max(1e-8, 2 * halfY));
    if (old.width * sx * fitRatio < minW - 1e-6 || (!line && old.height * sy * fitRatio < minH - 1e-6)) return edit.applied;
    sx *= fitRatio; sy *= fitRatio; halfX *= fitRatio; halfY *= fitRatio;
    const offset = rotate({ x: base.anchorLocal.x * sx, y: base.anchorLocal.y * sy }, angle);
    const desired = { x: anchor.x - offset.x, y: anchor.y - offset.y };
    const x = clamp(desired.x, halfX, WORKSPACE.width - halfX), y = clamp(desired.y, halfY, WORKSPACE.height - halfY);
    const normalized = ((angle + 180) % 360 + 360) % 360 - 180;
    const angularDifference = Math.abs(((object.rotation - normalized + 180) % 360 + 360) % 360 - 180);
    const different = Math.abs(object.x - x) > 1e-7 || Math.abs(object.y - y) > 1e-7 ||
      Math.abs(object.width - old.width * sx) > 1e-7 || Math.abs(object.height - old.height * sy) > 1e-7 || angularDifference > 1e-7;
    if (different) {
      Object.assign(object, { x, y, width: old.width * sx, height: old.height * sy, rotation: normalized });
      if (line) {
        for (const end of ["a", "b"]) {
          const v = rotate({ x: (old[end].x - old.x) * sx, y: (old[end].y - old.y) * sx }, angleDelta);
          object[end] = { x: x + v.x, y: y + v.y };
        }
        // Directly transforming a connector detaches it; attached connectors
        // elsewhere still follow their blocks through updateConnections().
        object.anchors = { a: null, b: null }; lineGeometry(object);
      }
      this.updateConnections(); this.changed();
    }
    edit.applied = { scale: sx, scaleX: sx, scaleY: sy, rotation: angleDelta,
      translation: { x: x - old.x, y: y - old.y },
      resize: { x: object.width - old.width, y: object.height - old.height },
      limited: Math.abs(sx - scaleX) > 1e-6 || Math.abs(sy - scaleY) > 1e-6 ||
        Math.abs(x - desired.x) > 1e-6 || Math.abs(y - desired.y) > 1e-6 };
    return edit.applied;
  }
  endManipulator(primary) {
    const edit = this.anchorEdit, object = edit && this.get(edit.id);
    if (!object) return;
    edit.transform = null; edit.moveBase = copy(object); edit.pointBase = { ...primary };
    this.state.manipulation = "anchor"; this.state.status = "ANCHOR STILL ACTIVE"; this.changed();
  }
  finishAnchor() {
    const edit = this.anchorEdit; if (!edit) return null;
    this.anchorEdit = null; this.state.manipulation = null;
    this.state.status = this.selected ? "SELECTED" : "READY";
    const changed = this.commit(); this.changed(); return { id: edit.id, changed };
  }
  // At most two lightweight visual guides, never a constraint-solving graph.
  alignmentGuides(tolerance = 4) {
    const object = this.selected; if (!object || !this.state.manipulation) return [];
    const box = extent(object), guides = [];
    for (const axis of ["x", "y"]) {
      const own = axis === "x" ? [box.minX, object.x, box.maxX] : [box.minY, object.y, box.maxY];
      let best = tolerance, value = null;
      const compare = candidate => { for (const v of own) if (Math.abs(v - candidate) < best) { best = Math.abs(v - candidate); value = candidate; } };
      if (this.state.grid) for (const v of own) compare(Math.round(v / WORKSPACE.grid) * WORKSPACE.grid);
      for (const other of this.state.objects) {
        if (other.id === object.id || isLine(other)) continue;
        const b = extent(other);
        for (const v of axis === "x" ? [b.minX, other.x, b.maxX] : [b.minY, other.y, b.maxY]) compare(v);
      }
      if (value !== null) guides.push({ axis, value });
    }
    return guides;
  }
  setViewTransform(zoom, pan) {
    if (![zoom, pan?.x, pan?.y].every(Number.isFinite)) return false;
    const next = clamp(zoom, 0.5, 2.5);
    const x = clamp(pan.x, 100 - WORKSPACE.width * next, WORKSPACE.width - 100);
    const y = clamp(pan.y, 100 - WORKSPACE.height * next, WORKSPACE.height - 100);
    if (Math.abs(this.state.zoom - next) < 1e-8 && Math.abs(this.state.pan.x - x) < 1e-7 && Math.abs(this.state.pan.y - y) < 1e-7) return false;
    this.state.zoom = next; this.state.pan = { x, y }; this.changed(); return true;
  }
  duplicate() {
    const selected = this.selected;
    if (!selected || this.state.objects.length >= WORKSPACE.maxObjects) return null;
    this.begin(); const object = copy(selected); object.id = "S" + this.nextId++;
    translate(object, selected.x > WORKSPACE.width - 100 ? -25 : 25, selected.y > WORKSPACE.height - 100 ? -25 : 25); fit(object);
    this.state.objects.push(object); this.order(); this.select(object.id); this.commit(); return object;
  }
  delete(id) {
    if (!this.get(id)) return false;
    this.begin(); this.state.objects = this.state.objects.filter(o => o.id !== id);
    if (this.state.selectedId === id) this.select(null);
    this.updateConnections(); this.order(); this.commit(); return true;
  }
  order() { this.state.objects.forEach((o, i) => { o.z = i; }); this.changed(); }
  layer(direction) {
    const object = this.selected; if (!object) return false;
    const index = this.state.objects.indexOf(object);
    const next = { front: this.state.objects.length - 1, back: 0, forward: Math.min(index + 1, this.state.objects.length - 1), backward: Math.max(0, index - 1) }[direction];
    if (next === undefined || next === index) return false;
    this.begin(); this.state.objects.splice(index, 1); this.state.objects.splice(next, 0, object); this.order(); return this.commit();
  }
  property(key, value) {
    const object = this.selected; if (!object) return false;
    if (["stroke", "fill"].includes(key)) { if (!(PALETTE.includes(value) || key === "fill" && value === "none")) return false; }
    else if (["strokeWidth", "fontSize", "opacity"].includes(key)) {
      if (!Number.isFinite(Number(value))) return false;
      const limits = { strokeWidth: [1, 12], fontSize: [10, 72], opacity: [0.2, 1] }[key];
      value = clamp(Number(value), ...limits);
    } else if (key === "text") value = String(value).slice(0, 300);
    else if (key === "arrows") { if (!isLine(object) || !["none", "end", "both"].includes(value)) return false; }
    else if (key === "dashed") value = Boolean(value);
    else return false;
    if (object[key] === value) return false;
    this.begin(); object[key] = value; this.changed(); return this.commit();
  }
  loadWorkspace(project) {
    if (!project || !Array.isArray(project.objects2D) || !Array.isArray(project.objects3D)) return false;
    this.finishAnchor();
    this.finish();
    this.transaction = null; this.drag = null; this.anchorEdit = null;
    this.past.length = 0; this.future.length = 0;
    this.state.objects = copy(project.objects2D);
    this.state.objects3D = copy(project.objects3D);
    this.state.selectedId = null; this.state.selected3DId = null;
    this.state.tool = "select";
    this.state.zoom = clamp(project.view?.zoom ?? 1, 0.5, 2.5);
    const requestedPan = { x: Number(project.view?.pan?.x) || 0, y: Number(project.view?.pan?.y) || 0 };
    this.state.pan = {
      x: clamp(requestedPan.x, 100 - WORKSPACE.width * this.state.zoom, WORKSPACE.width - 100),
      y: clamp(requestedPan.y, 100 - WORKSPACE.height * this.state.zoom, WORKSPACE.height - 100)
    };
    this.state.grid = project.view?.grid !== false;
    this.state.snap = Boolean(project.view?.snap);
    this.state.background = project.view?.background === "camera" ? "camera" : "dark";
    this.state.status = "READY"; this.state.manipulation = null; this.state.editing = false;
    this.state.pendingDeleteId = null; this.state.pending3DDeleteId = null;
    this.state.undoCount = 0; this.state.redoCount = 0;
    this.nextId = this.state.objects.reduce((next, object) => {
      const id = Number(String(object.id || "").replace(/\D/g, ""));
      return Number.isFinite(id) ? Math.max(next, id + 1) : next;
    }, 1);
    for (const object of this.state.objects) if (isLine(object)) lineGeometry(object);
    this.updateConnections(); this.order(); this.changed();
    return true;
  }
  undo() {
    this.finishAnchor();
    this.finish(); const entry = this.past.pop(); if (!entry) return false;
    this.future.push(entry); Object.assign(this.state, copy(entry.before)); this.state.pendingDeleteId = null; this.state.pending3DDeleteId = null;
    this.state.status = this.selected ? "SELECTED" : "READY"; this.changed(); return true;
  }
  redo() {
    this.finishAnchor();
    this.finish(); const entry = this.future.pop(); if (!entry) return false;
    this.past.push(entry); Object.assign(this.state, copy(entry.after)); this.state.pendingDeleteId = null; this.state.pending3DDeleteId = null;
    this.state.status = this.selected ? "SELECTED" : "READY"; this.changed(); return true;
  }
  zoom(value) {
    const next = Math.round(clamp(value, 0.5, 2.5) * 100) / 100, before = this.state.zoom;
    if (next === before) return false;
    this.state.pan.x = 600 - (600 - this.state.pan.x) * next / before;
    this.state.pan.y = 400 - (400 - this.state.pan.y) * next / before;
    this.state.zoom = next; this.pan(this.state.pan); return true;
  }
  pan(point) {
    this.state.pan = { x: clamp(point.x, 100 - WORKSPACE.width * this.state.zoom, WORKSPACE.width - 100),
      y: clamp(point.y, 100 - WORKSPACE.height * this.state.zoom, WORKSPACE.height - 100) };
    this.changed();
  }
  resetView() { this.state.zoom = 1; this.state.pan = { x: 0, y: 0 }; this.changed(); }
}
