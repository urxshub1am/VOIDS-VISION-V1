const BASIC = Object.freeze(["FIST", "THUMBS_UP", "OPEN_PALM", "PINCH"]);
const ADVANCED = Object.freeze([...BASIC, "SWIPE_LEFT", "SWIPE_RIGHT"]);
const ROUND_COUNT = 12;
const HIGH_SCORE_PREFIX = "voids-vision.challenge.v1.";

// This mode scores shared-engine confirmations. It contains no recognition rules.
export function createGameMode({ state, ui, action, notify, manualAllowed, primaryAvailable, resetInput }) {
  const data = state.runtime.modeData.challenge = {
    status: "READY", input: "gestures", running: false, prompt: null, round: 0,
    score: 0, correct: 0, wrong: 0, timeouts: 0, streak: 0, bestStreak: 0,
    windowMs: 3000, elapsedMs: 0, remainingMs: 3000, roundStartedAt: 0,
    responses: [], rounds: [], highScore: null, result: null, feedback: "Choose an input and start."
  };
  let lastTickAt = null, lastEvent = null, lastInput = null;
  const answerButtons = [...ui.element("challenge-answers").querySelectorAll("[data-answer]")];

  function loadHighScore(input) {
    try {
      const saved = localStorage.getItem(HIGH_SCORE_PREFIX + input);
      if (saved === null) return 0;
      const value = Number(saved);
      return Number.isInteger(value) && value >= 0 && value <= 100000 ? value : 0;
    } catch { return null; }
  }
  function saveHighScore() {
    const previous = loadHighScore(data.input);
    if (previous === null) return;
    data.highScore = Math.max(previous, data.score);
    try { localStorage.setItem(HIGH_SCORE_PREFIX + data.input, String(data.highScore)); }
    catch { data.highScore = null; }
  }
  function nextPrompt(now) {
    const pool = data.correct >= 6 ? ADVANCED : BASIC;
    const choices = pool.filter((gesture) => gesture !== data.prompt);
    data.prompt = choices[Math.floor(Math.random() * choices.length)];
    data.round += 1;
    data.windowMs = Math.max(1600, 3000 - Math.floor(data.correct / 3) * 250);
    data.elapsedMs = 0; data.remainingMs = data.windowMs; data.roundStartedAt = now;
    lastTickAt = now;
    ui.announce("Round " + data.round + ". " + data.prompt.replaceAll("_", " "));
  }
  function start() {
    if (data.running) return;
    const input = ui.element("challenge-input").value;
    if (!["gestures", "buttons"].includes(input)) return;
    if (!manualAllowed()) { notify("Resume the interface before starting Challenge."); return; }
    if (input === "gestures" && !primaryAvailable()) {
      notify("Start the camera and enable gesture input, or choose Buttons / keyboard practice."); return;
    }
    resetInput();
    Object.assign(data, { input, running: true, status: "MATCH THE PROMPT", prompt: null,
      round: 0, score: 0, correct: 0, wrong: 0, timeouts: 0, streak: 0, bestStreak: 0,
      responses: [], rounds: [], result: null, highScore: loadHighScore(input), feedback: "Hold the requested gesture." });
    lastEvent = null;
    nextPrompt(performance.now());
    action("CHALLENGE START · " + (input === "gestures" ? "GESTURES" : "BUTTON PRACTICE")); render();
  }
  function finish(completed) {
    data.running = false;
    const total = data.correct + data.wrong + data.timeouts;
    data.result = {
      completed, totalScore: data.score,
      accuracy: total ? data.correct / total : null,
      averageResponseMs: data.responses.length ? data.responses.reduce((sum, value) => sum + value, 0) / data.responses.length : null,
      bestStreak: data.bestStreak, correct: data.correct, total,
      completedRounds: data.rounds.length, input: data.input
    };
    data.status = completed ? "SESSION COMPLETE" : "SESSION ENDED";
    if (completed) saveHighScore();
    action(completed ? "CHALLENGE COMPLETE" : "CHALLENGE ENDED"); render();
  }
  function finishRound(correct, now) {
    data.rounds.push({ gesture: data.prompt, correct, responseMs: correct ? data.elapsedMs : null });
    if (data.round >= ROUND_COUNT) { finish(true); return; }
    nextPrompt(now);
  }
  function blocked() {
    return !manualAllowed() || (data.input === "gestures" && !primaryAvailable());
  }
  function tick(now) {
    const elapsed = lastTickAt === null ? 0 : Math.max(0, now - lastTickAt);
    lastTickAt = now;
    if (!data.running) return;
    if (blocked()) {
      data.status = state.runtime.paused ? "PAUSED" : data.input === "gestures" && !primaryAvailable()
        ? "WAITING FOR HAND / GESTURE INPUT" : "PAUSED FOR DIALOG";
      return;
    }
    data.status = "MATCH THE PROMPT";
    // A hidden tab or a long browser stall must not consume the response window.
    if (elapsed > 200) return;
    data.elapsedMs += elapsed;
    data.remainingMs = Math.max(0, data.windowMs - data.elapsedMs);
    if (data.remainingMs === 0) {
      data.timeouts += 1; data.streak = 0; data.feedback = "TIMEOUT · streak reset";
      action("CHALLENGE TIMEOUT"); finishRound(false, now);
    }
  }
  function answer(gesture, now) {
    if (!data.running || blocked()) return;
    const round = data.round;
    tick(now);
    if (!data.running || data.round !== round || now <= data.roundStartedAt) return;
    if (gesture !== data.prompt) {
      data.wrong += 1;
      data.feedback = "Observed " + gesture.replaceAll("_", " ") + ". Keep trying this prompt.";
      action("CHALLENGE WRONG · " + gesture); return;
    }
    data.correct += 1; data.streak += 1; data.bestStreak = Math.max(data.bestStreak, data.streak);
    const speedBonus = Math.round(50 * Math.max(0, 1 - data.elapsedMs / data.windowMs));
    const comboBonus = 10 * Math.min(data.streak, 10);
    const points = 100 + speedBonus + comboBonus;
    data.score += points; data.responses.push(data.elapsedMs);
    data.feedback = "CORRECT · +" + points + " (100 + " + speedBonus + " speed + " + comboBonus + " streak)";
    action("CHALLENGE CORRECT · " + gesture);
    finishRound(true, now); render();
  }
  function onGesture(event) {
    if (data.input !== "gestures" || !event.handId) return;
    const key = event.handId + ":" + event.at + ":" + event.gesture;
    if (key === lastEvent) return;
    lastEvent = key; answer(event.gesture, event.at);
  }
  function render() {
    if (!data.running) {
      const selected = ui.element("challenge-input").value;
      if (["gestures", "buttons"].includes(selected)) data.input = selected;
    }
    if (lastInput !== data.input) { lastInput = data.input; data.highScore = loadHighScore(data.input); }
    const total = data.correct + data.wrong + data.timeouts;
    ui.setText("challenge-status", data.status);
    ui.setText("challenge-prompt", data.prompt?.replaceAll("_", " ") || "READY?");
    ui.setText("challenge-round", data.round + " / " + ROUND_COUNT);
    ui.setText("challenge-timer", data.running ? (data.remainingMs / 1000).toFixed(1) + " s" : "--");
    ui.setText("challenge-score", data.score); ui.setText("challenge-streak", data.streak);
    ui.setText("challenge-accuracy", total ? Math.round(data.correct / total * 100) + "%" : "--");
    ui.setText("challenge-feedback", data.feedback);
    ui.element("challenge-progress").style.width = (data.running ? data.remainingMs / data.windowMs * 100 : 0) + "%";
    ui.element("challenge-input").disabled = data.running;
    ui.element("challenge-start").disabled = data.running;
    ui.element("challenge-stop").disabled = !data.running;
    ui.element("challenge-answers").hidden = data.input !== "buttons";
    const pool = data.correct >= 6 ? ADVANCED : BASIC;
    answerButtons.forEach((button) => {
      button.hidden = !pool.includes(button.dataset.answer);
      button.disabled = !data.running || !manualAllowed();
    });
    ui.setText("challenge-high-score", data.highScore === null ? "UNAVAILABLE" : data.highScore);
    ui.element("challenge-results").hidden = !data.result;
    if (data.result) {
      const result = data.result;
      ui.setText("result-score", result.totalScore);
      ui.setText("result-accuracy", result.accuracy === null ? "--" : Math.round(result.accuracy * 100) + "%");
      ui.setText("result-response", result.averageResponseMs === null ? "--" : Math.round(result.averageResponseMs) + " ms");
      ui.setText("result-streak", result.bestStreak);
      ui.setText("result-correct", result.correct + " / " + result.total);
      ui.setText("result-rounds", result.completedRounds + " / " + ROUND_COUNT);
      ui.setText("result-input", result.input === "gestures" ? "Arbitrated hand gestures" : "Buttons / keyboard practice");
    }
  }
  function cancel() { lastTickAt = null; }
  return {
    enter() { cancel(); render(); }, exit() { if (data.running) finish(false); cancel(); },
    cancel, suspend: cancel, pauseChanged: cancel, tick, render, onGesture,
    onAction(name, control) {
      if (name === "start" || name === "challenge-start") { start(); return true; }
      if (name === "challenge-stop") { if (data.running) finish(false); return true; }
      if (name === "challenge-answer" && data.input === "buttons" && ADVANCED.includes(control?.dataset.answer)) {
        answer(control.dataset.answer, performance.now()); render(); return true;
      }
      return false;
    },
    onKey(event) {
      if (data.input !== "buttons" || !data.running || !/^[1-6]$/.test(event.key)) return false;
      const pool = data.correct >= 6 ? ADVANCED : BASIC;
      const gesture = pool[Number(event.key) - 1];
      if (gesture) { answer(gesture, performance.now()); render(); }
      return true;
    },
    onChange() { render(); }
  };
}
