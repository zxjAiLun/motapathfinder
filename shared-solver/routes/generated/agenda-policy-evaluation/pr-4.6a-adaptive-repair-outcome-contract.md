# PR-4.6a Adaptive Repair Outcome Contract

- Schema: `motapathfinder.pr-4.6a-adaptive-repair-outcome-contract.v1`
- Status: completed
- Scope: shadow-only
- Maximum repair count: 1
- Synthetic controls use the label `synthetic-contract-only` and are not claims of a complete OnlyUp route.

| Case | Failure class | Selected intent | Planner mode | Repaired outcome | Termination |
| --- | --- | --- | --- | --- | --- |
| atk-deficit-positive | atk-deficit | attack-resource-or-best-combat | contract-adapter | success | repair-success |
| action-survivability-deficit | action-survivability-deficit | hp-high-survival-low-damage | adaptive-window-repair | repair-incomplete | repair-incomplete |
| target-action-unreachable | target-action-unreachable | blocker-open-door-change-floor-whitelist | adaptive-window-repair | success | repair-success |
| present-tile-overconstrained | present-tile-overconstrained | presentTiles-to-preferredPresentTiles | contract-adapter | rejected | repair-rejected |
| budget-or-action-scope-exhausted | budget-or-action-scope-exhausted | auto-split-or-action-scope-expansion | auto-segment-split | repair-incomplete | repair-incomplete |

The contract records baseline outcome, failure class, selected intent, generated repair segment, repair budget, repaired outcome, and explicit termination reason.

Production DP keys, dominance, agenda, capacity, and default policy are unchanged.
