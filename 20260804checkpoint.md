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

## 下一主线最值得做的事

现在不应继续扩充 GUI，而应回到三个求解核心：

1. **自动 milestone planner 的真实长程性能**
2. **adaptive repair 的多轮闭环**
3. **production state abstraction / capacity 的证据驱动优化**

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
