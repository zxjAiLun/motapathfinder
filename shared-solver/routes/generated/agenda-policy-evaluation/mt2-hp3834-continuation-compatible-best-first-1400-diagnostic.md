# MT2 HP3834 continuation-compatible best-first 1400 diagnostic

本摘要对应同目录的 [原始 JSON 报告](mt2-hp3834-continuation-compatible-best-first-1400-diagnostic.json)。

## 结论

本轮只运行 review 指定的 `best-first`，从 `mt2-local-best-first-hp4176.route.json` 搜索 `mt2-local-3582 → mt2-hp3834`，预算上限 1400 expansions。搜索在 603 expansions 后自然耗尽 frontier，未生成 HP3834 route。

联合统计将结果明确归类为 **B 类**：有状态同时达到 ATK/DEF/MDEF 门槛，但这些状态的最高 HP 只有 2828，低于 HP3834；没有 accepted state 同时满足完整 `minHero`，也没有 accepted `fullGoal`。这仍然只是当前 mutation-key / skyline=4 / primitive action set 下的有界搜索结论，不是游戏不可达证明。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | `2026-07-28T03:17:59.298Z` |
| Mode | `full-milestone` |
| Policy | `best-first` |
| Search range | `mt2-local-3582 → mt2-hp3834` |
| Budget | requested `1400 expansions`, repeats=1 |
| Runtime cap | `900000ms` |
| Budget scope | `global-run` |
| Solver / started / finished commit | `06bdbca8c14b16a7a41f289a9cdc4c3555e9cc72` |
| Commit stable | `true` |
| Memory caps | heap `1400MB` / RSS `1800MB` |
| Child old-space | `1600MB` |
| Memory checks | expansion `1` / action `1` |
| Top-level stoppedReason | `completed-with-search-failures` |

## Search result

| Field | Value |
| --- | --- |
| Found target | `false` |
| Reached milestone | `mt2-local-3582` |
| Actual target-segment expansions | `603` |
| Frontier | `0` |
| Expansion budget exhausted | `false` |
| Action enumeration | complete for expanded states (`actionTrimmed=0`) |
| Ledger | `603 / 603`, match=`true` |
| Process | exited normally, status `0` |
| Strict replay | not performed: `route-file-missing` |
| Memory stop | none; peak heap/RSS `286.6 / 357.1MB` |
| Repair overhead | `0` |

`completeWithinActionSet=true` is reported here only as “action enumeration complete for expanded states”; it does not mean that a goal was found or that the search was stopped by an expansion cap.

## Joint progress evidence

The current segment thresholds are:

```text
HP 3834 / ATK 72 / DEF 35 / MDEF 290
```

| Diagnostic | Value |
| --- | --- |
| Accepted states meeting ATK+DEF+MDEF | `23` |
| First expansion meeting ATK+DEF+MDEF | `147` |
| Maximum HP among those states | `2828` |
| Accepted states meeting fullMinHero | `0` |
| Accepted states meeting fullGoal | `0` |
| Closest goal missing fields | `1` (`HP`) |
| Closest deficit | `HP=1006`, normalized `0.2624` |
| Closest / joint witness HP | `2828` |
| Joint witness decision depth | `21` |

The joint witness has:

```text
HP 2828 / ATK 72 / DEF 35 / MDEF 290 / EXP 1
```

Its exact state key and route tail are retained in the raw JSON. The exact mutation state removes none of the seven hard continuation tiles; the failure is therefore not a hard-tile violation.

The independent field maxima remain higher (`HP 4976`, `ATK 72`, `DEF 35`, `MDEF 290`, `EXP 24`), but they do not describe one common state. The new joint counters remove that ambiguity.

## Decision

Best-first and the prior hybrid-fair-8 run both exhausted their bounded frontiers without retaining a continuation-compatible HP3834 goal. Do not change dominance, DP key, skyline, or default agenda. The next authorized step is teacher-fixture strict replay followed by oracle-only witness auditing; fixture decisions must not be injected into production search.
