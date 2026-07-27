# MT2 local-3582 completion smoke audit

本摘要对应同目录的 [原始 JSON 报告](full-milestone-mt2-local-3582-completion-smoke.json)。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | 2026-07-27T08:59:19.991Z |
| Mode | `full-milestone` |
| Target milestone | `mt2-local-3582` |
| Policies | 5 |
| Budget | `time=120000ms`, repeats=1 |
| Budget scope | `global-run` |
| Solver commit | `fe467182ae5bc91634cc4e231b5a4980fe58c01b` |
| Started commit | `fe467182ae5bc91634cc4e231b5a4980fe58c01b` |
| Finished commit | `fe467182ae5bc91634cc4e231b5a4980fe58c01b` |
| Commit stable | `true` |
| Search defaults | candidateLimit 8 / goalSkylineLimit 8 / dpSkylineMax 4 / maxActionsPerState 256 |
| Memory caps | heap 1400 MB / RSS 1800 MB |
| Child old-space | 1600 MB |
| Memory checks | expansion 1 / action 1 |
| Top-level stoppedReason | `completed` |

## Policy results

| Policy | Found | Reached | Run status | Full-route replay | Ledger match | Segment expansions | Final expansion | Peak heap / RSS MB | Child memory limit |
| --- | ---: | --- | --- | --- | ---: | --- | ---: | ---: | ---: |
| best-first | true | `mt2-local-3582` | `completed` | valid, 12/12 | true (delta 0) | 11 + 2 + 4 | 17 | 133.3 / 192.0 | false |
| hybrid-fair-16 | true | `mt2-local-3582` | `completed` | valid, 12/12 | true (delta 0) | 11 + 2 + 4 | 17 | 71.8 / 131.2 | false |
| hybrid-fair-8 | true | `mt2-local-3582` | `completed` | valid, 12/12 | true (delta 0) | 12 + 2 + 4 | 18 | 74.8 / 136.8 | false |
| hybrid-fair-4 | true | `mt2-local-3582` | `completed` | valid, 11/11 | true (delta 0) | 13 + 2 + 4 | 19 | 77.6 / 133.4 | false |
| fifo | true | `mt2-local-3582` | `completed` | valid, 11/11 | true (delta 0) | 51 + 2 + 3 | 56 | 131.4 / 199.7 | false |

## Segment and attempt audit

- All five policies completed the sequence `mt1-gate-1559 → mt2-entry → mt2-local-3582`.
- Each segment used exactly one initial attempt; no configured repair, retry-current, or expanded-previous repair phase was generated.
- The corrected cumulative accounting is visible in each row: local segment first-goal costs sum to the reported final expansion (`11+2+4=17`, `12+2+4=18`, `13+2+4=19`, and `51+2+3=56`).
- All five route files passed full-route strict replay; no route-missing or exact-state mismatch occurred.
- `ledgerConsistency.match=true` for every policy; no child-memory limit or soft-cap stop occurred.

## Conclusion

The first staged completion smoke passed for all five policies at `mt2-local-3582` on commit `fe46718`. This clears the next milestone gate for a subsequent `mt2-hp3834` smoke; formal completion statistics should still use repeated runs and rotated policy order.
