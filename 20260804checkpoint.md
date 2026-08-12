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
- **PR-5.5e VisitedFloors / ChangeFloor Production-Faithful Surface（完成，研究/qualification 轮，零 production 行为改动）**：复用 tracked `routes/fixtures/mt1-mt2-hp3834.route.json`，在当前 simulator 从真实初始状态 live replay 前 11 decisions，decision 12 精确匹配 recorded travel variant `changeFloor@MT1:6,0` 并 apply。parent `MT1/[MT1]` exact `0346b4ba143966bc` → child `MT2/[MT1,MT2]` exact `ca2cb576183965e6`。DP recorder 仅补 observation-only `parentFloorId/parentVisitedFloors`；closure fail-closed 要求 parent edge、真实换层、保留旧 visited 集并新增目标层，三个负控 + 一个正控通过。matrix 保持 **19 workload / 44/44/535 / 0 merge / 0 unsafe**，inventory 仍 10 distinct；`holeClosureSummary` 两项均 true。该边 production/candidate identity 都变化、partition equal、candidate collision=false，因此 5.5f evidence gate 未触发。
- **PR-5.6a Route Lineage Integrity（完成，`62fa0ff`）**：修复 compound parent→action→child route patch 重建，canonical state 继续 route-free；segment/route-free regression 锁定跨层 lineage。
- **PR-5.6b Goal Dependency Graph（完成，`7dfc3fd`）**：编译 floor/stat/effective-stat/equipment/removed/present/gateway 依赖，goal-directed agenda 按当前可行性、不可逆 landmark、下游完成度、下一 landmark 距离、stat deficit 排序；不进入 key/dominance/default skyline。
- **PR-5.6c Admissible Feasibility Bounds（完成，`2b93a8b`）**：显式 `admissible-v1` 支持 complete floor graph、unique equipment sources、protected tile、hero/effective-hero optimistic upper bound；证据不完整一律 `feasible:true, unknown:true`。每次 prune 输出 reason/current/target/bound/witness。
- **PR-5.6d Adaptive Segment Executor（完成，`7a33064`）**：新增显式 `adaptive-feasible`，按 failure preferred tags 做 bounded multi-level checkpoint expansion/replay；synthetic 三段链证明 one-level fail、depth=2 success。真实 long probe 能扩出 2/8 个上游候选，但仍停在 `mt5-third-gate`，结论仅 `INCOMPLETE_WITHIN_BUDGET`。
- **PR-5.6e Incremental / Parallel Execution（完成，`2b38b0f`）**：goal dependency projection 用 per-state/unique-requirement cache；真实 MT2→MT3 观测 requirement cache 383 hits / 849 misses。新增 independent-process route portfolio，serial/parallel exact state + strict route fingerprint parity 必须一致。
- **PR-5.7a MT5 First-Sweep Candidate Quality Shadow（完成，提交见本文件 HEAD）**：零 production selection/key/dominance 改动；capture-all goal archive 保存物化路线，原 milestone selector 输出同-key dedup 与 capacity drop，capacity matrix 固定 1/2/4/8；tracked MT3 fixture 捕获 8 attempts / 140 unique raw goals / 18 milestone candidates / 3 unique DP keys。140 个候选统一 100-expansion third-gate probe：140 fail / 0 budget exhaustion / 0 reached，最多 29 expansions 后 frontier empty。结论 `EVICTED_CANDIDATES_ALSO_FAIL`（Stop B），未发现 evicted-success witness，禁止进入 minimal skyline role refinement。
- **PR-5.7b MT5 Third-Gate Failure Attribution + Segment Refinement（完成，提交见本文件 HEAD）**：依 Stop B 顺序排查。action scope：目标候选 primitive==allowed，`actionTrimmed=0`；milestone target：tracked strict route 精确到达 `hp105138/atk1097/def965/mdef6310/exp367`；resource timing：同一 common state、同一战斗集合只改 I621 时序，early=`hp92030`、delayed=`hp105876`，差 **+13846 HP**；segment abstraction：新增 MT4 pre-entry 分段、return prep、first-entry、首扫单战、bottom pair、delayed heal checkpoints，并用 `presentTiles` 保留 `MT4:2,5` guard chain 与 `MT4:8,3`/I621。固定每段 500 expansions、`maxRuntimeMs=0`：HEAD 前 coarse graph **158867ms / 4050 expansions / third-gate FAIL**；最终细化版 **19610ms / 607 expansions / third-gate REACHED**（wall 仅本机方向性证据）。未改 production key/dominance/selection，也未提高 timeout/expansions/candidateLimit。
- **PR-5.7c MT5 Long-Chain Requalification（完成，提交见本文件 HEAD）**：5.7b 的资源时序 checkpoint 已直接打通 `third-gate → sustain-balance → I894 → final stats → HP → blueKing`，无需继续修改建模。新增 tracked MT4 closure 合同，锁定 18 段完整顺序、每段 500 expansions、`maxRuntimeMs=0`、`actionTrimmed=0`、无 budget exhaustion、最终 blueKing tile removed 与严格 recorded-decision replay。实测 **19320ms / 645 expansions / blueKing REACHED**，其中 third-gate 后仅 **38 expansions**；最终 hero `hp4464/atk2167/def2135/mdef13010/lv8/exp1101`、装备 I894，35 decisions strict replay，route fingerprint `a2b1b4f6…`。相对旧 coarse graph 是 **4050 FAIL → 645 SUCCESS**（expansions -84.1%，wall 约 8.22x，仅方向性）。PR-5.7 系列至此 CLOSED。
- **PR-5.8a Post-MT5 Long-Chain Baseline（完成，`42a2e36`）**：不改 production milestone graph/key/dominance/selection。相同 tracked MT4 fixture 先以 645 expansions 闭合 MT5，再固定每段 500 expansions、`maxRuntimeMs=0` 跑至 MT8 entry。post-MT5 **48960ms / 362 expansions** 到 `mt7-bottom-double-fairy`，首失败 `mt7-special80-ready`；全链 **1007 expansions**。失败两次 attempt 各 17 expansions 后 frontier empty，0 action trimming、0 expansion exhaustion、0 wall timeout；到达前缀 23 decisions strict replay，fingerprint `14ca77de…`。失败 hero `hp499741/atk5767/def5535/mdef30010/exp813`。tracked 已知路线要求 `MT6:2,1 evilFairy/+500 DEF → MT6:6,8 silverSlime`，而 coarse graph固定为反序；5.8a 只把它定为 **strong resource-timing hypothesis**。
- **PR-5.8b MT6 Defense Timing Causal Repair（完成，`973b9f7`）**：最小反事实只前移 `MT6:2,1` checkpoint 并保护 `MT6:6,8`，未受影响 milestones 完全一致，affected DP/action scope 及全局 candidateLimit 8、500 expansions/segment、`maxRuntimeMs=0`、goal-directed 全部不变；production key/dominance/selection 不变。5.8a historical A 仍复现 **362 / special80 FAIL / route 14ca77de…**；repair B 为 **508 / special80 REACHED / 17045ms**，hero `hp2672845/atk5767/def5535/mdef30010/exp881`，24 decisions strict replay（route `e0ea77ee…`，state `0564b870200d0113`）。verdict `CAUSAL_ROOT_CAUSE`。当时继续到 MT8 的 probe 只观测到 `mt7-left-sword` 500-exhaustion；5.8c 已证明该段 found=true，故不能把它解释成 not-found blocker。
- **PR-5.8c MT7 Left-Sword Budget Attribution（完成，提交见本文件 HEAD）**：从 strict special80 exact state `0564b870200d0113` 单状态运行，固定 candidate/goal skyline 8、500 expansions、`maxRuntimeMs=0`、goal-directed、`stopOnFirstGoal=false`。真实结果为 **found=true**：expansion 1 首次满足完整 goal；跑满 500 时 generated 2275 / accepted 799 / dominance rejected 1477 / frontier 201，goal nodes 158（84 active，8 retained），0 trimming、0 timeout、0 goal deficit。赢家 `hp4436803/atk8767/def6535/mdef30010/exp2237`，8 decisions strict replay（route `a36088b…`，state `22e75aa45404c026`）。verdict `FEASIBLE_GOAL_FOUND_WITH_INCOMPLETE_SKYLINE`：exhaustion 只表示 skyline 未穷尽，不能当 not-found；左剑无需加预算/checkpoint。显式 long-horizon probe 搜索到 MT8 entry，但整段 replay 在 decision 13 post-state mismatch，作为 5.8d 新 P1，未闭环。
- **PR-5.8d MT7→MT8 Strict Replay Attribution（完成，提交见本文件 HEAD）**：相同 strict special80 起点与冻结预算再次到达 MT8 entry；full route 37 = prefix 24 + suffix 13，route-record reconstruction 与 winner exact state 一致，decision exact chain 连续，前 12 步 replay 匹配。decision 13 `changeFloor@MT7:6,0` 的同一 choice fingerprint 下存在 3 个 path/travel/post variant（path 7/9/17）；resolver 在 exact post-state 评分前按 fingerprint 去重，错误保留 path-7，丢掉可精确复现 recorded post `cb06ec29bfa758c4` 的 path-17。verdict `RECORDED_ACTION_FINGERPRINT_ALIAS_DEDUP`；排除 prefix/lineage、resolver 输入副作用和 simulator 不可复现。本轮仅只读 observer + attribution/qualification contract，零搜索/replay 语义修改。
- **PR-5.8e Recorded Travel-Variant Replay Repair（完成，提交见本文件 HEAD）**：不改变 choice fingerprint；候选枚举改为只折叠相同 travel variant，同 choice 的 path/travelState variants 保留到 apply + exact-post 评分。synthetic unique/no/multiple exact-post controls 全通过（无 exact 并列 fail-closed 且顺序无关；多 exact 有 path 用 path、无 path 稳定 tie-break，并报告 alias count）。真实 legacy A 保持 decision 13 mismatch；repair B 从 3 aliases 选唯一 exact-post path-17，suffix 13/13 与 full lineage 37/37 strict replay，route reconstruction/final exact `5734ff36fe4d25c4` 一致（suffix `9714c59a…`，full `ecc13226…`）。verdict `MT8_STRICT_REPLAY_CLOSED`；搜索图、预算、checkpoint、key/dominance/selection 全未改。
- **PR-5.8f Solver Outcome Taxonomy / Doctor Hygiene（完成，提交见本文件 HEAD）**：新增共享 `search-outcome` taxonomy，将 `goalFound/frontierExhausted/budgetExhausted/searchComplete` 同时投影到 primitive DP、segment attempt、Solver Doctor 与 solver-job result；兼容保留 `expansionBudgetExhausted`。Doctor 对 found+incomplete 输出 `feasible-incomplete`，路线仍成功且 failure=null。synthetic truth table 覆盖四种主要组合、first-goal early stop、action trimming、time/RSS budget；真实 5.8c left-sword witness 仍为 expansion 1 goal、500 expansions、frontier 201、8 decisions strict replay，新四元组固定 `true/false/true/false`。零搜索/预算/checkpoint/key/dominance/selection/replay 行为改动。
- **PR-5.8g Recorded Replay Candidate-Apply Fast Path（完成，提交见本文件 HEAD）**：不改变 choice fingerprint、travel-variant retention、exact-post/fallback 评分或 ambiguity/tie-break；仅将既有 target/stance/direction hard reject 前移到 candidate apply 前，并复用同次 resolution 已计算的 winner post-state。真实 37-step full-lineage A/B：legacy `32846ms / 8633 candidate applies / 8593 after-apply rejects / 37 winner reapplies`；optimized `2458ms / 40 candidate applies / 8593 before-apply rejects / 37/37 post-state reuse`，wall 约 -92.5%、candidate apply 约 -99.5%；exact final、13/13 suffix、37/37 full lineage parity。默认完整 checker 同机方向性 wall `346788ms → 249835ms`（约 -28.0%，含搜索噪声）。零搜索/预算/checkpoint/milestone/key/dominance/selection 改动。
- **PR-5.9a Reachability Reuse Attribution（完成，提交见本文件 HEAD）**：只读 recorder 默认关闭，production exact-state LRU 与 walk build 行为不变。candidate-default MT1 exp9 仍为 116 expansions、winner exact `a2ff379819ac9003`、route `c0adb2d9…`、objective 1346、strict replay true。149 requests = 26 exact hits + 123 misses；123 misses 全为逐 exact-state 认证的 safe-fast。`floor/start/current-floor mutations` 投影得到 73 unique topology closures，22 repeated groups、50 theoretical reusable misses（40.65%），normalized closure mismatch=0；重复 exact state 仅 hero HP 不同。两次本机方向性 wall 7591–8024ms / reachability 221–224ms。verdict `SAFE_FAST_SKELETON_REUSE_CANDIDATE`，只授权后续 skeleton rebase repair。
- **PR-5.9b Safe-Fast Reachability Skeleton Cache（完成，提交见本文件 HEAD）**：保留 exact-state LRU；safe-fast 每个 exact miss 仍独立 safety classification，只用 `floor/start/current-floor mutations` 缓存不含 state/hero/inventory/flags 的 topology/path skeleton，再重建当前-state travel nodes。MT1 exp9 A/B/B/A：exact 26/123/123 parity；skeleton builds 123→73、hits 50，nodes expanded 6526→3497、transition attempts 26104→13988；state clones 6649 与 dominance-key builds 6526 保持。116 states/434 action+successor exact corpus `2ac91e5d1ce0aed2`、winner/route/objective/116 expansions/strict replay parity。方向性 median search 4130→3999ms（-3.2%），reachability 600.7→522.7ms（-13.0%）。verdict `SAFE_FAST_SKELETON_CACHE_PROMOTED`。
- **PR-5.9c Reachability Rebase Cost Attribution（完成，提交见本文件 HEAD）**：默认关闭、纯观察 accessor/escape recorder；不改 lazy/visited/action semantics。MT1 exp9 结果与 strict replay 继续 pin。123 rebases eager materialize 6526 nodes + 123 stability clones = 6649 clones，6526 dominance keys。现 consumer 对全部 nodes 产生 333011 state accesses，但 node.key property reads=0；760 emitted action travel references 只覆盖 566 unique nodes（8.67%），5960（91.33%）不 escape。consumer matrix 完整无 unscoped：battle 289/event 116/changeFloor 29/floorFly 326 actions；door/pickup/interactPickup/regionSignature 大量扫描但 0 travel action。verdict `EAGER_TRAVEL_STATE_MATERIALIZATION_OVERBUILD`。
- **PR-5.9d Topology-First Travel-State Materialization（完成，提交见本文件 HEAD）**：safe-fast 以 base exact state + skeleton coordinate/path 做 adjacency/tile lookup，endpoint/stateful candidate 命中后才 memoized clone stance；legacy-exact 保持原路径，`node.state/node.key` 兼容 surface 仍可按需物化。MT1 exp9 A/B/B/A：6526 topology nodes 中 materialized **6526→722**，state clones **6649→845**，dominance-key builds **6526→0**；116-state/434-action exact corpus `2ac91e5d1ce0aed2`、winner/route/objective/116 expansions/strict replay parity。方向性 median search 3896.5→3077ms，reachability 577.7→227.4ms，enumerateActions 689.1→379.5ms。PR-4.8b1 route-output diagnostic 按当前 candidate/milestone 规范刷新，两次 rebuild 一致且两个 final exact state 不变。verdict `TOPOLOGY_FIRST_MATERIALIZATION_PROMOTED`。
- **验证边界**：本地 static manifest suite 49/49；live-progress 显式 OnlyUp root 后 topology-first on/off 均复现同一首步 runtime mismatch（`MT1:2,7` 自动拾取未在 h5 runtime 发生），属于既有独立 drift，不归因到 5.9d。
- **PR-5.9e Remaining Materialization Attribution（完成，提交见本文件 HEAD）**：纯观察 recorder 默认关闭，observation on/off correctness 与 clone/key cost parity。722 materialized / 566 escaped 后的 **156/156** 全为 battle pre-action rejection；node-set union 分类为 119 lethal-only、31 no-damage-info-only、6 overlap。289 viable events 全部 emitted；unsupported、dedup reject/replace 均为 0。verdict `REMAINING_MATERIALIZATION_ATTRIBUTED`，机制 `BATTLE_PRE_ACTION_REJECTION_MATERIALIZATION`。
- **PR-5.9f Battle Evaluation Projection Repair（完成，提交见本文件 HEAD）**：safe-fast battle 先用冻结的 base exact state + `loc/direction/steps` stance projection 做只读 viability evaluation，只有 viable action 才物化完整 travelState；现有 evaluator clone/cache 边界、guard/location damage、action/dedup/apply 与 legacy-exact 均不变。独立 A/B/B/A：materialized **722→566**、clones **845→689**、residual **156→0**；battle materialized 568→289，emitted 289 不变。116-state/434-action exact corpus、winner/route/objective/116 expansions/156 accepted/strict replay 全 parity，verdict `BATTLE_EVALUATION_PROJECTION_PROMOTED`。
- **PR-5.9g Reachability Optimization Requalification（完成，提交见本文件 HEAD）**：独立进程 A/B/B/A 覆盖 6 个 MT1 workload + tracked MT2→MT3/MT4→MT5-entry。8/8 found + strict replay，winner/route/search scale exact parity；累计结构总量 skeleton builds **897→458**、nodes **47296→21338**、transitions **189184→85352**、clones **48299→7403**、dominance keys **47402→318**，逐 workload 均非增。wall 仅方向性，真实 MT4→MT5-entry 4475→3230ms；verdict `PR_5_9_REACHABILITY_OPTIMIZATION_CLOSED`，5.9 主线 CLOSED。
- **PR-5.10a Full Solve Hotspot Reprofiling（完成，提交见本文件 HEAD）**：perf tracker 新增向后兼容 exclusive/self-time（保留 inclusive），并报告 `sortActions`、unattributed residual。独立进程覆盖 MT1、tracked MT4→MT5 entry、完整 MT5、special80→MT8，全部 exact/scale/strict replay。前三者 top self phase=applyAction；MT8 5634 expansions 则 reachability > applyAction > clone（最终本机方向性 42.7%/23.9%/19.4%，不作硬阈值），5374 misses 中 1722 legacy-exact，reachability clones 302,510。verdict `HOTSPOT_SPLIT_BY_WORKLOAD_SCALE`；当时计划的 fallback/clone 与 applyAction 归因已被 2026-08-12 discovery 主线取代，现作为按需 carry。
- **PR-5.10b Discovery Capability Audit（完成，提交见本文件 HEAD）**：主线从 known-route 局部性能修复转为 autonomous discovery。初始状态→MT5 blueKing 的 authored input 盘点为 28 milestones（27 intermediate）、109 `minHero` fields、46 removed/105 hard-present tiles、45 allowed-floor/38 allowed-transition entries、68 per-segment DP fields；A0→A5 消融明确删除 `startFrom` 仍保留数组顺序，因此现 runner 从 A0 起就缺 unordered-event planning。A5 blind spec 只保留 terminal boss identity，零 route fixture/中间目标/阈值/楼层范围/事件顺序。verdict `ASSISTED_EXECUTION_NOT_AUTONOMOUS_DISCOVERY`；static 22/22。
- **PR-5.10c Blind Discovery Baseline（完成，提交见本文件 HEAD）**：独立 fail-closed blind-goal schema，只允许 tower/rank/terminal Boss；canonical initial state、单 segment、零 route/milestone/order/threshold/floor hints。1000-expansion 权威 before：33.046s、3123 generated/1960 accepted/1164 dominance rejected、frontier 496、1321 active keys、deepest MT3、max depth 39、0 trimming；四元组 `false/false/true/false`，verdict `BLIND_GOAL_NOT_FOUND_WITHIN_BUDGET`，不是无解。
- **PR-5.11 Search Trace Explainability（完成，提交见本文件 HEAD）**：新增 decision-depth/floor/action/rejection 聚合、human-review buckets 与 same-control before/after 卡；无 after 明示 awaiting，不同 budget/heap/candidate/priority controls 拒绝因果归因。深度表保留 parent/generated 与 successor rejection 的真实口径，不输出误导性的 per-depth rejection rate。1000-expansion trace 把 1164 dominance rejects（37.3%）、1059 changeFloor candidates（33.9%）、496 live frontier（15.9%）暴露为审查入口，但全部 `optimizationClaim=false`；0 action trimming。trace wall 含 observer 成本，不能与轻量 baseline wall 混比；focused + manifest static 56/56 通过。
- **PR-5.12 Automatic Macro Graph（完成，提交见本文件 HEAD）**：route-free 输入只含塔/canonical initial/terminal Boss；自动从 `changeFloor` 求 MT1→MT5 corridor，并复用 TowerIR 生成 409 nodes/722 edges（140 walk components、116 enemies、132 items、9 changeFloor、2 doors、6 mutation hooks）。目标唯一绑定 blueKing；正确发现 specialDoor 的静态 key 要求无 supplier，同时构造 blueKing afterBattle 写 flag → autoEvent 条件 → scripted openDoor 的 mutation dependency。115 普通敌人仍标 inspection candidate；`dependencyCompleteness=candidate-graph-not-proof`，不参与当前 correctness pruning。

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

1. **主线已在 2026-08-12 重置为自主路线发现，PR-5.10b 审计已完成**：已量化 milestone、顺序、资源阈值、tile、楼层/换层限制、fixture 和搜索参数，并建立 A0→A5 消融梯度。原定 MT8 legacy-exact/clone 与短中链 applyAction 归因暂停。
2. **PR-5.10c terminal-only blind baseline 已完成**：1000 expansions 到 MT3、frontier 496 的失败是权威 before；后续修改必须用相同输入/预算报告 goal/deepest floor/frontier/active keys/wall，不能通过加 timeout/candidateLimit 消掉失败。
3. **PR-5.11 可解释搜索轨迹已完成**：固定 before/after 卡与 decision-depth trace 已能显示候选生成、拒绝、frontier 和待审查类别；当前没有 after，因此不宣称优化。已知路线仍只能作事后 oracle。
4. **PR-5.12 自动宏观图已完成，下一步 PR-5.13 分层规划**：高层搜索 macro event 顺序，现有 DP/reachability 负责局部可达 transition 与 Pareto 结果；先验证结构性减少无关换层/局部重算，再做同预算 blind A/B。
5. **PR-5.14 D0–D3 验收**：D0 strict replay；D1 局部起终点；D2 楼层入口→Boss；D3 初始状态→最终 Boss。只有 D2/D3 的 no-hint found + strict replay 才算自主发现。
6. **5.5f collision CEGAR/minimal refinement 保持未授权**：真实 changeFloor edge的 production/candidate identity 都变化，未产生 same-scope merge；`NO_COLLISION_OBSERVED` 仍不等于 safe/promotion candidate。
7. **历史性能与工程 carry 保持隔离**：reachability closure gate、fast CI <3min、DIAG-HYGIENE、wall-time 非确定性、CompactState/Rust 均不抢占 blind discovery 主线；只有 blind trace 证明它们是当前 blocker 时再恢复。

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
