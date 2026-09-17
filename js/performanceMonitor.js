// Bounded observational counters. This module never schedules inference or changes input.
export function createPerformanceMonitor(performanceState) {
  const names = ["inference", "association", "gestures", "interaction", "overlay", "pipeline", "cursor", "modeRender", "background", "hud", "log"];
  const counters = Object.fromEntries(names.map(name => [name, { count: 0, total: 0, max: 0 }]));
  const data = performanceState.profile = {
    cameraFps: null, cameraSource: "UNAVAILABLE", cameraRequestedFps: null,
    pipelineMs: null, stages: {}, windowMs: 0, activeMode: "home", hands: 0,
    delegate: null, reduced: false, inferenceInFlight: 0, maxInferenceInFlight: 0
  };
  let video = null, callbackId = null, token = 0, startAt = null;
  let presented = null, presentedAt = null, lastCamera = null;
  function record(name, ms) {
    const c = counters[name];
    if (!c || !Number.isFinite(ms) || ms < 0) return;
    c.count++; c.total += ms; c.max = Math.max(c.max, ms);
  }
  function stop() {
    token++;
    if (callbackId !== null) video?.cancelVideoFrameCallback?.(callbackId);
    callbackId = null; video = null; startAt = null;
    presented = presentedAt = lastCamera = null;
    Object.assign(data, { cameraFps: null, cameraSource: "UNAVAILABLE", cameraRequestedFps: null,
      pipelineMs: null, stages: {}, windowMs: 0, inferenceInFlight: 0, maxInferenceInFlight: 0 });
    for (const c of Object.values(counters)) c.count = c.total = c.max = 0;
  }
  function start(element, now) {
    stop(); video = element; startAt = now;
    const configured = video.srcObject?.getVideoTracks?.()[0]?.getSettings?.().frameRate;
    data.cameraRequestedFps = Number.isFinite(configured) ? configured : null;
    const currentToken = token;
    if (typeof video.requestVideoFrameCallback === "function") {
      const observe = (at, metadata) => {
        if (token !== currentToken || !video) return;
        // Count the browser's presented frames, not callback invocations: a busy
        // main thread may miss callbacks while the compositor presents frames.
        if (Number.isFinite(metadata.presentedFrames)) {
          presented = metadata.presentedFrames; presentedAt = at;
        }
        callbackId = video.requestVideoFrameCallback(observe);
      };
      callbackId = video.requestVideoFrameCallback(observe);
    }
    cameraSample(now);
  }
  function cameraSample(now) {
    if (!video) return;
    let total = null, source = "UNAVAILABLE";
    if (presented !== null && now - presentedAt < 2000) {
      total = presented; source = "PRESENTED FRAMES";
    } else {
      try {
        const q = video.getVideoPlaybackQuality?.();
        if (q && Number.isFinite(q.totalVideoFrames) && q.totalVideoFrames > 0) {
          total = Math.max(0, q.totalVideoFrames - (q.droppedVideoFrames || 0)); source = "PLAYBACK FRAME COUNTER";
        }
      } catch { /* Unsupported frame measurement stays --, never a guessed rate. */ }
    }
    if (total === null) { data.cameraFps = null; data.cameraSource = source; lastCamera = null; return; }
    if (lastCamera && lastCamera.source === source && total >= lastCamera.total && now > lastCamera.at) {
      data.cameraFps = (total - lastCamera.total) * 1000 / (now - lastCamera.at);
    } else data.cameraFps = null;
    data.cameraSource = source; lastCamera = { total, at: now, source };
  }
  function refresh(now, state) {
    if (startAt === null) startAt = now;
    Object.assign(data, { activeMode: state.currentMode, hands: state.handInput.count ?? 0,
      delegate: state.runtime.delegate,
      reduced: state.settings.visualEffects === "reduced" || (state.settings.autoPerformanceMode && performanceState.effectsReduced) });
    const elapsed = now - startAt;
    if (elapsed < 1000) return;
    cameraSample(now); data.windowMs = elapsed;
    for (const [name, c] of Object.entries(counters)) {
      data.stages[name] = { calls: c.count, averageMs: c.count ? c.total / c.count : null,
        maxMs: c.count ? c.max : null, msPerSecond: c.total * 1000 / elapsed };
      c.count = c.total = c.max = 0;
    }
    data.pipelineMs = data.stages.pipeline.averageMs;
    performanceState.hudHz = data.stages.hud.calls * 1000 / elapsed;
    startAt = now;
  }
  function inferenceStarted() {
    data.inferenceInFlight++;
    data.maxInferenceInFlight = Math.max(data.maxInferenceInFlight, data.inferenceInFlight);
  }
  function inferenceEnded() { data.inferenceInFlight = Math.max(0, data.inferenceInFlight - 1); }
  return { data, record, start, stop, refresh, inferenceStarted, inferenceEnded };
}
