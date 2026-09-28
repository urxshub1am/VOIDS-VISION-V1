const copy = object => {
  if (!object || typeof object !== "object") return object;
  const cloned = { ...object };
  if (object.position) cloned.position = { ...object.position };
  if (object.rotation) cloned.rotation = { ...object.rotation };
  if (object.scale) cloned.scale = { ...object.scale };
  // Embedded Base64 strings are immutable; keep their string storage shared across edit baselines.
  if (object.image) cloned.image = { ...object.image };
  if (object.model) cloned.model = { ...object.model };
  return cloned;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrapDeg = value => ((value + 180) % 360 + 360) % 360 - 180;
const cleanObjectName = (value, fallback) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 60) || fallback;
const rotateOffset = (point, axis, degrees) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), { x, y, z } = point;
  if (axis === "x") return { x, y: y * c - z * s, z: y * s + z * c };
  if (axis === "y") return { x: x * c + z * s, y, z: -x * s + z * c };
  return { x: x * c - y * s, y: x * s + y * c, z };
};

export const HOLO_TOOLS = Object.freeze([
  { type: "holo-cube", label: "Holo Cube" },
  { type: "holo-orb", label: "Holo Orb / Core" },
  { type: "holo-ring", label: "Holo Ring" },
  { type: "holo-pyramid", label: "Holo Pyramid" },
  { type: "holo-globe", label: "Wireframe Globe" },
  { type: "holo-panels", label: "Floating Panel Stack" },
  { type: "holo-cylinder", label: "Holo Cylinder" },
  { type: "holo-diamond", label: "Holo Diamond" },
  { type: "holo-knot", label: "Energy Knot" },
  { type: "holo-beacon", label: "Signal Beacon" },
  { type: "holo-image", label: "Image Hologram", importOnly: true },
  { type: "holo-model", label: "Imported 3D Model", importOnly: true }
]);

export const MAX_HOLO_OBJECTS = 24;
export const MAX_IMPORTED_MODEL_ASSETS = 12;

export const HOLO_COLORS = Object.freeze([
  "#45dbff", "#9af2ff", "#6d8dff", "#b99cff", "#ff7ddb", "#5ef0b5", "#ffbd70", "#ff6b6b"
]);
export const isHoloTool = type => HOLO_TOOLS.some(tool => tool.type === type);
export const holoName = type => HOLO_TOOLS.find(tool => tool.type === type)?.label || type;

export const defaultScale = type => ({
  "holo-cube": 0.78,
  "holo-orb": 0.72,
  "holo-ring": 0.82,
  "holo-pyramid": 0.86,
  "holo-globe": 0.78,
  "holo-panels": 0.74,
  "holo-cylinder": 0.78,
  "holo-diamond": 0.82,
  "holo-knot": 0.78,
  "holo-beacon": 0.82,
  "holo-image": 0.88,
  "holo-model": 0.82
}[type] || 0.8);

export const defaultRotation = type => ({
  x: type === "holo-ring" ? 18 : 0,
  y: type === "holo-pyramid" ? -18 : 0,
  z: 0
});
const cloneAsset = asset => ({
  format: asset?.format || "glb",
  root: asset?.root ? { ...asset.root } : null,
  resources: Array.isArray(asset?.resources) ? asset.resources.map(resource => ({ ...resource })) : []
});

export class Spatial3DModel {
  constructor(spatialModel) {
    this.model = spatialModel;
    this.state = spatialModel.state;
    this.nextId = 1;
    for (const object of this.state.objects3D || []) {
      const id = Number(String(object.id || "").replace(/\D/g, ""));
      if (Number.isFinite(id)) this.nextId = Math.max(this.nextId, id + 1);
    }
    this.edit = null;
  }
  get objects() { return this.state.objects3D || (this.state.objects3D = []); }
  syncAfterLoad() {
    this.edit = null; this.nextId = 1;
    for (const object of this.objects) {
      const id = Number(String(object.id || "").replace(/\D/g, ""));
      if (Number.isFinite(id)) this.nextId = Math.max(this.nextId, id + 1);
    }
    this.syncSelectionState();
  }
  get selected() { return this.objects.find(object => object.id === this.state.selected3DId) || null; }
  get(id) { return this.objects.find(object => object.id === id) || null; }
  get selectedIds() {
    const valid = new Set(this.objects.map(object => object.id));
    const raw = Array.isArray(this.state.selected3DIds) ? this.state.selected3DIds : [];
    const ids = [...new Set(raw.filter(id => valid.has(id)))];
    const primary = valid.has(this.state.selected3DId) ? this.state.selected3DId : null;
    if (primary && !ids.includes(primary)) ids.unshift(primary);
    return ids;
  }
  get selectedObjects() { return this.selectedIds.map(id => this.get(id)).filter(Boolean); }
  get transformableSelectedObjects() { return this.selectedObjects.filter(object => object.visible !== false && !object.locked); }
  syncSelectionState() {
    const ids = this.selectedIds;
    this.state.selected3DIds = ids;
    if (this.state.selected3DId && !ids.includes(this.state.selected3DId)) this.state.selected3DId = ids[0] || null;
    return ids;
  }
  select(id, { preserveGroup = false } = {}) {
    const next = this.get(id)?.id || null;
    if (next) this.model.select(null);
    const before = this.selectedIds.join('|');
    if (!next) {
      this.state.selected3DId = null;
      this.state.selected3DIds = [];
    } else if (preserveGroup && this.selectedIds.includes(next)) {
      this.state.selected3DId = next;
      this.state.selected3DIds = [next, ...this.selectedIds.filter(item => item !== next)];
    } else {
      this.state.selected3DId = next;
      this.state.selected3DIds = [next];
    }
    this.state.pending3DDeleteId = null;
    const after = this.selectedIds.join('|');
    if (before !== after || this.state.selected3DId !== next) this.model.changed();
    return this.selected;
  }
  toggleGroup(id) {
    const object = this.get(id); if (!object) return this.selectedIds;
    let ids = this.selectedIds;
    if (!ids.length) { this.select(id); return this.selectedIds; }
    if (ids.includes(id)) {
      if (ids.length === 1) return ids;
      ids = ids.filter(item => item !== id);
      if (this.state.selected3DId === id) this.state.selected3DId = ids[0] || null;
    } else ids = [...ids, id];
    this.state.selected3DIds = ids;
    this.state.pending3DDeleteId = null;
    this.model.select(null); this.model.changed();
    return this.selectedIds;
  }
  clearGroup() {
    const primary = this.selected?.id || null;
    const next = primary ? [primary] : [];
    if (this.selectedIds.join('|') === next.join('|')) return false;
    this.state.selected3DIds = next; this.model.changed(); return true;
  }
  selectAllVisible() {
    const ids = this.objects.filter(object => object.visible !== false).map(object => object.id);
    if (!ids.length) { this.select(null); return []; }
    const primary = this.state.selected3DId && ids.includes(this.state.selected3DId) ? this.state.selected3DId : ids[0];
    this.state.selected3DId = primary; this.state.selected3DIds = [primary, ...ids.filter(id => id !== primary)];
    this.model.select(null); this.model.changed(); return this.selectedIds;
  }
  selectionPivot(objects = this.transformableSelectedObjects) {
    if (!objects.length) return { x: 0, y: 0, z: 0 };
    const sum = objects.reduce((value, object) => ({ x: value.x + object.position.x, y: value.y + object.position.y, z: value.z + object.position.z }), { x: 0, y: 0, z: 0 });
    return { x: sum.x / objects.length, y: sum.y / objects.length, z: sum.z / objects.length };
  }
  create(type, position = { x: 0, y: 0, z: 0 }) {
    if (!isHoloTool(type) || ["holo-image", "holo-model"].includes(type) || this.objects.length >= MAX_HOLO_OBJECTS) return null;
    this.model.begin();
    const s = defaultScale(type);
    const object = {
      id: "H" + this.nextId++, type, name: cleanObjectName(holoName(type), "3D object"), locked: false,
      position: { x: clamp(position.x || 0, -4.2, 4.2), y: clamp(position.y || 0, -2.8, 2.8), z: clamp(position.z || 0, -2.2, 2.2) },
      rotation: defaultRotation(type),
      scale: { x: s, y: s, z: s },
      opacity: 0.82,
      color: "#45dbff",
      glow: 0.7,
      visible: true,
      idlePhase: Math.random() * Math.PI * 2
    };
    this.objects.push(object); this.select(object.id); this.state.tool = "select";
    this.model.changed(); this.model.commit(); return object;
  }

  createImage({ dataUrl, name = "Imported image", aspect = 1.6 } = {}, position = { x: 0, y: 0, z: 0 }) {
    if (!dataUrl || this.objects.length >= MAX_HOLO_OBJECTS) return null;
    this.model.begin();
    const s = defaultScale("holo-image");
    const object = {
      id: "H" + this.nextId++, type: "holo-image", name: cleanObjectName(name, "Image Hologram"), locked: false,
      position: { x: clamp(position.x || 0, -4.2, 4.2), y: clamp(position.y || 0, -2.8, 2.8), z: clamp(position.z || 0, -2.2, 2.2) },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: s, y: s, z: s },
      opacity: 0.92,
      color: "#45dbff",
      glow: 0.82,
      image: { dataUrl, name: String(name || "Imported image").slice(0, 80), aspect: clamp(Number(aspect) || 1.6, 0.35, 3.5) },
      visible: true,
      idlePhase: Math.random() * Math.PI * 2
    };
    this.objects.push(object); this.select(object.id); this.state.tool = "select";
    this.model.changed(); this.model.commit(); return object;
  }

  get assets() { return this.state.modelAssets || (this.state.modelAssets = {}); }
  getAsset(assetId) { return assetId ? this.assets[assetId] || null : null; }
  get liveImportedAssetIds() {
    return new Set(this.objects.filter(object => object.type === "holo-model").map(object => object.model?.assetId).filter(Boolean));
  }
  importCapacity(assetId = null) {
    if (this.objects.length >= MAX_HOLO_OBJECTS) return { ok: false, reason: `3D object limit reached (${MAX_HOLO_OBJECTS}).`, objectCount: this.objects.length, assetCount: this.liveImportedAssetIds.size };
    const live = this.liveImportedAssetIds;
    if ((!assetId || !live.has(assetId)) && live.size >= MAX_IMPORTED_MODEL_ASSETS) {
      return { ok: false, reason: `Imported model asset limit reached (${MAX_IMPORTED_MODEL_ASSETS}). Delete an imported model before importing another.`, objectCount: this.objects.length, assetCount: live.size };
    }
    return { ok: true, reason: null, objectCount: this.objects.length, assetCount: live.size };
  }
  createImportedModel({ assetId, asset, name = "Imported 3D model", format = "glb", byteLength = 0, animations = 0 } = {}, position = { x: 0, y: 0, z: 0 }) {
    if (!assetId || !asset || !this.importCapacity(assetId).ok) return null;
    this.assets[assetId] = cloneAsset(asset);
    this.model.begin();
    const s = defaultScale("holo-model");
    const object = {
      id: "H" + this.nextId++, type: "holo-model", name: cleanObjectName(name, "Imported 3D Model"), locked: false,
      position: { x: clamp(position.x || 0, -4.2, 4.2), y: clamp(position.y || 0, -2.8, 2.8), z: clamp(position.z || 0, -2.2, 2.2) },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: s, y: s, z: s },
      opacity: 0.94, color: "#45dbff", glow: 0.76,
      model: { assetId, name: String(name || "Imported 3D model").slice(0, 100), format: ["glb", "gltf", "obj", "stl", "fbx"].includes(format) ? format : "glb", byteLength: Math.max(0, Number(byteLength) || 0), animations: Math.max(0, Number(animations) || 0) },
      visible: true, idlePhase: Math.random() * Math.PI * 2
    };
    this.objects.push(object); this.select(object.id); this.state.tool = "select";
    this.model.changed(); this.model.commit(); return object;
  }
  setName(value) {
    const object = this.selected; if (!object) return false;
    const next = cleanObjectName(value, holoName(object.type));
    if (object.name === next) return false;
    this.model.begin(); object.name = next; this.model.changed(); return this.model.commit();
  }
  toggleVisible() {
    const object = this.selected; if (!object) return false;
    this.model.begin(); object.visible = object.visible === false;
    if (object.visible === false) this.state.pending3DDeleteId = null;
    this.model.changed(); return this.model.commit();
  }
  toggleLocked() {
    const object = this.selected; if (!object) return false;
    this.model.begin(); object.locked = !object.locked;
    if (object.locked) this.state.pending3DDeleteId = null;
    this.model.changed(); return this.model.commit();
  }
  adjustTransform(kind, axis, amount) {
    const primary = this.selected;
    const targets = this.transformableSelectedObjects;
    if (!primary || !targets.length || !["position", "rotation", "scale"].includes(kind) || !["x", "y", "z", "all"].includes(axis)) return false;
    const delta = Number(amount); if (!Number.isFinite(delta) || delta === 0) return false;
    const group = targets.length > 1;
    const originals = targets.map(object => ({ object, original: copy(object) }));
    const pivot = this.selectionPivot(targets);
    this.model.begin();
    let changed = false;

    if (kind === "position") {
      if (axis === "all") { this.model.transaction = null; return false; }
      const bounds = { x: [-4.4, 4.4], y: [-3.0, 3.0], z: [-2.2, 2.2] }[axis];
      let allowed = delta;
      if (delta > 0) allowed = Math.min(delta, ...originals.map(({ original }) => bounds[1] - original.position[axis]));
      else allowed = Math.max(delta, ...originals.map(({ original }) => bounds[0] - original.position[axis]));
      if (Math.abs(allowed) > 1e-8) {
        for (const { object, original } of originals) object.position[axis] = original.position[axis] + allowed;
        changed = true;
      }
    } else if (kind === "rotation") {
      if (axis === "all") { this.model.transaction = null; return false; }
      for (const { object, original } of originals) {
        object.rotation[axis] = wrapDeg(original.rotation[axis] + delta);
        if (group) {
          const offset = rotateOffset({ x: original.position.x - pivot.x, y: original.position.y - pivot.y, z: original.position.z - pivot.z }, axis, delta);
          object.position = {
            x: clamp(pivot.x + offset.x, -4.4, 4.4),
            y: clamp(pivot.y + offset.y, -3.0, 3.0),
            z: clamp(pivot.z + offset.z, -2.2, 2.2)
          };
        }
      }
      changed = true;
    } else {
      const reference = primary.locked || primary.visible === false ? targets[0] : primary;
      const nextReference = clamp(reference.scale.x + delta, 0.28, 2.8);
      let factor = nextReference / Math.max(0.001, reference.scale.x);
      if (group) {
        const lower = Math.max(...originals.map(({ original }) => 0.28 / Math.max(0.001, original.scale.x)));
        const upper = Math.min(...originals.map(({ original }) => 2.8 / Math.max(0.001, original.scale.x)));
        factor = clamp(factor, lower, upper);
      }
      if (Math.abs(factor - 1) > 1e-8) {
        for (const { object, original } of originals) {
          const next = clamp(original.scale.x * factor, 0.28, 2.8);
          object.scale = { x: next, y: next, z: next };
          if (group) object.position = {
            x: clamp(pivot.x + (original.position.x - pivot.x) * factor, -4.4, 4.4),
            y: clamp(pivot.y + (original.position.y - pivot.y) * factor, -3.0, 3.0),
            z: clamp(pivot.z + (original.position.z - pivot.z) * factor, -2.2, 2.2)
          };
        }
        changed = true;
      }
    }
    if (!changed) { this.model.transaction = null; return false; }
    this.model.changed(); return this.model.commit();
  }
  setAppearance(key, value) {
    const object = this.selected; if (!object) return false;
    if (key === "color") { if (!HOLO_COLORS.includes(value)) return false; }
    else if (key === "opacity") value = clamp(Number(value), 0.2, 1);
    else if (key === "glow") value = clamp(Number(value), 0, 1);
    else return false;
    if (object[key] === value) return false;
    this.model.begin(); object[key] = value; this.model.changed(); return this.model.commit();
  }
  duplicate() {
    if (this.selectedIds.length > 1) return this.duplicateGroup();
    const selected = this.selected; if (!selected || this.objects.length >= MAX_HOLO_OBJECTS) return null;
    this.model.begin(); const object = copy(selected); object.id = "H" + this.nextId++;
    object.name = cleanObjectName(`${selected.name || holoName(selected.type)} copy`, holoName(selected.type)); object.locked = false;
    object.position.x = clamp(object.position.x + 0.35, -4.2, 4.2);
    object.position.y = clamp(object.position.y - 0.2, -2.8, 2.8);
    object.idlePhase = Math.random() * Math.PI * 2;
    this.objects.push(object); this.state.selected3DId = object.id; this.state.selected3DIds = [object.id]; this.model.select(null);
    this.model.changed(); this.model.commit(); return object;
  }
  duplicateGroup() {
    const source = this.selectedObjects;
    if (source.length < 2) return this.duplicate();
    if (this.objects.length + source.length > MAX_HOLO_OBJECTS) return null;
    const minX = Math.min(...source.map(object => object.position.x)), maxX = Math.max(...source.map(object => object.position.x));
    const minY = Math.min(...source.map(object => object.position.y)), maxY = Math.max(...source.map(object => object.position.y));
    let dx = 0.35, dy = -0.2;
    dx = clamp(dx, -4.2 - minX, 4.2 - maxX);
    dy = clamp(dy, -2.8 - minY, 2.8 - maxY);
    this.model.begin();
    const created = source.map(selected => {
      const object = copy(selected); object.id = "H" + this.nextId++;
      object.name = cleanObjectName(`${selected.name || holoName(selected.type)} copy`, holoName(selected.type)); object.locked = false;
      object.position.x += dx; object.position.y += dy; object.idlePhase = Math.random() * Math.PI * 2;
      this.objects.push(object); return object;
    });
    this.state.selected3DId = created[0]?.id || null; this.state.selected3DIds = created.map(object => object.id); this.model.select(null);
    this.model.changed(); this.model.commit(); return created;
  }
  delete(id) {
    const target = this.get(id); if (!target || target.locked) return false;
    this.model.begin(); this.state.objects3D = this.objects.filter(object => object.id !== id);
    if (this.state.selected3DId === id) this.state.selected3DId = null;
    this.state.selected3DIds = this.selectedIds.filter(selectedId => selectedId !== id);
    if (!this.state.selected3DId && this.state.selected3DIds.length) this.state.selected3DId = this.state.selected3DIds[0];
    this.state.pending3DDeleteId = null; this.model.changed(); return this.model.commit();
  }
  resetTransform() {
    const object = this.selected; if (!object || object.locked || object.visible === false) return false;
    this.model.begin(); const s = defaultScale(object.type);
    object.rotation = defaultRotation(object.type); object.scale = { x: s, y: s, z: s }; object.position.z = 0;
    this.model.changed(); return this.model.commit();
  }
  adjustDepth(amount) {
    const object = this.selected; if (!object || object.locked || object.visible === false) return false;
    const next = clamp(object.position.z + amount, -2.2, 2.2); if (Math.abs(next - object.position.z) < 1e-8) return false;
    this.model.begin(); object.position.z = next; this.model.changed(); return this.model.commit();
  }
  startAnchor(id, planePoint, screenPoint) {
    const object = this.get(id);
    if (!object || object.locked || object.visible === false || this.edit || this.model.transaction || !planePoint || !screenPoint) return false;
    this.select(id, { preserveGroup: this.selectedIds.includes(id) }); this.model.begin();
    this.edit = {
      id,
      original: copy(object),
      moveBase: copy(object),
      anchorPlaneBase: { ...planePoint },
      anchorScreen: { ...screenPoint },
      grabOffset: { x: planePoint.x - object.position.x, y: planePoint.y - object.position.y },
      alignment: null,
      primary: null,
      manipulator: null,
      applied: null
    };
    this.state.manipulation = "3d-anchor"; this.state.status = "3D ANCHOR LOCKED"; this.model.changed(); return true;
  }
  moveAnchor(planePoint, { snap = false, step = 0.25, align = true, alignTolerance = 0.14 } = {}) {
    const edit = this.edit, object = edit && this.get(edit.id); if (!edit || !object || !planePoint) return false;
    // The anchor remains the translation hand even after a manipulator joins.
    let x = clamp(planePoint.x - edit.grabOffset.x, -4.4, 4.4), y = clamp(planePoint.y - edit.grabOffset.y, -3.0, 3.0);
    if (snap) {
      const grid = clamp(Number(step) || 0.25, 0.05, 1);
      x = clamp(Math.round(x / grid) * grid, -4.4, 4.4);
      y = clamp(Math.round(y / grid) * grid, -3.0, 3.0);
    }

    // V1.6 Phase 2 restrained alignment assist. It only aligns object centers,
    // never resizes/rotates, and uses a small world-space tolerance so it cannot
    // pull an object across the scene unexpectedly.
    const tolerance = clamp(Number(alignTolerance) || 0.14, 0.04, 0.30);
    const nearest = (axis, value) => {
      let best = { distance: Math.abs(value), value: 0, source: "CENTER", id: null };
      for (const other of this.objects) {
        if (other.id === object.id || other.visible === false) continue;
        const candidate = Number(other.position?.[axis]); if (!Number.isFinite(candidate)) continue;
        const distance = Math.abs(value - candidate);
        if (distance < best.distance) best = { distance, value: candidate, source: other.id, id: other.id };
      }
      return best.distance <= tolerance ? best : null;
    };
    const alignment = align ? { x: nearest("x", x), y: nearest("y", y) } : { x: null, y: null };
    if (alignment.x) x = clamp(alignment.x.value, -4.4, 4.4);
    if (alignment.y) y = clamp(alignment.y.value, -3.0, 3.0);
    edit.alignment = alignment.x || alignment.y ? alignment : null;

    if (Math.abs(object.position.x - x) < 1e-6 && Math.abs(object.position.y - y) < 1e-6) return false;
    object.position.x = x; object.position.y = y;
    const labels = [alignment.x ? `X ${alignment.x.source}` : null, alignment.y ? `Y ${alignment.y.source}` : null].filter(Boolean);
    this.state.status = labels.length ? `3D MOVE · ALIGN ${labels.join(" · ")}` : snap ? "3D MOVE · SNAP" : "3D MOVE";
    this.model.changed(); return true;
  }
  rebaseAnchor(planePoint) {
    const edit = this.edit, object = edit && this.get(edit.id);
    if (!edit || !object || !planePoint) return false;
    // A reacquired hand may re-enter several pixels away from its last sample.
    // Rebase the grab offset to the CURRENT object so the first restored frame
    // cannot teleport the object across the workspace.
    edit.anchorPlaneBase = { ...planePoint };
    edit.grabOffset = { x: planePoint.x - object.position.x, y: planePoint.y - object.position.y };
    edit.moveBase = copy(object);
    edit.alignment = null;
    this.model.changed();
    return true;
  }

  beginPrimaryControl(screenPoint, palmScale, mode = "move") {
    const edit = this.edit, object = edit && this.get(edit.id);
    if (!edit || !object || !screenPoint) return false;
    mode = ["move", "rotate", "depth"].includes(mode) ? mode : "move";
    const scale = Number(palmScale);
    edit.primary = {
      mode, original: copy(object), screenStart: { ...screenPoint },
      palmScaleStart: Number.isFinite(scale) && scale > 1e-6 ? scale : null,
      filteredYaw: 0, filteredPitch: 0, filteredDepth: 0, lastAt: null,
      rotateAxis: "FREE", depthArmed: false, depthCandidateSign: 0, depthCandidateSamples: 0, lastDepthSampleAt: null
    };
    edit.alignment = null;
    this.state.status = `3D PRIMARY ${mode.toUpperCase()} READY`;
    this.model.changed(); return true;
  }
  rebasePrimaryControl(screenPoint, palmScale, mode = "move") {
    const edit = this.edit, object = edit && this.get(edit.id);
    if (!edit || !object || !screenPoint) return false;
    mode = ["move", "rotate", "depth"].includes(mode) ? mode : "move";
    const scale = Number(palmScale);
    edit.primary = {
      mode, original: copy(object), screenStart: { ...screenPoint },
      palmScaleStart: Number.isFinite(scale) && scale > 1e-6 ? scale : null,
      filteredYaw: 0, filteredPitch: 0, filteredDepth: 0, lastAt: null,
      rotateAxis: "FREE", depthArmed: false, depthCandidateSign: 0, depthCandidateSamples: 0, lastDepthSampleAt: null
    };
    edit.alignment = null;
    this.state.status = `3D PRIMARY ${mode.toUpperCase()} REBASED`;
    this.model.changed(); return true;
  }
  applyPrimaryControl(screenPoint, palmScale, boardSize, { mode = "move", snap = false, sensitivity = 1, now = performance.now(), sampleAt = null } = {}) {
    const edit = this.edit, object = edit && this.get(edit.id);
    if (!edit || !object || !screenPoint || !boardSize?.width || !boardSize?.height) return null;
    mode = ["move", "rotate", "depth"].includes(mode) ? mode : "move";
    if (!edit.primary || edit.primary.mode !== mode) {
      this.rebasePrimaryControl(screenPoint, palmScale, mode);
      return { mode: mode.toUpperCase(), yaw: 0, pitch: 0, depth: 0, rebased: true };
    }
    if (mode === "move") return { mode: "MOVE", yaw: 0, pitch: 0, depth: 0 };
    const base = edit.primary; sensitivity = clamp(Number(sensitivity) || 1, 0.65, 1.35);
    const dt = base.lastAt === null ? 1 / 30 : clamp((now - base.lastAt) / 1000, 1 / 120, 0.25);
    base.lastAt = now;
    if (mode === "rotate") {
      let yaw = (screenPoint.x - base.screenStart.x) / Math.max(1, boardSize.width) * 230 * sensitivity;
      let pitch = -(screenPoint.y - base.screenStart.y) / Math.max(1, boardSize.height) * 185 * sensitivity;
      if (Math.abs(yaw) < 2.2) yaw = 0;
      if (Math.abs(pitch) < 2.2) pitch = 0;

      // Suppress weak cross-axis wobble without blocking deliberate diagonal rotation.
      // When one axis is clearly dominant, the weaker axis is heavily damped instead
      // of being allowed to turn webcam micro-jitter into an unwanted second rotation.
      const ay = Math.abs(yaw), ap = Math.abs(pitch);
      let axis = "FREE";
      if (ay > 5 && ay > ap * 1.6) { pitch *= 0.22; axis = "YAW"; }
      else if (ap > 5 && ap > ay * 1.6) { yaw *= 0.22; axis = "PITCH"; }
      base.rotateAxis = axis;

      const activity = clamp(Math.max(Math.abs(yaw - base.filteredYaw), Math.abs(pitch - base.filteredPitch)) / 50, 0, 1);
      const tau = 0.115 - activity * 0.067, alpha = 1 - Math.exp(-dt / tau);
      const toward = (current, target) => current + clamp((target - current) * alpha, -230 * dt, 230 * dt);
      base.filteredYaw = toward(base.filteredYaw, yaw);
      base.filteredPitch = toward(base.filteredPitch, pitch);
      yaw = base.filteredYaw; pitch = base.filteredPitch;
      if (snap) { yaw = Math.round(yaw / 15) * 15; pitch = Math.round(pitch / 15) * 15; }
      object.rotation.x = wrapDeg(base.original.rotation.x + pitch);
      object.rotation.y = wrapDeg(base.original.rotation.y + yaw);
      object.rotation.z = base.original.rotation.z;
      edit.alignment = null;
      this.state.status = `${snap ? "3D PRIMARY ROTATE · SNAP" : "3D PRIMARY ROTATE"}${axis !== "FREE" ? ` · ${axis}` : ""}`;
      this.model.changed(); return { mode: "ROTATE", yaw, pitch, depth: 0, axis };
    }
    const scale = Number(palmScale);
    if (!Number.isFinite(scale) || scale <= 1e-6 || !Number.isFinite(base.palmScaleStart) || base.palmScaleStart <= 1e-6)
      return { mode: "DEPTH", yaw: 0, pitch: 0, depth: base.filteredDepth, waiting: true, armed: base.depthArmed };
    let depth = clamp(Math.log(scale / base.palmScaleStart) * 4.2 * sensitivity, -2.4, 2.4);

    // Depth is especially sensitive to tiny palm-size fluctuations. Require two
    // deliberate same-direction samples before arming, then rebase at the arm
    // point so the object does not jump when the gesture becomes active.
    if (!base.depthArmed) {
      const sign = Math.abs(depth) >= 0.085 ? Math.sign(depth) : 0;
      if (!sign) { base.depthCandidateSign = 0; base.depthCandidateSamples = 0; base.filteredDepth = 0; edit.alignment = null; this.state.status = "3D PRIMARY DEPTH · HOLD / MOVE TOWARD OR AWAY"; return { mode: "DEPTH", yaw: 0, pitch: 0, depth: 0, waiting: true, armed: false }; }
      const physicalSampleAt = Number(sampleAt);
      const freshSample = !Number.isFinite(physicalSampleAt) || base.lastDepthSampleAt === null || physicalSampleAt > base.lastDepthSampleAt;
      if (!freshSample) { edit.alignment = null; this.state.status = "3D PRIMARY DEPTH · ARMING"; return { mode: "DEPTH", yaw: 0, pitch: 0, depth: 0, waiting: true, armed: false }; }
      base.lastDepthSampleAt = Number.isFinite(physicalSampleAt) ? physicalSampleAt : now;
      if (sign === base.depthCandidateSign) base.depthCandidateSamples += 1;
      else { base.depthCandidateSign = sign; base.depthCandidateSamples = 1; }
      if (base.depthCandidateSamples < 2) { edit.alignment = null; this.state.status = "3D PRIMARY DEPTH · ARMING"; return { mode: "DEPTH", yaw: 0, pitch: 0, depth: 0, waiting: true, armed: false }; }
      base.depthArmed = true; base.original = copy(object); base.palmScaleStart = scale; base.filteredDepth = 0; base.lastAt = now;
      edit.alignment = null; this.state.status = "3D PRIMARY DEPTH ARMED · CONTINUE"; this.model.changed();
      return { mode: "DEPTH", yaw: 0, pitch: 0, depth: 0, rebased: true, armed: true };
    }

    depth = clamp(Math.log(scale / base.palmScaleStart) * 4.2 * sensitivity, -2.4, 2.4);
    if (Math.abs(depth) < 0.07) depth = 0;
    const activity = clamp(Math.abs(depth - base.filteredDepth) / 0.55, 0, 1);
    const tau = 0.15 - activity * 0.078, alpha = 1 - Math.exp(-dt / tau);
    base.filteredDepth += clamp((depth - base.filteredDepth) * alpha, -1.65 * dt, 1.65 * dt);
    depth = base.filteredDepth;
    let nextZ = clamp(base.original.position.z + depth, -2.2, 2.2);
    if (snap) nextZ = clamp(base.original.position.z + Math.round((nextZ - base.original.position.z) * 10) / 10, -2.2, 2.2);
    object.position.z = nextZ; edit.alignment = null;
    this.state.status = snap ? "3D PRIMARY DEPTH · SNAP" : "3D PRIMARY DEPTH";
    this.model.changed(); return { mode: "DEPTH", yaw: 0, pitch: 0, depth: nextZ - base.original.position.z, z: nextZ, armed: true };
  }
  beginManipulator(anchorScreen, secondaryScreen) {
    const edit = this.edit, object = edit && this.get(edit.id); if (!edit || !object || edit.manipulator) return false;
    const dx = secondaryScreen.x - anchorScreen.x, dy = secondaryScreen.y - anchorScreen.y, distance = Math.hypot(dx, dy);
    if (distance < 34) return false;
    edit.alignment = null;
    edit.manipulator = {
      original: copy(object), anchorStart: { ...anchorScreen }, secondaryStart: { ...secondaryScreen },
      vector: { x: dx, y: dy }, distance, angle: Math.atan2(dy, dx),
      intent: null, intentCandidate: null, intentSamples: 0,
      lastScale: 1, lastYaw: 0, lastPitch: 0, lastRoll: 0,
      filteredScale: 1, filteredYaw: 0, filteredPitch: 0, filteredRoll: 0, lastAt: null
    };
    this.state.manipulation = "3d-anchor-manipulator"; this.state.status = "3D TRANSFORM ARMING"; this.model.changed(); return true;
  }
  rebaseManipulator(anchorScreen, secondaryScreen) {
    const edit = this.edit, object = edit && this.get(edit.id), base = edit?.manipulator;
    if (!base || !object || !anchorScreen || !secondaryScreen) return false;
    const dx = secondaryScreen.x - anchorScreen.x, dy = secondaryScreen.y - anchorScreen.y, distance = Math.hypot(dx, dy);
    if (distance < 34) return false;
    const lockedIntent = base.intent;
    Object.assign(base, {
      original: copy(object), anchorStart: { ...anchorScreen }, secondaryStart: { ...secondaryScreen },
      vector: { x: dx, y: dy }, distance, angle: Math.atan2(dy, dx),
      intent: lockedIntent, intentCandidate: lockedIntent, intentSamples: lockedIntent ? 2 : 0,
      lastScale: 1, lastYaw: 0, lastPitch: 0, lastRoll: 0,
      filteredScale: 1, filteredYaw: 0, filteredPitch: 0, filteredRoll: 0, lastAt: null
    });
    this.state.status = lockedIntent ? `3D ${lockedIntent} RESUMED` : "3D TRANSFORM REBASED";
    this.model.changed();
    return true;
  }
  applyManipulator(anchorScreen, secondaryScreen, boardSize, { snap = false, sensitivity = 1, mode = "auto", now = performance.now() } = {}) {
    const edit = this.edit, base = edit?.manipulator, object = edit && this.get(edit.id);
    if (!base || !object || !boardSize?.width || !boardSize?.height) return null;
    sensitivity = clamp(Number(sensitivity) || 1, 0.65, 1.35);
    mode = ["auto", "scale", "rotate", "free"].includes(mode) ? mode : "auto";
    const dx = secondaryScreen.x - anchorScreen.x, dy = secondaryScreen.y - anchorScreen.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const rawRatio = clamp(distance / base.distance, 0.38, 2.8);
    const angle = Math.atan2(dy, dx), rollDelta = Math.atan2(Math.sin(angle - base.angle), Math.cos(angle - base.angle));
    const secondaryDx = secondaryScreen.x - base.secondaryStart.x;
    const secondaryDy = secondaryScreen.y - base.secondaryStart.y;

    // Transform Assist: in AUTO mode the first deliberate secondary-hand motion
    // locks this pinch session to SCALE or ROTATE. This prevents webcam jitter
    // from changing size and all rotation axes at the same time. FREE keeps the
    // V1.4 behavior for users who explicitly want simultaneous transforms.
    const ux = base.vector.x / base.distance, uy = base.vector.y / base.distance;
    const radial = secondaryDx * ux + secondaryDy * uy;
    const tangential = -secondaryDx * uy + secondaryDy * ux;
    const scaleEvidence = Math.abs(radial) / Math.max(72, base.distance);
    const rotateEvidence = Math.abs(tangential) / Math.max(72, base.distance);
    let intent = mode === "free" ? "FREE" : mode === "scale" ? "SCALE" : mode === "rotate" ? "ROTATE" : base.intent;
    let justLocked = false;
    if (mode !== "auto") base.intent = intent;
    if (mode === "auto" && !intent) {
      const threshold = 0.045;
      const candidate = scaleEvidence > threshold || rotateEvidence > threshold
        ? (scaleEvidence > rotateEvidence * 1.18 ? "SCALE" : rotateEvidence > scaleEvidence * 1.18 ? "ROTATE" : null) : null;
      if (candidate === base.intentCandidate) base.intentSamples += 1;
      else { base.intentCandidate = candidate; base.intentSamples = candidate ? 1 : 0; }
      if (candidate && base.intentSamples >= 2) { base.intent = intent = candidate; justLocked = true; }
    }

    // AUTO uses the deciding motion only to choose intent. Re-center the
    // baseline on the lock frame so classification does not also create a
    // sudden scale/rotation jump.
    if (justLocked) {
      base.original = copy(object);
      base.anchorStart = { ...anchorScreen }; base.secondaryStart = { ...secondaryScreen };
      base.vector = { x: dx, y: dy }; base.distance = distance; base.angle = angle;
      base.filteredScale = 1; base.filteredYaw = base.filteredPitch = base.filteredRoll = 0; base.lastAt = now;
      edit.applied = { scale: 1, yaw: 0, pitch: 0, roll: 0, intent, scaleEvidence, rotateEvidence };
      this.state.status = `3D ${intent} LOCKED · CONTINUE MOTION`;
      this.model.changed();
      return edit.applied;
    }

    let ratio = 1 + (rawRatio - 1) * sensitivity;
    if (Math.abs(ratio - 1) < 0.025) ratio = 1;
    let yaw = secondaryDx / boardSize.width * 210 * sensitivity;
    let pitch = -secondaryDy / boardSize.height * 170 * sensitivity;
    let roll = rollDelta * 180 / Math.PI * 0.82 * sensitivity;
    if (Math.abs(yaw) < 2.4) yaw = 0;
    if (Math.abs(pitch) < 2.4) pitch = 0;
    if (Math.abs(roll) < 2.4) roll = 0;

    // Adaptive low-pass + bounded slew. Quiet hands get strong jitter damping;
    // deliberate motion becomes more responsive, and one bad landmark sample
    // cannot create a giant transform jump.
    const dt = base.lastAt === null ? 1 / 30 : clamp((now - base.lastAt) / 1000, 1 / 120, 0.25);
    base.lastAt = now;
    const activity = clamp(Math.max(Math.abs(ratio - base.filteredScale) * 2.4,
      Math.abs(yaw - base.filteredYaw) / 55, Math.abs(pitch - base.filteredPitch) / 55,
      Math.abs(roll - base.filteredRoll) / 55), 0, 1);
    const tau = 0.105 - activity * 0.060;
    const alpha = 1 - Math.exp(-dt / tau);
    const moveToward = (current, target, maxPerSecond) =>
      current + clamp((target - current) * alpha, -maxPerSecond * dt, maxPerSecond * dt);
    base.filteredScale = moveToward(base.filteredScale, ratio, 2.0);
    base.filteredYaw = moveToward(base.filteredYaw, yaw, 260);
    base.filteredPitch = moveToward(base.filteredPitch, pitch, 230);
    base.filteredRoll = moveToward(base.filteredRoll, roll, 230);
    ratio = base.filteredScale; yaw = base.filteredYaw; pitch = base.filteredPitch; roll = base.filteredRoll;

    if (snap) { yaw = Math.round(yaw / 15) * 15; pitch = Math.round(pitch / 15) * 15; roll = Math.round(roll / 15) * 15; }

    const s0 = base.original.scale.x;
    let nextScale = clamp(s0 * ratio, 0.28, 2.8);
    // Snap the SCALE DELTA, not the absolute scale. Native shapes use tuned
    // defaults such as 0.78; absolute rounding would make an unchanged object
    // jump to 0.8 as soon as a snapped Scale session locked.
    if (snap) nextScale = clamp(s0 + Math.round((nextScale - s0) * 10) / 10, 0.28, 2.8);
    const applyScale = intent === "SCALE" || intent === "FREE";
    const applyRotate = intent === "ROTATE" || intent === "FREE";
    if (applyScale) object.scale = { x: nextScale, y: nextScale, z: nextScale };
    else object.scale = { ...base.original.scale };
    if (applyRotate) object.rotation = {
      x: wrapDeg(base.original.rotation.x + pitch),
      y: wrapDeg(base.original.rotation.y + yaw),
      z: wrapDeg(base.original.rotation.z + roll)
    }; else object.rotation = { ...base.original.rotation };

    base.lastScale = applyScale ? nextScale / s0 : 1;
    base.lastYaw = applyRotate ? yaw : 0; base.lastPitch = applyRotate ? pitch : 0; base.lastRoll = applyRotate ? roll : 0;
    edit.applied = { scale: base.lastScale, yaw: base.lastYaw, pitch: base.lastPitch, roll: base.lastRoll,
      intent: intent || "WAITING", scaleEvidence, rotateEvidence };
    this.state.status = intent ? `3D ${intent} + MOVE` : "3D TRANSFORM · MOVE TO CHOOSE SCALE / ROTATE";
    this.model.changed(); return edit.applied;
  }
  endManipulator(anchorPlane) {
    const edit = this.edit, object = edit && this.get(edit.id); if (!edit || !object) return;
    edit.manipulator = null; edit.moveBase = copy(object);
    if (anchorPlane) edit.grabOffset = { x: anchorPlane.x - object.position.x, y: anchorPlane.y - object.position.y };
    this.state.manipulation = "3d-anchor"; this.state.status = "3D ANCHOR STILL ACTIVE"; this.model.changed();
  }
  get activeAlignment() { return this.edit?.alignment || null; }
  finishAnchor() {
    const edit = this.edit; if (!edit) return null;
    this.edit = null; this.state.manipulation = null; this.state.status = this.selected ? "3D SELECTED" : "READY";
    const changed = this.model.commit(); this.model.changed(); return { id: edit.id, changed };
  }
  cancelAnchor() { return this.finishAnchor(); }
}
