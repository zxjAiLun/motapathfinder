# Solver 后续路线

本文定义 solver 后续主线：停止把 stage score / beam 权重作为正确性来源，正式以 RegionSpec、milestone graph、segment DP、HP skyline、失败修复和 live replay 为主。

## 1. 当前定位

现在存在两类 solver：

| 类型 | 作用 | 是否作为正确性来源 |
| --- | --- | --- |
| `linear-main` / top-k / beam / macro search | 快速探索、发现候选路线、生成调试线索 | 否 |
| `canonical-dp` / `segment-dp` / `adaptive-segment-dp` / `region-dp` | 有限动作集合内的 primitive DP、里程碑求解、skyline 回退、失败诊断 | 是 |

主线算法：

```text
RegionSpec
-> milestone graph
-> 每段 primitive segment DP
-> 同抽象状态 HP 高者胜
-> 每个 milestone 保留 skyline 候选
-> 后段失败时回退上一 milestone 其他候选
-> adaptive planner 插入/拆分/放宽临时 segment
-> route-store 保存 primitive route
-> route-gui / live replay 验证
```

## 2. 正确性原则

### 2.1 DP dominance 是核心

同一抽象状态只保留更优代表：

```text
same DP key:
  higher HP wins
  same HP -> shorter decision depth wins
  same HP and same decision depth -> shorter route wins
```

DP key 不包含：

- `hp`
- `hpmax`
- route length

DP key 必须覆盖：

- floor / reachable region
- local map mutation
- atk / def / mdef / lv / exp
- equipment
- inventory
- flags
- visited/triggered runtime-relevant state

### 2.2 立即收益不是正确性标准

典型错误：

```text
现在打怪 -50
后面血瓶 +500
启发式认为净赚 +450
正确路线是先拿属性让怪变 0 伤，再回来拿血瓶
```

正确处理方式：

- 早拿和晚拿最终合流到同 DP key 时，晚拿 HP 更高，会替换早拿路线。
- 中间 milestone 不应随便 `stopOnFirstGoal=true`，否则会让低质量地基提前出线。
- `preferredPresentTiles` 用于提示资源延后，不直接过滤；`presentTiles` 只用于后续必死的硬约束。

### 2.3 不能误报全局无解

如果出现任一情况，只能输出“当前 action scope / milestone graph / budget 下未找到”：

- `actionTrimmed > 0`
- `stoppedReason = time-limit`
- expansion budget exhausted
- 非最终关键段使用了不安全的 `stopOnFirstGoal=true`
- action scope 不覆盖目标所需 primitive action

## 3. 已落地模块

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| `lib/dp-search.js` | ✅ 已落地 | canonical DP、HP dominance、goal skyline、dpSkylineMax |
| `lib/milestone-spec.js` | ✅ 已落地 | 从 `shared-solver/milestones/*.json` 加载 milestone，统一 BASE_DP |
| `lib/segment-dp.js` | ✅ 已落地 | segment goal、action policy、skyline、failure report、有限上一段回退；dpSkylineMax/goalSkylineLimit/preserveSkylineRoles 穿透 |
| `run-segmented-dp.js` | ✅ 已落地 | 跑 milestone graph 并保存 route；CLI 支持卡血保守模式参数 |
| `lib/adaptive-segment-planner.js` | 🔶 部分落地 | 已有 repair plan 雏形，仍需更强闭环 |
| `lib/resource-intent-scanner.js` | 🔶 部分落地 | 已能扫描资源 intent，需继续接入 planner |
| `lib/region-spec.js` | ✅ 已落地 | 统一 RegionSpec schema 与 proof claim |
| `run-region-dp.js` | ✅ 已落地 | 统一区域 DP 入口 |
| `route-store.js` | ✅ 已落地 | route record 构建，保存 primitive decision |
| `route-gui.js` / `replay-session.js` | ✅ 已落地 | GUI/live replay 验证 |
| `lib/solver-doctor.js` | ✅ 增强 | failureClass、deficitDetail、candidateQuality、action scope 统计（generated/kept/dominated by kind） |
| `lib/progressive-monster-planner.js` | ✅ v4 | current-reachable-first 架构；SpecialTargetTracker per-pattern；mobility lane |
| `lib/current-reachable-battle.js` | ✅ 新模块 | enumerateCurrentReachableBattleSuccessors + enumerateMobilitySuccessors + fetchCurrentFloorTargets |
| `lib/reach-and-battle-oracle.js` | ✅ 优化 | targeted battle matcher；batch oracle；fast portal discovery (opt-in)；portal dedup；perf diagnostics |
| `check-progressive-to-milestone.js` | ✅ v4 bridge | progressive planner → milestone suggestion；special target inference；segment DP validation；focused checks |
| `check-state-key-audit.js` | ✅ | direction-sensitive items/flags/visitedFloors/DP keyMode 审计 |
| `audit-state-abstraction.js` / `check-state-abstraction-audit.js` | ✅ PR-4.5a1 shadow-only | candidate-6/7 decision 14–20 的 action-labelled relation、exact-key split、triggeredAutoEvents、direction coverage 与完整性 gates；不接入 production key |
| `bounded-abstraction-counterexample-search.js` / `check-bounded-abstraction-counterexample.js` | ✅ PR-4.5b3 shadow-only | inclusive depth-2 paired expansion、执行错误 incomplete contract、projection-class cross product、true off-diagonal regression 与 successor telemetry；不接入 production key |
| `mine-state-abstraction-collisions.js` / `check-state-abstraction-collision-inventory.js` | ✅ PR-4.5c1 shadow-only | 读取锁定的 MT1/MT2 artifacts，occurrence/signature 双层 identity、witness integrity、pair cap、分离 risk strata、depth-2 bounded outcomes 与 candidate-6/7 fixed control；不接入 production key |
| `check-onlyup-floorfly-dedup-safety.js` | ✅ | OnlyUp floorFly dedup 安全审计（确认 target-floor 模式不安全） |
| `check-progressive-monster-planner.js` | ✅ | synthetic smoke + special target priority + batch cap + targeted matcher + legacy compat + portal compat + portal dedup safety（9 tests） |

## 4. 近期路线

### P0：结构稳定 ✅ 基本完成

目标：

- ✅ 固化 `shared-solver/` 为唯一 canonical solver。
- ✅ `routes/generated/` 加入 `.gitignore`。
- ✅ 塔内 `solver/**` 冻结。
- ✅ `whiteisland（9）/`、`_saves/`、`replay-downloads/`、`.tmp-*.js` 加入 `.gitignore`。
- ✅ `core.filemode=false` / `core.autocrlf=false` 消除 Windows 噪音。

### P1：Segment DP 成为主线 ✅ 基本完成

目标：

- ✅ Only Up 到 MT5 blueKing 的 milestone graph 作为回归基线。
- ✅ 每段保留 3–8 个 skyline candidate。
- ✅ 失败报告包含 `failedSegmentId`、`missingGoalFields`、`failureClass`、`recommendedRepair`。
- ✅ CLI 支持卡血保守模式：`--dp-skyline-max=3 --preserve-skyline-roles=1 --goal-skyline-limit=16`。

### P1.5：Progressive Planner 自动里程碑 ✅

目标：

- ✅ current-reachable-first 架构：planner 只判断当前层打哪个怪。
- ✅ mobility lane：changeFloor/floorFly 作为独立 macro successor。
- ✅ SpecialTargetTracker per-pattern 追踪。
- ✅ Bridge：checkpoint → candidate milestone → segment DP 验证。
- ✅ State key 审计：方向敏感性、flags、visitedFloors、DP keyMode。
- ✅ floorFly dedup 安全审计：OnlyUp 确认 target-floor 模式不安全。
- 🔶 真实 OnlyUp 自动 milestone 生成仍需性能提升（当前 MT1-MT2 56 states/20s）。

### P1.6：State Abstraction Audit（PR-4.5a / a1）✅ 首轮 shadow-only

首轮只审计 candidate-6 / candidate-7 的 decision 14–20 窗口：

- action-set 与 successor-set 等价性；
- exact key 各字段的 split contribution；
- `triggeredAutoEvents` 是否存在不可由 key 字段推导的样本冲突；
- direction dependency registry；
- shadow canonical projection 碰撞后的一步行为等价。

当前证据显示：当前楼层 mutation-only projection 在该局部窗口的 action-set 和 projection successor-set 均等价，但 exact successor-set 仍被非当前楼层 mutation 分裂。该结果只支持局部审计结论，不支持修改全局 DP key。

PR-4.5a1 已收紧为可复核契约：固定 7 个 projection collision，使用按 action ID 对齐的 successor relation 作为安全门，锁定 14–19 exact relation 不等价与 decision 20 exact rejoin，并把 replay、enumeration、action application、输入 SHA 和 direction coverage 纳入报告 gates。当前仍不改变 production key。

### P1.7：Bounded Abstraction Counterexample Search（PR-4.5b / b1 / b2 / b3）✅ 首轮 shadow-only

- ✅ manifest-driven candidate corpus，保留 candidate-6/7 为固定 positive control。
- ✅ 从每个 projection collision 做深度 2 的 action-labelled paired expansion。
- ✅ branch/state cap 耗尽输出 `incomplete`，不把预算不足误报为等价。
- ✅ 输出最短 mismatch witness，并用 synthetic re-entry hidden-mutation control 验证负向检测能力。
- ✅ depth 2 节点实际执行 relation check；新增两步 shared-prefix 后首次 mismatch 的 boundary control。
- ✅ `state-cap` / `branch-cap` exhaustion reason 分离记录。
- ✅ 执行错误与 duplicate action ID 标为 `incomplete`，不作为 abstraction mismatch 证据。
- ✅ 同 projected successor class 展开完整 cross product，并记录 successor multiplicity telemetry；off-diagonal control 已锁定。
- ✅ diagonal pairs 均为 equivalent、只有 cross-product pair 暴露 mismatch 的 true off-diagonal regression 已锁定。
- 当前结果：正样本 `equivalent`，负向控制 `mismatch-witness`；尚不涉及 production key 或全局安全结论。

### P1.8：Real-Corpus Collision Inventory（PR-4.5c）🔶 baseline 完成，等待 c1 收口

- ✅ 仅读取 2 个稳定 MT1/MT2 JSON artifacts，锁定 source SHA256、checkpoint/candidate collection、state extraction mode 与 per-source pair cap。
- ✅ 40 个状态形成 12 个 source-local collision occurrences、7 个 unique signatures；12 个 exact-distinct pairs 中选取 8 对、按 cap 跳过 4 对，所有 pair ID 确定性生成。
- ✅ 复用 PR-4.5b3 depth-2 / branch-32 / state-256 runner；selected pairs 为 2 个 `equivalent`、6 个 `mismatch-witness`、0 个 `incomplete`，candidate-6/7 fixed control 为 `equivalent`。
- 🔶 baseline 的 witness 引用与 risk 分母口径由 c1 修正；在 c1 review 前不将 PR-4.5c 正式关闭。

### P1.9：Witness Integrity & Collision Identity（PR-4.5c1）✅ 本轮 shadow-only

- ✅ projected mismatch witness 只引用 `projectedEqual=false` 的 successor mismatch；action-set mismatch 不携带无关 successor mismatch。
- ✅ collision occurrences 使用全局唯一 occurrence ID，跨 artifact 使用 signature ID 聚类；报告区分 12/7/5 occurrence、unique、duplicate 计数。
- ✅ sampling coverage 区分 selected occurrences、selected unique/repeated signatures 与 skipped unique signatures。
- ✅ selected/fixed/all-evaluated risk strata 分母明确；candidate-6/7 fixed control 锁定完整身份、exact-distinct hash、projection hash 和 exact rejoin。
- ✅ checker 新增 witness 语义、pair → occurrence 引用、missing checkpoint error 与 deterministic rebuild gates。
- 当前结果仍只建立 real-corpus 风险盘点，不修改 production DP key、dominance、agenda、容量或默认策略，也不构成全局 projection 安全证明。

### P2：Adaptive planner 闭环

目标：失败后不只报告，而是自动提出并执行有限 repair。

第一批 repair：

- `atk-deficit`：优先上一段 `highest-atk` / `best-combat` 候选；必要时插入攻击资源子目标。
- `hp-deficit` / `action-survivability-deficit`：优先 `highest-hp` 候选；必要时插入 HP/低伤经验子目标。
- `target-action-unreachable`：分析路径 blocker，插入清 blocker / 开门 / 上下楼白名单子目标。
- `present-tile-overconstrained`：把非硬依赖资源从 `presentTiles` 降级到 `preferredPresentTiles`。
- `budget-or-action-scope-exhausted`：自动拆段或扩大 action scope，而不是输出无解。

验收：

```bash
npm run check:adaptive:onlyup --prefix shared-solver
npm run run:onlyup:adaptive --prefix shared-solver
```

### P3：Resource intent scanner 接入

目标：把地图上的资源/装备/路径 blocker 转成可执行临时目标。

scanner 输出应覆盖：

- `stat-gain`: atk / def / mdef / hp
- `equipment`: 装备或功法
- `levelup`: 经验差与候选战斗
- `path-blocker`: 怪、门、事件、楼梯限制
- `deferred-resource`: 当前拿会亏、后续属性到位再拿更优的资源

排序原则：

| failure | 优先 intent |
| --- | --- |
| `atk-deficit` | atk pickup、装备、升级、打开攻击资源路径 |
| `def-deficit` | def pickup、装备、升级、降低后续战损 |
| `mdef-deficit` | mdef pickup、装备、魔防资源路径 |
| `hp-deficit` | HP、低伤经验、延后血瓶、减少夹击/领域损伤 |
| `target-action-unreachable` | 路径 blocker、门钥匙、楼梯/传送 action scope |

### P4：Region DP 正式入口

目标：不同塔统一使用 RegionSpec，不再为每个塔写独立长脚本。

入口：

```bash
node shared-solver/run-region-dp.js \
  --project-root="Only upV2.1/Only upV2.1" \
  --region-spec="towers/onlyup/region-specs/region-1.json" \
  --out="shared-solver/routes/latest/onlyup-region-1.route.json"
```

当前样例：

- `towers/onlyup/region-specs/region-1.json`
- `towers/onlyup/region-specs/region-2.json`
- `towers/whiteisland/trial-specs/trial-smoke.json`

验收：

```bash
npm run check:region-specs --prefix shared-solver
npm run run:onlyup:region1 --prefix shared-solver
npm run run:region:whiteisland --prefix shared-solver
```

### P5：Replay / h5save 产品化

目标：

- 最新路线能导出 h5save/h5route。
- GUI 回放默认支持 runtime 自动打怪/自动拾取。
- 支持从 checkpoint 或 step 后段开始看，不要求从前 5 层重看。

默认要求：

- 每次给用户最新路线时，同时给出 GUI 回放命令。
- 路线保存必须是 primitive decision，不落宏动作。
- `--from-step=N` 语义写清楚：暂停在第 N 步执行前，`lastCompletedStep=N-1` 是正常行为。

## 5. 风险控制

### 5.1 `presentTiles` 过拟合

`presentTiles` 是硬约束，只能用于“不保留后续必死”的资源或怪。

路线质量偏好使用：

```json
"preferredPresentTiles": []
```

后续 audit 要检查：

- 每个 hard `presentTile` 是否在后续段被使用。
- 是否存在只为逼正确路线而写的 hard tile。
- 是否可以降级为 soft hint。

### 5.2 `stopOnFirstGoal=true`

只允许用于：

- 已验证唯一解的小段。
- 结构上不影响后续 skyline 的纯中转段。
- JSON 中写明 `firstGoalSafeReason`。

重要 milestone 默认：

```json
"stopOnFirstGoal": false,
"goalSkylineLimit": 8
```

### 5.3 `mutation` key

`mutation` key 只用于经过验证的局部段，必须写 `safeReason`。

默认正式搜索使用：

```json
"keyMode": "region"
```

debug 对照使用：

```json
"keyMode": "location"
```

### 5.4 预算与 action scope

预算耗尽不是路线不存在。

失败输出必须区分：

- goal 不满足
- action 不可达
- action 被 policy 过滤
- DP 预算不足
- action trimming 导致不完整
- milestone 过度约束

## 6. 不做事项

近期不做：

- 无边界全局 DP。
- 继续把 stage score 调参当作正确性来源。
- 用 topK 并行作为证明。
- 硬编码完整怪物顺序。
- 直接追 MT11 而跳过 MT6/MT7 区域化。
- 修改塔项目原生 JS 来适配 solver。

允许做：

- 把已验证 key state 作为 milestone 回归。
- 用 milestone 阈值约束搜索方向。
- 对失败段自动插入临时子目标。
- 保留多个 milestone skyline 候选。
- 用 route-gui/live replay 证明最终路线。

## 7. MT7 生命限制段：blocked resource intent

`poisonZombie@MT7:1,11（废墟入土魂灵）` 不能只按普通 HP 缺口处理。它后面的 `I616（灰岩重剑）` 需要先解决左下局部资源链：

```text
redSwordsman@MT7:3,10（褐泥妖偶）
-> I619@MT7:3,9（灵红补给品，约 +2,560,000 HP）
-> poisonZombie@MT7:1,11（生命限制）
-> I616@MT7:0,11（灰岩重剑，攻击 +3000）
```

因此 adaptive scanner 必须支持“当前不可执行但地图上可解释”的 intent：

- `blocked-hp-resource`：扫描目标附近被怪挡住的大血瓶。
- `blockerBattle`：输出 blocker 的 `enemyId（中文名）`、当前伤害和 `minHpToSurvive`。
- `blockedResource`：输出资源 item、坐标、估算 HP 增益和打 blocker 后净 HP。
- `targetBattleImpact`：估算拿到资源后生命限制怪伤害是否下降。

这个 intent 生成的 repair goal 不是“直接拿资源”，而是：

```json
{
  "type": "adaptiveResourceIntent",
  "actionSurvivable": {
    "summary": "battle:redSwordsman@MT7:3,10"
  },
  "presentTiles": [
    { "floorId": "MT7", "x": 1, "y": 11 },
    { "floorId": "MT7", "x": 3, "y": 9 }
  ]
}
```

关键约束：

- 当前 `mt7-right-exp-crystal` 单一路线只有约 `298478 HP`，不够打 `redSwordsman@3,10`。
- planner 应回退到更早 skyline，寻找 `highest-hp + highest-def/best-combat` 地基。
- 不应把 `floorFly` 的多个等价落点当成不同实质路线；segment DP 对同一目标楼层默认只保留最短 `floorFly` 代表。
