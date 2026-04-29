# 多 Agent 使用框架

本文定义如何让不同模型/agent 在同一套公共 solver 上公平实验，避免它们直接写塔目录或依赖内部实现细节。

## 1. 目标

多 agent 框架要衡量的不只是“谁打印了一条路线”，而是：

- 是否能产出可回放的 route。
- 是否理解 proof claim 和失败诊断。
- 是否能跨 Only Up / Whiteisland 泛化。
- 是否遵守工程边界。
- 是否能处理“眼前正收益但资源时机错误”的陷阱。
- 搜索成本、复现性、代码复杂度是否可控。

## 2. 推荐目录

```text
shared-solver/          # 唯一公共 solver 库
towers/
  onlyup/
    region-specs/
    route-fixtures/
  whiteisland/
    trial-specs/
    route-fixtures/
agents/
  <agent-name>/
    agent.json
    src/
    runs/
benchmarks/
  public/
  hidden/
  results/
runs/
  YYYY-MM-DD/
    <agent-name>/
routes/
  generated/
logs/
  generated/
```

`shared-solver/` 和塔目录不是普通 agent 的写入区。agent 输出由 harness 分配到 `runs/**`、`agents/<agent>/runs/**`、`routes/generated/**`、`logs/generated/**` 或 `benchmarks/results/**`。

## 3. 公共 API 边界

Agent 只能 import：

```js
const solver = require("../../shared-solver/public");
```

禁止 import：

```js
require("../../shared-solver/lib/segment-dp");
require("../../Only upV2.1/Only upV2.1/solver/lib/simulator");
require("../../whiteisland（9）/solver/lib/search");
```

原因：

- `shared-solver/lib/**` 是内部结构，后续会重构。
- 塔内 `solver/**` 是 legacy 拷贝，不再维护。
- 公共 API 才能保证多 agent 结果可复现、可比较。

公共 API 说明见：

- `docs/public-api.md`

给模型的统一 brief 见：

- `docs/AGENT_BRIEF.md`

给模型进入 plan mode 的统一提示词见：

- `docs/AGENT_PLANMODE_PROMPTS.md`

## 4. Agent 类型

### 4.1 Agent-from-scratch

输入：

- `shared-solver/public.js`
- RegionSpec / benchmark task
- 输出路径
- public suite

权限：

- 可以写自己的 `agents/<agent>/src/**`。
- 可以写指定 runs/output。
- 不可修改 `shared-solver/**`、塔目录、benchmark hidden suite。

评价：

- 解题能力
- 输出契约
- proof awareness
- 泛化能力
- 工程边界

### 4.2 Solver-improvement

输入：

- 当前 `shared-solver/**`
- public checks
- public + hidden benchmark suite

权限：

- 可以修改 `shared-solver/**`。
- 不可修改塔项目本体。
- 不可把已知答案写死进 benchmark task。

评价：

- solver 能力提升
- 回归不破坏
- API 兼容
- hidden suite 泛化

## 5. Agent 输出契约

每次任务输出一个 run directory，至少包含：

```text
route.json
metrics.json
diagnostics.json
agent-report.md
```

`route.json`：

- 必须是 `motapathfinder.route.v1`。
- 必须能被 `shared-solver/lib/route-store.js` 读取。
- 不应包含宏动作；保存时应展开为 primitive decision。

`metrics.json` 示例：

```json
{
  "taskId": "onlyup-region-1",
  "found": true,
  "liveVerified": true,
  "proofLevel": "bounded-complete",
  "completeWithinActionSet": true,
  "expansions": 12345,
  "wallMs": 8123,
  "routeLength": 87,
  "final": {
    "hp": 1,
    "atk": 107,
    "def": 100,
    "mdef": 510
  },
  "illegalWrites": 0
}
```

`diagnostics.json` 应包含：

- `proofClaim`
- DP diagnostics
- skyline candidate summary
- failure class / missing goal fields
- action scope / budget 情况

`agent-report.md` 只写人读摘要，不替代机器可读 JSON。

## 6. Benchmark Harness

公共 suite：

```bash
node benchmarks/run-agent.js \
  --agent=agents/.templates/agent.json \
  --suite=benchmarks/public/region-suite.json
```

建议任务类型：

| 类型 | 目的 |
| --- | --- |
| Only Up region | 检查近似唯一路线、资源时机、milestone skyline |
| Whiteisland trial | 检查跨塔泛化和不同 floor 命名 |
| Failure task | 检查是否正确输出 failure class，而不是伪造路线 |
| Timing trap | 检查是否避免早吃血瓶/早打高伤守资源怪 |
| Candidate skyline task | 检查后段失败时是否尝试上一 milestone 其他候选 |

Hidden suite 必须存在，否则模型容易对 public spec 过拟合。

## 7. 权限检查

严格 agent 提交检查：

```bash
npm run check:agent-boundaries --prefix shared-solver -- --agent=<agent-name>
```

公共层开发检查：

```bash
npm run check:public-layer-boundaries --prefix shared-solver
```

禁止普通 agent 修改：

```text
shared-solver/**
Only upV2.1/**
whiteisland（9）/**
猫可露露V5.9（屑猫头基础教程）/**
```

允许普通 agent 写：

```text
agents/<agent>/runs/**
runs/**
routes/generated/**
logs/generated/**
benchmarks/results/**
```

## 8. 评分维度

| 维度 | 说明 |
| --- | --- |
| 解题能力 | 是否找到 route，是否到达目标 |
| live 验证 | route-gui / runtime replay 是否通过 |
| proof awareness | 是否报告 `proofClaim`、预算、action trim、完整性 |
| 泛化能力 | Only Up 以外的任务表现 |
| 抗陷阱能力 | 是否处理资源时机、候选回退、路径 blocker |
| 失败质量 | 失败时是否输出明确 failure class 和修复方向 |
| 工程纪律 | 是否只用 public API，是否越界写文件 |
| 成本 | expansions、wallMs、routeLength、内存 |
| 复现性 | 固定 spec、固定配置、标准输出 |

## 9. 推荐工作流

### 9.1 新 agent 接入

1. 在 `agents/<agent>/agent.json` 定义 agent。
2. 只 import `shared-solver/public.js`。
3. 读取 harness 分配的 task/spec/output path。
4. 输出 `route.json`、`metrics.json`、`diagnostics.json`、`agent-report.md`。
5. 跑 public suite。
6. 跑边界检查。

### 9.2 Solver 改进评测

1. 修改 `shared-solver/**`。
2. 跑轻量静态检查。
3. 跑 region / segment smoke。
4. 跑 public benchmark。
5. 再跑 hidden suite。
6. 对比 baseline：成功率、proof level、runtime、route quality。

推荐命令：

```bash
npm run check:static --prefix shared-solver
npm run benchmark:public --prefix shared-solver
```

## 10. 当前缺口

需要继续补：

- `benchmarks/run-agent.js` 对所有 output contract 的强校验。
- hidden suite 的真实任务集合。
- agent run 的 live replay 自动验证。
- 每个任务的资源时机 trap 标注。
- baseline metrics 的持久化与 diff 报告。
- 对 agent import `shared-solver/lib/**` 的静态扫描。
