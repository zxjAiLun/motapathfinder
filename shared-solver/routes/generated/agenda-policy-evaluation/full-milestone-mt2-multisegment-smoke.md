# MT2 multi-segment smoke audit

本摘要对应同目录的 [原始 JSON 报告](full-milestone-mt2-multisegment-smoke.json)。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | 2026-07-26T17:37:36.505Z |
| Mode | `full-milestone` |
| Target milestone | `mt2-entry` |
| Policies | 5 |
| Budget | `time=60000ms`, repeats=1 |
| Budget scope | `global-run` |
| Solver commit | `da87d43102b9fc8f3fade90cf79bb97db58a9b4c` |
| Started commit | `da87d43102b9fc8f3fade90cf79bb97db58a9b4c` |
| Finished commit | `da87d43102b9fc8f3fade90cf79bb97db58a9b4c` |
| Commit stable | `true` |
| Search defaults | candidateLimit 8 / goalSkylineLimit 8 / dpSkylineMax 4 / maxActionsPerState 256 |
| Memory caps | heap 1400 MB / RSS 1800 MB |
| Child old-space | 1600 MB |
| Memory checks | expansion 1 / action 1 |
| Top-level stoppedReason | `completed-with-search-failures` |

## Policy results

| Policy | Found | Reached | Run status | Full-route replay | Ledger match | Expansions | Final milestone expansion | Peak heap / RSS MB | Child memory limit |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| best-first | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 13 | 13 | 71.7 / 129.5 | false |
| hybrid-fair-16 | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 13 | 13 | 67.0 / 129.8 | false |
| hybrid-fair-8 | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 14 | 14 | 73.9 / 135.4 | false |
| hybrid-fair-4 | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 15 | 15 | 80.6 / 150.7 | false |
| fifo | false | — | `completed-with-search-failures` | not performed (`route-file-missing`) | true (delta 0) | 27 | — | 98.7 / 159.0 | false |

## Segment and attempt audit

- The four successful policies completed `mt1-gate-1559` followed by `mt2-entry`; each had one initial attempt per segment and no repair phase.
- Their segment expansion accounting was `mt1-gate-1559: 11/11`, `11/11`, `12/12`, `13/13`, followed by `mt2-entry: 2/2`; cumulative final values are 13, 13, 14, and 15.
- FIFO stopped after its initial MT1 attempt without a goal; its ledger still matches its 27 budget expansions, and no replay route was generated.
- All generated reports are valid, all provenance records have `commitStable=true`, and no child memory limit or soft-cap stop occurred.
- No later segment or repair attempt occurred after a memory stop.

## Conclusion

The multi-segment route generation and full-route strict replay path passed for four of five policies on commit `da87d43`. The FIFO failure is recorded explicitly as `completed-with-search-failures`; it is not a replay or ledger-consistency failure. Formal completion and quality matrices remain paused.
