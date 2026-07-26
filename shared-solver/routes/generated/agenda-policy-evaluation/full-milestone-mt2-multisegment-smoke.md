# MT2 multi-segment smoke audit

本摘要对应同目录的 [原始 JSON 报告](full-milestone-mt2-multisegment-smoke.json)。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | 2026-07-26T15:52:59.677Z |
| Mode | `full-milestone` |
| Target milestone | `mt2-entry` |
| Policies | 5 |
| Budget | `time=60000ms`, repeats=1 |
| Budget scope | `global-run` |
| Solver commit | `46f8281180abb84bc30c7783c1709137c3e34fe3` |
| Commit stable | `true` |
| Memory caps | heap 1400 MB / RSS 1800 MB |
| Child old-space | 1600 MB |
| Memory checks | expansion 1 / action 1 |
| Top-level stoppedReason | `completed` |

## Policy results

| Policy | Found | Reached | Run status | Full-route replay | Ledger match | Expansions | Peak heap / RSS MB | Child memory limit |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| best-first | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 13 | 65.2 / 128.0 | false |
| hybrid-fair-16 | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 13 | 80.9 / 140.0 | false |
| hybrid-fair-8 | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 14 | 70.0 / 129.4 | false |
| hybrid-fair-4 | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 15 | 82.9 / 146.0 | false |
| fifo | true | `mt2-entry` | `completed` | valid, 9/9 | true (delta 0) | 53 | 132.2 / 193.2 | false |

## Segment and attempt audit

- Every policy completed both segments: `mt1-gate-1559` followed by `mt2-entry`.
- Every segment had exactly one initial attempt; no repair phase was needed.
- All five reports were valid and all provenance records had `commitStable=true`.
- No child memory limit or soft-cap stop occurred.
- No later segment or repair attempt occurred after a memory stop.

## Conclusion

The multi-segment completion and full-route strict replay path passed for all five policies on commit `46f8281`.
