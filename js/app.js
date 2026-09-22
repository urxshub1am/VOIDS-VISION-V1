import { SIGNAL_TUNING } from "./interactionSignals.js";
import { createUI } from "./ui.js";
import { createPerformanceMonitor } from "./performanceMonitor.js";
import { CameraController, checkCameraSupport } from "./camera.js";
import { HandTracker, MAX_HANDS } from "./handTracker.js";
import { GestureEngine, GESTURE_DEFAULTS, emptyGesture, emptySpatial } from "./gestureEngine.js";

import { createPointerMode } from "./pointerMode.js";
import { createAirDrawMode } from "./airDrawMode.js";
import { createPresentationMode } from "./presentationMode.js";
import { createGestureLab } from "./gestureLab.js";
import { createGameMode } from "./gameMode.js";
import { PRECISION_DEFAULTS, validatePrecisionPreferences } from "./precision.js";
import { SYSTEM_DEFAULTS, SYSTEM_STORAGE_KEY, validateSystemPreferences, performancePresetPatch, inferPerformancePreset } from "./systemPreferences.js";
import { createInteractionEngine, validInteractionHand } from "./interactionEngine.js";
import { createSpatialMode } from "./spatialMode.js";
import { createLearnMode, onboardingCompleted, markOnboardingCompleted } from "./learnMode.js";

const PRECISION_STORAGE_KEY = "voids-vision.settings.precision.v1";

const MODES = {
  home: {
    label: "HOME", title: "Home / HUD",
    description: "Your touchless interaction workspace.",
    hints: ["INDEX ONLY · Pointer", "PINCH · Select", "PINCH + DRAG · Panel scroll", "FIST · Pause"]
  },
  learn: {
    label: "DEMO / LEARN", title: "Demo / Learn",
    description: "Learn the controls with live gesture feedback.",
    hints: ["LIVE DEMO · Follow steps", "PRACTICE · Real detections", "GUIDE · Quick reference"]
  },
  pointer: {
    label: "POINTER", title: "Pointer control",
    description: "Control the VOIDS VISION interface with your hand.",
    hints: ["INDEX ONLY · Move", "PINCH · Click", "PINCH + DRAG · Panel scroll", "FIST · Freeze"]
  },
  "air-draw": {
    label: "AIR DRAW", title: "Air Draw",
    description: "A space for drawing through hand movement.",
    hints: ["INDEX · Position", "PINCH HOLD · Draw", "TWO FINGERS · Tools"]
  },
  presentation: {
    label: "PRESENTATION", title: "Presentation",
    description: "Present with gesture navigation and a laser pointer.",
    hints: ["PALM SWIPE · Previous / next", "THUMBS UP · Start", "FIST · Pause"]
  },
  "gesture-lab": {
    label: "GESTURE LAB", title: "Gesture Lab",
    description: "Inspect the signals behind every interaction.",
    hints: ["HOLD GESTURE · Inspect", "PINCH · Distance", "OPEN PALM · Motion"]
  },
  spatial: {
    label: "SPATIAL / HOLO", title: "Spatial / Holo",
    description: "Create and arrange shapes in your camera workspace.",
    hints: ["INDEX ONLY · Aim", "FIRST GRAB · Anchor", "OTHER HAND ANYWHERE · Pinch transform", "PINCH + DRAG · Panel scroll"]
  },
  challenge: {
    label: "CHALLENGE", title: "Challenge",
    description: "Practice gesture recognition, timing, and consistency.",
    hints: ["MATCH PROMPT · Respond", "HOLD STEADY · Confirm", "FIST · Prompt gesture"]
  }
};

const HAND_TRACKING = Object.freeze({
  // Base timing targets. Low-FPS cameras use the adaptive helpers below so two
  // genuine samples can reacquire a hand without making 30 FPS tracking loose.
  confirmMs: 170,
  lowFpsConfirmMs: 110,
  lostMs: 430,
  lowFpsLostMs: 620,
  retainMs: 1250,
  lowFpsRetainMs: 1650,
  maxMatchDistance: 0.29,
  newHandCost: 0.50,
  handednessPenalty: 0.24,
  sizePenalty: 0.10,
  ambiguityMargin: 0.018
});

function trackingFps() {
  if (Number.isFinite(state.performance.fps)) return state.performance.fps;
  const interval = state.performance?.profile?.inferenceIntervalMs;
  return Number.isFinite(interval) && interval > 0 ? 1000 / interval : null;
}
function adaptiveConfirmMs() {
  const fps = trackingFps();
  if (fps !== null && fps < 12) return HAND_TRACKING.lowFpsConfirmMs;
  if (fps !== null && fps < 18) return 140;
  return HAND_TRACKING.confirmMs;
}
function adaptiveLostMs() {
  const fps = trackingFps();
  if (fps !== null && fps < 12) return HAND_TRACKING.lowFpsLostMs;
  if (fps !== null && fps < 18) return 520;
  return HAND_TRACKING.lostMs;
}
function adaptiveRetainMs() {
  const fps = trackingFps();
  if (fps !== null && fps < 12) return HAND_TRACKING.lowFpsRetainMs;
  if (fps !== null && fps < 18) return 1450;
  return HAND_TRACKING.retainMs;
}

const state = {
  currentMode: "home",
  readiness: {
    browserReady: false, modelReady: false, cameraReady: false,
    trackerReady: false, uiReady: false, gestureEngineReady: false
  },
  camera: { active: false, width: null, height: null },
  trackingState: "NOT_INITIALIZED",
  hands: [],
  handInput: {
    detected: null, count: null,
    primaryHandId: null, secondaryHandId: null, activeHandId: null
  },
  spatial: emptySpatial(),
  pointer: { x: null, y: null, paused: false, hoverTarget: null },
  performance: {
    fps: null, inferenceLatencyMs: null, gestureLatencyMs: null,
    mode: "NOT_INITIALIZED", effectsReduced: false, renderFps: null, hudHz: null
  },
  settings: {
    ...PRECISION_DEFAULTS, ...SYSTEM_DEFAULTS,
    sensitivity: "medium", smoothing: 0.7, holdTimeMs: 350,
    clickCooldownMs: 450,
    advanced: { pinchThreshold: GESTURE_DEFAULTS.pinchEnter, swipeDistance: 0.2 }
  },
  runtime: {
    paused: false, gesturesEnabled: true, settingsOpen: false,
    fullscreen: false, fullscreenPending: false, hudVisible: false,
    currentAction: "Interface not initialized",
    busy: false, session: 0, browserChecked: false, backgrounded: false,
    startupStage: "BOOTING", startupDetail: "Preparing the interface.",
    error: null, gestureError: null, delegate: null, nextHandId: 1,
    tracking: { everTracked: false, lastSeenAt: null, candidateSince: null },
    eventLog: [], gestureHistory: [], movementHistory: [], modeData: {},
    handUI: false, pendingLaunch: null, launchReleaseHandId: null, preferenceStatus: "Defaults loaded",
    precision: { pointer: null, draw: null, preview: null }, scroll: null, handPointers: {}, interaction: null,
    systemPreferenceStatus: "System defaults loaded", calibrationStatus: "SAFE DEFAULT"
  }
};

// Only position association is calculated here. No gesture geometry is classified.
function palmCenter(landmarks) {
  const indices = [0, 5, 9, 13, 17];
  const center = { x: 0, y: 0 };
  for (const index of indices) {
    center.x += landmarks[index].x / indices.length;
    center.y += landmarks[index].y / indices.length;
  }
  return center;
}

// A small shape signature helps keep H1/H2 identity stable when palms cross.
// It is intentionally weak: perspective changes hand size, so position,
// velocity and MediaPipe handedness still dominate association.
function palmAssociationScale(landmarks, aspect = 1) {
  const wrist = landmarks?.[0], middle = landmarks?.[9], index = landmarks?.[5], pinky = landmarks?.[17];
  if (![wrist, middle, index, pinky].every(Boolean)) return null;
  const distance = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
  const length = distance(wrist, middle), width = distance(index, pinky);
  const scale = 0.62 * length + 0.38 * width;
  return Number.isFinite(scale) && scale > 1e-4 ? scale : null;
}

function associateHands(detections, previous, aspect, now) {
  if (!detections.length) return { mapping: [], ambiguous: [] };

  function matchCost(detection, hand) {
    const dt = Math.max(0, Math.min(0.35, (now - (hand.tracking?.lastSeenAt ?? now)) / 1000));
    const v = hand.tracking?.associationVelocity || { x: 0, y: 0 };
    const velocityWeight = dt <= 0.22 ? 1 : Math.max(0, 1 - (dt - 0.22) / 0.13);
    const predicted = {
      x: hand.palmCenter.x + v.x * dt * velocityWeight,
      y: hand.palmCenter.y + v.y * dt * velocityWeight
    };
    const distance = Math.hypot(
      detection.palmCenter.x - predicted.x,
      (detection.palmCenter.y - predicted.y) * aspect
    );
    // At low camera FPS a legitimate fast movement can travel >25% of the
    // normalized frame between samples. Predict from recent palm velocity and
    // allow a bounded gap-dependent margin so H1/H2 identity does not reset.
    const dynamicLimit = HAND_TRACKING.maxMatchDistance + Math.min(0.12, dt * 0.65);
    if (distance > dynamicLimit) return Infinity;
    const different = detection.handedness && hand.handedness &&
      detection.handedness !== hand.handedness;
    const weight = Math.min(
      detection.handednessScore ?? 0, hand.handednessScore ?? 0
    );
    const previousScale = hand.associationScale;
    const scaleCost = Number.isFinite(detection.associationScale) && Number.isFinite(previousScale) &&
      detection.associationScale > 0 && previousScale > 0
      ? Math.min(0.35, Math.abs(Math.log(detection.associationScale / previousScale))) * HAND_TRACKING.sizePenalty
      : 0;
    return distance + scaleCost + (different ? HAND_TRACKING.handednessPenalty * weight : 0);
  }

  // With at most two detections, enumerate the few one-to-one assignments.
  // -1 means a new hand; an existing record cannot match both detections.
  const slots = [-1, ...previous.map((hand, index) => index)];
  const options = [];
  for (const first of slots) {
    for (const second of detections.length === 2 ? slots : [-1]) {
      if (first !== -1 && first === second) continue;
      const mapping = detections.length === 2 ? [first, second] : [first];
      const cost = mapping.reduce((total, index, detectionIndex) =>
        total + (index === -1 ? HAND_TRACKING.newHandCost
          : matchCost(detections[detectionIndex], previous[index])), 0);
      if (Number.isFinite(cost)) options.push({ mapping, cost });
    }
  }
  options.sort((a, b) => a.cost - b.cost);
  const best = options[0];
  const ambiguous = best.mapping.map((index, detectionIndex) =>
    options.some((option) =>
      option.cost - best.cost <= HAND_TRACKING.ambiguityMargin &&
      option.mapping[detectionIndex] !== index
    )
  );

  return {
    // Preserve the best one-to-one identity even when two assignments are very
    // close. `ambiguous` pauses gestures/actions until the picture is clear;
    // inventing a new H-ID here used to reset pinch state and break transforms.
    mapping: best.mapping,
    ambiguous
  };
}

function initialize() {
  const events = new EventTarget();
  const ui = createUI(events);
  const tracker = new HandTracker();
  const profile = createPerformanceMonitor(state.performance);
  const gestureEngine = new GestureEngine({
    holdMs: state.settings.holdTimeMs,
    pinchEnter: state.settings.advanced.pinchThreshold,
    swipeDistance: state.settings.advanced.swipeDistance
  });
  state.readiness.gestureEngineReady = gestureEngine.ready;
  let startupController = null;
  const loop = {
    id: 0, sourceId: null, sourceKind: "RAF", token: 0,
    lastVideoTime: -1, lastSourceTime: -1, lastProcessAt: -Infinity,
    lastFreshAt: 0, windowStart: 0, frames: 0, lastHUD: 0, stalled: false, inFlight: false,
    lastSourceAt: null, sourceIntervalMs: null, lastInferenceAt: null, inferenceIntervalMs: null
  };

  const camera = new CameraController(ui.video, {
    onEnded: (error) => failPipeline(error.message),
    onActivity: (active) => {
      state.camera.active = active;
      ui.renderShell(state);
    }
  });

  function logEvent(category, message) {
    const at = Date.now();
    const entries = state.runtime.eventLog;
    const previous = entries[entries.length - 1];
    if (previous && previous.category === category &&
        previous.message === message && at - previous.at < 1500) return;
    entries.push({ at, category, message });
    if (entries.length > 25) entries.shift();
    const started = performance.now();
    ui.renderLog(entries);
    profile.record("log", performance.now() - started);
  }

  // System preferences are separate from precision tuning so gesture thresholds remain stable.
  function loadSystemPreferences() {
    try {
      const saved = localStorage.getItem(SYSTEM_STORAGE_KEY);
      if (!saved) return;
      const value = JSON.parse(saved);
      if (!value || value.version !== 1) throw new Error("Unknown system preference format");
      Object.assign(state.settings, validateSystemPreferences(value));
      state.runtime.systemPreferenceStatus = "System preferences restored";
    } catch {
      Object.assign(state.settings, SYSTEM_DEFAULTS);
      state.runtime.systemPreferenceStatus = "System defaults restored; saved settings were invalid";
      logEvent("WARNING", "SYSTEM PREFERENCES · USING DEFAULTS");
    }
  }
  function persistSystemPreferences() {
    const validated = validateSystemPreferences(state.settings);
    Object.assign(state.settings, validated);
    try {
      localStorage.setItem(SYSTEM_STORAGE_KEY, JSON.stringify({ version: 1, ...validated }));
      state.runtime.systemPreferenceStatus = "System preferences saved on this device";
      return true;
    } catch {
      state.runtime.systemPreferenceStatus = "Applied for this session; browser storage unavailable";
      ui.notify(state.runtime.systemPreferenceStatus, "warning");
      return false;
    }
  }
  function setSystemPreference(name, value, { keepPreset = false } = {}) {
    if (!Object.hasOwn(SYSTEM_DEFAULTS, name)) return false;
    const previousResolution = state.settings.cameraResolution;
    const next = validateSystemPreferences({ ...state.settings, [name]: value });
    Object.assign(state.settings, next);
    if (!keepPreset && name !== "performancePreset" && name !== "firstRunDismissed") {
      state.settings.performancePreset = inferPerformancePreset(state.settings);
    }
    persistSystemPreferences();
    ui.renderSettingsDefaults(state.settings);
    if (name === "cameraResolution" && state.camera.active && previousResolution !== state.settings.cameraResolution) {
      ui.notify("Camera resolution will apply after you stop and restart the camera.");
    }
    logEvent("ACTION", "SYSTEM SETTING → " + name + " · " + state.settings[name]);
    render();
    return true;
  }
  function applyPerformancePreset(name) {
    const patch = performancePresetPatch(name);
    Object.assign(state.settings, validateSystemPreferences({ ...state.settings, ...patch }));
    persistSystemPreferences();
    ui.renderSettingsDefaults(state.settings);
    ui.notify(name.toUpperCase() + " preset applied" + (state.camera.active ? ". Camera resolution applies on next camera start." : "."));
    logEvent("ACTION", "PERFORMANCE PRESET → " + name.toUpperCase());
    render();
  }
  loadSystemPreferences();

  // Every hand is logged. Only the active mode receives eligible action events.
  function loadPrecisionPreferences() {
    try {
      const saved = localStorage.getItem(PRECISION_STORAGE_KEY);
      if (!saved) return;
      const value = JSON.parse(saved);
      if (!value || value.version !== 1) throw new Error("Unknown preference format");
      Object.assign(state.settings, validatePrecisionPreferences(value));
      state.runtime.preferenceStatus = "Precision preferences restored";
    } catch {
      Object.assign(state.settings, PRECISION_DEFAULTS);
      state.runtime.preferenceStatus = "Precision defaults in use; saved preferences unavailable";
      logEvent("WARNING", "PRECISION PREFERENCES · USING DEFAULTS");
    }
  }
  loadPrecisionPreferences();
  const modeClock = { id: 0, lastRender: 0, lastFrame: 0, handId: null, epoch: 0 };
  let modes = {}, interaction = null;
  const quality = { lowSince: null, healthySince: null };
  const modeContext = {
    state, ui, video: ui.video,
    recordPerformance: profile.record,
    interactionEvent: message => logEvent("ACTION", message),
    action: (message) => { logEvent("ACTION", message); ui.tone(state.settings.soundEnabled); },
    notify: (message, tone) => ui.notify(message, tone),
    pause: setPaused,
    activate: (target, position, scope, options = {}) => {
      const previousSource = state.runtime.activationSource || null;
      state.runtime.activationSource = options.handId ? `HAND:${options.handId}` : "GESTURE";
      try { return ui.activateTarget(target, position, scope, options); }
      finally { state.runtime.activationSource = previousSource; }
    },
    openTools: () => setHandUI(true),
    resetInput: () => { cancelModeInput(); resetGestures(); },
    confirm: (message) => {
      cancelModeInput(); resetGestures();
      return window.confirm(message);
    },
    manualAllowed: () => !state.runtime.paused && !state.runtime.handUI && !document.hidden && !ui.isModalOpen(),
    primaryAvailable: () => Boolean(actionHand(performance.now()))
  };
  interaction = createInteractionEngine(modeContext);
  modeContext.interaction = interaction;
  modes.pointer = createPointerMode(modeContext);
  modes.home = modes.pointer;
  modes.learn = createLearnMode(modeContext);
  modes["air-draw"] = createAirDrawMode(modeContext);
  modes.presentation = createPresentationMode(modeContext);
  modes["gesture-lab"] = createGestureLab(modeContext);
  modes.challenge = createGameMode(modeContext);
  modes.spatial = createSpatialMode(modeContext);
  interaction.setModes(modes);

  function callMode(method, ...args) {
    return callController(modes[state.currentMode], method, ...args);
  }
  function callController(controller, method, ...args) {
    try { return controller?.[method]?.(...args); }
    catch (error) {
      const failed = state.currentMode;
      console.error(`[VOIDS VISION] Mode controller error · ${failed}.${method}`, error);
      // Spatial owns a defensive 3D fallback. If a transient render/update fault can be
      // recovered locally, keep the user's workspace open instead of ejecting to Home.
      try {
        if (failed === "spatial" && modes.spatial?.recover?.(error, method) === true) {
          logEvent("WARNING", `SPATIAL RECOVERED · ${method} · ${error?.message || "runtime fault"}`);
          ui.notify("Spatial recovered from a render fault. Your workspace is still open.", "warning");
          return undefined;
        }
      } catch (recoveryError) {
        console.error("[VOIDS VISION] Spatial recovery failed", recoveryError);
      }
      // A mode failure must never dispose a healthy camera/model.
      try { modes[failed]?.cancel?.(); } catch { /* Continue recovery. */ }
      try { interaction?.cancel(); } catch { /* Continue recovery. */ }
      ui.setHover(null); ui.renderCursor(null);
      state.currentMode = "home";
      state.runtime.handUI = false;
      gestureEngine.configure({ holdMs: state.settings.holdTimeMs, pinchHoldMs: GESTURE_DEFAULTS.pinchHoldMs });
      modeClock.epoch += 1;
      resetGestures();
      ui.renderMode("home", MODES.home, true);
      logEvent("ERROR", MODES[failed].label + " · " + (error.message || "Mode failed"));
      ui.notify("Returned Home after a mode error. Camera tracking remains available.", "warning");
      return undefined;
    }
  }

  function cancelModeInput() {
    modeClock.epoch += 1;
    modeClock.handId = null;
    state.runtime.precision.preview = null;
    state.runtime.pendingLaunch = null;
    state.runtime.launchReleaseHandId = null;
    interaction?.cancel();
    callMode("cancel");
    ui.setHover(null); ui.renderCursor(null);
  }

  function actionHand(now) {
    if (!state.runtime.gesturesEnabled || state.runtime.paused ||
        state.runtime.backgrounded || document.hidden ||
        state.runtime.error || state.runtime.gestureError || !state.readiness.trackerReady) return null;
    return state.hands.find((hand) => validInteractionHand(hand, now)) || null;
  }

  function runModeFrame(gestureEvents, now, reduced) {
    updatePrimaryHand(); // HUD association only; never transfers an active capture.
    const launch = state.runtime.pendingLaunch;
    if (launch) {
      const hand = state.hands.find(h => h.id === launch.handId && validInteractionHand(h, now));
      if (state.currentMode !== launch.mode || now > launch.expiresAt) state.runtime.pendingLaunch = null;
      else if (hand && !hand.pinch.raw && hand.gesture.confirmed === "INDEX_ONLY") {
        state.runtime.pendingLaunch = null; callMode("onAction", "start");
        if (state.runtime.modeData.challenge.running) state.runtime.launchReleaseHandId = hand.id;
        return;
      }
    }
    const releaseId = state.runtime.launchReleaseHandId;
    const releaseHand = state.hands.find(h => h.id === releaseId);
    if (releaseId && (!releaseHand || releaseHand.gesture.raw !== "INDEX_ONLY")) state.runtime.launchReleaseHandId = null;
    callController(interaction, "update", state.hands,
      gestureEvents.filter(e => !(e.handId === releaseId && e.gesture === "INDEX_ONLY")), now, reduced);
    modeClock.lastFrame = now;
  }

  function startModeClock() {
    cancelAnimationFrame(modeClock.id);
    modeClock.id = 0;
    if ((state.currentMode === "home" && !camera.running && !ui.isModalOpen()) || document.hidden) return;
    function tick() {
      const now = performance.now();
      modeClock.id = 0;
      if (document.hidden || (state.currentMode === "home" && !camera.running && !ui.isModalOpen())) return;
      const reduced = state.settings.visualEffects === "reduced" ||
        (state.settings.autoPerformanceMode && state.performance.effectsReduced);
      const cursorAt = performance.now();
      callController(interaction, "tick", now, reduced);
      profile.record("cursor", performance.now() - cursorAt);
      const modeAt = performance.now();
      callMode("tick", now);
      profile.record("modeRender", performance.now() - modeAt);
      if (!camera.running && now - modeClock.lastRender >= 100) {
        render(); modeClock.lastRender = now;
      }
      modeClock.id = requestAnimationFrame(tick);
    }
    modeClock.id = requestAnimationFrame(tick);
  }

  events.addEventListener("gestureConfirmed", (event) => {
    const detail = event.detail;
    const role = detail.handId === state.handInput.primaryHandId ? "PRIMARY" : "SECONDARY";
    logEvent("GESTURE", detail.handId + " " + role + " · " + detail.gesture + " CONFIRMED");
    state.runtime.gestureHistory.push({ ...detail, role });
    if (state.runtime.gestureHistory.length > 25) state.runtime.gestureHistory.shift();
  });

  function resetGestures() {
    gestureEngine.reset();
    state.hands.forEach((hand) => gestureEngine.clearHand(hand));
    state.spatial = emptySpatial();
    state.performance.gestureLatencyMs = null;
  }

  function updateGestureData(now) {
    if (state.runtime.gestureError) return [];
    if (!state.runtime.gesturesEnabled) {
      resetGestures();
      return [];
    }
    try {
      const started = performance.now();
      const result = gestureEngine.update(state.hands, {
        timestamp: now, width: state.camera.width, height: state.camera.height,
        mirrored: state.settings.cameraMirror,
        primaryHandId: state.handInput.primaryHandId,
        secondaryHandId: state.handInput.secondaryHandId,
        enabled: state.runtime.gesturesEnabled && !state.runtime.paused
      });
      state.performance.gestureLatencyMs = performance.now() - started;
      state.spatial = result.spatial;
      for (const detail of result.events) {
        if (detail.type === "gestureConfirmed") {
          events.dispatchEvent(new CustomEvent("gestureConfirmed", { detail }));
        } else if (detail.type === "gestureCandidate") {
          logEvent("GESTURE", detail.handId + " · CANDIDATE " + detail.gesture);
        } else {
          logEvent(detail.type === "trackingLost" ? "WARNING" : "SYSTEM",
            detail.handId + " · " + (detail.type === "trackingLost" ? "TRACKING LOST" : "TRACKING RESTORED"));
        }
      }
      return result.events;
    } catch (error) {
      // A gesture failure must not shut down the working camera/tracker.
      resetGestures();
      state.readiness.gestureEngineReady = false;
      state.runtime.gesturesEnabled = false;
      state.runtime.gestureError = error.message || "Gesture diagnostics failed.";
      logEvent("ERROR", "GESTURE ENGINE · " + state.runtime.gestureError);
      ui.notify("Gesture diagnostics stopped. Use Retry gesture engine; camera tracking continues.", "warning");
      changeMode("home");
      return [];
    }
  }

  function toggleGestures() {
    cancelModeInput();
    resetGestures();
    if (state.runtime.gestureError) {
      state.runtime.gestureError = null;
      state.readiness.gestureEngineReady = gestureEngine.ready;
      state.runtime.gesturesEnabled = true;
    } else state.runtime.gesturesEnabled = !state.runtime.gesturesEnabled;
    render();
    logEvent("SYSTEM", state.runtime.gesturesEnabled ? "GESTURE INPUT ENABLED" : "GESTURE INPUT DISABLED");
  }

  function updateAction() {
    state.runtime.currentAction = state.runtime.paused
      ? (state.currentMode === "pointer" ? "POINTER PAUSED" : "PAUSED")
      : state.runtime.busy ? state.runtime.startupStage
      : state.runtime.backgrounded ? "Tracking suspended"
      : state.runtime.pendingLaunch ? "Release pinch, then hold INDEX ONLY to start Challenge"
      : (ui.isModalOpen() || state.runtime.handUI || state.currentMode === "home" ? state.runtime.modeData.pointer?.status : state.runtime.modeData[state.currentMode]?.status) ||
        (state.readiness.cameraReady ? "Observing · HOME" : "Viewing HOME");
  }

  function updatePrimaryHand() {
    const input = state.handInput;
    const previousId = input.primaryHandId;
    let primary = state.hands.find((hand) => hand.id === previousId);
    if (!primary) {
      primary = state.hands.find((hand) =>
        hand.tracking.visible && hand.tracking.state === "TRACKING" &&
        !hand.tracking.ambiguous
      );
    }
    input.primaryHandId = primary?.id ?? null;
    input.secondaryHandId = primary ? state.hands.find((hand) =>
      hand.id !== primary.id && hand.tracking.visible)?.id ?? null : null;
    const usable = primary?.tracking.visible &&
      primary.tracking.state === "TRACKING" && !primary.tracking.ambiguous &&
      state.camera.active && state.readiness.trackerReady &&
      !state.runtime.paused && !state.runtime.backgrounded && !state.runtime.error;
    input.activeHandId = usable ? primary.id : null;
    if (previousId !== input.primaryHandId) {
      state.pointer.hoverTarget = null;
      if (primary) logEvent("SYSTEM", "PRIMARY HAND → " + primary.id);
    }
    if (!input.activeHandId) state.pointer.hoverTarget = null;
  }

  function render() {
    const started = performance.now();
    profile.refresh(started, state);
    updatePrimaryHand();
    callMode("render");
    updateAction();
    ui.renderShell(state);
    ui.renderTelemetry(state);
    ui.renderFeedback(state);
    ui.setText("precision-storage-status", state.runtime.preferenceStatus);
    ui.setText("system-storage-status", state.runtime.systemPreferenceStatus);
    ui.setText("calibration-status", state.runtime.calibrationStatus);
    profile.record("hud", performance.now() - started);
  }

  function setStage(stage, detail) {
    state.runtime.startupStage = stage;
    state.runtime.startupDetail = detail;
    render();
    logEvent("SYSTEM", stage);
  }

  function checkBrowser() {
    state.runtime.browserChecked = true;
    state.readiness.browserReady = false;
    checkCameraSupport();
    if (typeof WebAssembly === "undefined" ||
        typeof requestAnimationFrame !== "function") {
      throw new Error("This browser lacks required WebAssembly or animation support. Use current Chrome or Edge.");
    }
    state.readiness.browserReady = true;
  }

  function changeMode(mode, source = "SYSTEM") {
    if (!Object.hasOwn(MODES, mode) || mode === state.currentMode) return;
    cancelModeInput();
    callMode("exit");
    state.runtime.handUI = false;
    state.runtime.precision.preview = null;
    resetGestures();
    gestureEngine.configure({
      holdMs: mode === "challenge" ? 275 : state.settings.holdTimeMs,
      pinchHoldMs: mode === "challenge" ? 275 : GESTURE_DEFAULTS.pinchHoldMs
    });
    state.currentMode = mode;
    events.dispatchEvent(new CustomEvent("modeChanged", { detail: { mode, source } }));
  }

  events.addEventListener("modeChanged", (event) => {
    const mode = event.detail.mode;
    const source = event.detail.source || "SYSTEM";
    ui.renderMode(mode, MODES[mode], true);
    callMode("enter");
    startModeClock();
    render();
    logEvent("ACTION", "MODE CHANGED → " + MODES[mode].label + " · SOURCE " + source);
    ui.announce(MODES[mode].label + " opened.");
  });

  function setPaused(paused) {
    if (state.runtime.paused === paused) return;
    cancelModeInput();
    state.runtime.paused = paused;
    state.pointer.paused = paused;
    resetGestures();
    callMode("pauseChanged", paused);
    render();
    logEvent("ACTION", paused ? "INTERFACE PAUSED" : "INTERFACE RESUMED");
    ui.notify(paused ? "Interaction paused. Camera tracking continues." : "Resumed. Gesture confirmation starts fresh.");
  }

  function clearHandData() {
    cancelModeInput();
    resetGestures();
    state.hands = [];
    Object.assign(state.handInput, {
      detected: null, count: null, primaryHandId: null, secondaryHandId: null, activeHandId: null
    });
    state.pointer.hoverTarget = null;
    ui.clearHands();
  }

  function resetTracking() {
    clearHandData();
    state.trackingState = "NOT_INITIALIZED";
    state.runtime.tracking = { everTracked: false, lastSeenAt: null, candidateSince: null };
    state.performance.fps = null;
    state.performance.inferenceLatencyMs = null;
    state.performance.mode = "NOT_INITIALIZED";
    state.performance.effectsReduced = false;
    state.performance.renderFps = state.performance.hudHz = null;
    quality.lowSince = quality.healthySince = null;
  }

  function setTracking(next) {
    if (state.trackingState === next) return;
    const previous = state.trackingState;
    state.trackingState = next;
    const message = next === "SEARCHING" ? "SEARCHING FOR HAND" : next;
    logEvent(next === "LOST" ? "WARNING" : "SYSTEM", message);
    ui.announce(message);
    if (next === "LOST") ui.notify("Tracking lost · keep the hand visible and use even front/side lighting.", "warning");
    else if (next === "TRACKING" && ["LOST", "REACQUIRING"].includes(previous)) ui.notify("Tracking restored.");
  }

  function updateTracking(present, now) {
    const timing = state.runtime.tracking;
    if (present) {
      timing.lastSeenAt = now;
      if (state.trackingState === "TRACKING") return;
      if (timing.candidateSince === null) timing.candidateSince = now;
      if (timing.everTracked) setTracking("REACQUIRING");
      else setTracking("SEARCHING");
      if (now - timing.candidateSince >= adaptiveConfirmMs()) {
        timing.everTracked = true;
        setTracking("TRACKING");
      }
    } else {
      timing.candidateSince = null;
      if (!timing.everTracked) setTracking("SEARCHING");
      else if (state.trackingState === "REACQUIRING" ||
               now - timing.lastSeenAt >= adaptiveLostMs()) setTracking("LOST");
    }
  }

  function updateHands(sample, now) {
    const previous = state.hands.filter((hand) =>
      now - hand.tracking.lastSeenAt <= adaptiveRetainMs()
    );
    const aspect = state.camera.height / state.camera.width;
    const detections = sample.hands.map((hand) => ({
      ...hand,
      palmCenter: palmCenter(hand.landmarks),
      associationScale: palmAssociationScale(hand.landmarks, aspect)
    }));
    const { mapping, ambiguous } = associateHands(detections, previous, aspect, now);
    const used = new Set(mapping.filter((index) => index !== -1));
    const visibleHands = detections.map((detection, index) => {
      const hand = mapping[index] === -1 ? {
        id: "H" + state.runtime.nextHandId++,
        tracking: {
          state: "SEARCHING", visible: false, ambiguous: false,
          firstSeenAt: now, lastSeenAt: now, continuousSince: null, continuousFrames: 0,
          everTracked: false, framesObserved: 0, associationVelocity: { x: 0, y: 0 }
        },
        gesture: emptyGesture(),
        fingerStates: null, pinchDistance: null, movementDirection: null
      } : previous[mapping[index]];
      const tracking = hand.tracking;
      if (tracking.continuousSince === null || now - tracking.lastSeenAt > Math.max(SIGNAL_TUNING.graceMs, 360)) {
        tracking.continuousSince = now;
        tracking.continuousFrames = 0;
      }
      const previousPalm = hand.palmCenter;
      const previousAssociationScale = hand.associationScale;
      const associationDt = Math.max(0.001, Math.min(0.35, (now - tracking.lastSeenAt) / 1000));
      if (previousPalm && Number.isFinite(previousPalm.x) && Number.isFinite(previousPalm.y)) {
        const ivx = (detection.palmCenter.x - previousPalm.x) / associationDt;
        const ivy = (detection.palmCenter.y - previousPalm.y) / associationDt;
        const speed = Math.hypot(ivx, ivy);
        const cap = speed > 3.2 ? 3.2 / speed : 1;
        const current = tracking.associationVelocity || { x: 0, y: 0 };
        tracking.associationVelocity = {
          x: current.x * 0.45 + ivx * cap * 0.55,
          y: current.y * 0.45 + ivy * cap * 0.55
        };
      } else tracking.associationVelocity = { x: 0, y: 0 };
      Object.assign(hand, detection);
      tracking.visible = true;
      tracking.ambiguous = ambiguous[index];
      tracking.lastSeenAt = now;
      tracking.framesObserved += 1;
      if (Number.isFinite(detection.associationScale)) {
        hand.associationScale = Number.isFinite(previousAssociationScale)
          ? previousAssociationScale * 0.72 + detection.associationScale * 0.28
          : detection.associationScale;
      }
      if (tracking.ambiguous) {
        tracking.continuousSince = null;
        tracking.continuousFrames = 0;
      } else {
        tracking.continuousFrames = (tracking.continuousFrames || 0) + 1;
      }
      const stable = tracking.continuousSince !== null &&
        tracking.continuousFrames >= 2 && now - tracking.continuousSince >= adaptiveConfirmMs();
      tracking.state = stable ? "TRACKING"
        : tracking.everTracked ? "REACQUIRING" : "SEARCHING";
      if (stable) tracking.everTracked = true;
      return hand;
    });

    const missingHands = previous.filter((hand, index) => !used.has(index));
    for (const hand of missingHands) {
      const tracking = hand.tracking;
      tracking.visible = false;
      if (now - tracking.lastSeenAt > SIGNAL_TUNING.graceMs) {
        tracking.continuousSince = null;
        tracking.continuousFrames = 0;
      }
      if (tracking.everTracked &&
          (tracking.state === "REACQUIRING" ||
           now - tracking.lastSeenAt >= adaptiveLostMs())) tracking.state = "LOST";
      hand.landmarks = [];
      hand.worldLandmarks = [];
      hand.sourceIndex = null;
    }
    missingHands.sort((a, b) =>
      Number(b.id === state.handInput.primaryHandId) -
      Number(a.id === state.handInput.primaryHandId) ||
      b.tracking.lastSeenAt - a.tracking.lastSeenAt
    );
    state.hands = [...visibleHands, ...missingHands.slice(0, MAX_HANDS - visibleHands.length)];
    state.hands.sort((a, b) =>
      a.tracking.firstSeenAt - b.tracking.firstSeenAt || a.id.localeCompare(b.id)
    );
    state.handInput.detected = visibleHands.length > 0;
    state.handInput.count = visibleHands.length;
    updateTracking(state.handInput.detected, now);
    updatePrimaryHand();
  }

  function stopLoop() {
    profile.stop();
    loop.token += 1;
    cancelAnimationFrame(loop.id);
    loop.id = 0;
    if (loop.sourceId !== null) {
      if (loop.sourceKind === "VIDEO_FRAME_CALLBACK") ui.video.cancelVideoFrameCallback?.(loop.sourceId);
      else cancelAnimationFrame(loop.sourceId);
    }
    loop.sourceId = null;
  }

  function stopPipeline(message = "Camera stopped. Webcam tracks released.", silent = false) {
    state.runtime.session += 1;
    startupController?.abort(new DOMException("Startup cancelled.", "AbortError"));
    startupController = null;
    stopLoop();
    tracker.cancelInitialization();
    camera.stop();
    state.runtime.busy = false;
    state.runtime.backgrounded = false;
    state.runtime.error = null;
    state.readiness.cameraReady = false;
    state.readiness.trackerReady = false;
    state.readiness.modelReady = tracker.ready;
    state.camera.width = null;
    state.camera.height = null;
    state.runtime.startupStage = "STOPPED";
    state.runtime.startupDetail = message;
    resetTracking();
    render();
    if (!silent) logEvent("SYSTEM", message);
  }

  function failPipeline(message, resetModel = false) {
    const failedStage = state.runtime.startupStage;
    if (resetModel) tracker.dispose();
    stopPipeline(message, true);
    state.runtime.error = message;
    state.runtime.startupStage = "ERROR";
    state.runtime.startupDetail = failedStage + ": " + message;
    render();
    logEvent("ERROR", state.runtime.startupDetail);
    ui.notify(message, "warning");
  }

  function beginLoop() {
    stopLoop();
    startModeClock();
    const token = loop.token;
    const startedAt = performance.now();
    profile.start(ui.video, startedAt);
    Object.assign(loop, {
      lastVideoTime: -1, lastSourceTime: -1, lastProcessAt: -Infinity, lastFreshAt: startedAt,
      windowStart: startedAt, frames: 0, lastHUD: 0, stalled: false, inFlight: false,
      lastSourceAt: null, sourceIntervalMs: null, lastInferenceAt: null, inferenceIntervalMs: null,
      sourceKind: typeof ui.video.requestVideoFrameCallback === "function" ? "VIDEO_FRAME_CALLBACK" : "RAF_FALLBACK",
      sourceId: null
    });
    profile.data.inferenceScheduler = loop.sourceKind;
    profile.data.sourceFrameIntervalMs = null;
    profile.data.inferenceIntervalMs = null;
    state.readiness.trackerReady = false;
    state.performance.fps = null;
    state.performance.inferenceLatencyMs = null;
    state.runtime.tracking.candidateSince = null;
    setTracking(state.runtime.tracking.everTracked ? "LOST" : "SEARCHING");
    render();

    function processFreshFrame(callbackAt, sourceTimeMs = null) {
      if (token !== loop.token || document.hidden || !camera.running || loop.inFlight) return;
      const video = ui.video;
      if (video.readyState < 2 || video.paused || !video.videoWidth || !video.videoHeight) return;

      const sourceTime = Number.isFinite(sourceTimeMs) ? sourceTimeMs : video.currentTime * 1000;
      if (!Number.isFinite(sourceTime) || sourceTime === loop.lastSourceTime) return;
      if (loop.lastSourceAt !== null && sourceTime > loop.lastSourceAt) {
        loop.sourceIntervalMs = sourceTime - loop.lastSourceAt;
        profile.data.sourceFrameIntervalMs = loop.sourceIntervalMs;
      }
      loop.lastSourceAt = sourceTime;
      loop.lastSourceTime = sourceTime;

      // Even a 60 FPS webcam does not need more than ~30 expensive landmark
      // inferences per second. requestVideoFrameCallback still gives us the
      // freshest available frame instead of polling the same frame from RAF.
      const now = performance.now();
      if (now - loop.lastProcessAt < 1000 / 30 - 1) return;
      loop.lastProcessAt = now;
      if (loop.lastInferenceAt !== null) {
        loop.inferenceIntervalMs = now - loop.lastInferenceAt;
        profile.data.inferenceIntervalMs = loop.inferenceIntervalMs;
      }
      loop.lastInferenceAt = now;

      const pipelineAt = performance.now();
      let sample;
      loop.inFlight = true; profile.inferenceStarted();
      try { sample = tracker.detect(video, now); }
      finally { loop.inFlight = false; profile.inferenceEnded(); }
      if (!sample || token !== loop.token) return;

      const freshAt = performance.now();
      loop.lastFreshAt = freshAt;
      loop.stalled = false;
      loop.frames += 1;
      const elapsed = freshAt - loop.windowStart;
      if (elapsed >= 1000) {
        state.performance.fps = loop.frames * 1000 / elapsed;
        loop.frames = 0;
        loop.windowStart = freshAt;
        // Reduce decoration only; never weaken gesture correctness or disable H2.
        if (state.performance.fps < 22) {
          quality.lowSince ??= freshAt; quality.healthySince = null;
          const protectionDelay = state.performance.fps < 10 ? 700 : state.performance.fps < 16 ? 1500 : 3000;
          if (freshAt - quality.lowSince >= protectionDelay) state.performance.effectsReduced = true;
        } else {
          quality.lowSince = null;
          if (state.performance.fps >= 26) {
            quality.healthySince ??= freshAt;
            if (freshAt - quality.healthySince >= 8000) state.performance.effectsReduced = false;
          } else quality.healthySince = null;
        }
      }

      state.performance.inferenceLatencyMs = sample.latencyMs;
      profile.record("inference", sample.latencyMs);
      const reduced = state.settings.visualEffects === "reduced" ||
        (state.settings.autoPerformanceMode && state.performance.effectsReduced);
      state.performance.mode = reduced ? "REDUCED_EFFECTS" : "MEASURING";
      state.camera.width = video.videoWidth;
      state.camera.height = video.videoHeight;
      const associationAt = performance.now();
      updateHands(sample, freshAt);
      profile.record("association", performance.now() - associationAt);
      const gestureAt = performance.now();
      const gestureEvents = updateGestureData(freshAt);
      profile.record("gestures", performance.now() - gestureAt);

      if (!state.readiness.trackerReady) {
        state.readiness.trackerReady = true;
        state.runtime.busy = false;
        startupController = null;
        setStage("READY", state.runtime.gestureError
          ? "Camera tracking ready. Gesture diagnostics require a retry."
          : "Two-hand tracking and gesture engine ready. Open a mode to interact.");
      }
      const interactionAt = performance.now();
      runModeFrame(gestureEvents, freshAt, reduced);
      profile.record("interaction", performance.now() - interactionAt);
      const overlayAt = performance.now();
      ui.drawHands(state.hands, tracker.connections, state.settings,
        state.handInput.primaryHandId, reduced);
      profile.record("overlay", performance.now() - overlayAt);
      profile.record("pipeline", performance.now() - pipelineAt);
    }

    function scheduleVideoFrame() {
      if (token !== loop.token || document.hidden || !camera.running) return;
      const video = ui.video;
      if (loop.sourceKind === "VIDEO_FRAME_CALLBACK") {
        loop.sourceId = video.requestVideoFrameCallback((at, metadata) => {
          loop.sourceId = null;
          try {
            processFreshFrame(at, Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime * 1000 : null);
          } catch (error) {
            failPipeline("Hand tracking failed: " + error.message, true);
            return;
          }
          scheduleVideoFrame();
        });
      } else {
        loop.sourceId = requestAnimationFrame(() => {
          loop.sourceId = null;
          try { processFreshFrame(performance.now(), ui.video.currentTime * 1000); }
          catch (error) { failPipeline("Hand tracking failed: " + error.message, true); return; }
          scheduleVideoFrame();
        });
      }
    }

    function housekeeping() {
      if (token !== loop.token || document.hidden) return;
      loop.id = 0;
      if (!camera.running) {
        failPipeline("The camera is no longer available. Reconnect it and retry.");
        return;
      }
      const now = performance.now();
      const staleFor = now - loop.lastFreshAt;
      if (staleFor >= 1000 && !loop.stalled) {
        loop.stalled = true;
        clearHandData();
        updateTracking(false, now);
        state.readiness.trackerReady = false;
        state.performance.fps = 0;
        state.performance.inferenceLatencyMs = null;
        state.runtime.startupStage = "WAITING FOR FRAMES";
        state.runtime.startupDetail = "The camera is not delivering fresh frames.";
        logEvent("WARNING", "CAMERA FRAME DELIVERY STALLED");
      }
      if (staleFor >= 5000) {
        failPipeline("No fresh camera frames for five seconds. Close other camera apps and retry.");
        return;
      }
      const reducedHUD = state.settings.visualEffects === "reduced" ||
        (state.settings.autoPerformanceMode && state.performance.effectsReduced);
      if (now - loop.lastHUD >= (reducedHUD ? 200 : 100)) {
        render(); loop.lastHUD = now;
      }
      loop.id = requestAnimationFrame(housekeeping);
    }

    scheduleVideoFrame();
    loop.id = requestAnimationFrame(housekeeping);
  }

  async function startPipeline() {
    if (state.runtime.busy || camera.running) return;
    if (document.hidden) {
      ui.notify("Return to this tab before starting the camera.");
      return;
    }
    const session = ++state.runtime.session;
    const controller = new AbortController();
    startupController = controller;
    const current = () => session === state.runtime.session && !controller.signal.aborted;
    state.runtime.busy = true;
    state.runtime.error = null;
    state.runtime.backgrounded = false;
    resetTracking();

    try {
      setStage("CHECKING BROWSER", "Checking secure context, webcam API, and WebAssembly.");
      checkBrowser();
      setStage("LOADING MODEL", tracker.ready ? "Reusing the initialized model." : "Preparing MediaPipe.");
      await tracker.initialize({
        signal: controller.signal,
        onProgress: (detail) => {
          if (!current()) return;
          state.runtime.startupDetail = detail;
          render();
        }
      });
      if (!current()) return;
      state.readiness.modelReady = tracker.ready;
      state.runtime.delegate = tracker.delegate;
      setStage("REQUESTING CAMERA", "Allow camera permission when your browser asks.");
      const size = await camera.start(state.settings.cameraResolution, { signal: controller.signal });
      if (!current()) return;
      state.camera.width = size.width;
      state.camera.height = size.height;
      state.readiness.cameraReady = true;
      setStage("STARTING TRACKER", "Waiting for the first successful inference.");
      beginLoop();
    } catch (error) {
      if (current()) failPipeline(error.message || "Startup failed. Retry camera startup.");
    }
  }

  function toggleCamera() {
    if (state.runtime.busy) {
      stopPipeline("Startup cancelled. Any late camera stream will be released.");
    } else if (camera.running) {
      if (modeContext.confirm("Stop the camera and release the webcam?")) stopPipeline();
    } else {
      void startPipeline();
    }
  }

  async function toggleFullscreen() {
    if (state.runtime.fullscreenPending) return;
    state.runtime.fullscreenPending = true;
    ui.renderFullscreen(state.runtime.fullscreen, true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
          throw new Error("Fullscreen is unavailable in this browser context.");
        }
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      logEvent("WARNING", "FULLSCREEN REQUEST FAILED");
      ui.notify("Fullscreen could not start or exit. Use the browser's fullscreen control.", "warning");
    } finally {
      state.runtime.fullscreenPending = false;
      state.runtime.fullscreen = Boolean(document.fullscreenElement);
      ui.renderFullscreen(state.runtime.fullscreen);
    }
  }

  document.addEventListener("fullscreenchange", () => {
    cancelModeInput();
    state.runtime.fullscreen = Boolean(document.fullscreenElement);
    ui.renderFullscreen(state.runtime.fullscreen, state.runtime.fullscreenPending);
    logEvent("ACTION", state.runtime.fullscreen ? "FULLSCREEN ENTERED" : "FULLSCREEN EXITED");
  });
  window.addEventListener("resize", () => { cancelModeInput(); });

  document.addEventListener("visibilitychange", () => {
    cancelModeInput();
    callMode("suspend");
    startModeClock();
    if (document.hidden) {
      if (state.runtime.busy) {
        stopPipeline("Startup cancelled because this tab was hidden.");
      } else if (camera.running) {
        stopLoop();
        clearHandData();
        state.readiness.trackerReady = false;
        state.performance.fps = null;
        state.performance.inferenceLatencyMs = null;
        state.runtime.backgrounded = true;
        state.runtime.tracking.candidateSince = null;
        state.trackingState = "NOT_INITIALIZED";
        setStage("SUSPENDED", "Tracking is suspended while this tab is hidden. The camera remains on.");
      }
    } else if (camera.running && state.runtime.backgrounded) {
      state.runtime.backgrounded = false;
      setStage("STARTING TRACKER", "Resuming inference without restarting the camera.");
      beginLoop();
    }
  });

  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(modeClock.id);
    callMode("exit");
    stopPipeline("Camera stopped when the page was left.", true);
    for (const controller of new Set(Object.values(modes))) {
      try { controller?.dispose?.(); } catch (error) { console.warn("[VOIDS VISION] Controller teardown warning", error); }
    }
    tracker.dispose();
    ui.disposeAudio();
    state.readiness.modelReady = false;
    render();
  });

  events.addEventListener("settingsClosed", () => {
    state.runtime.settingsOpen = false;
    cancelModeInput(); resetGestures();
    callMode("suspend");
    logEvent("ACTION", "SETTINGS CLOSED");
  });

  events.addEventListener("systemCheckClosed", () => {
    cancelModeInput(); resetGestures(); callMode("suspend");
  });

  events.addEventListener("welcomeClosed", () => {
    cancelModeInput(); resetGestures();
  });

  function setHandUI(enabled) {
    if (state.currentMode !== "air-draw" || state.runtime.handUI === enabled) return;
    cancelModeInput(); resetGestures();
    state.runtime.handUI = enabled;
    logEvent("ACTION", enabled ? "AIR DRAW → HAND UI / TOOLS" : "AIR DRAW → BRUSH CONTROL");
    render();
  }
  function setPrecisionPreference(name, value) {
    if (!Object.hasOwn(PRECISION_DEFAULTS, name)) return;
    const validated = validatePrecisionPreferences({ ...state.settings, [name]: value });
    cancelModeInput(); resetGestures();
    Object.assign(state.settings, validated);
    try {
      localStorage.setItem(PRECISION_STORAGE_KEY, JSON.stringify({ version: 1, ...validated }));
      state.runtime.preferenceStatus = "Precision preferences saved on this device";
    } catch {
      state.runtime.preferenceStatus = "Applied for this session; browser storage unavailable";
      ui.notify(state.runtime.preferenceStatus, "warning");
    }
    ui.renderSettingsDefaults(state.settings);
    logEvent("ACTION", "PRECISION SETTING → " + name + " · " + validated[name]);
  }

  document.addEventListener("click", (event) => {
    if (event.isTrusted) ui.unlockAudio(state.settings.soundEnabled);
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest("[data-mode], [data-action]");
    if (!control || control.matches(":disabled")) return;
    if (control.dataset.mode) {
      const activationSource = state.runtime.activationSource || (event.isTrusted ? "NATIVE" : "PROGRAMMATIC");
      const handSource = activationSource.startsWith("HAND:") ? activationSource.slice(5) : null;
      if (handSource && state.currentMode === "spatial" && callMode("navigationLocked")) {
        logEvent("WARNING", "MODE NAV BLOCKED · " + handSource + " · ACTIVE SPATIAL CAPTURE");
        return;
      }
      changeMode(control.dataset.mode, handSource || activationSource);
      if (control.hasAttribute("data-start-mode")) {
        if (state.currentMode === "challenge" && ui.element("challenge-input").value === "gestures" &&
            state.camera.active && actionHand(performance.now()) && !state.runtime.paused) {
          state.runtime.pendingLaunch = { mode: "challenge", handId: interaction.data.lastActivationHandId || actionHand(performance.now()).id,
            expiresAt: performance.now() + 5000 };
          ui.notify("Release pinch, then hold INDEX ONLY to start Challenge.");
        } else callMode("onAction", "start");
      }
      return;
    }
    switch (control.dataset.action) {
      case "precision-preference": setPrecisionPreference(control.dataset.preference, control.dataset.value); break;
      case "hud-toggle":
        cancelModeInput(); state.runtime.hudVisible = !state.runtime.hudVisible; break;
      case "recalibrate-pointer": {
        const calibrated = interaction.recalibrate();
        state.runtime.calibrationStatus = calibrated ? "SESSION REBASED" : "WAITING FOR A VISIBLE HAND";
        ui.notify(calibrated ? "Pointer input rebased for the visible hands. Hold INDEX ONLY to aim." : "Show a tracked hand and release any active capture before recalibrating.", calibrated ? "info" : "warning");
        render();
        break;
      }
      case "system-preset": applyPerformancePreset(control.dataset.value || "balanced"); break;
      case "system-reset":
        Object.assign(state.settings, SYSTEM_DEFAULTS);
        persistSystemPreferences();
        ui.renderSettingsDefaults(state.settings);
        ui.notify("System feedback and performance settings reset. Precision tuning was preserved.");
        logEvent("ACTION", "SYSTEM SETTINGS RESET");
        render();
        break;
      case "onboarding-start":
        ui.closeWelcome();
        changeMode("learn", "WELCOME");
        callMode("onAction", "learn-demo-start", control);
        if (!state.camera.active && !state.runtime.busy) toggleCamera();
        break;
      case "onboarding-skip": {
        const saved = markOnboardingCompleted("skipped");
        ui.closeWelcome();
        logEvent("ACTION", "ONBOARDING SKIPPED");
        ui.notify(saved ? "Welcome skipped. Demo / Learn stays available in the sidebar."
          : "Welcome skipped for this session. Browser storage is unavailable.", saved ? "info" : "warning");
        break;
      }
      case "quick-start-dismiss": setSystemPreference("firstRunDismissed", true, { keepPreset: true }); break;
      case "dual-ui-toggle": setPrecisionPreference("dualHandUI", !state.settings.dualHandUI); break;
      case "adaptive-toggle": setPrecisionPreference("adaptiveSmoothing", !state.settings.adaptiveSmoothing); break;
      case "spatial-preference-toggle":
        if (["spatialDualPointer", "magneticAimAssist"].includes(control.dataset.preference)) {
          setPrecisionPreference(control.dataset.preference, !state.settings[control.dataset.preference]);
        }
        break;
      case "precision-toggle": setPrecisionPreference("pointerPrecision", state.settings.pointerPrecision === "high" ? "normal" : "high"); break;
      case "draw-hand-ui": setHandUI(!state.runtime.handUI); break;
      case "page-up": case "page-down": {
        cancelModeInput();
        const moved = ui.scrollPage(control.dataset.action === "page-up" ? -1 : 1,
          state.runtime.handUI ? "pointer" : state.currentMode, state.pointer);
        if (!moved) ui.notify("No scrollable space in that direction.");
        break;
      }
      case "camera": toggleCamera(); break;
      case "gestures": toggleGestures(); break;
      case "sound":
        setSystemPreference("soundEnabled", !state.settings.soundEnabled);
        if (event.isTrusted) ui.unlockAudio(state.settings.soundEnabled);
        logEvent("ACTION", state.settings.soundEnabled ? "SOUND ENABLED" : "SOUND MUTED");
        break;
      case "system-check":
        cancelModeInput(); resetGestures(); callMode("suspend"); ui.openSystemCheck(control, state); startModeClock(); break;
      case "close-system-check": ui.closeSystemCheck(); break;
      case "settings":
        cancelModeInput(); resetGestures(); callMode("suspend");
        if (ui.openSettings(control)) {
          state.runtime.settingsOpen = true;
          logEvent("ACTION", "SETTINGS OPENED");
          startModeClock();
        }
        break;
      case "close-settings": ui.closeSettings(); break;
      case "pause": setPaused(!state.runtime.paused); break;
      case "safe-stop": setPaused(true); break;
      case "fullscreen": void toggleFullscreen(); break;
      case "clear-log":
        state.runtime.eventLog.length = 0;
        ui.renderLog(state.runtime.eventLog);
        ui.announce("Event log cleared.");
        break;
      default: callMode("onAction", control.dataset.action, control);
    }
    render();
  });

  document.addEventListener("change", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#settings-form") && target.hasAttribute("data-system-setting")) {
      const name = target.getAttribute("name");
      const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
      setSystemPreference(name, value);
      if (name === "soundEnabled" && value === true && event.isTrusted) ui.unlockAudio(true);
      return;
    }
    if (target?.closest("[data-mode-panel]")) callMode("onChange", event);
  });

  document.addEventListener("keydown", (event) => {
    // Document shortcuts belong only to Spatial; text fields keep their native editing keys.
    const spatialTarget = event.target instanceof Element ? event.target : null;
    if (state.currentMode === "spatial" && (event.ctrlKey || event.metaKey) && !event.altKey &&
        !event.defaultPrevented && !event.repeat && !event.isComposing && !ui.isModalOpen() &&
        !spatialTarget?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
      if (callMode("onKey", event)) event.preventDefault();
      return;
    }
    if (event.defaultPrevented || event.repeat || event.isComposing ||
        event.ctrlKey || event.altKey || event.metaKey || ui.isModalOpen()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === "Escape") {
      if (document.fullscreenElement) return;
      event.preventDefault();
      changeMode("home");
      return;
    }
    if (event.code === "Space" && !target?.closest("button, a, summary, [role='button']")) {
      event.preventDefault();
      setPaused(!state.runtime.paused);
      return;
    }
    const navigationButton = target?.closest(".mode-nav [data-mode]");
    if (!navigationButton) {
      if (callMode("onKey", event)) event.preventDefault();
      return;
    }
    const buttons = [...document.querySelectorAll(".mode-nav [data-mode]")];
    const index = buttons.indexOf(navigationButton);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next].focus();
  });

  state.readiness.uiReady = true;
  state.runtime.fullscreen = Boolean(document.fullscreenElement);
  ui.renderMode(state.currentMode, MODES[state.currentMode]);
  ui.renderSettingsDefaults(state.settings);
  ui.renderFullscreen(state.runtime.fullscreen);
  logEvent("SYSTEM", "INTERFACE INITIALIZED");
  try {
    setStage("CHECKING BROWSER", "Checking browser capabilities.");
    checkBrowser();
    setStage("IDLE", "Browser supported. Select Start camera to load the model and request permission.");
  } catch (error) {
    state.runtime.error = error.message;
    setStage("ERROR", error.message);
  }
  render();
  ui.finishInitialization();
  if (!onboardingCompleted()) {
    window.setTimeout(() => {
      if (!onboardingCompleted()) ui.openWelcome();
    }, 1250);
  }
}

// Read-only snapshots for diagnostics and future integration; no window globals.
export function getDiagnostics() {
  return structuredClone({
    currentMode: state.currentMode, readiness: state.readiness,
    trackingState: state.trackingState, handInput: state.handInput,
    hands: state.hands, spatial: state.spatial, performance: state.performance,
    gesturesEnabled: state.runtime.gesturesEnabled, paused: state.runtime.paused,
    gestureHistory: state.runtime.gestureHistory, modeData: state.runtime.modeData,
    precision: state.runtime.precision, scroll: state.runtime.scroll,
    handPointers: state.runtime.handPointers, interaction: state.runtime.interaction,
    precisionPreferences: validatePrecisionPreferences(state.settings),
    systemPreferences: validateSystemPreferences(state.settings), handUI: state.runtime.handUI
  });
}

try {
  initialize();
} catch (error) {
  const banner = document.getElementById("shell-error");
  if (banner) {
    banner.hidden = false;
    banner.textContent = "The interface could not initialize. Use current Chrome/Edge and check the Console and file paths.";
  }
  console.error("VOIDS VISION interface initialization failed:", error);
}
