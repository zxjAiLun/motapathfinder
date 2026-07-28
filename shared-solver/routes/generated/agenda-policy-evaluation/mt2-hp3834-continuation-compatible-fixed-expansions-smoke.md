# MT2 HP3834 continuation-compatible fixed-expansions smoke

本摘要对应同目录的 [原始 JSON 报告](mt2-hp3834-continuation-compatible-fixed-expansions-smoke.json)。

## 结论

本轮按批准配置只运行 `best-first` 与 `hybrid-fair-8`，从保留全部 7 个后续硬 `presentTiles` 的 `mt2-local-best-first-hp4176` checkpoint 继续搜索 `mt2-local-3582 → mt2-hp3834`。两者都没有生成新的 HP3834 route，因此不进入 route composition、loader smoke 或 left-chain 重跑；不扩大到五 policy 矩阵，也不增加预算。

这是一个有效的失败诊断，不是“无路可达”证明。

## Configuration and provenance

| Field | Value |
| --- | --- |
| Generated | `2026-07-28T02:28:19.705Z` |
| Mode | `full-milestone` |
| Policies | `best-first`, `hybrid-fair-8` |
| Search range | `mt2-local-3582 → mt2-hp3834` |
| Budget | `expansions=600`, repeats=1 |
| Budget scope | `global-run` |
| Expansion runtime cap | `600000ms` |
| Solver / started / finished commit | `2d59167e096166509766b77580d644af62f176be` |
| Commit stable | `true` |
| Memory caps | heap `1400MB` / RSS `1800MB` |
| Child old-space | `1600MB` |
| Memory checks | expansion `1` / action `1` |
| Top-level stoppedReason | `completed-with-search-failures` |

## Policy results

| Policy | Found | Reached | Target expansions | Frontier | Search wall | Peak heap / RSS | Ledger | Memory stop | Failure class |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| best-first | `false` | `mt2-local-3582` | 600 | 2 | 227.743s | 278 / 348.4MB | `600/600` | none | `def-deficit` |
| hybrid-fair-8 | `false` | `mt2-local-3582` | 454 | 0 | 325.966s | 269.5 / 333.8MB | `454/454` | none | `def-deficit` |

Both child processes exited normally. Strict replay was correctly not performed because no target route file was generated (`route-file-missing`); this is a search failure, not a replay failure.

## Hard-tile and stat diagnostics

The input checkpoint itself preserves all required hard tiles:

```text
MT2:4,7  MT2:8,7  MT2:10,8  MT2:11,11
MT2:6,6  MT2:6,8  MT2:6,9
```

Neither failed attempt reported a missing `presentTiles` field in its best-seen diagnostic. The new failure classification therefore did not incorrectly label this run as `upstream-checkpoint-incompatible`; the remaining blocker was search completion under the fixed expansion budget.

Both policies recorded the same best-seen stat ceiling:

```text
HP 4976 / ATK 72 / DEF 35 / MDEF 290 / EXP 24
```

The failed best-seen state selected for the goal diagnostic still lacked:

```text
ATK 72, DEF 35, MDEF 290
```

The best-first frontier remained live at the expansion cap. Hybrid-fair-8 exhausted its available action set earlier without retaining a goal candidate. No heap limit, RSS limit, child-memory limit, action trimming, repair attempt, or post-memory-stop attempt occurred.

## Decision

The hard-tile propagation and upstream-checkpoint diagnostic changes are validated by the source regression checks and this controlled run. The HP3834 continuation route remains unresolved under the approved 600-expansion experiment, so the next action is to publish this diagnosis and await a new checkpoint/budget decision rather than infer impossibility.
