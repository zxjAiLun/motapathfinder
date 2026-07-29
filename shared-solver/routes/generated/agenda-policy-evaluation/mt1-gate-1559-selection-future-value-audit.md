# PR-4.4g MT1 gate selection and future-value audit

Status: **completed**

## Gate contract

- Failed gates: none.
- Search boundary: found=true, expansions=339, frontier=0, stoppedReason=null.

## Teacher-compatible gate lifecycle

| Decision | Generated | Dominance reject | Skyline insert | Evicted | Popped | Goal accepted | Classification |
|---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 3 | false | false | false | false | false | false | candidate-not-generated |
| 4 | true | false | true | false | true | false | skyline-retained-or-pending |
| 5 | true | false | true | false | true | false | skyline-retained-or-pending |
| 6 | true | false | true | true | true | false | skyline-retained-or-pending |
| 7 | true | false | true | false | true | false | skyline-retained-or-pending |
| 8 | true | false | true | false | true | false | skyline-retained-or-pending |
| 9 | true | false | true | true | true | false | skyline-retained-or-pending |
| 10 | true | false | true | true | false | true | goal-accepted |

- Teacher gate exact key naturally goalAccepted: **true**.
- Teacher gate raw DP goal skyline: **true**.
- Teacher gate segment goal skyline: **true**.
- Teacher gate merged milestone checkpoint: **true**.

## Future-value oracle

| Start | Complete suffix | MT2 entry | MT2 local-3582 | HP3834 | Hard tiles present | Final HP |
|---|:---:|:---:|:---:|:---:|:---:|---:|
| teacher-compatible MT1 gate | true | true | true | true | true | 3834 |
| retained MT1 checkpoint 1 | true | true | true | false | true | 3369 |
| retained MT1 checkpoint 2 | true | true | true | false | true | 2513 |
| retained MT1 checkpoint 3 | true | true | true | true | true | 3834 |
| retained MT1 checkpoint 4 | true | true | true | false | true | 3369 |

The audit is oracle-only. It does not inject teacher decisions into production search and does not modify dominance, DP keys, skyline limits, checkpoint selection, or agenda defaults.

## Provenance

- solver commit: 9f45505b4edc7deec56af6d514654a1f3ad4d982
- commit stable: **true**
- clean worktree: **true/true**
