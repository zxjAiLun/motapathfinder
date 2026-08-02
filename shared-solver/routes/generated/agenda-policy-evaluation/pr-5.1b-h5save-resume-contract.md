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

## Mismatch controls

| Control | Altered field | Expected error |
| --- | --- | --- |
| project-fingerprint-mismatch | projectFingerprint.fingerprintSha256 | REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH |
| route-fingerprint-mismatch | routeFingerprint.sha256 | REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH |

## Scope

This contract changes replay/export runtime artifact handling only. It does not change production solver DP keys, dominance, agenda, capacity, default policy, or route-selection semantics.
