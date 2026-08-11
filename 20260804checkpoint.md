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

## PR-5.4 / PR-5.5 / PR-5.6 主线现状（2026-08-10）

PR-5.4 系列把“状态抽象与 DP identity”推进到了可产品化的 guarded experimental profile；PR-5.5 系列（研究/证据轮，零 production 行为改动）把同一 identity 放到 multi-Region boundary 上做 collision hunting：

- **PR-5.4b**：perf baseline + canonical route-free state + TowerIR shadow 已关闭。热点明确：`buildDpStateKey ≈ reachability ≈ 18.7s`（代表基线主导项）。
- **PR-5.4c**：StructuralKey 研究已关闭，**决策翻转 PROMOTION_CANDIDATE**。TowerIR structural candidate 把 62 exact keys 拆成 99（strict-refinement），split field distribution 证明 **32/32 split 唯一来自 `structuralCandidate.startComponentId`**；删除它后 `62→62 / equal partition / 0 unsafe`。即 TowerIR reachable closure 本身够用，startComponentId 是冗余 anchor，**无需 battle-closure-aware 新算法**。
- **PR-5.4d**：guarded experimental profile 已关闭，**GUARDED_PROFILE_APPROVED**。`dpKeyProfile` 成为真正选择接口（execution-boundary `resolveDpKeyProfile`：production-region 默认 / experimental-mt1-tower-ir-v1 单独启用 / 未知 profile 在 DP 前 fail-closed）；pinned `APPROVED_MT1_BASELINE` 绑定 6 项权威指纹（project/projectStructural/regionSpec 结构化/towerIrSource/towerIr/candidateProfileVersion），语义漂移（enemy stats/RegionSpec/wrong floor）全部 fail-closed。Paired 结果：**A key 38s vs B key 0.2s（~189x）；wall 42s vs 25s（~0.6x）**，A/B correctness byte-exact + strict replay 双验证。
- **PR-5.4e（Repair 完成）**：MT1 Workload Matrix + Default-Promotion Decision。6 个真实 MT1 workload（exp6/8/9 阈值 + maximize-atk 第二 objective + 两个 tileRemoved 终点），每个 A/B 双语料 partition audit + exact correctness + 结构计数 + 真实 reachability 归因。**Repair 收口 3 个 P1 + 2 个 P2**：partition audit 改按每个 workload 自己的权威 goal predicate（`buildSegmentGoalPredicate`，不再硬编码 exp>=9）；6 个 workload 全部建立真实 pinned baseline（winner/route/objective fp/value，A==pin && B==pin，未 pin 则 fail-closed）；reachability cache stats 改从真正参与 solve 的 simulator 读取（`executeSolveJob` 返回内部 simulator，不再是闲置 sim 的 0/0）；partition audit 改 cheap-equality-first，只有实际发生 merge 才跑 behavior CEGAR（当前 6 个 workload 均 equal partition → 不跑，matrix 从 ~4min/workload 降到单 workload 几十秒）。verdict 现为 **MT1_DEFAULT_PROMOTION_ELIGIBLE**。
- **PR-5.4f（完成）**：MT1 Default Promotion + Explicit Rollback。`resolveDpKeyProfile` 改为三态语义：显式 `production-region` → 永远走旧 key path（rollback，即使 approved MT1 也不自动改回）；**未指定 profile（implicit default）→ scope-aware fallback：approved MT1 scope 解析到候选 builder（`approved-mt1-default`），其他 scope 保持 production（`scope-unapproved-fallback`，不 throw、不扩散）**；显式 `experimental-mt1-tower-ir-v1` → 保留原 fail-closed guard（漂移 throw）。返回增加 `requestedProfile/effectiveProfile/selectionReason` 诊断（`executeSolveJob` 透出 `execution.profileSelection`）。6-workload matrix 改为 A=default / B=explicit-candidate / R=explicit-rollback parity（A==B==pin、R==pin、effective-profile 可观察）；新增 `check-mt1-default-promotion-contract`（Gates A–H：scope promotion、rollback 恢复 production 结构 116/267/156/112/62/62、unapproved scope implicit fallback vs explicit fail-closed、代表 strict replay、production invariants 未变）。verdict 现为 **MT1_DEFAULT_PROMOTION_ACCEPTED**（`eligible → 已做 default switch`，`production-region` 为显式 rollback）。
- **PR-5.4g（完成）**：Post-Promotion Full-Tower Regression。新增 `check-mt1-post-promotion-regression-contract`（S1–S4）：单 Region MT1 默认→候选 + pinned；显式 rollback→production 结构；unapproved scope implicit fallback（无 candidate builder）；**campaign / multi-Region v2 每 region 独立解析 profile**（approved MT1 region→candidate、unapproved region→production、无跨 region 泄漏）。为让 v2 路径一致，`executeSolveJobV2` 现在每个 region 在 execution boundary 调用 `resolveDpKeyProfile`（fresh executeConfig，候选 builder 不跨 region 泄漏），regionSummary 携带 `profileSelection`。**Regression 发现并修复一个 promotion 一致性 bug**：v1 归一化保留 region spec 的 `projectRoot` 而 v2 删除它，导致同一 approved MT1 region 在两条路径指纹不同 → v2 不晋级。修法：`computeRegionSpecFingerprint` 同样剥离 `projectRoot`（执行配置，非 region 结构），使 approved-scope 指纹归一化无关，并把 approved baseline `expectedRegionSpecFingerprint` 从 `510312b10d5ccec1` 重基线到 `36b7477cad2d6a96`（TowerIR/RegionSpec/其他 pin 不变）。verdict 现为 **MT1_DEFAULT_PROMOTION_REGIME_STABLE**。
- **PR-5.5a（Repair 完成，研究/证据轮，零 production 改动）**：Multi-Region Candidate-Key Shadow & Boundary Corpus。新增 `lib/multi-region-key-shadow.js`（纯观察 shadow：不参与 frontier pruning / dominance / ranking / checkpoint / route）+ `check-multi-region-key-shadow-contract`。核心问题：**状态经过 Region boundary checkpoint/transfer 后，现有 MT1 candidate identity 是否仍保留所有未来决策相关信息**（Region boundary 本身被视为 successor semantics，不是 state serialization seam）。三层 corpus：pre-boundary（R0 终端候选）/ boundary-transfer（`materializeNextRegionFrontier` 后 R1 真正收到的输入，含 inputCarried/post-boundary exact fp、regionInputIndex）/ post-boundary（R1 展开的可达状态）。**Repair 收口 3 个 P1 + 2 个 P2**：P1-1 改 per-region context（pre-boundary 用 R0 的 simulator/IR/goalPredicate，boundary/post/CEGAR 用 R1 自己的 IR，不再用共享 R0 IR 问"R1 state 在 R0 topology 下"）；P1-2 fixture 改用真实 `start.type="floor"` entry（entry relocation + `__leaveLoc__` + applyFloorArrival 真实发生，fail-fast 断言 hero 位移 / exact identity 变化 / leaveLoc 记录）；P1-3 boundary gate 改比 post-boundary **semantic identity（production DP key）** 而非 full exact fingerprint——HP/dominance 级差异只做诊断并交给 classifyPair dominance 逻辑（新增 dominance-safe control 证明不误判）；P2 checkpointFingerprint 删除（ancestry 恒 `{}` 无判别力）；P2 verdict 本轮 pin 死 `NO_COLLISION_OBSERVED`（升级必须显式 review，不许静默漂移）。两条 partition：A. state partition（exact→candidate，按层 + 总体）；B. boundary partition（pre-boundary candidate key → post-boundary semantic identity）。有序 CEGAR：boundary-transfer 等价第一（决定性），再 classifyPair。负控制（all-colliding）仍 fail-visible。**本轮结果：NO_COLLISION_OBSERVED**（3 层全 equal partition）——只是"未观察到碰撞"，**不是 safe，更不是 multi-Region 认证**。
- **PR-5.5b（Repair 1 + Repair 2 完成，研究/证据轮，零 production 行为改动）**：Multi-Region Boundary Corpus Expansion。`check-multi-region-boundary-matrix-contract`：11 workload（R0 frontier exp2/6/8/9/tileRemoved × entryA；R1 boundary entryA/B/C、inventoryUse、flagCarry × exp6；3-Region chain R0→R1→R2）。R0 goal 显式构造（P2-3 关闭）；R1 goal 静态校准保证真实搜索。**Repair 1 收 3 P1**：P1-1 collision scope 统一成真实生产竞争范围（state partition=region-execution-context + candidate key、boundary/CEGAR/witness=boundaryIndex + candidate key；cross-boundary reuse neutral control 3 key → 0 merge + same-boundary 正控制 → 检测）；P1-2 coverage/signature/CEGAR 走 production-legal action semantics（`buildStateBehavior` semantics-preserving `actionProvider`；parity：raw-only=policy 禁止 kind、legal-only=provider 附加 kind；raw-vs-legal control 实测 dominance-safe）；P1-3 witness 增 production identity decomposition diff。**Repair 2 补 2 P1 闭环**：P1-2 legal provider 改用**真实 production milestone segment**（`buildRegionMilestoneSpec` → actual segment，segment.goal/presentTiles/resource-timing 全参与）+ segment parity 诊断（actual vs actionPolicy-only，11 workload 全 0 divergence）；P1-3 witness 路径**真实执行验证**（构造 collision → `captureMergeWitness` → 解析 artifact → 断言 productionIdentityDiff 含非 exactDpKey 解释字段，实测 regionKey/reachableEndpointsKey/mutationSummary/loc → cleanup）。P2 workload-specific carry 证据（inventoryUse 断言 inventory 值传入 boundary；flagCarry 断言 hatred/autoBattle/shiqu 值保持）。结果 **NO_COLLISION_OBSERVED**（11 workload，24 pre / 24 boundary / 106 post，0 merge / 0 unsafe）——依然不是 safe、不是 multi-Region 认证。
- **PR-5.5c Continuation Repair（完成，研究/证据轮，零 production 行为改动）**：修复 `globalSemanticDiversity` 聚合 bug（P1）——原实现用 `max(per-workload distinct)` 冒充全局计数，现改为 `globalSemanticDiversityOf`：合并全部 18 workload 的 corpus records 做**真实 union**（`collectSemanticValues` 收集 value sets，`sizesOf` 计数）。新增 **synthetic aggregation regression control**（W1/W2 各 1 个 distinct inventory → 全局 union=2；{M1,M2}∪{M2,M3} → 全局 mutation=3 而非 max(2,2)=2）。**修复后真实全局数字**：regionKey 30 / reachableEndpoints 30 / mutationSummary 29 / flags 36 / legalActionSet 49 / loc 17（原 max-bug 报 11/11/10/13/14/9，真实 diversity 远高于此）；**inventory=1 与 visitedFloors=1 在真实 union 下依然成立——"inventory 语义恒定（auto-pickup 捡光 MT1 物品、无消耗）"与"单 floor corpus"现在是被证据证明的 finding**（不再只是 per-workload 观察）。semantic gate（global mutation/reachability/flags/legalActions ≥2）结论不变且实现已修干净；header/assertion 文案同步（gate 明确排除 inventory/visitedFloors）。结果 **NO_COLLISION_OBSERVED**（18 workload，42 pre / 42 boundary / 181 post，0 merge / 0 unsafe）。
- **PR-5.5c Cross-Topology Repair（完成，研究/证据轮，零 production 行为改动）**：按 review 修正 3 个 P1。**P1-1**：whiteisland（9）在 git 中 untracked（gitignored，56.8MB/1754 files）→ marker CI ENOENT；跨塔 workload 删除，corpus 回到 18 workload production-faithful（CI 可复现）。**P1-2**：production `executeSolveJobV2` 每 chain 只加载一个 project——新增 fail-fast gate（chain 内所有 region 的 projectRoot 必须解析到同一 project，否则报错），禁止 harness-only 跨 project campaign 冒充 production corpus。**P1-3（部分）**：新增 fail-closed hole-closure gates（inventory distinct≥2 + acquire/consume 证据；visitedFloors maxVisitedFloorCount≥2）。**如实结论：两个空洞仍 OPEN**——已扫描全部 tracked OnlyUp fixture：MT1 无 door/key/drop/可及 changeFloor；sample0 key 被可破坏墙挡住（搜索 exp=31 失败）；sample1 唯一门需要不存在的 specialKey；sample2 可破坏墙迷宫搜索爆炸；Start 的 key 被门环封死。whiteisland 的 A1 door-key 探索（inventory distinct 11）保留为**探索性发现**（证明 classic tower topology 能提供 inventory surface，作为未来跨塔 production feature 或 fixture 入库的依据），不并入 production-faithful corpus。结果 **NO_COLLISION_OBSERVED**（18 workload，42/42/181，0 merge / 0 unsafe）——production-faithful 基线不变，空洞如实 OPEN。
- **PR-5.5c Cross-Topology Repair 2（完成，研究/证据轮，零 production 行为改动）**：修复 P1-3 假阳性漏洞——`inventoryHoleClosure` 原实现是任意 state pair 的 Cartesian product（`i<j 差值`），会把"两条分支恰好 key 不同 + mutation 不同"误判为 acquire+consume。Repair：**recorder 补 observation-only transition provenance**（dp-search `enqueue(state, sourceAction, parentNode)` 的 recorder payload 增加 `parentStateKey`（buildStateKey）、`parentInventory`、`parentMutations`（listFloorMutationSummary）、`actionKind`、`actionSummary`——只进 research 观察，不进 key/pruning/solver behavior，try/catch 保护不变）；hole detector 改为只走**真实 parent→action→child edge**：acquire = child key 增加 + actionKind ∈ {pickup, interactPickup}；consume = child key 减少 + actionKind ∈ {openDoor, useTool} **且同一 transition 上 child floor mutations ≠ parent mutations**。新增**正负 synthetic controls**：负（两 state key 不同/mutation 不同但无 parent edge → filled=false）与正（S0 --pickup--> S1 --openDoor--> S2 → acquire+consume+filled=true）——假阳性被锁死。visitedFloors closure 补 `changeFloorExecuted / arrivalExecuted / postArrivalSearchObserved` 字段，`filled` 额外要求真实 changeFloor transition。结果：**NO_COLLISION_OBSERVED**（18 workload，42/42/181，0 merge），`holeClosureSummary: {inventoryFilled:false, visitedFloorsFilled:false}` 如实 OPEN。
- **PR-5.5c Cross-Topology Repair 3（完成，研究/证据轮，零 production 行为改动）**：修复 P1-4 mutation representation mismatch——consume 检测的 parent/child mutation 用了不同表示（recorder 存 `JSON.stringify(listFloorMutationSummary(...))` 的 canonical array，detector 之前用 raw single-floor object `{"removed":{},"replaced":{}}`，无 mutation 时 `[]` vs `{"removed":{}...}` 恒不等 → 假阳性）。Repair：新增 `mutationSummaryFingerprintOf(floorStates)` 共享 helper（`JSON.stringify(listFloorMutationSummary(floorStates))`），child 侧与 recorder 侧**同一 canonicalization**（两边同 helper，parity by construction）。新增 **negative-2 control**：真实 openDoor edge + key 1→0 但 canonical mutation 无变化 → `consumeExecuted=false, filled=false`（锁住"key 减少 ≠ mutation 变化"）；正控改用 canonical 格式验证 door removal 可区分。结果：**NO_COLLISION_OBSERVED**（18 workload，42/42/181，0 merge），两空洞如实 OPEN。
- **PR-5.5d Production-Faithful Classic Tower Fixture Qualification（完成，研究/证据轮，零 production 行为改动）**：获得 production-faithful 的缺失语义面——**只用 tracked OnlyUp 数据**（不引入 whiteisland/不膨胀仓库）。发现 **OnlyUp Start floor 是真实 sealed key room**：floor-entry (6,4) 把英雄放进带 4 个 green key 的密室，goal 开门 tileRemoved(5,5)。新增 `start-door-key-entryA` workload（R0 MT1 exp2 → R1 Start）：354 post 样本、大量真实 openDoor edge（probe 观测 344 条，非 matrix 冻结字段）、inventory distinct **10**。**inventory hole CLOSED**（fail-closed transition evidence）：`distinctInventories=10`、`acquireExecuted=true`（I600 via interactPickup）、`consumeExecuted=true`（**greenKey via openDoor**，canonical parent→child 同 edge mutation 证据）、`filled=true`——全部是 tracked 单 project 生产语义。**visitedFloors hole PARTIAL**：cross-floor boundary 真实携带 MT1 + Start arrival → `maxVisitedFloorCount=2`、`arrivalExecuted=true`、`postArrivalSearchObserved=true`；但 **`changeFloorExecuted=false`**——tracked OnlyUp 可达区域均无真实 changeFloor edge（MT1 stairs 不可达；Start stairs 被 steel/special door 挡住且 floor 无对应 key；MT2 怪物对 carried hero 过强），如实 PARTIAL。结果：**NO_COLLISION_OBSERVED**（19 workload，44/44/**535** post，0 merge / 0 unsafe），`holeClosureSummary: {inventoryFilled:true, visitedFloorsFilled:false}`。
- **PR-5.6a Route Lineage Integrity（完成，`62fa0ff`）**：修复 compound parent→action→child route patch 重建，canonical state 继续 route-free；segment/route-free regression 锁定跨层 lineage。
- **PR-5.6b Goal Dependency Graph（完成，`7dfc3fd`）**：编译 floor/stat/effective-stat/equipment/removed/present/gateway 依赖，goal-directed agenda 按当前可行性、不可逆 landmark、下游完成度、下一 landmark 距离、stat deficit 排序；不进入 key/dominance/default skyline。
- **PR-5.6c Admissible Feasibility Bounds（完成，`2b93a8b`）**：显式 `admissible-v1` 支持 complete floor graph、unique equipment sources、protected tile、hero/effective-hero optimistic upper bound；证据不完整一律 `feasible:true, unknown:true`。每次 prune 输出 reason/current/target/bound/witness。
- **PR-5.6d Adaptive Segment Executor（完成，`7a33064`）**：新增显式 `adaptive-feasible`，按 failure preferred tags 做 bounded multi-level checkpoint expansion/replay；synthetic 三段链证明 one-level fail、depth=2 success。真实 long probe 能扩出 2/8 个上游候选，但仍停在 `mt5-third-gate`，结论仅 `INCOMPLETE_WITHIN_BUDGET`。
- **PR-5.6e Incremental / Parallel Execution（完成，`2b38b0f`）**：goal dependency projection 用 per-state/unique-requirement cache；真实 MT2→MT3 观测 requirement cache 383 hits / 849 misses。新增 independent-process route portfolio，serial/parallel exact state + strict route fingerprint parity 必须一致。
- **PR-5.7a MT5 First-Sweep Candidate Quality Shadow（完成，提交见本文件 HEAD）**：零 production selection/key/dominance 改动；capture-all goal archive 保存物化路线，原 milestone selector 输出同-key dedup 与 capacity drop，capacity matrix 固定 1/2/4/8；tracked MT3 fixture 捕获 8 attempts / 140 unique raw goals / 18 milestone candidates / 3 unique DP keys。140 个候选统一 100-expansion third-gate probe：140 fail / 0 budget exhaustion / 0 reached，最多 29 expansions 后 frontier empty。结论 `EVICTED_CANDIDATES_ALSO_FAIL`（Stop B），未发现 evicted-success witness，禁止进入 minimal skyline role refinement。
- **PR-5.7b MT5 Third-Gate Failure Attribution + Segment Refinement（完成，提交见本文件 HEAD）**：依 Stop B 顺序排查。action scope：目标候选 primitive==allowed，`actionTrimmed=0`；milestone target：tracked strict route 精确到达 `hp105138/atk1097/def965/mdef6310/exp367`；resource timing：同一 common state、同一战斗集合只改 I621 时序，early=`hp92030`、delayed=`hp105876`，差 **+13846 HP**；segment abstraction：新增 MT4 pre-entry 分段、return prep、first-entry、首扫单战、bottom pair、delayed heal checkpoints，并用 `presentTiles` 保留 `MT4:2,5` guard chain 与 `MT4:8,3`/I621。固定每段 500 expansions、`maxRuntimeMs=0`：HEAD 前 coarse graph **158867ms / 4050 expansions / third-gate FAIL**；最终细化版 **19610ms / 607 expansions / third-gate REACHED**（wall 仅本机方向性证据）。未改 production key/dominance/selection，也未提高 timeout/expansions/candidateLimit。

PR-5.6 before/after（本机方向性数据，严格结果由 fingerprint/replay 守门）：

```text
MT2→MT3: default 20 expansions / 507ms → goal-directed 16 / 368ms，exact state+route parity，strict replay true
MT4→MT5 entry: default first goal 49 expansions / 687ms → first-feasible 17 / 464ms，strict replay true
2-route portfolio: serial 20.28s → 2-process 8.59s（2.36x），exact state+route parity
MT3→MT5 blueKing: first-feasible/adaptive probes 均未找到；adaptive 500-expansion/depth3 约 19.91s，扩出 2/8 upstream candidates，仍停 third-gate
```

**PR-5.4e 已发现的重要事实**：smoke RegionSpec 自带 `dpBudget.maxRuntimeMs: 10000`（10s 时间预算）。在时间预算下 production 搜索是**时间受限非确定**的——tile4_1 workload 的 A 搜索两次跑出不同 winner（54/31 expansions，val 1199/1019）。合同必须 `maxRuntimeMs=0`（跑到底）才能做确定性 A/B 对比。这是 production 求解器的真实属性，需后续单独处理。

reachability 真实归因（perf tracker `reachability` phase + simulator cache stats）：**production A 266 次 BFS/34s vs experimental B 123 次/13s**——候选 key 消除 key-path 冗余 walk，总 reachability 工作量**下降**而非转移。Repair 后 cache stats 来自真实 solve simulator（A hits=151/misses=266，B hits=26/misses=123）。PR-5.4f 后 default 即候选（123 BFS），显式 rollback 才是 production（266 BFS）。

## 下一主线最值得做的事

1. **PR-5.7b 已完成；下一轮 5.7c Long-Chain Requalification**：从相同 MT4 checkpoint 继续验证 `third-gate → sustain-balance → I894 → blueKing`，沿用资源时序小 checkpoint；当前 pre-entry 最大单 attempt 已从 450 降到 19 expansions，下一热点是 `mt5-early-gem-entry` 的 133-expansion branch，仍禁止加 timeout/candidateLimit、修改 DP key 或引入 OnlyUp-specific core heuristic。
2. **multi-Region candidate-key 研究线保持独立**：5.5e visitedFloors/changeFloor surface → 5.5f collision CEGAR/minimal refinement（只有证据允许时），不得借 5.7 搜索改动扩大 MT1 production key scope。
3. **reachability 缓存/复用**（性能下一热点）：enumerateActions 内的 walk 是 B 侧新热点，候选 key 已把总 BFS 从 266 降到 123，进一步做 cache/reuse。
4. **fast CI <3min**（P2-1 carry）：当前 fast ≈3m26s（solver-job / route-free / candidate-smoke 串行主导）。要达标需在 fast 内部按分支并行，wall = max(各分支)。建议独立 CI-INFRA PR。
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
