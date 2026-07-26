# MT1 full-route replay smoke audit

本摘要对应同目录的 [原始 JSON 报告](full-milestone-mt1-replay-smoke.json)。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | 2026-07-26T15:34:13.790Z |
| Mode | `full-milestone` |
| Target milestone | `mt1-gate-1559` |
| Policy | `best-first` |
| Budget | `time=30000ms`, repeats=1 |
| Budget scope | `global-run` |
| Solver commit | `46f8281180abb84bc30c7783c1709137c3e34fe3` |
| Commit stable | `true` |
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
| Ledger consistency | `match=true`, delta 0, 11 expansions |
| Child memory limit | `false` |
| Peak heap / RSS | 67.1 MB / 127.4 MB |

## Conclusion

The single-segment full-route generation and strict replay path passed for `mt1-gate-1559` on commit `46f8281`.
