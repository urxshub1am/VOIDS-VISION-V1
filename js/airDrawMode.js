

const WIDTH = 1280, HEIGHT = 960;
const SIZES = Object.freeze({ small: 4, medium: 9, large: 18 });
const COLORS = Object.freeze(["#45dbff", "#ae8cff", "#68f5c3", "#edf6ff"]);
const MAX_STROKES = 512, MAX_POINTS = 100000;

export function createAirDrawMode({ state, ui, video, action, notify, pause, confirm, manualAllowed, openTools, interaction, recordPerformance }) {
  const canvas = ui.element("draw-surface"), background = ui.element("draw-background");
  const brush = ui.element("draw-brush");
  const context = canvas.getContext("2d"), backgroundContext = background.getContext("2d");
  if (!context || !backgroundContext) throw new Error("Air Draw requires Canvas 2D.");
  // These dimensions never change on resize/fullscreen. CSS scales both layers uniformly.
  canvas.width = background.width = WIDTH;
  canvas.height = background.height = HEIGHT;
  const data = state.runtime.modeData["air-draw"] = {
    status: "READY TO DRAW", tool: "brush", size: "medium", color: COLORS[0],
    background: "dark", strokes: [], pointCount: 0, drawing: false, exporting: false
  };
  let position = null, currentStroke = null, inputSource = null;
  let released = false, pointerId = null, lastBackgroundAt = -Infinity, lastVideoFrame = null;
  let drawOwner = null, previewId = null;

  function active() { return state.currentMode === "air-draw"; }
  function imageBounds() {
    if (data.background !== "camera" || !video.videoWidth || !video.videoHeight) {
      return { left: 0, top: 0, width: WIDTH, height: HEIGHT };
    }
    const scale = Math.min(WIDTH / video.videoWidth, HEIGHT / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    return { left: (WIDTH - width) / 2, top: (HEIGHT - height) / 2, width, height };
  }
  function drawCamera(destination) {
    const b = imageBounds();
    destination.save();
    if (state.settings.cameraMirror) { destination.translate(WIDTH, 0); destination.scale(-1, 1); }
    destination.drawImage(video, b.left, b.top, b.width, b.height);
    destination.restore();
  }
  function renderBackground() {
    backgroundContext.clearRect(0, 0, WIDTH, HEIGHT);
    if (data.background !== "transparent") {
      backgroundContext.fillStyle = "#070e18";
      backgroundContext.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (data.background === "camera" && state.camera.active && video.readyState >= 2) drawCamera(backgroundContext);
  }
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function paintCurve(stroke, index, tail = false) {
    const point = stroke.points[index], previous = stroke.points[index - 1];
    context.save();
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = context.fillStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineCap = context.lineJoin = "round";
    context.beginPath();
    if (previous) {
      const start = tail ? midpoint(previous, point)
        : index > 1 ? midpoint(stroke.points[index - 2], previous) : previous;
      const control = tail ? point : previous;
      const end = tail ? point : midpoint(previous, point);
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(control.x, control.y, end.x, end.y);
      context.stroke();
    }
    else { context.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2); context.fill(); }
    context.restore();
  }
  function replay() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    for (const stroke of data.strokes) {
      stroke.points.forEach((point, index) => paintCurve(stroke, index));
      if (stroke.finished && stroke.points.length > 1) paintCurve(stroke, stroke.points.length - 1, true);
    }
  }
  function stopStroke() {
    if (!currentStroke) return;
    if (currentStroke.points.length > 1) paintCurve(currentStroke, currentStroke.points.length - 1, true);
    currentStroke.finished = true;
    currentStroke = null;
    data.drawing = false;
    inputSource = null;
    action("AIR DRAW STOP");
  }
  function startStroke(source) {
    if (!position || currentStroke) return;
    if (data.strokes.length >= MAX_STROKES || data.pointCount >= MAX_POINTS) {
      notify("Drawing session limit reached. Save your PNG, then undo or clear to continue.", "warning");
      released = false;
      return;
    }
    currentStroke = { tool: data.tool, color: data.color,
      size: SIZES[data.size] * (data.tool === "eraser" ? 3 : 1), points: [], finished: false };
    data.strokes.push(currentStroke);
    data.drawing = true;
    inputSource = source;
    addPoint(position);
    action("AIR DRAW START");
  }
  function addPoint(point) {
    if (!currentStroke) return;
    const previous = currentStroke.points.at(-1);
    const minimum = inputSource === "gesture" ? 1.2 : 0.7;
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minimum) return;
    if (data.pointCount >= MAX_POINTS) {
      stopStroke(); released = false;
      notify("Drawing point limit reached. Save, then undo or clear to continue.", "warning"); return;
    }
    const next = { x: point.x, y: point.y };
    currentStroke.points.push(next); data.pointCount += 1;
    paintCurve(currentStroke, currentStroke.points.length - 1);
  }
  function showBrush() {
    brush.hidden = !position || !manualAllowed();
    if (!position) return;
    brush.style.left = (position.x / WIDTH * 100) + "%";
    brush.style.top = (position.y / HEIGHT * 100) + "%";
    brush.style.setProperty("--brush-color", data.tool === "eraser" ? "#ffb368" : data.color);
    brush.dataset.tool = data.tool;
  }
  function releaseDraw(reason = "DRAW_CANCELLED") {
    if (drawOwner) interaction.release(drawOwner, reason);
  }
  function cancel() {
    releaseDraw(); previewId = null;
    stopStroke(); drawOwner = null; data.owner = null; released = false; position = null; 
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
    brush.hidden = true;
  }
  function canvasPoint(point) {
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(WIDTH, (point.x - bounds.left) / bounds.width * WIDTH)),
      y: Math.max(0, Math.min(HEIGHT, (point.y - bounds.top) / bounds.height * HEIGHT)) };
  }
  function preview(pointers) {
    if (drawOwner || pointerId !== null || !manualAllowed()) return;
    const eligible = p => p.visible && !p.captureKind && !p.pinchRaw && p.gesture === "INDEX_ONLY" && ui.pointInside(p.filtered, canvas);
    const pointer = pointers.find(p => p.handId === previewId && eligible(p)) || pointers.find(eligible);
    previewId = pointer?.handId || null; position = pointer ? canvasPoint(pointer.filtered) : null; showBrush();
  }
  function beginPointer(handId, point, now) {
    if (!active() || !manualAllowed() || pointerId !== null || currentStroke || data.exporting) return false;
    drawOwner = handId; position = canvasPoint(point); startStroke("gesture"); showBrush();
    data.owner = handId;
    return Boolean(currentStroke);
  }
  function movePointer(handId, point, now) {
    if (drawOwner !== handId || !currentStroke) return;
    position = canvasPoint(point); addPoint(position); showBrush();
    const p = state.runtime.handPointers?.[handId];
    state.runtime.precision.draw = { at: now, handId, raw: p?.raw || point,
      filtered: { ...position }, speed: p?.speed || 0 };
  }
  function endPointer(handId) {
    if (drawOwner !== handId) return;
    stopStroke(); drawOwner = null; data.owner = null; position = null; showBrush();
  }
  function onGesture(event) {
    if (pointerId !== null || currentStroke) return;
    if (event.gesture === "TWO_FINGERS") {
      ui.element("draw-tools").focus({ preventScroll: true }); openTools();
      notify("Hand UI active. Either hand can aim, pinch-select, or pinch-drag a panel.");
      action("AIR DRAW → TOOLS");
    }
  }
  function mousePosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(WIDTH, (event.clientX - bounds.left) / bounds.width * WIDTH)),
      y: Math.max(0, Math.min(HEIGHT, (event.clientY - bounds.top) / bounds.height * HEIGHT)) };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (!active() || !manualAllowed() || event.button !== 0 || pointerId !== null) return;
    event.preventDefault(); releaseDraw("MOUSE_CAPTURE"); stopStroke(); released = false; 
    pointerId = event.pointerId; canvas.setPointerCapture(pointerId);
    position = mousePosition(event); showBrush(); startStroke("manual");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!active() || !manualAllowed() || (pointerId !== null && pointerId !== event.pointerId)) return;
    if (pointerId === null && event.pointerType !== "mouse") return;
    position = mousePosition(event); showBrush();
    if (inputSource === "manual") addPoint(position);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, (event) => {
    if (pointerId !== event.pointerId) return;
    if (name === "pointerup" && inputSource === "manual" && manualAllowed()) addPoint(mousePosition(event));
    stopStroke(); const id = pointerId; pointerId = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  });
  canvas.addEventListener("pointerleave", () => { if (pointerId === null) brush.hidden = true; });

  async function savePNG() {
    if (data.exporting) return;
    releaseDraw("EXPORT"); stopStroke(); released = false;
    const includeCamera = data.background === "camera" && ui.element("draw-include-camera").checked;
    if (includeCamera && (!state.camera.active || video.readyState < 2)) {
      notify("Start the camera or uncheck Include camera frame before saving.", "warning"); return;
    }
    data.exporting = true;
    try {
      const output = document.createElement("canvas"); output.width = WIDTH; output.height = HEIGHT;
      const destination = output.getContext("2d");
      if (!destination) throw new Error("PNG export requires Canvas 2D.");
      if (data.background === "dark" || includeCamera) {
        destination.fillStyle = "#070e18"; destination.fillRect(0, 0, WIDTH, HEIGHT);
      }
      if (includeCamera) drawCamera(destination);
      destination.drawImage(canvas, 0, 0);
      const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The browser could not create the PNG.");
      const date = new Date(), pad = (value) => String(value).padStart(2, "0");
      const stamp = date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "-" +
        pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "voids-vision-drawing-" + stamp + ".png";
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      action("AIR DRAW → PNG SAVED");
    } catch (error) { notify(error.message || "PNG export failed.", "warning"); }
    finally { data.exporting = false; }
  }
  function onAction(name, control) {
    if (!name.startsWith("draw-")) return false;
    if (name === "draw-save") { void savePNG(); return true; }
    releaseDraw("TOOL_CHANGED"); stopStroke(); released = false;
    const value = control?.dataset.value;
    if (name === "draw-tool" && ["brush", "eraser"].includes(value)) data.tool = value;
    else if (name === "draw-size" && Object.hasOwn(SIZES, value)) data.size = value;
    else if (name === "draw-color" && COLORS.includes(value)) { data.color = value; data.tool = "brush"; }
    else if (name === "draw-background" && ["dark", "transparent", "camera"].includes(value)) {
      data.background = value; position = null; showBrush(); renderBackground();
    } else if (name === "draw-undo") {
      const stroke = data.strokes.pop();
      if (stroke) { data.pointCount -= stroke.points.length; replay(); action("AIR DRAW → UNDO"); }
    } else if (name === "draw-clear" && data.strokes.length && confirm("Clear this drawing? This cannot be undone.")) {
      data.strokes.length = 0; data.pointCount = 0; replay(); action("AIR DRAW → CLEAR");
    }
    render(); return true;
  }
  function render() {
    data.status = state.runtime.paused ? "PAUSED" : state.runtime.handUI ? "HAND UI / TOOLS" : data.drawing ? (data.tool === "eraser" ? "ERASING" : "DRAWING")
      : data.tool === "eraser" ? "ERASER" : "READY TO DRAW";
    ui.setText("draw-status", data.status);
    ui.setText("draw-stroke-count", data.strokes.length + " strokes");
    ui.element("draw-undo").disabled = !data.strokes.length;
    ui.element("draw-save").disabled = data.exporting;
    ui.element("draw-include-camera").disabled = data.background !== "camera";
    for (const button of ui.element("draw-tools").querySelectorAll("[data-value]")) {
      const property = button.dataset.action.replace("draw-", "");
      button.setAttribute("aria-pressed", String(data[property] === button.dataset.value));
    }
  }
  return {
    enter() { cancel(); renderBackground(); render(); }, exit: cancel, cancel, preview, beginPointer, movePointer, endPointer, onGesture, onAction, render,
    tick(now) {
      const frame = state.camera.active ? video.currentTime : null;
      const reduced = state.settings.visualEffects === "reduced" ||
        (state.settings.autoPerformanceMode && state.performance.effectsReduced);
      if (data.background === "camera" && frame !== lastVideoFrame && now - lastBackgroundAt >= 1000 / (reduced ? 8 : 20)) {
        const started = performance.now(); renderBackground();
        recordPerformance?.("background", performance.now() - started); lastBackgroundAt = now; lastVideoFrame = frame;
      }
    }
  };
}
