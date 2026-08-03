# 研究进度记录

更新日期：2026-08-01

## 0.7 2026-08-01：PR-4.5a State Abstraction Audit

本轮正式关闭 PR-4.4j–k 后，进入完全 shadow-only 的状态抽象审计；不修改 production DP key、dominance、agenda、容量或默认策略。

已完成：

- 新增 `audit-state-abstraction.js` 与 `check-state-abstraction-audit.js`，复用 PR-4.4j/j2 工件中的 candidate-6 / candidate-7 完整 checkpoint state。
- 对 decision 14–20 重放同一公共后缀，并逐状态枚举 primitive action-set 与 successor-set。
- 输出 exact key 顶层字段及非零嵌套字段的 split contribution；实现当前楼层 mutation-only shadow canonical projection。
- 输出 `triggeredAutoEvents` 的动态碰撞证据、autoEvent 静态 registry，以及 direction dependency registry。
- 对 projection collision 做一步 action/successor 行为等价检查；结果落在 `routes/generated/agenda-policy-evaluation/pr-4.5a-state-abstraction-audit.{json,md}`。

首轮结论：

- candidate-6 / candidate-7 在 decision 14–20 共 7 个 shadow collision 点上 action-set 等价，projection successor-set 也等价。
- exact successor-set 不等价，差异来自非当前楼层 MT1 mutation 仍存在于 exact key；因此不能据此删除全局 mutation 历史。
- decision 20 exact rejoin 成立。
- `triggeredAutoEvents` 在本语料中没有非空历史，也没有同 exact key 的冲突见证；结论保持“样本一致但未证明可由其他字段推导”。
- direction 依赖除 pickaxe/bomb 外，还登记了 changeFloor fallback、floorFly saved leave location / fallback，以及 action approach direction；本轮不扩展 production key。

验证：

```bash
cd shared-solver
npm run check:state-abstraction
npm run check:manifest
npm run check:no-tower-solver-js
```

## 0.8 2026-08-01：PR-4.5a1 Audit Contract Tightening

根据 review 收紧审计契约；本轮仍完全 shadow-only，不修改 production DP key、dominance、agenda、容量或默认策略。

- 将 mutation 的审计统计视图按 `floorId` 归一化，显式输出 `mutations.MT1`、`mutations.MT2` 及其 `removed` 子字段；production key 仍使用原数组。
- 在 successor-set 之外增加按 action ID 对齐的 action-labelled successor relation，并将 enumeration/application error 纳入关系安全门。
- 固定 candidate-6 / candidate-7 decision 14–20 的 7 个 collision、14–19 exact relation 不等价、decision 20 exact relation rejoin，以及 source/replay/coverage/error/rejoin gates。
- 增加 `evidenceOutcome`（`equivalent` / `mismatch-witness` / `incomplete`）和 direction coverage；未扫描或未证明的事件入口显式列出。

当前 a1 结论：7 个 shadow collision 点均 action-labelled projection relation 等价，14–19 的 exact relation 仍不等价，decision 20 exact relation 等价；审计结果为 `evidenceOutcome=equivalent`，不构成删除全局 mutation 历史的证明。

## 0.9 2026-08-01：PR-4.5b Bounded Abstraction Counterexample Search

PR-4.5a/a1 正式关闭后，继续保持 shadow-only，新增 manifest-driven 的有界抽象反例搜索；不修改 production DP key、dominance、agenda、容量或默认策略。

- 新增 `profiles/state-abstraction-corpus.json`，由 manifest 指定 candidate-6 / candidate-7 正样本、decision 14–20、深度 2、branch cap 32、state cap 256。
- 新增 `bounded-abstraction-counterexample-search.js`，从每个 projection collision 出发按 action ID 做 BFS 式 paired expansion；预算或分支 cap 耗尽统一输出 `incomplete`。
- 正样本 7 个 roots 在深度 2 均为 `equivalent`；新增 deterministic synthetic re-entry negative control，在共享 `reenter-MT1` 后发现 `historical-tile@MT1` action-set mismatch，并输出最短 witness。
- 新增 `check-bounded-abstraction-counterexample.js`，锁定正样本 `equivalent`、负向控制 `mismatch-witness`、深度/cap、无 incomplete 及 production shadow-only 边界。

当前结论：该 bounded search 已能在固定 manifest 与预算内主动验证正样本，并能检测“隐藏历史在重新进入楼层后改变 action relation”的反例；这仍不是全局 abstraction safety proof。

## 1.0 2026-08-01：PR-4.5b1 Depth Boundary Contract

针对 review 指出的 depth 语义边界完成最小修复，仍保持 shadow-only。

- `depth` 现在表示最大被检查的 shared-prefix length；depth 0、1、2 节点都会执行 action-labelled relation check，depth 2 不再生成 depth 3。
- 正样本 checker 锁定每个 root 的 levels `[0, 1, 2]`、`depthReached=2`、`budgetExhausted=false`，并在无去重前提下锁定 `expandedPairCount === generatedPairCount`。
- 新增 depth-boundary negative control：`reenter-MT1 → enter-history-zone → historical-tile@MT1`，首次 mismatch 的 depth 为 2。
- `incomplete` 现在显式携带 `exhaustedReason`，并增加 branch-cap probe；state-cap 与 branch-cap 分别输出 `state-cap` / `branch-cap`。

当前结论：candidate-6/7 的 depth 0–2 bounded relation 观测为等价；depth-2 synthetic control 能被发现；这仍不构成 projection 的全局安全证明。

## 1.1 2026-08-01：PR-4.5b2 Paired Search Soundness Contract

针对 review 的两个 soundness 缺口继续保持 shadow-only 收口：

- enumeration、action application、duplicate action ID 不再生成 `mismatch-witness`，统一返回 `incompleteReason`；预算仍分别使用 `state-cap` / `branch-cap`。
- 同一 projected successor class 现在展开完整笛卡尔积，不再使用贪心一一配对；所有 pair 继续受 state cap 限制。
- 报告新增 `multiSuccessorActionCount`、`maxSuccessorsPerAction`、`generatedCrossProductPairCount`；candidate-6/7 当前 7 roots 均为单 successor，未触发 multi-successor。
- 新增 off-diagonal negative control：2×2 successor cross product 中仅交叉配对暴露 mismatch；新增 depth=0、enumeration-error、action-application-error、duplicate-action-id probes。

当前结论：正样本在 depth 0–2 和当前实际 successor multiplicity 下保持 `equivalent`；执行失败会标记为 `incomplete`，cross-product 负向控制可发现交叉配对反例；仍不构成 projection 的全局安全证明。

## 1.2 2026-08-01：PR-4.5b3 True Off-Diagonal Regression Control

修正 off-diagonal synthetic fixture，使两个 diagonal pairs 都保持等价，只有 cross-product 才能发现 mismatch；本轮不修改 paired search 算法。

- L1/R1 使用 `lane-1`，L2/R2 使用 `lane-2`；完整 root 的 2×2 cross product 才会遇到 L1/R2 或 L2/R1 mismatch。
- checker 直接锁定 L1/R1 与 L2/R2 在 depth 0 均为 `equivalent`，完整 root 为 `mismatch-witness` 且 `generatedCrossProductPairCount=4`。
- mismatch witness 新增 `currentPair` 的 exact-key hashes 与 projection equality，确保报告包含实际 concrete pair 证据。

当前结论：cross-product runner 的 off-diagonal-only regression 已建立；PR-4.5b 系列可以正式关闭，下一阶段进入 real-corpus collision mining 与 risk-stratified corpus expansion。

## 1.3 2026-08-01：PR-4.5c Real-Corpus Collision Inventory（baseline）

PR-4.5b 系列正式关闭后，新增 `mine-state-abstraction-collisions.js` 与 `check-state-abstraction-collision-inventory.js`，继续保持 shadow-only。miner 只读取已存在的 MT1/MT2 JSON artifacts，不启动新的全量 solver 搜索；paired relation 复用 PR-4.5b3 runner，固定为 depth 2、branch cap 32、state cap 256。

- source manifest 锁定 2 个 artifact、各自 state extraction path、candidate collection、pair cap 与 source SHA256；输入实际 hash 必须与 manifest 一致。
- 本轮扫描 40 个状态，得到 12 个 source-local collision occurrences、7 个 unique collision signatures 与 12 个 exact-distinct pairs；按每源 pair cap 4 选择 8 对，跳过 4 对，并按 projection key、exact-key hashes、state ID 做确定性排序。
- 每个 selected pair 记录 `initialPair`、`currentPair`、shared action sequence 与 `firstUnmatched` witness；风险标签覆盖 non-current/current-floor mutation、leaveLoc/direction、triggeredAutoEvents、cross-floor action、multi-successor 与 exact rejoin，不能判定时使用 `unknown`。
- selected pair occurrences 的 outcome 为 2 个 `equivalent`、6 个 `mismatch-witness`、0 个 `incomplete`；candidate-6/7 fixed control 为 `equivalent`。原始 risk strata 曾把 fixed control 混入 selected 分母，已在 c1 修正。
- checker 锁定 artifact SHA、扫描/分组/选取计数、稳定 pair IDs、risk strata、candidate-6/7 control、b3 synthetic suite 与 production boundary；不修改 production DP key、dominance、agenda、容量或默认策略。

当前结论：真实 corpus 中确实存在 projection collision，且在 bounded depth-2 relation 下既有等价 pair，也有 mismatch witness；baseline 结果需结合 c1 的 witness integrity 与 identity 口径读取，不构成全局 projection 安全证明。

## 1.4 2026-08-01：PR-4.5c1 Witness Integrity & Collision Identity

本轮按 review request changes 收紧 PR-4.5c 诊断合同，仍不修改 production 语义。

- `buildMismatchWitness` 只选择第一个 `projectedEqual === false` 的 successor mismatch；action-set mismatch 明确使用 left/right-only action，并将 `successorMismatch` 置空。
- collision group 拆为全局唯一 `occurrenceId` 与跨 artifact 聚类的 `signatureId`；报告显式输出 12 occurrences、7 unique signatures、5 duplicate occurrences。
- sampling coverage 现在区分 selected pair occurrences（8）、selected unique signatures（5）、repeated selected signatures（3）与 cap 后跳过的 unique signatures（3）。
- risk strata 拆为 `selectedPairRiskStrata`（分母 8）、`fixedControlRiskStrata`（分母 1）和可选的 `allEvaluatedRiskStrata`（分母 9）。
- checker 锁定所有 occurrence/signature identity、pair → group 引用、witness 语义一致性、缺失 checkpoint extraction error、candidate-6/7 两侧 candidate ID、exact-distinct hashes、projection hash 与 `exactRejoinObserved=true`。

当前 c1 结论：真实 mismatch witness 的引用 action 已与 projected relation failure 对齐，collision identity 与 sampling/risk 分母已明确；PR-4.5c1 提交等待 review，production projection 全局安全性仍未建立。

## 1.5 2026-08-01：PR-4.5c1a Dependent Artifact Integrity

针对 review 发现的 stale-artifact 问题，重新使用当前共享 runner 生成 PR-4.5b3 JSON/Markdown，并补齐当前 telemetry 与 action-set witness 语义：`successorMismatch` 在 action-set mismatch 中为 `null`。

- b3 checker 新增 normalized full-report deep compare，仅排除 `generatedAt` 与 `provenance.generationCommit`；positive roots、negative controls、levels、telemetry、`currentPair`、shared sequence、first-unmatched 与 successor mismatch 均受 stale-report gate 约束。
- c1 checker 新增 selected pair normalized deep compare，锁定 pair identity、risk labels、bounded telemetry、execution errors、levels 与完整 witness；live rebuild 与 committed inventory 必须一致。
- coverage 新增 `signatureIdsWithSkippedOccurrences=3` 与 `unselectedUniqueSignatureCount=2`，区分“被跳过的 occurrence 涉及多少 signature”和“完全未覆盖的 signature”。
- 本轮不修改 search algorithm、corpus、production DP key、dominance、agenda、容量或默认策略。

当前 c1a 结论：PR-4.5b3 committed artifact 已与当前 runner 规范化一致，c1 inventory 也通过依赖工件 deep compare；全局 projection 安全性仍未建立。

## 1.6 2026-08-01：PR-4.6a Adaptive Repair Outcome Contract

PR-4.5c1a 正式关闭后，P2 首轮进入 adaptive planner repair outcome contract；本轮完全 shadow-only，不修改 production DP key、dominance、agenda、容量或默认策略。

- 新增 `audit-adaptive-repair-outcomes.js` 与 `check-adaptive-repair-outcomes.js`，固定五类 repair case：`atk-deficit`、`action-survivability-deficit`（含 `hp-deficit` alias）、`target-action-unreachable`、`present-tile-overconstrained`、`budget-or-action-scope-exhausted`。
- 每个 case 都记录 baseline outcome、failure class、selected repair intent、generated repair segment、repair budget、repaired outcome 与 termination reason；合同强制 `maxRepairs=1`，未解决只能输出 `repair-incomplete`。
- failure → repair intent 映射锁定为 attack resource/best combat、HP/high-survival/low-damage、blocker/open-door/change-floor whitelist、`presentTiles` downgrade、auto-split/action-scope expansion。
- 复用现有 `adaptive-segment-planner.js` 生成 window repair 与 auto-split segment；attack 与 presentTiles 使用明确标注的 contract-adapter synthetic controls，避免把尚未执行的控制样例描述为完整 OnlyUp 路线。
- checker 同时锁定 positive success、rejected/incomplete negative、auto-split control、一次 repair/no recursion、shadow-only 边界与 deterministic live rebuild。

当前结论：PR-4.6a 合同审计已建立，repair outcome 不再把 unresolved 分支误报为成功；本轮仍不宣称 adaptive planner 已完成完整 OnlyUp repair 闭环。

## 1.7 2026-08-01：PR-4.6a1 Executed One-Repair Outcome Controls

针对 review 指出 PR-4.6a 只把 `controlOutcome` 当作 fixture 常量、没有真实执行的问题，本轮继续保持 shadow-only，进入 PR-4.6a1；PR-4.6a 暂不正式关闭。

- 新增 `adaptive-repair-synthetic-simulator.js`，用小型确定性 project/state/action model 驱动真实 `runAdaptiveSegmentPlanner(..., { maxAdaptiveRepairs: 1 })`。
- `observedOutcome` 现在由实际 baseline/repair execution result 推导；报告同时记录 `baselineAttempt`、`generatedRepairSegment`、`insertedSegmentId`、`repairedAttempt`、`repairBranches`、`observedOutcome` 与 `terminationReason`。
- attack pickup 实际执行后达到 ATK goal；target-unreachable 实际通过 adaptive window 的 change-floor action 到达 target action；survivability 与 auto-split 实际执行一次后仍 unresolved，输出 `repair-incomplete`。
- `presentTiles` downgrade 使用 admissibility validator，拒绝发生在插入前，`appliedRepairCount=0`；不再把 rejected 与已执行 repair 混为一谈。
- 显式传入 `windowRepairMaxExpansions=300`、`windowRepairMaxRuntimeMs=2000`、`splitMaxExpansions=300`、`splitMaxRuntimeMs=2000`；checker 直接比较 generated segment 的 effective `dp` budget。
- target mapping 降级为实际观察到的 `adaptive-window-change-floor-repair`，不再宣称 blocker/openDoor whitelist 已由当前 planner 支持。
- checker 锁定 observed/expected 一致、最多 baseline + 一次 repaired execution、所有 branch `repairIndex=0`、无第二次 insertion、rejection semantics、budget equality 与 deterministic live rebuild。

当前结论：PR-4.6a1 已建立 executed one-repair outcome evidence；仍保持 synthetic contract-only 语义，不描述为完整 OnlyUp route，也不修改 production 默认 repair 次数或搜索策略。

## 1.8 2026-08-02：PR-4.6a1a Validator & Execution Accounting

针对 review 指出的 rejected outcome 仍是常量、以及 incomplete case 把 branch evaluation 与 final repaired-spec execution 混称为一次的问题，本轮继续 shadow-only，进入 PR-4.6a1a。

- `validatePresentTileRelaxation` 现在实际读取 synthetic baseline state/project，检查 `checkedTiles`、`missingRequiredTiles` 与 `removedHardDependencies`，由 `validatorResult.accepted` 推导 rejected outcome。
- 增加 accepted reverse control：tile 存在且仅降级 non-hard dependency 时 validator 必须返回 accepted；hard tile 缺失/被移除时才返回 rejected。
- 将 accounting 拆为 `repairInsertionCount`、`orchestratorAttemptCount`、`branchEvaluationCount`、`finalAttemptCount`、`totalGraphExecutionCount`、`uniqueRepairedSpecCount` 与 `repairedRunExecutionCount`。
- 合同术语改为 `one-repair-insertion closure`；当前 success 的 graph execution 为 2 次，incomplete 为 3 次（baseline + branch evaluation + final repaired-spec run），不修改 production orchestrator 控制流。
- `observedOutcomeSource` 区分 `runAdaptiveSegmentPlanner` 与 `admissibility-validator`，顶层不再宣称所有 outcome 都来自 runner。
- checker 对五个 case 统一校验 generated segment、effective repair budget 与 300/2000 一致，并锁定 validator 双向 control 与 execution accounting。

当前结论：PR-4.6a1a 已补齐 validator 与 execution accounting evidence；Review 已正式关闭 PR-4.6a / a1 / a1a，且没有修改 production planner、DP key、dominance、agenda、容量或默认策略。

## 1.9 2026-08-02：PR-4.7a Resource Intent Scanner Evidence Contract

Review 已正式关闭 PR-4.6a 系列，下一主线进入 Resource intent scanner 接入。本轮只建立 scanner evidence contract，继续保持 shadow-only，不修改 production planner 默认行为。

### Contract 实现

- 新增 `resource-intent-contract-synthetic-simulator.js`，提供 deterministic synthetic state/action preview，覆盖属性 pickup、装备、低伤经验、开门产生新楼层 action，以及 blocker 后的 deferred HP resource。
- 新增 `audit-resource-intent-contract.js` / `check-resource-intent-contract.js`，直接调用现有 `lib/resource-intent-scanner.js`，将实际 scanner record 归一化为五类固定 output：`stat-gain`、`equipment`、`levelup`、`path-blocker`、`deferred-resource`。
- 每条 evidence 记录固定保存 source action、action chain、target tile/floor、before/after summary、delta、damage/cost、failure-class relevance、score decomposition、generated temporary goal 与 action policy。

### Failure controls

- `atk-deficit`：分别锁定攻击 pickup、攻击 equipment、低成本 levelup 三类 observed intent。
- `hp-deficit`：分别锁定 HP pickup、低伤 EXP、deferred HP resource 三类 observed intent。
- `target-action-unreachable`：只接受 door preview 后实际新增的 `changeFloor:S1->S2` action，不把 door tile 类型本身当作 blocker 证据。
- 同一 failure 的 high/low 两个候选稳定排序；无 action 时 scanner 返回 empty；deferred case 的 direct immediate pickup 不可用，输出为 blocker battle → hypothetical pickup chain。

### 验证与边界

```bash
npm run check:resource-intent:contract --prefix shared-solver
npm run run:resource-intent:contract --prefix shared-solver
```

报告执行 normalized full-report rebuild。该合同建立的是 scanner evidence 与 failure mapping 控制，不声称完整 OnlyUp route、真实大型 corpus 的全量安全映射、blocker/openDoor production repair，或任何 production 默认 planner 变更。

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

## 0.6 2026-04-28：Segment DP / milestone graph 进度

当前主方向已从 stage score / beam 权重转为：

```text
milestone graph
-> segment DP
-> goal skyline candidates
-> failure propagation
-> route-gui live replay
```

已完成：

- **正式 milestone graph**：`lib/milestone-spec.js` 已覆盖 MT2 I893 分支与 MT5 `blueKing（织光仙子）` 击破段。
- **goal skyline 主输出**：`lib/segment-dp.js` 每段保留 `highest-hp / highest-atk / highest-def / highest-mdef / highest-exp / shortest / best-combat` 代表，不只传单一路线。
- **失败传播**：segment 失败时输出 `failureClass`、`preferredCandidateTags`、`recommendedRepair`，例如 `atk-deficit -> 回退上一 milestone 的 highest-atk / best-combat candidate`。
- **hard/soft tile 约束**：`presentTiles` 是硬约束；`preferredPresentTiles` 只影响动作排序，不直接过滤路线。
- **milestone audit**：新增 `check-milestone-audit.js` 与 `npm run check:milestone:audit`，检查 mutation safeReason、stopOnFirstGoal 说明、hard present tile 后续用途或原因。
- **数据拆分**：milestone 数据已从 `lib/milestone-spec.js` 拆到 `milestones/onlyup-chaos-mt5-blueking.json`；JS 层只做加载、默认补齐和结构校验。

当前验证：

```bash
cd shared-solver
npm run check:onlyup:segments
npm run check:milestone:audit
npm run check:core
npm run check:onlyup:key-states
```

关键结果：

- `mt2-hp3834 -> mt3-i893-hp8425` 通过，最终 `hp=8425 atk=107 def=100 mdef=510`。
- `mt5-third-gate -> mt5-blueking-kill` 通过，最终击破 `battle:blueKing（织光仙子）@MT5:6,7`，剩余 `hp=4464`。
- 审计目前无 error；warning 主要提示 HP 阈值和 removedTiles 仍需补充容错说明，属于约束质量债，不阻塞当前回归。

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

### 6.8 Checkpoint Graph + Segment DP + HP Skyline

当前算法方向已从 `beam/stage score/topK` 调权重切到分段 DP：

```text
milestone spec
-> segment DP
-> goal skyline
-> milestone candidate frontier
-> route-gui live replay
```

新增入口：

```bash
npm run check:onlyup:segments --prefix shared-solver

node shared-solver/run-segmented-dp.js \
  --project-root='Only upV2.1/Only upV2.1' \
  --route-name=onlyup-chaos-mt5-blueking \
  --to-milestone=mt5-blueking-kill \
  --out=shared-solver/routes/latest/segmented-mt5-blueking.route.json
```

核心文件：

- `lib/milestone-spec.js`：把已验证 key state 升级为正式 milestone，不再只作为测试 oracle。
- `lib/segment-dp.js`：每段用 primitive-action DP 搜索，保留 goal skyline 候选。
- `lib/dp-search.js`：新增 `goalSkylineStates`，并保留 `firstGoalState` / `bestGoalState` 语义。
- `run-segmented-dp.js`：按 milestone graph 串接每段候选，后段失败时可自然尝试上一 milestone 的其他代表。

当前已验证：

- `mt2-hp3834 -> mt3-i893-hp8425` 可由 segmented DP 自动找到。该段已拆成：

```text
mt2-left-chain-open
mt3-first-return
mt2-redwizard-shield
mt2-i893-equipped
mt3-i893-hp8425
```

- `presentTiles` / `preferredPresentTiles` / `removedTiles` 已作为 milestone goal 的一部分使用：
  - `removedTiles`：当前段必须击破/获取的目标。
  - `presentTiles`：hard constraint，必须保留，否则后续段必死；任何会提前破坏它的动作会被该段 action provider 过滤掉。
  - `preferredPresentTiles`：soft hint，只降低破坏该 tile 的动作排序，不直接过滤；允许 DP 在能补偿的情况下牺牲它。
- 这解决了“当前 HP 更高但提前吃掉后续资源，导致下一段接不上”的错误 skyline 候选，同时避免把所有后续资源都写成 hard constraint。
- `mt5-third-gate -> mt5-blueking-kill` 可由 segmented DP 自动找到并击破 `blueKing（织光仙子）`。
  该段已从原 `mt5-blueking-local-balanced.route.json` / key-state 路线经验中拆出正式 milestone：

```text
mt5-sustain-balance
mt5-i894-equipped
mt5-final-stats-before-hp
mt5-before-blueking
mt5-blueking-kill
```

  关键约束包括：
  - `mt5-sustain-balance`：先清 `skeletonPresbyter@MT5:3,6（幽墟卫）`，并保留 I894 / boss 前血量链。
  - `mt5-i894-equipped`：清 `9,6 -> 9,4 -> 10,5` 并装备 `I894`。
  - `mt5-final-stats-before-hp`：清 `3,4 -> 4,7`，达到 boss 前最终攻防魔防。
  - `mt5-before-blueking`：清 `demonPriest@MT5:8,3（流萤猪）` 拿最终血量，保留 `blueKing@MT5:6,7（织光仙子）` 到 kill 段。
- 失败诊断输出 `failedSegmentId` 与 `missingGoalFields`，不再把局部失败表述成全局无解。
- route 输出仍为 primitive decision，可继续用 `route-gui.js` live replay。
- `check:onlyup:segments` 现在包含 milestone spec 静态审计：
  - `keyMode: "mutation"` 必须写 `dp.safeReason`。
  - `stopOnFirstGoal: true` 必须写 `dp.firstGoalSafeReason`。
  - `preferredPresentTiles` 不能和 hard `presentTiles` 重复。

已知限制：

- `presentTiles` 是 milestone 级约束，不是全局禁止动作。它只在当前段内过滤“会破坏本段下游地基”的动作；下一段如果目标需要清这些 tile，可以通过新的 milestone 放开。非必死资源应优先写入 `preferredPresentTiles`。
- 目前完整 `initial -> mt5-blueking-kill` 仍不默认进 `check:static`，避免本地耗时过高；轻量必过项是 MT2→I893 和 MT5 third-gate→blueKing 两个关键单段。

### 6.9 MT6/MT7：生命限制与目标制定经验

当前 MT5 `blueKing（织光仙子）` 后的路线推进遇到的关键问题不是普通防御门槛，而是 MT7 `poisonZombie@MT7:1,11（废墟入土魂灵）` 守护 `I616@MT7:0,11（灰岩重剑）`。`I616` 拾取后攻击 +3000，是继续推进的重要资源。

#### 6.9.1 `生命限制` 的真实语义

项目源码中 `special 80` 的说明与公式为：

```text
生命限制：敌人每回合伤害 *（敌人生命 / 角色生命）
```

也就是说，`poisonZombie（废墟入土魂灵）` 的伤害不是固定由攻防差决定；当前角色 HP 越高，单回合伤害越低。该机制带来两个直接要求：

- 战斗估算缓存 key 必须包含当前 `hero.hp`，否则相同攻防魔防但不同 HP 的状态会错误复用旧伤害。
- 对 `special 80` 敌人制定目标时，不能只写 `minHero.atk/def/mdef`；应优先使用 `goal.actionSurvivable.summary = "battle:poisonZombie@MT7:1,11"`，让 DP 根据当前状态计算真实所需 HP。

已修正：

- `lib/battle-resolver.js` 的 `battleEstimateCacheKey()` 已纳入 `hero.hp`。
- `check-core-regressions.js` 增加 `checkHpDependentBattleCache()`，用 `poisonZombie + special 80` 样本断言高 HP 伤害低于低 HP，且同 HP 仍可稳定命中缓存。
- `lib/segment-dp.js` 对 `actionSurvivable` 的失败诊断会输出真实 `hp > damage` 缺口，而不是只报 `missing-action`。

#### 6.9.2 当前已保存的 MT7 高血准备 checkpoint

从 `mt7-entry-after-mt6-sweep` 附近重新搜索，当前最好专项路线保存为：

```text
routes/latest/mt7-special80-hp-prep-bestseen.route.json
routes/latest/h5/mt7-special80-hp-prep-bestseen-from-step94.h5save
```

该路线停在：

```text
floorId = MT7
loc = 6,12
hp = 728418
atk = 5767
def = 4535
mdef = 30010
lv = 9
exp = 603
equipment = I894
```

对 `battle:poisonZombie@MT7:1,11（废墟入土魂灵）` 的诊断为：

```text
expected: hp > 10764157
actual: 728418
damage: 10764157
turn: 375
failureClass: action-survivability-deficit
```

因此，当前结论是：`MT7:1,11` 不是“当前路线差一点就能打”的普通怪，而是需要前置路线显著提高 HP / 战力后再尝试。继续从 `mt7-right-exp-crystal` 往后硬推没有意义。

H5 回放命令：

```bash
cd shared-solver
node export-h5-segment.js \
  --h5save=routes/latest/h5/mt7-special80-hp-prep-bestseen-from-step94.h5save \
  --play=1 \
  --headless=0 \
  --keep-open=1 \
  --auto-play=1 \
  --runtime-auto-battle=1 \
  --runtime-auto-pickup=1 \
  --timeout-ms=60000
```

注意：H5 回放必须开启 runtime 自动战斗和自动拾取，否则 GUI 与 solver route 会在 `getNext`、自动清怪、自动拾取处出现表面不一致。

#### 6.9.3 这轮发现的错误目标

旧目标 `mt7-right-exp-crystal` 的含义是：

```text
MT7 底部双飞蛾
-> battle:yellowPriest@MT7:11,11
-> auto pickup I734@MT7:12,11
```

该路线能拿 `I734（初等进化结晶）`，但在当前阶段会把 HP 从约 `499741` 降到 `298478`。从 `生命限制` 视角看，低 HP 会显著放大 `poisonZombie` 每回合伤害，因此这个目标不是通向 `I616` 的正确局部目标。

更合适的目标应写成：

```js
goal: {
  type: "heroAtLeast",
  floorId: "MT7",
  actionSurvivable: {
    summary: "battle:poisonZombie@MT7:1,11"
  }
}
```

或拆成更早的高血地基目标：

```text
MT5 blueKing 后
-> MT6 保留/获取高 HP 与关键防御资源
-> MT7 入口高 HP
-> 能承受 poisonZombie@MT7:1,11
-> 击破 1,11 后拾取 I616@0,11
```

不要把 `I734` 或右侧经验晶体作为默认“向前推进”目标；只有当它能带来足够等级/属性收益，且不会破坏 `生命限制` 所需 HP 时，才应进入当前段。

#### 6.9.4 目标制定原则更新

后续制定 milestone / adaptive repair 时按以下优先级判断：

1. **能否执行关键动作**：优先用 `actionSurvivable` 表达“能打这个怪并活下来”，不要先猜一个固定 HP 阈值。
2. **失败分类必须准确**：`actionSurvivable` 存在但 HP 不足时是 `action-survivability-deficit`，不是 `target-action-unreachable`。
3. **生存缺口不是纯 HP 问题**：对 `special 80`，HP、攻击、有效防御、魔防、等级和装备都会改变最终伤害；repair scanner 应同时考虑 `hp/atk/def/mdef/path`。
4. **高 HP 地基优先于短期经验**：如果目标怪存在 `生命限制`，提前打高伤怪换少量经验可能是负收益；应保留 HP 至少到关键承受线附近。
5. **有意义上下楼允许，无收益循环靠 DP key 剪掉**：上下楼用于清怪、拿资源、触发自动拾取或回到已开区域；纯 `A->B->A` 且无状态变化的循环应被同 key 更短/更高 HP 状态剪掉。
6. **checkpoint 不应只保留 highest-hp**：后续段失败时，需要同时保留 `highest-hp`、`best-combat`、`highest-def`、`highest-atk` 代表。特别是 `生命限制` 既吃当前 HP，也吃缩短战斗回合的战力。

#### 6.9.5 当前搜索方向

下一轮不要从 `mt7-right-exp-crystal` 继续往后硬推；应回退到 `mt5-blueking-kill` 或 MT6 早期 checkpoint，重新搜索：

```text
目标 A：MT6/MT7 高血地基
  floorId = MT7
  hp 尽量高
  保留进入 I616 左侧资源链的可能性

目标 B：MT7 生命限制承受线
  actionSurvivable battle:poisonZombie@MT7:1,11

目标 C：I616
  removedTile MT7:1,11
  pickup I616@MT7:0,11
  atk +3000 后进入下一段
```

当前已知失败样本显示，从 MT7 底部局部空间内最多只能推到约 `hp=728418`，仍远低于 `hp > 10764157`。这说明问题很可能在更早的 MT6/MT5 路线地基，而不是 MT7 底部几个怪的排列顺序。

建议下一步实现/使用：

- `actionSurvivable` 驱动的 adaptive segment：失败时自动回退上一 milestone 的 `highest-hp / best-combat / highest-def / highest-atk` skyline。
- 资源 intent scanner 对 `action-survivability-deficit` 同时扫描 HP、攻、防、魔防、装备与路径 blocker。
- 自动保存 bestSeen / bestProgress route 与对应 H5 checkpoint，避免每次从前 5 层手动回放。

### 2026-04-29 更新：MT7 blocked HP resource intent

用户指出 `poisonZombie@MT7:1,11（废墟入土魂灵）` 右上局部还有一条关键资源链。复查 MT7 左下地图后确认：

```text
redSwordsman@MT7:3,10（褐泥妖偶）
-> I619@MT7:3,9（灵红补给品）
-> poisonZombie@MT7:1,11（废墟入土魂灵）
-> I616@MT7:0,11（灰岩重剑）
```

`I619` 的估算 HP 增益为：

```text
core.values.greenPotion * 32 * MT7.ratio = 800 * 32 * 100 = 2,560,000
```

在当前 `segmented-mt7-right-exp-crystal.route.json` 终点：

```text
hp = 298478
def = 5535
redSwordsman@MT7:3,10 damage = 660000
redSwordsman minHpToSurvive = 660001
poisonZombie@MT7:1,11 damage = 22408975
poisonZombie minHpToSurvive = 2565103
```

因此算法结论变为：

```text
当前固定路线不是“直接继续往后推”的好地基。
正确 repair 子目标应是 battle:redSwordsman@MT7:3,10 可生存，
然后由正式 DP 自己打 redSwordsman、拾取 I619，再验证 poisonZombie 可生存。
```

本轮已实现：

- `battle-thresholds.js`：黑盒二分估算 `minHpToSurvive`，识别 `special=80` 为 `life-limit / hp-scaled-damage`。
- `segment-dp.js`：`actionSurvivable` 失败输出 `enemyId（中文名）`、伤害、阈值、riskTags；并将 special 80 归类为 `life-limit-hp-deficit`。
- `resource-intent-scanner.js`：新增 `blocked-hp-resource`，能从地图扫描到 `redSwordsman -> I619` 这种当前不可执行但解释明确的资源链。
- `adaptive-segment-planner.js`：life-limit 下优先选择 `blocked-hp-resource` repair branch。
- `segment-dp.js`：同一目标楼层的 `floorFly` 默认只保留最短代表，避免等价传送动作淹没局部 DP。

专项检查：

```bash
npm run check:onlyup:mt7-special80 --prefix shared-solver
npm run check:adaptive:onlyup --prefix shared-solver
npm run check:milestone:audit --prefix shared-solver
```

当前状态：

```text
scanner 已能正确输出 blocked-hp-resource:
  actionSurvivable battle:redSwordsman@MT7:3,10
  minHero.hp >= 660001
  present MT7:1,11 poisonZombie
  present MT7:3,9 I619

但从 mt7-right-exp-crystal 固定终点出发仍无法完成该 repair，
因为当前 HP=298478 已低于 redSwordsman 阈值。
下一步应让 planner 自动回退到 mt7-bottom-double-fairy 或更早 MT6 skyline，
寻找同时满足高 HP 与足够 def 的候选，而不是继续沿 mt7-right-exp-crystal 单路线修补。
```

### 2026-08-02 更新：PR-4.8a1 Structured RegionSpec Entry Validation

PR-4.7a1 已按 Review 正式关闭。PR-4.8a core audit 已获批准，但 Review 要求补齐结构化入口证据；本轮进入 PR-4.8a1，保持 shadow-only：

- `lib/region-entry-validator.js` 现在是 `run-region-dp.js`、audit 和 checker 的共享 validator，保留六类 executable schema/reference error code。
- `run-region-dp.js --validate-only=1` 对三个固定控制完成真实 preflight：解析 args、加载 spec/project、构建 milestone spec、解析 prefix/range boundary、校验 output path，且不运行 DP。
- Region-2 bounded probe 的 stderr 现在是结构化 `region-dp-error`：`prefix-milestone / prefix-budget-exhausted / mt1-gate-1559 / usedExpansions=1`，primary failure 仍保留为 `target-action-unreachable`。
- 六个负控均写入临时 spec 后通过真实 CLI preflight 拒绝，固定 `exitCode=2`、预期 error code、结构化 summary 和无 route 输出；不再只调用 audit 内部函数。
- checker 固定 region-1、region-2、WhiteIsland 的 exact preflight/probe expected map，检查预算使用不超限、route/found 一致、JSON/Markdown deterministic rebuild，并把 project fingerprint 扩展到 data、floors、enemies、items、map tiles 内容。
- 本轮仍不修改 production DP key、dominance、agenda、容量、默认策略或搜索结果选择语义，也不构成完整塔路线结论。

### 2026-08-02 更新：PR-4.8b Region Route Output Contract

PR-4.8a/a1 已按 Review 正式关闭。本轮进入 PR-4.8b，继续保持 shadow-only，目标是把“RegionSpec 能进入 runner”推进为“真实短路线能写出并可重放的 route output contract”：

- 新增 OnlyUp 与 Whiteisland 两个真实项目短正控，均通过 `run-region-dp.js` 获得 `found=true`、exit 0，并实际写出 `motapathfinder.route.v1` route。
- route metadata 现在锁定 RegionSpec ID、source/normalized hash、project content fingerprint、reached milestone、primitive decision count 和最终 floor/hero summary。
- 审计读取写出的 route，用 route-store resolver 逐项重新解析 decision；拒绝 macro kind/plan 持久化，并比较每一步 exact state key 及最终 exact state/summary。
- 负控先写入 stale route，再在真实 not-found runner 前显式删除；固定断言 not-found 不留下旧 route。
- 固定正控只覆盖 MT1 / A1 的短 smoke，不声称完成 MT1-MT5 或 Whiteisland 全塔路线。
- 本轮不修改 production DP key、dominance、agenda、容量、默认策略或搜索顺序。

### 2026-08-02 更新：PR-4.8b1 Runner-owned Output Cleanup

Review 对 PR-4.8b 的 core positives、route provenance、primitive exact replay 和 deterministic rebuild 均批准；唯一 P1 是 stale route 清理由 audit 完成，尚未证明真实 runner 自己安全清理。本轮进入 PR-4.8b1：

- 普通 `run-region-dp.js` 在解析 `--out` 后、加载 RegionSpec 前，由 runner 自身删除已有 route 文件；因此 not-found、prefix structured failure、加载阶段失败都不会把旧 route 留给下游。
- `--validate-only=1` 在清理分支之前返回；新增 preservation control 证明既有输出会保留，validate-only 不承担普通运行清理。
- audit 的 `runProbe()` 不再删除输出；negative control 记录 `staleRouteExistedBeforeRunner=true`、`harnessRemovedOutput=false`、`runnerOwnedCleanup=true`、运行后无 route。
- 增加 OnlyUp Region-2 prefix structured failure 控制，固定 `exitCode=1`、`stage=prefix-milestone`、`termination=prefix-budget-exhausted`、`failedSegmentId=mt1-gate-1559`，并验证 stale route 被 runner 删除。
- 本轮仍不修改 production DP key、dominance、agenda、容量、默认策略或搜索顺序，也不构成完整塔路线结论。

### 2026-08-02 更新：PR-5.1a Replay Start-Offset Contract

PR-4.8b/b1 已按 Review 正式关闭；下一主线进入 P5 Replay / h5save 产品化。本轮先实现 replay start-offset contract，保持 replay-contract-shadow 范围：

- `from-step=0` 是初始 checkpoint 别名，实际在 primitive decision 1 前暂停，`currentStep=1`、`lastCompletedStep=0`；`from-step=N` 的有效范围为 `0..routeLength`。
- `routeLength+1`、负数和非整数由 GUI session API 明确拒绝为 `HTTP 400 / REPLAY_STEP_OUT_OF_RANGE`，在 runtime 启动前返回，不会把越界 offset 静默夹到完成态。
- 固定复用 PR-4.8b OnlyUp 与 Whiteisland 短 route，覆盖 `from-step=0`、`1`、`routeLength`、checkpoint + offset、正负越界；每个有效控制均检查 resumed exact state、next decision、`lastCompletedStep`、GUI display floor/hero、继续后的 final exact state 和 primitive side-effect 顺序。
- `ReplaySession`/GUI status 现在暴露 requested/effective offset、expected boundary exact key、next decision 与 runtime/display floor/hero；GUI 输入允许 0，并在 top bar 显示当前 runtime 展示值。
- live snapshot 对齐保留 checkpoint 的 visited-floor baseline，并保留属于 solver flags/exact-state 语义的 runtime `__leaveLoc__`。回放层单独暴露 `runtimeSnapshotIdentity`（包含完整 flags 与 floor mutations），不把它冒充持久化 route boundary `exactStateKey`；Whiteisland checkpoint 的期望初始跨楼层 leave location 在 checkpoint 构造时补入，而不是比较时删除 actual。
- 不修改 solver、DP key、dominance、agenda、容量、路线选择或默认策略；该报告是 session/API contract 审计，不声称完整塔路线或 live runtime 已由静态检查覆盖。

### 2026-08-02 更新：PR-5.1a1 Replay Flag Identity Hardening

PR-5.1a 的 live exact-state review 要求保留 runtime `__leaveLoc__`、补齐 checkpoint 期望身份，并拒绝 CLI 非数字 offset 静默回退。本轮继续 shadow-only：

- 删除 live replay 对 actual `flags.__leaveLoc__` 的全局删除逻辑；normalized snapshot comparison 现在会报告旗标和后续 floorFly 落点差异。
- `ReplaySession` status 新增 `runtimeSnapshotIdentity`、`expectedRuntimeSnapshotIdentity` 与匹配结果；它们是由完整实际 runtime snapshot 构造的稳定 SHA-256，和持久化 `solverBoundaryExactStateKey` 分开。
- checkpoint 起点会从项目初始楼层/hero 位置推导初始跨楼层 restore 写入的 `__leaveLoc__`，并把期望值放进 checkpoint snapshot；不修改 route solver exact key 或路线选择。
- 新增真实 OnlyUp simulator `changeFloor -> floorFly` 控制：`flyRecordPosition=true` 时正确 leave location 回飞到 `(6,0)`，篡改 `__leaveLoc__` 会得到 `(5,0)` 并被 snapshot/hash mismatch 拒绝。
- `route-gui.js --from-step=abc` 保留原始输入，交给 `ReplaySession.normalizeStep()` 返回 `REPLAY_STEP_OUT_OF_RANGE / HTTP 400`。

### 2026-08-03 更新：PR-5.1a1a Checkpoint Flag Merge & CLI Gate

Review 暂缓关闭 PR-5.1a 系列，指出 checkpoint 后继续跨楼层时 baseline 不能按整对象补入，以及 direct CLI 尚未在 server/browser 前拒绝非法 offset。本轮进入 replay-runtime hardening；不修改 production solver/search 语义：

- `normalizeRuntimeSnapshotPair()` 对 `flags.__leaveLoc__` 改为逐 floor merge：expected 已有的 floor 保持 decision snapshot 值，checkpoint baseline 只补缺失 floor；actual runtime 的新 leave location 不再被覆盖。
- 新增真实 WhiteIsland StaticSimulator 与 live browser 组合控制：非初始楼层 A2 checkpoint → `changeFloor@A2:11,2` → `floorFly:A2@A1:11,2`；最终 runtime 同时保留 `Start` baseline 与 A2 leave location。
- 分别篡改旧 `Start` baseline 和新 A2 leave location，两条负控都产生 snapshot diff 与 runtime SHA-256 identity mismatch。
- `route-gui.js` 在 `createGuiServer()`、`listen()`、`openBrowser()` 和 `session.start()` 之前调用 `session.normalizeStep(fromStep)`；真实 `spawnSync node route-gui.js --from-step=abc` 以非零退出并输出 `REPLAY_STEP_OUT_OF_RANGE`，不启动 server/browser/runtime。
- `runtimeSolverExactStateKey` 相关 status/API 名称改为 `runtimeProjectedSolverStateKey`；它明确是 boundary template projection，不是完整 runtime exact-state capture；完整 runtime identity 仍由 `runtimeSnapshotIdentity` 提供。
- 本轮范围标签为 `production replay-runtime hardening; no production solver/search-semantics change`，不修改 DP key、dominance、agenda、容量、默认策略或路线选择。

专项检查：

```bash
npm run check:replay:flag-merge-cli --prefix shared-solver
npm run check:replay:flag-identity --prefix shared-solver
npm run check:replay:start-offset:live --prefix shared-solver
```

### 2026-08-03 更新：PR-5.1b h5save Resume Artifact Contract

PR-5.1a/a1/a1a 已正式关闭；本轮进入 h5save resume artifact contract，范围仍限定在 replay/export runtime，不改 production solver/search 语义：

- `export-h5-segment.js` 在指定 checkpoint 导出原生 h5save，并在 package 顶层附带 `__solverResumeArtifact__`；artifact 记录 schema、project/route fingerprint、原始 route boundary/final snapshot、已验证 runtime snapshot、boundary exact key、next decision、suffix 与 final identity。
- `lib/replay-resume-artifact.js` 集中处理 stable route fingerprint、h5save lz-string encode/decode、native saveData load，以及 project/route mismatch 错误码；`REPLAY_RESUME_PROJECT_FINGERPRINT_MISMATCH` 和 `REPLAY_RESUME_ROUTE_FINGERPRINT_MISMATCH` 在 CLI native replay 启动前返回。
- live checker 使用 WhiteIsland 固定短路线：真实导出 boundary → 新 runtime 加载 native h5save → 验证恢复后的 runtime identity/display/next decision → 执行 suffix → 验证最终 identity/display；另以 OnlyUp project/route 做两条 CLI 负控。
- 运行时跨楼层恢复产生的 `__leaveLoc__` 与 visited-floor baseline 仍由现有 runtime snapshot identity 规则处理；artifact 另存 canonical runtime snapshot，避免把 route JSON 省略的 runtime-only 字段误判为恢复失败。
- 确定性 shadow report 与 live browser smoke 分离；本轮不修改 DP key、dominance、agenda、容量、默认策略或路线选择。

专项检查：

```bash
npm run check:replay:h5save-resume --prefix shared-solver
npm run run:replay:h5save-resume --prefix shared-solver
npm run check:replay:h5save-resume:live --prefix shared-solver
```

### 2026-08-03 更新：PR-5.1b1 Loader-Owned Resume Verification

Review 指出 PR-5.1b 的 artifact/export contract 已成立，但 production loader 仍未真正拥有 resume verification：此前 validator 会信任 artifact 中的 identity 字段，`openNativeReplay()` 也没有在 suffix 前验证实际 boundary、next decision，或在 suffix 后验证 final state。本轮进入 PR-5.1b1，范围仍限定在 replay/export runtime，不改 production solver/search 语义：

- `lib/replay-resume-artifact.js` 现在对选定 route 做 exact boundary step/key/snapshot、next decision、suffix count、final key/snapshot 检查，并从存储 snapshot 重新计算 runtime identity；不再把 `identityMatches` 当作唯一证据。
- artifact 绑定 native `saveData` payload、`__solverReplay__` structured suffix 和 `__toReplay__` encoded suffix 的 stable SHA-256。route file 默认必需；省略时 loader 在创建 browser/server 前返回 `REPLAY_RESUME_ROUTE_REQUIRED`，只有显式 `--allow-unverified-route=1` 才允许 legacy unverified-route 模式。该模式只省略 selected-route fingerprint/exact-route 对照，仍用 artifact 自带 floor set 做 native payload 与 boundary/final runtime identity 校验。
- `openNativeReplay()` 在 `loadData()` 后先等待 runtime idle，capture 实际 boundary，验证 boundary runtime identity/display 与首个 next decision，然后才执行 structured suffix；suffix 完成后由同一 production loader 验证 final runtime identity/display。返回结果显式记录 boundary 前 suffix 执行数为 0。
- live checker 使用真实 WhiteIsland h5save 和 fresh browser runtime，锁定 project/route/无 route 三个前置拒绝，以及 native payload、boundary snapshot、structured suffix、final snapshot 四个篡改控制；所有控制都确认没有打印 `Replay opened` 或 `Runtime URL`，即没有进入 replay runtime。
- 确定性 report/checker 同步锁定三种 payload binding、route policy、stored identity 重算和 loader verification 顺序；production DP key、dominance、agenda、capacity、默认策略与路线选择语义均未修改。

专项检查：

```bash
npm run check:replay:h5save-resume --prefix shared-solver
npm run run:replay:h5save-resume --prefix shared-solver
npm run check:replay:h5save-resume:live --prefix shared-solver
```

专项检查：

```bash
npm run check:replay:flag-identity --prefix shared-solver
npm run check:replay:start-offset --prefix shared-solver
npm run check:replay:start-offset:live --prefix shared-solver
```

### 2026-08-03 更新：PR-5.1c Route GUI Resume Artifact Integration

PR-5.1b/b1 已正式关闭；本轮把已验证的 h5save resume artifact 接入 Route GUI，范围仍限定在 replay GUI/productization，不修改 production solver/search 语义：

- `route-gui.js --h5save=<path>` 现在先解码并验证 artifact；如果没有显式 `--route-file`，默认使用 artifact 中的 embedded route path，并保持 route verification 为默认要求。
- GUI detail panel、`GET /api/route` 中的 `resume` 字段和 `GET /api/resume` 统一展示 `verified`、`legacy`、`failed` 三种状态，以及 project/route fingerprint、boundary completed/next step、next primitive decision、runtime display/identity、native payload、structured suffix、encoded suffix 三类 binding 和 continuation final display。
- `--allow-unverified-route=1` 是显式 legacy metadata-only 模式；没有 route 时不生成虚假的 decision timeline，decode/validation 失败则保留稳定 error code/message，方便 GUI 展示恢复原因。
- 新增 `check-replay-h5save-gui.js`，以 WhiteIsland 固定短路线覆盖 verified API/CLI、tampered boundary、missing h5save、legacy metadata-only API/CLI，并检查 `/api/route` 与 `/api/resume` 的一致 payload。
- 本轮没有修改 production DP key、dominance、agenda、容量、默认策略或路线选择；既有 `ReplaySession`/live replay 语义保持不变。

专项检查：

```bash
npm run check:replay:h5save-gui --prefix shared-solver
npm run check:replay:h5save-resume --prefix shared-solver
npm run check:manifest --prefix shared-solver
```

### 2026-08-03 更新：PR-5.1c1 Resume Status Tri-State

Review 指出 PR-5.1c 的 legacy `routeFingerprintMatches=false` 会把“未检查”误显示为“已检查但不匹配”；本轮只修正 resume GUI projection、前端展示和专项 checker，不修改 loader、ReplaySession 或 production solver/search 语义：

- `lib/replay-resume-gui.js` 现在把 fingerprint match 投影为真正三态：`true=checked and matched`、`false=checked and mismatched`、`null=not checked/unavailable`。成功 legacy 模式的 route fingerprint 为 `null`，`routeVerified` 仍为 `false`。
- `gui/app.js` 明确显示 `match / mismatch / not checked`；headless Chromium DOM smoke 实际打开 Route GUI，锁定 legacy badge、空 timeline 与 `Route: not checked`，并禁止出现 `mismatch`。
- checker 新增真实 `route-gui.js` CLI/API 负控：tampered boundary 返回 `REPLAY_RESUME_RUNTIME_IDENTITY_MISMATCH`，missing h5save 返回 `REPLAY_RESUME_H5SAVE_INVALID`；两者都确认 server 已启动并通过 `/api/resume` 读取失败状态。
- 本轮不修改 h5save loader、ReplaySession、DP key、dominance、agenda、容量、默认策略或路线选择。

专项检查：

```bash
npm run check:replay:h5save-gui --prefix shared-solver
npm run check:manifest --prefix shared-solver
```

### 2026-08-03 更新：PR-5.2a GUI Resume Operation Flow

PR-5.1c/c1 已按 Review 正式关闭；本轮进入 GUI resume 操作流，范围仍限定在
replay GUI/productization，不修改 production solver/search 语义：

- `shared-solver/lib/replay-resume-controller.js` 管理当前 GUI artifact 和可选 runtime；`POST /api/resume/load` 接收 file picker/drag-drop 的 h5save 文本，仅在内存中解码和验证，不写入用户路径。
- `shared-solver/lib/replay-resume-session.js` 是独立于既有 `ReplaySession` 的 resume 状态机。verified artifact 才能启动；legacy、failed 或未加载 artifact 不允许 interactive runtime。
- `start` 先执行 loader-owned native `loadData()`，再验证 boundary runtime identity/display 与 next decision；状态停在 `paused` 后才允许 suffix `step/play`。
- 每个 suffix decision 使用现有 runtime action/post-snapshot contract；最后一个 suffix step 自动执行 final runtime identity/display verification。GUI/API 同时暴露 boundary gate、next gate、suffix progress、per-step status 和 final gate。
- `gui/index.html` / `gui/app.js` / `gui/styles.css` 新增 h5save file picker、drag/drop、`Load / Start Resume`、`Step Suffix`、`Play Suffix`、`Pause`、`Close Runtime`，并保持 legacy `match / mismatch / not checked` 三态展示。
- 新增 `check-replay-h5save-gui-flow.js` 覆盖真实 API 上传、boundary pause、suffix step、final projection、invalid upload 和 Chromium DOM controls；`check-replay-h5save-gui-flow-live.js` 使用真实 WhiteIsland 导出的 h5save 与 Chromium runtime 完成同一操作流。
- 本轮不修改 `shared-solver/lib/replay-session.js`、state key、dominance、agenda、capacity、默认策略、路线选择或 solver/search semantics。

专项检查：

```bash
npm run check:replay:h5save-gui-flow --prefix shared-solver
npm run check:replay:h5save-gui-flow:live --prefix shared-solver
npm run check:replay:h5save-gui --prefix shared-solver
npm run check:manifest --prefix shared-solver
```

### 2026-08-03 更新：PR-5.2b Resume Operation Robustness

PR-5.2a 已按 Review 正式关闭；本轮只收口 GUI resume operation 的非阻塞健壮性缺口：

- `POST /api/resume/play` 现在在创建异步任务前同步检查 session。合法调用返回 HTTP `202` 与 `accepted=true`；未启动、busy、非 paused 状态返回 HTTP `409` 和稳定错误码。
- `ReplayResumeSession.start()` 在 native restore、boundary gate 或 next-decision gate 失败时自动关闭 browser/static server；保留最后一次 captured runtime display、`lastError` 和 failed operation 状态。
- legacy metadata-only artifact 的 `/start`、`/step`、`/play` API 负控都锁定 `REPLAY_RESUME_INTERACTIVE_REQUIRES_VERIFIED_ARTIFACT`，不依赖前端按钮禁用。
- closure checker 使用真实 Chromium `setInputFiles()` 和 `DataTransfer` drop 完成上传，并在 DOM 中点击 Start/Step 后检查 boundary/final gate 文本；live checker 使用真实导出 h5save 完成 `play → pause → paused → play → completed`。
- 本轮不修改 `ReplaySession`、state key、dominance、agenda、capacity、默认策略、路线选择或 solver/search semantics。

专项检查：

```bash
npm run check:replay:h5save-gui:robustness --prefix shared-solver
npm run check:replay:h5save-gui:robustness:live --prefix shared-solver
npm run check:static --prefix shared-solver
```

### 2026-08-03 更新：PR-5.2c Resume Status Retention and Play State Controls

本轮继续保持 resume-only 范围，收口 PR-5.2b Review 指出的两个非阻塞 P2：

- `ReplayResumeSession.getStatusAsync()` 只有在 live runtime 返回非空 status 时才更新缓存；gate/restore 失败后 runtime 已清理，后续 `/api/resume/status` poll 仍保留最后一次 `runtimeStatus`。
- checker 通过真实 GUI API exact-lock `busy`、`completed`、`failed` 三类 `/api/resume/play` 负控：HTTP `409`，错误码分别为 `REPLAY_RESUME_BUSY`、`REPLAY_RESUME_INVALID_STATE`、`REPLAY_RESUME_INVALID_STATE`。
- 本轮不修改 `ReplaySession`、artifact validator、live-replay、state key、dominance、agenda、capacity、默认策略、路线选择或 solver/search semantics。

专项检查：

```bash
npm run check:replay:h5save-gui:robustness --prefix shared-solver
npm run check:static --prefix shared-solver
```

### 2026-08-04 更新：PR-5.3a Manual Solver Model Contract

本轮将“塔的原始 runtime 状态”和“求解器维护的 compact state/key”正式分层，但只接受手动声明，不把自动检测设为启动门：

- `shared-solver/lib/solver-model.js` 定义字段模式、机制开关、规范化和 fingerprint；手动模型优先，未配置塔回退到 conservative legacy model。
- `createInitialState()`、`StaticSimulator.stabilizeState()` 和 `buildDpStateKey()` 使用同一个显式模型。Only Up RegionSpec 关闭 `hpmax`、`mana`、`manamax`、`money`、`followers` 及 keys/doors/point allocation，保留 HP dominance、战斗/成长/装备 key。
- runtime snapshot、h5save 和 `live-replay.js` 未改变；模型 projection 只作用于 solver state。区域 route audit 的重放路径同步传入 RegionSpec model。
- `check-solver-model-contract.js` 验证 legacy 字段保留、compact hero、DP key 排除 disabled 字段、fingerprint、污染后重新投影和非法配置负控。

本轮明确不做：自动 analyzer、objective-aware GUI、launcher GUI、自动建议覆盖手动配置，以及与模型投影无关的 solver/search 语义改造。
