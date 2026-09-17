const copy = value => structuredClone(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrapDeg = value => ((value + 180) % 360 + 360) % 360 - 180;

export const HOLO_TOOLS = Object.freeze([
  { type: "holo-cube", label: "Holo Cube" },
  { type: "holo-orb", label: "Holo Orb / Core" },
  { type: "holo-ring", label: "Holo Ring" },
  { type: "holo-pyramid", label: "Holo Pyramid" },
  { type: "holo-globe", label: "Wireframe Globe" },
  { type: "holo-panels", label: "Floating Panel Stack" }
]);
export const isHoloTool = type => HOLO_TOOLS.some(tool => tool.type === type);
export const holoName = type => HOLO_TOOLS.find(tool => tool.type === type)?.label || type;

const defaultScale = type => ({
  "holo-cube": 0.78,
  "holo-orb": 0.72,
  "holo-ring": 0.82,
  "holo-pyramid": 0.86,
  "holo-globe": 0.78,
  "holo-panels": 0.74
}[type] || 0.8);

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
  }
  get selected() { return this.objects.find(object => object.id === this.state.selected3DId) || null; }
  get(id) { return this.objects.find(object => object.id === id) || null; }
  select(id) {
    const next = this.get(id)?.id || null;
    if (next) this.model.select(null);
    if (this.state.selected3DId !== next) {
      this.state.selected3DId = next;
      this.state.pending3DDeleteId = null;
      this.model.changed();
    }
    return this.selected;
  }
  create(type, position = { x: 0, y: 0, z: 0 }) {
    if (!isHoloTool(type) || this.objects.length >= 24) return null;
    this.model.begin();
    const s = defaultScale(type);
    const object = {
      id: "H" + this.nextId++, type,
      position: { x: clamp(position.x || 0, -4.2, 4.2), y: clamp(position.y || 0, -2.8, 2.8), z: clamp(position.z || 0, -2.2, 2.2) },
      rotation: { x: type === "holo-ring" ? 18 : 0, y: type === "holo-pyramid" ? -18 : 0, z: 0 },
      scale: { x: s, y: s, z: s },
      opacity: 0.82,
      visible: true,
      idlePhase: Math.random() * Math.PI * 2
    };
    this.objects.push(object); this.select(object.id); this.state.tool = "select";
    this.model.changed(); this.model.commit(); return object;
  }
  duplicate() {
    const selected = this.selected; if (!selected || this.objects.length >= 24) return null;
    this.model.begin(); const object = copy(selected); object.id = "H" + this.nextId++;
    object.position.x = clamp(object.position.x + 0.35, -4.2, 4.2);
    object.position.y = clamp(object.position.y - 0.2, -2.8, 2.8);
    object.idlePhase = Math.random() * Math.PI * 2;
    this.objects.push(object); this.select(object.id); this.model.changed(); this.model.commit(); return object;
  }
  delete(id) {
    if (!this.get(id)) return false;
    this.model.begin(); this.state.objects3D = this.objects.filter(object => object.id !== id);
    if (this.state.selected3DId === id) this.state.selected3DId = null;
    this.state.pending3DDeleteId = null; this.model.changed(); return this.model.commit();
  }
  resetTransform() {
    const object = this.selected; if (!object) return false;
    this.model.begin(); const s = defaultScale(object.type);
    object.rotation = { x: 0, y: 0, z: 0 }; object.scale = { x: s, y: s, z: s }; object.position.z = 0;
    this.model.changed(); return this.model.commit();
  }
  adjustDepth(amount) {
    const object = this.selected; if (!object) return false;
    const next = clamp(object.position.z + amount, -2.2, 2.2); if (Math.abs(next - object.position.z) < 1e-8) return false;
    this.model.begin(); object.position.z = next; this.model.changed(); return this.model.commit();
  }
  startAnchor(id, planePoint, screenPoint) {
    const object = this.get(id);
    if (!object || this.edit || this.model.transaction || !planePoint || !screenPoint) return false;
    this.select(id); this.model.begin();
    this.edit = {
      id,
      original: copy(object),
      moveBase: copy(object),
      anchorPlaneBase: { ...planePoint },
      anchorScreen: { ...screenPoint },
      grabOffset: { x: planePoint.x - object.position.x, y: planePoint.y - object.position.y },
      manipulator: null,
      applied: null
    };
    this.state.manipulation = "3d-anchor"; this.state.status = "3D ANCHOR LOCKED"; this.model.changed(); return true;
  }
  moveAnchor(planePoint) {
    const edit = this.edit, object = edit && this.get(edit.id); if (!edit || !object || edit.manipulator || !planePoint) return;
    const x = clamp(planePoint.x - edit.grabOffset.x, -4.4, 4.4), y = clamp(planePoint.y - edit.grabOffset.y, -3.0, 3.0);
    if (Math.abs(object.position.x - x) < 1e-6 && Math.abs(object.position.y - y) < 1e-6) return;
    object.position.x = x; object.position.y = y; this.model.changed();
  }
  beginManipulator(anchorScreen, secondaryScreen) {
    const edit = this.edit, object = edit && this.get(edit.id); if (!edit || !object || edit.manipulator) return false;
    const dx = secondaryScreen.x - anchorScreen.x, dy = secondaryScreen.y - anchorScreen.y, distance = Math.hypot(dx, dy);
    if (distance < 34) return false;
    edit.manipulator = {
      original: copy(object), anchorStart: { ...anchorScreen }, secondaryStart: { ...secondaryScreen },
      vector: { x: dx, y: dy }, distance, angle: Math.atan2(dy, dx),
      lastScale: 1, lastYaw: 0, lastPitch: 0, lastRoll: 0
    };
    this.state.manipulation = "3d-anchor-manipulator"; this.state.status = "3D MOVE + SCALE + ROTATE"; this.model.changed(); return true;
  }
  applyManipulator(anchorScreen, secondaryScreen, boardSize, { snap = false } = {}) {
    const edit = this.edit, base = edit?.manipulator, object = edit && this.get(edit.id);
    if (!base || !object || !boardSize?.width || !boardSize?.height) return null;
    const dx = secondaryScreen.x - anchorScreen.x, dy = secondaryScreen.y - anchorScreen.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const ratio = clamp(distance / base.distance, 0.38, 2.8);
    const angle = Math.atan2(dy, dx), rollDelta = Math.atan2(Math.sin(angle - base.angle), Math.cos(angle - base.angle));
    const secondaryDx = secondaryScreen.x - base.secondaryStart.x;
    const secondaryDy = secondaryScreen.y - base.secondaryStart.y;
    let yaw = secondaryDx / boardSize.width * 210;
    let pitch = -secondaryDy / boardSize.height * 170;
    let roll = rollDelta * 180 / Math.PI * 0.82;
    // Keep tiny camera jitter from rotating three axes at once.
    if (Math.abs(yaw) < 2.2) yaw = 0;
    if (Math.abs(pitch) < 2.2) pitch = 0;
    if (Math.abs(roll) < 2.2) roll = 0;
    if (snap) { yaw = Math.round(yaw / 15) * 15; pitch = Math.round(pitch / 15) * 15; roll = Math.round(roll / 15) * 15; }
    const s0 = base.original.scale.x;
    const nextScale = clamp(s0 * ratio, 0.28, 2.8);
    object.scale = { x: nextScale, y: nextScale, z: nextScale };
    object.rotation = {
      x: wrapDeg(base.original.rotation.x + pitch),
      y: wrapDeg(base.original.rotation.y + yaw),
      z: wrapDeg(base.original.rotation.z + roll)
    };
    base.lastScale = nextScale / s0; base.lastYaw = yaw; base.lastPitch = pitch; base.lastRoll = roll;
    edit.applied = { scale: base.lastScale, yaw, pitch, roll };
    this.model.changed(); return edit.applied;
  }
  endManipulator(anchorPlane) {
    const edit = this.edit, object = edit && this.get(edit.id); if (!edit || !object) return;
    edit.manipulator = null; edit.moveBase = copy(object);
    if (anchorPlane) edit.grabOffset = { x: anchorPlane.x - object.position.x, y: anchorPlane.y - object.position.y };
    this.state.manipulation = "3d-anchor"; this.state.status = "3D ANCHOR STILL ACTIVE"; this.model.changed();
  }
  finishAnchor() {
    const edit = this.edit; if (!edit) return null;
    this.edit = null; this.state.manipulation = null; this.state.status = this.selected ? "3D SELECTED" : "READY";
    const changed = this.model.commit(); this.model.changed(); return { id: edit.id, changed };
  }
  cancelAnchor() { return this.finishAnchor(); }
}
