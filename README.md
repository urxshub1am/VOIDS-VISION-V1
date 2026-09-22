# VOIDS VISION
## V1.5.4 — Adaptive Motion Smoothing

V1.5.4 is a smoothness-focused patch built from V1.5.3. It keeps the runtime crash/fallback fixes and makes low-FPS pointing feel less sticky: the pointer now stabilizes fingertip aim against the palm, freezes the learned fingertip offset while pinching so finger curl does not kick the cursor, and visually resamples sparse webcam updates between inference frames. Spatial 3D also avoids expensive full-scene/material work when only the pointer moves, while active hand transforms receive lightweight display interpolation.

### What changed in V1.5.4

- **Palm-relative aim stabilization:** quiet fingertip wobble is blended against a steadier palm-center reference, especially in High Precision and low-FPS conditions.
- **Pinch-safe aim:** entering a pinch/capture freezes the learned fingertip-to-palm offset, reducing the common cursor jump caused by the index finger folding toward the thumb. Release uses a short recovery window before the offset is learned again.
- **Less sticky High Precision:** the low-FPS deadzone and quiet-motion damping were reduced while deliberate-motion gain was raised slightly, so stable aim should no longer feel like stop-then-jump movement.
- **Low-FPS visual resampling:** the rendered cursor catches up smoothly between sparse MediaPipe samples while staying tightly bounded to the real filtered target; active pinch/capture collapses this visual lag for accuracy.
- **Visible aim = hover aim:** normal UI and Spatial hover now follow the rendered pointer position, reducing mismatch between what the user sees and what highlights.
- **Cheaper Spatial 3D pointer path:** moving over empty space no longer forces a full WebGL scene redraw. Material styling is cached, selection bounds are throttled, and imported-model materials are not retraversed on every aim update.
- **Smoother hand transforms:** active 3D hand transforms use display-only interpolation between inference samples. Mouse/keyboard edits stay direct and the saved model state remains exact.
- **Adaptive decorative load:** idle hologram effects and imported animation pause sooner when tracking FPS is weak, leaving more time for MediaPipe; with healthy tracking, imported animation is allowed to keep rendering.
- **V1.5.3 preserved:** SVG-safe activation, surface click isolation, selective WebGL fallback and self-healing Spatial tool palette remain intact.

### V1.5.4 quick runtime check

1. At roughly 7–15 tracking FPS, hold the index finger still and compare micro-jitter versus deliberate left/right travel. Aim should be calmer without feeling stuck.
2. Pinch and release 10–15 times. The cursor should not kick sideways when the index finger folds into the pinch.
3. Move across normal buttons and Spatial objects: the highlighted target should stay aligned with the visible cursor.
4. Move the pointer over empty Spatial space for 20–30 seconds. Tracking should remain responsive and the 3D workspace should not become heavy just from aim movement.
5. Re-test V1.5.3 regression paths: SVG objects, tool palette recovery, WebGL staying active after ordinary input errors, free-space Manipulator, Undo/Redo and imported GLB.

## V1.5.3 — Runtime Recovery & Aim Stability

V1.5.3 is a focused runtime patch built from V1.5.2 after real Chrome testing. It fixes a Spatial SVG activation crash, stops unrelated input/UI faults from incorrectly demoting a healthy WebGL scene to Canvas fallback, restores the Spatial tool library if its DOM is ever cleared during recovery, and adds low-FPS adaptive stabilization to High Precision aiming without changing Air Draw capture behavior.

- **Spatial SVG click crash fixed:** a released Spatial/Air Draw surface pinch can no longer leak into the ordinary DOM-click path. Gesture activation also safely dispatches a click for non-HTMLElement targets instead of assuming every target implements `.click()`.
- **Selective 3D recovery:** generic input/UI errors cancel the active capture and keep the healthy WebGL backend. Canvas fallback is now reserved for faults whose stack actually originates in the 3D/WebGL renderer.
- **Tool library self-heal:** the Shape / Hologram Library rebuilds idempotently if its tool nodes are ever lost during a recovery path, and its inner scroller uses overscroll containment.
- **Low-FPS aim stabilization:** at roughly 7–15 tracking FPS, pointer filtering increases only the quiet-motion deadzone and reduces slow response gain. Deliberate travel still becomes responsive through the existing speed-adaptive filter. Air Draw uses its original drawing tuning.
- **V1.5.2 preserved:** H1/H2 continuity, adaptive pinch/reacquisition, freeze→rebase→resume, free-space second-hand control, transform slew limits, workspace persistence, import limits and memory safeguards remain intact.

### V1.5.3 quick runtime check
1. Open Spatial/Holo and aim at buttons/objects for 20–30 seconds with High Precision ON. The aim ring should be calmer at 10–15 FPS without feeling stuck during deliberate travel.
2. Pinch/release over 2D SVG objects and handles several times. DevTools should not show `target.click is not a function`.
3. Confirm a normal input/gesture mistake does not print `Spatial 3D switched to Canvas fallback` unless there is an actual WebGL/renderer fault.
4. Confirm the Shape / Hologram Library remains populated after rapid Spatial interactions and after any recovered input fault.
5. Re-test V1.5.2 critical paths: free-space Manipulator, AUTO SCALE/ROTATE, short occlusion recovery, Undo/Redo and imported GLB.

## V1.5.2 — Tracking & Gesture Reliability

V1.5.2 builds directly on V1.5.1 and keeps its free-space second-hand control while hardening the real webcam path for low FPS, temporary occlusion and hand overlap. This is a reliability release, not a feature expansion: hand IDs are preserved through ambiguous frames, pinch confirmation adapts to measured sample rate without accepting single-frame critical grabs, 3D control freezes and rebases after short tracking gaps instead of jumping, and quiet palm/transform jitter is filtered more aggressively while deliberate motion remains responsive.

- **Stable H1/H2 identity through overlap:** ambiguous two-hand assignments now preserve the best existing one-to-one IDs and pause actions rather than inventing new IDs. A weak palm-size signature assists position/velocity/handedness matching when hands cross.
- **Adaptive low-FPS reacquisition:** tracking confirmation, lost timing and retained identity windows adapt to measured inference FPS. At ~7–12 FPS, two clean samples can reacquire faster while missing hands are retained longer for continuity.
- **Adaptive critical pinch timing:** held pinch still requires at least two physical samples, but the time requirement scales down on slow cameras so a valid 7–10 FPS grab does not need an unnecessary third frame. Pinch state also bridges one expected missed low-FPS sample within a bounded grace.
- **Freeze → rebase → resume:** short Anchor/Manipulator dropouts freeze 3D motion. When tracking returns, the current object and palm positions become a fresh baseline before movement resumes, preventing teleport, scale spikes and rotation jumps.
- **Palm-center smoothing:** free-space 3D control uses an adaptive palm filter that damps quiet jitter but reduces smoothing during deliberate motion.
- **Bounded transform slew:** scale/yaw/pitch/roll changes use adaptive filtering plus per-second change limits, so one bad landmark sample cannot create a huge transform jump.
- **Cleaner AUTO intent lock:** AUTO now requires stronger radial-vs-tangential dominance; the motion used to choose SCALE/ROTATE only chooses intent, then the transform baseline re-centers before applying movement.
- **Faster low-FPS protection:** automatic reduced-effects protection engages sooner at very low inference FPS. Spatial 3D can drop to ~6 FPS rendering and lower DPR below 10 tracking FPS to prioritize MediaPipe inference.
- **Diagnostics:** Spatial HUD exposes tracking recovery/resume states so `REACQUIRING`, fresh-baseline resume and transform state are visible instead of looking like a silent freeze.

### V1.5.2 reliability test flow
1. Run Spatial/Holo with one 3D object and note the tracking FPS.
2. Anchor the object, briefly move the hand partly out of frame, then return while still pinching. The object should freeze during the gap and resume without jumping.
3. Add the free-space Manipulator, briefly occlude/cross the hands, then separate them. H1/H2 should remain stable and the transform should resume from a fresh baseline.
4. In AUTO, deliberately choose SCALE or ROTATE. The intent-lock frame itself should not suddenly resize/rotate the object.
5. At low FPS, verify a held pinch engages after two clean samples and still releases normally when the fingers open.
6. Repeat with forced SCALE / ROTATE / FREE, Snap ON/OFF, Undo/Redo and an imported GLB.

## V1.5.1 — Free-Space Spatial Control

V1.5.1 builds directly on V1.5 and fixes the practical two-hand 3D control problem seen in real webcam testing: the second hand no longer depends on pointing at or hovering the selected object. After the first hand anchors a 3D object, the other hand can pinch anywhere in camera view and becomes a free-space Scale/Rotate controller. Palm-center control and a short low-FPS tracking grace reduce fingertip jitter and transform dropouts. All V1.4.1 hardening and V1.5 Transform Assist modes remain in place.

- **3D Transform Assist:** choose `AUTO`, `SCALE`, `ROTATE`, or `FREE`. AUTO observes the beginning of each Manipulator pinch and locks that pinch session to Scale or Rotate only after deliberate motion. Release/re-pinch to choose a new intent.
- **Reduced transform cross-talk:** AUTO uses radial-versus-tangential secondary-hand motion with temporal confirmation, so small jitter does not immediately resize and rotate on multiple axes.
- **True dual-hand translation:** the Anchor can continue moving the selected 3D object in X/Y after the Manipulator joins. V1.4 displayed MOVE + SCALE + ROTATE but internally froze Anchor translation during the dual-hand phase.
- **3D sensitivity integration:** the existing Low / Medium / High Spatial Transform Sensitivity preference now affects 3D scale and rotation as well as the 2D two-hand engine.
- **Snap-aware scale:** when Spatial Snap is ON, gesture scale also lands on 0.1 increments while rotation remains on 15° steps.
- **Live intent HUD:** Spatial feedback and diagnostics show `WAITING`, `SCALE`, `ROTATE`, or `FREE`, with Anchor/Manipulator labels over the 3D gesture link.
- **Compatibility:** `FREE` preserves the simultaneous V1.4-style scale + yaw + pitch + roll behavior. Mouse/keyboard/precise-transform controls are unchanged. Workspace schema remains v3.

### V1.5.1 two-hand 3D flow
1. Grab a visible unlocked 3D object with either hand; that hand becomes **Anchor**.
2. Keep the second hand comfortably separated and pinch to join as **Manipulator**.
3. In **AUTO**, move the Manipulator deliberately: radial motion chooses **SCALE**; arc/tangential motion chooses **ROTATE**.
4. The intent stays locked for that Manipulator pinch. Release only the Manipulator to choose again while the Anchor keeps holding.
5. Move both hands together to translate naturally; release the Anchor to commit one Undo/Redo edit.

## V1.4.1 — Stability & Memory Hardening

V1.4.1 is a feature-freeze stability pass built directly on V1.4. It keeps Spatial Workspace Pro intact while hardening memory use, Save/Load, model import, animation, PNG capture, hidden/locked-object behavior, and transient loader failures.

- **Reset Transform correctness:** native 3D shapes restore their intended default orientation (for example Ring +18° X and Pyramid −18° Y) instead of flattening every rotation to 0°.
- **Bounded Undo/Redo model memory:** deleted imported-model payloads remain available only while useful history is retained, with an orphan-history budget of 48 MB / 4 model assets. Under heavy model editing the oldest undo or farthest redo entries may be pruned rather than letting browser memory grow without bound.
- **Lightweight image-history snapshots:** large image-hologram Base64 strings are shared as immutable payloads instead of being repeatedly deep-cloned/stringified during normal rename/transform edits.
- **Portable project guard:** Save/Load estimates embedded project size before expensive serialization. A warning starts at 32 MB and portable workspace JSON is capped at 64 MB. Project JSON is written compactly to reduce memory/size overhead.
- **Safer imports:** the existing 14 MB per model-selection limit and 12 distinct live imported-model asset limit remain enforced; projected workspace size is checked before image/model import. Unsupported Draco/Meshopt/BasisU-compressed glTF files are rejected with a clear message instead of falling into a loader failure.
- **Animation safety:** imported models auto-play one valid animation clip instead of starting several clips simultaneously.
- **PNG/WebGL reliability:** the live WebGL layer is copied immediately into a 2D snapshot for export, reducing blank/missing 3D captures while keeping `preserveDrawingBuffer` disabled during normal rendering.
- **Transient loader recovery:** Three.js/loader imports have a 12-second timeout, and failed imported-model nodes are retried when Spatial is re-entered instead of remaining permanently poisoned after a temporary CDN/network problem.
- **Hidden-object safety:** hidden selected objects cannot be moved by precise/keyboard/gesture transforms and no longer participate in visible aim/selection overlays.
- **Drop safety:** dropping a supported model outside the intended Holo/drop-zone area is intercepted so the browser does not navigate to the local file and destroy an unsaved workspace.
- **Backward compatibility:** workspace schema stays v3; schema-v1 and schema-v2 projects remain supported.

## V1.4 — Spatial Workspace Pro

V1.4 builds forward from V1.3.4 and turns the Spatial/Holo 3D layer into a more usable mini scene editor without replacing the stable gesture core. Existing Anchor/Manipulator gestures, real-model import, Save/Load, Undo/Redo, 2D tools, and performance safeguards remain intact.

- **Scene Objects panel:** every 3D hologram/model can be selected from a persistent list, including hidden objects.
- **Rename + metadata:** 3D objects have editable display names. Imported source metadata stays separate from the scene name.
- **Visibility + lock:** hide/show an object or lock it against move/rotate/scale/delete while still allowing selection and inspection.
- **Precise transforms:** step X/Y/Z position, rotate each axis in 15° increments, and adjust uniform scale. Every change is one Undo/Redo-safe edit.
- **Keyboard 3D controls:** arrows move X/Y, Page Up/Down moves Z, `[` / `]` rotate Y, `-` / `+` scale, `F` focuses the selected 3D object, and `L` toggles lock. Hold Shift for larger movement steps.
- **3D camera focus:** focus the 3D camera on the selected object or return it to scene center. Canvas fallback uses the same focus transform.
- **Scene/geometry telemetry:** visible/locked counts plus cached mesh/triangle statistics when WebGL geometry is available. Imported-model geometry stats update after the real mesh finishes loading.
- **Workspace schema v3:** object name and lock state persist in project JSON. Schema-v1/v2 workspaces from older VOIDS VISION builds remain loadable.

## V1.3.4 — Import & Asset Hardening

V1.3.4 builds forward from V1.3.3 without changing the gesture core or the existing Spatial/Holo manipulation model. It closes reliability gaps around imported-model capacity, memory retention, drag/drop state, loader feedback, and destructive gesture controls.

- Import and reload now share the same **12 distinct imported-model asset** limit, so the app cannot create a workspace that later rejects its own saved project.
- Embedded 3D asset data is retained only while reachable from the live workspace or Undo/Redo history, reducing memory retention after large model edits.
- Only one model import is prepared at a time; drag/drop highlight state is reset more defensively.
- Imported-model loader failures now surface in the UI, and the selected model status shows asset usage.
- Native file-picker activation is explicitly mouse/keyboard-only; gesture users get a clear drag/drop fallback message.
- Delete/replace/reset controls are treated as critical interactions so the low-FPS fast-pinch shortcut cannot trigger them.

## V1.3.3 — Model Picker Reliability + Drag/Drop Import

V1.3.3 builds forward from V1.3.2 and fixes a Windows/Chromium picker issue found in runtime testing. The hidden file input explicitly advertises all supported root model extensions plus GLTF companion types, and Spatial/Holo adds a visible drag/drop fallback that bypasses native picker filtering entirely. Drop a GLB/OBJ/STL/FBX directly, or drop a GLTF together with its BIN/textures. Existing free-space two-hand manipulation remains unchanged.


V1.3.2 builds forward from V1.3.1. It keeps the existing gesture, onboarding, Spatial/Holo, Save/Load and real 3D features, while fixing two runtime pain points found during testing.

- **Broader real 3D import:** GLB, GLTF, OBJ, STL and FBX root files are accepted. GLB remains the recommended format. The picker intentionally shows all files so an unsupported extension produces a clear in-app error instead of silently disappearing. GLTF companion BIN/PNG/JPG/WebP files can still be selected together. Imports are capped at 14 MB total; very heavy models should be optimized first.
- **True free-space second-hand join:** once the first hand pinches/grabs a 3D object as Anchor, the second hand no longer has to aim at the object or even stay over the Holo board. Pinch anywhere in the tracked camera view to join as Manipulator; palm-center distance/angle controls scale and rotation. A small physical hand separation is still required because two nearly coincident palms do not provide a stable transform baseline.
- **Save/Load:** imported OBJ/STL/FBX assets use the same portable embedded asset registry as GLB/GLTF, subject to workspace size guards.

# VOIDS VISION
## V1.3.1 — Real 3D Model Import

V1.3.1 builds directly on V1.3 and adds a real glTF 2.0 model path to Spatial / Holo. **Import 3D model** accepts a self-contained `.glb` or a `.gltf` plus its local `.bin` and PNG/JPG/WebP companion files selected together. GLB is the recommended format because it is a single portable file. Imported meshes are normalized into the Holo workspace, remain selectable with the existing raycast/gesture interaction, and support move, depth, two-hand scale/rotate, duplicate/delete, hologram tint, glow and opacity. The first valid animation clip is played automatically when present.

Portable Workspace Save/Load was upgraded to schema v2. Imported model data is stored once in an embedded asset registry and objects reference that asset, so duplicating a model does not duplicate the binary payload in the saved JSON. Older schema-v1 V1.3 workspaces remain loadable. The importer uses a 14 MB total input guard and rejects remote-resource GLTFs or compressed extensions that need extra decoders; export/download a standard uncompressed GLB in those cases. A tiny known-good test asset is included at `assets/test-models/voids-test-tetra.glb` so the import path can be verified before trying larger third-party models. Arbitrary `.json` files are **not** treated as 3D models because JSON may be metadata, animation data, a site-specific scene, or a VOIDS VISION workspace.


## V1.3 — Holo Workspace Expansion

V1.3 builds forward from the runtime-tested V1.2.1 tracking/onboarding build and expands Spatial / Holo without changing the gesture core. The 3D library now includes Cylinder, Diamond, Energy Knot and Signal Beacon in addition to the original Cube, Orb/Core, Ring, Pyramid, Wireframe Globe and Floating Panel Stack. 3D objects gain selectable hologram colors, adjustable glow and opacity, and a restrained star-field ambience that automatically disables itself in reduced/performance modes.

A new **Import image holo** control accepts PNG/JPEG/WebP files, downsizes/compresses them locally, and creates a movable/rotatable/scalable floating textured hologram panel. The embedded image is stored inside Workspace Save/Load JSON (within safe size limits), so imported panels survive project reloads. This is intentionally an image panel, not AI photo-to-3D reconstruction; true image-to-3D remains a V2 feature. The 2D palette also gains additional colors.


## V1.2.1 — Demo Camera + Aim Stability Hotfix

This runtime hotfix builds on V1.2 after real webcam testing. The Demo / Learn screen now uses a camera-first HUD layout with the live preview centered and visible immediately, readiness on the left, and current instructions on the right. Pointer mapping no longer shrinks or drifts its center during automatic observation, High Precision no longer amplifies micro-motion, and the edge acceleration curve is reduced. Pinch contact thresholds are also tightened and edge-assist is bounded so an open thumb/index gap is less likely to remain falsely latched as PINCH. The visual thumb-index connector now follows a stricter current-contact signal. Fast-tap trajectory recovery remains available for ordinary safe UI controls.

## V1.2 — Quick Demo & Learn System

V1.2 builds directly on the stable V1.1.3 Rev2 tracking/release core and adds onboarding without weakening gesture reliability. First-time visitors get an optional welcome panel with **Start Quick Demo** or **Skip**. Completing or skipping is stored locally so the welcome does not repeat on later visits. A permanent **Demo / Learn** mode remains available from the sidebar.

The Learn Center includes:

- A live 6-step Quick Demo driven by real runtime signals: hand tracking, INDEX ONLY aim, pinch + release, open-palm swipe, thumbs-up confirmation, and optional two-hand tracking.
- A no-timer Gesture Practice area using the same production gesture engine; matches are real observed confirmations, not scripted scores.
- A compact one-page visual Gesture Guide.
- Real readiness hints using camera state, tracking state, measured inference FPS/latency, current performance profile, and tracking-quality telemetry.
- Direct links to System Check, Gesture Lab, and Spatial / Holo for deeper testing.

The existing V1/V1.1 feature set is preserved, including V1.1.3 pinch-release responsiveness, dual-hand input, Air Draw, Presentation, Challenge, Spatial/Holo 2D + 3D, Undo/Redo, Save/Load, export, settings, and performance safeguards. Camera processing remains on-device.


## V1.1.3 Rev 2 — cleaner release + easier package

This revision keeps the V1.1.3 fast release assist and adds a conservative two-sample open release path for slower finger opening. A single noisy sample cannot end the hold, but a clearly open thumb/index pair no longer has to wait for the full hysteresis exit threshold. `RELEASE OPEN_SAMPLES` can appear in Gesture Lab when this path is used. The package is also distributed in a single clean project folder with a `START-HERE.txt` file.

## V1.1.3 — Pinch Release Responsiveness

This hotfix keeps V1.1.2 intact while separating **visual pinch contact** from the wider interaction hysteresis latch. The thumb-index connector now disappears as soon as the current sample is no longer physically inside the pinch-enter zone. A bounded opening-velocity release assist also ends held interactions before the wide exit threshold when the fingers are clearly moving apart, improving low-FPS release responsiveness without loosening pinch acquisition. Ordinary UI click release accepts this explicit release evidence; continuous actions still require real held-pinch acquisition. Gesture Lab exposes the release reason/assist state for diagnostics.

## V1.1.2 — Tracking Throughput & Fast Motion
This build preserves the complete V1/V1.1 feature set (including Spatial/Holo 3D and Save/Load) and focuses on fast-motion reliability: fresh-video-frame inference scheduling where supported, more responsive low-FPS pointer filtering, fast hand-ID continuity, a safer predictive quick-pinch path for ordinary UI controls, and a Performance camera preset that can request up to 60 FPS at 480×360 when the webcam supports it.

VOIDS VISION — AI Gesture Control System

**Control Without Touch.**

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
- Spatial/Holo workspace with 22 retained 2D diagram tools, expanded color palette, and 10 placeable 3D hologram tools.
- 3D holograms: Cube, Orb/Core, Ring, Pyramid, Wireframe Globe, Floating Panel Stack, Cylinder, Diamond, Energy Knot, and Signal Beacon.
- 3D appearance controls: hologram color, glow, opacity, subtle performance-aware star ambience, plus imported image hologram panels.
- Local PNG/JPEG/WebP image import as a floating hologram panel with Save/Load persistence (not true image-to-3D conversion).
- Two-hand Anchor/Manipulator interaction for move, scale, and rotation while preserving one logical Undo transaction.
- Spatial Workspace Pro scene management: 3D object list, rename, hide/show, lock/unlock, precise XYZ/rotation/scale steps, focus camera, geometry stats, and keyboard transform fallbacks.
- Workspace Save/Load JSON, PNG export, and 2D SVG export.
- Performance/Balanced/Visual profiles, 3D quality settings, automatic reduced-effects protection, System Check, and validated persistent settings.
- Mouse and keyboard fallback throughout the application.

## Requirements

- Latest Google Chrome or Microsoft Edge.
- Webcam access.
- Serve through `localhost` during development or HTTPS when hosted. Do not open with `file://`.
- Internet access is required in this build for the pinned MediaPipe runtime/model and lazy-loaded Three.js module.
- **Fast-pinch tap path:** on low-FPS webcams, a quick close/reopen can activate ordinary non-destructive UI controls when the motion trajectory is unambiguous; drawing, object grabs, transforms, and destructive controls still require a real sampled held pinch.


## V1.1.2 tracking verification

- **Fresh-frame scheduling:** Chrome/Edge use `requestVideoFrameCallback()` for inference scheduling when available, with an RAF fallback. Inference still caps around 30 calls/s and never queues overlapping detections.
- **Performance preset:** requests 480×360 and up to 60 source FPS when the webcam supports it; actual negotiated FPS remains visible in diagnostics and may be lower in dim lighting.
- **Fast hand motion:** hand association predicts a short bounded palm trajectory so a fast 10–15 FPS movement is less likely to receive a new H1/H2 identity. High Precision also boosts responsiveness only during deliberate fast travel.
- **Fast UI pinch taps:** a strong close→reopen impulse may recover an ordinary safe UI click even when the camera misses the fully closed frame. It never synthesizes a held pinch for Air Draw, Spatial grabs/transforms, or destructive controls.
- **Runtime profile:** shows the inference scheduler plus measured source-frame and inference intervals to separate camera delivery limits from detector cost.
- **Hard limit:** if the camera never records enough evidence for a fast continuous hold/grab, software cannot safely invent that hold. Better lighting and keeping the hand fully inside frame remain important.

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

- **Save project** downloads a versioned `.json` workspace containing retained 2D and 3D objects plus view state. V1.4.1 warns around 32 MB and blocks portable projects above 64 MB to avoid unreliable browser memory spikes.
- **Load project** validates size/schema/object limits before restore, then resets Undo/Redo for the loaded document. Schema-v1/v2 files remain compatible; loaded state is normalized to schema v3.
- **Undo/Redo** keeps model assets only while reachable from live state or retained history. Heavy imported-model editing may trim the oldest undo/farthest redo history to stay inside the dedicated history-asset memory budget.
- **Export PNG** exports the visible workspace composition; the camera is included only when camera background is enabled. The WebGL layer is snapshotted immediately after rendering to reduce blank 3D exports.
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

Automated behavior tests:

```bash
node --test tests/*.test.mjs
```

Controlled lifecycle/integration harness:

```bash
node --experimental-vm-modules tests/integration.mjs
```

These tests validate application contracts but do not replace a real webcam/GPU/browser acceptance test. See [`docs/TESTING.md`](docs/TESTING.md).

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
6. 3D Holo Cube with Anchor/Manipulator AUTO Scale/Rotate intent locking.
7. Gesture Lab diagnostics.
8. Quick Challenge round.
9. Return Home and show System Check / privacy note.

---

**VOIDS VISION — Control Without Touch.**


### V1.5.2 runtime notes

- Ambiguous hand-overlap frames preserve existing IDs but remain ineligible for actions until tracking is unambiguous again.
- Spatial captures use a longer bounded grace than ordinary UI clicks. During recovery, transforms are frozen; stale coordinates are never applied.
- Critical 3D grabs still require two physical pinch samples. Low-FPS adaptation changes timing, not the single-frame safety rule.
- Reacquired Anchor and Manipulator controls rebase before resuming, so recovery intentionally consumes the first trustworthy sample instead of moving the object immediately.
- Below ~10 inference FPS, Spatial 3D lowers render cadence/DPR more aggressively to protect tracking throughput.

### V1.5.1 runtime notes

- Free-space 3D manipulation is intentionally captured before normal UI hover/click routing while an Anchor is held, preventing the second pinch from accidentally pressing side-panel controls.
- Spatial 3D object transforms use palm-center motion instead of the second index fingertip, reducing jitter from finger pose changes.
- A ~520 ms transform hold window bridges short low-FPS/occlusion gaps without applying stale movement; if tracking does not return, the Manipulator/Anchor is released safely.
- At very low tracking FPS (<14), Spatial 3D lowers render cadence and DPR so hand inference gets priority.
