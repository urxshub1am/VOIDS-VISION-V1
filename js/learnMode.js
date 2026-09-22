export const ONBOARDING_STORAGE_KEY = "voids-vision.onboarding.v1";

const STATIC_LABELS = Object.freeze({
  INDEX_ONLY: "INDEX ONLY",
  PINCH: "PINCH",
  FIST: "FIST",
  OPEN_PALM: "OPEN PALM",
  THUMBS_UP: "THUMBS UP",
  SWIPE_LEFT: "SWIPE LEFT",
  SWIPE_RIGHT: "SWIPE RIGHT"
});

const DEMO_STEPS = Object.freeze([
  Object.freeze({
    key: "tracking",
    title: "Show one hand",
    instruction: "Keep one hand fully inside the camera view. Wait for TRACKING before continuing.",
    hint: "Good front/side lighting and a visible palm give the tracker cleaner frames."
  }),
  Object.freeze({
    key: "aim",
    title: "Index only · Aim",
    instruction: "Raise only your index finger and move it smoothly. VOIDS VISION uses the index tip as the pointer.",
    hint: "Hold INDEX ONLY until it confirms. Slow movement is best for precision; faster movement is allowed."
  }),
  Object.freeze({
    key: "pinch",
    title: "Pinch · Select",
    instruction: "Touch thumb + index, hold briefly, then release. The demo advances after a real pinch-and-release cycle.",
    hint: "A deliberate close and clean release is more reliable than an ultra-fast tap on low-FPS webcams."
  }),
  Object.freeze({
    key: "swipe",
    title: "Open palm · Swipe",
    instruction: "Show an open palm and move it clearly left or right. One deliberate horizontal swipe is enough.",
    hint: "Keep the palm visible and avoid large vertical movement while swiping."
  }),
  Object.freeze({
    key: "thumbs",
    title: "Thumbs up · Confirm",
    instruction: "Hold a thumbs-up until it confirms. Presentation Mode uses this for start / confirm.",
    hint: "Keep the other fingers folded enough for a clear pose."
  }),
  Object.freeze({
    key: "two-hands",
    title: "Two hands · Spatial control",
    instruction: "Bring both hands into view. In Spatial / Holo, the first hand that grabs becomes Anchor; the other can join as Manipulator.",
    hint: "This step only verifies that two hands are tracked. Use Spatial / Holo for the real grab / resize / rotate interaction."
  })
]);

function safeRead() {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return { completed: false, completedAt: null };
    const value = JSON.parse(raw);
    return value && value.version === 1
      ? { completed: Boolean(value.completed), completedAt: value.completedAt || null }
      : { completed: false, completedAt: null };
  } catch {
    return { completed: false, completedAt: null };
  }
}

export function onboardingCompleted() {
  return safeRead().completed;
}

export function markOnboardingCompleted(reason = "completed") {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
      version: 1,
      completed: true,
      reason,
      completedAt: new Date().toISOString()
    }));
    return true;
  } catch {
    return false;
  }
}

function visibleHands(state) {
  return state.hands.filter((hand) => hand.tracking?.visible &&
    hand.tracking?.state === "TRACKING" && !hand.tracking?.ambiguous);
}

function latestStatic(hands) {
  return hands.find((hand) => hand.gesture?.confirmed)?.gesture?.confirmed ||
    hands.find((hand) => hand.gesture?.raw)?.gesture?.raw || null;
}

function observedGesture(hands, gesture) {
  if (gesture === "PINCH") return hands.some((hand) => hand.interactionPinch?.on);
  if (gesture === "SWIPE_LEFT" || gesture === "SWIPE_RIGHT") {
    return hands.some((hand) => hand.swipe?.confirmed === gesture);
  }
  return hands.some((hand) => hand.gesture?.confirmed === gesture);
}

export function createLearnMode({ state, ui, video, action, notify, resetInput }) {
  const data = state.runtime.modeData.learn = {
    status: "LEARN CENTER",
    demoRunning: false,
    demoCompleted: false,
    demoStep: 0,
    demoStartedAt: null,
    stepStartedAt: null,
    transitionUntil: 0,
    demoPinchSeen: false,
    demoSignal: "Start the Quick Demo when you are ready.",
    practiceTarget: "INDEX_ONLY",
    practiceStatus: "Choose a gesture and perform it in camera view.",
    practiceMatches: 0,
    practiceLatched: false,
    readinessHint: "Start the camera to measure real tracking readiness."
  };
  let lastRenderAt = -Infinity;
  let lastPreviewAt = -Infinity;
  let twoHandSince = null;
  const previewCanvas = ui.element("learn-camera-preview");
  const previewEmpty = ui.element("learn-camera-empty");
  const previewContext = previewCanvas?.getContext?.("2d") || null;

  function step() {
    return DEMO_STEPS[Math.min(data.demoStep, DEMO_STEPS.length - 1)];
  }

  function setDemoSignal(value) {
    data.demoSignal = value;
  }

  function startDemo() {
    resetInput();
    const now = performance.now();
    Object.assign(data, {
      demoRunning: true,
      demoCompleted: false,
      demoStep: 0,
      demoStartedAt: now,
      stepStartedAt: now,
      transitionUntil: now + 350,
      demoPinchSeen: false,
      demoSignal: "Waiting for camera tracking…"
    });
    twoHandSince = null;
    action("LEARN → QUICK DEMO STARTED");
    render(true);
  }

  function stopDemo() {
    if (!data.demoRunning) return;
    data.demoRunning = false;
    data.status = "LEARN CENTER";
    data.demoSignal = "Quick Demo stopped. You can restart it at any time.";
    twoHandSince = null;
    resetInput();
    action("LEARN → QUICK DEMO STOPPED");
    render(true);
  }

  function completeDemo(now) {
    data.demoRunning = false;
    data.demoCompleted = true;
    data.status = "DEMO COMPLETE";
    data.demoSignal = "YOU’RE READY · Open a workspace mode and control it without touch.";
    const saved = markOnboardingCompleted("quick-demo-complete");
    action("LEARN → QUICK DEMO COMPLETE");
    notify(saved ? "Quick Demo complete · VOIDS VISION is ready."
      : "Quick Demo complete. Browser storage is unavailable, so the welcome may appear again.", saved ? "info" : "warning");
    render(true);
  }

  function advance(now, reason) {
    if (!data.demoRunning) return;
    action("LEARN → STEP " + (data.demoStep + 1) + " COMPLETE · " + reason);
    if (data.demoStep >= DEMO_STEPS.length - 1) {
      completeDemo(now);
      return;
    }
    data.demoStep += 1;
    data.stepStartedAt = now + 450;
    data.transitionUntil = now + 450;
    data.demoPinchSeen = false;
    twoHandSince = null;
    setDemoSignal("Next · " + step().title);
    render(true);
  }

  function skipStep() {
    if (!data.demoRunning) return;
    advance(performance.now(), "SKIPPED");
  }

  function selectPractice(gesture) {
    if (!STATIC_LABELS[gesture]) return;
    data.practiceTarget = gesture;
    data.practiceLatched = false;
    data.practiceStatus = "Waiting for " + STATIC_LABELS[gesture] + "…";
    resetInput();
    action("LEARN → PRACTICE " + gesture);
    render(true);
  }

  function updatePractice(hands) {
    const matched = observedGesture(hands, data.practiceTarget);
    if (matched && !data.practiceLatched) {
      data.practiceLatched = true;
      data.practiceMatches += 1;
      const hand = hands.find((candidate) => observedGesture([candidate], data.practiceTarget));
      data.practiceStatus = "MATCHED · " + (hand?.id || "HAND") + " · release / change pose to retry";
      action("LEARN → PRACTICE MATCH · " + data.practiceTarget);
    } else if (!matched && data.practiceLatched) {
      data.practiceLatched = false;
      data.practiceStatus = "Ready for " + STATIC_LABELS[data.practiceTarget] + ".";
    }
  }

  function updateReadiness(hands) {
    const fps = state.performance.fps;
    const latency = state.performance.inferenceLatencyMs;
    const quality = state.runtime.trackingQuality || "--";
    let hint = "Start the camera to measure real tracking readiness.";
    if (state.runtime.error || state.runtime.gestureError) {
      hint = state.runtime.error || state.runtime.gestureError;
    } else if (state.camera.active && !state.readiness.trackerReady) {
      hint = state.runtime.startupDetail || "Waiting for the tracker to become ready.";
    } else if (state.camera.active && state.readiness.trackerReady && !hands.length) {
      hint = "Tracker is ready · keep one hand fully inside frame and face the palm toward the camera.";
    } else if (quality === "POOR" || Number.isFinite(fps) && fps < 12) {
      hint = "Tracking is limited · try brighter even front/side lighting, keep the hand visible, or use the Performance preset.";
    } else if (quality === "FAIR" || Number.isFinite(fps) && fps < 20) {
      hint = "Tracking is usable · smoother lighting or the Performance preset may add headroom for fast gestures.";
    } else if (hands.length) {
      hint = "Tracking is ready · use deliberate gestures and keep fingers inside the camera frame.";
    }
    data.readinessHint = hint;
    ui.setText("learn-ready-camera", state.camera.active
      ? state.readiness.trackerReady ? "READY · " + (state.camera.width || "--") + "×" + (state.camera.height || "--") : "STARTING"
      : "OFF");
    ui.setText("learn-ready-tracking", hands.length
      ? hands.length + " HAND" + (hands.length === 1 ? "" : "S") + " · TRACKING"
      : state.trackingState.replaceAll("_", " "));
    ui.setText("learn-ready-quality", quality);
    ui.setText("learn-ready-performance", Number.isFinite(fps)
      ? fps.toFixed(1) + " FPS · " + (Number.isFinite(latency) ? latency.toFixed(1) + " ms inference" : "latency --")
      : "NOT MEASURED");
    ui.setText("learn-ready-profile", String(state.settings.performancePreset || "custom").toUpperCase());
    ui.setText("learn-ready-hint", hint);
  }

  function evaluateDemo(now, hands) {
    if (!data.demoRunning || now < data.transitionUntil) return;
    const current = step();
    const primary = hands[0] || null;
    const raw = latestStatic(hands);
    switch (current.key) {
      case "tracking":
        setDemoSignal(!state.camera.active ? "CAMERA OFF · use Start camera"
          : hands.length ? hands.map((hand) => hand.id).join(" + ") + " · TRACKING" : "SEARCHING FOR HAND");
        if (state.readiness.trackerReady && hands.length) advance(now, "HAND TRACKED");
        break;
      case "aim": {
        const aim = hands.find((hand) => hand.gesture?.confirmed === "INDEX_ONLY");
        setDemoSignal(aim ? aim.id + " · INDEX ONLY CONFIRMED" : "CURRENT · " + (raw?.replaceAll("_", " ") || "NO GESTURE"));
        if (aim && Object.values(state.runtime.handPointers || {}).some((pointer) => pointer.handId === aim.id && pointer.visible)) {
          advance(now, "INDEX AIM");
        }
        break;
      }
      case "pinch": {
        const pinching = hands.some((hand) => hand.interactionPinch?.on);
        if (pinching) data.demoPinchSeen = true;
        setDemoSignal(data.demoPinchSeen
          ? pinching ? "PINCH HELD · RELEASE TO CONTINUE" : "PINCH RELEASED"
          : "WAITING FOR PINCH");
        if (data.demoPinchSeen && !pinching) advance(now, "PINCH + RELEASE");
        break;
      }
      case "swipe": {
        const swiping = hands.find((hand) => hand.swipe?.confirmed === "SWIPE_LEFT" || hand.swipe?.confirmed === "SWIPE_RIGHT");
        const motion = primary?.motionState?.direction || "STILL";
        setDemoSignal(swiping ? swiping.id + " · " + swiping.swipe.confirmed.replaceAll("_", " ") : "PALM MOTION · " + motion);
        if (swiping) advance(now, swiping.swipe.confirmed);
        break;
      }
      case "thumbs": {
        const thumbs = hands.find((hand) => hand.gesture?.confirmed === "THUMBS_UP");
        setDemoSignal(thumbs ? thumbs.id + " · THUMBS UP CONFIRMED" : "CURRENT · " + (raw?.replaceAll("_", " ") || "NO GESTURE"));
        if (thumbs) advance(now, "THUMBS UP");
        break;
      }
      case "two-hands":
        if (hands.length >= 2) twoHandSince ??= now;
        else twoHandSince = null;
        setDemoSignal(hands.length + " / 2 HANDS TRACKED");
        if (twoHandSince !== null && now - twoHandSince >= 350) advance(now, "TWO HANDS TRACKED");
        break;
      default:
        break;
    }
  }

  function renderPreview(now) {
    const active = Boolean(state.camera.active && state.readiness.cameraReady && video?.readyState >= 2 && video.videoWidth && video.videoHeight);
    previewCanvas.hidden = !active;
    previewEmpty.hidden = active;
    ui.setText("learn-camera-badge", active ? (state.runtime.trackingQuality || "TRACKING") : "CAMERA OFF");
    if (!active || !previewContext || now - lastPreviewAt < 120) return;
    lastPreviewAt = now;
    const width = previewCanvas.width || 320, height = previewCanvas.height || 240;
    try {
      previewContext.save();
      previewContext.clearRect(0, 0, width, height);
      if (state.settings.cameraMirror) {
        previewContext.translate(width, 0);
        previewContext.scale(-1, 1);
      }
      previewContext.drawImage(video, 0, 0, width, height);
    } catch {
      // Preview is optional; never let a transient video draw fault exit Learn mode.
    } finally {
      try { previewContext.restore(); } catch { /* context already restored */ }
    }
  }

  function render(force = false) {
    const now = performance.now();
    renderPreview(now);
    if (!force && now - lastRenderAt < 90) return;
    lastRenderAt = now;
    const hands = visibleHands(state);
    updateReadiness(hands);
    data.status = data.demoCompleted ? "DEMO COMPLETE" : data.demoRunning ? "QUICK DEMO ACTIVE" : "LEARN CENTER";
    ui.setText("learn-status", data.status);
    ui.setText("learn-demo-status", data.demoRunning ? "LIVE" : data.demoCompleted ? "COMPLETE" : "READY");
    ui.setText("learn-demo-step", data.demoRunning ? "STEP " + (data.demoStep + 1) + " / " + DEMO_STEPS.length : data.demoCompleted ? "6 / 6" : "--");
    const current = step();
    ui.setText("learn-demo-title", data.demoRunning ? current.title : data.demoCompleted ? "YOU’RE READY" : "Quick Demo · about 45–60 seconds");
    ui.setText("learn-demo-instruction", data.demoRunning ? current.instruction : data.demoCompleted
      ? "You can replay the demo at any time from Demo / Learn."
      : "Start a short live walkthrough. Each step advances only after VOIDS VISION sees the real gesture signal.");
    ui.setText("learn-demo-hint", data.demoRunning ? current.hint : "The demo uses real camera / gesture state; it does not fake completion signals.");
    ui.setText("learn-demo-signal", data.demoSignal);
    const progress = data.demoCompleted ? 100 : data.demoRunning ? Math.round(data.demoStep / DEMO_STEPS.length * 100) : 0;
    ui.element("learn-demo-progress").style.width = progress + "%";
    ui.element("learn-demo-meter").setAttribute("aria-valuenow", String(progress));
    ui.element("learn-demo-start").textContent = data.demoRunning ? "Restart demo" : data.demoCompleted ? "Replay demo" : "Start Quick Demo";
    ui.element("learn-demo-stop").disabled = !data.demoRunning;
    ui.element("learn-demo-skip").disabled = !data.demoRunning;
    ui.setText("learn-practice-target", STATIC_LABELS[data.practiceTarget]);
    ui.setText("learn-practice-status", data.practiceStatus);
    ui.setText("learn-practice-count", String(data.practiceMatches));
    for (const button of document.querySelectorAll("[data-learn-gesture]")) {
      button.setAttribute("aria-pressed", String(button.dataset.learnGesture === data.practiceTarget));
    }
  }

  function tick(now) {
    const hands = visibleHands(state);
    if (!data.demoRunning) updatePractice(hands);
    evaluateDemo(now, hands);
    render();
  }

  return {
    enter() {
      data.demoSignal = data.demoRunning ? data.demoSignal : "Start the Quick Demo when you are ready.";
      render(true);
    },
    exit() {
      if (data.demoRunning) stopDemo();
    },
    cancel() {},
    render,
    tick,
    onAction(name, control) {
      if (name === "learn-demo-start") { startDemo(); return true; }
      if (name === "learn-demo-stop") { stopDemo(); return true; }
      if (name === "learn-demo-skip") { skipStep(); return true; }
      if (name === "learn-practice-select") { selectPractice(control?.dataset?.value || "INDEX_ONLY"); return true; }
      return false;
    }
  };
}
