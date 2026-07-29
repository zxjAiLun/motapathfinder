# Only Up 当前模型边界

这份文档回答一个问题：哪些结论是精确的，哪些只是搜索策略，哪些只是诊断对照。

## 1. 当前主链

```text
原始 H5 项目
  → Project loader
  → StaticSimulator
  → milestone predicate/action policy
  → segment DP / milestone graph
  → checkpoint candidates
  → route record
  → strict replay
  → browser live replay
```

主线代码是 `shared-solver/`。`linear-main`、beam、macro search、resource pocket/cluster/chain 仍有探索价值，但不作为 near-unique route 的最终正确性证明。

## 2. 精确模型：可以相信什么

### 2.1 游戏规则和动作执行

`project-loader.js` 直接读取 Only Up 原始 `project` 数据；`StaticSimulator` 执行移动、战斗、拾取、装备、事件、上下楼和 floor mutation。只要输入数据和 simulator 没有 bug，这部分是规则模拟，不是评分猜测。

### 2.2 State 与 mutation

State 保存背包、flags、visited floors、当前属性、装备和每层 removed/replaced tiles。候选之间“哪只怪还没打、哪件资源还没拿”不会因为只看当前 HP 而从 state 中消失。

### 2.3 Milestone predicate

milestone JSON 定义楼层、属性、资源 present/removed、装备和 action survivability。`buildSegmentGoalPredicate()` 逐项检查；缺任何一项都不是 `goalAccepted`。

### 2.4 Strict replay

strict replay 从 start snapshot 重新执行 decisions，并比较每一步的 pre/post exact state。它可以证明路线记录和 simulator 之间一致，但不能证明浏览器画面已经被人眼看到；浏览器 live replay 是另一层。

### 2.5 Exact state comparison

`buildStateKey()` 包含当前 HP 和关键地图/资源状态。它用于 exact rejoin、route replay 和审计对齐。

## 3. 生产搜索：准确但有边界

### 3.1 Segment DP

`searchDP()` 在当前 action policy 和资源状态下搜索。它不是每个格子一个节点，而是把“走到目标并执行动作”的路径作为 action 的一部分。

### 3.2 DP 压缩

`buildDpStateKey()` 与 dominance 比较会合并或淘汰状态。这个压缩可以在已定义的抽象等价条件下减少组合爆炸，但它仍然依赖：

```text
当前 action provider 是否完整；
DP key 是否保留了真正影响未来的字段；
dominance 比较是否只在安全的同类状态间使用。
```

所以“搜索没有找到”必须同时看 frontier、time/expansion limit、actionTrimmed 和 doctor diagnostics。

### 3.3 Milestone graph

`runMilestoneGraph()` 把一段的出口候选传入下一段。它可以产生 repair phase。repair 不是放宽目标，而是重新安排搜索边界和入口候选。

## 4. 启发式：用于控制规模，不是未来真理

当前启发式包括：

- agenda 的 best-first/FIFO/hybrid 顺序；
- 当前 HP、攻防、EXP、综合战斗分、路线长度排序；
- `highest-*`、`best-combat`、`shortest`、`best-target-margin` 等角色；
- skyline capacity 和 candidate limit；
- 当前 frontier 的 repair 顺序。

这些规则回答的是：

> 在有限时间和有限候选名额下，先展开/先保留哪些代表？

它们没有回答：

> 这个资源现在不消费，等两段以后再消费，最终究竟能多保留多少 HP？

## 5. 本轮审计说明了什么

MT1 的四个 retained candidate 中：

```text
candidate-0：HP 2694，多个 highest-* / target-margin
candidate-1：HP 2638，best-combat / highest-exp
candidate-2：HP 1559，shortest，teacher-compatible gate
candidate-3：HP 1894，无角色标签
```

已知的 future oracle 结果是：只有 candidate-2 能完整走到 `mt2-hp3834`；其他候选当前 teacher suffix 的最终 HP 分别约为 3369、2513、3369。

这不能解释成“算法已经学会了 candidate-2 的长期价值”。更准确的是：

```text
状态记录是完整的；
当前排序仍偏重局部属性和少数代表角色；
candidate-2 因 shortest 角色幸存；
oracle 后验地证明它的 mutation/resource timing 更适合后续路线。
```

因此当前系统确实具有“半枚举”性质：不是枚举全部路线，而是保留多种风格，降低当前评价函数猜错的风险。

## 6. Oracle-only 与生产搜索的边界

future-value oracle 使用已知 teacher decisions 作为对照，回答：

```text
如果从这个 checkpoint 出发，已知 suffix 是否可执行？
会经过哪些 milestone？
最后 HP/资源状态怎样？
```

它不把 teacher action 注入 production search，也不证明 production selector 会主动选择这个 suffix。

报告中出现 oracle 成功时，应理解成“这个 checkpoint 有未来潜力”，而不是“搜索已证明它是最优”。

## 7. 资源时序模型的当前状态

`shared-solver/lib/resource-timing-model.js` 已经有：

- 未来伤害节省估计；
- retained resource option；
- combat breakpoint；
- newly survivable targets；
- resource timing roles。

但这些能力通常只有 milestone 或运行参数显式启用时才进入 DP。当前 MT1→MT2→HP3834 的正式搜索不能被描述成“已经使用了完整 future-value model”。

正确的建模改进顺序是：

1. 比较四个 checkpoint 的 mutation、资源、EXP、hatred 和 auto 状态；
2. 做反事实：只改变一项资源消费时机；
3. 验证最终 HP3834 差异是否仍存在；
4. 将能稳定预测未来结果的因素变成 feature；
5. 先考虑 segment candidate/checkpoint ranking，再考虑更深的 dominance 或 DP key。

不要因为 candidate-2 这一次成功，就把 `shortest` 硬编码成未来价值规则。

## 8. Gate 的正确分类

### 8.1 游戏门槛

`goalAccepted` 是 milestone condition 的结果：State 满足正式游戏目标。

### 8.2 报告有效性检查

audit gate 只检查报告是否有足够证据，例如：

```text
strict replay valid
pipeline stage observed
search completed within configured action set
future oracle complete suffix
commit stable
```

它不参与候选排序，也不改变游戏过关条件。

## 9. 当前已知缺口

```text
1. 局部当前属性排序不能可靠代表长期资源价值。
2. 保留多个角色降低风险，但仍不是未来价值模型。
3. future oracle 能证明差异存在，尚未归因到单一资源因果。
4. candidate attempt/repair 的全局时间会污染“策略失败”和“预算不足”的区分。
5. Route GUI 能看路线和 state diff，但 candidate tag/DP lifecycle 仍主要在 JSON/Markdown 审计里。
```

这五点是后续要先理解、再建模、最后才改搜索的位置。
