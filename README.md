# Motion Rush V6

A mobile-first endless runner controlled by body movement through the phone's front camera. V6 adds reliable jump-to-crouch chaining while preserving V5's crouch-to-jump transition, approved weighted jump physics, torso-normalized intent recognition, persisted Horizontal Sensitivity slider, absolute lane mapping, PWA support, and non-camera controls.

## Current development baseline

The active development branch is `motion-rush-v6-visual-polish`, based on the approved V6 mechanics.

The mechanical phase is considered complete for now. Unless a critical regression is discovered, future work must not redesign or alter:

- the three-lane structure
- body-tracking controls and calibration
- absolute left/center/right lane mapping
- jump and crouch detection
- sensitivity settings
- ramps and train-roof traversal
- scoring, collision, and core gameplay flow

Development from this point should focus on visual polish only: environment art, trains, buildings, character presentation, animation feel, lighting, materials, HUD, effects, audio presentation, scene composition, and mobile performance. Visual improvements must preserve the current mechanics and responsiveness.

Public production build: https://motion-rush-v6-live-3090.netlify.app

V7 remains separate and must not be modified as part of V6 polishing.

## Run it on Replit

1. Create a new Replit app and import this folder/repository.
2. Replit will install the packages from `package.json`.
3. Press **Run**. The included `.replit` file serves the game on port 3000.
4. Publish with an Autoscale Deployment so the camera runs on HTTPS.

On iPhone, open the published HTTPS URL in Safari. Use **Share → Add to Home Screen** to install the PWA.

## Controls

- Swipe or arrow keys / WASD: move left, right, jump, and slide.
- Body camera: your horizontal position maps directly to the left, center, or right lane; pop upward to jump and stay ducked to remain crouched.
- Horizontal Sensitivity: adjust the camera dock slider from `0.50x` to `2.00x` in `0.05x` steps. The value immediately controls both the yellow tracking dot and absolute lane selection, and is saved on this device.
- `P` or `Escape`: pause.

## Camera notes

- Camera access requires HTTPS on iPhone; Replit's published URL provides it.
- Stand the phone upright and step back until your shoulders and hips fit in the preview.
- Calibrate in a relaxed neutral stance.
- Pose landmarks are processed locally in the browser. No camera frames are sent to this app or stored.
- The MediaPipe pose model is downloaded on first use and then cached by the PWA.

## Production build

```bash
npm run build
npm start
```
