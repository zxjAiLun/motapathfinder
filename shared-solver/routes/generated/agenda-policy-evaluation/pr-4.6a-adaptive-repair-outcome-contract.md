# PR-4.6a1a Validator & Execution Accounting

- Schema: `motapathfinder.pr-4.6a1a-adaptive-repair-outcome-contract.v1`
- Status: completed
- Scope: shadow-only
- Runner: `runAdaptiveSegmentPlanner` with `maxAdaptiveRepairs=1`
- Success/incomplete outcomes are observed from executed synthetic runs; rejected controls are observed from an admissibility validator before insertion.
- Closure terminology: one-repair-insertion closure; branch evaluation and final graph execution are counted separately.
- Synthetic execution is not a claim of a complete OnlyUp route.

| Case | Failure class | Observed intent/mode | Expected | Observed | Applied repairs | Termination |
| --- | --- | --- | --- | --- | --- | --- |
| atk-deficit-positive | atk-deficit | stat-atk / resource-intent-scanner | success | success | 1 | repair-success |
| action-survivability-deficit | action-survivability-deficit | adaptive-window-repair:hp-high-survival-low-damage / adaptive-window-repair | repair-incomplete | repair-incomplete | 1 | repair-incomplete |
| target-action-unreachable | target-action-unreachable | adaptive-window-repair:change-floor-whitelist / adaptive-window-repair | success | success | 1 | repair-success |
| present-tile-overconstrained | present-tile-overconstrained | presentTiles-to-preferredPresentTiles / contract-adapter | rejected | rejected | 0 | repair-rejected |
| budget-or-action-scope-exhausted | budget-or-action-scope-exhausted | auto-split-or-action-scope-expansion / auto-segment-split | repair-incomplete | repair-incomplete | 1 | repair-incomplete |

Every generated repair segment, including the rejected proposal, is checked against the declared 300-expansion / 2000-ms shadow repair budget.

Production DP keys, dominance, agenda, capacity, default maxAdaptiveRepairs, and default policy are unchanged.
