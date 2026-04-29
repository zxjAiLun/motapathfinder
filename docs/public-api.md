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
