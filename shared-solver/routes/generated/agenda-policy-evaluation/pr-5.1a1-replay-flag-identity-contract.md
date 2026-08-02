# PR-5.1a1 Replay Flag Identity Hardening

Schema: `motapathfinder.pr-5.1a1-replay-flag-identity.v1`
Status: completed
Mode: replay-flag-identity-shadow

This audit keeps persisted solver exact-state keys separate from the replay compatibility snapshot identity. The latter is a stable SHA-256 over the normalized full runtime snapshot and retains `flags.__leaveLoc__`.

## Controls

| Control | Evidence | Result |
| --- | --- | --- |
| CLI nonnumeric | raw=abc preserved=abc | session rejects before launch |
| WhiteIsland checkpoint | whiteisland-trial-output-contract-smoke step 1 | __leaveLoc__ populated; identity=true |
| OnlyUp cross-floor | changeFloor@MT1:6,0 -> floorFly:MT1@MT2:6,0 | flyRecordPosition=true; final={"x":6,"y":0,"direction":"up"} |

## Cross-floor identity witness

- Recorded leave locations after changeFloor: `{"MT1":{"x":6,"y":0,"direction":"up"}}`
- Correct floorFly landing: `{"x":6,"y":0,"direction":"up"}`
- Altered __leaveLoc__ landing: `{"x":5,"y":0,"direction":"up"}`
- Altered snapshot rejected: `true`
- Mismatch path: `crossFloor.floorFly.flags.__leaveLoc__.MT1.x: 6 !== 5`

## Scope boundary

This is a shadow-only replay identity audit. It does not change solver, DP key, dominance, agenda, capacity, route selection, or default strategy semantics.
