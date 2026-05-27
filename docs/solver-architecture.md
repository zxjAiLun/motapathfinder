# Solver Architecture Direction

Companion docs:

- `docs/project-structure.md`: repository layout and solver ownership boundaries.
- `docs/solver-roadmap.md`: forward roadmap for RegionSpec, segment DP, adaptive planner, progressive planner, and replay verification.
- `docs/multi-agent-framework.md`: public API and benchmark framework for external agents.

## Current Conclusion

This repository is no longer a collection of isolated scripts. `shared-solver/` is the canonical solver implementation. Tower wrappers such as `Only upV2.1/Only upV2.1/solver.sh` and `whiteisland（9）/solver.sh` should forward into `shared-solver/` and inject `--project-root`.

Tower-local `solver/` directories are legacy copies. They remain for archive/migration only and must not receive new solver code.

## Search Strategy Split

There are three solver families:

| Strategy | Current Role | Correctness Fit |
| --- | --- | --- |
| **segment / milestone DP** | Canonical DP with HP dominance, milestone/region goals, skyline candidates, failure propagation/repair, and replay verification | Primary path for Only Up / Whiteisland-style near-unique route solving |
| **progressive monster planner** | Auto-discovery of milestone candidates via current-reachable battle evaluation + mobility lane; converts checkpoints to candidate milestones | Candidate milestone generation; not a proof engine |
| **linear-main / beam / macro search** | Exploratory search using scores, beam width, resource macros, and heuristic dominance | Useful for discovering candidates; not suitable as proof for near-unique routes |

The mainline should be:

```text
RegionSpec / MilestoneSpec
→ primitive canonical DP (segment / milestone graph)
→ HP skyline dominance
→ failure propagation / repair
→ route record
→ live replay verification
```

Progressive planner feeds into milestone generation:

```text
ProgressiveMonsterPlanner (current-reachable-first)
→ checkpoint discovery (entered-floor, special-target-defeated, best-score)
→ candidate milestone suggestions
→ validated by segment DP (not as proof)
→ merged into formal milestone spec
```

`linear-main`, `resourcePocket`, `resourceCluster`, `resourceChain`, and beam search remain useful for exploration and candidate generation, but they should not be the final correctness layer for tightly tuned tower routes.

## Progressive Planner Architecture (2026-05)

The progressive planner has evolved through several iterations:

### v1-v3: Cross-floor Oracle Era
- Used `tryReachAndBattleBatch` with full-floor scanning + portal BFS + floorFly
- Each state scanned all allowed floors for enemies, attempted cross-floor pathfinding
- Performance bottleneck: portal BFS (`oracleFindFloorStates`) + floorFly enumeration dominated runtime
- Added batch optimization, targeted battle matcher, portal dedup, and fast portal discovery (opt-in)

### v4: Current-Reachable-First Architecture (current)
- **Default `targetScope="current-reachable"`**: only evaluates enemies on the current floor via walk reachability + adjacency matching. No portal BFS, no floorFly, no all-floor scanning.
- **Mobility lane**: always generates ≤2 mobility successors per state (changeFloor/floorFly) as independent macro actions, not tied to monster targets
- **`targetScope="cross-floor-oracle"`**: legacy batch oracle preserved as experimental mode
- **Key modules**:
  - `lib/current-reachable-battle.js`: `enumerateCurrentReachableBattleSuccessors()` + `enumerateMobilitySuccessors()` + `fetchCurrentFloorTargets()`
  - `lib/reach-and-battle-oracle.js`: legacy `tryReachAndBattleBatch()`, `discoverChangeFloorActions()`, `scoreMonsterTarget()`, `matchesSpecialTarget()`
  - `lib/progressive-monster-planner.js`: dual-mode planner with `targetScope` config

### Key Design Principles
1. **Monster planner only answers "which enemy to fight now"** — it does not do cross-floor pathfinding
2. **Mobility is a separate concern** — changeFloor/floorFly are independent macro successors, not tied to monster targets
3. **Segment DP validates, planner suggests** — progressive planner generates candidate milestones; segment DP proves or disproves them
4. **Special targets tracked per-pattern** — `SpecialTargetTracker` requires ALL patterns defeated before declaring complete
5. **Fast portal discovery is opt-in** — default `portalDiscoveryMode="legacy"` (via `enumeratePrimitiveActions`); `"fast"` uses direct `floor.changeFloor` lookup
6. **FloorFly dedup safety verified** — `check-onlyup-floorfly-dedup-safety.js` confirmed `portalDedupMode=target-floor` is UNSAFE for OnlyUp; default `"summary"` mode is safe

### Diagnostics Layers
- **Doctor report** (`solver-doctor.js`): failureClass, deficitDetail, candidateQuality, action scope stats
- **State key audit** (`check-state-key-audit.js`): direction-sensitive items, flags, visitedFloors, DP key modes
- **Planner perf**: `currentReachabilityCalls`, `battleMatchNodes`, `battleEvaluateCalls`, `mobilitySuccessors`, `battleSuccessors`
- **Portal perf** (cross-floor mode only): `portalStatesExpanded`, `portalPrimitiveEnumerations`, `portalApplyMs`, `portalDuplicateSkips`, `portalVisitedSkips`

## Why Net-Gain Scoring Is Not Enough

Example:

```text
Fight guard now: -50 HP
Pickup behind guard: +500 HP
Heuristic net gain: +450 HP
Correct route: take key atk/def/mdef first, make guard 0-damage, then return for the bottle
```

The route should not be judged by immediate net gain. The correct dominance rule is:

```text
If two routes reach the same future abstract state:
  same map mutation
  same atk/def/mdef/lv/exp
  same keys/items/equipment/flags
  same reachable region
  only HP differs
then higher HP replaces lower HP.
```

This is exactly the role of canonical DP. `buildDpStateKey()` excludes HP and `searchDP()` keeps the higher-HP representative for the same key. Same HP then prefers shorter route/depth.

## Engineering Requirements

- Intermediate milestones must not blindly use `stopOnFirstGoal=true` unless the segment has a documented safe reason and hard resource constraints.
- Timing-critical regions should preserve skyline candidates instead of a single first goal.
- `actionTrimmed > 0`, time limits, or expansion limits mean the search was incomplete under the current action set; diagnostics must not call that global no-solution.
- Region output must include a `proofClaim`. If the claim is not `bounded-complete`, downstream consumers must treat the route as a candidate.
- Final accepted routes should be primitive route records and should pass `route-gui` or live replay.
- `hpmax` must not be used as a route-quality resource for this tower family.

## Kept Components

Keep as core implementation:

- `shared-solver/lib/simulator.js`
- `shared-solver/lib/state.js`
- `shared-solver/lib/battle-resolver.js`
- `shared-solver/lib/events.js`
- `shared-solver/lib/route-store.js`
- `shared-solver/lib/live-replay.js`
- `shared-solver/lib/replay-session.js`
- `shared-solver/lib/dp-search.js`
- `shared-solver/lib/segment-dp.js`
- `shared-solver/lib/adaptive-segment-planner.js`
- `shared-solver/lib/milestone-spec.js`
- `shared-solver/lib/solver-doctor.js`
- `shared-solver/lib/progressive-monster-planner.js`
- `shared-solver/lib/current-reachable-battle.js`
- `shared-solver/lib/reach-and-battle-oracle.js`
- `shared-solver/run-region-dp.js`
- `shared-solver/run-segmented-dp.js`
- `shared-solver/check-progressive-to-milestone.js`
- `shared-solver/check-state-key-audit.js`
- `shared-solver/check-onlyup-floorfly-dedup-safety.js`

Use as auxiliary exploration:

- `linear-main`
- top-k / beam search
- `resourcePocket`
- `resourceCluster`
- `resourceChain`

## Primary Commands

### Progressive planner (auto milestone discovery)
```bash
# Current-reachable-first (default, fast)
node shared-solver/check-progressive-to-milestone.js \
  --from=mt5-blueking-kill --to=mt7-left-sword \
  --planner-rounds=50 --validate=1 \
  --out=routes/generated/auto-milestones.json

# Cross-floor oracle (experimental)
node shared-solver/check-progressive-to-milestone.js \
  --target-scope=cross-floor-oracle \
  --portal-discovery-mode=fast \
  --planner-rounds=20 --validate=1
```

### Segment DP (correctness path)
```bash
npm run run:onlyup:segmented --prefix shared-solver
npm run run:onlyup:adaptive --prefix shared-solver
```

### Region DP
```bash
npm run run:onlyup:region1 --prefix shared-solver
npm run run:region:whiteisland --prefix shared-solver
```

### State key audit
```bash
node shared-solver/check-state-key-audit.js
```

### FloorFly dedup safety
```bash
node shared-solver/check-onlyup-floorfly-dedup-safety.js
```
