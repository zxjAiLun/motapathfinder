# Cloud search + progress UI — 纳可物语零绿钥匙试炼

```ini
MILESTONE = CLOUD_SEARCH_PROGRESS
STATUS = VERIFIED
DATE_STARTED = 2026-09-19
BASE_COMMIT = 029b3954faa1887e808858feb3c593753acf16fc
SCOPE = 可落盘的 canonical DP 局部任务编排 + 只读进度 UI + cloud1 部署
```

## 问题与更正

Owner 授权部署 cloud1 并要求可查看进度的 UI。先前聊天的“五层零钥匙全通”“最优”和手写逐步表均已撤回：仅有不正确初态的前两段候选，第三段外层超时，没有合格通关证据。禁止作为本轮输入路线。

已读当前 handoff、PR-5.28、PR-5.27g、`docs/solver-architecture.md`、`docs/project-documentation-system.md`。现有 journal 是 planner 轮次级，不是 DP frontier 的完整持久化。本轮不改 DP/simulator 搜索语义，不使用已知路线 oracle。

## 初始设计与授权范围

- cloud1 实测为 Ubuntu 26.04.1 / ARM64 / 2 CPU / 11924 MiB 内存（不是口述16GB），空闲内存11263 MiB。独立用户目录 Node，单worker；建议堆6144 MiB、RSS8192 MiB，系统服务另设总内存保护。
- 可移植 profile 明确指定试炼起点 TS11(6,1)、HP100/ATK1/DEF0/LV1/EXP0、greenKey30、flag:saltygreen2。原始 state 工厂先设置起点再稳定化，不运行 Start 的自动拾取。它是**指定试炼初态，不是完整游戏存档**。JC19结算上下文采用显式零积分基线，jc19f5=1避免首次教程；不冒充用户未提供的总积分。
- 场景分段为 TS12、TS13、TS14、TS15、击败TS15(6,11)并结算至JC19。楼层/目标只在profile；底层保持通用。场景分段属于显式任务配置，不声称 autonomous segmentation。
- canonical `searchDP` 每个任务有时间、展开和内存上限；保留多个goal skyline候选；每个候选进入下一段队列，之前节点保留。后段失败可服务其它上游候选。预算受限的局部任务按预声明递增档重跑，**从该局部起点重跑，不称frontier续跑**。全部档位结束是 bounded-not-found，不能称无解或最优。
- 主进程原子写 journal / status，子进程运行同步DP并经IPC报告进度。已完成局部任务结果持久化；崩溃只重新执行在途局部任务。独占锁防止多个writer；输入配置与源码/塔快照fingerprint不匹配fail-closed。异常暂停，不无限重启。
- 零钥匙：禁止受保护资源的door requirements，限制在指定场景楼层，动作前后不得净减少受保护资源；审计此塔相关事件确认消费入口。端到端 `buildRouteRecord` 严格重放并核对约束后才记verified。条件不足时报错，不用人工表替代。
- 首轮目标是**找到可行路线**，找到严格重放通过路线即保存并停止；不宣称最大HP。后续优化单独扩大预算。
- UI由独立只读HTTP进程提供，只绑定127.0.0.1，通过SSH本地转发访问；无远端shell、任意文件读写、启停按钮或公网监听。显示当前阶段、候选、展开数、内存、时间、停止原因、初态、证据链接及心跳过期提示。无伪造完成百分比。

## Gate

1. 正确初态无Start route/mutation；受保护钥匙消费拒绝。
2. 已完成局部结果中断恢复不丢失；篡改配置拒绝，重复writer拒绝。
3. 合成小塔真实DP找到路线且strict replay；负例有限预算未找到不报通关。
4. UI API不缓存、无路径穿越/写接口；浏览器截图与实际状态相符。
5. cloud1部署独立目录、不覆盖服务；短跑通过后才启动长跑。CPU/RSS可见，重连可读状态。
6. `node -c`、focused check、`git diff --check`。不重复跑历史full static红灯或全资格套件。

## Publication / 已知限制

新runner、focused check、UI、profile、此文档和handoff在本轮边界；只暂存，不commit/push。部署包/日志/状态/截图放ignored generated目录。原有80项staged carry保持原样。塔外部导入仍ignore，不恢复tower-local solver。

本轮不保证有解、耗时或最优；保留数及各段预算均有限，逐层候选可能漏掉必须的跨层准备路径。搜索断点粒度是局部任务，不是任意展开节点。

## 迭代日志

- 2026-09-19：读取tower的JC19试炼入口，确认HP/ATK/DEF/EXP重置与TS11空arrival事件；saltygreen是flag，不是inventory。确认Boss afterBattle将试炼剩余HP×10累加到allhp并恢复外部属性，因此UI需区分试炼剩余HP与结算积分。
- 实现 `lib/durable-search.js`、`run-durable-search.js`、`search-progress-server.js`、`gui/search-progress.html`、profile及focused check。独占runner/worker锁；manifest登记（172 modules / 215 tests）。
- 合成门先捕获到door guard对null tile读取错误，改为先调用原canOpenDoor再检查消费；新增actionProviderError fail-closed，避免把基础设施/动作生成异常报成bounded MISS。
- 真实第一段的node trace重构在auto/travel额外primitive决策上不等价，strict replay正确拒绝；改为使用canonical DP的materialized primitive route entries，不使用不完整trace、不允许mismatch；captureTrace=false减少跨段拷贝，未改核心搜索语义。随后TS11→TS12的12决策strict replay PASS，HP985 / ATK4，绿钥匙30→34。
- 两段checkpoint续跑synthetic通过（先运行一个任务、退出、重启只运行下个任务）；运行身份篡改拒绝、负例不报通关、重复writer拒绝、只读HTTP方法/Host/路径边界通过。
- 云端安装独立Node v22.23.2 ARM64（官方HTTPS+SHA256），1237文件包逐个校验；云端synthetic和真实第一段strict replay均PASS。启用两个用户systemd服务，Linger=yes；只新增本应用服务，未动apt/防火墙/其它服务。
- 云端长跑已启动（2026-09-19 20:14 上海时间附近），首轮累计6小时、单worker、进程组9GiB硬上限。快照核验服务active/running、UI监听127.0.0.1:8787；本机SSH隧道已建立。
- 从持久化候选独立复核TS11→TS13共28决策，strict replay PASS：HP1369 / ATK6 / DEF0 / LV2 / EXP17，greenKey34。这里只是前缀，仍未找到五层Boss路线。
- 真UI截图：桌面与390px移动宽度，无pageerror、无横向溢出。首个Bun-hosted Playwright调用超时，改用实际Node启动同一Playwright验证通过；不是浏览器测试绕过。

## 验证与当前结论

- 本地/云端：`node shared-solver/check-durable-search.js` PASS。
- 本地：manifest / no-tower-solver / agent-boundaries(public-dev) PASS；新增JS语法检查PASS。本轮14个发布路径的cached diff-check PASS；全暂存区检查另发现**既有**`docs/260918/5-28.md:477`尾部空行告警，未修改上一轮carry，单独列为任务#25。未跑历史full static红灯及完整能力资格套件。
- UI：`http://127.0.0.1:8787/`，本机隧道连真实云端，已打开默认浏览器。
- 部署运维和精确路径/包hash/前缀证据：[cloud-search.md](../operations/cloud-search.md)。
- **VERIFIED的是部署、任务持久化合同和进度UI，不是终端求解能力或最优性**。搜索当前独立后台RUNNING，前两段prefix VERIFIED，后段仍在有限预算尝试。
- 不commit/push。后续只观察运行；若预算耗尽或error，读取journal/doctor原字段，再决定下一轮，不能把同样失败任务无限重启。
