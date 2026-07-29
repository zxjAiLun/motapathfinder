# Solver 术语表（中文）

这份表的目标不是让你背英文，而是让报告中的一个词能直接对应到代码行为。

## A. 基础对象

| 术语 | 中文 | 实际含义 |
|---|---|---|
| `project` | 游戏规则资料 | 原始地图、怪物、物品、楼层、事件被加载后的对象 |
| `state` | 游戏局面 | 当前楼层、位置、HP/属性、背包、flags、visited floors、地图变化 |
| `action` | 可执行动作 | 战斗、拾取、装备、开门、道具、上下楼；通常包含到目标的 path |
| `decision` | 路线决策 | 已写入 route 的 action，带执行前后 snapshot |
| `node` | 搜索节点 | state 加父节点、来源 action 和搜索元数据 |
| `candidate` | 候选局面 | 可能继续进入下一步或下一 milestone 的 state |
| `frontier` | 候选前沿/待处理集合 | 尚未继续展开，或准备交给下一段的候选集合 |
| `agenda` | 搜索队列 | 决定先展开哪个 node；best-first/FIFO/hybrid 是队列策略 |
| `lineage` | 候选血统 | 一个 candidate 以及它产生的后代状态链 |
| `checkpoint` | 阶段存档点 | milestone 完成后交给下一段的候选池 |
| `mutation` | 地图变化 | 某个怪、物品、门或机关已经被移除/替换的记录 |

## B. 三种 key

| 术语 | 中文 | 用途 | 是否包含当前 HP |
|---|---|---|---|
| `state key` / `exactStateKey` | 完整状态身份 | 判断两个记录状态是否完全一致、strict replay 对齐 | 是 |
| `dominance key` | 支配比较身份 | 同类状态中用更高 HP 替代低 HP | 否 |
| `DP key` / `dpKey` | 搜索抽象桶身份 | 控制同类状态数量，取决于 location/region/mutation key mode | 通常否 |

最重要的区别：

```text
exact 相同：所有关键字段相同。
DP key 相同：搜索认为两者属于同一抽象桶。
dominance key 相同：允许用 HP 比较谁更强。
```

## C. Skyline 的四个中文名字

“skyline”只表示“保留一组不能简单互相替代的代表”。项目里不要把四层混成一个概念。

| 代码/报告名称 | 建议中文 | 由谁产生 | 主要问题 |
|---|---|---|---|
| DP skyline / `SkylineSet` | DP 同类状态保留桶 | `searchDP()` | 搜索中同类 state 还保留哪些 |
| raw DP goal skyline | DP 原始过关状态 | `searchDP()` | 一次 attempt 找到了哪些正式过关 state |
| segment goal skyline | 本阶段出口候选 | `searchSegmentDP()` | 哪些过关 state 代表不同当前角色 |
| merged checkpoint frontier | 下一阶段入口候选池 | `mergeMilestoneFrontier()` | 多个上游 candidate 合并后给下一段什么 |

### `dpSkylineMax`、`goalSkylineLimit`、`candidateLimit`

```text
dpSkylineMax
  同一个 DP 抽象桶里最多保留多少状态。

goalSkylineLimit
  一次 segment attempt 最多带出多少个过关状态。

candidateLimit
  阶段出口合并后，下一 milestone 最多接收多少个 candidate。
```

它们变大时，搜索规模、内存和运行时间通常都会变大；变小则更容易丢掉未来有价值的路线。

## D. 筛选与诊断词

| 术语 | 中文解释 |
|---|---|
| `dominance-rejected` | 新状态与已有状态属于同类，且按当前比较规则不更好 |
| `skyline-capacity-rejected` | 状态可能有区别，但对应保留桶已满 |
| `skylineInserted` | 状态进入某个保留集合 |
| `skylineEvicted` | 状态曾进入集合，后来被另一个候选替换 |
| `agendaPopped` | 状态从搜索队列取出并准备展开 |
| `goalAccepted` | 状态满足 milestone 的全部正式条件 |
| `frontierSize` | 搜索结束时仍未展开的状态数量；不为 0 通常意味着搜索未完全收尽 |
| `actionTrimmed` | 动作被每状态动作上限截掉；不能据此宣称无路 |
| `expansionBudgetExhausted` | 达到 expansion 上限时仍有 frontier |
| `stoppedReason` | `time-limit`、`memory-limit` 等停止原因 |
| `witness` | 替代、拒绝或支配某候选的证据状态 |
| `observer` | 旁观记录器；只记录事件，不应改变搜索结果 |
| `ledger` | 每个 segment/attempt/phase 的消耗账本 |
| `provenance` | solver commit、开始/结束 commit、Node 版本和 worktree 状态 |

## E. Milestone 与 gate

### milestone condition：游戏门槛

例如 `mt1-gate-1559` 要求楼层、HP、攻防、EXP 和指定战斗生存条件。它决定一个 State 是否算过关。

### audit validity check：报告有效性检查

审计报告可以检查：

```text
strict replay 是否有效
搜索是否真的执行
是否完整结束
goal/segment/merged pipeline 是否观察到
future oracle 是否执行完整
commit 是否稳定
```

它不改变搜索，也不等价于游戏过关。

## F. replay、oracle、repair

| 术语 | 中文解释 |
|---|---|
| strict replay | 用 route 的 decisions 重新执行，并逐步比较 exact state |
| full-route replay | 从起点 replay 完整 route，而不是只 replay suffix |
| oracle-only | 为了回答诊断问题，沿已知 teacher decisions 做对照；不代表生产搜索选出了它 |
| repair | 当前 segment 没找到结果后，扩大上一段或重试当前段的补救路径 |
| configured repair | 按配置的 milestone window 重跑 |
| retry-current | 重试当前 segment |
| expanded-previous | 扩大上一 segment 重新生成入口 candidates |
| `completed-with-search-failures` | 矩阵流程结束，但至少一个 policy/search run 失败 |

## G. Decision 3 的专用标签

如果 teacher 状态 TA 被 dominance witness PB 替代，而 PB 执行同一个 action 后与 TA exact rejoin，建议报告写：

```text
pre-state-replaced-by-continuation-compatible-witness
exact-rejoined-at-post-state
```

不要把它解释成“production 没有生成这一步”。真正需要验证的是：

```text
原状态被谁替代？
替代状态能否执行相同 action？
执行后 exact state 是否相等？
```

## H. 资源时序与未来价值

| 术语 | 中文解释 |
|---|---|
| resource timing | 资源现在消费还是推迟消费的时序决策 |
| `futureDamageSaving` | 推迟或改变资源顺序后，未来战斗预计少损失多少 HP |
| `retainedResourceOption` | 保留某资源给未来的选择价值 |
| `combat-breakpoint` | 某个攻防/等级变化跨过战斗伤害临界点 |
| `future-survivable-targets` | 因资源时序改变而新增的可存活战斗目标 |

当前模型已经记录完整 mutations 和资源状态，但 Only Up 正式 milestone 链没有默认依赖完整 future-value ranking。因此“candidate-2 最终更好”目前是审计发现，不是生产 selector 已经理解的规则。

## I. 报告阅读速查

看到：

```text
strictReplay.performed = false
```

先问有没有生成 route，不要直接说 replay 失败。

看到：

```text
frontierSize > 0 / stoppedReason = time-limit
```

只能说“在当前边界内没有完成”，不能说全局无路。

看到：

```text
goalAccepted = true
```

说明正式 milestone predicate 通过，不说明后续 milestone 一定能过。

看到：

```text
candidate tag = shortest
```

只说明它被“最短路线角色”保留，不说明它是未来价值最高。
