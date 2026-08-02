# PR-5.1a1a Checkpoint Flag Merge & CLI Gate

Schema: `motapathfinder.pr-5.1a1a-replay-flag-merge-cli.v1`
Status: completed
Mode: replay-runtime-flag-merge-cli

This contract keeps the production replay-runtime boundary explicit: it changes no solver/search semantics, while checkpoint flag compatibility is merged per floor and the direct CLI validates before server/browser/runtime startup.

## Controls

| Control | Evidence | Result |
| --- | --- | --- |
| Direct CLI | --from-step=abc | exit=1; code=REPLAY_STEP_OUT_OF_RANGE; server=false; runtime=false |
| Checkpoint continuation | A2 -> changeFloor@A2:11,2 -> floorFly:A2@A1:11,2 | identity=true; final={"x":11,"y":2,"direction":"down"} |
| Per-floor flag merge | baseline Start + current A2 | Start={"x":6,"y":6,"direction":"down"}; A2={"x":11,"y":2,"direction":"down"} |

## Mismatch witnesses

- old-baseline: altered Start; rejected=true; path=`checkpoint.floorFly.old-baseline.flags.__leaveLoc__.Start.x: 6 !== 7`
- new-leave-location: altered A2; rejected=true; path=`checkpoint.floorFly.new-leave-location.flags.__leaveLoc__.A2.x: 11 !== 10`

## Identity naming

`runtimeProjectedSolverStateKey` is a template projection and is not presented as a complete runtime exact-state capture. `runtimeSnapshotIdentity` remains the complete normalized runtime snapshot hash used for flag identity.
