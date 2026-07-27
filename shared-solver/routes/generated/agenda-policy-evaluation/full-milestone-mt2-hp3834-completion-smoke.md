# MT2 HP3834 completion smoke audit

本摘要对应同目录的 [原始 JSON 报告](full-milestone-mt2-hp3834-completion-smoke.json)。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | 2026-07-27T11:55:57.450Z |
| Mode | `full-milestone` |
| Target milestone | `mt2-hp3834` |
| Policies | 5 |
| Budget | `time=180000ms`, repeats=1 |
| Budget scope | `global-run` |
| Solver commit | `d91bd39362f1262db61fae6c7778f6ebf947e368` |
| Source behavior baseline | `fe46718` (d91bd39 is artifact-only descendant) |
| Started commit | `d91bd39362f1262db61fae6c7778f6ebf947e368` |
| Finished commit | `d91bd39362f1262db61fae6c7778f6ebf947e368` |
| Commit stable | `true` |
| Search defaults | candidateLimit 8 / goalSkylineLimit 8 / dpSkylineMax 4 / maxActionsPerState 256 |
| Memory caps | heap 1400 MB / RSS 1800 MB |
| Child old-space | 1600 MB |
| Memory checks | expansion 1 / action 1 |
| Top-level stoppedReason | `completed-with-search-failures` |

## Policy results

| Policy | Target found | Reached | Run status | Target segment expansions | Total expansions | Search wall / process wall | Strict replay | Ledger | Peak heap / RSS MB | Child memory limit |
| --- | ---: | --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: |
| best-first | false | `mt2-local-3582` | `completed-with-search-failures` | 145 | 162 | 179.976s / 195.851s | not performed (`route-file-missing`) | true (162/162) | 227.1 / 287.6 | false |
| hybrid-fair-16 | false | `mt2-local-3582` | `completed-with-search-failures` | 197 | 214 | 181.324s / 196.987s | not performed (`route-file-missing`) | true (214/214) | 236.8 / 303.3 | false |
| hybrid-fair-8 | false | `mt2-local-3582` | `completed-with-search-failures` | 196 | 214 | 180.055s / 195.195s | not performed (`route-file-missing`) | true (214/214) | 244.7 / 310.2 | false |
| hybrid-fair-4 | false | `mt2-local-3582` | `completed-with-search-failures` | 199 | 218 | 179.978s / 198.080s | not performed (`route-file-missing`) | true (218/218) | 240.7 / 307.5 | false |
| fifo | false | `mt2-local-3582` | `completed-with-search-failures` | 1 | 57 | 183.132s / 205.037s | not performed (`route-file-missing`) | true (57/57) | 110.0 / 174.8 | false |

## Segment and attempt audit

- All five policies completed the prior sequence through `mt2-local-3582`: `mt1-gate-1559 → mt2-entry → mt2-local-3582`.
- The target segment `mt2-hp3834` was attempted once for every policy and stopped by `time-limit`; no policy retained a target candidate.
- Segment expansions were: best-first `11+2+4+145=162`, hybrid-fair-16 `11+2+4+197=214`, hybrid-fair-8 `12+2+4+196=214`, hybrid-fair-4 `13+2+4+199=218`, FIFO `51+2+3+1=57`.
- Every report was valid, every process exited normally with status 0, and every ledger matched the budget expansion total.
- All memory counters were zero: no heap limit, RSS limit, or child-memory limit. No repair phase or post-memory-stop attempt was generated.
- Strict replay was correctly not performed because no target route file existed; this is a search-failure outcome, not a replay-failure outcome.

## Wall-clock interpretation

The first wall value is ledger/search wall time; the second is end-to-end child process wall time. They are intentionally kept separate so route writing, snapshot construction, and replay overhead do not contaminate agenda search comparisons.

## Conclusion

The `mt2-hp3834` completion smoke did not produce a successful target route under the 180-second global budget for any policy. The run is operationally valid and consistently classified as `completed-with-search-failures`; provenance, ledger accounting, process exit, and memory diagnostics all passed. This result should guide the next budget/configuration decision, but is not evidence that `mt2-hp3834` is unreachable.
