# Testing VOIDS VISION V1

## Browser acceptance test

Use the latest Chrome or Edge with a webcam and even front/side lighting.

1. Start the site over localhost or HTTPS and allow camera access.
2. Confirm Home/HUD reports camera, MediaPipe and gesture engine ready.
3. Test pointer aim plus repeated pinch/release at the top, center and lower interaction areas.
4. Verify Air Draw stroke creation, undo, clear and PNG export.
5. Verify Presentation swipe navigation and index-finger laser pointer.
6. Verify Gesture Lab telemetry and tracking-loss recovery.
7. Verify Challenge scoring.
8. In Spatial/Holo, add multiple 2D and 3D objects, move them, use two-hand Anchor/Manipulator interaction, and test undo/redo.
9. Save a workspace, change it, reload the JSON, and confirm the scene restores.
10. Test PNG/SVG export, fullscreen, mode switching and a 10–20 minute stability run.

## Notes

Actual tracking quality depends on webcam delivery, lighting and device performance. Automated logic tests do not replace a real webcam/GPU/browser acceptance test.
