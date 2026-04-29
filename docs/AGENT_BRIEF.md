# Motapathfinder Agent Brief

你要为 motapathfinder 写一个普通 Agent-from-scratch agent，用同一套公共 solver API 求解 RegionSpec benchmark task。

## 1. 目标

Agent 要读取一个 RegionSpec，尝试找到一条可验证路线，并输出：

- `route.json`
- `metrics.json`
- `diagnostics.json`
- `agent-report.md`

Agent 必须清楚区分：

- 找到候选路线
- 找到有界完备路线
- 没找到路线但给出可信 failure diagnostics

## 2. 只能使用公共 API

只能 import：

```js
const solver = require("../../../shared-solver/public");
```

禁止 import：

```js
require("../../../shared-solver/lib/...");
require("../../../Only upV2.1/Only upV2.1/solver/...");
require("../../../whiteisland（9）/solver/...");
```

`shared-solver/lib/**` 是内部实现，不是 agent API。

## 3. 不允许写塔目录

禁止写入：

```text
Only upV2.1/**
whiteisland（9）/**
shared-solver/**
```

普通 agent 运行时只能写：

```text
agents/<agent>/runs/**
runs/**
routes/generated/**
logs/generated/**
benchmarks/results/**
```

Benchmark harness 会传入输出路径；不要自己发明输出目录。

## 4. 输入参数

Agent 会通过 CLI 参数或环境变量拿到：

```text
--task-id
--project-root
--region-spec
--run-dir
--out
--metrics
--diagnostics
--report
```

也可能通过环境变量拿到：

```text
AGENT_RUN_DIR
AGENT_ROUTE_OUT
AGENT_METRICS_OUT
AGENT_DIAGNOSTICS_OUT
AGENT_REPORT_OUT
BENCHMARK_SUITE_ID
BENCHMARK_TASK_ID
```

优先使用 CLI 参数；没有时使用环境变量。

## 5. 推荐求解策略

优先使用 region / segment DP，而不是 beam / score 调参。

推荐流程：

```text
1. loadProject(projectRoot)
2. loadRegionSpec(regionSpecPath)
3. createSimulator(project, regionSpec.simulator / safe defaults)
4. buildRegionMilestoneSpec(project, regionSpec)
5. 创建起始 state
6. runMilestoneGraph(...)
7. buildRegionProofClaim(result, regionSpec)
8. 如果 found，buildRouteRecord(...)
9. 写 route.json / metrics.json / diagnostics.json / agent-report.md
```

可以尝试多组参数，例如：

```text
dpKeyMode: region / location
candidateLimit: 4 / 8 / 12
maxExpansions: spec 默认 / 更高预算
stopOnFirstGoal: false
enableFailureBacktracking: true
```

不要伪造结果。预算耗尽、actionTrimmed、time-limit、非 final stopOnFirstGoal 都必须让 proofLevel 降级为 `candidate` 或 `not-found`。

## 6. 资源时机陷阱

本项目重点考察：

```text
眼前正收益不等于正确路线
```

例如：

```text
现在打怪掉 50 血，后面拿 500 血瓶，看起来 +450。
但正确路线可能是先拿宝石，让怪变成 0 伤，再回来拿血瓶。
```

Agent 必须尊重：

```text
同一 canonical state key 下，HP 更高路线支配 HP 更低路线。
中间 milestone 不应随便 stopOnFirstGoal。
候选 skyline 比单条路线更可信。
```

重点看：

```text
proofClaim.completeWithinActionSet
proofClaim.actionTrimmed
proofClaim.stoppedReasons
proofClaim.expansionBudgetExhausted
diagnostics.segments
failurePropagation
```

## 7. 输出格式

### route.json

必须是 `motapathfinder.route.v1`。如果没有找到路线，可以不写有效 route，但必须写 metrics / diagnostics / report。

### metrics.json

失败时至少包含：

```json
{
  "taskId": "task-id",
  "found": false,
  "liveVerified": false,
  "proofLevel": "not-found",
  "completeWithinActionSet": false,
  "proofClaim": {},
  "expansions": 0,
  "wallMs": 0,
  "routeLength": 0,
  "illegalWrites": 0,
  "final": null
}
```

找到路线时至少包含：

```json
{
  "taskId": "whiteisland-trial-smoke",
  "found": true,
  "liveVerified": false,
  "proofLevel": "bounded-complete",
  "completeWithinActionSet": true,
  "proofClaim": {
    "proofLevel": "bounded-complete",
    "completeWithinActionSet": true,
    "actionTrimmed": 0,
    "stoppedReasons": [],
    "expansionBudgetExhausted": false
  },
  "expansions": 600,
  "wallMs": 3500,
  "routeLength": 12,
  "illegalWrites": 0,
  "final": {
    "floorId": "A1",
    "hp": 675,
    "atk": 10,
    "def": 12,
    "mdef": 0,
    "exp": 6
  }
}
```

### diagnostics.json

至少包含：

```json
{
  "taskId": "task-id",
  "found": false,
  "proofClaim": {},
  "segments": [],
  "failedSegmentId": null,
  "failureClass": null,
  "missingGoalFields": [],
  "attempts": []
}
```

### agent-report.md

简短说明：

```md
# Agent Report

## Result
- Found:
- Proof level:
- Route length:
- Expansions:
- Wall ms:

## Strategy
说明你用了什么 DP key、candidateLimit、预算、fallback。

## Failure / Diagnostics
如果失败，说明 failure class、missing goal fields、下一步修复建议。
```

## 8. 评测命令

Public suite：

```bash
node benchmarks/run-agent.js \
  --agent=agents/<agent>/agent.json \
  --suite=benchmarks/public/region-suite.json
```

边界检查：

```bash
node tools/check-agent-boundaries.js --agent=<agent>
```

不要修改塔目录。不要修改 `shared-solver/**`，除非任务明确是 Solver-improvement。
