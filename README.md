# VOIDS VISION — AI Gesture Control System

**Control Without Touch.**

[Live Demo](https://urxshub1am.github.io/VOIDS-VISION-V1/) · [Report an Issue](https://github.com/urxshub1am/VOIDS-VISION-V1/issues)

VOIDS VISION is a browser-based hand-tracking and gesture-interaction workspace built with Vanilla JavaScript, MediaPipe Tasks Vision, Canvas/SVG, and a lightweight hybrid Three.js/WebGL holographic layer. Camera frames are processed on-device in the browser; the application does not upload webcam frames.

## Final V1 capabilities

- Up to two tracked hands with persistent hand IDs and independent pointers.
- Precision pointer pipeline with adaptive / One Euro filtering, target hysteresis, capture ownership, and low-FPS safeguards.
- Pinch-to-select and pinch-drag scrolling with click-vs-scroll intent separation.
- Pinch Sensor V2 uses image-plane fingertip contact plus hysteresis so UI pinch/release feedback stays consistent even when webcam depth estimates become noisy near frame edges.
- Home/HUD with live tracking, FPS, latency, hand/finger state, readiness, and event telemetry.
- Pointer Control Mode for operating the VOIDS VISION interface.
- Air Draw with smoothed strokes, eraser, undo, clear, colors/brush sizes, and PNG export with optional camera background.
- Presentation Mode with open-palm horizontal swipes, laser pointer, pinch UI control, keyboard fallback, and 8 built-in slides.
- Gesture Lab with per-hand diagnostics, confidence/stability, precision state, swipe diagnostics, and runtime profiling.
- Challenge Mode with prompts, scoring, streak, accuracy, response time, and keyboard/button fallback.
- Spatial/Holo workspace with 22 retained 2D diagram tools plus 3D holographic objects.
- 3D holograms: Cube, Orb/Core, Ring, Pyramid, Wireframe Globe, and Floating Panel Stack.
- Two-hand Anchor/Manipulator interaction for move, scale, and rotation while preserving one logical Undo transaction.
- Workspace Save/Load JSON, PNG export, and 2D SVG export.
- Performance/Balanced/Visual profiles, 3D quality settings, automatic reduced-effects protection, System Check, and validated persistent settings.
- Mouse and keyboard fallback throughout the application.

## Requirements

- Latest Google Chrome or Microsoft Edge.
- Webcam access.
- Serve through `localhost` during development or HTTPS when hosted. Do not open with `file://`.
- Internet access is required in this build for the pinned MediaPipe runtime/model and lazy-loaded Three.js module.

## Run locally

1. Open this folder in VS Code.
2. Start **Live Server** on `index.html`, or run another local HTTP server.
3. Open the localhost URL in Chrome/Edge.
4. Allow camera access.
5. Start with the **Balanced** performance profile. Use **Performance** on weaker hardware.
6. Use even front/side lighting for the most stable webcam frame delivery and gesture tracking.

A simple alternative local server is:

```bash
python -m http.server 5500
```

Then open `http://127.0.0.1:5500/`.

## Core gestures

| Gesture | Main use |
| --- | --- |
| Index only | Aim / pointer / presentation laser |
| Thumb + index pinch | Select, confirm, grab, or begin drawing |
| Pinch + vertical drag | Scroll an internal panel |
| Fist | Pause/freeze where supported |
| Two fingers | Air Draw tool-selection state |
| Thumbs up | Start/confirm in Presentation |
| Open palm + horizontal swipe | Previous/next slide |

Both hands are first-class inputs. In Spatial/Holo, whichever hand grabs an object first becomes the **Anchor** for that interaction; the other hand may join as the **Manipulator**.

## Spatial/Holo save and export

- **Save project** downloads a versioned `.json` workspace containing retained 2D and 3D objects plus view state.
- **Load project** validates and restores a saved workspace, then resets Undo/Redo for the loaded document.
- **Export PNG** exports the visible workspace composition; the camera is included only when camera background is enabled.
- **Export SVG** exports the editable 2D diagram layer.

Chromium may require a real mouse/keyboard user activation to open the native file chooser for **Load project**. This is a browser security boundary.

## Architecture

```text
Webcam
  ↓
MediaPipe Hand Landmarker
  ↓
Persistent hand association (0–2 hands)
  ↓
Gesture Engine + Precision Pointer Pipeline
  ↓
Interaction Arbiter / Capture Ownership
  ↓
Active Mode Controller
  ↓
Action + UI / Canvas / SVG / WebGL Feedback
```

Key modules:

```text
index.html
css/style.css
js/app.js
js/camera.js
js/handTracker.js
js/gestureEngine.js
js/precision.js
js/interactionEngine.js
js/pointerMode.js
js/airDrawMode.js
js/presentationMode.js
js/gestureLab.js
js/gameMode.js
js/spatialMode.js
js/spatialModel.js
js/spatial3D.js
js/spatial3DModel.js
js/spatialPersistence.js
js/systemPreferences.js
js/ui.js
```

## Performance notes

The app requests a performance-friendly webcam stream and targets up to two hands. Actual camera delivery and inference FPS depend heavily on lighting, webcam exposure, browser, and laptop hardware. MediaPipe `detectForVideo()` runs synchronously in this V1 architecture, so slow inference can reduce visual responsiveness.

Automatic reduced-effects protection may lower trails, glow, background refresh, hologram render cadence, and WebGL pixel ratio when sustained FPS is low. It does **not** intentionally weaken gesture correctness or disable the second hand.

Three.js `0.170.0` is lazy-loaded only when Spatial/Holo needs the WebGL backend. If WebGL/Three.js is unavailable, a projected Canvas fallback keeps the 3D workspace usable.

## Privacy

- Webcam frames are processed locally in the browser.
- VOIDS VISION does not upload or record camera frames.
- Air Draw and workspace exports occur only after explicit user action.
- Settings and high scores are stored locally in browser storage.
- MediaPipe/Three.js/model files are downloaded from their configured external hosts in this CDN build.

## Testing

The release is intended to be validated in a real Chrome/Edge + webcam environment. See [`docs/TESTING.md`](docs/TESTING.md) for the final browser acceptance checklist.

## Deployment

VOIDS VISION is a static site. It can be hosted on GitHub Pages, Vercel, or Netlify. Production hosting must use HTTPS for camera access. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Known V1 limitations

- Tracking quality depends on webcam quality and lighting; it is not headset-class eye/depth tracking.
- Current inference runs on the browser main thread; a future V2 may move inference to a Web Worker.
- 3D depth is deliberately constrained rather than inferred aggressively from a single webcam.
- Native browser file pickers/fullscreen/camera permission prompts may require normal user activation.
- Chrome and Edge are the primary V1 targets.
- Actual Windows mouse control, desktop PowerPoint control, system media/volume control, app launching, voice commands, cloud sync, and AI-generated diagrams are deferred to V2.

## Demo flow

A reliable 3–5 minute demo sequence:

1. Startup / Home telemetry.
2. Pointer aim + pinch selection.
3. Air Draw and PNG export.
4. Presentation swipe + laser pointer.
5. Spatial 2D placement.
6. 3D Holo Cube with Anchor/Manipulator scale/rotation.
7. Gesture Lab diagnostics.
8. Quick Challenge round.
9. Return Home and show System Check / privacy note.

## Author

**Shubham Jaiswar**  
GitHub: [@urxshub1am](https://github.com/urxshub1am)

---

**VOIDS VISION — Control Without Touch.**
