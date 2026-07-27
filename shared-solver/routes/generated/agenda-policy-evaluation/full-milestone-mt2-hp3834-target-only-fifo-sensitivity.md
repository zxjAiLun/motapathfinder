# MT2 HP3834 FIFO-checkpoint sensitivity

## 结论

从 `mt2-local-fifo-hp4362.route.json` checkpoint 启动，仅运行 best-first 到 `mt2-hp3834`。180 秒目标段预算内未找到目标，结果为 `completed-with-search-failures`；没有生成路线，因此 strict replay 为 `performed=false, failureReason=route-file-missing`，不是 replay failure。

这与 best-first checkpoint 上 best-first 的 `202 expansions / 108.377 s / found=true` 形成 checkpoint sensitivity 对照。由于每个条件只有 1 repeat，不能据此单独宣称 agenda 或 checkpoint 质量的正式排名。

## 配置与 provenance

| 项目 | 值 |
| --- | --- |
| mode | `full-milestone` |
| checkpoint | `mt2-local-fifo-hp4362.route.json` |
| 搜索区间 | `mt2-local-3582 → mt2-hp3834` |
| policy | best-first |
| budget | `180000 ms`, repeats `1`, `stopOnFirstGoal=true` |
| budgetScope | `global-run` |
| memory | heap/RSS `1400/1800 MB`, child old-space `1600 MB` |
| checks | expansion/action `1/1` |
| solver / started / finished | `e3603b519f4f9301cf7818d04e37086e4114cb4c` |
| commitStable | `true` |

## 结果

| found / reached | expansions | search wall | process wall | ledger | peak heap/RSS MB | memory stop |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| false / mt2-local-3582 | 182 | 180.389 s | 182.676 s | 182=182 | 246.0 / 313.9 | none |

`repairOverhead=0`，attempt count 为 1，停止原因为 `time-limit`；无 child-memory-limit、无后续 repair attempt。

## Stat-progress diagnostics

首次 ATK/DEF/MDEF 增长发生在 expansion `1`，action 为 `battle:zombieKnight@MT2:4,3`：

```text
pre:  hp=4362 atk=31 def=19 mdef=250 exp=10
post: hp=3540 atk=33 def=21 mdef=270 exp=12
```

```text
maxHeroSeen: hp=5162 atk=72 def=35 mdef=290 exp=24
acceptedStatGainStates: atk=278 def=285 mdef=226
```

因此目标失败不是所有 stat-gain 状态都被 dominance 丢弃；本轮没有修改 dominance、DP key、默认 agenda 或搜索排序。

## 审计注意

原始 JSON 保留完整 ledger、stat-progress、memory、provenance 和失败分类。`route-file-missing` 仅表示没有最终路线可供 replay；不能将其标为 strict replay 失败。原始 JSON 中的本机绝对路径仍应在公开发布前脱敏。
