export function createUI(events) {
  const elementCache = new Map();
  function byId(id) {
    const element = elementCache.get(id) || document.getElementById(id);
    if (!element) throw new Error("Missing UI element: #" + id);
    elementCache.set(id, element);
    return element;
  }
  const elements = {};
  const ids = {
    heading: "mode-heading", description: "mode-description",
    activeMode: "active-mode", cameraMode: "camera-mode",
    action: "current-action", system: "system-status", uiStatus: "ui-status",
    pause: "pause-button", pauseOverlay: "pause-overlay", pauseLabel: "pause-label",
    pauseDescription: "pause-description", safeStop: "safe-stop-button",
    hints: "gesture-hints", log: "event-log", logCount: "log-count",
    drawer: "settings-drawer", settingsButton: "settings-button",
    settingsForm: "settings-form", notification: "notification",
    announcement: "announcement", boot: "boot-screen", error: "shell-error",
    video: "camera-video", canvas: "hand-overlay", cameraView: "camera-view",
    cameraEmpty: "camera-empty", cameraDescription: "camera-description",
    cameraStateLabel: "camera-state-label", cameraStatus: "camera-status-text",
    cameraChip: "camera-status-chip", resolution: "camera-resolution",
    fps: "fps-value", latency: "latency-value", detection: "hand-detection",
    handCount: "hand-count", handedness: "handedness-value",
    primaryHand: "primary-hand-value", secondaryHand: "secondary-hand-value", tracking: "tracking-state",
    browserStatus: "browser-status", cameraReady: "camera-readiness",
    modelStatus: "model-status", trackerStatus: "tracker-status",
    performanceStatus: "performance-status", startupStage: "startup-stage",
    startupDetail: "startup-detail", trackingBadge: "tracking-badge",
    engineStatus: "gesture-engine-status", gestureLatency: "gesture-latency",
    raw: "gesture-raw", candidate: "gesture-candidate", confirmed: "gesture-confirmed",
    confidence: "gesture-confidence", stability: "gesture-stability",
    progress: "gesture-progress", stabilityMeter: "stability-meter",
    pinchDistance: "pinch-distance-value", cooldown: "gesture-cooldown",
    swipe: "gesture-swipe", secondaryGesture: "secondary-gesture-value",
    cameraGesture: "camera-gesture", gestureNote: "gesture-note", gestureToggle: "gesture-toggle",
    labStatus: "lab-status", spatialDetails: "spatial-details", spatialStatus: "spatial-status",
    rawDetails: "raw-details", rawCoordinates: "raw-coordinates", gestureHistory: "gesture-history"
  };
  for (const [key, id] of Object.entries(ids)) elements[key] = byId(id);
  const fingers = Object.fromEntries(["thumb", "index", "middle", "ring", "pinky"].map(
    (name) => [name, byId("finger-" + name)]));
  const handSlots = [...document.querySelectorAll("[data-hand-slot]")].map((slot) =>
    Object.fromEntries([...slot.querySelectorAll("[data-hand-field]")].map(
      (node) => [node.dataset.handField, node])));
  const spatialFields = Object.fromEntries([...document.querySelectorAll("[data-spatial-field]")].map(
    (node) => [node.dataset.spatialField, node]));
  const modeButtons = [...document.querySelectorAll("[data-mode]")];
  const modePanels = [...document.querySelectorAll("[data-mode-panel]")];
  const fullscreenButtons = [...document.querySelectorAll('[data-action="fullscreen"]')];
  const cameraButtons = [...document.querySelectorAll('[data-action="camera"]')];
  const context = elements.canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");

  let drawerOpener = null;
  let notificationTimer = null;
  let overlayWidth = 0, overlayHeight = 0, pixelRatio = 1, lastOverlay = null;
  let lastRawUpdate = -Infinity, lastHistoryKey = "", lastDiagnosticAt = -Infinity;
  const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "--";
  const label = (value) => value ? value.replaceAll("_", " ") : "--";
  const percent = (value) => Number.isFinite(value) ? Math.round(value * 100) + "%" : "--";
  const milliseconds = (value) => Number.isFinite(value) ? Math.round(value) + " ms" : "--";
  const yesNo = (value) => value ? "YES" : "NO";
  const position = (value) => value ? number(value.x, 3) + ", " + number(value.y, 3) : "--";
  const pinchLabel = (value) => value ? [value.raw, value.stable, value.confirmed].map(yesNo).join(" / ") : "--";

  function text(element, value) {
    const next = String(value);
    if (element.textContent !== next) element.textContent = next;
  }
  function property(object, key, value) { if (object[key] !== value) object[key] = value; }
  function attribute(node, key, value) {
    const next = String(value); if (node.getAttribute(key) !== next) node.setAttribute(key, next);
  }
  function actionLabel(button, selector, value) { text(button.querySelector(selector) || button, value); }
  function announce(message) { text(elements.announcement, message); }
  function notify(message, tone = "info") {
    window.clearTimeout(notificationTimer);
    text(elements.notification, message);
    elements.notification.dataset.tone = tone;
    elements.notification.hidden = false;
    notificationTimer = window.setTimeout(() => { elements.notification.hidden = true; }, 3200);
  }

  function renderMode(mode, definition, moveFocus = false) {
    document.body.dataset.mode = mode;
    for (const button of modeButtons) {
      if (button.dataset.mode === mode) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    for (const panel of modePanels) panel.hidden = panel.dataset.modePanel !== mode;
    text(elements.heading, definition.title);
    text(elements.description, definition.description);
    text(elements.activeMode, definition.label);
    text(elements.cameraMode, definition.label);
    elements.hints.replaceChildren(...definition.hints.map((hint) => {
      const item = document.createElement("li"); item.textContent = hint; return item;
    }));
    if (moveFocus) elements.heading.focus({ preventScroll: true });
  }

  function renderShell(state) {
    const online = state.camera.active && Object.values(state.readiness).every(Boolean) &&
      !state.runtime.backgrounded && !state.runtime.error && !state.runtime.gestureError;
    text(elements.system, state.runtime.error || state.runtime.gestureError ? "SYSTEM ERROR"
      : online ? "SYSTEM ONLINE"
      : state.runtime.backgrounded ? "TRACKING SUSPENDED" : "SYSTEM NOT INITIALIZED");
    elements.system.dataset.online = String(Boolean(online));
    text(elements.uiStatus, state.readiness.uiReady ? "READY" : "NOT INITIALIZED");
    text(elements.action, state.runtime.currentAction);
    document.body.classList.toggle("hud-expanded", Boolean(state.runtime.hudVisible));
    byId("hud-toggle").setAttribute("aria-pressed", String(Boolean(state.runtime.hudVisible)));
    const showHome = state.currentMode === "home" || state.runtime.hudVisible;
    property(byId("home-content"), "hidden", !showHome);
    property(document.querySelector(".mode-workspaces"), "hidden", state.currentMode === "home");
    setText("top-pause", state.runtime.paused ? "Resume" : "Pause");
    const paused = state.runtime.paused;
    elements.pause.disabled = !state.readiness.uiReady;
    elements.safeStop.disabled = !state.readiness.uiReady;
    text(elements.pause, paused ? "Resume interface" : "Pause interface");
    elements.pause.setAttribute("aria-pressed", String(paused));
    elements.pauseOverlay.hidden = !paused;
    text(elements.pauseLabel, state.currentMode === "pointer" ? "POINTER PAUSED" : "INTERACTION PAUSED");
    text(elements.pauseDescription, state.camera.active
      ? "Confirmation paused. Camera tracking continues while this tab is visible."
      : "Resume from the action panel. Navigation stays available.");
    document.body.classList.toggle("interaction-paused", paused);
    document.body.classList.toggle("effects-reduced", state.settings.visualEffects === "reduced" ||
      (state.settings.autoPerformanceMode && state.performance.effectsReduced));
    const pointerUI = ["home", "pointer", "spatial"].includes(state.currentMode) || state.runtime.handUI;
    byId("pointer-page-controls").hidden = !pointerUI || isModalOpen();
    byId("precision-indicator").hidden = !pointerUI;
    setText("precision-indicator", state.settings.pointerPrecision === "high" ? "HIGH PRECISION" : "NORMAL PRECISION");
    const tools = byId("draw-hand-ui");
    tools.setAttribute("aria-pressed", String(state.runtime.handUI));
    text(tools, state.runtime.handUI ? "Return to drawing" : "Hand UI / tools");

    for (const button of cameraButtons) {
      button.disabled = !state.readiness.uiReady ||
        (!state.readiness.browserReady && !state.runtime.busy && !state.camera.active);
      actionLabel(button, "[data-camera-label]", state.runtime.busy ? "Cancel startup"
        : state.camera.active ? "Stop camera"
        : state.runtime.error ? "Retry camera" : "Start camera");
    }
    const hasVideo = state.readiness.cameraReady;
    elements.video.hidden = !hasVideo;
    elements.canvas.hidden = !hasVideo;
    elements.cameraEmpty.hidden = hasVideo;
    elements.trackingBadge.hidden = !hasVideo;
    elements.cameraView.dataset.live = String(hasVideo);
    elements.video.style.transform = state.settings.cameraMirror ? "scaleX(-1)" : "none";
    text(elements.cameraStateLabel, state.runtime.busy ? "INITIALIZING"
      : state.runtime.error ? "CAMERA UNAVAILABLE" : "CAMERA OFF");
    text(elements.cameraDescription, state.runtime.error ||
      (state.runtime.busy ? state.runtime.startupDetail : "Start the camera to track and classify up to two hands on-device."));
    text(elements.startupStage, state.runtime.startupStage);
    text(elements.startupDetail, state.runtime.startupDetail);
    elements.startupDetail.dataset.error = String(Boolean(state.runtime.error));
    const readiness = {
      browser: state.readiness.browserReady, model: state.readiness.modelReady, camera: state.readiness.cameraReady,
      tracker: state.readiness.trackerReady, gesture: state.readiness.gestureEngineReady && !state.runtime.gestureError
    };
    for (const chip of document.querySelectorAll("[data-ready-key]")) {
      const ready = Boolean(readiness[chip.dataset.readyKey]);
      chip.dataset.ready = String(ready);
      chip.setAttribute("aria-label", chip.dataset.readyKey + (ready ? " ready" : " not ready"));
    }
    const quickStart = byId("quick-start");
    property(quickStart, "hidden", Boolean(state.settings.firstRunDismissed));
    text(elements.cameraStatus, state.camera.active ? "CAMERA ON" : "CAMERA OFF");
    elements.cameraChip.dataset.live = String(state.camera.active);
    elements.gestureToggle.disabled = !state.readiness.uiReady;
    elements.gestureToggle.setAttribute("aria-pressed", String(state.runtime.gesturesEnabled));
    text(elements.gestureToggle, state.runtime.gestureError ? "Retry gesture engine"
      : "Gesture input · " + (state.runtime.gesturesEnabled ? "ON" : "OFF"));
    text(elements.gestureNote, state.runtime.gestureError ||
      (paused ? "Confirmation paused. Resume to start a fresh hold."
        : !state.runtime.gesturesEnabled ? "Gesture input is disabled."
        : "Rule-based match score. Hold to confirm. Either hand may acquire an allowed interaction."));
    elements.gestureNote.dataset.error = String(Boolean(state.runtime.gestureError));
  }

  function renderTelemetry(state) {
    const tracking = state.trackingState === "SEARCHING"
      ? "SEARCHING FOR HAND" : state.trackingState.replaceAll("_", " ");
    const visibleHands = state.hands.filter((hand) => hand.tracking.visible);
    const primary = state.hands.find((hand) => hand.id === state.handInput.primaryHandId);
    const secondary = state.hands.find((hand) => hand.id === state.handInput.secondaryHandId);
    const gesture = primary?.tracking.visible && primary.geometry ? primary.gesture : null;

    text(elements.fps, number(state.performance.fps));
    text(elements.latency, number(state.performance.inferenceLatencyMs));
    text(elements.gestureLatency, number(state.performance.gestureLatencyMs, 2));
    text(elements.detection, state.handInput.detected === null ? "--"
      : state.handInput.detected ? "DETECTED" : "NO HAND");
    text(elements.handCount, state.handInput.count ?? "--");
    text(elements.handedness, visibleHands.length ? visibleHands.map(
      (hand) => hand.id + " · " + (hand.handedness || "Unknown")).join("\n") : "--");
    text(elements.primaryHand, primary
      ? primary.id + " · " + (primary.handedness || "Unknown") + "\n" +
        (state.handInput.activeHandId === primary.id ? "ACTIVE" : state.runtime.paused ? "PAUSED" : "WAITING") : "--");
    text(elements.secondaryHand, secondary ? secondary.id + " · " + (secondary.handedness || "Unknown") : "--");
    text(elements.tracking, tracking);
    text(elements.trackingBadge, tracking);
    elements.trackingBadge.dataset.state = state.trackingState;
    text(elements.resolution, state.camera.width ? state.camera.width + " × " + state.camera.height : "--");
    text(elements.browserStatus, !state.runtime.browserChecked ? "NOT CHECKED"
      : state.readiness.browserReady ? "SUPPORTED" : "UNSUPPORTED");
    text(elements.cameraReady, state.readiness.cameraReady ? "READY" : state.camera.active ? "STARTING" : "OFF");
    text(elements.modelStatus, state.readiness.modelReady ? "READY · " + state.runtime.delegate
      : state.runtime.startupStage === "LOADING MODEL" ? "LOADING" : "NOT INITIALIZED");
    text(elements.trackerStatus, state.runtime.backgrounded ? "SUSPENDED"
      : state.readiness.trackerReady ? "RUNNING" : state.readiness.modelReady ? "IDLE" : "NOT INITIALIZED");
    const engineStatus = state.runtime.gestureError ? "ERROR"
      : !state.readiness.gestureEngineReady ? "NOT INITIALIZED"
      : !state.runtime.gesturesEnabled ? "DISABLED"
      : state.runtime.paused || state.runtime.backgrounded ? "PAUSED"
      : state.readiness.trackerReady ? "RUNNING" : "READY · IDLE";
    text(elements.engineStatus, engineStatus);
    text(elements.labStatus, engineStatus);
    const pointerQualities = Object.values(state.runtime.handPointers || {}).filter(p => p.visible).map(p => p.trackingQuality);
    const cameraFps = state.performance.profile?.cameraFps;
    const inferenceFps = state.performance.fps;
    const latency = state.performance.inferenceLatencyMs;
    let qualityScore = 1;
    if (Number.isFinite(cameraFps)) qualityScore *= Math.min(1, cameraFps / 22);
    if (Number.isFinite(inferenceFps)) qualityScore *= Math.min(1, inferenceFps / 18);
    if (Number.isFinite(latency)) qualityScore *= Math.min(1, 85 / Math.max(45, latency));
    if (pointerQualities.includes("POOR")) qualityScore *= 0.62;
    else if (pointerQualities.includes("FAIR")) qualityScore *= 0.82;
    const trackingQuality = !state.camera.active ? "--" : qualityScore >= 0.72 ? "GOOD" : qualityScore >= 0.44 ? "FAIR" : "POOR";
    state.runtime.trackingQuality = trackingQuality;
    const performanceLabel = state.runtime.backgrounded ? "SUSPENDED"
      : state.performance.fps === null ? "NOT MEASURED"
      : state.performance.fps < 20 ? "LOW FPS" : "MEASURING";
    text(elements.performanceStatus, performanceLabel +
      (state.performance.fps !== null && state.performance.mode === "REDUCED_EFFECTS" ? " · REDUCED EFFECTS" : "") +
      (state.camera.active ? " · TRACKING " + trackingQuality : ""));

    for (const [name, node] of Object.entries(fingers)) {
      const value = primary?.tracking.visible ? primary.fingerStates?.[name] : null;
      text(node, value || "--");
      node.dataset.state = value || "";
    }
    const primaryInputPinch = Boolean(primary?.interactionPinch?.on);
    const secondaryInputPinch = Boolean(secondary?.interactionPinch?.on);
    text(elements.raw, label(primaryInputPinch ? "PINCH" : gesture?.raw));
    text(elements.candidate, label(gesture?.candidate));
    text(elements.confirmed, label(gesture?.confirmed));
    text(elements.confidence, percent(gesture?.displayConfidence));
    text(elements.stability, gesture ? milliseconds(gesture.stabilityMs) + " · " + percent(gesture.stability) : "--");
    const progress = Math.round((gesture?.stability || 0) * 100);
    elements.progress.style.width = progress + "%";
    elements.stabilityMeter.setAttribute("aria-valuenow", String(progress));
    text(elements.pinchDistance, number(primary?.geometry?.pinchDistance, 3));
    text(elements.cooldown, gesture ? milliseconds(gesture.cooldownRemainingMs) +
      (gesture.releaseRequired ? " · release to repeat" : "") : "--");
    text(elements.swipe, label(primary?.swipe?.confirmed || primary?.swipe?.candidate));
    text(elements.secondaryGesture, secondary?.geometry ? label(secondaryInputPinch ? "PINCH" : secondary.gesture.raw) : "--");
    text(elements.cameraGesture, label(primary?.swipe?.confirmed || (primaryInputPinch ? "PINCH" : gesture?.confirmed || gesture?.raw)));

    if (state.currentMode === "gesture-lab" && performance.now() - lastDiagnosticAt >= (state.performance.effectsReduced ? 250 : 125)) {
      lastDiagnosticAt = performance.now(); renderDiagnostics(state, primary, secondary);
    }
  }

  const profiles = [...document.querySelectorAll("[data-performance-profile]")].map(root => ({
    root, fields: Object.fromEntries([...root.querySelectorAll("[data-profile]")].map(n => [n.dataset.profile, n]))
  }));
  function renderProfile(state) {
    const p = state.performance, detail = p.profile;
    for (const { root, fields: f } of profiles) {
      if (root.closest("[hidden], dialog:not([open])")) continue;
      text(f.context, state.currentMode.toUpperCase() + " · " + (state.handInput.count ?? 0) + " HANDS");
      text(f.camera, number(detail?.cameraFps)); text(f.inference, number(p.fps));
      text(f.render, number(p.renderFps)); text(f.latency, number(p.inferenceLatencyMs) + " ms");
      text(f.pipeline, number(detail?.pipelineMs) + " ms"); text(f.hud, number(p.hudHz) + " Hz");
      text(f.source, (detail?.cameraSource || "UNAVAILABLE") + " · " +
        (state.readiness.modelReady ? "CONFIGURED " + state.runtime.delegate : "MODEL NOT LOADED") + " · " +
        (detail?.reduced ? "REDUCED EFFECTS" : "FULL EFFECTS") +
        (detail?.cameraRequestedFps ? " · track setting " + number(detail.cameraRequestedFps) + " FPS" : "") +
        (detail?.inferenceScheduler ? " · scheduler " + detail.inferenceScheduler.replaceAll("_", " ") : "") +
        (Number.isFinite(detail?.sourceFrameIntervalMs) ? " · source Δ " + number(detail.sourceFrameIntervalMs, 1) + " ms" : "") +
        (Number.isFinite(detail?.inferenceIntervalMs) ? " · inference Δ " + number(detail.inferenceIntervalMs, 1) + " ms" : "") +
        ". Camera delivery is browser-observed; unavailable counters show --.");
      if (f.costs.closest("details")?.open) {
        const rows = Object.entries(detail?.stages || {}).map(([name, v]) =>
          name.padEnd(12) + number(v.averageMs, 2).padStart(7) + " ms avg / " + number(v.maxMs, 2) + " ms peak / " + number(v.msPerSecond) + " ms/s");
        text(f.costs, "LAST WINDOW: " + number((detail?.windowMs || 0) / 1000) + " s\n" + rows.join("\n") +
          "\nInference in flight / peak: " + (detail?.inferenceInFlight ?? 0) + " / " + (detail?.maxInferenceInFlight ?? 0) +
          "\nPipeline includes inference → overlay. Mode render includes background; rows overlap.");
      }
    }
  }
  function renderDiagnostics(state, primary, secondary) {
    renderProfile(state);
    const workspace = state.runtime.modeData.spatial;
    const object = workspace?.objects.find(item => item.id === workspace.selectedId);
    setText("spatial-diag-status", workspace ? workspace.status : "NOT INITIALIZED");
    setText("spatial-diag-selected", object ? object.id + " / " + object.type : "--");
    setText("spatial-diag-manipulation", workspace?.manipulation || "NONE");
    setText("spatial-diag-view", workspace ? Math.round(workspace.zoom * 100) + "% / GRID " +
      (workspace.grid ? "ON" : "OFF") + " / SNAP " + (workspace.snap ? "ON" : "OFF") : "--");
    setText("spatial-diag-history", workspace ? workspace.objects.length + " / " + workspace.undoCount + " / " + workspace.redoCount : "--");
    if (byId("spatial-workspace-details").open) {
      const control = workspace?.twoHand, pair = state.spatial;
      const angle = value => Number.isFinite(value) ? number(value * 180 / Math.PI) + "°" : "--";
      setText("spatial-diag-two-hand-state", control?.phase || "NOT INITIALIZED");
      setText("spatial-diag-two-hand-target", control?.target ? control.target.kind.toUpperCase() + " / " + (control.target.id || "VIEW") : "NONE");
      setText("spatial-diag-last-target", control?.lastTarget ? control.lastTarget.kind.toUpperCase() + " / " + (control.lastTarget.id || "VIEW") : "--");
      setText("spatial-diag-pinch", pair?.available ? "P " + pinchLabel(pair.primaryPinch) + " · S " + pinchLabel(pair.secondaryPinch) : "--");
      setText("spatial-diag-both", pair?.available ? [pair.bothPinchingRaw, pair.bothPinchingStable, pair.bothPinchingConfirmed].map(yesNo).join(" / ") : "--");
      setText("spatial-diag-arm", control ? percent(control.progress) + " / " + (control.anchorHandId ? "ANCHOR HELD" : control.releaseRequired ? "OPEN BOTH FOR WORKSPACE" : "WORKSPACE READY") : "--");
      setText("spatial-diag-distances", number(control?.pointerDistance ?? (pair?.available ? pair.distance : null), 3) + " / " + number(control?.baselineDistance, 3));
      setText("spatial-diag-scale", number(control?.scaleRatio, 3) + " / " + number(control?.appliedScale, 3));
      setText("spatial-diag-midpoint", position(pair?.available ? pair.midpoint : null));
      setText("spatial-diag-midpoint-delta", position(control?.midpointDelta));
      setText("spatial-diag-angles", angle(pair?.available ? pair.angle : null) + " / " + angle(control?.baselineAngle));
      setText("spatial-diag-angle-delta", angle(control?.angleDelta) + " / " + angle(control?.appliedAngle));
      setText("spatial-diag-pan", workspace ? position(workspace.pan) + " document-view units" : "--");
      setText("spatial-diag-release", control?.lastReason || "--");
      const cursors = workspace?.pointers, p = cursors?.primary, s = cursors?.secondary;
      setText("spatial-diag-primary-cursor", position(p?.raw) + " / " + position(p?.position));
      setText("spatial-diag-secondary-cursor", position(s?.raw) + " / " + position(s?.position));
      setText("spatial-diag-cursor-ids", (p?.handId || "--") + " / " + (s?.handId || "--"));
      setText("spatial-diag-latched-ids", (control?.anchorHandId || "--") + " / " + (control?.manipulatorHandId || "--"));
      setText("spatial-diag-last-ids", (control?.lastAnchorHandId || "--") + " / " + (control?.lastManipulatorHandId || "--"));
      setText("spatial-diag-cursor-tracking", [p, s].map(c => c ? (c.visible ? "VISIBLE" : "HIDDEN") + " / " + c.trackingState : "--").join(" · "));
      setText("spatial-diag-cursor-hover", (p?.hoverTarget || "--") + " / " + (s?.hoverTarget || "--"));
      setText("spatial-diag-cursor-pinch", [p, s].map(c => c?.pinch ? pinchLabel(c.pinch) : "--").join(" · "));
      setText("spatial-diag-join-target", control?.joinTarget || "NONE");
      setText("spatial-diag-last-join", control?.lastJoinTarget || "--");
      setText("spatial-diag-intent", control?.intent || "NONE");
      setText("spatial-diag-translation", position(control?.translation));
      setText("spatial-diag-resize", position(control?.resizeDelta));
      setText("spatial-diag-preferences", (state.settings.spatialDualPointer !== false ? "ON" : "OFF") + " / " +
        (state.settings.magneticAimAssist !== false ? "ON" : "OFF") + " / " + (state.settings.transformSensitivity || "medium") +
        " / 3D " + String(state.settings.spatial3DTransformMode || "auto").toUpperCase());
      const holo = state.runtime.modeData.spatial3D;
      setText("spatial-diag-3d-selected", holo?.selectedId ? holo.selectedId + " / " + (workspace?.objects3D?.find(o => o.id === holo.selectedId)?.type || "--") : "--");
      setText("spatial-diag-3d-control", holo ? holo.phase + " / " + (holo.anchorHandId || "--") + " / " + (holo.manipulatorHandId || "--") + " / " + (holo.trackingGuard || "READY") : "--");
      setText("spatial-diag-3d-transform", holo ? (holo.transformIntent || "NONE") + " · " + number(holo.scaleRatio, 2) + "× / " + number(holo.yaw, 1) + "° / " + number(holo.pitch, 1) + "° / " + number(holo.roll, 1) + "°" : "--");
      setText("spatial-diag-3d-evidence", holo ? number(holo.scaleEvidence, 3) + " / " + number(holo.rotateEvidence, 3) : "--");
      setText("spatial-diag-3d-performance", holo ? number(holo.renderFps, 1) + " FPS / " + (holo.backend || "--") + " / " + holo.quality + " / " + holo.objectCount : "--");

    }
    const ordered = [];
    if (primary) ordered.push(primary);
    if (secondary && secondary !== primary) ordered.push(secondary);
    for (const hand of state.hands) if (!ordered.includes(hand)) ordered.push(hand);
    handSlots.forEach((slot, index) => {
      const hand = ordered[index];
      const observed = hand?.geometry && hand.tracking.visible;
      const role = hand?.id === state.handInput.primaryHandId ? "PRIMARY"
        : hand?.id === state.handInput.secondaryHandId ? "SECONDARY" : "UNASSIGNED";
      const pointer = hand ? state.runtime.handPointers?.[hand.id] : null;
      const interactionPinch = hand?.interactionPinch;
      const motion = hand?.motionState;
      const swipeIntent = pointer?.swipeIntent;
      const values = {
        identity: hand ? hand.id + " · " + (hand.handedness || "Unknown") + " · " + role : "Hand --",
        tracking: hand ? hand.tracking.state + (hand.tracking.visible ? "" : " · MISSING") : "--",
        raw: observed ? label(hand.gesture.raw) : "--",
        candidate: observed ? label(hand.gesture.candidate) : "--",
        confirmed: observed ? label(hand.gesture.confirmed) : "--",
        confidence: observed ? percent(hand.gesture.confidence) : "--",
        stability: observed ? milliseconds(hand.gesture.stabilityMs) + " / " + percent(hand.gesture.stability) : "--",
        fingers: observed ? Object.entries(hand.fingerStates).map(([name, value]) => name + ": " + value).join("\n") : "--",
        scale: observed ? number(hand.handScale, 3) : "--",
        pinchDistance: observed ? number(hand.pinchDistance, 3) : "--",
        pinch: observed ? pinchLabel(hand.pinch) : "--",
        interactionPinch: observed && interactionPinch ? interactionPinch.transition + " · " + milliseconds(interactionPinch.stableMs) : "--",
        pinchThresholds: observed && interactionPinch ? number(interactionPinch.enterThreshold, 3) + " / " + number(interactionPinch.exitThreshold, 3) : "--",
        pinchCalibration: observed && interactionPinch?.calibration ? interactionPinch.calibration.status + " · " + percent(interactionPinch.calibration.confidence) +
          " · open " + number(interactionPinch.calibration.openMean, 3) + " · near " + number(interactionPinch.calibration.pinchMin, 3) : "--",
        pointerPositions: pointer ? position(pointer.raw) + " / " + position(pointer.filtered) + " / " + position(pointer.rendered) : "--",
        pointerError: pointer ? number(pointer.pointerError, 2) + " px" : "--",
        motionDetail: motion ? motion.direction + " · " + number(motion.speed, 3) + " /s" : "--",
        motionConfidence: motion ? percent(motion.poseConfidence) + " / " + percent(motion.motionConfidence) : "--",
        trackingQuality: pointer?.trackingQuality || motion?.trackingQuality || "--",
        pointerMapping: pointer?.mapping ? number(pointer.mapping.center.x, 3) + ", " + number(pointer.mapping.center.y, 3) + " · " +
          number(pointer.mapping.width, 3) + " × " + number(pointer.mapping.height, 3) + " · " + pointer.mapping.samples + " samples" : "--",
        swipeIntent: swipeIntent ? swipeIntent.state + " · " + (swipeIntent.cancelReason || swipeIntent.direction || "--") + " · motion " + percent(swipeIntent.motionConfidence) : "--",
        movement: observed ? hand.movementDirection + " · " + percent(hand.motion.consistency) : "--",
        history: observed ? String(hand.movementHistory.length) : "--",
        cooldown: observed ? milliseconds(hand.gesture.cooldownRemainingMs) + (hand.gesture.releaseRequired ? " · release required" : "") : "--",
        swipe: observed ? label(hand.swipe.candidate) + " / " + label(hand.swipe.confirmed) : "--",
        swipeScore: observed ? percent(hand.swipe.confidence) + " / " + percent(hand.swipe.progress) : "--",
        swipeCooldown: observed ? milliseconds(hand.swipe.cooldownRemainingMs) + (hand.swipe.releaseRequired ? " · release / hold still" : "") : "--"
      };
      for (const [name, node] of Object.entries(slot)) text(node, values[name] ?? "--");
    });

    if (elements.spatialDetails.open) {
      const s = state.spatial;
      text(elements.spatialStatus, s.available ? "PAIR AVAILABLE · " + s.pairKey
        : "Two stable tracked hands are required. Previous pair geometry has been cleared.");
      const values = {
        primaryPosition: position(s.primaryPosition), secondaryPosition: position(s.secondaryPosition),
        midpoint: position(s.midpoint), relativeVector: position(s.relativeVector),
        distance: number(s.distance, 3), normalizedDistance: number(s.normalizedDistance, 3),
        angle: s.angle === null ? "--" : number(s.angle * 180 / Math.PI) + "°",
        distanceDelta: number(s.distanceDelta, 4),
        angleDelta: s.angleDelta === null ? "--" : number(s.angleDelta * 180 / Math.PI) + "°",
        distanceVelocity: number(s.distanceVelocity, 3),
        angularVelocity: s.angularVelocity === null ? "--" : number(s.angularVelocity * 180 / Math.PI),
        scaleRatio: number(s.scaleRatio, 3),
        primaryPinch: s.available ? pinchLabel(s.primaryPinch) : "--",
        secondaryPinch: s.available ? pinchLabel(s.secondaryPinch) : "--",
        bothPinching: s.available ? [s.bothPinchingRaw, s.bothPinchingStable, s.bothPinchingConfirmed].map(yesNo).join(" / ") : "--",
        pairKey: s.pairKey || "--"
      };
      for (const [name, node] of Object.entries(spatialFields)) text(node, values[name] ?? "--");
    }
    const now = performance.now();
    if (elements.rawDetails.open && now - lastRawUpdate >= 250) {
      lastRawUpdate = now;
      const raw = state.hands.filter((hand) => hand.tracking.visible).map((hand) =>
        ({ id: hand.id, handedness: hand.handedness, landmarks: hand.landmarks }));
      text(elements.rawCoordinates, raw.length ? JSON.stringify(raw, null, 2) : "No current hand observations.");
    }
    const history = state.runtime.gestureHistory;
    const key = history.map((event) => event.at + ":" + event.handId + ":" + event.gesture).join("|");
    if (key !== lastHistoryKey) {
      lastHistoryKey = key;
      elements.gestureHistory.replaceChildren(...[...history].reverse().map((event) => {
        const row = document.createElement("li");
        row.className = "log-empty";
        row.textContent = event.handId + " · " + event.role + " · " + label(event.gesture) + " · " + percent(event.confidence);
        return row;
      }));
    }
    if (byId("precision-details").open) {
      const p = state.runtime.precision;
      const live = Object.values(state.runtime.handPointers || {}).find(p => p.visible);
      setText("precision-source", live ? "LIVE PER-HAND INPUT · " + live.handId : "No current hand observation");
      setText("precision-raw", position(live?.raw));
      setText("precision-filtered", position(live?.filtered));
      setText("precision-speed", live ? number(live.speed) + " px/s" : "--");
      setText("precision-state", state.settings.pointerPrecision.toUpperCase() + " · adaptive " + (state.settings.adaptiveSmoothing ? "ON" : "OFF"));
      setText("precision-hover", live?.hoverTarget || "--");
      setText("precision-scroll", state.runtime.scroll.status);
      setText("precision-scroll-delta", number(state.runtime.scroll.delta, 2) + " / " + number(state.runtime.scroll.lastDelta, 2) + " px");
      setText("precision-scroll-target", (state.runtime.scroll.target || "--") + " / " + (state.runtime.scroll.lastTarget || "--"));
      setText("precision-last-draw", p.draw ? position(p.draw.raw) + " → " + position(p.draw.filtered) + " (drawing units)" : "--");
      const entries = Object.values(state.runtime.handPointers || {}).sort((a,b) => Number(b.visible) - Number(a.visible));
      ["interaction-hand-a", "interaction-hand-b"].forEach((id, index) => {
        const pointer = entries[index], hand = state.hands.find(h => h.id === pointer?.handId);
        setText(id, pointer ? [
          pointer.handId + " · " + (hand?.handedness || "--") + " · " + pointer.trackingState,
          "RAW      " + position(pointer.raw), "FILTERED " + position(pointer.filtered),
          "RENDERED " + position(pointer.rendered), "VELOCITY " + position(pointer.velocity) + " px/s",
          "SPEED " + number(pointer.speed) + " px/s · GAIN " + number(pointer.gain, 2),
          "FILTER " + pointer.filterMode + " · OUTLIER " + pointer.outlierState,
          "HOVER " + (pointer.hoverTarget || "NONE"), "CAPTURE " + (pointer.capturedTarget || "NONE"),
          "KIND " + (pointer.captureKind || "NONE") + " · OWNER " + (pointer.owner || "NONE"),
          "PINCH distance raw / palm " + number(pointer.interactionPinch?.rawDistance, 4) + " / " + number(pointer.interactionPinch?.normalizedDistance, 3),
          "PINCH geometry / hysteresis / interaction / gesture " + [pointer.interactionPinch?.rawPinch, pointer.interactionPinch?.on, pointer.interactionPinch?.interactionPinch, pointer.interactionPinch?.confirmedGesturePinch].map(yesNo).join(" / "),
          "PINCH stable " + number(pointer.interactionPinch?.stableMs) + " / " + number(pointer.interactionPinch?.requiredMs) + " ms · samples " + (pointer.interactionPinch?.samples || 0),
          "PINCH velocity " + number(pointer.interactionPinch?.distanceVelocity, 2) + " /s · interval " + number(pointer.interactionPinch?.sampleIntervalMs, 1) + " ms",
          "FAST PINCH " + (pointer.interactionPinch?.fastTapState || "IDLE") + " · tap " + yesNo(pointer.interactionPinch?.fastTap) + " · valley " + number(pointer.interactionPinch?.fastTapValley, 3),
          "RELEASE " + (pointer.interactionPinch?.releaseReason || "--") + " · assist " + yesNo(pointer.interactionPinch?.releaseAssist),
          "LATCH " + (pointer.latchedTarget || "NONE") + " · age " + number(pointer.latchAge) + " ms",
          "CLICK candidate " + yesNo(pointer.clickCandidate) + " · cooldown " + number(pointer.cooldownRemaining) + " ms",
          "SWIPE " + (pointer.swipeIntent?.state || "IDLE") + " · " + (pointer.swipeIntent?.cancelReason || "--") + " · direction " + (pointer.swipeIntent?.direction || "--"),
          "SWIPE dx/dy " + number(pointer.swipeIntent?.dx, 3) + " / " + number(pointer.swipeIntent?.dy, 3) + " · ratio " + number(pointer.swipeIntent?.dominance, 2),
          "SWIPE distance " + number(pointer.swipeIntent?.distance, 3) + " · velocity " + number(pointer.swipeIntent?.velocity, 3) + " widths/s · samples " + (pointer.swipeIntent?.samples || 0),
          "INTENT " + pointer.intent + " · " + (pointer.visible ? "VISIBLE" : "HIDDEN"),
          "CALIBRATION " + pointer.calibration + " · TRAIL " + pointer.trail.length,
          hand?.swipe?.evidence ? "SWIPE dx/dy " + position({x: hand.swipe.evidence.dx, y: hand.swipe.evidence.dy}) +
            " · dominance " + number(hand.swipe.evidence.dominance, 2) + " · path " + number(hand.swipe.evidence.pathDominance, 2) : "SWIPE no current path"
        ].join("\n") : "No hand in this slot.");
      });
      const interaction = state.runtime.interaction;
      setText("interaction-global", interaction ? [
        "MODE " + interaction.mode, "ALLOWED " + interaction.allowed.join(" / "),
        "SCROLL " + (interaction.activeScrollTargets.join(" / ") || "NONE"),
        "SWIPE OWNER " + (interaction.swipeOwner || "NONE") + " · LASER OWNER " + (interaction.laserOwner || "NONE"),
        "DRAW OWNER " + (interaction.drawOwner || "NONE") + " · GAME OWNER " + (interaction.gameOwner || "NONE"),
        "RENDER " + number(state.performance.renderFps) + " FPS · INFERENCE " + number(state.performance.fps) + " FPS",
        "INFERENCE LATENCY " + number(state.performance.inferenceLatencyMs) + " ms · HUD " + number(state.performance.hudHz) + " Hz"
      ].join("\n") : "Input not initialized.");
    }
  }

  function resizeOverlay() {
    overlayWidth = elements.cameraView.clientWidth;
    overlayHeight = elements.cameraView.clientHeight;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(overlayWidth * pixelRatio));
    const height = Math.max(1, Math.round(overlayHeight * pixelRatio));
    if (elements.canvas.width !== width) elements.canvas.width = width;
    if (elements.canvas.height !== height) elements.canvas.height = height;
    paintOverlay();
  }

  let overlayOnscreen = true;
  if (typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver(entries => {
      overlayOnscreen = entries[0]?.isIntersecting ?? false;
      if (overlayOnscreen) paintOverlay();
    });
    observer.observe(elements.cameraView);
  }
  function paintOverlay() {
    if (!overlayOnscreen || !overlayWidth || !overlayHeight) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, overlayWidth, overlayHeight);
    if (!lastOverlay || !lastOverlay.showSkeleton) return;
    const { hands, connections, mirrored, primaryHandId, reduced } = lastOverlay;
    const videoWidth = elements.video.videoWidth, videoHeight = elements.video.videoHeight;
    if (!videoWidth || !videoHeight || !overlayWidth || !overlayHeight) return;
    const scale = Math.min(overlayWidth / videoWidth, overlayHeight / videoHeight);
    const width = videoWidth * scale, height = videoHeight * scale;
    const left = (overlayWidth - width) / 2, top = (overlayHeight - height) / 2;
    context.save();
    context.beginPath(); context.rect(left, top, width, height); context.clip();

    for (const hand of hands) {
      if (!hand.tracking.visible || hand.landmarks.length !== 21) continue;
      const points = hand.landmarks.map((point) => ({
        x: left + (mirrored ? 1 - point.x : point.x) * width, y: top + point.y * height
      }));
      context.save();
      context.globalAlpha = hand.tracking.state === "TRACKING" ? 1 : 0.55;
      context.strokeStyle = "#45dbff"; context.lineWidth = 1.25; context.lineCap = "round";
      context.beginPath();
      for (const [start, end] of connections) {
        context.moveTo(points[start].x, points[start].y);
        context.lineTo(points[end].x, points[end].y);
      }
      context.stroke();
      context.fillStyle = "#9aeaff";
      for (const point of points) {
        context.beginPath(); context.arc(point.x, point.y, 2.3, 0, Math.PI * 2); context.fill();
      }
      const tip = points[8];
      context.shadowColor = "#45dbff"; context.shadowBlur = reduced ? 0 : 9; context.fillStyle = "#ffffff";
      context.beginPath(); context.arc(tip.x, tip.y, 4, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.arc(tip.x, tip.y, 9, 0, Math.PI * 2); context.stroke();
      context.shadowBlur = 0;
      if (hand.gesture?.stability > 0) {
        context.beginPath();
        context.arc(tip.x, tip.y, 14, -Math.PI / 2, -Math.PI / 2 + hand.gesture.stability * Math.PI * 2);
        context.stroke();
      }
      // Visual thumb↔index contact must represent the current physical sample,
      // not the wider interaction hysteresis latch. This makes release feedback
      // immediate while the action layer can still use a small safety hysteresis.
      const visualPinch = Boolean(hand.interactionPinch?.visualContact);
      const inputPinch = Boolean(hand.interactionPinch?.on);
      if (visualPinch) {
        context.save();
        context.strokeStyle = hand.interactionPinch?.interactionPinch ? "#7fffd4" : "#45dbff";
        context.lineWidth = hand.interactionPinch?.interactionPinch ? 2.4 : 1.6;
        context.beginPath(); context.moveTo(points[4].x, points[4].y); context.lineTo(tip.x, tip.y); context.stroke();
        context.restore();
      }
      const identity = hand.id + " · " + (hand.handedness || "Unknown") + (hand.id === primaryHandId ? " · PRIMARY" : "");
      const gesture = hand.geometry ? label(hand.swipe?.confirmed || (inputPinch ? "PINCH" : hand.gesture?.confirmed || hand.gesture?.raw)) : "";
      const gestureText = gesture + (hand.gesture?.confirmed || hand.swipe?.confirmed ? " · CONFIRMED" : "");
      context.font = "10px Consolas, monospace"; context.textBaseline = "alphabetic";
      const labelWidth = Math.min(Math.max(context.measureText(identity).width, context.measureText(gestureText).width) + 12, width - 8);
      const labelHeight = gesture ? 36 : 22;
      if (labelWidth > 12 && height > labelHeight + 8) {
        const x = Math.max(left + 4, Math.min(points[0].x + 10, left + width - labelWidth - 4));
        const y = Math.max(top + 4, Math.min(points[0].y + 12, top + height - labelHeight - 4));
        context.fillStyle = "#06121ddd"; context.fillRect(x, y, labelWidth, labelHeight);
        context.fillStyle = "#edf6ff"; context.fillText(identity, x + 6, y + 15, labelWidth - 12);
        if (gesture) {
          context.fillStyle = "#45dbff"; context.fillText(gestureText, x + 6, y + 29, labelWidth - 12);
        }
      }
      context.restore();
    }
    context.restore();
  }

  function drawHands(hands, connections, settings, primaryHandId, reduced = false) {
    lastOverlay = { hands, connections, primaryHandId, reduced,
      mirrored: settings.cameraMirror, showSkeleton: settings.showSkeleton };
    if (pixelRatio !== Math.min(window.devicePixelRatio || 1, 2)) resizeOverlay();
    else paintOverlay();
  }
  function clearHands() { lastOverlay = null; paintOverlay(); }
  const resizeObserver = new ResizeObserver(resizeOverlay);
  resizeObserver.observe(elements.cameraView);
  resizeOverlay();

  const logRows = new Map();
  let emptyLog = null;
  function renderLog(entries) {
    text(elements.logCount, entries.length + " / 25");
    const previousTop = elements.log.scrollTop, previousHeight = elements.log.scrollHeight;
    const current = new Set(entries);
    for (const [entry, row] of logRows) if (!current.has(entry)) { row.remove(); logRows.delete(entry); }
    if (!entries.length) {
      if (!emptyLog) {
        emptyLog = document.createElement("li"); emptyLog.className = "log-empty";
        emptyLog.textContent = "No events. Waiting for an interface action.";
        elements.log.replaceChildren(emptyLog);
      }
      return;
    }
    if (emptyLog) { emptyLog.remove(); emptyLog = null; }
    if (!logRows.size) elements.log.replaceChildren();
    [...entries].reverse().forEach((entry, index) => {
      let row = logRows.get(entry);
      if (!row) {
        row = document.createElement("li"); row.className = "log-entry"; row.dataset.category = entry.category;
        const date = new Date(entry.at), time = document.createElement("time");
        time.dateTime = date.toISOString(); time.textContent = date.toLocaleTimeString([], { hour12: false });
        const category = document.createElement("span"); category.className = "log-category"; category.textContent = entry.category;
        const message = document.createElement("span"); message.textContent = entry.message;
        row.append(time, category, message); logRows.set(entry, row);
      }
      if (elements.log.children[index] !== row) elements.log.insertBefore(row, elements.log.children[index] || null);
    });
    if (previousTop > 2) elements.log.scrollTop = Math.max(0, previousTop + elements.log.scrollHeight - previousHeight);
  }
  function renderSettingsDefaults(settings) {
    const values = { ...settings, ...settings.advanced };
    for (const [name, value] of Object.entries(values)) {
      const control = elements.settingsForm.elements.namedItem(name);
      if (!control) continue;
      if (control.type === "checkbox") control.checked = value;
      else control.value = String(value);
    }
    for (const button of document.querySelectorAll("[data-preference]")) {
      const name = button.dataset.preference;
      const selected = String(settings[name]) === button.dataset.value;
      button.setAttribute("aria-pressed", String(selected));
    }
    setText("adaptive-setting", "Adaptive smoothing · " + (settings.adaptiveSmoothing ? "ON" : "OFF"));
    byId("adaptive-setting").setAttribute("aria-pressed", String(settings.adaptiveSmoothing));
    for (const [id, key, label] of [["dual-ui-setting", "dualHandUI", "Dual hand UI"], ["spatial-dual-setting", "spatialDualPointer", "Spatial dual pointer"],
      ["spatial-magnetic-setting", "magneticAimAssist", "Magnetic aim assist"]]) {
      const enabled = settings[key] !== false;
      setText(id, label + " · " + (enabled ? "ON" : "OFF")); byId(id).setAttribute("aria-pressed", String(enabled));
    }
    for (const button of document.querySelectorAll("[data-system-preset]")) {
      button.setAttribute("aria-pressed", String(settings.performancePreset === button.dataset.systemPreset));
    }
    const presetLabel = (settings.performancePreset || "custom").toUpperCase();
    setText("system-preset-status", presetLabel + " · automatic performance protection " + (settings.autoPerformanceMode ? "ON" : "OFF"));
  }
  function openSettings(opener) {
    if (elements.drawer.open) return false;
    if (typeof elements.drawer.showModal !== "function") {
      notify("Settings requires a current Chrome or Edge browser.", "warning"); return false;
    }
    drawerOpener = opener || document.activeElement;
    elements.drawer.showModal();
    elements.settingsButton.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
    return true;
  }
  function closeSettings() { if (elements.drawer.open) elements.drawer.close(); }
  elements.drawer.addEventListener("close", () => {
    elements.settingsButton.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
    if (drawerOpener instanceof HTMLElement && drawerOpener.isConnected) drawerOpener.focus({ preventScroll: true });
    events.dispatchEvent(new Event("settingsClosed"));
  });
  elements.drawer.addEventListener("click", (event) => {
    if (event.target !== elements.drawer) return;
    const bounds = elements.drawer.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) closeSettings();
  });
  function renderFullscreen(active, pending = false) {
    const available = Boolean(document.fullscreenEnabled &&
      document.documentElement.requestFullscreen && document.exitFullscreen);
    const fullLabel = available ? (active ? "Exit fullscreen" : "Fullscreen") : "Fullscreen unavailable";
    for (const button of fullscreenButtons) {
      button.disabled = pending || !available;
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", fullLabel); button.title = fullLabel;
      text(button.querySelector("[data-fullscreen-label]"), fullLabel);
    }
  }
  // Shared presentation helpers. Mode modules own behavior; gesture rules stay in the engine.
  const cursor = byId("mode-cursor"), cursorProgress = byId("cursor-progress");
  const cursorTrail = byId("cursor-trail");
  const trailDots = Array.from({ length: 12 }, () => {
    const dot = document.createElement("i"); dot.hidden = true; cursorTrail.append(dot); return dot;
  });
  const spatialPointers = byId("spatial-pointers"), spatialConnection = byId("spatial-pointer-connection");
  const spatialCursorParts = Object.fromEntries(["primary", "secondary"].map(role => [role, {
    node: byId("spatial-" + role + "-cursor"), progress: byId("spatial-" + role + "-progress"),
    label: byId("spatial-" + role + "-cursor-state"),
    trail: Array.from({ length: 12 }, () => {
      const dot = document.createElement("i"); dot.className = "spatial-trail-dot " + role; dot.hidden = true;
      byId("spatial-pointer-trails").append(dot); return dot;
    })
  }]));
  const checkDialog = byId("system-check-dialog");
  const welcomeDialog = byId("welcome-dialog");
  let hover = null, checkOpener = null, audioContext = null, audioError = false;
  let lastToneAt = -Infinity;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function setText(id, value) { text(byId(id), value); }
  function viewportBounds() {
    return { left: 12, top: 12, width: Math.max(1, window.innerWidth - 24), height: Math.max(1, window.innerHeight - 24) };
  }
  function clampPoint(point, bounds) {
    return { x: clamp(point.x, bounds.left, bounds.left + bounds.width),
      y: clamp(point.y, bounds.top, bounds.top + bounds.height) };
  }
  function pointerScope() { return welcomeDialog.open ? welcomeDialog : elements.drawer.open ? elements.drawer : checkDialog.open ? checkDialog : document; }
  function targetLabel(target) { return target ? (target.getAttribute("aria-label") || target.textContent || target.id).trim().slice(0, 80) : null; }
  function targetBounds(target) {
    const r = target.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function boundsUnchanged(target, previous) {
    if (!target?.isConnected || !previous) return false;
    const r = targetBounds(target);
    return Object.keys(r).every((key) => Math.abs(r[key] - previous[key]) <= 2);
  }
  function mapPoint(point, bounds, region = { left: 0, top: 0, width: 1, height: 1 }) {
    return { x: bounds.left + clamp((point.x - region.left) / region.width, 0, 1) * bounds.width,
      y: bounds.top + clamp((point.y - region.top) / region.height, 0, 1) * bounds.height };
  }
  function smoothPoint(previous, destination, smoothing, dt) {
    if (!previous) return { ...destination };
    const alpha = 1 - Math.pow(clamp(smoothing, 0.1, 0.9), clamp(dt || 33, 1, 100) / 16.667);
    return { x: previous.x + (destination.x - previous.x) * alpha,
      y: previous.y + (destination.y - previous.y) * alpha };
  }
  function hitTarget(x, y, scope = document) {
    const target = document.elementFromPoint(x, y)?.closest("[data-gesture-target]");
    return target && scope.contains(target) && !target.matches(":disabled, [aria-disabled='true']") &&
      !target.closest("[hidden], dialog:not([open])") ? target : null;
  }
  function targetAtPoint(target, point, scope, padding = 0) {
    if (!target?.isConnected || !point || !scope.contains(target) ||
        target.matches(":disabled, [aria-disabled='true']") || target.closest("[hidden], dialog:not([open])")) return false;
    const rect = targetBounds(target);
    if (rect.width <= 0 || rect.height <= 0 || point.x < rect.left - padding ||
        point.x > rect.left + rect.width + padding || point.y < rect.top - padding ||
        point.y > rect.top + rect.height + padding) return false;
    const direct = hitTarget(point.x, point.y, scope);
    if (direct) return direct === target; // Padding never steals a neighbouring button's click.
    if (!padding) return false;
    const inside = { x: clamp(point.x, rect.left + 1, rect.left + rect.width - 1),
      y: clamp(point.y, rect.top + 1, rect.top + rect.height - 1) };
    return hitTarget(inside.x, inside.y, scope) === target;
  }
  function pointInside(point, element, padding = 0) {
    if (!point || !element?.isConnected || element.closest("[hidden], dialog:not([open])")) return false;
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && point.x >= r.left - padding && point.x <= r.left + r.width + padding &&
      point.y >= r.top - padding && point.y <= r.top + r.height + padding;
  }
  function acquireTarget(point, scope, padding) {
    const direct = hitTarget(point.x, point.y, scope); if (direct || !padding) return direct;
    let best = null, bestDistance = Infinity;
    for (const [dx,dy] of [[-padding,0],[padding,0],[0,-padding],[0,padding]]) {
      const candidate = hitTarget(point.x + dx, point.y + dy, scope);
      if (!candidate || !pointInside(point, candidate, padding)) continue;
      const rect = candidate.getBoundingClientRect();
      const d = Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom));
      if (d < bestDistance) { best = candidate; bestDistance = d; }
    }
    return best;
  }
  function createStableHover(holdMs = 85, padding = 7) {
    let target = null, pending = null, since = null;
    return {
      get target() { return target; },
      clear() { target = pending = null; since = null; },
      update(point, now, scope = document, magnetic = true) {
        if (target && (!target.isConnected || !scope.contains(target) || target.matches(":disabled, [aria-disabled='true']") ||
            target.closest("[hidden], dialog:not([open])"))) target = null;
        const next = acquireTarget(point, scope, magnetic ? padding : 0);
        if (next === target) { pending = null; since = null; return target; }
        const insideRelease = target && pointInside(point, target, magnetic ? padding + 5 : 5);
        if (!next && insideRelease && targetAtPoint(target, point, scope, magnetic ? padding + 5 : 5)) return target;
        if (pending !== next || since === null) { pending = next; since = now; }
        if (target && !insideRelease) target = null;
        if (now - since >= holdMs) { target = next; pending = null; since = null; }
        return target;
      }
    };
  }
  const handHovers = new Set();
  function setHandHovers(targets) {
    const next = new Set(targets.filter(Boolean));
    for (const target of handHovers) if (!next.has(target)) { target.classList.remove("gesture-hover"); handHovers.delete(target); }
    for (const target of next) if (!handHovers.has(target)) { target.classList.add("gesture-hover"); handHovers.add(target); }
  }
  function isCriticalTarget(target) {
    return target && ["camera", "draw-clear", "spatial-confirm-delete", "spatial-delete", "spatial-3d-confirm-delete", "spatial-3d-delete", "spatial-confirm-load", "system-reset", "reset-settings", "settings-reset", "safe-stop"].includes(target.dataset.action);
  }
  function setHover(target) {
    if (target === hover) return;
    hover?.classList.remove("gesture-hover"); hover = target; hover?.classList.add("gesture-hover");
  }
  function renderCursor(value) {
    // Native dialogs occupy the browser's top layer; place the in-app cursor there too.
    const parent = pointerScope() === document ? document.body : pointerScope();
    if (cursor.parentElement !== parent) { parent.append(cursor, cursorTrail); }
    cursor.hidden = !value;
    if (value) {
      cursor.dataset.kind = value.kind || "pointer";
      cursor.style.transform = `translate3d(${value.x - 20}px, ${value.y - 20}px, 0)`;
      cursorProgress.style.strokeDashoffset = String(107 * (1 - clamp(value.progress || 0, 0, 1)));
    }
    trailDots.forEach((dot, index) => {
      const point = value?.trail?.[index]; dot.hidden = !point;
      if (point) { dot.style.transform = `translate3d(${point.x - 2}px, ${point.y - 2}px, 0)`; dot.style.opacity = String((index + 1) / 24); }
    });
  }
  const scrollRails = [...document.querySelectorAll("[data-scroll-rail]")];
  const pointerSlotIds = [null, null];
  function renderHandPointers(value) {
    const list = value?.pointers || [], control = value?.control;
    for (const rail of scrollRails) {
      const panel = byId(rail.dataset.scrollRail);
      attribute(rail, "data-captured", list.some(p => p.captureKind === "SCROLL_CAPTURE" && p.capturedTarget === scrollLabel(panel)));
    }
    const parent = pointerScope() === document ? document.body : pointerScope();
    if (spatialPointers.parentElement !== parent) parent.append(spatialPointers);
    property(spatialPointers, "hidden", !list.some(p => p.visible && p.rendered));
    for (let slot = 0; slot < 2; slot++) {
      if (!list.some(p => p.handId === pointerSlotIds[slot] && p.visible)) pointerSlotIds[slot] = null;
    }
    for (const p of list) if (p.visible && !pointerSlotIds.includes(p.handId)) {
      const slot = pointerSlotIds.indexOf(null); if (slot !== -1) pointerSlotIds[slot] = p.handId;
    }
    for (let slot = 0; slot < 2; slot++) {
      const role = slot ? "secondary" : "primary", c = list.find(p => p.handId === pointerSlotIds[slot]), parts = spatialCursorParts[role];
      property(parts.node, "hidden", !c?.visible || !c.rendered);
      if (c?.visible && c.rendered) {
        const p = c.rendered;
        property(parts.node.style, "transform", `translate3d(${p.x - 20}px, ${p.y - 20}px, 0)`);
        const status = c.handId === control?.anchorHandId ? "ANCHOR" : c.handId === control?.manipulatorHandId ? "MANIPULATOR"
          : c.role === "LASER" ? "LASER" : ({ PINCH_ARMING: "PINCH", CLICK_CAPTURE: "PINCH", OBJECT_CAPTURE: "GRAB", TRANSFORM_CAPTURE: "TRANSFORM", SCROLL_CAPTURE: "SCROLL", DRAW_CAPTURE: "DRAW", SWIPE_CAPTURE: "SWIPE", HOVER: "TARGET LOCKED" }[c.intent] || c.intent);
        property(parts.node.dataset, "phase", status); property(parts.node.dataset, "edge", p.x > window.innerWidth - 180 ? "left" : "right");
        property(parts.node.dataset, "bottom", String(p.y > window.innerHeight - 65));
        const progress = c.handId === control?.manipulatorHandId && control.phase === "SECONDARY_ARMING" ? control.progress : c.pinchProgress;
        property(parts.progress.style, "strokeDashoffset", String(107 * (1 - clamp(progress || 0, 0, 1))));
        text(parts.label, c.handId + " · " + status);
      }
      parts.trail.forEach((dot, index) => {
        const point = c?.visible && index < (value?.reduced ? 3 : 12) ? c.trail?.[index] : null;
        property(dot, "hidden", !point);
        if (point) { property(dot.style, "transform", `translate3d(${point.x - 2}px, ${point.y - 2}px, 0)`); property(dot.style, "opacity", String((index + 1) / 30)); }
      });
    }
    const anchor = list.find(p => p.handId === control?.anchorHandId), manipulator = list.find(p => p.handId === control?.manipulatorHandId);
    const linked = control?.phase === "DUAL_TRANSFORM" && anchor?.visible && manipulator?.visible;
    property(spatialConnection.style, "display", linked ? "" : "none");
    if (linked) for (const [key, n] of Object.entries({ x1: anchor.rendered.x, y1: anchor.rendered.y, x2: manipulator.rendered.x, y2: manipulator.rendered.y })) attribute(spatialConnection, key, n);
  }
  function activateTarget(target, position, scope = document, { padding = 0 } = {}) {
    if (!targetAtPoint(target, position, scope, padding)) return false;
    if (target.hasAttribute("data-requires-native")) {
      notify("Use a mouse click or keyboard activation for this control."); return false;
    }
    target.classList.remove("gesture-selected");
    target.classList.add("gesture-selected");
    window.setTimeout(() => target.classList.remove("gesture-selected"), 240);
    // HTMLElement exposes .click(), SVGElement does not in every Chromium path.
    // Spatial SVG objects are normally routed through the surface controller, but
    // this defensive dispatch prevents a malformed/transient UI capture from
    // crashing the entire Spatial mode.
    if (typeof target.click === "function") target.click();
    else {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
      target.dispatchEvent(event);
    }
    return true;
  }
  function isScrollTarget(target, scope = pointerScope()) {
    if (!target?.isConnected || target === document.body || target === document.documentElement ||
        !target.hasAttribute("data-gesture-scroll") || target.scrollHeight <= target.clientHeight + 2) return false;
    if (!scope.contains(target) || target.closest("[hidden], dialog:not([open])")) return false;
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight &&
      /auto|scroll/.test(getComputedStyle(target).overflowY);
  }
  function nearestScroll(node, scope = pointerScope()) {
    for (let current = node; current && current !== document.body; current = current.parentElement) {
      if (isScrollTarget(current, scope)) return current;
    }
    return null;
  }
  function scrollRailTarget(point) {
    if (!point) return null;
    const rail = document.elementFromPoint(point.x, point.y)?.closest("[data-scroll-rail]");
    if (!rail || !pointerScope().contains(rail) || rail.closest("[hidden], dialog:not([open])")) return null;
    const target = byId(rail.dataset.scrollRail);
    return isScrollTarget(target) ? target : null;
  }
  function resolveScrollTarget(mode, point, acquiredTarget = null) {
    if (mode === "presentation" || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    // The aimed panel alone may acquire capture. Focus on an old panel is not
    // authority to pull a hand back into it. There is no document fallback.
    return scrollRailTarget(point) || nearestScroll(acquiredTarget) || nearestScroll(document.elementFromPoint(point.x, point.y));
  }
  function scrollLabel(target) { return target?.getAttribute("aria-label") || target?.id || null; }
  function applyScroll(target, delta) {
    if (!isScrollTarget(target) || !Number.isFinite(delta)) return 0;
    const previous = target.scrollTop;
    target.scrollTop = clamp(previous + delta, 0, target.scrollHeight - target.clientHeight);
    return target.scrollTop - previous;
  }
  function scrollPage(direction, mode = "pointer", point = null) {
    if (mode === "presentation") return 0;
    const target = resolveScrollTarget(mode, point) || nearestScroll(document.activeElement) ||
      (pointerScope() !== document ? byId("settings-scroll-area") : byId(mode === "home" ? "home-content" : "mode-" + mode));
    return isScrollTarget(target) ? applyScroll(target, direction * target.clientHeight * 0.6) : 0;
  }
  function isModalOpen() { return welcomeDialog.open || elements.drawer.open || checkDialog.open; }
  function openWelcome() {
    if (welcomeDialog.open || elements.drawer.open || checkDialog.open) return false;
    if (typeof welcomeDialog.showModal !== "function") {
      notify("Quick Demo requires a current Chrome or Edge browser.", "warning");
      return false;
    }
    welcomeDialog.showModal();
    document.body.classList.add("drawer-open");
    return true;
  }
  function closeWelcome() { if (welcomeDialog.open) welcomeDialog.close(); }
  welcomeDialog.addEventListener("cancel", (event) => event.preventDefault());
  welcomeDialog.addEventListener("close", () => {
    document.body.classList.remove("drawer-open");
    events.dispatchEvent(new Event("welcomeClosed"));
  });
  function openSystemCheck(opener, state) {
    if (typeof checkDialog.showModal !== "function") { notify("System Check requires a current Chrome or Edge browser.", "warning"); return; }
    checkOpener = opener || document.activeElement;
    renderSystemCheck(state); checkDialog.showModal();
  }
  function closeSystemCheck() { if (checkDialog.open) checkDialog.close(); }
  checkDialog.addEventListener("close", () => {
    if (checkOpener?.isConnected) checkOpener.focus({ preventScroll: true });
    events.dispatchEvent(new Event("systemCheckClosed"));
  });
  function disposeAudio() {
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  }
  function audioStatus() {
    if (audioError) return "UNAVAILABLE";
    return audioContext ? audioContext.state.toUpperCase() : "NOT INITIALIZED";
  }
  function unlockAudio(enabled) {
    if (!enabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) { audioError = true; return; }
      if (!audioContext) audioContext = new Audio();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => { audioError = true; });
    } catch { audioError = true; }
  }
  function tone(enabled, warning = false) {
    if (!enabled || audioContext?.state !== "running") return;
    const now = audioContext.currentTime;
    if (now - lastToneAt < 0.10) return;
    lastToneAt = now;
    try {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = "sine"; oscillator.frequency.value = warning ? 240 : 680;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.025, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now); oscillator.stop(now + 0.075);
    } catch { audioError = true; }
  }
  function renderSystemCheck(state) {
    renderProfile(state);
    setText("check-camera", state.camera.active ? (state.readiness.cameraReady ? "ON · " + (state.camera.width || "--") + " × " + (state.camera.height || "--") : "STARTING") : "OFF");
    setText("check-model", state.readiness.modelReady ? "LOADED · " + state.runtime.delegate : "NOT LOADED");
    setText("check-engine", state.runtime.gestureError ? "ERROR" : state.readiness.gestureEngineReady ? (state.runtime.gesturesEnabled ? "INITIALIZED" : "DISABLED") : "NOT INITIALIZED");
    setText("check-audio", (state.settings.soundEnabled ? "ON · " : "MUTED · ") + audioStatus());
    setText("check-performance", Number.isFinite(state.performance.fps) ? number(state.performance.fps) + " FPS · " + number(state.performance.inferenceLatencyMs) + " ms inference" : "NOT MEASURED");
    setText("check-profile", String(state.settings.performancePreset || "custom").toUpperCase());
    setText("check-holo-quality", String(state.settings.holoQuality || "auto").toUpperCase());
    let overall = "READY TO START", recommendation = "Start the camera to measure tracking performance.";
    if (state.runtime.error || state.runtime.gestureError) {
      overall = "ATTENTION"; recommendation = state.runtime.error || state.runtime.gestureError;
    } else if (state.camera.active && state.readiness.trackerReady) {
      if (Number.isFinite(state.performance.fps) && state.performance.fps < 12) {
        overall = "LIMITED"; recommendation = "Tracking is usable but frame delivery is low. Use even front/side lighting or the Performance profile.";
      } else if (Number.isFinite(state.performance.fps) && state.performance.fps < 20) {
        overall = "GOOD"; recommendation = "Tracking is active. Balanced or Performance profile can add headroom on this device.";
      } else {
        overall = "READY"; recommendation = "Core camera, model and gesture systems are ready.";
      }
    } else if (state.camera.active) {
      overall = "STARTING"; recommendation = state.runtime.startupDetail || "Waiting for tracking readiness.";
    }
    setText("check-overall", overall);
    setText("check-recommendation", recommendation);
    byId("check-overall").dataset.state = overall;
  }
  const soundLabels = [...document.querySelectorAll("[data-sound-label]")];
  function renderFeedback(state) {
    for (const button of soundLabels) {
      text(button, state.settings.soundEnabled ? "Mute sound" : "Unmute sound");
      attribute(button.closest("button") || button, "aria-pressed", !state.settings.soundEnabled);
    }
    setText("audio-status", audioStatus());
    if (checkDialog.open) renderSystemCheck(state);
  }

  function finishInitialization() {
    elements.error.hidden = true;
    window.setTimeout(() => { elements.boot.hidden = true; }, 1200);
  }
  return {
    video: elements.video,
    element: byId, setText, mapPoint, smoothPoint, viewportBounds, clampPoint, hitTarget, setHover,
    pointerScope, targetLabel, targetBounds, boundsUnchanged, createStableHover, targetAtPoint,
    resolveScrollTarget, scrollRailTarget, isScrollTarget, scrollLabel, applyScroll,
    renderCursor, renderHandPointers, setHandHovers, pointInside, isCriticalTarget, activateTarget, scrollPage, isModalOpen,
    openWelcome, closeWelcome, openSystemCheck, closeSystemCheck,
    unlockAudio, tone, renderFeedback, disposeAudio,
    renderMode, renderShell, renderTelemetry, renderLog,
    renderSettingsDefaults, renderFullscreen, drawHands, clearHands,
    openSettings, closeSettings, isSettingsOpen: () => elements.drawer.open,
    notify, announce, finishInitialization
  };
}
