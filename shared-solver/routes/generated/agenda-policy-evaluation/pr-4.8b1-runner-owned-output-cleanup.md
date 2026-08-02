# PR-4.8b1 Runner-owned Output Cleanup

Schema: `motapathfinder.pr-4.8b1-runner-owned-output-cleanup.v1`
Status: completed
Mode: shadow-only

The contract uses two real short RegionSpec positives through `run-region-dp.js`. It reads the written route, locks RegionSpec identity and project fingerprint metadata, checks the reached milestone and final summary, and reparses every persisted primitive decision. It also proves normal runner-owned stale-output cleanup, preserves pre-existing output in validate-only mode, and exercises a structured prefix failure. It is not a full MT1-MT5 or full Whiteisland route claim.

## Positive controls

| Control | Project | Reached milestone | Primitive decisions | Final floor | Final HP | Final ATK | Replay |
| --- | --- | --- | ---: | --- | ---: | ---: | --- |
| onlyup-region-output-contract-smoke | Only Up | onlyup-region-output-contract-smoke-goal | 2 | MT1 | 201 | 3 | passed |
| whiteisland-trial-output-contract-smoke | 白色孤岛 | whiteisland-trial-output-contract-smoke-goal | 2 | A1 | 160 | 1 | passed |

Each positive route was written by the real runner and then parsed with the route-store schema. Macro kinds and macro plan fields are rejected from persisted decisions.

## Negative controls

| Control | Expected | Stale before runner | Harness removed | Runner cleanup | Route after run | Result |
| --- | --- | --- | --- | --- | --- | --- |
| whiteisland-trial-output-contract-not-found | not-found | true | false | true | false | passed |
| onlyup-region-output-contract-prefix-failure | structured-failure | true | false | true | false | passed |

Validate-only preservation: passed (pre-existing output remains and is not deleted by the runner).

## Scope boundary

This round does not modify the production DP key, dominance, agenda, capacity, default strategy, or search order. The positives are short cross-tower output/replay controls only; they do not establish complete tower routes.
