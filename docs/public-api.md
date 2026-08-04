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

- `compileSolveTask(rawTask)` normalizes `{ schema, tower, model, objective, search, verification }` into a stable `taskFingerprint` binding tower identity, normalized RegionSpec, SolverModel/ObjectiveSpec fingerprints, search budgets, and action policy. External `compiled:true` markers are always stripped and recompiled.
- `SolverJob` states: `queued -> running -> {completed, failed, cancelled}`; `queued -> cancelled` is legal; illegal transitions throw `JOB_INVALID_STATE_TRANSITION`. `pause` throws `JOB_PAUSE_UNSUPPORTED` (no serializable frontier yet).
- Progress uses `motapathfinder.solver-progress.v1` with a monotonic `sequence`, no fake completion percent (only budget-consumed ratios), and `bestKnown.kind` distinguishing `progress-state`, `goal-candidate`, and `verified-route`.
- Results use `motapathfinder.solver-job-result.v1` and bind `taskFingerprint`, `solverModelFingerprint`, `objectiveFingerprint`, `towerFingerprint`, and the route artifact fingerprint. Failure classes treat budget exhaustion, action trimming, policy filtering, and milestone over-constraint as retryable incomplete-search conditions, never as a proven no-route.

The Launcher should consume only this API; it must not read `diagnostics.dp` internals or reimplement candidate comparison.

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
