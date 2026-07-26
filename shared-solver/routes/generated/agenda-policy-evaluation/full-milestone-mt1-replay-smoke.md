# MT1 full-route replay smoke audit

本摘要对应同目录的 [原始 JSON 报告](full-milestone-mt1-replay-smoke.json)。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | 2026-07-26T17:33:14.038Z |
| Mode | `full-milestone` |
| Target milestone | `mt1-gate-1559` |
| Policy | `best-first` |
| Budget | `time=30000ms`, repeats=1 |
| Budget scope | `global-run` |
| Solver commit | `da87d43102b9fc8f3fade90cf79bb97db58a9b4c` |
| Started commit | `da87d43102b9fc8f3fade90cf79bb97db58a9b4c` |
| Finished commit | `da87d43102b9fc8f3fade90cf79bb97db58a9b4c` |
| Commit stable | `true` |
| Search defaults | candidateLimit 8 / goalSkylineLimit 8 / dpSkylineMax 4 / maxActionsPerState 256 |
| Memory caps | heap 1400 MB / RSS 1800 MB |
| Child old-space | 1600 MB |
| Memory checks | expansion 1 / action 1 |
| Top-level stoppedReason | `completed` |

## Acceptance

| Check | Result |
| --- | --- |
| Found target milestone | `true` |
| Run status | `completed` |
| Report status | `valid` |
| Full-route strict replay | `performed=true`, `valid=true`, 7/7 steps |
| Ledger consistency | `match=true`, delta 0 |
| Total expansions | 11 |
| First goal / final requested milestone expansion | 11 / 11 |
| Child memory limit | `false` |
| Peak heap / RSS | 62.2 MB / 128.8 MB |

## Conclusion

The single-segment full-route generation and strict replay path passed for `mt1-gate-1559` on commit `da87d43`. The corrected expansion accounting reports the goal at expansion 11, matching the total ledger expansion count.
