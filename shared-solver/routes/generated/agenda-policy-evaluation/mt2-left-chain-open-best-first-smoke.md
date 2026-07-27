# MT2 left-chain-open best-first target-only smoke

## 结论

本轮按批准配置只运行 best-first × 1，从 initial-relative `mt2-hp3834-composed-from-initial.route.json` 搜索 `mt2-left-chain-open`。目标未完成，且应停止在本 milestone：失败不是预算不足或 memory stop，而是当前 HP3834 composed route 已经违反 left-chain 的 hard `presentTiles`。

```text
found = false
reachedMilestone = mt2-hp3834
runStatus = completed-with-search-failures
top-level stoppedReason = completed-with-search-failures
failedSegmentId = mt2-left-chain-open
```

## 配置与 provenance

| 项目 | 值 |
| --- | --- |
| start route | `mt2-hp3834-composed-from-initial.route.json` |
| 搜索区间 | `mt2-hp3834 → mt2-left-chain-open` |
| policy | best-first |
| budget | time `180000 ms`, repeats `1`, global-run |
| stopOnFirstGoal | `true` |
| searchConfig.maxRuntimeMs | `180000` |
| memory caps | heap/RSS `1400/1800 MB`, child old-space `1600 MB` |
| memory checks | expansion/action `1/1` |
| solver / started / finished | `c4994e3c46f74917e27b1eb437c975278bdf9065` |
| commitStable | `true` |

## 搜索结果

| expansions | search wall | process wall | frontier | ledger | repairOverhead | memory |
| ---: | ---: | ---: | ---: | --- | ---: | --- |
| 9 | 10.900 s | 15.495 s | 0 | 9=9 | 0 | no limit |

停止原因为 `present-tile-overconstrained`，不是 `time-limit`。没有 child-process-error、memory stop 或后续 repair attempt。

## Failure diagnosis

唯一硬约束缺口为：

```text
expected: MT2:4,7 = present
actual:   removed-or-missing
failureClass: present-tile-overconstrained
```

当前 composed route 的 best-seen route tail 已包含：

```text
battle:redPriest@MT2:4,7
```

因此它在到达 left-chain 搜索前就消耗了必须为后续 I893 链保留的 redPriest。这个结果不能解释为 agenda 或 wall-time 失败。

同时，best-seen 状态已经达到：

```text
HP 12008 / ATK 87 / DEF 50 / MDEF 490 / EXP 11
```

所以本轮主要 blocker 是 hard present tile，而不是 hero 属性门槛。

## Stat-progress diagnostics

```text
maxHeroSeen = HP 12008 / ATK 97 / DEF 55 / MDEF 490 / EXP 15
acceptedStatGainStates = ATK 7 / DEF 7 / MDEF 7
firstStatGainExpansion = 2 / 2 / 2
firstStatGainAction = battle:brownWizard@MT2:3,10
```

首次增长：

```text
pre:  HP 5870 / ATK 72 / DEF 35 / MDEF 340 / EXP 5
post: HP 4898 / ATK 77 / DEF 40 / MDEF 390 / EXP 7
```

属性资源确实进入了 DP；本轮没有修改 dominance、DP key、默认 agenda 或搜索排序。

## Replay 解释与下一步

由于没有生成最终路线：

```text
strictReplay.performed = false
failureReason = route-file-missing
```

这不是 strict replay 失败。当前不生成新的 initial-relative left-chain route，也不启动五策略矩阵或扩大预算。下一轮应先从 `mt2-local-3582` 重新寻找一个到 `mt2-hp3834`、同时保留 `MT2:4,7` 及其他 hard `presentTiles` 的 checkpoint，再重跑 left-chain target-only。
