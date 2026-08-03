# motapathfinder.pr-5.1b-h5save-resume.v1

- status: **completed**
- input: whiteisland-pr-5.1b-route-boundary
- checkpoint: decision 1 completed; next decision 2
- artifact schema: motapathfinder.replay-resume-artifact.v1
- live runtime executed by this shadow report: **false**

## Boundary

| Field | Value |
| --- | --- |
| exact state key matches route | true |
| next decision | battle:greenSlime@A1:6,9 |
| route snapshot stored | true |
| runtime snapshot stored | true |
| identity matches | true |

## Continuation

| Field | Value |
| --- | --- |
| suffix decision count | 1 |
| final exact state key matches route | true |
| final runtime snapshot stored | true |
| identity matches | true |

## Loader-owned verification

| Contract | Value |
| --- | --- |
| production entry point | shared-solver/export-h5-segment.js:openNativeReplay |
| artifact preflight before browser | true |
| route file required by default | true |
| legacy identity uses artifact floor set | true |
| stored runtime identity recomputed | true |
| suffix decisions before boundary verification | 0 |
| final verification after suffix | true |

## Mismatch controls

| Control | Altered field | Expected error |
| --- | --- | --- |
| project-fingerprint-mismatch | projectFingerprint.fingerprintSha256 | REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH |
| route-fingerprint-mismatch | routeFingerprint.sha256 | REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH |
| route-file-required | routeRecord omitted while requireRoute=true | REPLAY_RESUME_ROUTE_REQUIRED |

## Payload binding controls

| Control | Altered field | Expected error |
| --- | --- | --- |
| native-save-payload-mismatch | data.hero.hp | REPLAY_RESUME_NATIVE_PAYLOAD_MISMATCH |
| structured-suffix-mismatch | data.__solverReplay__[0].summary | REPLAY_RESUME_STRUCTURED_SUFFIX_ROUTE_MISMATCH |
| encoded-suffix-mismatch | data.__toReplay__ | REPLAY_RESUME_ENCODED_SUFFIX_MISMATCH |

## Scope

This contract changes replay/export runtime artifact handling only. It does not change production solver DP keys, dominance, agenda, capacity, default policy, or route-selection semantics.
