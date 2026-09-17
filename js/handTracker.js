const VERSION = "0.10.35";
const USE_LOCAL_ASSETS = false;
const PACKAGE_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VERSION;

export const MAX_HANDS = 2;

export const TRACKER_ASSETS = Object.freeze({
  version: VERSION,
  module: USE_LOCAL_ASSETS
    ? new URL("../assets/wasm/vision_bundle.mjs", import.meta.url).href
    : PACKAGE_ROOT + "/vision_bundle.mjs",
  wasm: USE_LOCAL_ASSETS
    ? new URL("../assets/wasm/", import.meta.url).href.replace(/\/$/, "")
    : PACKAGE_ROOT + "/wasm",
  model: USE_LOCAL_ASSETS
    ? new URL("../assets/models/hand_landmarker-float16-v1.task", import.meta.url).href
    : "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
});

function closeTask(task) {
  try { task?.close(); } catch { /* Best-effort cleanup during cancellation. */ }
}

function waitForModel(promise, signal) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      reject(signal.reason);
    };

    signal.addEventListener("abort", cancel, { once: true });
    promise.then((loaded) => {
      signal.removeEventListener("abort", cancel);
      if (finished || signal.aborted) {
        closeTask(loaded.task);
        if (!finished) reject(signal.reason);
        return;
      }
      finished = true;
      resolve(loaded);
    }, (error) => {
      signal.removeEventListener("abort", cancel);
      if (!finished) {
        finished = true;
        reject(error);
      }
    });

    if (signal.aborted) cancel();
  });
}

export class HandTracker {
  constructor() {
    this.task = null;
    this.loading = null;
    this.loadController = null;
    this.connections = [];
    this.delegate = null;
    this.lastTimestamp = -1;
  }

  get ready() { return this.task !== null; }

  async initialize({ signal, onProgress = () => {} } = {}) {
    if (signal?.aborted) throw signal.reason;
    if (this.ready) return;
    if (this.loading) {
      throw new Error("A previous model initialization is still finishing. Retry shortly; reload the page if it remains stuck.");
    }

    const controller = new AbortController();
    this.loadController = controller;
    const forwardAbort = () => controller.abort(
      signal.reason || new DOMException("Model loading cancelled.", "AbortError")
    );
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();

    const timer = window.setTimeout(() => {
      controller.abort(new Error("Model loading timed out. Check the internet connection and asset access, then retry."));
    }, 45000);

    const checkCancelled = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
    };

    const operation = (async () => {
      checkCancelled();
      onProgress("Loading MediaPipe " + VERSION + "...");
      const { FilesetResolver, HandLandmarker } = await import(TRACKER_ASSETS.module);
      checkCancelled();
      onProgress("Preparing the matching WASM runtime...");
      const fileset = await FilesetResolver.forVisionTasks(TRACKER_ASSETS.wasm);
      checkCancelled();
      onProgress("Downloading Hand Landmarker model, float16 / version 1...");
      const response = await fetch(TRACKER_ASSETS.model, { signal: controller.signal });
      if (!response.ok) throw new Error("Model download failed: HTTP " + response.status + ".");
      const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
      checkCancelled();

      let task;
      let delegate = "GPU";
      const options = {
        baseOptions: { modelAssetBuffer, delegate },
        runningMode: "VIDEO",
        numHands: MAX_HANDS,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      };

      try {
        onProgress("Initializing the GPU hand tracker...");
        task = await HandLandmarker.createFromOptions(fileset, options);
      } catch (error) {
        checkCancelled();
        delegate = "CPU";
        onProgress("GPU initialization failed. Trying the CPU delegate...");
        options.baseOptions.delegate = delegate;
        task = await HandLandmarker.createFromOptions(fileset, options);
      }

      return {
        task, delegate,
        connections: HandLandmarker.HAND_CONNECTIONS.map(
          ({ start, end }) => [start, end]
        )
      };
    })();

    this.loading = operation;
    const clearPending = () => {
      if (this.loading === operation) this.loading = null;
    };
    operation.then(clearPending, clearPending);

    try {
      const loaded = await waitForModel(operation, controller.signal);
      if (controller.signal.aborted) {
        closeTask(loaded.task);
        throw controller.signal.reason;
      }
      this.task = loaded.task;
      this.delegate = loaded.delegate;
      this.connections = loaded.connections;
      this.lastTimestamp = -1;
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
      if (this.loadController === controller) this.loadController = null;
    }
  }

  detect(video, timestamp) {
    if (!this.task) throw new Error("Hand tracker is not initialized.");
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

    // Keep timestamps monotonic across ordinary camera stop/start.
    const frameTimestamp = Math.max(timestamp, this.lastTimestamp + 0.01);
    this.lastTimestamp = frameTimestamp;
    const started = performance.now();
    const result = this.task.detectForVideo(video, frameTimestamp);
    const latencyMs = performance.now() - started;
    const hands = [];

    for (let sourceIndex = 0; sourceIndex < Math.min(
      result.landmarks?.length || 0, MAX_HANDS
    ); sourceIndex += 1) {
      const landmarks = result.landmarks[sourceIndex];
      const valid = landmarks?.length === 21 && landmarks.every((point) =>
        Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
      );
      if (!valid) continue;

      const category = result.handedness?.[sourceIndex]?.[0];
      const handedness = ["Left", "Right"].includes(category?.categoryName)
        ? category.categoryName : null;
      const worldLandmarks = result.worldLandmarks?.[sourceIndex] || [];

      hands.push({
        sourceIndex,
        landmarks,
        worldLandmarks: worldLandmarks.length === 21 ? worldLandmarks : [],
        handedness,
        // MediaPipe handedness score; never a custom gesture match score.
        handednessScore: Number.isFinite(category?.score) ? category.score : null
      });
    }

    return { hands, handCount: hands.length, timestamp: frameTimestamp, latencyMs };
  }

  cancelInitialization() {
    this.loadController?.abort(new DOMException("Model loading cancelled.", "AbortError"));
  }

  dispose() {
    this.cancelInitialization();
    closeTask(this.task);
    this.task = null;
    this.connections = [];
    this.delegate = null;
    this.lastTimestamp = -1;
  }
}