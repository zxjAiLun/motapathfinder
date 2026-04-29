# Solver Architecture Direction

Companion docs:

- `docs/project-structure.md`: repository layout and solver ownership boundaries.
- `docs/solver-roadmap.md`: forward roadmap for RegionSpec, segment DP, adaptive planner, and replay verification.
- `docs/multi-agent-framework.md`: public API and benchmark framework for external agents.

## Current Conclusion

This repository is no longer a collection of isolated scripts. `shared-solver/` is the canonical solver implementation. Tower wrappers such as `Only upV2.1/Only upV2.1/solver.sh` and `whiteisland（9）/solver.sh` should forward into `shared-solver/` and inject `--project-root`.

Tower-local `solver/` directories are legacy copies. They remain for archive/migration only and must not receive new solver code.

## Search Strategy Split

There are two solver families:

| Strategy | Current Role | Correctness Fit |
| --- | --- | --- |
| `linear-main` / top-k beam / macro search | Exploratory search using scores, beam width, resource macros, and heuristic dominance | Useful for discovering candidates; not suitable as proof for near-unique routes |
| `canonical-dp` / `segment-dp` / `adaptive-segment-dp` / `region-dp` | Primitive canonical DP with HP dominance, milestone/region goals, skyline candidates, and replay verification | Primary path for Only Up / Whiteisland-style near-unique route solving |

The mainline should be:

```text
RegionSpec
-> primitive canonical DP
-> segment / milestone graph
-> HP skyline dominance
-> failure propagation / repair
-> route record
-> live replay verification
```

`linear-main`, `resourcePocket`, `resourceCluster`, `resourceChain`, and beam search remain useful for exploration and candidate generation, but they should not be the final correctness layer for tightly tuned tower routes.

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
- `shared-solver/run-region-dp.js`

Use as auxiliary exploration:

- `linear-main`
- top-k / beam search
- `resourcePocket`
- `resourceCluster`
- `resourceChain`

## Primary Commands

Only Up region 1:

```bash
npm run run:onlyup:region1 --prefix shared-solver
```

Only Up region 2 scaffold:

```bash
npm run run:onlyup:region2 --prefix shared-solver
```

Whiteisland trial smoke:

```bash
npm run run:region:whiteisland --prefix shared-solver
```

Resource timing regression:

```bash
npm run check:resource-timing --prefix shared-solver
```
