# PR-4.7a Resource Intent Scanner Evidence Contract

Schema: `motapathfinder.pr-4.7a-resource-intent-evidence-contract.v1`
Status: completed
Mode: shadow-only

## Fixed scanner outputs

fixed outputs: stat-gain, equipment, levelup, path-blocker, deferred-resource

Every generated record carries the source action and chain, target tile/floor, before/after delta, damage/cost, failure-class relevance, score decomposition, generated temporary goal, and action policy.

## Observed controls

| Case | Failure | Output | Scanner kind | Top source action |
| --- | --- | --- | --- | --- |
| atk-pickup | atk-deficit | stat-gain | stat-atk | pickup:attackCrystal@S1:1,0 |
| atk-equipment | atk-deficit | equipment | equipment | equip:trainingSword@S1:2,0 |
| atk-levelup | atk-deficit | levelup | exp | battle:lowExpEnemy@S1:4,0 |
| hp-pickup | hp-deficit | stat-gain | stat-hp | pickup:redPotion@S1:3,0 |
| hp-low-damage-exp | hp-deficit | levelup | exp | battle:lowExpEnemy@S1:4,0 |
| hp-deferred-resource | hp-deficit | deferred-resource | blocked-hp-resource | battle:deferredBlocker@S1:7,0 |
| target-door-path-blocker | target-action-unreachable | path-blocker | path-blocker | openDoor:lockedDoor@S1:5,0 |

## Contract gates

- atk-deficit controls: stat-gain / equipment / levelup
- hp-deficit controls: stat-gain / levelup / deferred-resource
- target-action-unreachable control: path-blocker
- stable candidate ordering: passed
- no available intent returns empty: passed
- deferred resource direct pickup: not available
- path blocker observed new action count: 1
- deterministic full-report rebuild: required

The deferred-resource case records a blocker battle followed by a hypothetical pickup chain; it is not labeled as an immediate pickup. The path-blocker case is accepted only because the door preview exposes a new action, not because the tile is merely typed as a door.

## Scope boundary

This contract does not claim a complete OnlyUp route, safe mapping for every real corpus failure, blocker/openDoor repair in the production planner, or any production default policy change.
