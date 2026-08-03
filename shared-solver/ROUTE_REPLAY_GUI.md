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

## GUI Layout

- Top bar: route filename, goal, source solver/profile/rank, final hero, runtime state, current step, next decision, displayed runtime floor/hero, runtime snapshot identity hash, and runtime URL.
- Controls: Start Live, Play, Pause, Step, Restart, Jump to selected, speed preset, and from-step input.
- Timeline: one row per decision with status, kind, floor, target, enemy/item/tool/equip, damage, exp, HP delta, score, and summary.
- Detail panel: structured action JSON, estimate/score rows, hero diff, inventory diff, flag diff, and floor mutation diff.
- Runtime panel: current session status, last mismatch, and runtime snapshot/debug metadata.

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
- `lib/live-replay.js` preserves actual `flags.__leaveLoc__`; checkpoint start snapshots receive the expected initial cross-floor leave location when the saved route starts on a later floor than the project start floor, and later expected snapshots merge that baseline per floor without overwriting newly recorded locations.
- `route-gui.js` validates `--from-step` immediately after loading the route and before `listen()`/`openBrowser()`; the process-level error includes `REPLAY_STEP_OUT_OF_RANGE`.
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
npm run check:replay:h5save-resume:live --prefix shared-solver
```

Live debugging smoke with an existing stage route:

```bash
node route-gui.js --route-file=routes/latest/stage-mt5-best.route.json --live=1 --headless=0
```
