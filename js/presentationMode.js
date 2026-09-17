export function createPresentationMode({ state, ui, action, notify, pause, activate, manualAllowed }) {
  const stage = ui.element("presentation-stage");
  const slides = [...stage.querySelectorAll("[data-slide]")];
  if (slides.length !== 8) throw new Error("Presentation requires exactly eight built-in slides.");
  const data = state.runtime.modeData.presentation = {
    status: "READY TO PRESENT", started: false, slideIndex: 0, slideCount: slides.length
  };
  let lastEvent = null, feedbackUntil = 0, lastSlide = -1;

  function feedback(message, now = performance.now()) {
    data.status = message; feedbackUntil = now + 1000;
    action(message); ui.announce(message);
  }
  function cancel() { /* Pointer/capture ownership is released by InteractionEngine. */ }
  function start() {
    if (state.runtime.paused) pause(false);
    data.started = true; feedback("PRESENTATION STARTED"); render();
  }
  function navigate(direction, now) {
    if (state.runtime.paused) return;
    const next = Math.max(0, Math.min(slides.length - 1, data.slideIndex + direction));
    if (next === data.slideIndex) {
      notify(direction > 0 ? "You are on the final slide." : "You are on the first slide."); return;
    }
    data.started = true; data.slideIndex = next;
    feedback(direction > 0 ? "NEXT SLIDE" : "PREVIOUS SLIDE", now); render();
  }
  // Only the central arbiter may route these gesture actions. It owns the
  // horizontal-intent capture and per-hand laser; this mode only changes slides.
  function onGesture(event) {
    const key = event.handId + ":" + event.at + ":" + event.gesture;
    if (key === lastEvent) return; lastEvent = key;
    if (event.gesture === "THUMBS_UP") {
      if (!data.started) start(); else feedback("PRESENTATION CONFIRMED", event.at);
    } else if (event.kind === "swipe" && data.started) {
      if (event.gesture === "SWIPE_RIGHT") navigate(1, event.at);
      else if (event.gesture === "SWIPE_LEFT") navigate(-1, event.at);
    }
  }
  function onAction(name) {
    if (name === "start" || name === "presentation-start") { start(); return true; }
    if (name === "presentation-next" || name === "presentation-previous") {
      if (!manualAllowed()) { notify("Resume the presentation before navigating."); return true; }
      navigate(name === "presentation-next" ? 1 : -1, performance.now()); return true;
    }
    return false;
  }
  function onKey(event) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return false;
    if (manualAllowed()) navigate(event.key === "ArrowRight" ? 1 : -1, performance.now());
    return true;
  }
  function render() {
    if (state.runtime.paused) data.status = "PAUSED";
    if (lastSlide !== data.slideIndex) {
      slides.forEach((slide, index) => { slide.hidden = index !== data.slideIndex; });
      lastSlide = data.slideIndex;
    }
    ui.setText("presentation-counter", "SLIDE " + (data.slideIndex + 1) + " / " + slides.length);
    ui.setText("presentation-status", data.status);
    ui.setText("presentation-start", state.runtime.paused ? "Resume presentation" : data.started ? "Confirm presentation" : "Start presentation");
    ui.element("presentation-previous").disabled = data.slideIndex === 0;
    ui.element("presentation-next").disabled = data.slideIndex === slides.length - 1;
  }
  return {
    enter() { cancel(); render(); }, exit: cancel, cancel, onGesture, onAction, onKey, render,
    tick(now) { if (!state.runtime.paused && now >= feedbackUntil) data.status = data.started ? "PRESENTING" : "READY TO PRESENT"; },
    pauseChanged(paused) { data.status = paused ? "PAUSED" : data.started ? "PRESENTING" : "READY TO PRESENT"; }
  };
}
