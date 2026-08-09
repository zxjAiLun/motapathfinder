一句话判断：**项目已经从“能搜索几步的脚本”发展成了“有明确正确性边界、能生成路线、严格回放、断点恢复并展示诊断的求解平台”**。但它目前仍不是“无需人工里程碑、稳定自动解完整塔”的成熟算法。

## 一、现在项目多了哪些功能和算法

当前主流程已经比较清晰：

```text
RegionSpec
→ milestone graph
→ primitive segment DP
→ HP skyline
→ milestone 候选回退
→ adaptive repair
→ primitive route
→ live replay / GUI / h5save resume
```

这条流程已经取代了过去把 beam score 当作正确性依据的思路；`linear-main`、beam 和 macro search 现在只用于探索候选，真正的正确性主线是 region/segment DP。

### 1. 核心求解算法

| 能力                          |  当前状态 | 实际意义                            |
| --------------------------- | ----: | ------------------------------- |
| Canonical DP                |   已落地 | 按 DP key 合并未来等价状态               |
| HP dominance                |   已落地 | 同一抽象状态保留 HP 更高路线                |
| Segment DP                  |   已落地 | 把长路线拆成若干可证明的小段                  |
| Milestone graph             |   已落地 | 按 boss、楼层、属性、事件等目标推进            |
| Skyline candidates          |   已落地 | 不只保留一条路线，而是保留最高 HP、最高攻防、最短路线等代表 |
| Previous-milestone fallback |   已落地 | 后段失败后可以回退上一段其他候选                |
| RegionSpec                  |   已落地 | 用统一 JSON 描述区域范围、起点、目标和搜索参数      |
| Progressive monster planner | 架构已落地 | 基于“当前可达怪物”建议下一里程碑               |
| Adaptive repair             |  部分完成 | 能根据失败类型生成修复 intent，但还不是完整自动闭环   |
| Resource intent scanner     |  部分完成 | 能分析缺攻击、缺血、需要开门、资源延后等意图          |

核心 DP 的支配规则是：

```text
相同 DP key：
HP 更高优先
HP 相同 → 决策深度更短优先
仍相同 → 路线更短优先
```

DP key 会包含楼层、区域、属性、装备、背包、flags、地图变化、visited 状态等，但不包含 HP。

### 2. 状态抽象和安全性研究

这部分是很多 PR-4.5 系列的主要成果：

* action-labelled 状态关系审计；
* 深度 0–2 的 paired bounded counterexample search；
* projection collision 自动挖掘；
* 真实 MT1/MT2 corpus 的 collision inventory；
* mismatch witness；
* state-cap、branch-cap、execution-error 区分；
* stale artifact 和 deterministic rebuild 检查。

它的价值不是直接提高求解速度，而是回答：

> “哪些状态字段可以安全忽略？哪些看起来相同的状态，未来行为其实不同？”

目前真实语料中已经发现了既有等价 collision，也有 mismatch witness。因此这些研究**证明了不能草率缩短 production DP key**，但还没有给出一个全局安全的新 key。

### 3. 失败诊断和修复能力

现在搜索失败不再只是返回 `found=false`，而是会输出：

* `failureClass`
* 属性或 HP deficit
* action scope 是否不足
* 是否 action trimmed
* 是否时间或 expansion budget 耗尽
* candidate skyline 质量
* recommended repair
* preferred candidate roles

例如：

```text
atk-deficit
→ 回退 highest-atk / best-combat 候选

hp-deficit
→ 回退 highest-hp / low-damage 候选

target-action-unreachable
→ 扩展开门、换层或 blocker action scope

presentTiles 过严
→ 将硬约束降级为 preferredPresentTiles
```

不过这里要强调：**repair contract 已经比较成熟，自动 repair planner 本身仍是部分完成**。它能正确地说“修复成功、修复不完整、修复被拒绝”，但还不能保证自动修完整个塔。

### 4. 路线正确性和证明输出

现在一条“成功路线”不只是找到一个终局状态，还要求：

* 写出标准 route record；
* 只包含 primitive decisions；
* 保存每一步 pre/post snapshot；
* 保存 exact state key；
* project/RegionSpec provenance；
* 严格 replay；
* 输出 proof claim。

RegionSpec 结果能区分：

```text
bounded-complete
candidate-only
budget exhausted
action scope incomplete
unsafe stopOnFirstGoal
```

如果发生 `actionTrimmed`、time limit、expansion budget exhausted 等情况，项目不会再把“当前预算没找到”误报成“全局无解”。

### 5. 路线 GUI 和真实 runtime 回放

当前 GUI 已经支持：

* 静态查看 route；
* 每一步 action、伤害、经验、HP 变化；
* hero/inventory/flags/floor mutation diff；
* 启动真实 h5mota runtime；
* Play、Pause、Step、Restart；
* 跳转到指定决策；
* `--from-step=N` 从中间边界回放；
* 每一步 runtime snapshot 对比；
* mismatch 定位；
* 浏览器内展示 runtime identity。

### 6. h5save 分段导出和恢复

最近 PR-5.1～5.2 主要建立了这一整套功能：

* 从路线任意 checkpoint 导出原生 `.h5save`；
* 同时保存完整 route 和 suffix route；
* project fingerprint；
* route fingerprint；
* native payload SHA-256；
* structured suffix SHA-256；
* encoded suffix SHA-256；
* boundary runtime identity；
* next decision；
* final runtime identity；
* loader-owned boundary gate；
* loader-owned final verification；
* GUI 选择文件和拖放；
* suffix 单步、播放、暂停；
* legacy metadata-only 模式；
* gate 失败自动清理 runtime；
* 失败诊断保留；
* busy/completed/failed 状态稳定返回 HTTP 409。

这意味着现在已经可以把一条长路线切成“存档 + 后续决策”，再从真实存档恢复并验证后半段。

### 7. 工程治理

现在也已经明确：

* `shared-solver/` 是唯一 canonical solver；
* tower 内的 `solver/**` 是冻结的 legacy copy；
* 外部 agent 应使用 `shared-solver/public.js`；
* manifest 标记模块层级、正确性来源和测试级别；
* smoke test 和 closure test 被明确区分；
* tower 项目文件有 freeze checker。

按你刚刚的本地结果，目前是：

```text
static checks       21/21
manifest modules    84
manifest tests      70
tower freeze        147 files
```

---

# 二、现在应该怎样使用项目

## 用法 1：直接运行现有主线求解器

在仓库根目录运行：

```powershell
npm run run:onlyup:segmented --prefix shared-solver
```

这是当前 canonical milestone/segment DP 主线。

运行统一 RegionSpec：

```powershell
npm run run:onlyup:region1 --prefix shared-solver
```

官方入口说明也明确：segment/region DP 是正确性路径，beam/macro 只是辅助探索。

也可以通过塔目录 wrapper：

```bash
cd "Only upV2.1/Only upV2.1"
./solver.sh
```

或者：

```bash
cd "whiteisland（9）"
./solver.sh
```

Windows 下适合在 WSL 或 Git Bash 中运行这些 `.sh` wrapper。

## 用法 2：自己编写 RegionSpec

RegionSpec 大致如下：

```json
{
  "id": "onlyup-region-1",
  "tower": "onlyup",
  "rank": "chaos",
  "start": {
    "type": "initial",
    "floorId": "MT1"
  },
  "scope": {
    "floors": ["MT1", "MT2", "MT3", "MT4", "MT5"]
  },
  "goal": {
    "type": "bossDefeated",
    "floorId": "MT5",
    "x": 6,
    "y": 7
  },
  "search": {
    "algorithm": "segment-dp",
    "dpKeyMode": "region",
    "candidateLimit": 8,
    "stopOnFirstGoal": false
  }
}
```

RegionSpec 适合描述：

* 到达某楼层；
* 击杀指定 boss；
* 触发指定事件；
* 满足属性条件；
* 执行一组 milestoneRoute。

## 用法 3：查看搜索出的路线

进入 `shared-solver`：

```powershell
cd shared-solver
```

打印路线：

```powershell
node print-route.js --route-file="routes/latest/mt1-mt3.route.json"
```

静态 GUI：

```powershell
node route-gui.js --route-file="routes/latest/mt1-mt3.route.json"
```

真实 runtime 回放：

```powershell
node route-gui.js `
  --route-file="routes/latest/mt1-mt3.route.json" `
  --live=1 `
  --headless=0
```

从第 12 个决策前开始：

```powershell
node route-gui.js `
  --route-file="routes/latest/mt1-mt3.route.json" `
  --live=1 `
  --headless=0 `
  --from-step=12
```

## 用法 4：加载 h5save 并继续执行 suffix

例如：

```powershell
cd shared-solver

node route-gui.js `
  --project-root="..\whiteisland（9）" `
  --h5save="routes\latest\h5\segment.h5save" `
  --open=1
```

打开 GUI 后：

1. 选择或拖入 `.h5save`；
2. 确认显示 `Verified`；
3. 点击 `Load / Start Resume`；
4. boundary 和 next-decision gate 通过后停在 `paused`；
5. 使用 `Step Suffix`、`Play Suffix`、`Pause`；
6. 最后查看 final gate。

不带可验证 route 的 legacy artifact 只能看 metadata，不能启动 interactive runtime。

## 用法 5：从代码中调用

外部代码只应导入：

```js
const solver = require("./shared-solver/public");
```

可以调用：

```js
solver.loadProject(...)
solver.createSimulator(...)
solver.createInitialState(...)
solver.enumerateActions(...)
solver.applyAction(...)
solver.searchDP(...)
solver.runSegmentDP(...)
solver.runMilestoneGraph(...)
solver.runAdaptiveSegmentPlanner(...)
solver.loadRegionSpec(...)
solver.verifyRouteLive(...)
```

不要从 tower 的 legacy solver 或 `shared-solver/lib/**` 直接导入。

## 用法 6：验证当前环境

```powershell
npm run check:static --prefix shared-solver
npm run check:manifest --prefix shared-solver
npm run check:replay:h5save-gui:robustness --prefix shared-solver
npm run check:replay:h5save-gui:robustness:live --prefix shared-solver
```

---

# 三、现在距离“成功算法”还差什么

这里必须先定义“成功”。

## 如果成功指：能可靠解决一个明确限定的 RegionSpec

这个目标已经接近完成。

当前已经具备：

* 明确 action scope；
* primitive DP；
* skyline；
* bounded proof claim；
* route output；
* strict replay；
* live runtime verification；
* checkpoint/resume。

对于短区域和人工定义良好的 segment，当前系统已经是可用的。

**完成度约 80%～90%。**

## 如果成功指：人工给 milestone，自动解完一条较长路线

已经有较完整框架，但还存在：

* milestone 设计仍会决定成败；
* skyline 容量可能丢掉后续唯一可行候选；
* adaptive repair 还没有形成完整闭环；
* action scope 有时仍需人工调整；
* 长段性能和内存消耗仍然高。

**完成度约 60%～70%。**

## 如果成功指：不给人工路线提示，自动稳定解完整塔

这仍然是最困难、尚未完成的目标。

目前缺少的关键部分是：

### 1. 自动 milestone 生成还不成熟

Progressive planner 已有 current-reachable-first、mobility lane、SpecialTargetTracker 和 bridge，但真实 OnlyUp 自动里程碑生成仍有明显性能瓶颈。Roadmap 记录的状态仍是“架构完成，真实自动 milestone 生成需要性能提升”。

### 2. Adaptive repair 还不是全局闭环

目前 repair 能：

* 分类失败；
* 生成一个修复 segment；
* 正确报告成功或 incomplete。

但它还不能保证：

```text
后段失败
→ 自动定位最早错误地基
→ 扩展正确资源范围
→ 重新搜索
→ 多轮收敛
→ 完整塔成功
```

### 3. Production DP key 仍然偏保守

shadow audit 已经找到部分可以合并的局部状态，也找到真实 mismatch witness。

因此当前局面是：

* key 太粗会错误合并；
* key 太细会状态爆炸；
* 目前还没有全局安全、明显更小的新 projection。

这很可能是后续性能突破的核心。

### 4. Runtime 规则覆盖还不是 100%

历史研究记录仍列出一些未完全覆盖的领域：

* 特殊战斗和支援链；
* 部分 afterBattle；
* repulse、zone、laser；
* 部分 `checkBlock` 分支；
* `centerFly` 和更多特殊工具；
* 特殊门和地图机制。

只要这些规则没完整进入模拟器，完整塔路线就可能出现：

* solver 认为可行，runtime 不可行；
* solver 漏掉真实可行路线；
* 某个特殊机制之后状态 key 不完整。

### 5. 缺少完整塔成功证据

目前有：

* 小区域成功；
* 短 RegionSpec 路线；
* OnlyUp milestone/MT5 blueKing 回归；
* route 严格回放；
* WhiteIsland 的真实 replay/resume 验证。

但还没有建立：

```text
OnlyUp MT1 → MT11
自动找到
不依赖人工路线
可重复
无 action trimming
预算未耗尽
strict live replay 完整通过
```

也没有 WhiteIsland 全塔的同等级闭环证明。

---

# 四、我对当前完成度的估算

我建议不要只看一个百分比。

| 维度                        |    当前估算 |
| ------------------------- | ------: |
| 状态/规则模拟器                  | 65%～75% |
| DP、segment、skyline 搜索骨架   | 70%～80% |
| 自动 milestone 规划           | 40%～50% |
| Adaptive repair 闭环        | 35%～45% |
| 路线证明与 live replay         | 85%～95% |
| h5save / GUI / resume 产品化 |     90% |
| 完整塔自动求解证据                 | 20%～35% |
| 工程治理和测试基础设施               |     90% |

### 综合项目完成度

**约 60%～65%。**

### 纯粹以“自动稳定解完整塔”为目标

**约 45%～55%。**

也就是说，距离真正意义上的成功算法，大约还剩：

**45%～55% 的核心工作。**

这不是说还要写和现有代码一样多的代码。剩余部分的特点是：

* 代码量可能不大；
* 但实验成本很高；
* 每一个 key、dominance、capacity 或 milestone 策略变化都需要大量反例验证；
* 最后 30% 往往比前面 70% 难。

---

# 五、怎么看最近这么多轮的真实进展

最近很多轮 PR 的价值非常高，但它们主要解决的是：

```text
结果可信吗？
路线能重放吗？
断点能恢复吗？
失败能诊断吗？
旧 artifact 会不会误用？
route/project 是否匹配？
GUI 能否安全控制 runtime？
```

而不是：

```text
能不能搜索得更深？
能不能更快找到完整塔路线？
能不能自动生成所有 milestone？
```

PR-5.1 和 PR-5.2 基本都刻意没有修改 solver/search、DP key、dominance 和 agenda。

所以准确地说：

* **工程成熟度、可信度和可调试性提升非常大；**
* **完整塔自动求解能力并没有按 PR 数量同比增长。**

这其实不是坏事。现在已经把“找到一条假的路线、错误路线或不可恢复路线”这种地基风险大幅压下去了。接下来重新优化算法时，实验结果会可信得多。

## PR-5.4 主线现状（2026-08-08）

PR-5.4 系列把“状态抽象与 DP identity”推进到了可产品化的 guarded experimental profile：

- **PR-5.4b**：perf baseline + canonical route-free state + TowerIR shadow 已关闭。热点明确：`buildDpStateKey ≈ reachability ≈ 18.7s`（代表基线主导项）。
- **PR-5.4c**：StructuralKey 研究已关闭，**决策翻转 PROMOTION_CANDIDATE**。TowerIR structural candidate 把 62 exact keys 拆成 99（strict-refinement），split field distribution 证明 **32/32 split 唯一来自 `structuralCandidate.startComponentId`**；删除它后 `62→62 / equal partition / 0 unsafe`。即 TowerIR reachable closure 本身够用，startComponentId 是冗余 anchor，**无需 battle-closure-aware 新算法**。
- **PR-5.4d**：guarded experimental profile 已关闭，**GUARDED_PROFILE_APPROVED**。`dpKeyProfile` 成为真正选择接口（execution-boundary `resolveDpKeyProfile`：production-region 默认 / experimental-mt1-tower-ir-v1 单独启用 / 未知 profile 在 DP 前 fail-closed）；pinned `APPROVED_MT1_BASELINE` 绑定 6 项权威指纹（project/projectStructural/regionSpec 结构化/towerIrSource/towerIr/candidateProfileVersion），语义漂移（enemy stats/RegionSpec/wrong floor）全部 fail-closed。Paired 结果：**A key 38s vs B key 0.2s（~189x）；wall 42s vs 25s（~0.6x）**，A/B correctness byte-exact + strict replay 双验证。
- **PR-5.4e（Repair 完成）**：MT1 Workload Matrix + Default-Promotion Decision。6 个真实 MT1 workload（exp6/8/9 阈值 + maximize-atk 第二 objective + 两个 tileRemoved 终点），每个 A/B 双语料 partition audit + exact correctness + 结构计数 + 真实 reachability 归因。**Repair 收口 3 个 P1 + 2 个 P2**：partition audit 改按每个 workload 自己的权威 goal predicate（`buildSegmentGoalPredicate`，不再硬编码 exp>=9）；6 个 workload 全部建立真实 pinned baseline（winner/route/objective fp/value，A==pin && B==pin，未 pin 则 fail-closed）；reachability cache stats 改从真正参与 solve 的 simulator 读取（`executeSolveJob` 返回内部 simulator，不再是闲置 sim 的 0/0）；partition audit 改 cheap-equality-first，只有实际发生 merge 才跑 behavior CEGAR（当前 6 个 workload 均 equal partition → 不跑，matrix 从 ~4min/workload 降到单 workload 几十秒）。verdict 现为 **MT1_DEFAULT_PROMOTION_ELIGIBLE**。
- **PR-5.4f（完成）**：MT1 Default Promotion + Explicit Rollback。`resolveDpKeyProfile` 改为三态语义：显式 `production-region` → 永远走旧 key path（rollback，即使 approved MT1 也不自动改回）；**未指定 profile（implicit default）→ scope-aware fallback：approved MT1 scope 解析到候选 builder（`approved-mt1-default`），其他 scope 保持 production（`scope-unapproved-fallback`，不 throw、不扩散）**；显式 `experimental-mt1-tower-ir-v1` → 保留原 fail-closed guard（漂移 throw）。返回增加 `requestedProfile/effectiveProfile/selectionReason` 诊断（`executeSolveJob` 透出 `execution.profileSelection`）。6-workload matrix 改为 A=default / B=explicit-candidate / R=explicit-rollback parity（A==B==pin、R==pin、effective-profile 可观察）；新增 `check-mt1-default-promotion-contract`（Gates A–H：scope promotion、rollback 恢复 production 结构 116/267/156/112/62/62、unapproved scope implicit fallback vs explicit fail-closed、代表 strict replay、production invariants 未变）。verdict 现为 **MT1_DEFAULT_PROMOTION_ACCEPTED**（`eligible → 已做 default switch`，`production-region` 为显式 rollback）。
- **PR-5.4g（完成）**：Post-Promotion Full-Tower Regression。新增 `check-mt1-post-promotion-regression-contract`（S1–S4）：单 Region MT1 默认→候选 + pinned；显式 rollback→production 结构；unapproved scope implicit fallback（无 candidate builder）；**campaign / multi-Region v2 每 region 独立解析 profile**（approved MT1 region→candidate、unapproved region→production、无跨 region 泄漏）。为让 v2 路径一致，`executeSolveJobV2` 现在每个 region 在 execution boundary 调用 `resolveDpKeyProfile`（fresh executeConfig，候选 builder 不跨 region 泄漏），regionSummary 携带 `profileSelection`。**Regression 发现并修复一个 promotion 一致性 bug**：v1 归一化保留 region spec 的 `projectRoot` 而 v2 删除它，导致同一 approved MT1 region 在两条路径指纹不同 → v2 不晋级。修法：`computeRegionSpecFingerprint` 同样剥离 `projectRoot`（执行配置，非 region 结构），使 approved-scope 指纹归一化无关，并把 approved baseline `expectedRegionSpecFingerprint` 从 `510312b10d5ccec1` 重基线到 `36b7477cad2d6a96`（TowerIR/RegionSpec/其他 pin 不变）。verdict 现为 **MT1_DEFAULT_PROMOTION_REGIME_STABLE**。
- **PR-5.5a（Repair 完成，研究/证据轮，零 production 改动）**：Multi-Region Candidate-Key Shadow & Boundary Corpus。新增 `lib/multi-region-key-shadow.js`（纯观察 shadow：不参与 frontier pruning / dominance / ranking / checkpoint / route）+ `check-multi-region-key-shadow-contract`。核心问题：**状态经过 Region boundary checkpoint/transfer 后，现有 MT1 candidate identity 是否仍保留所有未来决策相关信息**（Region boundary 本身被视为 successor semantics，不是 state serialization seam）。三层 corpus：pre-boundary（R0 终端候选）/ boundary-transfer（`materializeNextRegionFrontier` 后 R1 真正收到的输入，含 inputCarried/post-boundary exact fp、regionInputIndex）/ post-boundary（R1 展开的可达状态）。**Repair 收口 3 个 P1 + 2 个 P2**：P1-1 改 per-region context（pre-boundary 用 R0 的 simulator/IR/goalPredicate，boundary/post/CEGAR 用 R1 自己的 IR，不再用共享 R0 IR 问"R1 state 在 R0 topology 下"）；P1-2 fixture 改用真实 `start.type="floor"` entry（entry relocation + `__leaveLoc__` + applyFloorArrival 真实发生，fail-fast 断言 hero 位移 / exact identity 变化 / leaveLoc 记录）；P1-3 boundary gate 改比 post-boundary **semantic identity（production DP key）** 而非 full exact fingerprint——HP/dominance 级差异只做诊断并交给 classifyPair dominance 逻辑（新增 dominance-safe control 证明不误判）；P2 checkpointFingerprint 删除（ancestry 恒 `{}` 无判别力）；P2 verdict 本轮 pin 死 `NO_COLLISION_OBSERVED`（升级必须显式 review，不许静默漂移）。两条 partition：A. state partition（exact→candidate，按层 + 总体）；B. boundary partition（pre-boundary candidate key → post-boundary semantic identity）。有序 CEGAR：boundary-transfer 等价第一（决定性），再 classifyPair。负控制（all-colliding）仍 fail-visible。**本轮结果：NO_COLLISION_OBSERVED**（3 层全 equal partition）——只是"未观察到碰撞"，**不是 safe，更不是 multi-Region 认证**。
- **PR-5.5b（Repair 完成，研究/证据轮，零 production 行为改动）**：Multi-Region Boundary Corpus Expansion。新增 `check-multi-region-boundary-matrix-contract`（workload matrix 11 个）：R0 frontier 变体（exp2/6/8/9/tileRemoved，**显式 goal，P2-3 关闭**）× entryA；R1 boundary 变体（exp6 固定 R0）× entryA/entryB/entryC（不同入口位置）、inventoryUse（携带 inventory 的 pickup/equip/openDoor/useTool）、flagCarry（battle-only，携带 flags）；3-Region chain（R0→R1→R2，2 条 boundary，验证 per-boundary context 不串）。R1 goal 静态校准（exp 阶梯或 tileRemoved(4,11)）保证 R1 真实搜索。**Repair 收口 3 个 P1 + 2 个 P2**：P1-1 collision scope 统一成真实生产竞争范围——state partition 按 region-execution-context + candidate key、boundary partition / CEGAR 按 boundaryIndex + candidate key、witness 同 scope 分组（新增 cross-boundary key reuse neutral control：3 个跨 boundary 复用 key → 0 merge，同 boundary 构造 merge → 检测到）；P1-2 coverage / signature / behavior CEGAR 全部改走 **production-legal action semantics**（regionContext 携带 `buildSegmentActionProvider`，`buildStateBehavior` 增 semantics-preserving `actionProvider` 选项），parity 断言（raw-only 必须是 policy 禁止 kind、legal-only 必须是 floorFly/interactPickup 附加 kind）——修复后 flagCarry 真实 legal kinds 只有 battle，新增 raw-vs-legal control（raw 集合不同但 legal 集合相同 → 不判 unsafe，实测 dominance-safe）；P1-3 witness 增 **production identity decomposition diff**（regionKey / reachableEndpointsKey / mutationSummary / hero / equipment / inventory / flags / visitedFloors / eventHazardLabel / loc / floorId），candidateProjectionDiff 保留（为空是"candidate 说相等"的确认）；P2 注释 10→11；P2 coverageOf 显式 `boundaryTransferCount` gate。6 个 control 全通过（all-colliding scoped / dominance-safe / semantic-drift / action-drift / raw-vs-legal / cross-boundary-reuse）。**本轮结果：NO_COLLISION_OBSERVED**（11 workload，24 pre / 24 boundary / 106 post 样本，0 merge / 0 unsafe）——collision-hunting framework 现在按真实 scope、按 production legal 行为分类、witness 可解释遗漏字段；依然不是 safe、不是 multi-Region 认证。

**PR-5.4e 已发现的重要事实**：smoke RegionSpec 自带 `dpBudget.maxRuntimeMs: 10000`（10s 时间预算）。在时间预算下 production 搜索是**时间受限非确定**的——tile4_1 workload 的 A 搜索两次跑出不同 winner（54/31 expansions，val 1199/1019）。合同必须 `maxRuntimeMs=0`（跑到底）才能做确定性 A/B 对比。这是 production 求解器的真实属性，需后续单独处理。

reachability 真实归因（perf tracker `reachability` phase + simulator cache stats）：**production A 266 次 BFS/34s vs experimental B 123 次/13s**——候选 key 消除 key-path 冗余 walk，总 reachability 工作量**下降**而非转移。Repair 后 cache stats 来自真实 solve simulator（A hits=151/misses=266，B hits=26/misses=123）。PR-5.4f 后 default 即候选（123 BFS），显式 rollback 才是 production（266 BFS）。

## 下一主线最值得做的事

1. **PR-5.5b Repair 已收口**：corpus 扩到 11 workload，collision-hunting framework 已按真实 scope / production legal 行为 / 可解释 witness 修正。下一轮 **5.5c**：继续扩 corpus（三 Region chain 变体、更多 R1 topology/goal 类型、arrival 更强 floor），直到第一次真实 merge witness；**出现 merge 才**进 collision CEGAR / minimal identity refinement（名字由证据决定）。
2. **multi-Region candidate-key generalization 路线**：5.5a shadow+boundary corpus → 5.5b corpus expansion → 5.5c collision CEGAR/minimal refinement → 5.5d multi-Region workload qualification → 5.5e guarded promotion（只有证据允许时）。
3. **reachability 缓存/复用**（性能下一热点）：enumerateActions 内的 walk 是 B 侧新热点，候选 key 已把总 BFS 从 266 降到 123，进一步做 cache/reuse。
4. **fast CI <3min**（P2-1 carry）：当前 fast ≈4m36s（solver-job ~99s + route-free ~43s + tower-ir ~15s + candidate-smoke ~101s）。要达标需在 fast 内部按分支并行，wall = max(各分支)。建议独立 CI-INFRA PR。
5. **DIAG-HYGIENE carry**：paired benchmark 旧 control `candidateProductionProfileDefaultOff:true` 与 PR-5.4f 后默认语义不符，改为 `approvedMt1CandidateDefaultOn` + `explicitProductionRollbackAvailable` 或删除；与 CI-INFRA 一起修。
6. **production 时间预算非确定性**：`dpBudget.maxRuntimeMs` 下的搜索结果依赖机器速度，需要确定性 budget 语义（按 expansion 而非 wall time）或文档化非确定。
7. **CompactState / Rust core**：在 multi-Region key 路线后再推进。

直到出现第一条：

```text
完整目标塔
自动生成计划
自动求解
无 unsafe trimming
完整 live replay
可重复通过
```

项目才可以从“成熟求解平台”真正跨到“成功求解算法”。
