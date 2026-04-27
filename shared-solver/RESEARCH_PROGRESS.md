# 研究进度记录

更新日期：2026-04-26

## 0. 2026-04-26：MT2 3834 分支搜索语义改造进度

### 0.1 本轮目标

本轮目标不是继续手动微调路线，而是让 `shared-solver` 的搜索能自己识别这类路线：

```text
先承受一场中高伤战斗
=> 打开资源链
=> 拿属性 / 装备 / 功法
=> 回头清低伤或 0 伤怪
=> 在同一合流局面保留 HP 更高的分支
```

当前重点样本是 `MT2 hp=3834` checkpoint 后的左线：

```text
battle:bluePriest@MT2:2,8（初诞灵）
battle:brownWizard@MT2:3,10（青年法师）
battle:slimeman@MT2:4,11（石精）
changeFloor@MT2:6,12
changeFloor@MT3:6,12
battle:redWizard@MT2:11,11（武装橙毛茸茸）
battle:brownWizard@MT2:6,6（青年法师）
battle:yellowGateKeeper@MT2:6,8（契境凶兽）
equip:I893（功法）
changeFloor@MT2:6,12
```

目标状态：`MT3 hp>=8425 atk>=107 def>=100 mdef>=510 exp>=31 equipment includes I893`。

### 0.2 已完成改动

- **回归固化**：新增 `check-mt2-resource-branch.js`，从 `routes/latest/fixed-1f-mt2-four-priests-hp3834.route.json` 出发静态 replay 用户分支，并验证 `battle:bluePriest@MT2:2,8（初诞灵）` 排名高于 `changeFloor@MT2:6,0`。
- **npm 脚本**：新增 `check:mt2-branch`，并接入 `check:static`。
- **中英标签**：新增 `lib/enemy-labels.js`，提供 `getEnemyName()`、`formatEnemyLabel()`、`formatActionLabel()`；route summary 仍保持英文机器可读格式。
- **移除 hpmax 判断**：`lib/dominance.js` 不再把 `hpmax/manamax` 当 dominance resource fields；`lib/simulator.js` 的 pocket/search confluence 比较只看 `hp/atk/def/mdef/lv/exp`。
- **resource lookahead**：新增 `lib/resource-lookahead.js`，用于 action scoring 阶段做有界局部前瞻，识别“当前亏血但后续打开资源链”的动作。
- **stage-policy 接入**：`lib/stage-policy.js` 在 `mt2-resource-return-or-mt3` 阶段启用轻量 lookahead，并抑制仍有资源动作时的 backward `changeFloor` 抢分。
- **resource-prep 评分统一**：`lib/search-profiles.js` 的 `stage-mt1-mt11-resource-prep` 改为走 `sortStagePolicyActions(..., { policyMode: "resource-prep", enableResourceLookahead: true })`。
- **主搜索 HP 合流框架**：`lib/search.js` 与 `lib/simulator.js` 新增 search confluence key / HP skyline 框架，默认只在 `floorOrder >= 2` 时生效，避免 MT1 可达区扫描过重。
- **resourceChain 实验宏**：`lib/simulator.js` 新增 `resourceChain` 宏动作能力，使用 lookahead 的 `bestPlanEntries` 生成资源链宏；默认关闭，通过 `enableResourceChain` 或 CLI `--resource-chain=1` 开启。

### 0.3 当前验证结果

已通过：

```bash
cd shared-solver
npm run check:mt2-branch
npm run check:pocket
```

`check:mt2-branch` 当前输出核心结果：

```json
{
  "staticReplay": { "hp": 8425, "atk": 107, "def": 100, "mdef": 510, "exp": 31 },
  "ranking": {
    "blueIndex": 0,
    "backIndex": 1,
    "blueLabel": "battle:bluePriest（初诞灵）@MT2:2,8"
  }
}
```

已通过语法检查：

```bash
node -c lib/simulator.js
node -c lib/search.js
node -c lib/stage-policy.js
node -c lib/search-profiles.js
node -c lib/resource-lookahead.js
node -c lib/enemy-labels.js
node -c check-mt2-resource-branch.js
```

### 0.4 已知问题

- `node check-mt2-resource-branch.js --search` 仍偏慢，因此默认 `check:mt2-branch` 只跑静态 replay 和首步排序验证。
- 整段 `run-mt1-mt11 --profile=stage-mt1-mt11-resource-prep` 仍偏慢，本轮尚未完成从 MT1 到 MT5 的稳定自动搜索。
- `resourceChain` 目前是实验开关，不默认启用；后续要补 route-store 展开、GUI replay、生成频率限制和性能回归。

### 0.5 下一步建议

1. 先让 `check-mt2-resource-branch.js --search` 在固定时间内通过，只从 `hp=3834` checkpoint 搜索，不从 MT1 前缀开始。
2. 优化 lookahead / resourceChain 性能：限制生成候选、复用 primitive actions 缓存、缓存 confluence 可达区签名。
3. 打通 `resourceChain` 的 route 保存和 `route-gui.js` 回放，确保宏动作最终落盘为 primitive 决策序列。
4. 再回到整段 `run-mt1-mt11 --to-floor=MT5`，比较 `--resource-pocket-mode=off/lite` 和 `--resource-chain=1` 的 bestProgress。

## 1. 目标与当前结论

当前目标是为这个 h5mota 塔搭一个 `MT1 -> MT11` 的最小可用求解原型，停止条件为首次进入 `MT11`，搜索输出为 `top-k` 路线，并支持可插拔的 `score(state)`。

当前已经确认的总体路线是：

- 不走“实时操作游戏 + 读显伤数字”的黑箱方案。
- 采用“外部做状态搜索 + 复用塔内规则”的方案。
- 搜索动作以宏动作为主，不做全局逐步移动搜索。
- 评分与停止条件独立于游戏原生结算逻辑。

这条路线现在已经跑通到“可搜索、可回放、可做 live runtime 对齐验证”的阶段。

## 2. 当前架构

当前骨架主要分为四层：

1. 项目与规则加载  
   读取 `project/*.js`、楼层、怪物、道具、地图与函数脚本。

2. 状态与动作层  
   维护勇士属性、背包、flags、地图变更、楼层访问记录、route、自动步骤统计等。

3. 搜索层  
   做宏动作枚举、评分、beam trimming、dominance pruning、局部目标导向排序。

4. 验证层  
   把搜索出的路线回灌到实际 h5mota runtime 里做逐步执行和状态对比。

## 3. 已完成内容

### 3.1 数据与状态

已完成：

- 项目数据加载
- 初始状态构建
- 状态克隆、判重键、dominance key
- 地图移除/替换状态记录
- route 记录
- 自动步骤与显式决策深度分离

补充说明：

- 自动拾取/自动清怪会写入 `route`，但不增加 `decisionDepth`
- `cloneState()` 已处理派生缓存失效，避免旧的 frontier 特征被错误复用

### 3.2 规则复用

已接入：

- `project/functions.js -> getDamageInfo`
- 战斗后经验/金币/升级处理
- `firstArrive`
- `eachArrive`
- `autoEvent`
- 一部分结构化事件执行

当前支持的事件子集：

- `setValue`
- `openDoor`
- `if`
- `choices`
- `hide`
- `setBlock`
- `changeFloor`

### 3.3 动作与搜索

已完成：

- 宏动作搜索骨架
- `top-k` 结果容器
- 可插拔 `score(state)`
- 同层区域桶剪枝
- 楼梯目标带（target band）压缩
- 目标楼层收益预估
- beam width / per-floor beam / per-region beam
- dominance pruning
- trim 后前沿状态重建，避免已裁掉的旧状态继续干扰搜索

### 3.4 自动行为

已完成并默认开启：

- 自动拾取
- 自动清怪

这两项逻辑复用了塔里插件规则的核心判定思路，作用是减少“顺手捡物品/顺手清 0 伤怪”的无意义显式分支。

### 3.5 道具与门

已接入：

- 通用门/钥匙约束骨架
- `pickaxe`
- `bomb`
- `centerFly` 占位版保守逻辑
- 装备切换与装备加成

当前的道具与门逻辑已经按“可扩展模块”拆开，后续继续补颜色门、特殊门、特殊工具时，不需要重写搜索核心。

### 3.6 移动副作用

已补入一部分移动侧处理，当前搜索不再是纯 BFS 走格子模型。

已经补到搜索链路里的内容包括：

- 终点步进结算
- 一部分埋伏/夹击/捕捉相关逻辑
- ambush / between-attack-aware walking

但移动副作用还没有完全和游戏 runtime 对齐，见后面的“已知缺口”。

### 3.7 局部目标策略

已单独抽出一个可复用的局部目标策略模块：

- `MT1 -> MT2 -> MT1` 的阶段目标搜索策略

这个模块当前负责：

- 判断当前在“上楼前 / 已上楼未回头 / 已完成回头”哪个阶段
- 判断当前更应该靠近哪一个楼梯目标
- 对候选状态和候选动作做更有针对性的排序

它的目的不是替代主求解器，而是为“局部目标求解 / 局部验证 / 特定阶段搜索”提供一套更强的策略层。

## 4. 已完成验证

### 4.1 主求解器 smoke

当前命令：

```bash
node run-route.js --project-root="../Only upV2.1/Only upV2.1" --profile=linear-main --rank=chaos --top-k=1 --max-expansions=80 --beam-width=120 --per-floor-beam-width=60 --per-region-beam-width=24
```

结果：

- 能稳定启动
- 能稳定展开
- 当前这个小预算下还找不到 `MT11`
- 没有出现结构性崩溃

### 4.2 MT1-MT3 live runtime 验证

当前命令：

```bash
node solver/verify-mt1-mt3-live.js --search-expansions=120 --per-state-limit=6
```

结果：

- 当前可以由搜索器自行找到一条 `MT1 -> MT2 -> MT1` 候选路线
- 候选找到时的当前实测阈值约为 `116` 次扩展
- 搜到的候选路线可在真实 h5mota runtime 中逐步执行
- solver 侧状态与 runtime 侧快照能对齐

当前实测边界：

- `110` 扩展：仍会 fallback 到维护中的后备路线
- `115` 扩展：仍会 fallback
- `120` 扩展：当前可自搜成功

这说明局部搜索策略和 live verifier 已经具备可用性，但离“非常紧预算也稳定自搜”还有一点距离。

## 5. 当前已知缺口

### 5.1 战斗侧

仍未完全覆盖：

- 带支援链的战斗
- add-point 分支
- 一些 UI 相关但可能影响状态的边角行为

### 5.2 移动侧

仍未完全对齐：

- `repulse`
- `zone`
- `laser`
- 其他尚未逐项核实的 `checkBlock` 相关分支

当前搜索已经不是“忽略移动副作用”的模型，但也还不能宣称与 runtime 的每一种步进副作用完全一致。

### 5.3 道具侧

仍需补强：

- `centerFly` 的精确语义
- 更多特殊工具
- 更细的门/钥匙/特殊门逻辑

### 5.4 搜索侧

目前的主搜索仍然存在两个现实问题：

1. 主 `MT1 -> MT11` 搜索在较小预算下还无法稳定推进到更深层。  
2. 局部目标策略已经做成模块，但还没有完整接成“主搜索可选 profile”。

## 6. 当前代码入口

主要入口如下：

- `solver/run-mt1-mt11.js`  
  主求解器 CLI

- `solver/verify-mt1-mt3-live.js`  
  `MT1 -> MT2 -> MT1` 的 live runtime 验证脚本

- `solver/lib/search.js`  
  通用 top-k 搜索框架，已支持前沿比较器、动作裁剪等钩子

- `solver/lib/updown-candidate-policy.js`  
  当前已经抽出的局部目标策略模块

## 7. 后续待做内容

按优先级建议如下。

### P1. 把局部目标策略接回主搜索

目标：

- 让主 `searchTopK` 可以切换到“阶段目标导向”模式
- 避免 verifier 和主搜索长期维护两套策略

具体要做：

- 为主搜索增加可选 policy/profile
- 让 `MT1 -> MT11` 主搜索能在不同阶段切换不同局部目标
- 先从 `MT1-MT3` 再推广到 `MT1-MT10`

### P2. 继续补齐移动侧副作用

目标：

- 尽量把 solver 的步进结算和 `checkBlock` 链对齐

具体要做：

- 优先核实 `repulse`
- 再补 `zone`
- 再补 `laser`
- 对已补的夹击/捕捉/埋伏再做专门回放校验

### P3. 补齐战斗后处理与特殊战斗

目标：

- 减少“可计算伤害，但战后状态不完整”的情况

具体要做：

- 支援链战斗
- add-point
- 更完整的 afterBattle 分支覆盖

### P4. 继续补工具与门

目标：

- 把当前骨架的扩展点真正填实

具体要做：

- `centerFly` 精确行为
- 颜色门/颜色钥匙的专门约束
- 特殊门条件
- 更多工具道具

### P5. 让主搜索真正推进到更深层

目标：

- 从“局部验证可用”推进到“主求解器实用”

具体要做：

- 继续增强 dominance
- 增加阶段性局部目标
- 更精细的动作裁剪
- 根据不同楼层调 beam 参数

### P6. 扩展验证面

目标：

- 让当前系统的可信度来自系统性验证，而不是单次跑通

具体要做：

- 增加 `MT1-MT5` 或 `MT1-MT10` 的回放验证脚本
- 把典型“上楼拿收益再回头补打”的样例做成回归集
- 对道具、门、特殊事件分别做小型验证用例

## 8. 当前阶段判断

当前项目已经不是“思路探索”阶段，而是“已有可运行原型，但仍在补规则和补搜索策略”的阶段。

更具体地说：

- 架构路线已经确定
- 原型已经能跑
- 局部目标搜索已经能在 live runtime 中验证
- 但离“稳定解出 `MT1 -> MT11` 的高质量 top-k 路线”还有明显工程工作量

后续最重要的方向，不是再换路线，而是继续把现有路线补深、补准、补快。

## 5. 2026-04-26：白色孤岛 0 伤资源优先与蓝钥匙延迟

### 5.1 本轮目标

解决 `whiteisland（9）/routes/latest/whiteisland-trial-best-progress.route.json` 在第 11 步前的两个问题：

- 早用唯一蓝钥匙（blueDoor）
- 低伤/0伤资源（例如 `battle:redSlime@A1:10,10`）被高伤推进动作淹没

### 5.2 已完成改动

- `shared-solver/lib/score.js`
  - 在 `defaultSearchRank()` 拆分并新增通用资源准备信号：
    - `coreCombat = atk*120 + def*100`
    - `resourcePrepScore = atk*140 + def*130 + hp*0.25 + mdef*1.5 + rareKeyReserve*2`
    - `survival = hp + mdef*2`
    - `mdefValue = mdef`
  - 保留 `rareKeyReserve` 并保持不依赖塔专用字段
  - 调整 `compareSearchRank()` 次序：`coreCombat -> resourcePrepScore -> survival -> rareKeyReserve -> hp -> mdefValue`
    - 目标：同层进度下优先保留低伤资源准备分支，不让高 `mdef` 无条件压制

- `shared-solver/lib/simulator.js`
  - 保留现有稀有门延迟策略：`deferRareDoorActions()`。
  - 新增 `deferCostlyBattleActions()`：在存在 0 伤资源战斗可行时，临时抑制更昂贵 `changeFloor` 与高伤怪，优先吃资源。
  - `getActionPriority()` 在 battle 上挂载 `action.estimate.unlockPreview`（来自 `frontierFeatures.battleOpportunities`）用于诊断。

- `shared-solver/lib/search.js`
  - `compactAction()` 保留 `estimate.unlockPreview`，便于回放摘要可见资源链上下文。

- `shared-solver/check-whiteisland-trial-resource-order.js`
  - 新增专项验证：
    - 断言 `battle:redSlime@A1:10,10` 优先级高于 `battle:slimelord@A1:9,1`
    - 验证 `(10,10)` 为 0 伤并增加 `def`
    - 小预算搜索回归：无提前 `blueDoor`、`10,10` 在 `9,1` 之前且包含左侧资源链

- `shared-solver/package.json`
  - 新增脚本：`check:whiteisland:resource-order = node check-whiteisland-trial-resource-order.js`

### 5.3 验证结论（已通过）

- 通过专项回归与语法检查：

```bash
cd /media/bailan/DISK1/AUbuntuProject/project/motapathfind/shared-solver
npm run check:whiteisland:resource-order
node --check lib/score.js
node --check lib/simulator.js
node --check lib/frontier-features.js
node --check lib/search.js
node --check check-whiteisland-trial-resource-order.js
```

- 重搜白岛 best-progress（wrapper 执行）：

```bash
cd "/media/bailan/DISK1/AUbuntuProject/project/motapathfind/whiteisland（9）"
./solver.sh run-whiteisland-trial-topk.js --top-k=1 --max-expansions=3000 --out-dir=routes/latest --perf=1
```

- 当前路线观察：`blueDoor index = 0`，`(10,10) index = 13`，`(9,1) index = 15`。
- 当前 bestProgress：`A3`，`expanded=3000`，`foundGoal=false`。

### 5.4 回放命令

```bash
cd "/media/bailan/DISK1/AUbuntuProject/project/motapathfind/whiteisland（9）"
./solver.sh gui --route-file=routes/latest/whiteisland-trial-best-progress.route.json
```

```bash
cd "/media/bailan/DISK1/AUbuntuProject/project/motapathfind/whiteisland（9）"
./solver.sh gui --route-file=routes/latest/whiteisland-trial-best-progress.route.json --live=1 --headless=0
```

## 6. 2026-04-26：Only Up chaos 改为 canonical DP 主线

### 6.1 背景

用户明确指出：这个塔在 chaos 难度下基本是唯一解；一旦出现无法前进或血量不足，就说明当前路线分支错了，不能继续靠 beam 权重微调。新的主线改为：

```text
canonical state key 不包含 hp / hpmax / route length
同 key 只保留 hp 更高状态
展开顺序只影响先搜索谁，不作为正确性剪枝依据
```

### 6.2 已完成改动

- `shared-solver/lib/dp-search.js`
  - 新增/完善 `searchDP()`：
    - `buildDpStateKey()` 以地图 mutation、角色 atk/def/mdef/lv/exp、inventory、equipment、flags 等构造 canonical key。
    - 不把 `hpmax` 纳入 DP 路线优劣。
    - 同 key 状态只保留 HP 更高者；HP 相同再用更短 decision/route。
  - 新增 `best-first` agenda：
    - 默认仍是 DP 剪枝，agenda 只决定展开顺序。
    - 优先考虑楼层进度、到下一楼梯距离、当前楼层、HP、战斗资源。
    - battle action 使用 `estimate.unlockPreview`，避免高伤但能打开资源链的动作被长期延后。
  - 新增 `stopOnFirstGoal`，目标达成后可立即返回，避免继续跑满预算。
  - 拆分 goal 语义：
    - `firstGoalState`：agenda 第一次命中的可行目标。
    - `bestGoalState`：预算内按 `compareDpBest()` 选择的最佳目标。
    - 兼容字段 `goalState` 指向 `bestGoalState`。
  - 修正 DP diagnostics 剪枝计数：
    - `acceptedStates`：成功入队状态数。
    - `newKeys`：首次出现的 canonical key。
    - `replacedLowerHp`：同 key 下新状态 HP 更高并替换旧状态。
    - `sameHpShorterRoute`：同 key 同 HP 但 decision/route 更短并替换旧状态。
    - `rejectedByHigherHp`：同 key 已有状态 HP 更高，拒绝新状态。
    - `sameHpRejected`：同 key 同 HP 但路线不更短，拒绝新状态。
  - DP 热路径不再复制完整 route：
    - 搜索节点使用 `{ nodeId, parentId, state, stateKey, actionEntry, rank }` parent 链。
    - `applyAction()` 改为 `{ storeRoute: false }`。
    - 命中目标或输出 best state 时再用 parent 链重建 route。
    - 保留 initial auto route prefix，避免从 checkpoint 启动时丢失已有前缀。
  - DP action cap 语义显式化：
    - `completeWithinActionSet = actionTrimmed === 0`。
    - `maxActionsPerState` 记录当前每状态展开上限。
    - `actionTrimmed` 记录因 cap 被截掉的 action 总数。
    - `statesWithActionTrim` 记录发生 action trim 的状态数。
    - 小范围正确性验证可用 `--max-actions-per-state=9999`，避免 action cap 漏路线。

- `shared-solver/lib/search-profiles.js`
  - 新增/完善 `canonical-dp` profile：
    - `searchAlgorithm: "dp"`
    - `searchGraphMode: "primitive"`
    - 默认 `dpKeyMode: "region"`，安全优先，按可达区域合流
    - 默认 `dpAgendaMode: "best-first"`
    - `mutation` 仅作为已验证局部资源区/专项性能模式，通过 `--dp-key-mode=mutation` 显式启用

- `shared-solver/run-search.js`
  - `canonical-dp` 接入 `searchDP()`。
  - 新增 CLI：
    - `--dp-key-mode=mutation|location|region`
    - `--dp-agenda=fifo|best-first`
    - `--goal-floor=MT2`
    - `--goal-expr='status:hp >= ...'`
    - `--stop-on-first-goal=1`
    - `--save-first-goal-route=...`
    - `--save-best-goal-route=...`

- `shared-solver/check-mt2-resource-branch.js`
  - 新增可选 DP 回归：`--dp`。
  - 验证从 `fixed-1f-mt2-four-priests-hp3834.route.json` checkpoint 出发，DP 能自动找到：
    - `battle:bluePriest@MT2:2,8（初诞灵）`
    - `battle:brownWizard@MT2:3,10（青年法师）`
    - `battle:slimeman@MT2:4,11（石精）`
    - `equip:I893`
    - 最终 `MT3 hp>=8425 atk>=107 def>=100 mdef>=510 exp>=31 equipment includes I893`

- `shared-solver/package.json`
  - 新增脚本：`check:mt2-branch:dp = node check-mt2-resource-branch.js --dp`

### 6.3 验证结论

已通过：

```bash
npm run check:mt2-branch --prefix shared-solver
npm run check:mt2-local-order --prefix shared-solver
npm run check:pocket --prefix shared-solver
npm run check:core --prefix shared-solver
npm run check:stage:short --prefix shared-solver
npm run check:mt2-branch:dp --prefix shared-solver
```

关键结果：

```text
check:mt2-branch:dp
  DP found hp=8425 routeLength=111 expansions=1232

root canonical-dp MT2 resource goal
  found within expansions=1968
```

### 6.4 当前限制

- `canonical-dp` 已经能证明“同 canonical state 保留高 HP”的核心语义。
- 从 3834 checkpoint 到功法 MT3 目标能自动找到，但仍偏慢（约 1200+ expansions）。
- 从初始状态直接追 MT3/I893 还需要进一步优化 agenda 或分层 DP；当前先把 MT2 高血资源目标作为根搜索验收点。
- `region` key 是默认安全模式；当前性能较慢。`mutation` key 剪枝更强，但只建议用于已验证楼层或局部资源区。
- 后续可做轻量 reachable endpoint key，替代完整 region scan，作为 `region` 的性能优化版。

### 6.5 常用命令

从初始状态用 DP 搜索 MT2 高血资源目标：

```bash
node shared-solver/run-search.js \
  --project-root='Only upV2.1/Only upV2.1' \
  --profile=canonical-dp \
  --max-expansions=3000 \
  --goal-floor=MT2 \
  --goal-expr='status:hp >= 3834 && status:atk >= 72 && status:def >= 35 && status:mdef >= 290' \
  --save-route=/tmp/dp-mt2-goal.route.json
```

快速找任意可行目标：

```bash
node shared-solver/run-search.js \
  --project-root='Only upV2.1/Only upV2.1' \
  --profile=canonical-dp \
  --max-expansions=3000 \
  --goal-floor=MT2 \
  --goal-expr='status:hp >= 3834 && status:atk >= 72 && status:def >= 35 && status:mdef >= 290' \
  --stop-on-first-goal=1 \
  --save-first-goal-route=/tmp/dp-mt2-first.route.json
```

预算内优化目标 HP / 资源：

```bash
node shared-solver/run-search.js \
  --project-root='Only upV2.1/Only upV2.1' \
  --profile=canonical-dp \
  --max-expansions=3000 \
  --goal-floor=MT2 \
  --goal-expr='status:hp >= 3834 && status:atk >= 72 && status:def >= 35 && status:mdef >= 290' \
  --stop-on-first-goal=0 \
  --save-first-goal-route=/tmp/dp-mt2-first.route.json \
  --save-best-goal-route=/tmp/dp-mt2-best-goal.route.json
```

小范围完整 action set 验证：

```bash
node shared-solver/run-search.js \
  --project-root='Only upV2.1/Only upV2.1' \
  --profile=canonical-dp \
  --dp-key-mode=mutation \
  --max-actions-per-state=9999 \
  --max-expansions=3000 \
  --goal-floor=MT2 \
  --goal-expr='status:hp >= 3834 && status:atk >= 72 && status:def >= 35 && status:mdef >= 290'
```

已验证局部资源区可显式使用激进 `mutation`：

```bash
node shared-solver/run-search.js \
  --project-root='Only upV2.1/Only upV2.1' \
  --profile=canonical-dp \
  --dp-key-mode=mutation \
  --max-expansions=3000 \
  --goal-floor=MT2 \
  --goal-expr='status:hp >= 3834 && status:atk >= 72 && status:def >= 35 && status:mdef >= 290' \
  --save-route=/tmp/dp-mt2-goal.route.json
```

回放默认使用：

```bash
node shared-solver/route-gui.js \
  --route-file=/tmp/dp-mt2-goal.route.json \
  --live=1 \
  --headless=0
```

### 6.6 Only Up chaos key-state 回归

新增固定验收脚本：

```bash
npm run check:onlyup:key-states --prefix shared-solver
```

当前覆盖的关键状态：

- `MT1`：`hp=1559` 时可打 `battle:skeleton（废弃傀儡）@MT1:8,1`，伤害为 `1558`。
- `MT2`：验证 `(8,1)->(4,1)` 是两步短期更优，但 `(4,1)->(2,1)->auto(8,1)` 是三步合流后更优。
- `MT2`：fixture `routes/fixtures/mt1-mt2-hp3834.route.json` 回放到 `hp>=3834 atk>=72 def>=35 mdef>=290`。
- `MT3/I893`：fixture `routes/fixtures/mt1-mt3-i893-hp8425.route.json` 回放到 `hp>=8425 atk>=107 def>=100 mdef>=510 exp>=31` 且装备 `I893`。
- `MT4`：fixture `routes/fixtures/mt1-mt4-hp4459-atk421-def318-mdef5012.route.json` 回放到 `hp=4459`，raw `atk=337 def=255 mdef=4010`，按 `I893` 的 25% 功法 buff 后有效值为 `atk=421 def=318 mdef=5012`。

这个脚本的目标不是手动指定搜索路线，而是给 DP / confluence / action 枚举修改提供稳定 oracle。后续若搜索生成更优 `MT4 hp>=4459 atk>=421 def>=318 mdef>=5012` 路线，应更新上述 fixture，并保持该项为强断言。

### 6.7 MT3 -> MT4 key-state 解析

从 `MT3 hp=8425` / `I893` checkpoint 开始，当前 3F 固定 oracle 分支为：

```text
battle:brownWizard@MT3:8,11
battle:blueGateKeeper@MT3:3,10
battle:blueGateKeeper@MT3:9,10
battle:redGateKeeper@MT3:10,8
battle:blueGateKeeper@MT3:8,7
battle:redGateKeeper@MT3:4,7
battle:swordsman@MT3:9,6
battle:soldier@MT3:9,4
battle:darkKnight@MT3:10,5
battle:redKnight@MT3:3,6
battle:redKnight@MT3:3,4
battle:darkKnight@MT3:4,3
battle:yellowKing@MT3:10,1
battle:yellowKing@MT3:2,5
battle:yellowKnight@MT3:4,1
changeFloor@MT3:6,0
changeFloor@MT4:6,0
battle:yellowKnight@MT3:8,3
battle:blackKing@MT3:6,6
battle:blackKing@MT3:6,8
changeFloor@MT3:6,0
```

这里发现并修正了一个模拟语义问题：`I2090` 等拾取物品可增加经验，但旧模拟只在战斗后调用 `runLevelUps()`，导致 `battle:blackKing@MT3:6,8` 后自动拾取经验结晶到 `exp=165` 时没有升级。现在 `resolvePickupAt()` 在拾取及 `afterGetItem` 后也会调用 `runLevelUps()`，因此该分支最终 raw 状态为 `lv=6 atk=337 def=255 mdef=4010 exp=5`，乘 `I893` buff 后与 GUI 观察的 `atk=421 def=318 mdef=5012` 对齐。
