# PR-4.5a State Abstraction Audit

Status: **completed**

## Scope

This artifact is shadow-only. It does not modify the production DP key, dominance, agenda, capacity, or default strategy.

- candidate pair: **mt2-local-3582:candidate-6** / **mt2-local-3582:candidate-7**
- decision window: **14–20**
- replay errors: **0**
- exact rejoin at decision 20: **true**

## Action / successor equivalence

| Decision | Projection collision | Actions equal | Projected successors equal | Exact successors equal |
|---:|---:|---:|---:|---:|
| 14 | true | true | true | false |
| 15 | true | true | true | false |
| 16 | true | true | true | false |
| 17 | true | true | true | false |
| 18 | true | true | true | false |
| 19 | true | true | true | false |
| 20 | true | true | true | true |

Projection: **current-floor-mutation-only-v1-shadow** — Build the existing exact state serialization, then retain only the current floor entry in mutations. This is an audit projection, never a production key.

## Exact-key split contribution

| Field | Distinct values | Collision gain if omitted | Exclusive split pairs |
|---|---:|---:|---:|
| floorId | 2 | 0 | 0 |
| progressSig | 1 | 0 | 0 |
| hero | 7 | 0 | 0 |
| inventory | 1 | 0 | 0 |
| flags | 7 | 0 | 0 |
| visitedFloors | 1 | 0 | 0 |
| mutations | 13 | 6 | 6 |

Nested non-zero fields: **11**

## triggeredAutoEvents

- classification: **corpus-consistent-but-unproven**
- observed non-empty state count: **0**
- same-exact-key/different-trigger witness count: **0**
- static non-observable risk events: **0**
- conclusion: No corpus collision witness was found; static non-observable events or missing coverage still prevent a proof of derivability.

## Direction dependency registry

- currently keyed items: **pickaxe, bomb**
- project direction references scanned: **0**
- **state-key.conditional-hero-direction** (production-keyed): inventory.pickaxe > 0 OR inventory.bomb > 0 -> hero.loc.direction is retained in exact/dominance serialization
- **floor-transition.change-floor-fallback** (future-behavior): changeFloor target direction falls back to current hero.loc.direction when changeData.direction is absent
- **simulator.floor-fly.saved-leave-location** (future-behavior): flyRecordPosition may use flags.__leaveLoc__[targetFloorId].direction; otherwise floor-fly landing falls back to current hero direction
- **simulator.action-approach-direction** (action-local): primitive action approach direction is applied before battle, door, tool, or interact-pickup effects

## Verdict

- action-set equivalent at all projection collisions: **true**
- projected one-step successor equivalent at all projection collisions: **true**
- exact one-step successor equivalent at all projection collisions: **false**
- production semantic change: **false**

The projection result is evidence for the audited local window only; it is not a proof that non-current-floor mutation history can be removed from a global key.

## Provenance

- source report: `shared-solver\routes\generated\agenda-policy-evaluation\mt2-candidate2-capacity10-j.json`
- ancestry report: `shared-solver\routes\generated\agenda-policy-evaluation\mt2-candidate2-capacity10-j2.json`
- generation commit: `90cea7592aa882f486989e3c30b8397490589da4`
