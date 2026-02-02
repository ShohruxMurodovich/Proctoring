# Copilot / AI Agent Instructions for Vue Face Proctoring ⚙️

Quick orientation (read this first): this is a Vue 3 + TypeScript single-page app that performs client-side proctoring using face-api.js for face tracking, the Web Audio API for microphone monitoring, and browser APIs (Fullscreen / getUserMedia / getDisplayMedia / MediaRecorder) for enforcement and recording.

## Big picture 🧭
- Frontend-only proctoring UX that integrates with backend APIs at `https://kasbiy-talim.uz/services/platon-core/api`.
- Core responsibilities:
  - Face detection + pose + blink detection: `src/composables/useFaceDetection.ts` (loads models from `/models`).
  - Microphone speech detection + adaptive calibration: `src/composables/useMicrophone.ts`.
  - Violation reporting, session error list, score handling: `src/composables/useProctoring.ts`.
  - Fullscreen/permission UX and events: `src/components/FullscreenModal.vue` and `src/views/MainView.vue`.
- Static face models must be available at `/models` (served from `public/models`). face-api.js uses `loadFromUri('/models')`.

## Key workflows & commands ✅
- Development server: `npm run dev` (Vite, hot-reload at http://localhost:5173 by default)
- Build (type-check + bundle): `npm run build` (calls `vue-tsc` then `vite build`)
- Preview production build: `npm run preview`
- Type check only: `npm run type-check` (uses `vue-tsc`)
- Linting: `npm run lint` (ESLint + TypeScript config)

## Project conventions & patterns 🔧
- Composition API with `script setup` in Single File Components (SFCs).
- `@/` path alias → `src/` (configured in `tsconfig.app.json`).
- Central thresholds/config: `src/constants.ts` — prefer reading/writing thresholds here.
- Event-driven UX: `FullscreenModal.vue` emits events (`started`, `screenRecordingStarted`, `fullscreenExit`, `tabSwitch`, `appSwitch`, `pageLeave`) that drive proctoring actions in `MainView.vue`.
- API interactions use `fetch` directly inside composables and views — see endpoints below.

## Integration points & API expectations 🔗
- Face verification: PUT `.../v1/faceId` with body `{ type: 'exam', exam_id, photo: <base64> }`. Successful response: `data.data === true`.
- Error list for exam: GET `.../v1/exam/errors?exam_id=<id>` returns `data.data.err_list` or array forms.
- Report individual error: PUT `.../v1/exam/error?exam_id=<id>&err_id=<errId>` (no body assumed).
- Submit final session report: PUT `.../v1/exam/errors` with body `{ exam_id, errors: [{ err_id, ball }, ...] }`.

Include these exact endpoints and payload shapes when writing or modifying API logic or tests.

## Testing & manual debugging notes 🐞
- Camera/mic features require a real browser environment (HTTPS or localhost). Use manual acceptance tests in Chrome/Edge.
- No test harness is present. When adding tests, mock `navigator.mediaDevices`, `MediaRecorder`, and `fetch` calls.
- When changing model files, ensure they live under `public/models` so `loadFromUri('/models')` works in production.

## Common pitfalls & gotchas ⚠️
- Duplicate or inconsistent API base URLs: `src/constants.ts` defines `API_BASE_URL` but `src/views/MainView.vue` also contains a local `API_BASE_URL` constant — keep them in sync or remove the duplication.
- Face models exist under `src/models` and `public/models` — runtime code expects `/models` on the served root, so `public/models` is the source of truth for static serving.
- Browser-specific behavior: `getDisplayMedia` (screen recording) and `MediaRecorder` behave differently across browsers (Safari partial support).

## Files to touch for common changes ✍️
- Tweak detection thresholds: `src/constants.ts` (EAR thresholds, pitch, distance, intervals)
- Add new violation handling / mapping: `src/composables/useProctoring.ts` and UI messages in `src/views/MainView.vue`
- Update permissions or fullscreen UX: `src/components/FullscreenModal.vue`
- Swap or add face-api models: `public/models` and confirm `faceapi.loadFromUri('/models')` usage

> Tip: Changes to detection algorithms usually require manual browser testing and visual verification of overlays and emitted events.

## Style & PR guidance for AI agents ✍️
- Keep changes small and focused; add type annotations where helpful (this project prefers strict TypeScript + `vue-tsc`).
- Respect existing pattern: composables encapsulate platform interactions (media, detection, reporting) — prefer extending composables rather than scattering device logic into views.
- Add or update README entries and this instruction file when you change global behavior (endpoints, model paths, thresholds).

---
If anything is unclear or you'd like a short PR template for tests/mocks or a checklist for manual verification steps after changes, tell me which area to expand. 🙋‍♂️
