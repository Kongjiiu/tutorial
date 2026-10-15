# Local MediaPipe assets

- Runtime: `@mediapipe/tasks-vision@0.10.35` from npm (`package.json` declares Apache-2.0).
- Model: official `hand_landmarker.task` float16 bundle from Google MediaPipe Models.
- `vision_bundle.js` is an unchanged copy of `vision_bundle.mjs` with a `.js` extension so simple local HTTP servers return a JavaScript MIME type consistently.

Runtime source: <https://www.npmjs.com/package/@mediapipe/tasks-vision>

Model source: <https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task>
