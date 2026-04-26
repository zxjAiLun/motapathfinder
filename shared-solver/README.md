# Solver Skeleton

This directory contains a reusable MT1 -> MT11 solver skeleton for the current h5mota project.

## Current scope

The skeleton already includes:

- project data loading from `project/*.js`
- state snapshots for hero, inventory, flags, and map mutations
- macro-action enumeration
- item pickup application through item definitions
- solver-side auto pickup / auto battle passes that mirror the tower plugin's decision rules, both enabled by default
- generic door requirement handling from `doorInfo.keys`
- battle damage evaluation via the tower's own `project/functions.js -> getDamageInfo`
- ambush / between-attack-aware walking over stable floor tiles
- endpoint-step handling for pickup and floor-change tiles
- same-floor region bucketing for frontier trimming
- equipment change actions with value / percentage stat effects
- tool actions for:
  - `pickaxe`
  - `bomb`
  - `centerFly` (conservative placeholder behavior)
- floor change handling
- `firstArrive`, `eachArrive`, and `autoEvent` execution for a supported action subset
- pluggable `score(state)`
- pluggable dominance pruning for search-space reduction
- top-k search scaffold

Auto-generated pickup / battle steps are kept in `state.route` for replay visibility, but they do not increase the solver's decision depth. Search ranking and dominance pruning use that normalized decision depth instead of raw route length.

## Important current limitations

Battle expansion is now wired in, but the solver is still intentionally conservative around several runtime behaviors:

- support-linked fights with guard chaining are modeled for damage, rewards, and guard removal; guard-specific post-battle effects remain intentionally conservative
- movement-side `repulse` is modeled as a runtime-style monster move; `zone/laser/ambush/betweenAttack` still need dedicated runtime trace calibration on MT1-MT10
- add-point rewards are modeled as the deterministic attack branch when `enableAddPoint` is active; richer UI choice policies remain TODO
- battle rewards and post-battle state updates currently implement the reusable subset needed by MT1-MT10, then hand off to floor `afterBattle` and `autoEvent`
- dominance pruning currently assumes that higher hero resources and larger inventory are never worse inside the same floor/position/flag/map-mutation bucket

## Supported event subset

The structured event executor currently supports:

- `setValue`
- `openDoor`
- `if`
- `choices`
- `hide`
- `setBlock`
- `changeFloor`
- `win`

Unsupported event types are recorded in `state.notes`. Event macro actions now enumerate adjacent trigger endpoints for this supported subset; shop/add-point/upgrade choices are intentionally deferred because the current tower path does not require them yet.

Tool audit for the current tower: `bomb` awards the target monster money/exp and removes the monster, but its project item script keeps afterBattle insertion commented out, so the solver does not run afterBattle for bombs. `pickaxe`/`centerFly` likewise do not trigger battle rewards or level-up chains.

## File layout

- `lib/project-loader.js`: load h5mota project data
- `lib/state.js`: state shape and mutation helpers
- `lib/expression.js`: evaluate h5mota-style expressions
- `lib/effect-vm.js`: apply pickup item effects
- `lib/reachability.js`: BFS reachability on the current floor
- `lib/floor-transitions.js`: `:before` / `:next` / stair landing resolution
- `lib/events.js`: floor events and auto events
- `lib/battle-resolver.js`: function-backed battle resolver and extension point
- `lib/door-resolver.js`: generic door/key resolution hook
- `lib/equipment-resolver.js`: equip / swap logic
- `lib/frontier-features.js`: region buckets and local battle / stair frontier features
- `lib/auto-actions.js`: toggleable auto pickup / auto battle resolver
- `lib/tool-registry.js`: pluggable tool behavior registry
- `lib/simulator.js`: macro action enumeration and action application
- `lib/score.js`: default score and comparison helpers
- `lib/dominance.js`: bucketed dominance pruning helpers
- `lib/search.js`: top-k search scaffold
- `lib/updown-candidate-policy.js`: reusable MT1 -> MT2 -> MT1 local-goal search policy
- `RESEARCH_PROGRESS.md`: current research status, verified progress, and next work
- `run-route.js`: main route-search CLI entry
- `run-search.js`: generic search runner used by the config wrapper
- `run-mt1-mt11.js`: legacy compatibility wrapper/entry
- `verify-mt1-mt3-live.js`: live runtime replay check for an MT1 -> MT2 -> MT1 route

## Run

Use a tower-local wrapper for normal runs:

```bash
./solver.sh run --profile=linear-main --rank=chaos --top-k=3 --max-expansions=80
```

Or call the shared entry directly:

```bash
node run-route.js --project-root="../Only upV2.1/Only upV2.1" --profile=linear-main --rank=chaos --top-k=3 --max-expansions=80
```

Disable either automation feature explicitly when needed:

```bash
./solver.sh run --auto-pickup=0 --auto-battle=0
```

Beam trimming also accepts an optional per-region cap:

```bash
./solver.sh run --beam-width=800 --per-floor-beam-width=300 --per-region-beam-width=80
```

Run the MT1-MT3 live replay verifier:

```bash
node solver/verify-mt1-mt3-live.js --search-expansions=120 --per-state-limit=6
```

The verifier first tries to search for a short up/down candidate using the reusable MT1 -> MT2 -> MT1 stage-objective policy. If that search budget is too small, it falls back to a maintained MT1 -> MT2 -> MT1 decision list and still checks every resulting runtime snapshot against the solver state.

## Route profiles

New runs should use these profile names:

- `linear-main`: default route search profile; macro-first graph, lite resource pocket, resource cluster/chain enabled, confluence HP dominance, checkpoint reuse/save.
- `resource-prep-main`: resource-heavy preparation profile for broader resource exploration while preserving the current staged policy.
- `debug-local-resource`: focused local resource ordering/debug profile with deep pocket search and checkpoint reuse/save off by default.

Legacy names remain accepted for compatibility, but are no longer the recommended documentation entry:

- `stage-mt1-mt11`
- `stage-mt1-mt11-resource-prep`

The staged objective policy prioritizes stable floor progress, forward stair readiness, distance to the next stair, low-damage EXP fights, level-up/resource-pocket/resource-cluster macros, unlock actions, and key resources. `run-route.js --profile=linear-main --to-floor=MT5` is the main documented route-search entry.

When diagnostics are enabled, `Stage objective` reports the current phase, forward stair readiness, distance to the next stair, battle frontier, and level readiness for `bestProgressState`.

Search graph selection is explicit:

```bash
--search-graph=macro      # normal route search
--search-graph=primitive  # debug/oracle runs
--search-graph=hybrid     # checkpoint repair or hard-stuck exploration
```

Confluence HP dominance can be controlled from the top-k CLIs with:

```bash
--confluence=1
--confluence-route-slack=12
--confluence-representatives=3
--confluence-min-floor=1
```

With `--diagnostics=1`, the diagnostics main view includes a compact `confluence` summary plus the full `confluenceDominance` counters for `rejectedByHigherHp`, `replacedLowerHp`, and representative examples.

The default confluence route policy for portable configs is `slack`. Use `--confluence-route-policy=ignore-length` only for towers or floor ranges whose confluence key coverage has been audited; it allows a longer high-resource route to dominate a shorter low-resource route at the same future-equivalent key.

Resource search defaults are split by role:

```bash
--resource-pocket-mode=lite
--resource-cluster=1
--resource-cluster-mode=normal
--resource-chain=0
```

`fightToLevelUp` handles near-level-up fights, `resourcePocket` stays as lightweight same-floor prep, and `resourceCluster` owns ABC-style local ordering where several routes reach the same final resources with different HP. Cluster search has three presets: `lite` (`maxDepth=3`, `maxNodes=36`, `branchLimit=4`), `normal` (`5`, `200`, `6`), and `deep` (`8`, `1000`, `8`). The simulator gates cluster DP behind local candidate signals, so states without an obvious resource cluster skip the heavier optimizer. `resourceChain` is reserved for cross-floor/equipment/backtrack chains and should be enabled by profile or floor gate, for example `--resource-chain=1 --resource-chain-floors=MT2`.

Action expansion caches are enabled by default and are reported in diagnostics as `actionExpansionCache`:

```bash
--action-expansion-cache=1
--action-cache-limit=1024
--battle-estimate-cache=1
--battle-cache-limit=4096
```

The cached layers cover walk reachability, primitive action enumeration, battle estimates, resource-cluster ordering, resource preview applies, resource-chain lookahead, and search confluence signatures. Cache stats include `hitRate`, `avgComputeMs`, `estimatedMsSaved`, and `avgMsSaved`. In parallel top-k mode, worker cache hit/miss deltas are aggregated under `actionExpansionCache.workers`.

Top-k performance baselines:

```bash
npm run perf:topk:serial
npm run perf:topk:parallel
```

Compare `perf.expansionsPerSec`, `perf.timeInGenerateActionsMs`, `actionExpansionCache.*.hitRate`, `confluenceDominance.rejectedByHigherHp`, and `resourceCluster.skylineRejected` between runs.

## Next fill-in points

1. TODO: Add dedicated shop / add-point / upgrade-choice resolvers if a future tower segment requires them.
2. Expand battle post-processing for support guards and add-point branches.
3. Tighten `centerFly` semantics against engine behavior.
4. Push the live verifier's candidate search below the current ~116-expansion self-find threshold so even tighter debug budgets still avoid the fallback route.
5. Add stronger pruning and dominance checks now that battle expansion is enabled.
6. Extend macro actions for more trigger tiles once MT1-MT10 search is stable.
7. Decide whether beam-search settings should become the default runtime profile or remain explicit CLI knobs.

## Extension points

- Add or replace tool handlers in `lib/tool-registry.js`.
- Override door semantics through `lib/door-resolver.js`.
- Plug battle logic into `lib/battle-resolver.js`.
- Replace dominance bucket / summary / comparison logic through `StaticSimulator` constructor hooks.

This keeps future rules such as color-key doors, special doors, directional tools, and custom transport items out of the search core.
