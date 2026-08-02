# PR-4.8a RegionSpec Entry Contract

Schema: `motapathfinder.pr-4.8a-region-entry-contract.v1`
Status: completed
Mode: shadow-only

## Unified entry

All fixed controls are invoked through `shared-solver/run-region-dp.js` with explicit project-root, region-spec, and output paths. The live probes are intentionally bounded and are evidence that the contract can enter the runner; they are not route-completeness claims.

## Fixed controls

| Control | Spec | Milestones | Entry validation | Probe status | Termination | Failure class | Route primitives |
| --- | --- | ---: | --- | --- | --- | --- | ---: |
| onlyup-region-1 | towers/onlyup/region-specs/region-1.json | 18 | passed | not-found | expansion-budget-exhausted | target-action-unreachable | 0 |
| onlyup-region-2 | towers/onlyup/region-specs/region-2.json | 12 | passed | runner-error | runner-error | runner-error | 0 |
| whiteisland-trial-smoke | towers/whiteisland/trial-specs/trial-smoke.json | 1 | passed | not-found | expansion-budget-exhausted | hp-deficit | 0 |

Each control records the normalized spec hash, project fingerprint, ordered milestone IDs, start checkpoint, reached milestone, termination/failure class, route primitive count, bounded probe budget usage, and output provenance.

## Negative controls

| Negative control | Expected rejection | Observed | Result |
| --- | --- | --- | --- |
| dangling-startFrom | dangling-startFrom | dangling-startFrom, invalid-milestone-graph | passed |
| duplicate-milestone-id | duplicate-milestone-id | duplicate-milestone-id, invalid-milestone-graph | passed |
| unknown-floor | unknown-floor | unknown-floor | passed |
| unsupported-goal | unsupported-goal-type | unsupported-goal-type | passed |
| invalid-budget | invalid-dp-budget | invalid-dp-budget | passed |
| cyclic-dependency | cyclic-milestone-dependency | cyclic-milestone-dependency, invalid-milestone-graph | passed |

The negative set covers dangling startFrom, duplicate milestone IDs, unknown floors, unsupported goals, invalid finite-positive DP budgets, and cyclic dependencies.

## Scope boundary

This audit does not modify the production DP key, dominance, agenda, capacity, default strategy, or solver semantics. It does not claim a complete OnlyUp or WhiteIsland route.
