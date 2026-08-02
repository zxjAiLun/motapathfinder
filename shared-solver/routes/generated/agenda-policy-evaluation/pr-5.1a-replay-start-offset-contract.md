# PR-5.1a Replay Start-Offset Contract

Schema: `motapathfinder.pr-5.1a-replay-start-offset.v1`
Status: completed
Mode: replay-contract-shadow

This contract uses the two PR-4.8b short cross-tower route outputs as fixed inputs. It exercises the GUI session API with a deterministic replay adapter so every prefix side effect, exact-state boundary, next decision, displayed floor/hero, and final continuation can be checked without changing solver search semantics.

## Fixed inputs and valid offsets

| Input | Tower | Route length | from-step=0 | from-step=1 | from-step=routeLength | checkpoint + from-step |
| --- | --- | ---: | --- | --- | --- | --- |
| onlyup-pr-4.8b-route | onlyup | 2 | passed | passed | passed | passed |
| whiteisland-pr-4.8b-route | whiteisland | 2 | passed | passed | passed | passed |

For each valid offset, the session pauses before the requested primitive decision, reports `lastCompletedStep=N-1`, exposes the resumed exact state and next decision, and then executes every remaining decision exactly once to the fixed final exact state.

## Boundary evidence

| Control | Requested | Effective current | Last completed | Next decision | Pause display | Final exact state | Side effects |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| onlyup-pr-4.8b-route-from-step-0 | 0 | 1 | 0 | #1 battle:greenSlime@MT1:4,7 | MT1 hp=201 | passed | all exactly once |
| onlyup-pr-4.8b-route-from-step-1 | 1 | 1 | 0 | #1 battle:greenSlime@MT1:4,7 | MT1 hp=201 | passed | all exactly once |
| onlyup-pr-4.8b-route-from-step-2 | 2 | 2 | 1 | #2 battle:redSlime@MT1:2,8 | MT1 hp=281 | passed | all exactly once |
| onlyup-pr-4.8b-route-checkpoint-plus-from-step-1 | 1 | 1 | 0 | #1 battle:redSlime@MT1:2,8 | MT1 hp=281 | passed | all exactly once |
| onlyup-pr-4.8b-route-from-step-too-large | 3 | - | - | rejected | - | REPLAY_STEP_OUT_OF_RANGE | launch=0 |
| onlyup-pr-4.8b-route-from-step-negative | -1 | - | - | rejected | - | REPLAY_STEP_OUT_OF_RANGE | launch=0 |
| onlyup-pr-4.8b-route-from-step-non-integer | 1.5 | - | - | rejected | - | REPLAY_STEP_OUT_OF_RANGE | launch=0 |
| whiteisland-pr-4.8b-route-from-step-0 | 0 | 1 | 0 | #1 openDoor:blueDoor@A1:8,11 | A1 hp=100 | passed | all exactly once |
| whiteisland-pr-4.8b-route-from-step-1 | 1 | 1 | 0 | #1 openDoor:blueDoor@A1:8,11 | A1 hp=100 | passed | all exactly once |
| whiteisland-pr-4.8b-route-from-step-2 | 2 | 2 | 1 | #2 battle:greenSlime@A1:6,9 | A1 hp=100 | passed | all exactly once |
| whiteisland-pr-4.8b-route-checkpoint-plus-from-step-1 | 1 | 1 | 0 | #1 battle:greenSlime@A1:6,9 | A1 hp=100 | passed | all exactly once |
| whiteisland-pr-4.8b-route-from-step-too-large | 3 | - | - | rejected | - | REPLAY_STEP_OUT_OF_RANGE | launch=0 |
| whiteisland-pr-4.8b-route-from-step-negative | -1 | - | - | rejected | - | REPLAY_STEP_OUT_OF_RANGE | launch=0 |
| whiteisland-pr-4.8b-route-from-step-non-integer | 1.5 | - | - | rejected | - | REPLAY_STEP_OUT_OF_RANGE | launch=0 |

## Scope boundary

This round changes replay session/API observability and GUI offset handling only. It does not modify solver, DP key, dominance, agenda, capacity, route selection, or default strategy semantics. The report is a contract-level shadow audit; live browser verification remains a separate runtime smoke.
