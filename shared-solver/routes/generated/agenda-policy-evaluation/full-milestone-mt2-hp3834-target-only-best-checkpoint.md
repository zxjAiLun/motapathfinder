# MT2 HP3834 target-only completion smoke

## 结论

本报告只搜索 `mt2-hp3834` 目标段。best-first canonical checkpoint 上，5 个 policy 中 best-first 与 hybrid-fair-8 完成目标并通过 full-route strict replay；hybrid-fair-16、hybrid-fair-4、FIFO 在 180 秒目标段预算内 time-limit。顶层 `stoppedReason` 为 `completed-with-search-failures`，不能解读为整张矩阵全部完成。

FIFO checkpoint 上的 best-first sensitivity 也未完成目标，因此当前证据更支持 checkpoint quality/skyline 差异与 agenda 共同影响，尚不足以形成正式 policy 排名结论。

## 配置与语义

| 项目 | 值 |
| --- | --- |
| mode | `full-milestone` |
| checkpoint | `mt2-local-best-first-hp4176.route.json` |
| 搜索区间 | `mt2-local-3582 → mt2-hp3834` |
| stopOnFirstGoal | `true` |
| budgetScope | `global-run` |
| budget | `180000 ms`, repeats `1` |
| policies | best-first, hybrid-fair-16, hybrid-fair-8, hybrid-fair-4, FIFO |
| memory caps | heap `1400 MB`, RSS `1800 MB`, child old-space `1600 MB` |
| memory checks | expansion `1`, action `1` |

代码的 milestone range 语义要求 `fromMilestone` 严格位于 `toMilestone` 之前；因此没有使用相同的起止 milestone，而是从 checkpoint 已完成的 `mt2-local-3582` 搜索到 `mt2-hp3834`。

## Provenance

| 字段 | commit |
| --- | --- |
| solver / started / finished | `e3603b519f4f9301cf7818d04e37086e4114cb4c` |
| commitStable | `true` |
| checkpoint source | `fe46718` |

## Policy 结果

| Policy | found / reached | expansions | ledger | search wall | process wall | replay | peak heap/RSS MB |
| --- | --- | ---: | --- | ---: | ---: | --- | ---: |
| best-first | true / mt2-hp3834 | 202 | 202=202 | 108.377 s | 121.234 s | valid 10/10 | 252.2 / 319.4 |
| hybrid-fair-16 | false / mt2-local-3582 | 384 | 384=384 | 180.036 s | 181.359 s | not performed; route missing | 296.5 / 367.3 |
| hybrid-fair-8 | true / mt2-hp3834 | 365 | 365=365 | 172.071 s | 180.682 s | valid 10/10 | 276.1 / 343.5 |
| hybrid-fair-4 | false / mt2-local-3582 | 230 | 230=230 | 180.075 s | 181.631 s | not performed; route missing | 249.5 / 317.6 |
| FIFO | false / mt2-local-3582 | 271 | 271=271 | 180.850 s | 182.650 s | not performed; route missing | 248.7 / 320.6 |

失败 run 的 `route-file-missing` 只表示没有生成最终路线；它不是 strict replay 失败。所有 run 的 `repairOverhead=0`、attempt count 为 1，且没有 memory-limited stop 或后续 repair attempt。

成功路线的最终状态：

| Policy | final HP | ATK / DEF / MDEF | strict replay |
| --- | ---: | --- | --- |
| best-first | 6607 | 72 / 35 / 340 | 10/10 valid |
| hybrid-fair-8 | 6620 | 72 / 35 / 340 | 10/10 valid |

成功路线副本已固定为 `mt2-hp3834-target-best-checkpoint-hybrid8.route.json`，供云端 reviewer 独立读取；其来源是本表 hybrid-fair-8 run。独立内部 strict replay 再次确认 `10/10 valid`，expected/actual exact state key 相等。

## Stat-progress diagnostics

诊断只统计被接受的 DP 状态，不改变 dominance、DP key 或 agenda 排序。两次成功 run 的首次 ATK/DEF/MDEF 增长都发生在 expansion `1`，action 为 `battle:zombieKnight@MT2:4,3`：

```text
pre:  hp=4176 atk=31 def=19 mdef=250 exp=10
post: hp=3354 atk=33 def=21 mdef=270 exp=12
```

各 policy 的 `maxHeroSeen`（hp / atk / def / mdef / exp）与接受增长状态数（atk / def / mdef）如下：

| Policy | maxHeroSeen | acceptedStatGainStates |
| --- | --- | --- |
| best-first | 6607 / 72 / 40 / 340 / 24 | 311 / 319 / 255 |
| hybrid-fair-16 | 4976 / 72 / 35 / 290 / 24 | 495 / 499 / 375 |
| hybrid-fair-8 | 6620 / 72 / 40 / 340 / 24 | 464 / 470 / 350 |
| hybrid-fair-4 | 4976 / 72 / 35 / 290 / 24 | 314 / 325 / 222 |
| FIFO | 4976 / 72 / 35 / 290 / 24 | 352 / 351 / 248 |

因此本轮不触发“先检查资源 action/path coverage”的唯一诊断分支，也没有 evidence 要求修改 dominance。

## 审计注意

- 原始 JSON 保留完整 `evaluationAttemptLedger`、strict replay、memory、provenance 和 stat-progress 数据。
- `ledgerConsistency.match=true` 对全部 5 个 policy 成立。
- 目标段搜索 wall 与 child process wall 分开记录；process wall 包含 route/replay/序列化开销。
- 原始 JSON 中仍有本机绝对路径；当前仓库内审计不受影响，公开发布前应做路径脱敏。
