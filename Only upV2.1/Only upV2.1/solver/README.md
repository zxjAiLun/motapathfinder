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

- support-linked fights with guard chaining are skipped
- movement-side `repulse` is currently treated as unsupported, and `zone/laser` are scaffolded but not yet validated on MT1-MT10
- add-point events and UI-only battle side effects are not modeled
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

Unsupported event types are recorded in `state.notes`.

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
- `run-mt1-mt11.js`: small CLI entry
- `verify-mt1-mt3-live.js`: live runtime replay check for an MT1 -> MT2 -> MT1 route

## Run

```bash
node solver/run-mt1-mt11.js --rank=chaos --top-k=3 --max-expansions=80
```

Disable either automation feature explicitly when needed:

```bash
node solver/run-mt1-mt11.js --auto-pickup=0 --auto-battle=0
```

Beam trimming also accepts an optional per-region cap:

```bash
node solver/run-mt1-mt11.js --beam-width=800 --per-floor-beam-width=300 --per-region-beam-width=80
```

Run the MT1-MT3 live replay verifier:

```bash
node solver/verify-mt1-mt3-live.js --search-expansions=120 --per-state-limit=6
```

The verifier first tries to search for a short up/down candidate using the reusable MT1 -> MT2 -> MT1 stage-objective policy. If that search budget is too small, it falls back to a maintained MT1 -> MT2 -> MT1 decision list and still checks every resulting runtime snapshot against the solver state.

## Next fill-in points

1. Expand battle post-processing for support guards and add-point branches.
2. Tighten `centerFly` semantics against engine behavior.
3. Push the live verifier's candidate search below the current ~116-expansion self-find threshold so even tighter debug budgets still avoid the fallback route.
4. Add stronger pruning and dominance checks now that battle expansion is enabled.
5. Extend macro actions for more trigger tiles once MT1-MT10 search is stable.
6. Decide whether beam-search settings should become the default runtime profile or remain explicit CLI knobs.

## Extension points

- Add or replace tool handlers in `lib/tool-registry.js`.
- Override door semantics through `lib/door-resolver.js`.
- Plug battle logic into `lib/battle-resolver.js`.
- Replace dominance bucket / summary / comparison logic through `StaticSimulator` constructor hooks.

This keeps future rules such as color-key doors, special doors, directional tools, and custom transport items out of the search core.
