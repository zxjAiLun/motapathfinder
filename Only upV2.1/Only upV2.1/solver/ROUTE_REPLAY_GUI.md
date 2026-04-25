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

Start from a specific step. Step numbers are 1-based; `--from-step=12` fast-forwards steps 1–11 and pauses before step 12.

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
- `--from-step=<number>`: default `1`.
- `--step-delay-ms=<number>`: default `1400`.
- `--fast-forward-delay-ms=<number>`: reserved for fast-forward tuning; default `0`.
- `--timeout-ms=<number>`: runtime idle/snapshot timeout; default `30000`.
- `--browser=<path>`: optional Chrome/Edge executable path.
- `--keep-open=0|1`: live runtime stays open by default.
- `--debug=0|1`: includes stack traces in API error payloads.

## GUI Layout

- Top bar: route filename, goal, source solver/profile/rank, final hero, runtime state, current step, runtime URL.
- Controls: Start Live, Play, Pause, Step, Restart, Jump to selected, speed preset, and from-step input.
- Timeline: one row per decision with status, kind, floor, target, enemy/item/tool/equip, damage, exp, HP delta, score, and summary.
- Detail panel: structured action JSON, estimate/score rows, hero diff, inventory diff, flag diff, and floor mutation diff.
- Runtime panel: current session status, last mismatch, and runtime snapshot/debug metadata.

## Live Control Semantics

- `Start Live` launches a fresh Playwright runtime, initializes automation switches, stabilizes auto-pickup/auto-battle, verifies the initial snapshot, then pauses before the selected step.
- `Play` executes from the current step until pause, failure, or completion.
- `Pause` is cooperative: it takes effect between decisions and never interrupts an in-flight move or battle.
- `Step` executes exactly one decision and verifies the post snapshot.
- `Jump to selected` restarts runtime, fast-forwards from the beginning through the previous step, verifies every fast-forwarded snapshot, then pauses before the selected step.
- Completed replay keeps the runtime browser open for visual inspection.

## Server API

- `GET /api/route`: lightweight metadata and decision rows.
- `GET /api/route/step/:index`: full decision, pre/post snapshots, score rows, and categorized diffs.
- `GET /api/session/status`: live session state, current step, statuses, runtime status, and last mismatch.
- `POST /api/session/start` with `{ "fromStep": 1 }`: starts live runtime.
- `POST /api/session/play` with `{ "stepDelayMs": 1400 }`: starts async playback.
- `POST /api/session/pause`: requests pause after the current decision.
- `POST /api/session/step` with `{ "stepDelayMs": 1400 }`: executes one decision.
- `POST /api/session/restart`: restarts at step 1.
- `POST /api/session/jump` with `{ "step": 12 }`: restarts and pauses before step 12.
- `POST /api/session/select-step` with `{ "step": 12 }`: updates GUI selection only.
- `POST /api/session/close`: closes Playwright runtime but keeps the GUI server alive.

API errors return:

```json
{
  "ok": false,
  "error": "message"
}
```

## Implementation Notes

- Backend uses Node built-in `http`; frontend uses plain HTML/CSS/JS.
- Static files are restricted to `solver/gui/`.
- Live runtime helpers are shared with `verify-route-live.js` through `lib/live-replay.js`.
- Route inspection is implemented in `lib/route-inspector.js`; it computes display diffs from stored `preSnapshot` and `postSnapshot`.
- Live session state is managed by `lib/replay-session.js`.

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
```

Live debugging smoke with an existing stage route:

```bash
node route-gui.js --route-file=routes/latest/stage-mt5-best.route.json --live=1 --headless=0
```
