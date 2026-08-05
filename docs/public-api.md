# Shared Solver Public API

This API supports the multi-agent framework documented in `docs/multi-agent-framework.md`. Repository-level ownership and write boundaries are documented in `docs/project-structure.md`.

`shared-solver/public.js` is the stable API for external agents. Agents must import this file instead of reaching into tower `solver/` copies or `shared-solver/lib/**`.

## Import Rule

Allowed:

```js
const solver = require("../../shared-solver/public");
```

Forbidden:

```js
require("../../Only upV2.1/Only upV2.1/solver/lib/simulator");
require("../../whiteisland（9）/solver/lib/search");
require("../../shared-solver/lib/segment-dp");
```

## Exports

### Project and Runtime

- `loadProject(projectRoot)`
- `createSimulator(project, options)`
- `createInitialState(project, options)`
- `cloneState(state)`
- `enumerateActions(simulator, state, options)`
- `applyAction(simulator, state, action, options)`

### Keys and Routes

- `buildDpStateKey(simulator, state, options)`
- `normalizeSolverModel(rawModel)`
- `validateSolverModel(rawModel)`
- `projectHeroForSolverModel(hero, model)`
- `projectSolverState(state, modelOverride)`
- `buildRouteRecord(input)`
- `readRouteFile(filePath)`
- `writeRouteFile(filePath, routeRecord)`

### Search

- `searchDP(simulator, initialState, options)`
- `searchSegmentDP(simulator, startState, segment, options)`
- `runSegmentDP(simulator, startState, segment, options)`
- `runMilestoneGraph(simulator, initialState, milestoneSpec, options)`
- `runAdaptiveSegmentPlanner(simulator, initialState, milestoneSpec, options)`
- `loadRegionSpec(filePath)`
- `normalizeRegionSpec(rawSpec, sourceFile)`
- `validateRegionSpec(regionSpec)`
- `buildRegionMilestoneSpec(project, regionSpec)`
- `buildRegionProofClaim(result, regionSpec)`
- `buildSegmentActionProvider(simulator, segment)`
- `buildSegmentGoalPredicate(project, segment)`
- `summarizeSegmentFailure(project, segment, result)`

## RegionSpec

Region tasks use one schema across towers:

```json
{
  "id": "onlyup-region-1",
  "tower": "onlyup",
  "rank": "chaos",
  "start": { "type": "initial", "floorId": "MT1" },
  "scope": { "floors": ["MT1", "MT2", "MT3", "MT4", "MT5"] },
  "goal": { "type": "bossDefeated", "floorId": "MT5", "x": 6, "y": 7 },
  "search": {
    "algorithm": "segment-dp",
    "dpKeyMode": "region",
    "candidateLimit": 8,
    "stopOnFirstGoal": false
  }
}
```

`run-region-dp.js` accepts direct goals or a `milestoneRoute`. Direct goals are normalized into a one-segment milestone graph; `milestoneRoute` reuses the existing segment DP graph.

### Manual Solver Model

An explicit `RegionSpec.model` is authoritative for the solver state and DP identity:

```json
{
  "model": {
    "heroFields": {
      "hp": "dominance",
      "atk": "key",
      "def": "key",
      "mdef": "key",
      "lv": "key",
      "exp": "key",
      "hpmax": "disabled",
      "mana": "disabled",
      "manamax": "disabled",
      "money": "disabled",
      "followers": "disabled"
    }
  }
}
```

SolverModel v1 supports `disabled`, `value`, `key`, and `snapshot-only` for all fields, plus `dominance` for `hp` only. `objective`, non-HP `dominance`, and mechanics switches are rejected until their execution semantics exist. An explicit model projects the solver hero and makes `buildDpStateKey()` include only `key` fields. A RegionSpec without a model retains the conservative legacy model.

The full normalized model is owned by the simulator/job context; search states retain only `meta.modelFingerprint`. Explicit route snapshots are partial solver expectations: they omit disabled fields, carry `partial: true`, and record `solverModelFingerprint` plus `solverSnapshotHeroFields` in route metadata. Live replay compares that subset against a complete raw runtime capture, so disabled fields are neither defaulted to zero nor written back to the runtime.

### ObjectiveSpec

`RegionSpec.objective` is a terminal candidate-ordering contract, separate from `SolverModel`:

```json
{
  "objective": {
    "mode": "max-final-hp",
    "requireGoal": true,
    "tieBreakers": ["min-decision-depth"]
  }
}
```

Version 1 supports `clear`, `max-final-hp`, `maximize`, `maximize-score`, and `lexicographic`. Objective-Search compatibility is enforced at preflight: `hero.<field>` must be a `key`-mode field, `hero.hp` may only be maximized (or carry a non-negative score weight), `decisionDepth`/`route.length` may only be minimized, and score descriptors' `direction` flips the effective weight sign before validation. Rejections use `OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED`, `OBJECTIVE_CONFLICTS_WITH_DOMINANCE`, `OBJECTIVE_INVALID_DIRECTION`, or `OBJECTIVE_NON_MONOTONE_WEIGHT`. Objective ordering never changes DP keys, HP dominance, action legality, or intermediate state identity.

Route metadata persists `objectiveSpec`, `objectiveFingerprint`, `finalObjectiveValue`, and `objectiveComparisonTrace`. Strict replay recomputes the final value and rejects a mismatch. `clear` may report `goal-found`; optimization objectives report `bounded-optimal` only after a complete bounded search with an untrimmed, objective-aware goal archive and milestone frontier, otherwise `bounded-optimal-within-retained-frontier` or `candidate-only`.

## Proof Claim

Region output includes:

```json
{
  "proofLevel": "bounded-complete",
  "completeWithinActionSet": true,
  "actionTrimmed": 0,
  "stoppedReasons": [],
  "expansionBudgetExhausted": false,
  "unsafeStopOnFirstGoal": false
}
```

If `actionTrimmed > 0`, `time-limit`, expansion budget exhaustion, or non-final `stopOnFirstGoal=true` appears, the route is a candidate, not a proof.

### Replay

- `ReplaySession`
- `verifyRouteLive(routeRecordOrFile, options)`
- `replayRouteRecordLive(routeRecord, options)`

## SolveTask / SolverJob Contract

`shared-solver/lib/solve-task.js`, `solver-job.js`, `solver-job-manager.js`, `solver-progress.js`, `solver-job-result.js`, and `solver-worker-runner.js` provide the backend contract for the Solver Launcher:

```js
const { compileSolveTask } = require("../shared-solver/lib/solve-task");
const { SolverJobManager } = require("../shared-solver/lib/solver-job-manager");
const { createWorkerExecutor } = require("../shared-solver/lib/solver-worker-runner");

const task = compileSolveTask(rawTask, context);
const manager = new SolverJobManager({ maxConcurrentJobs: 1, createExecutor: createWorkerExecutor });
const job = manager.submit(task);
manager.subscribe(job.id, (snapshot) => { /* solver-progress.v1 */ });
manager.cancel(job.id);
```

- `compileSolveTask(rawTask)` normalizes `{ schema, tower, model, objective, search, verification }` into a stable `taskFingerprint` binding tower identity, effective project fingerprint, effective rank, normalized RegionSpec, SolverModel/ObjectiveSpec fingerprints, effective search (merged from `task.search` > `regionSpec.search` > `search.dpBudget` > `dpBudget` > defaults), action policy, and verification. `maxExpansions` must be `>= 1`; external `compiled:true` markers are always stripped and recompiled. `compileExecutableSolveTask` additionally requires a loadable project with a real fingerprint before a worker is spawned.
- `SolverJob` states: `queued -> running -> {completed, failed, cancelled}`; `queued -> cancelled` is legal; illegal transitions throw `JOB_INVALID_STATE_TRANSITION`. `pause` throws `JOB_PAUSE_UNSUPPORTED` (no serializable frontier yet). The default manager runs jobs in a child-process worker; `allowInProcess: true` opts into same-process execution. Cancelling a queued job with a reserved starting slot releases the slot and advances the queue.
- Progress uses `motapathfinder.solver-progress.v1` with a monotonic `sequence`, no fake completion percent (only budget-consumed ratios), segment/attempt lifecycle fields, realtime `bestKnown` projected by the search (`progress-state` with `goalReached:false`, `goal-candidate`, `route-artifact`, `verified-route`), and terminal `completed`/`failed`/`cancelled` snapshots. Realtime goal candidates carry `decisionDepth` (known at enqueue) with `routeLength:null` + `routeLengthExact:false`; the accurate `routeLength` + `routeLengthExact:true` is published only after route reconstruction / runtime replay. `route.length` candidates are also marked `objectiveValueExact:false` until the route is rebuilt.
- Results use `motapathfinder.solver-job-result.v1` and bind `taskFingerprint`, `solverModelFingerprint`, `objectiveFingerprint`, `towerFingerprint`, and the route artifact fingerprint. Failure classes treat budget exhaustion, action trimming, policy filtering, and milestone over-constraint as retryable incomplete-search conditions, never as a proven no-route. `strictReplay:true` runs a real runtime replay inside the job (`STRICT_REPLAY_FAILED` on mismatch; the 3-way objective reconciliation applies only when an explicit ObjectiveSpec exists, so legacy objective-less jobs verify the route replay alone); `strictReplay:false` reports `verificationStatus: "not-requested"`. Route metrics distinguish `decisionDepth` from the full `routeLength` (auto-steps included).



## Solver Launcher


ode run-solver-launcher.js serves a localhost-only GUI (launcher/ui) backed by the public contracts:

- GET /api/health, /api/towers, /api/towers/:id, /api/towers/:id/regions, /api/towers/:id/regions/:rid`n- POST /api/tasks/validate (normalized task + fingerprints) and POST /api/jobs (202)
- GET /api/jobs, /api/jobs/:id, /api/jobs/:id/result, /api/jobs/:id/route; POST /api/jobs/:id/cancel; GET /api/jobs/:id/events (SSE)
- Status mapping: INVALID_TASK 400, JOB_NOT_FOUND 404, JOB_INVALID_STATE_TRANSITION/JOB_PAUSE_UNSUPPORTED 409, accepted 202.

The Launcher only edits public inputs, calls preflight, submits jobs, subscribes to progress, reads results, and cancels; it never reads diagnostics.dp internals or reimplements solver semantics.

The task search budget is the execution authority: `runMilestoneGraph` applies the task-level `maxExpansions/maxRuntimeMs/maxActionsPerState/goalSkylineLimit/dpSkylineMax/stopOnFirstGoal` as unconditional per-segment overrides (including generated segments); `maxRuntimeMs=0` means unlimited and never yields `RUNTIME_BUDGET_EXHAUSTED`. `POST /api/tasks/validate` returns `effectiveSegments` (the per-segment budgets that will actually be executed) and progress `budget` carries `source/expansions/elapsedMs`. Jobs expose `failure` in their summary so the UI can distinguish incomplete-search (retryable) from execution errors. The task budget also governs repair/backtrack attempts (`withManualBudgetAuthority` applies the manual overrides last). Progress `budget` uses `scope: "per-attempt"` with `current` (active attempt counters/ratios, never exceeding 1) and `total` (job-level counters) kept separate. If the planning milestone build fails, `/api/tasks/validate` returns a structured 400 (`PLANNING_PREFLIGHT_FAILED`) instead of a silently-empty `effectiveSegments`.

The Launcher should consume only this API; it must not read `diagnostics.dp` internals or reimplement candidate comparison.

## Solver Launcher

`shared-solver/launcher/` is a localhost-only GUI built on the public contracts:

```bash
npm run launcher --prefix shared-solver
```

Endpoints (localhost only by default):

- `GET /api/health`, `GET /api/towers`, `GET /api/towers/:id`, `GET /api/towers/:id/regions`, `GET /api/towers/:id/regions/:regionId`
- `POST /api/tasks/validate` — compile/preflight only, returns normalized task + fingerprints
- `POST /api/jobs` (202), `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/result`, `GET /api/jobs/:id/route` (artifact download), `POST /api/jobs/:id/cancel`
- `GET /api/jobs/:id/events` — SSE (`progress` / `terminal` / `heartbeat`), monotonic sequence, `Last-Event-ID` resumption

The tower registry validates `projectRoot` and computes the project fingerprint server-side; the Launcher never exposes arbitrary file reads. After a server restart, terminal jobs are recovered from `FileJobStore`; stale `queued`/`running` records are shown as `Interrupted` (a view-model state only, not a SolverJob state).

## Agent Output Contract

Each agent run should write one run directory containing:

- `route.json`: `motapathfinder.route.v1` route record.
- `metrics.json`: machine-readable score and verification result.
- `diagnostics.json`: search diagnostics, failure class, and candidate skyline details.
- `agent-report.md`: short human-readable report.

Example `metrics.json`:

```json
{
  "taskId": "onlyup-region-1",
  "found": true,
  "liveVerified": true,
  "proofLevel": "bounded-complete",
  "completeWithinActionSet": true,
  "expansions": 12345,
  "wallMs": 8123,
  "final": {
    "hp": 1,
    "atk": 107,
    "def": 100,
    "mdef": 510
  },
  "routeLength": 87,
  "illegalWrites": 0
}
```

## Write Boundaries

Strict agent mode can write only:

- `agents/<agent>/runs/**`
- `runs/**`
- `routes/generated/**`
- `logs/generated/**`
- `benchmarks/results/**`

Agents must not write:

- `Only upV2.1/**`
- `whiteisland（9）/**`
- `shared-solver/**`

For public-layer development tasks, run:

```bash
node tools/check-agent-boundaries.js --allow-public-layer-dev=1
```

For strict agent submissions, run:

```bash
node tools/check-agent-boundaries.js --agent=<agent-name>
```

## Normal Entrypoints

Only Up wrapper:

```bash
cd "Only upV2.1/Only upV2.1" && ./solver.sh
```

Whiteisland wrapper:

```bash
cd "whiteisland（9）" && ./solver.sh
```

Canonical shared solver:

```bash
npm run run:onlyup:segmented --prefix shared-solver
```

Unified region DP:

```bash
npm run run:onlyup:region1 --prefix shared-solver
```

`linear-main` and macro search are auxiliary exploration paths. Primitive region/segment DP is the route-correctness path.

Public benchmark harness:

```bash
node benchmarks/run-agent.js \
  --agent=agents/.templates/agent.json \
  --suite=benchmarks/public/region-suite.json
```

Benchmark evaluation is defined in `docs/agent-benchmarking.md`.
