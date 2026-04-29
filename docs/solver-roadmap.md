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
| `lib/dp-search.js` | 已落地 | canonical DP、HP dominance、goal skyline |
| `lib/milestone-spec.js` | 已落地 | 从 `shared-solver/milestones/*.json` 加载 milestone |
| `lib/segment-dp.js` | 已落地 | segment goal、action policy、skyline、failure report、有限上一段回退 |
| `run-segmented-dp.js` | 已落地 | 跑 milestone graph 并保存 route |
| `lib/adaptive-segment-planner.js` | 部分落地 | 已有 repair plan 雏形，仍需更强闭环 |
| `lib/resource-intent-scanner.js` | 部分落地 | 已能扫描资源 intent，需继续接入 planner |
| `lib/region-spec.js` | 已落地 | 统一 RegionSpec schema 与 proof claim |
| `run-region-dp.js` | 已落地 | 统一区域 DP 入口 |
| `route-store.js` | 已落地 | route record 构建，保存 primitive decision |
| `route-gui.js` / `replay-session.js` | 已落地 | GUI/live replay 验证 |

## 4. 近期路线

### P0：结构稳定

目标：

- 固化 `shared-solver/` 为唯一 canonical solver。
- 继续生成 JS 清单和 entrypoint 文档。
- 阻止塔内 `solver/**` 继续扩张。

验收：

```bash
npm run audit:js --prefix shared-solver
npm run check:no-tower-solver-js --prefix shared-solver
npm run check:public-layer-boundaries --prefix shared-solver
```

### P1：Segment DP 成为主线

目标：

- Only Up 到 `MT5 blueKing（织光仙子）` 的 milestone graph 继续作为回归主线。
- 每段保留 3–8 个 skyline candidate。
- 失败报告必须包含 `failedSegmentId`、`missingGoalFields`、`failureClass`、`recommendedRepair`。

验收：

```bash
npm run check:onlyup:segments --prefix shared-solver
npm run run:onlyup:segmented --prefix shared-solver
```

回放命令：

```bash
node shared-solver/route-gui.js \
  --project-root="Only upV2.1/Only upV2.1" \
  --route-file="shared-solver/routes/latest/segmented-mt5-blueking.route.json" \
  --live=1 \
  --headless=0 \
  --runtime-auto-battle=1 \
  --runtime-auto-pickup=1
```

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
