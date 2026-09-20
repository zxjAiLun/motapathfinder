# 纳可物语云端长跑诊断 — 堆上限、重复任务与跨层排序

```ini
ROUND = CLOUD_SEARCH_PROGRESS / BASELINE_DIAGNOSIS
STATUS = VERIFIED
DATE_STARTED = 2026-09-20
BASE_COMMIT = 9f9485013af3f9178ab2d299551bf12f80b9e132
SCOPE = 只读账本归因、源码核验、真实 fixture 合法单步后继检查
PRODUCTION_CHANGE = NONE
CLOUD_SERVICE_CONTROL = NONE
```

关联：[部署轮次](../260919/cloud-search-progress.md)、[运维说明](../operations/cloud-search.md)、[PR-5.28a](5-28a.md)。

## 1. 问题、范围与证据门

Owner 要求继续分析此前云端长时间未找到路线的原因。本轮不改 DP key、dominance、排序、flags、profile 或零绿钥匙约束，不添加人工路线/属性门槛，不运行新一轮长搜索，不停止或覆盖云端服务。核验条件为：旧账本计数可重算、停止原因来自 raw diagnostics、排序例子来自真实 fixture 的合法后继、事实与未验证的因果假设分开。

开始核验时 `dev == origin/dev == 9f94850`，tracked 工作区干净；`git ls-remote origin refs/heads/dev` 与本地 HEAD 相同。cloud 当前 release 中 `dp-search.js`、`durable-search.js`、`score.js`、`state.js`、`search-nodes.js` 和 `run-durable-search.js` 六个文件与本地字节 hash 相同。该核验不追溯证明所有历史 worker 的源码身份相同，也不把本轮对比当成冻结条件的性能 A/B。

## 2. 首先更正运行状态与“551 万”的含义

2026-09-20 **19:14:53 上海时间**采集快照：

- 云端并非仍停在 `bounded_not_found`。journal 记录 18:04:28 的显式迁移，将 39 个 bounded 节点重新排入 tier 3；用户服务 18:04:46 启动，快照为 `running`。
- 当前 profile 档位为 8k / 32k / 128k / 256k；总时间上限为 0，单任务仍有时间及内存限制。
- 已完成任务累计 154 次、6,197,931 expansions；其中旧三档是 147 次、5,512,921 expansions，新 tier 3 已完成 7 次、685,010 expansions。当前在途任务的展开数不包含在这个累计中。
- 53 个 durable 节点按阶段为 **1 / 18 / 34 / 0 / 0**。34 个 TS13 入口互异；全部 53 个入口在各自阶段内的生产 DP key 也互异，不能称它们只是同一 checkpoint 的重复副本。

**5,512,921 是多入口、多档位局部任务的展开数之和，不是同一个 frontier 连续推进了 551 万步，也不是 551 万个全局唯一状态。** 旧账本还包含一次早期 6h 总时间墙截断；随后恢复才完成其余任务。因此先前“所有节点耗尽展开预算”“首轮全程无时间墙”的概括应以本节 raw evidence 更正。`bounded_not_found` 的有效负结果保留，但不代表 frontier 搜尽或数学无解。

## 3. 实际停止在哪里

### 旧三档的分段消耗

| 局部目标 | 不同入口 | 尝试次数 | 累计展开 | DP wall time 合计 | 命中目标的尝试 |
| --- | ---: | ---: | ---: | ---: | ---: |
| TS11 → TS12 | 1 | 3 | 27,216 | 0.030 h | 3 |
| TS12 → TS13 | 18 | 42 | 979,106 | 1.164 h | 6 |
| TS13 → TS14 | 34 | 102 | 4,506,599 | 6.755 h | 0 |
| 合计 | 53 | 147 | 5,512,921 | 7.949 h | 9 |

wall time 是各次 `diagnostics.dp.wallMs` 之和，不是从 createdAt 到现在的自然时长。TS13 阶段占展开量 **81.75%**、DP 时间 **84.98%**。没有产生 TS14 入口，后两段没有获得执行机会。

### TS13 阶段按档位拆分

| 档位 | 尝试 | 停止原因 | 目标命中 |
| --- | ---: | --- | ---: |
| 8,000 | 34 | 34 × `expansion-limit` | 0 |
| 32,000 | 34 | 34 × `expansion-limit` | 0 |
| 128,000 | 34 | **33 × `heap-limit` + 1 × `time-limit`** | 0 |

33 个 heap-limit 任务：

- 实际展开 **75,629～104,546**，中位 94,295，均未达到 128,000。
- 停机时仍有 **17,174～45,895** 个 active frontier entries，中位 31,340。
- heapUsed **5,222.0～5,222.5 MiB**；RSS **5,453.4～5,463.5 MiB**。先触发 `maxHeapMb=5222`，不是 8192 MiB RSS 上限或 systemd 9 GiB 上限。
- `searchComplete=false`、`foundGoal=false`；不是搜索穷尽。
- 那一个 time-limit 的实际任务预算被当时剩余总时间压到 **37,611 ms**，实际 37,627 ms，不是正常 30 分钟任务耗尽。

全 147 次记录中 `actionTrimmed=0`、`beamDropped=0`、invalid 计数为 0。TS13 高档任务单状态最多生成 7～10 个动作，远低于 4096 动作上限；不能把本次失败归因于 action quota 或 beam 裁切。`goalArchiveTrimmed` 是另一层限制，见后文。

## 4. 持久化调度没有解决重复工作

`lib/durable-search.js:272–304` 每次重新读取 durable 起点并调用全新的 `searchDP`；DP frontier、bestByKey 和节点表不跨任务保留。`integrate()`（260–266）对 `!searchComplete || archiveTrimmed` 统一升到下一档，没有按原停止原因区分“加哪项预算才可能改变结果”。

快照内新 tier 3 的 **7/7** 次尝试仍为 heap-limit：

- 又消耗 **685,010 次展开 / 63.17 分钟**，没有新目标候选。
- 实际只展开 89,666～102,266，而不是 256,000。
- 同入口相对旧 128k 尝试的展开差为 `+1160, -1149, -2376, +2506, +2108, -1324, -2204`，表现为同一内存阈值附近波动，而非接续旧 frontier。
- 两次尝试 `min(oldExpansions, newExpansions)` 合计 679,236，占新增工作计数的 99.16%。**这里只是计数重叠量，不是已保存逐 key 序列的实测重复率**；历史数据不足以证明精确跨运行去重比例。

另一个确证的低收益重试：TS11→TS12 已在 tier 1 于 9,608 次展开 drain，但 759 个 active goal entries 只返回 16 个，因此 `archiveTrimmed=true`。下一档仍是相同 candidateLimit=16，又在 9,608 次 drain；两条 TS12→TS13 成功入口也在 tier 1/2 重现相同 29,357 / 14,884 展开与 146 / 73 active goals、返回 16。

**结论：提高展开/时间上限既不能解除不变的堆上限，也不能解除不变的目标候选上限。** 这不是持久化丢档，而是重试升级没有针对实际限制因素。

## 5. 状态空间增长之外，默认排序也存在目标不匹配

TS13 阶段 102 次任务的累计 accepted-node admissions：

| 节点所在楼层 | 累计接纳数 |
| --- | ---: |
| TS11 | 4,156,889 |
| TS12 | 1,924,489 |
| TS13 | 191,346 |

**96.95% 的接纳发生在 TS11/TS12。** 这是累计接纳数，包括相同 key 的改善代表和重跑，不是唯一状态数，也不是按楼层统计的 expansions。

源码机制：

- `score.js:23–37` 的 `estimateNextFloorDistance()` 只计算到**当前楼层 `:next` 楼梯**的曼哈顿距离，不是到本任务目标 TS14 的距离。
- `dp-search.js:492–509` 默认先比较历史 `bestFloorRank`，然后比较该距离，再比较当前楼层与属性。
- 回访旧楼层保留历史 `bestFloorRank`；`durable-search.js` 传入 goalPredicate，但没有 goal-relative priority projector。

三个真实 TS13 fixture 的合法单步后继均复现：

| 后继类别 | 历史最高楼层 rank | 本层下一楼梯距离 |
| --- | ---: | ---: |
| 返回 TS12(1,1) | 539013 | **0** |
| TS13 内两种合法战斗后的站位 | 539013 | **19 / 18** |

由当前 comparator，返回旧楼层的候选在这个比较项上优先，甚至早于比较当前楼层或 HP。这是**可复核的排序偏向**，与旧楼层接纳占比一致。

**解释边界**：不能把回访全部叫无效循环；旧楼层资源可能是必要准备。同 key 纯循环会被 dominance/route tie-break 拒绝，真正不同的 mutation/资源组合仍应保留。本轮没有证明哪一个正确延续被饿死，也没有证明改排序能通关。后续只能先观察同一冻结语料的 enqueue/pop、等待时间及资源准备因果，不能直接禁回头或植入已知路线。

## 6. 内存原因尚须区分 live set 与瞬态分配

已核实的实现与计数：

- heap-limit 时 `nodesSize` 为 **120,729～138,038**；canonical DP 的 `nodes` Map 保存所有已接纳 search node（`dp-search.js:1338,2012`），node 保留完整 `state` 和回放血缘（`search-nodes.js:59–73`）。这条 canonical DP 路径没有套用历史实验家族的 dropped-state reclamation。
- `cloneState()` 使用深克隆（`state.js:10–15`）；每个状态保留其完整未来语义。历史突变及 JSON DP key 确实有存储代价，但目前没有各对象类型的 retained-byte 归因。
- canonical 状态中非空 route 数为 **0**，所以不能归咎于旧式“每节点完整 route 数组复制”已经重新出现。
- heap 检查直接停止（`dp-search.js:2482–2484`）；GC 重试仅在 RSS 检查分支。worker execArgv 只有 `--max-old-space-size=6144`，未传 `--expose-gc`；账本中的显式 RSS GC 计数为 0。**这不等于 V8 自动 GC 未发生**。

因此已证明的是“达到堆保护线”；尚未证明 5.2 GiB 全是必须保留的 live set。不能不做 heap/对象生命周期取证就称内存泄漏、声称 GC 一定能解决，或据此提高安全上限。

## 7. 已有 shadow 审计可以、不能说明什么

- Repair 1b 对 mutation-drop 抽象的真实反例继续有效，永久拒绝不变；生产 DP 支配探针仅支持 sampled pairs 中未发现反例，不是全塔健全性证明。
- PR-5.28a 工件确实记录 900 个采样状态、66,077 次 mutation 检查，dead=0、collapse=0。
- **同时 collisionGroups=0、sameHpEquivalencePairs=0、hpDominancePairs=0、totalTransitionsAudited=0。** 因此“0 violations”是没有发生抽象合并情况下的零，不能包装成非空的转移正确性验证。
- 准确结论是：**当前保守谓词在这些样本上没有证明任何 mutation 可删除**。不等于所有 mutation 都被证明永远不可压缩，也不意味着必须逐节点以当前对象表示重复存储相同数据。

## 8. 建议与未授权事项

已证实的直接问题排序：

1. TS13 高档任务由堆上限终止，仍有大量 frontier 未服务。
2. 相同内存/candidate cap 下，durable 仅增加展开预算并重跑入口，重复成本高。
3. 默认“本层下一楼梯”排序有利于退层候选；大量工作在回访组合上展开。它对通关失败的独立因果贡献尚待测量。
4. 上游候选 archive 已发生裁切；有路线是否被漏在候选之外未知，不能把 34 个入口 MISS 泛化为整个试炼无解。

**下一建议 gate（PROPOSED，等待 owner 授权）**：一个有界、只读的 TS13 内存驻留与 agenda 服务分布审计。冻结现有 DP key、dominance、排序及内存保护线，量化 post-GC live/transient bytes、节点/skyline/回放血缘/key/cache 的驻留责任及真实 pending 候选等待分布；再决定做无语义损失的表示/生命周期优化，还是另开目标相对排序的受控实验。

不建议继续原样扩大 tier；可由 owner 决定有序暂停当前重复 heap-limit 的任务。本轮**没有执行暂停、重启、迁移或发布**。不直接修改生产 key、减少 skyline、禁止回访、提高堆上限或引入人工阈值。

## 9. 工件与验证

本地 ignored 证据目录：`shared-solver/routes/generated/cloud-search/diagnosis-20260920/`。

- `cloud-snapshot.json`：cloud journal/status/profile，SHA256 `41eee37d12da36f2279fa287530c04a326ff1ea06118a5725a9399bd0d79a574`。
- `checkpoints-and-source.json`：53 个入口、相关 task 输入及六个远端源码 hash，SHA256 `676f6fae279bfe1a8c1351f196b758112dba1d485f3e928dd323f56b854cda9e`。
- `analyze-baseline.js` → `summary.json`：离线重算计数、核验源码及三个真实合法后继例子；不执行搜索。
- 现有 `shared-solver/routes/generated/shadow-audits/*.liveness.json`：核验包括 totalTransitionsAudited 在内的原始指标，未重跑 shadow search。

实际验证：

```text
node -c shared-solver/routes/generated/cloud-search/diagnosis-20260920/analyze-baseline.js
  exit 0
node shared-solver/routes/generated/cloud-search/diagnosis-20260920/analyze-baseline.js
  exit 0; baseline 147 / 5512921; heap cases 33; source parity 6/6; rank witnesses 3/3
```

仅文档进入本轮 publication boundary，采集工件与一次性分析脚本保留 ignored。本轮未跑 full static/qualification，未生成通关路线，未 commit/push。
