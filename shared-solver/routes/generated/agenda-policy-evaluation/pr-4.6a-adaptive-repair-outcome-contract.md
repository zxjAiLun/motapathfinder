# PR-4.6a1 Executed One-Repair Outcome Controls

- Schema: `motapathfinder.pr-4.6a1-adaptive-repair-outcome-contract.v1`
- Status: completed
- Scope: shadow-only
- Runner: `runAdaptiveSegmentPlanner` with `maxAdaptiveRepairs=1`
- Outcomes are observed from executed synthetic runs; rejected controls are stopped by an admissibility validator before insertion.
- Synthetic execution is not a claim of a complete OnlyUp route.

| Case | Failure class | Observed intent/mode | Expected | Observed | Applied repairs | Termination |
| --- | --- | --- | --- | --- | --- | --- |
| atk-deficit-positive | atk-deficit | stat-atk / resource-intent-scanner | success | success | 1 | repair-success |
| action-survivability-deficit | action-survivability-deficit | adaptive-window-repair:hp-high-survival-low-damage / adaptive-window-repair | repair-incomplete | repair-incomplete | 1 | repair-incomplete |
| target-action-unreachable | target-action-unreachable | adaptive-window-repair:change-floor-whitelist / adaptive-window-repair | success | success | 1 | repair-success |
| present-tile-overconstrained | present-tile-overconstrained | presentTiles-to-preferredPresentTiles / contract-adapter | rejected | rejected | 0 | repair-rejected |
| budget-or-action-scope-exhausted | budget-or-action-scope-exhausted | auto-split-or-action-scope-expansion / auto-segment-split | repair-incomplete | repair-incomplete | 1 | repair-incomplete |

Every executed repair segment is checked against the declared 300-expansion / 2000-ms shadow repair budget.

Production DP keys, dominance, agenda, capacity, default maxAdaptiveRepairs, and default policy are unchanged.
