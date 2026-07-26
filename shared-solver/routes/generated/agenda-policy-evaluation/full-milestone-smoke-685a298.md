# Full-milestone smoke audit

本摘要对应同目录的 [原始 JSON 报告](full-milestone-smoke-685a298.json)，供 GitHub 人类审计和云端 review agent 快速读取。

## Run metadata

| Field | Value |
| --- | --- |
| Generated | 2026-07-26T14:16:11.351Z |
| Mode | `full-milestone` |
| Route | `onlyup-chaos-mt5-blueking` |
| Budget | `time=20000ms`, repeats=1 |
| Budget scope | `global-run` |
| Policies | 5 |
| Solver commit | `685a2987cb76d19c6cc18d030f3f7d1dd3eecb2b` |
| Commit stable | `true` |
| Memory caps | heap 1400 MB / RSS 1800 MB |
| Child old-space | 1600 MB |
| Memory checks | expansion 1 / action 1 |
| stopOnFirstGoal | `false` |
| DP key | `region` |
| Report status | all 5 runs `valid` |

## Policy results

| Policy | Found | Reached | Failed segment | Expansions | Wall ms | Peak heap MB | Peak RSS MB | Child memory limit | Ledger match | Strict replay |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| best-first | false | `mt1-gate-1559` | `mt2-entry` | 12 | 20617 | 75.2 | 136.9 | false | true (delta 0) | not run: route missing |
| hybrid-fair-16 | false | `mt1-gate-1559` | `mt2-entry` | 14 | 22011 | 71.8 | 136.2 | false | true (delta 0) | not run: route missing |
| hybrid-fair-8 | false | `mt1-gate-1559` | `mt2-entry` | 13 | 20837 | 70.1 | 136.4 | false | true (delta 0) | not run: route missing |
| hybrid-fair-4 | false | `mt1-gate-1559` | `mt2-entry` | 14 | 21394 | 73.2 | 136.6 | false | true (delta 0) | not run: route missing |
| fifo | false | not reached | `mt1-gate-1559` | 18 | 21114 | 93.3 | 157.3 | false | true (delta 0) | not run: route missing |

## Memory and attempt audit

- Child memory-limit count: `0/5`.
- Soft-cap memory-limited runs: `0/5`; therefore no post-memory segment or repair attempt was started in this smoke.
- Heap/RSS overshoot: none observed.
- Each run had one evaluation attempt; all reports were structurally valid.
- The 20-second smoke budget did not produce a complete final route. Consequently strict replay was not exercised (`performed=false`, `route-file-missing`), rather than failing replay validation.

## Conclusion

The full-milestone evaluation runner, five agenda policies, provenance, memory reporting, and ledger accounting passed the smoke checks on commit `685a298`. This short budget is an infrastructure smoke only; it is not evidence that the complete milestone route was found or strictly replayed.
