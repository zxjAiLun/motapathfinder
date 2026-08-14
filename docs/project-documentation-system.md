# Motapathfinder 项目文档管理规则

本规则用于长期、多人或 agent 协作的 solver 研发。文档用于解释证据、保存决策和交接上下文，但不替代代码、测试、route record、strict replay 或 benchmark artifact。

## 项目配置

```ini
HANDOFF_PATH = 20260804handoff.md
HANDOFF_PUBLICATION = tracked
MILESTONE_PATTERN = docs/YYMMDD/<milestone-id-with-hyphens>.md
DATE_TIMEZONE = Asia/Shanghai
GENERATED_ARTIFACT_POLICY = ignored generated directories unless explicitly promoted as a tracked fixture
STATUS_VOCABULARY = PROPOSED | DESIGNED | AUTHORIZED | IMPLEMENTED | VERIFIED | REVIEWED | ACCEPTED | FROZEN | REJECTED | NOT_PROMOTED | DEFERRED | BLOCKED
```

命名示例：2026-08-14 启动 PR-5.18c 时，文档为 `docs/260814/5-18c.md`。

- 日期目录使用轮次**首次建立文档时**的上海日期。
- milestone ID 中的点改成连字符：`5.18c` → `5-18c.md`。
- 同一轮即使跨日，也继续更新原文件；不要因为日期变化复制一份新文档。
- 只有独立事故、正式长运行、迁移或发布操作才另建同日期附属文档，并从 milestone 文档链接。

## 两层文档模型

```text
20260804handoff.md       当前项目真相、里程碑索引、活动轮次和下一步
docs/YYMMDD/5-18c.md    一个完整开发轮次的设计、迭代、证据和结论
code/tests/routes        机器可验证的实现与证据
generated directories   可重建、大型或临时输出，不默认提交
```

| 层级 | 必须回答 | 不应承担 |
| --- | --- | --- |
| 项目 handoff | 当前基线、边界、活动轮次、证据入口、下一授权步骤 | 每次调试的完整流水账 |
| 轮次文档 | 为什么做、如何判断、改了什么、证据证明了什么 | 跨项目的第二份当前真相 |

`20260804checkpoint.md` 与 `shared-solver/RESEARCH_PROGRESS.md` 是历史累计记录。它们可以继续保存旧证据，但新的当前状态与下一执行顺序以 handoff 和活动 milestone 文档为准。

## Layer A：tracked handoff

`20260804handoff.md` 是当前 canonical handoff，随代码和轮次文档一起提交。

顶部快照必须简短并包含：

- 最后核验日期；
- 分支、已核验基线和远端关系；
- 当前 phase；
- 最近已验证轮次；
- 当前活动轮次及其文档链接；
- 下一授权工作。

发生以下任一事件时必须更新 handoff：

- milestone 状态变化；
- 验证结果改变当前结论；
- 新的 negative result 排除一个方向；
- 下一执行顺序发生变化；
- tracked baseline、正式 artifact 或兼容边界改变。

handoff 写作规则：

1. 当前事实与未来计划分开写。
2. 每个 milestone 保留索引，即使后来被拒绝或取代。
3. 链接轮次文档和证据，不复制全部日志。
4. 负结果必须保存，不能在后续成功后删除。
5. 更正旧结论时追加 supersession/correction，不能抹掉当时有效的判断。
6. 不写尚未存在的 commit hash；可写“本文件所在提交”，待后续验收轮再绑定精确 hash。

## Layer B：日期目录下的 milestone 文档

一个文件对应一个连贯问题，而不是一个 commit。轮次文档应在第一项实质实现之前或同时创建。

模板：

````markdown
# PR-5.x — 标题

```ini
MILESTONE = PR-5.x
STATUS = DESIGNED | AUTHORIZED | IMPLEMENTED | VERIFIED | ACCEPTED | REJECTED
DATE_STARTED = YYYY-MM-DD
BASE_COMMIT = <已核验基线>
FINAL_COMMIT = <提交实际存在后再填>
SCOPE = <一句话范围>
```

## 问题与已有证据

- 可观察问题是什么？
- 哪些事实已经确认？
- 哪些仍是假设？

## 初始设计

- 计划的数据流或架构
- 选择原因
- 替代方案和风险

这一节保留初始推理。后续变化写入迭代日志，不倒改成“从一开始就知道答案”。

## 范围与非目标

### 本轮范围
- ...

### 不在本轮 / 未授权
- ...

## 合同与不变量

- 搜索输入边界
- DP key、dominance、replay 等兼容边界
- determinism/provenance 要求
- artifact publication policy

## 验收与拒绝门

| Gate | Evidence | Pass condition | Meaning |
| --- | --- | --- | --- |

## 实施顺序

1. ...
2. ...

## 迭代日志

### Iteration 1 — YYYY-MM-DD
- Change:
- Reason:
- Evidence:
- Outcome:
- Next decision:

## 最终实现

- 修改组件
- 数据流
- 兼容性与迁移说明

## 验证与证据

```text
command: ...
result: PASS/FAIL，exit code，关键计数
```

- Commit/tag:
- Artifact path/hash:
- Review finding:

## 结果与决定

- 证据证明了什么？
- 哪个假设被保留或否决？
- 最终状态是什么？

## 已知限制与不宣称

- 本轮没有证明什么？
- 剩余的 correctness/performance/coverage 限制是什么？

## 下一授权 gate

- 唯一下一步
- 前置条件
- 仍未授权的工作
````

## 生命周期

### 开始轮次

1. 读取 handoff、活动 milestone、相关代码和 artifacts。
2. 实时核验 branch/HEAD/remote，不照抄旧文档。
3. 创建日期 milestone 文件，写入已存在的 base commit。
4. 在看到结果前冻结问题、范围、非目标和验收/拒绝门。
5. 明确生成物是否 tracked；默认写入已忽略的 generated 路径。

### 开发与迭代

同一轮持续更新同一文件。只记录会影响合同、结论或下一决策的变化：

- 失败但能排除假设的尝试；
- review 发现及其修复；
- 用户授权的范围变化；
- benchmark 控制、输入或 gate 的变化；
- 需要新 iteration 而不能倒改原始 gate 的原因。

普通格式化、机械重命名和不改变合同的小修无需写成逐步日记。

### 关闭轮次

1. 对照实际仓库重读 milestone 文档。
2. 保留初始设计和迭代历史，把最终实现、命令、结果和限制写实。
3. 只有命名检查实际通过后才能写 `VERIFIED`；只有明确验收后才能写 `ACCEPTED/FROZEN`。
4. 更新 handoff 的快照、milestone 索引、artifact 索引、限制、下一步与 changelog。
5. tracked code、tests 和 milestone 文档通常在同一提交或同一 review series 中落地。

## 状态词

| Status | 所需证据 | 不代表 |
| --- | --- | --- |
| `PROPOSED` | 已记录想法 | 已授权 |
| `DESIGNED` | 合同与 gates 已写清 | 已实现 |
| `AUTHORIZED` | 用户或既定计划明确允许开发 | 代码可用 |
| `IMPLEMENTED` | 实现或 artifact 已存在 | 检查通过 |
| `VERIFIED` / `PASS` | 指定检查实际通过 | 已独立接受 |
| `REVIEWED` | 有明确 review 与 findings | 零问题 |
| `ACCEPTED` / `FROZEN` | 验收 gate 明确通过 | 永久完美 |
| `REJECTED` / `NOT_PROMOTED` | 有效运行未通过 gate | 基础设施损坏 |
| `DEFERRED` | 记录了重开条件 | 取消 |
| `BLOCKED` | 缺少明确外部依赖或授权 | 仅仅困难或耗时 |

禁止用“完成”同时代替 implemented、verified、reviewed 和 accepted。

## 证据层级

发生冲突时按以下优先级处理并记录修正：

1. tracked、机器可验证合同和已核验 artifacts；
2. 当前工作区精确命令输出；
3. 针对实际代码的独立 review；
4. 实现者交付摘要；
5. 计划或意图。

solver 专属要求：

- `goalFound`、`frontierExhausted`、`budgetExhausted`、`searchComplete` 必须分开。
- faster not-found、depth 增加或 blocker score 改善都不等于路线找到。
- 搜索命中后仍需 route reconstruction 与 strict replay 才能形成 closure evidence。
- authored milestone/known route 作为 oracle 时必须显式标记，不能冒充 autonomous discovery 输入。
- wall time 是方向性证据；确定性计数、fingerprint、exact state 和 replay 证据优先。

## Artifact 与发布规则

- tracked：代码、检查器、稳定配置、小型正式 fixture、milestone 文档。
- 默认 ignored：`runs/`、`logs/generated/`、`routes/generated/`、`shared-solver/routes/generated/`、`benchmarks/results/` 以及可重建 probe 输出。
- 大型、敏感或环境相关 artifact 不因被文档引用就自动进入 Git。
- 若 generated artifact 被提升为 fixture，必须在 milestone 文档写明输入、用途、稳定性与 promotion 理由。

## 反模式

- 直接复制 agent delivery report，不核对代码和命令。
- smoke 通过就写 `ACCEPTED`。
- 后续成功后删除旧 rejection。
- 看到结果后更换 seeds、预算或阈值以通过 gate。
- 为每个 commit 建一篇无独立问题的文档。
- 新的一天复制活动 milestone，制造两份真相。
- 记录未来 commit hash。
- handoff 与 milestone 对同一轮给出冲突状态。
- 把 generated benchmark dump 批量提交进源代码目录。

## 更新检查单

- [ ] 实时核验 branch、HEAD、remote 和工作树 carry。
- [ ] handoff 顶部仍是当前真相。
- [ ] 活动 milestone 路径符合 `docs/YYMMDD/<id>.md`。
- [ ] 初始设计没有被后续结果倒改。
- [ ] 状态词有相应证据。
- [ ] negative result 和 correction 已保留。
- [ ] 命令、预算、输入和关键计数可复现。
- [ ] generated artifact publication policy 已明确。
- [ ] 下一授权 gate 只有一个清晰方向。
- [ ] 未把用户的无关工作树改动带入提交。
