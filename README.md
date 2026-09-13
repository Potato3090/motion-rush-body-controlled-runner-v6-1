# Motion Rush V6.1

A mobile-first endless runner controlled by body movement through the phone's front camera. V6.1 adds a selectable Third Person / Runner POV camera and an optional in-game body-tracking visualization.

## V6.1 baseline

V6.1 is an independent release based on [`Potato3090/motion-rush-body-controlled-runner-v6`](https://github.com/Potato3090/motion-rush-body-controlled-runner-v6), branch `motion-rush-v6-visual-polish`, at commit `ea68ab9939e3e9d72ebcd98983dc0b801056406a`. The original V6 repository, branch, tag, history, and deployment remain unchanged.

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
- After calibration, choose Third Person or Runner POV and whether the existing body-tracking dock remains visible during the run.
- Pose landmarks are processed locally in the browser. No camera frames are sent to this app or stored.
- The MediaPipe pose model is downloaded on first use and then cached by the PWA.

## Production build

```bash
npm run build
npm start
```
