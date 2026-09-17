export const CAMERA_PRESETS = Object.freeze({
  performance: { width: 640, height: 480 },
  balanced: { width: 640, height: 480 },
  quality: { width: 1280, height: 720 }
});

export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CameraError";
    this.code = code;
  }
}

export function checkCameraSupport() {
  if (!["http:", "https:"].includes(location.protocol) || !window.isSecureContext) {
    throw new CameraError("INSECURE_CONTEXT", "Open VOIDS VISION through localhost or HTTPS, using Live Server.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("UNSUPPORTED", "Camera access is unavailable. Use current Chrome or Edge and check browser permissions.");
  }
}

function release(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function waitForPermission(promise, signal) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      reject(signal.reason);
    };

    signal.addEventListener("abort", cancel, { once: true });
    promise.then((stream) => {
      signal.removeEventListener("abort", cancel);
      if (finished || signal.aborted) {
        release(stream);
        if (!finished) reject(signal.reason);
        return;
      }
      finished = true;
      resolve(stream);
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

function waitForVideo(video, signal) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const events = ["loadeddata", "canplay", "playing", "resize"];
    const timer = window.setTimeout(() => {
      finish(new CameraError("VIDEO_TIMEOUT", "The camera opened but did not provide playable frames. Close other camera apps and retry."));
    }, 10000);

    function finish(error) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      events.forEach((name) => video.removeEventListener(name, check));
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }

    function check() {
      if (video.readyState >= 2 && video.videoWidth > 0 &&
          video.videoHeight > 0 && !video.paused) finish();
    }

    function onError() {
      finish(new CameraError("VIDEO_ERROR", "The browser could not play the camera stream. Retry camera startup."));
    }

    function onAbort() { finish(signal.reason); }

    events.forEach((name) => video.addEventListener(name, check));
    video.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });

    if (signal.aborted) {
      onAbort();
      return;
    }

    Promise.resolve(video.play()).then(check, (error) => finish(error));
    check();
  });
}

function readableCameraError(error) {
  if (error instanceof CameraError || error?.name === "AbortError") return error;
  const messages = {
    NotAllowedError: "Camera permission was denied. Allow camera access in the address-bar site settings, then retry.",
    SecurityError: "Camera access is blocked by browser or site policy. Use localhost/HTTPS and check camera permissions.",
    NotFoundError: "No camera was found. Connect or enable a webcam, then retry.",
    NotReadableError: "The camera is busy or unavailable. Close other camera apps/tabs and check the operating system's camera privacy settings.",
    OverconstrainedError: "The camera cannot satisfy the requested settings. Try another webcam or the Performance preset.",
    TypeError: "Camera access is unavailable in this page context. Open the project through Live Server."
  };
  return new CameraError(error?.name || "CAMERA_ERROR",
    messages[error?.name] || "Camera startup failed. Check the webcam and permissions, then retry.");
}

export class CameraController {
  constructor(video, { onEnded = () => {}, onActivity = () => {} } = {}) {
    this.video = video;
    this.onEnded = onEnded;
    this.onActivity = onActivity;
    this.stream = null;
    this.pendingController = null;
    this.requestId = 0;
    this.removeTrackListeners = () => {};
  }

  get running() {
    return Boolean(this.stream?.getVideoTracks().some(
      (track) => track.readyState === "live"
    ));
  }

  async start(preset = "balanced", { signal } = {}) {
    checkCameraSupport();
    this.stop();

    const requestId = this.requestId;
    const controller = new AbortController();
    this.pendingController = controller;
    const forwardAbort = () => controller.abort(
      signal.reason || new DOMException("Camera start cancelled.", "AbortError")
    );
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();

    const timer = window.setTimeout(() => {
      controller.abort(new CameraError("PERMISSION_TIMEOUT",
        "Camera permission timed out. Dismiss the old browser prompt, then retry."));
    }, 30000);

    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      const size = CAMERA_PRESETS[preset] || CAMERA_PRESETS.balanced;
      const permission = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: size.width },
          height: { ideal: size.height },
          frameRate: { ideal: 30, max: 30 },
          facingMode: "user"
        }
      });

      const stream = await waitForPermission(permission, controller.signal);
      window.clearTimeout(timer);

      if (controller.signal.aborted || requestId !== this.requestId) {
        release(stream);
        throw controller.signal.reason || new DOMException("Camera start cancelled.", "AbortError");
      }

      this.stream = stream;
      this.onActivity(true);
      const tracks = stream.getVideoTracks();
      if (!tracks.length || !this.running) {
        throw new CameraError("NO_VIDEO_TRACK", "The camera returned no live video track. Reconnect it and retry.");
      }

      const ended = () => {
        if (this.stream !== stream) return;
        this.stop();
        this.onEnded(new CameraError("CAMERA_DISCONNECTED",
          "The camera stopped or disconnected. Reconnect it, then select Start camera."));
      };
      tracks.forEach((track) => track.addEventListener("ended", ended));
      this.removeTrackListeners = () => {
        tracks.forEach((track) => track.removeEventListener("ended", ended));
      };

      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      await waitForVideo(this.video, controller.signal);

      if (controller.signal.aborted || requestId !== this.requestId) {
        throw controller.signal.reason || new DOMException("Camera start cancelled.", "AbortError");
      }

      return { width: this.video.videoWidth, height: this.video.videoHeight };
    } catch (error) {
      if (requestId === this.requestId) this.stop();
      throw readableCameraError(error);
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
      if (this.pendingController === controller) this.pendingController = null;
    }
  }

  stop() {
    this.requestId += 1;
    this.pendingController?.abort(new DOMException("Camera start cancelled.", "AbortError"));
    this.pendingController = null;
    this.removeTrackListeners();
    this.removeTrackListeners = () => {};
    const hadStream = this.stream !== null;
    release(this.stream);
    this.stream = null;
    if (hadStream) this.onActivity(false);
    this.video.pause();
    this.video.srcObject = null;
  }
}