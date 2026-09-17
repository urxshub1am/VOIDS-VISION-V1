const SUPPORTED = Object.freeze([
  "FIST", "PINCH", "THUMBS_UP", "OPEN_PALM", "INDEX_ONLY", "TWO_FINGERS", "SWIPE_LEFT", "SWIPE_RIGHT"
]);
const TEST_WINDOW_MS = 8000;

// Diagnostic tests observe confirmations; they never perform interaction-mode actions.
export function createGestureLab({ state, ui, action, notify, resetInput, manualAllowed }) {
  const data = state.runtime.modeData["gesture-lab"] = {
    status: "DIAGNOSTICS", testing: false, expected: null, role: "primary",
    handId: null, remainingMs: 0, result: "Choose a gesture, then start a test.", attempts: []
  };
  let startedAt = 0, lastRenderAt = 0;

  function cancel() {
    if (data.testing) {
      data.testing = false; data.remainingMs = 0;
      data.result = "Test cancelled. Start again when tracking is ready.";
    }
  }
  function start() {
    const expected = ui.element("lab-test-gesture").value;
    const role = ui.element("lab-test-hand").value;
    if (!SUPPORTED.includes(expected) || !["primary", "secondary", "either"].includes(role)) return;
    if (!manualAllowed() || !state.runtime.gesturesEnabled) {
      notify("Resume and enable gesture input before starting a test."); return;
    }
    const id = role === "primary" ? state.handInput.primaryHandId : role === "secondary" ? state.handInput.secondaryHandId : null;
    const available = state.hands.some((hand) => (!id || hand.id === id) &&
      (role === "either" || id) && hand.tracking.visible && hand.tracking.state === "TRACKING" && !hand.tracking.ambiguous);
    if (!available) { notify("Bring the selected hand into view and wait for TRACKING."); return; }
    resetInput(); // A held pre-test confirmation is never a test response.
    startedAt = performance.now();
    Object.assign(data, { testing: true, expected, role, handId: id, remainingMs: TEST_WINDOW_MS,
      result: "Waiting for " + expected.replaceAll("_", " ") + "…" });
    action("GESTURE LAB → TEST START"); render();
  }
  function finish(success, now, handId = null) {
    data.testing = false; data.remainingMs = 0;
    const responseMs = success ? Math.max(0, now - startedAt) : null;
    data.attempts.push({ gesture: data.expected, role: data.role, handId, success, responseMs });
    if (data.attempts.length > 20) data.attempts.shift();
    data.result = success ? "CONFIRMED · " + handId + " · " + Math.round(responseMs) + " ms response" : "TIMEOUT · no matching confirmation";
    action(success ? "GESTURE LAB → TEST CONFIRMED" : "GESTURE LAB → TEST TIMEOUT");
    render();
  }
  function onGesture(event) {
    if (!data.testing || event.at <= startedAt || (data.handId && event.handId !== data.handId)) return;
    if (event.at - startedAt >= TEST_WINDOW_MS) { finish(false, event.at); return; }
    if (event.gesture === data.expected) finish(true, event.at, event.handId);
    else data.result = "Observed " + event.gesture.replaceAll("_", " ") + "; waiting for " + data.expected.replaceAll("_", " ");
  }
  function tick(now) {
    if (!data.testing) return;
    if (!manualAllowed()) { cancel(); return; }
    const selected = data.handId ? state.hands.find((hand) => hand.id === data.handId) : null;
    if (data.handId && (!selected?.tracking.visible || selected.tracking.state !== "TRACKING")) { cancel(); return; }
    data.remainingMs = Math.max(0, TEST_WINDOW_MS - (now - startedAt));
    if (!data.remainingMs) finish(false, now);
  }
  function render() {
    data.status = data.testing ? "GESTURE TEST RUNNING" : "DIAGNOSTICS";
    ui.setText("lab-test-result", data.result);
    ui.setText("lab-test-timer", data.testing ? (data.remainingMs / 1000).toFixed(1) + " s" : "--");
    ui.element("lab-test-start").disabled = data.testing;
    ui.element("lab-test-cancel").disabled = !data.testing;
    for (const id of ["lab-test-gesture", "lab-test-hand"]) ui.element(id).disabled = data.testing;
    ui.setText("lab-test-history", data.attempts.length ? data.attempts.map((attempt) =>
      attempt.gesture + " · " + (attempt.handId || attempt.role) + " · " +
      (attempt.success ? Math.round(attempt.responseMs) + " ms" : "TIMEOUT")).reverse().join("\n") : "No completed tests.");
    const now = performance.now();
    if (now - lastRenderAt >= 100) {
      lastRenderAt = now;
      ui.setText("lab-runtime", state.trackingState.replaceAll("_", " ") + " · " +
        (Number.isFinite(state.performance.fps) ? state.performance.fps.toFixed(1) + " FPS" : "FPS --") + " · " +
        (Number.isFinite(state.performance.inferenceLatencyMs) ? state.performance.inferenceLatencyMs.toFixed(1) + " ms inference" : "Latency --"));
    }
  }
  return { enter: render, exit: cancel, cancel, render, tick, onGesture,
    onAction(name) {
      if (name === "lab-test-start") { start(); return true; }
      if (name === "lab-test-cancel") { cancel(); render(); return true; }
      return false;
    }
  };
}
