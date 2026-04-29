# Agent Planmode Prompts

这份文档用于给不同模型同一套输入，让它们在各自目录下设计普通 Agent-from-scratch agent。主榜单比较模型强度时，不要给不同模型分配不同角色；所有模型都使用同一份 brief、同一份 planmode prompt、同一套 benchmark。

## 0. 替换变量

喂给模型前只替换这些变量：

```text
<agent-name>        模型/agent 名称，例如 gpt-5-5-pro、claude-opus、gemini-pro
<agent-dir>         默认 agents/<agent-name>
<public-suite>      默认 benchmarks/public/region-suite.json
```

推荐目录：

```text
agents/<agent-name>/
  agent.json
  src/
    solve.js
  runs/
```

## 1. 第一轮：进入 Plan Mode

```text
你现在在 motapathfinder 仓库中工作。先进入 plan mode：只做只读检查和实现计划，不修改代码，不创建文件，不运行会长期占用资源的重任务。

目标：为设计一个普通 Agent-from-scratch agent。目录必须是：

<agent-dir>/
  agent.json
  src/solve.js
  runs/

<agent-dir>是你的模型名称。 你的 agent 要使用公共 solver API 求解 RegionSpec benchmark task，并输出标准结果：

- route.json
- metrics.json
- diagnostics.json
- agent-report.md

必须先阅读或参考：

- docs/AGENT_BRIEF.md
- docs/public-api.md
- docs/multi-agent-framework.md
- agents/.templates/agent.json
- benchmarks/public/region-suite.json

硬性约束：

1. 只能使用公共 API：
   const solver = require("../../../shared-solver/public");

2. 禁止 import：
   - shared-solver/lib/**
   - Only upV2.1/**/solver/**
   - whiteisland（9）/solver/**

3. 禁止修改：
   - shared-solver/**
   - Only upV2.1/**
   - whiteisland（9）/**
   - benchmarks/hidden/**

4. 只能创建或修改：
   - <agent-dir>/agent.json
   - <agent-dir>/src/**
   - <agent-dir>/runs/**
   - runs/**
   - routes/generated/**
   - logs/generated/**
   - benchmarks/results/**

5. Agent 必须由 benchmark harness 调用：
   node benchmarks/run-agent.js --agent=<agent-dir>/agent.json --suite=<public-suite>

6. 每个 task 必须输出：
   - route.json
   - metrics.json
   - diagnostics.json
   - agent-report.md

7. 不允许伪造路线、metrics 或 proof claim。预算耗尽、actionTrimmed、time-limit、非 final stopOnFirstGoal 都必须让 proofLevel 降级为 candidate 或 not-found。

8. 优先使用 region / segment DP。不要把目标变成 heuristic beam score 调参。

9. 重点处理资源时机陷阱：
   眼前正收益不代表正确路线。同一 canonical state key 下，HP 更高路线应支配 HP 更低路线。中间 milestone 不应随便 stopOnFirstGoal。候选 skyline 比单条路线更可信。

请在 plan mode 中输出：

A. 你准备创建或修改的文件列表。
B. agent.json 的 command 设计，必须使用 harness placeholders。
C. src/solve.js 的模块结构。
D. 如何读取 CLI 参数和环境变量。
E. 如何加载 project / regionSpec。
F. 如何创建 simulator / initial state / milestone spec。
G. 如何运行 DP / milestone graph / fallback 参数组。
H. 如何构造 route.json / metrics.json / diagnostics.json / agent-report.md。
I. proofClaim 降级规则，特别是 actionTrimmed / stoppedReasons / expansionBudgetExhausted / stopOnFirstGoal。
J. 失败时如何输出 failure diagnostics。
K. 你会运行哪些 benchmark 和 boundary check 命令。
L. 你不会修改哪些目录。
M. 可能失败点和对应处理。

不要写代码，先给计划。
```

## 2. 第二轮：计划自审

第一轮模型给出计划后，继续喂这个提示词：

```text
继续保持 plan mode。请审查你刚才的计划是否违反以下约束：

1. 是否 import 了 shared-solver/lib/**？
2. 是否 import 了塔内 solver/**？
3. 是否写入了 shared-solver/**、Only upV2.1/**、whiteisland（9）/** 或 benchmarks/hidden/**？
4. 是否依赖 public suite 的固定答案或硬编码路线？
5. 是否把 proofLevel 直接写成 bounded-complete，而没有检查 actionTrimmed / stoppedReasons / expansionBudgetExhausted / unsafe stopOnFirstGoal？
6. 是否在失败时仍然输出 metrics.json / diagnostics.json / agent-report.md？
7. 是否能处理没有 route 的 not-found 情况？
8. 是否能被 benchmarks/run-agent.js 的 command placeholders 调用？
9. 是否能通过：
   node tools/check-agent-boundaries.js --agent=<agent-name>
10. 是否只修改 <agent-dir> 下允许的文件？

请逐项回答，并给出修订后的最终计划。仍然不要修改代码。
```

## 3. 第三轮：批准实现

计划通过后，再喂这个提示词。这个提示词会退出 plan mode，允许模型实现。

```text
计划通过。现在可以开始实现。

请只创建或修改：

- <agent-dir>/agent.json
- <agent-dir>/src/solve.js
- <agent-dir>/runs/**

不要修改：

- shared-solver/**
- Only upV2.1/**
- whiteisland（9）/**
- benchmarks/hidden/**

实现后运行：

node benchmarks/run-agent.js \
  --agent=<agent-dir>/agent.json \
  --suite=<public-suite>

然后运行：

node tools/check-agent-boundaries.js --agent=<agent-name>

最后汇报：

1. 修改了哪些文件。
2. benchmark 结果摘要。
3. 输出目录。
4. 是否通过 boundary check。
5. 如果失败，失败原因和下一步修复建议。
```

## 4. 主榜单执行规则

主榜单只比较 Agent-from-scratch，不允许模型修改公共 solver。所有模型必须使用同一套：

```text
docs/AGENT_BRIEF.md
docs/AGENT_PLANMODE_PROMPTS.md
benchmarks/public/region-suite.json
```

不要这样分配：

```text
模型 A：baseline agent
模型 B：trap-aware agent
模型 C：repair agent
```

正确做法：

```text
模型 A：同一份 prompt，自行设计 agent
模型 B：同一份 prompt，自行设计 agent
模型 C：同一份 prompt，自行设计 agent
```

统一比较：

```text
成功率
proof awareness
failure diagnostics
trap resistance
live replay
runtime cost
工程纪律
```
