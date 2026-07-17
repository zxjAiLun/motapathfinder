# Auto-Decomposition Solver Handoff

本文供后续开发 Agent（当前计划为 HY3）快速接手路线搜索与自动因果拆段工作。它描述当前工作区的真实状态、已经实现但尚未提交的功能、尚未通过的验收目标，以及后续开发和 review 的协作边界。

最后更新：2026-07-12。

## 1. 五分钟结论

项目的 canonical solver 在 `shared-solver/`。不要向塔目录或塔内冻结的 `solver/` 副本添加新算法。

当前主目标是：

```text
输入：window-repair-mt5.route.json 的前 59 个 decisions + 最终 I894 checkpoint
约束：不读取人工 17 段 milestone 顺序，不读取教师路线动作
输出：solver 自动生成必要 milestone，并构造含原前缀的完整 route record
验收：10 分钟、1 GB Node heap 内找到路线，并通过 strict replay
```

目标路线确实存在。生产搜索目前尚未在单次 10 分钟运行内完成 I894，因此不能把当前结果描述为“已找到路线”。

当前算法已经自动复现正确路线中的多个关键状态，证明因果 landmark 方向基本正确；主要瓶颈已经从“找不到合理中间状态”转为“分支调度和搜索吞吐不足”。

## 2. 必须先理解的两个起点

`routes/generated/window-repair-mt5.route.json` 的完整终态 HP 是 `51533`，位于 `MT5:6,12`。

自动拆段验收使用的是该 route 的第 59 步状态：

```text
floor: MT4
HP: 25624
atk/def/mdef: 387/305/4210
equipment: I893
```

因此“51533 route”表示 seed route 文件，不表示自动拆段从 HP 51533 的终态开始。CLI 必须带：

```text
--start-route=routes/generated/window-repair-mt5.route.json
--start-route-step=59
```

## 3. 代码所有权和禁止事项

允许修改：

```text
shared-solver/lib/**
shared-solver/*.js
shared-solver/milestones/**
shared-solver/profiles/**
shared-solver/gui/**
docs/**
```

禁止：

- 不修改 `Only upV2.1/**`、`whiteisland（9）/**` 中的 solver/runtime 文件。
- 不把 reusable solver 逻辑放入塔目录。
- 不把已知正确路线的 actions、decision summaries 或人工 milestone 顺序接入生产搜索。
- 不把 beam miss、time limit、memory limit 或 action trimming 表述为“无路线”。
- 不以 `goalSkyline`、独立 repair candidate 或 generated profile success 代替完整 route strict replay。
- 不提交 `routes/generated/`、segment cache、运行日志等实验产物。

已知正确的 86 步路线只能用于测试侧：证明目标可达、对比关键状态和评估自动 landmark 覆盖率。生产模块不得引用该 fixture 的文件名或内容。

## 4. 已实现功能

### 4.1 已提交的 Route Repair 主线

最近已提交 checkpoint：

```text
8b021ee Add sequential route repair replay validation
1081889 Add suffix bridge recovery to route repair
d773876 Preserve suffix bridge skyline candidates
6c1596c Enforce LF for canonical sources
```

现有能力包括：

- route debugger pre-state inspector。
- route audit 和 Resource Intent Scanner。
- 多轮 blocker clearing。
- 顺序 repair：一次应用一个真实 action patch，完整 replay 后才接受。
- suffix bridge：原后缀 action 不可用时使用 canonical segment DP 重连接。
- 多 skyline bridge：保留多个 bridge candidate，短程筛选后完整 replay。
- debugger repair annotation 和 accepted/rejected 诊断。

这些能力仍是自动拆段的基础诊断和修复层，不是 I894 自动搜索已经成功的证据。

### 4.2 当前工作区的 Window Repair

主要文件：

- `shared-solver/lib/route-window-repair.js`
- `shared-solver/route-repair.js`
- `shared-solver/profiles/window-mt5.json`
- `shared-solver/check-window-repair.js`
- `shared-solver/check-mt5-window-repair-closure.js`

已实现：

- 一基闭区间 window 语义。
- 三阶段 skyline DP window 优化。
- profile 文件加载、目标自动推导和完整 goal 校验。
- rebuilt route strict replay。
- 全局唯一 candidate ID 和跨 start-state 诊断聚合。
- debugger window report annotation。

MT5 window repair 产出 HP 51533 的 seed route。生成文件位于 ignored `shared-solver/routes/generated/`。

### 4.3 MT5 下一 Checkpoint 诊断

主要文件：

- `shared-solver/milestones/onlyup-mt5-51533-next.json`
- `shared-solver/milestones/onlyup-mt5-51533-prefix59-i894.json`
- `shared-solver/check-mt5-51533-next.js`
- `shared-solver/run-segmented-dp.js`

已实现：

- 从 seed route 或 prefix59 状态运行 I894 segment。
- segment diagnosis JSON 输出。
- I894 目标的 floor、装备、属性和资源保护 schema。
- 小预算 smoke diagnosis。

### 4.4 自动因果拆段

主要文件：

- `shared-solver/lib/milestone-decomposer.js`
- `shared-solver/run-adaptive-segment-dp.js`
- `shared-solver/check-auto-milestone-decomposition.js`
- `shared-solver/lib/dp-search.js`
- `shared-solver/lib/segment-dp.js`

入口参数：

```text
--auto-decompose=1
--global-runtime-ms=600000
--global-max-heap-mb=1024
--decompose-max-nodes=64
--decompose-branch-width=3
--decompose-max-depth=24
--decompose-report=<file>
--out-generated-spec=<file>
--start-route-step=59
```

已实现的 orchestrator 能力：

- 先直接搜索最终目标，失败后使用 frontier、archive、mutation、装备、属性、资源、mobility 和 doctor 信号产生 landmark。
- landmark 只描述必要 mutation/属性变化，不复制完整动作顺序。
- start-to-checkpoint 和 checkpoint-to-target 双向 probe。
- probe、normal、escalated 分级预算。
- 全局 runtime、heap 和 decomposition node ledger。
- branch width、递归深度、landmark 数和 probe 数上限。
- `preferredPresentTiles` 软保护，以及经反事实探测升级的硬 `presentTiles`/`protectedTiles`。
- HP resource timing、combat transition、mobility 和 target-balance skyline 角色。
- milestone minimization 和 generated profile 再验证。
- 完整 route action replay、最终 goal 校验和 strict replay。
- 失败报告区分 time/memory/action scope/model/action-space exhaustion。

### 4.5 持久 Segment Cache

cache schema 当前为：

```text
motapathfinder.segment-decomposition-cache.v5
```

cache key 包含：

- project signature。
- dominance state key。
- hero HP 和 HP max。
- canonical goal。
- action policy。
- DP config。
- schema version。

重要修复：早期 cache key 未包含 HP，会把不同 HP 的相同 dominance state 混用，产生无法 strict replay 的伪路线。不得移除 HP 隔离。

cache-hit 候选边界会主动清理 simulator expansion cache 并 GC。该修复将 warm run 的 peak heap 从约 1085 MB 降到约 122–180 MB。

### 4.6 当前 Beam 和 Landmark 修复

已实现：

- 进入新楼层前保留高质量 preparation checkpoint。
- 跨楼层准备态可触发 escalated skyline，不依赖 scout 必须归档 mobility action。
- landmark 上限按角色保留 mobility、current frontier、best progress 和 highest HP。
- beam drop 节点进入 deferred queue，不再永久丢失。
- deferred queue 使用独立 balance/progress/HP 角色恢复。
- visited signature 同时使用 state dominance key 和 HP dominance，防止无进度循环。

## 5. 当前真实进度

自动拆段已从 prefix59 自动复现以下关键状态，无人工 milestone 顺序：

```text
44773 / atk737  / def705 / mdef4210
94563 / atk877  / def745 / mdef5910
78915 / atk927  / def795 / mdef5910
93836 / atk927  / def745 / mdef5910
42992 / atk977  / def795 / mdef6110
51280 / atk977  / def895 / mdef6110
4551  / atk1077 / def895 / mdef6110
105876 / atk1077 / def895 / mdef6110
63191 / atk1097 / def915 / mdef6310
105138 / atk1297 / def1165 / mdef6310
```

这些状态与教师路线的关键阶段一致，但尚未被连接为通过 strict replay 的 I894 完整路线。

最新代表性运行：

```text
report: routes/generated/auto-decompose-mt5-cache-v5-balanced-deferred.json
found: false
stoppedReason: global-time-limit
nodes: 34
cache hits/misses: 471/140
peak heap: 143.8 MB
peak RSS: 997 MB
```

随后实验已证明 exact tail states 能生成，但 deferred 恢复和主 beam 调度仍会优先处理其他资源支线。不要继续仅靠重复 warm run 推进；下一阶段应修调度和每节点成本。

## 6. 快速运行

安装：

```bash
npm ci --prefix shared-solver
```

生成或验证 window seed：

```bash
npm run run:window-repair:mt5 --prefix shared-solver
npm run check:window-repair --prefix shared-solver
```

运行自动拆段：

```bash
npm run run:auto-decompose:mt5 --prefix shared-solver
```

输出：

```text
shared-solver/routes/generated/auto-decompose-mt5.report.json
shared-solver/routes/generated/auto-decompose-mt5.spec.json
shared-solver/routes/generated/auto-decompose-mt5.route.json  # 仅成功且 strict replay 后存在
```

快速 focused check：

```bash
npm run check:auto-decompose --prefix shared-solver
```

检查报告时优先看：

```text
found
stoppedReason
strictReplay
finalGoalFailures
budgetLedger
decompositionNodes
landmarkCandidates
twoSidedProbes
backtrackedBranches
cacheStats
peakHeapMb / peakRssMb
```

## 7. HY3 后续开发计划

### Phase A：完成正确尾段分支调度

目标：让已经生成的 `105876 -> 63191 -> 105138` 因果线稳定进入 active queue，并继续到 I894。

任务：

1. 为 deferred node 增加父节点因果连续性信息，例如 parent checkpoint role、resource transition、target-gap delta 和 lineage progress。
2. deferred 恢复至少保留三个角色：同 lineage best-progress、最小新增资源且目标缺口下降、最高 target balance。
3. 不能仅按 HP、浅 depth 或全局最低 resource 排序。
4. 当 active 分支耗尽时恢复 deferred；必要时允许定期插入一个高因果 deferred 节点，但同时活跃宽度仍为 3。
5. 报告恢复原因和被替换 active node，保证调度可解释。

验收：无需教师输入，报告中正确第二回血和高属性节点被实际展开，不只是出现在 `decomposition-beam-deferred`。

### Phase B：得到首条 strict I894 route

任务：

1. 沿自动生成 milestones 完成最终 I894 segment。
2. 构建包含原 59 步前缀的 route record。
3. 从初始状态重新 replay route decisions。
4. 验证 floor、I894、全部 minHero/minEffectiveHero、removed/present tiles。
5. route signature 不得依赖 teacher fixture。

硬验收：

```bash
node shared-solver/check-route-record.js \
  --route-file=shared-solver/routes/generated/auto-decompose-mt5.route.json
```

只有该检查和 decomposer `strictReplay.passed=true` 同时成立，才能写“找到路线”。

### Phase C：从多轮 warm 收敛到首次冷跑 10 分钟

当前主要性能问题：

- 每个 DP expansion 可能非常昂贵，runtime 只能在 expansion 边界检查。
- warm run 仍反复 hydration、trace resource replay 和 landmark probe。
- 主 beam 每轮重新处理已稳定的前半段节点。
- cache 命中降低 expansions，但对象重建和诊断仍有明显成本。

建议顺序：

1. 对 cache hit 保存/恢复更紧凑的 action summary、goal skyline 和必要 state，避免恢复无用 archive。
2. 缓存 landmark extraction 和 resource trace，key 继续包含 HP、goal、policy、schema。
3. 给昂贵 action enumeration/apply 阶段加入 deadline/cancellation 检查，避免单 expansion 穿透 segment runtime。
4. checkpoint 成功后持久化 decomposition frontier，使下一次可从未完成节点继续，而不是从 root 重放。
5. 记录每类成本：cache read/hydrate、action enumeration、apply、resource trace、landmark replay、GC。
6. 冷 cache 重跑，禁止预热后冒充首次验收。

性能验收：冷 cache、单进程、10 分钟、Node heap 1 GB 内成功；报告必须记录 wall time、peak heap、peak RSS、search nodes 和 expansions。

### Phase D：自动 milestone 最小化

路线成功后再做，不要提前优化：

1. 反向删除自动 milestone。
2. 使用固定中等预算验证相邻 segment 是否可合并。
3. 只保留删除后无法稳定复现的 checkpoint。
4. minimized spec 再次完整搜索并 strict replay。

### Phase E：重型验收和防教师泄漏

新增独立 `check:auto-decompose:mt5`，不加入日常快速 static chain。

检查内容：

- 输入只有 seed route、step59 和最终 I894 goal。
- 生产模块静态扫描不得引用教师 route 文件名或 action summaries。
- 冷 cache 首跑满足 10 分钟/1 GB heap。
- 第二次运行 cache hits 增加且 segment searches/expansions 明显下降。
- 成功 route strict replay。
- minimized profile 再搜索成功。

## 8. 实现原则

HY3 修改代码时遵循：

- CommonJS、`"use strict";`、两空格缩进、分号、kebab-case 文件名。
- reusable logic 放 `shared-solver/lib/`，CLI 只做参数和 I/O。
- 结构化数据使用对象和 parser，不用字符串猜测状态。
- 每个新 heuristic 都必须在 report 中可观察，并有 focused regression。
- cache key 变更时升级 schema，旧 cache 自动失效。
- 不使用 `allowRouteMismatch` 掩盖重放问题。
- 不扩大预算掩盖 `completeWithinActionSet=true && frontierSize=0`。
- `actionTrimmed>0`、portal/changeFloor scope 缺失时先修 action scope。
- `presentTiles` 默认软约束；只有反事实验证后才升级为硬约束。
- 不做无关重构，不格式化用户未要求的文件，不制造 CRLF 大 diff。

## 9. Review 和协作协议

职责划分：

- HY3：实现、focused tests、运行报告、解释行为变化。
- Codex：制定阶段方向、代码 review、回归门禁、进度真实性把关。
- 用户：决定是否接受阶段 checkpoint、是否提交和是否扩大目标范围。

HY3 每轮 response 必须包含：

```text
1. 本轮假设和要修的具体 failure
2. 修改文件及行为变化
3. 新增/修改的 regression assertion
4. 实际运行命令
5. report 文件和关键字段
6. strict replay 状态
7. 未解决问题和下一步，不得只写“全部通过”
```

Codex review 顺序：

1. **P0 Correctness**：伪路线、状态污染、cache key 错误、teacher 泄漏、塔目录污染、strict replay 缺失。
2. **P1 Semantics/Risk**：错误 failure classification、预算失控、action scope 不完整、candidate 隔离失败、report 与真实状态不一致、测试未真正执行 assertion。
3. **P2 Maintainability**：重复逻辑、CLI/核心边界、命名、过大函数、无效字段、缺少 focused test。

Review 结论必须 findings-first，并给出文件/行号。没有问题时明确写“未发现阻塞问题”，同时列出未运行的重型检查和剩余风险。

以下情况不得进入下一阶段：

- focused check 未通过。
- report 不可持久核验，只给口头数字。
- route 未 strict replay。
- 失败原因仍被统一写成 `no-route`。
- 代码读取教师路线。
- 10 分钟预算由单 segment 穿透且没有稳定诊断。

## 10. 提交前回归

至少运行：

```bash
node shared-solver/check-route-debugger.js
node shared-solver/check-route-gui-compare.js
node shared-solver/check-progressive-monster-planner.js
node shared-solver/check-route-audit.js
node shared-solver/check-route-repair.js
npm run check:auto-decompose --prefix shared-solver
npm run check:window-repair --prefix shared-solver
npm run check:core --prefix shared-solver
npm run check:no-tower-solver-js --prefix shared-solver
```

如果生成成功路线，再运行：

```bash
node shared-solver/check-route-record.js \
  --route-file=shared-solver/routes/generated/auto-decompose-mt5.route.json
```

GUI 文件发生变化时才需要浏览器截图，并检查宽屏和窄屏无重叠。

## 11. 当前工作区提醒

自动拆段、window repair 和 MT5 checkpoint 相关文件目前仍是未提交工作。开始开发前先运行：

```bash
git status --short
git diff --check
```

不要重置、覆盖或格式化这些改动。建议后续按功能拆分 checkpoint commit，而不是把 window UI、segment diagnostics、auto decomposition 和实验 fixture 混为一个提交。
