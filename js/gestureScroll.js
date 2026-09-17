// Executes only a granted SCROLL_CAPTURE. No gesture recognition or target search.
export const SCROLL_TUNING = Object.freeze({
  dragPixels: 12, verticalRatio: 1.3, jitterPixels: 0.7, maxSpeed: 1100, maxGapMs: 200,
  gain: Object.freeze({ low: 0.8, medium: 1.2, high: 1.7 })
});
export function createGestureScroll({ state, ui, action }) {
  const sessions = new Map();
  const data = state.runtime.scroll = { status: "IDLE", hands: {}, target: null, delta: 0,
    lastTarget: null, lastDelta: null, lastAt: null };
  function begin(handId, target, point, now) {
    if (!ui.isScrollTarget(target) || [...sessions.values()].some(s => s.target === target)) return false;
    const label = ui.scrollLabel(target);
    sessions.set(handId, { target, previous: { ...point }, at: now });
    data.hands[handId] = { target: label, delta: 0, status: "SCROLL CAPTURE" };
    action("SCROLL CAPTURE → " + handId + " · " + label); return true;
  }
  function update(handId, point, now) {
    const session = sessions.get(handId); if (!session) return false;
    const dt = now - session.at;
    if (!ui.isScrollTarget(session.target) || dt > SCROLL_TUNING.maxGapMs) { end(handId); return false; }
    if (!(dt > 0)) return true;
    const step = point.y - session.previous.y;
    session.at = now;
    let actual = 0;
    if (Math.abs(step) >= SCROLL_TUNING.jitterPixels) {
      session.previous = { ...point };
      const gain = SCROLL_TUNING.gain[state.settings.scrollSensitivity] || 1.2;
      const limit = SCROLL_TUNING.maxSpeed * Math.min(dt, 50) / 1000;
      // Content follows the held hand: drag upward to reveal content below.
      actual = ui.applyScroll(session.target, Math.max(-limit, Math.min(limit, -step * gain)));
    }
    const item = data.hands[handId]; item.delta = actual;
    item.status = actual ? "SCROLL" : "SCROLL · EDGE / STILL";
    Object.assign(data, { status: item.status, target: item.target, delta: actual,
      lastDelta: actual, lastTarget: item.target, lastAt: now });
    return true;
  }
  function end(handId) {
    if (!sessions.has(handId)) return;
    sessions.delete(handId); delete data.hands[handId]; action("SCROLL RELEASE → " + handId);
    const remaining = Object.values(data.hands)[0];
    data.status = remaining?.status || "IDLE"; data.target = remaining?.target || null; data.delta = 0;
  }
  function cancel() { for (const id of [...sessions.keys()]) end(id); }
  return { begin, update, end, cancel };
}
