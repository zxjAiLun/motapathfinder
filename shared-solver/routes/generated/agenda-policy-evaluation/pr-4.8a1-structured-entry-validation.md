# PR-4.8a1 Structured RegionSpec Entry Validation

Schema: `motapathfinder.pr-4.8a1-structured-entry-validation.v1`
Status: completed
Mode: shadow-only

## Unified entry

All fixed controls are invoked through `shared-solver/run-region-dp.js` with explicit project-root, region-spec, and output paths. The live probes are intentionally bounded and are evidence that the contract can enter the runner; they are not route-completeness claims.

## Fixed controls

| Control | Spec | Milestones | Preflight | Entry validation | Probe status | Termination | Failure class | Route primitives |
| --- | --- | ---: | --- | --- | --- | --- | --- | ---: |
| onlyup-region-1 | towers/onlyup/region-specs/region-1.json | 28 | exit=0, parsed=true | passed | not-found | expansion-budget-exhausted | target-action-unreachable | 0 |
| onlyup-region-2 | towers/onlyup/region-specs/region-2.json | 12 | exit=0, parsed=true | passed | not-found | prefix-budget-exhausted | prefix-budget-exhausted | 0 |
| whiteisland-trial-smoke | towers/whiteisland/trial-specs/trial-smoke.json | 1 | exit=0, parsed=true | passed | not-found | expansion-budget-exhausted | hp-deficit | 0 |

Each control records the normalized spec hash, project fingerprint, ordered milestone IDs, start checkpoint, reached milestone, termination/failure class, route primitive count, bounded probe budget usage, and output provenance.

## Negative controls

| Negative control | Expected rejection | CLI exit | Observed | Route output | Result |
| --- | --- | ---: | --- | --- | --- |
| dangling-startFrom | dangling-startFrom | 2 | dangling-startFrom, invalid-milestone-graph | none | passed |
| duplicate-milestone-id | duplicate-milestone-id | 2 | duplicate-milestone-id, invalid-milestone-graph | none | passed |
| unknown-floor | unknown-floor | 2 | unknown-floor | none | passed |
| unsupported-goal | unsupported-goal-type | 2 | unsupported-goal-type | none | passed |
| invalid-budget | invalid-dp-budget | 2 | invalid-dp-budget | none | passed |
| cyclic-dependency | cyclic-milestone-dependency | 2 | cyclic-milestone-dependency, invalid-milestone-graph | none | passed |

The negative set covers dangling startFrom, duplicate milestone IDs, unknown floors, unsupported goals, invalid finite-positive DP budgets, and cyclic dependencies.

## Scope boundary

This audit does not modify the production DP key, dominance, agenda, capacity, default strategy, or solver semantics. It does not claim a complete OnlyUp or WhiteIsland route.
