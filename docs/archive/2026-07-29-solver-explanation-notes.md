> 历史归档，非 canonical 文档。
> 当前架构请阅读 `docs/solver-architecture.zh-CN.md`；
> 当前模型边界请阅读 `docs/onlyup-current-model.md`。
> 本文对应 2026-07-29 的 solver 解释与可视化收口讨论，其中的计划和结论可能已经过时。

你现在停下来梳理是对的。最近几轮已经产生了明显的“解释债务”：代码和诊断能力不断增加，但你看到的主要是 `skylineInserted`、`goalAccepted`、`dominance witness` 这类机器术语，缺少一张面向项目负责人的总图。

先给出核心判断：

> 当前项目不是“算法完全理解了魔塔资源规划”，而是“用较完整的状态模拟 + DP 压缩 + 多候选保留 + 启发式排序”来控制组合爆炸。
> 它远强于纯暴力枚举，但对“某个资源为什么应该晚拿、某只怪为什么应该晚打”的未来价值理解仍不充分。你指出的建模提升空间确实存在。

---

# 一、项目现在到底怎么运作

整条生产链可以理解成：

```text
魔塔原始工程
Only upV2.1/Only upV2.1/project/*.js
                 │
                 ▼
        project-loader.js
  把地图、怪物、物品、楼层读成普通 JS 对象
                 │
                 ▼
          StaticSimulator
  模拟移动、战斗、拾取、升级、事件、上下楼
                 │
                 ▼
          milestone JSON
  定义这一小段允许做什么、达到什么算过关
                 │
                 ▼
         runMilestoneGraph
  MT1 门槛 → 进入 MT2 → local-3582 → HP3834……
                 │
                 ▼
            searchDP
  取一个状态 → 枚举动作 → 模拟动作 → 筛掉劣势状态
                 │
                 ▼
   DP skyline → goal candidates → checkpoint
                 │
                 ▼
              下一段
                 │
                 ▼
       route.json + strict replay
                 │
                 ▼
       浏览器 live replay / GUI
```

`project-loader.js` 会直接读取游戏原始的 `data.js`、`items.js`、`enemys.js`、`maps.js` 和所有楼层文件；也就是说，solver 不是在另一套手工录入的数据上工作，而是在解析游戏工程本身。

对外的主入口是 `shared-solver/public.js`，它把项目加载、状态创建、模拟器、DP 搜索、分段搜索、路线读写和浏览器回放统一导出。

---

# 二、最常见术语的中文含义

| 英文变量         | 可以理解成   | 实际作用                                             |
| ------------ | ------- | ------------------------------------------------ |
| `state`      | 游戏局面    | 当前楼层、坐标、HP、攻防、背包、flags、哪些怪和物品已消失                 |
| `action`     | 一次决策动作  | 打某只怪、捡物品、开门、上下楼；通常包含走过去的 path                    |
| `decision`   | 已记录的动作  | 写入路线文件的 action，并带执行前后快照                          |
| `node`       | 搜索树节点   | 一个 state，加上父节点和从哪里来的 action                      |
| `candidate`  | 候选局面    | 一个准备进入搜索或传给下一 milestone 的状态                      |
| `frontier`   | 待处理候选集合 | 搜索还没展开，或下一 segment 要继续尝试的状态                      |
| `agenda`     | 搜索队列    | 决定下一次先展开哪个状态；best-first、FIFO、hybrid 都是 agenda 策略 |
| `mutation`   | 地图变化    | 哪些格子被移除、哪些格子被替换                                  |
| `checkpoint` | 阶段存档点   | 一个 milestone 完成后保留下来、交给下一阶段的候选状态                 |
| `lineage`    | 候选血统    | 某个候选状态以及由它继续生成的后代                                |
| `observer`   | 旁观记录器   | 只记录搜索发生了什么，不应改变搜索                                |
| `witness`    | 证据状态    | 拒绝或替代某个候选的具体状态                                   |
| `gate`       | 门槛      | 可能指 milestone 的目标条件，也可能指审计报告的自检条件                |
| `skyline`    | 非劣候选前沿  | 保留多种有代表性的、不能简单判定为无用的状态                           |

---

# 三、`skyline` 到底是什么

## 1. 先不看代码，理解概念

假设有三个候选：

```text
A：HP 2000，ATK 20
B：HP 1800，ATK 22
C：HP 1700，ATK 19
```

A 和 B 各有优势：

* A 血更多；
* B 攻击更高。

所以不能简单删掉其中任何一个。

但 C 的 HP 和攻击都比 A 低，通常可以认为它被 A 全面压制，可以删除。

被保留下来的 A、B 就组成一个 **skyline（天际线、非劣前沿）**。这个词来自“从远处看城市，只有最外层建筑形成天际线”的比喻。

不过你项目里的 skyline **并不是一套严格统一的数学 Pareto 算法**。不同阶段有不同用途。

---

## 2. 项目里实际有四层“候选筛选”

### 第一层：DP bucket skyline

这是搜索过程中最内层的 skyline。

每产生一个新状态，先计算 `dpKey`，把“被认为未来等价”的状态放进同一个桶。当前 `dpKey` 包含：

* 楼层；
* region/location/mutation 模式；
* 攻防、等级、经验；
* 背包；
* flags；
* visited floors；
* 地图 mutations。

它故意不把 HP 作为桶身份的一部分，HP 通常用来比较同桶中的状态优劣。

每个桶可以保留一个或多个状态。`SkylineSet` 会：

1. 桶未满时直接加入；
2. 桶满时优先保护稀缺 role；
3. 否则用比较函数替换桶里最差的状态；
4. 完全不够好的新状态被拒绝。

当新状态在同一个 `dpKey` 下不比现有状态好时，产生：

```text
dominance-rejected
```

当它有价值但桶已经满，仍排不进去时，产生：

```text
skyline-capacity-rejected
```

DP skyline 的核心目的不是选最终路线，而是：

> 在搜索过程中控制状态数量，防止内存和分支爆炸。

---

### 第二层：raw DP goal skyline

搜索期间，只要某个状态通过 milestone 的目标条件，就触发：

```text
goalAccepted
```

所有通过目标的状态先进入 `goalNodes`。之后 `selectGoalSkylineNodes()` 会排序、按 key 去重，并限制最多保留若干个目标状态。

这层仍然属于 `searchDP` 内部。

更清晰的中文名称应该是：

```text
DP 原始目标候选集
```

而不是继续泛称 skyline。

---

### 第三层：segment goal skyline

`searchSegmentDP()` 拿到 DP 返回的目标状态后，再做一次面向阶段出口的筛选。

它会给候选贴这些标签：

```text
highest-hp       当前 HP 最高
best-combat      当前综合战斗分最高
highest-atk      攻击最高
highest-def      防御最高
highest-mdef     魔防最高
highest-exp      经验最高
shortest         路线最短
best-target-margin
target-survivable
```

如果启用了 `preserveSkylineRoles`，每种角色的第一名会被优先保留，然后剩余名额再按综合排序填满。

这就是你看到：

```text
candidate-0: highest-hp, highest-atk...
candidate-1: best-combat, highest-exp
candidate-2: shortest
```

的来源。

它不是说 candidate-2 数学上“最优”，只是说：

> 为避免只保留同一种风格的路线，至少保留一个路线最短的代表。

---

### 第四层：merged checkpoint frontier

一个 segment 可能从多个上游 checkpoint 分别启动搜索。

例如上游有四个 MT1 checkpoint：

```text
checkpoint A ──搜索──┐
checkpoint B ──搜索──┤
checkpoint C ──搜索──┼─ 合并所有目标候选 ─ 再筛选 ─ 下一 segment
checkpoint D ──搜索──┘
```

`runSegmentAgainstFrontier()` 会依次对每个上游 candidate 调用 `searchSegmentDP()`，收集所有 `goalSkyline`，再通过 `mergeMilestoneFrontier()` 合并成下一阶段的 frontier。

这个最终集合才是 milestone checkpoint。

---

## 3. 我建议以后统一改用这组中文名称

| 现在常用名称                    | 更容易理解的名称  |
| ------------------------- | --------- |
| DP skyline                | 同类状态保留桶   |
| raw goal skyline          | DP 原始过关状态 |
| segment goal skyline      | 本阶段出口候选   |
| merged skyline/checkpoint | 下一阶段入口候选池 |

这样以后我再说：

> candidate 在 DP 同类状态桶中被拒绝，但本阶段出口候选仍然保留了另一条等价路线

你就不需要先翻译四层 skyline。

---

# 四、`gate` 检验其实有两种，之前混在一起了

## 1. Solver milestone gate：游戏目标门槛

例如 `mt1-gate-1559` 的目标是：

```text
楼层 = MT1
HP ≥ 1559
ATK ≥ 19
DEF ≥ 10
MDEF ≥ 130
EXP ≥ 5
并且能够存活打 skeleton@MT1:8,1
该战斗伤害必须是 1558
```

这些条件直接写在 milestone JSON 中。

代码通过 `missingGoalFields()` 逐项检查：

* 楼层是否正确；
* hero 属性是否达到；
* 装备是否存在；
* 指定格子是否已删除；
* 指定资源是否仍然存在；
* 某场战斗是否可存活；
* 战斗伤害是否符合指定值。

只要有一项没满足，就把原因放进 `missing` 列表。列表为空时，`buildSegmentGoalPredicate()` 才返回 true。

所以：

```text
goalAccepted
```

的中文意思就是：

> 搜索自然产生了一个满足该 milestone 全部正式条件的状态。

---

## 2. Audit gate：报告自检门槛

另一种 gate 是我们最近的审计脚本自己定义的，例如：

```text
teacherStrictReplay = true
productionStrictReplay = true
commonExactState = true
searchExecuted = true
teacherGateGoalAccepted = true
worktreeCleanAtStart = true
```

它们不属于魔塔搜索，也不会影响候选选择。

作用只是：

> 这份诊断报告有没有满足足够的前提，可以把结论标记为 completed。

所以我之前说“gate contract 有缺项”，意思是：

* 报告虽然写 `completed`；
* 但它可能忘了把某个重要条件列入自检；
* 这属于审计工具不够严谨；
* 不等于游戏路线没通过 milestone。

以后应当明确叫：

```text
milestone condition：游戏门槛
audit validity check：报告有效性检查
```

不再都叫 gate。

---

# 五、Decision 3 那一段到底发生了什么

先把变量全部扔掉，用图解释。

## 1. 共同起点

Teacher 和 production 在 decision 1 后处于完全相同的状态：

```text
S1
```

然后它们选择不同的第二只红史莱姆：

```text
Teacher:
S1 ── 打红史莱姆 A ──> TA，位置在 (9,7)

Production:
S1 ── 打红史莱姆 B ──> PB，位置在 (10,7)
```

TA 和 PB：

* HP 相同；
* 攻防相同；
* 经验相同；
* 地图 mutation 相同；
* 可到达区域相同；
* 可用出口相同；
* 只有人物站位不同。

所以 region DP 认为 TA 和 PB 属于同一个“未来等价桶”。

PB 先进入了桶，于是 TA 被拒绝：

```text
TA dominance-rejected by PB
```

我们随后验证，从 PB 也能执行 teacher 的 decision 3：

```text
PB ── 打 blackSlime ──> S3
TA ── 打 blackSlime ──> S3
```

而且两边执行 decision 3 后得到的是 **完全相同的 exact state S3**。

所以这里的结论是：

> 删除 TA 没有删除它的未来能力，因为保留下来的 PB 可以一步后重新回到完全相同的状态。

---

## 2. 为什么报告却写 Decision 3 `candidate-not-generated`

审计 observer 当时的匹配条件是：

```text
当前事件的 preExactStateKey
必须等于 teacher decision 3 的 preExactStateKey
并且 action summary/fingerprint 相同
```

代码确实是按 `record.preExactStateKey === event.exactStateKey` 进行绑定。

但真实搜索执行 decision 3 时，前置状态是 PB，不是被拒绝的 TA：

```text
期望匹配：
TA exact key + decision 3

真实发生：
PB exact key + decision 3
```

因此 observer 没把这个事件记到 teacher decision 3 名下。

这只是：

```text
观察器不知道 TA 与 PB 已经被证明 continuation-equivalent
```

不是：

```text
搜索没有生成 decision 3
```

所以更准确的报告应该写：

```text
Decision 3:
teacher pre-state was replaced by a continuation-compatible witness;
the lineage exact-rejoined after this action.
```

中文就是：

> teacher 的前置状态已被等价状态替代；执行本步后，两条状态链重新完全汇合。

你不需要用这些变量亲自 debug。真正要看的只有三件事：

```text
1. teacher 原状态是否被拒绝？
2. 替代它的状态能否执行同一个下一动作？
3. 执行后是否回到完全相同的状态？
```

三个答案分别是：

```text
是
是
是
```

所以这个剪枝是安全的。

---

# 六、你对“当前算法还是半枚举”的判断基本正确

但可以再精确一点。

## 1. 它不是纯暴力枚举

当前搜索已经做了大量压缩：

* 一个动作可以包含走到目标前的一整段 path；
* 同一可达区域的站位可以归为一个 region；
* 同一 mutation/resource 状态可以共享 DP key；
* 被明确压制的状态会被删除；
* 用 milestone 把超长路线切成小段；
* 每个 milestone 只把少数 checkpoint 传给下一段。

这已经不等同于遍历所有操作序列。

---

## 2. 但它确实依赖“多保留几种风格，避免猜错”

当前 segment 候选的主要角色仍然是：

```text
当前 HP 最高
当前攻防最高
当前经验最高
当前综合战斗分最高
路线最短
对一个指定战斗的余量最好
```

这些是**当前状态评价**，不是完整的未来价值评价。

这次 teacher candidate 的情况非常典型：

```text
candidate-0：现在 HP 很高
candidate-1：现在综合属性很好
candidate-2：现在 HP 最低，但路线最短
```

candidate-2 最终被保留下来，是因为它拿到了 `shortest` 标签，不是因为算法已经推导出：

```text
这条路线会在 MT2 保留正确的资源消费时序，
所以 13 步后会比 HP 更高的候选多出数百点生命。
```

因此你说它有“半枚举”性质是准确的：

> 系统通过保留多个代表候选，降低评价函数猜错的风险。

---

## 3. 当前真正欠缺的是“未来价值模型”

这里要区分两件事。

### 状态表达是否完整

状态键里已经保存：

* 背包；
* flags；
* visited floors；
* 所有 removed/replaced tile mutations；
* 攻防经验装备等。

所以候选之间“哪些怪没打、哪些物品没拿”并没有从状态中丢失。

### 评价函数是否会利用这些信息

当前 segment candidate selector 虽然知道 mutations 不同，但它没有系统计算：

```text
这只怪现在不打，等多拿 2 点防后打，可以省多少 HP？
这颗宝石现在拿和升级后拿，对后续几只怪的总伤害差多少？
当前 EXP 距离升级还差多少？
某个留着的怪是不是未来自动战斗/仇恨机制中的 HP 资源？
某个资源是否会跨越关键攻防临界点？
```

这才是当前的主要建模缺口。

---

## 4. 项目其实已经有一个资源时序模型，但默认没有参与这几段

`resource-timing-model.js` 已经尝试计算：

* 某个资源带来的攻防变化；
* 对未来战斗伤害的预计节省；
* 新增可存活目标数量；
* 是否值得把资源留到以后；
* `retained-resource-option`；
* `combat-breakpoint`；
* `future-combat-saving` 等角色。

但 `searchSegmentDP()` 只有在 milestone 或运行参数显式请求 `resourceTimingModel` 时才启用；默认是关闭的。

你当前的 MT1→HP3834 milestone 配置只设置了 expansion、key mode 等，没有启用资源时序模型。

所以目前的真实情况是：

> 项目里已经有“未来资源时序建模”的雏形，但当前正式 OnlyUp milestone 链并没有依赖它，且它是否足以解释 HP3834 差异也尚未验证。

---

## 5. 正确的建模提升顺序

不应该立刻把 candidate-2 硬编码成“未来价值候选”，也不应该简单扩大 skyline。

更科学的顺序是：

### 第一步：找出真正的因果资源

比较 candidate-0、1、2、3：

```text
哪些 MT1 tile 状态不同？
哪些怪/宝石/药水只在 candidate-2 中保留？
EXP、等级、hatred、自动拾取状态有什么不同？
```

然后逐个做反事实实验：

```text
只改变其中一个资源的消费时间，
最终 HP3834 差值还存在吗？
```

最终得到类似：

```text
保留 X 怪到 ATK=Y 后再打，节省 420 HP
推迟 Z 宝石使后续三场战斗总计节省 310 HP
EXP 时序提前一级，净增加 275 HP
```

目前审计只证明了“差异存在”，还没有证明是哪一个资源造成。

### 第二步：把因果因素变成特征

候选状态可以计算：

```text
futureDamageSaving
expToNextLevel
unconsumedStatResources
criticalEnemyMargins
retainedResourceOptionValue
futureSurvivableTargets
```

### 第三步：验证预测能力

用已经知道结果的 checkpoint 做数据集：

```text
候选特征 → 预测最终 HP
```

只有当预测能稳定区分：

```text
3834
3369
2513
```

才有资格进入正式候选排序。

### 第四步：再决定放在哪一层

可能放在：

* DP dominance；
* DP skyline role；
* segment candidate role；
* agenda priority；
* milestone selector。

这四个位置影响完全不同，不能混着改。

根据现有证据，更可能先放在：

```text
segment candidate / checkpoint future-value ranking
```

而不是 DP key 或 dominance。

---

# 七、为什么最近看不到可视化

因为现在绝大多数开发轮次运行的是：

```text
StaticSimulator
searchDP
strict replay
audit script
```

这些全部在 Node.js 内存中运行，不启动浏览器。

`strict replay 33/33` 的含义是：

> 模拟器按路线重新计算 33 步，每一步状态都与路线文件记录一致。

它不是：

> 肉眼在游戏画面里看到了 33 步。

原始 HTML5 魔塔界面仍然存在。`index.html` 里仍有开始游戏、载入游戏、录像回放按钮，以及背景、事件、人物、前景、伤害、UI 等多层 canvas。

Windows 也已经在 live replay 代码中支持：

* Chrome 默认安装路径；
* Edge 默认安装路径；
* 自动启动本地 HTTP server；
* Playwright 打开游戏页面；
* 可选择 headless 或可见模式。

---

# 八、现在在 Windows 上恢复可视化

## 方案 A：使用 Route GUI

这更适合你理解路线。

它包含：

* Timeline；
* 每一步详情；
* Runtime 状态；
* 播放；
* 暂停；
* 单步；
* 跳转；
* 重启；
* 与 baseline route 比较。

后端接口和这些控制能力都已经存在。
页面本身由 Timeline、Step Detail 和 Runtime 三部分组成。

在 PowerShell 中：

```powershell
Set-Location 'E:\AUbuntuProject\project\motapathfind'

node .\shared-solver\route-gui.js `
  --project-root=".\Only upV2.1\Only upV2.1" `
  --route-file=".\shared-solver\routes\generated\agenda-policy-evaluation\mt1-mt3-i893-hp8425.current-exact.route.json" `
  --live=1 `
  --headless=0 `
  --step-delay-ms=700 `
  --keep-open=1
```

它会：

1. 启动一个本地 GUI 地址；
2. 自动在默认浏览器打开 Timeline 页面；
3. 同时启动真实魔塔游戏窗口；
4. 允许逐步播放 solver 路线。

`route-gui.js` 对 Windows 会使用 `cmd /c start` 打开浏览器，并默认 live 模式下使用可见浏览器。

---

## 方案 B：只看真实游戏回放

```powershell
Set-Location 'E:\AUbuntuProject\project\motapathfind'

node .\shared-solver\verify-route-live.js `
  --project-root=".\Only upV2.1\Only upV2.1" `
  --route-file=".\shared-solver\routes\generated\agenda-policy-evaluation\mt1-mt3-i893-hp8425.current-exact.route.json" `
  --headless=0 `
  --step-delay-ms=700 `
  --start-delay-ms=2000 `
  --keep-open=1 `
  --trace-live=1
```

`verify-route-live.js` 会读取指定路线，并交给 browser live replay。

`--headless=0` 会让浏览器可见；`--keep-open=1` 会在播放结束后保持窗口；每步还会检查真实游戏状态是否与 route snapshot 一致。

依赖缺失时，在仓库根目录运行：

```powershell
npm install --prefix .\shared-solver
```

当前唯一声明的运行依赖是 `playwright-core`。

---

# 九、接下来开发流程应该怎么调整

你已经把 PR-4.4h 发给本地 agent，可以让这一轮完成，但它结束后不应立刻进入下一轮算法修改。

建议进入一个专门的“理解与可视化收口轮次”：

## DOC/VIS-1：项目认知收口

交付四项：

### 1. `docs/solver-architecture.zh-CN.md`

包含：

```text
项目加载
状态结构
模拟器
动作枚举
DP key
dominance
四层候选筛选
milestone graph
路线回放
```

### 2. `docs/solver-glossary.zh-CN.md`

把本回答的术语表正式放进仓库。

### 3. `docs/onlyup-current-model.md`

明确写出：

```text
哪些是精确模型
哪些是启发式
哪些是 oracle-only
哪些是生产搜索
哪些是当前已知建模缺口
```

### 4. Windows 可视化 smoke

固定一条 current-exact route，保证一条命令即可：

```text
启动 Route GUI
启动真实游戏
逐步播放
显示当前 milestone、候选 tag、state diff
```

---

# 十、以后我会用这种格式给你解释每一轮

今后的 review 除了 Approved/P0/P1/P2，还应固定增加三段：

```text
本轮改了哪段真实算法
这些变量用中文分别代表什么
你在可视化界面里应该看到什么
```

而不是只告诉你：

```text
candidate inserted
skyline evicted
dominance witness compatible
```

当前项目可以用一句话总结为：

> 游戏原始工程被 StaticSimulator 精确模拟；路线被切成 milestones；每段通过 DP 搜索产生大量状态，用同类状态压缩和多角色候选保留控制规模；阶段候选继续传给下一段；最终路线通过内部 strict replay 和真实浏览器 replay 验证。当前主要短板不是地图状态完全没记录，而是候选评价仍偏重当前属性，尚未可靠理解资源推迟消费的长期价值。

这就是我们接下来真正应该优化的方向。
> 历史归档，非 canonical 文档。
> 当前架构请阅读 `docs/solver-architecture.zh-CN.md`；
> 当前模型边界请阅读 `docs/onlyup-current-model.md`。
> 本文对应 2026-07-29 的 solver 解释与可视化收口讨论，其中的计划和结论可能已经过时。
