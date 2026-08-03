# Route Replay GUI

Route Replay GUI is a zero-build, no-new-dependency browser console for inspecting saved `.route.json` files and controlling live route replay. It never runs solver search; it only reads the selected route file.

## Commands

Static inspection:

```bash
node route-gui.js --route-file=routes/latest/mt1-mt3.route.json
npm run gui:route
```

Live replay control:

```bash
node route-gui.js --route-file=routes/latest/mt1-mt3.route.json --live=1 --headless=0
npm run gui:route:live
```

h5save resume artifact:

```bash
node route-gui.js --project-root="../whiteisland（9）" --h5save=routes/latest/h5/segment.h5save --open=0
node route-gui.js --project-root="../whiteisland（9）" --h5save=routes/latest/h5/segment.h5save --allow-unverified-route=1 --open=0
```

启动 GUI 后，也可以在 Resume Artifact 面板通过 file picker 或 drag/drop
加载 h5save。上传内容只在 server 内存中解码和校验；verified artifact 才能
点击 `Load / Start Resume` 启动 interactive resume。legacy artifact 仍只提供
metadata，不允许启动 runtime。

When `--h5save` is supplied without `--route-file`, the GUI uses the artifact's
embedded route path when that file is available. The default remains route
verified. `--allow-unverified-route=1` is an explicit legacy mode: the GUI
shows artifact metadata without inventing a decision timeline, and marks the
route as unverified.

Stage MT5 convenience:

```bash
npm run gui:stage-mt5
```

Start from a specific step. Decision numbers are 1-based; `--from-step=12` fast-forwards steps 1–11 and pauses before step 12. `--from-step=0` is an explicit alias for the initial checkpoint and therefore also pauses before decision 1. The accepted range is `0..routeLength`; `routeLength+1` and other values are rejected as out of range.

```bash
node route-gui.js --route-file=routes/latest/mt1-mt3.route.json --live=1 --from-step=12
```

## CLI Options

- `--route-file=<path>`: required route JSON file.
- `--live=0|1`: starts Playwright runtime when `1`; default `0`.
- `--headless=0|1`: defaults to `0` for live GUI.
- `--open=0|1`: opens the GUI URL in the system browser; default `1`.
- `--host=<host>`: default `127.0.0.1`.
- `--port=<number>`: default `0` for a free port.
- `--from-step=<number>`: default `1`; accepts `0..routeLength`, with `0` meaning before decision 1. Raw nonnumeric values such as `abc` are rejected by the session validator and by the direct CLI gate with nonzero exit before the server, browser, or runtime starts.
- `--step-delay-ms=<number>`: default `1400`.
- `--fast-forward-delay-ms=<number>`: reserved for fast-forward tuning; default `0`.
- `--timeout-ms=<number>`: runtime idle/snapshot timeout; default `30000`.
- `--browser=<path>`: optional Chrome/Edge executable path.
- `--keep-open=0|1`: live runtime stays open by default.
- `--debug=0|1`: includes stack traces in API error payloads.
- `--h5save=<path>`: optional lz-string h5save package containing `__solverResumeArtifact__`.
- `--allow-unverified-route=0|1`: default `0`; only `1` permits legacy metadata-only resume without a selected route.

## GUI Layout

- Top bar: route filename, goal, source solver/profile/rank, final hero, runtime state, current step, next decision, displayed runtime floor/hero, runtime snapshot identity hash, and runtime URL.
- Controls: Start Live, Play, Pause, Step, Restart, Jump to selected, speed preset, and from-step input.
- Timeline: one row per decision with status, kind, floor, target, enemy/item/tool/equip, damage, exp, HP delta, score, and summary.
- Detail panel: structured action JSON, estimate/score rows, hero diff, inventory diff, flag diff, and floor mutation diff.
- Runtime panel: current session status, last mismatch, and runtime snapshot/debug metadata.
- Resume Artifact panel: verified/legacy/failed status, project/route match, boundary and next decision, runtime display/identity, native/structured/encoded payload bindings, continuation summary, and recovery failure code/message.
- Resume operation controls: h5save file picker/dropzone, loader-owned boundary/next gate, `Step Suffix`, `Play Suffix`, `Pause`, `Close Runtime`, suffix progress, per-step status, and final verification.

## Live Control Semantics

- `Start Live` launches a fresh Playwright runtime, initializes automation switches, stabilizes auto-pickup/auto-battle, verifies the initial snapshot, then pauses before the selected step. The response records both the requested offset and the effective 1-based decision boundary.
- For every valid offset, `lastCompletedStep` is exactly the last primitive decision executed before the pause. Thus `from-step=N` pauses before decision `N` and reports `lastCompletedStep=N-1`; the `0` alias reports `currentStep=1` and `lastCompletedStep=0`.
- `Play` executes from the current step until pause, failure, or completion.
- `Pause` is cooperative: it takes effect between decisions and never interrupts an in-flight move or battle.
- `Step` executes exactly one decision and verifies the post snapshot.
- `Jump to selected` restarts runtime, fast-forwards from the beginning through the previous step, verifies every fast-forwarded snapshot, then pauses before the selected step.
- Completed replay keeps the runtime browser open for visual inspection.
- Persisted `solverBoundaryExactStateKey` remains the route's solver boundary metadata. `runtimeSnapshotIdentity` is a separate SHA-256 identity over the actual normalized runtime snapshot, including flags such as `__leaveLoc__` and floor mutations. `runtimeProjectedSolverStateKey` is only a template projection for compatibility diagnostics; it is not a complete runtime exact-state capture and neither identity is substituted for the persisted boundary key.

## Server API

- `GET /api/route`: lightweight metadata and decision rows.
- `GET /api/resume`: normalized resume artifact status. The same object is embedded as `resume` in `/api/route`.
- `GET /api/route/step/:index`: full decision, pre/post snapshots, score rows, and categorized diffs.
- `GET /api/session/status`: live session state, current step, statuses, runtime status, runtime snapshot identity comparison, projected solver-state compatibility comparison, and last mismatch.
- `POST /api/session/start` with `{ "fromStep": 1 }`: starts live runtime. The accepted range is `0..routeLength`; out-of-range requests return HTTP 400 with code `REPLAY_STEP_OUT_OF_RANGE`.
- `POST /api/session/play` with `{ "stepDelayMs": 1400 }`: starts async playback.
- `POST /api/session/pause`: requests pause after the current decision.
- `POST /api/session/step` with `{ "stepDelayMs": 1400 }`: executes one decision.
- `POST /api/session/restart`: restarts at step 1.
- `POST /api/session/jump` with `{ "step": 12 }`: restarts and pauses before step 12; `0` aliases step 1 and out-of-range values are rejected.
- `POST /api/session/select-step` with `{ "step": 12 }`: updates GUI selection only.
- `POST /api/session/close`: closes Playwright runtime but keeps the GUI server alive.
- `POST /api/resume/load` with `{ "fileName": "segment.h5save", "content": "<lz-string base64>" }`: decodes and validates an uploaded h5save in memory; it does not start a runtime.
- `GET /api/resume/status`: returns the same resume artifact projection as `/api/resume`, including `operation` when an interactive resume session exists.
- `POST /api/resume/start`: restores the verified native save, verifies the boundary and next decision, then pauses before suffix execution.
- `POST /api/resume/play` with `{ "stepDelayMs": 0 }`: synchronously checks that a verified runtime is paused, returns HTTP `202` with `{ "accepted": true }`, and executes/verifies the structured suffix asynchronously. Not-started, busy, completed, or failed states return HTTP `409` with a stable error code.
- `POST /api/resume/pause`: cooperatively pauses suffix playback.
- `POST /api/resume/step` with `{ "stepDelayMs": 0 }`: executes exactly one suffix decision and checks its post snapshot.
- `POST /api/resume/close`: closes the resume browser runtime while keeping the GUI server alive.

API errors return:

```json
{
  "ok": false,
  "error": "message",
  "code": "REPLAY_STEP_OUT_OF_RANGE",
  "requestedStep": "abc",
  "totalSteps": 12
}
```

## Implementation Notes

- Backend uses Node built-in `http`; frontend uses plain HTML/CSS/JS.
- Static files are restricted to `solver/gui/`.
- Live runtime helpers are shared with `verify-route-live.js` through `lib/live-replay.js`.
- Route inspection is implemented in `lib/route-inspector.js`; it computes display diffs from stored `preSnapshot` and `postSnapshot`.
- Live session state is managed by `lib/replay-session.js`.
- Interactive h5save state is isolated in `lib/replay-resume-controller.js` and `lib/replay-resume-session.js`; the existing route `ReplaySession` is unchanged. The session validates the artifact before browser startup, loads native save data, pauses at the boundary gate, and only then executes suffix decisions.
- Gate or restore failures close the resume browser/static server automatically while retaining the last captured runtime display, stable error code, and failed operation projection for diagnosis.
- The asynchronous status poll only replaces the cached runtime status when a live runtime returns a non-null observation; closing a failed runtime therefore does not erase its last diagnostic status.
- `POST /api/resume/load` uses `decodeH5SavePackageText()` and never writes an uploaded payload to a user-selected path. The 32 MiB JSON request cap is owned by the GUI API.
- `lib/live-replay.js` preserves actual `flags.__leaveLoc__`; checkpoint start snapshots receive the expected initial cross-floor leave location when the saved route starts on a later floor than the project start floor, and later expected snapshots merge that baseline per floor without overwriting newly recorded locations.
- `route-gui.js` validates `--from-step` immediately after loading the route and before `listen()`/`openBrowser()`; the process-level error includes `REPLAY_STEP_OUT_OF_RANGE`.
- `lib/replay-resume-gui.js` owns the GUI-safe resume status projection. It catches decode/validation failures and exposes only stable `{ code, message }` recovery reasons, without leaking a stack into the normal GUI.
- `projectFingerprintMatches` and `routeFingerprintMatches` are tri-state: `true` means checked and matched, `false` means checked and mismatched, and `null` means not checked/unavailable. Successful legacy mode reports route fingerprint `null`, not `false`.
- With a verified artifact, `route-gui.js` keeps the existing route timeline/session semantics and adds resume metadata through `/api/route` and `/api/resume`; it does not change solver search or DP state identity.
- With an explicit legacy artifact and no route, the server serves a metadata-only route record and an unavailable session so the GUI can explain the recovery state without pretending that suffix decisions are replayable.
- `export-h5-segment.js --checkpoint-step=N` writes a native `.h5save` plus suffix/full `.h5route` files. The h5save package includes `__solverResumeArtifact__` with the project/route fingerprints, route boundary, next primitive decision, verified runtime continuation identities, and SHA-256 bindings for the native payload and both suffix encodings.
- Loading an artifact with `node export-h5-segment.js --project-root=... --h5save=... --route-file=...` performs all resume verification in the production loader before opening the native replay. It checks the exact route boundary/next/final contract, recomputes stored runtime identities, verifies the loaded boundary before any structured suffix decision, and verifies the final runtime after the suffix.
- Artifact mode requires `--route-file` by default and returns `REPLAY_RESUME_ROUTE_REQUIRED` before browser startup when it is omitted. `--allow-unverified-route=1` is an explicit legacy escape hatch; its result is marked `routeVerified: false`, but native payload and embedded boundary/final runtime identities are still verified using the artifact's own floor set.
- Stable rejection codes include `REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH`, `REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH`, `REPLAY_RESUME_NATIVE_PAYLOAD_MISMATCH`, `REPLAY_RESUME_STRUCTURED_SUFFIX_MISMATCH`, `REPLAY_RESUME_ENCODED_SUFFIX_MISMATCH`, and the boundary/next/final identity mismatch codes.
- This is production replay-runtime hardening with no production solver/search semantic change.

## Validation

Syntax checks:

```bash
node --check route-gui.js
node --check lib/replay-session.js
node --check lib/route-inspector.js
node --check gui/app.js
```

Manual smoke:

```bash
npm run brute:mt3
npm run gui:route
npm run gui:route:live
npm run check:replay:flag-identity --prefix shared-solver
npm run check:replay:flag-merge-cli --prefix shared-solver
npm run check:replay:h5save-resume --prefix shared-solver
npm run check:replay:h5save-gui --prefix shared-solver
npm run check:replay:h5save-gui-flow --prefix shared-solver
npm run check:replay:h5save-gui-flow:live --prefix shared-solver
npm run check:replay:h5save-gui:robustness --prefix shared-solver
npm run check:replay:h5save-gui:robustness:live --prefix shared-solver
npm run check:replay:h5save-resume:live --prefix shared-solver
```

Live debugging smoke with an existing stage route:

```bash
node route-gui.js --route-file=routes/latest/stage-mt5-best.route.json --live=1 --headless=0
```
