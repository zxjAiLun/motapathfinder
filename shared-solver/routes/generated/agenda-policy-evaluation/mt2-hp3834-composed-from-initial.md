# Initial → MT2 HP3834 composed route

## Gate result

通过 PR-4.4a portability gate：

```text
decisions = 22
strict replay = 22/22 valid
start snapshot = initial game state
final = HP 6620 / ATK 72 / DEF 35 / MDEF 340
run-segmented-dp --start-route = loaded successfully
```

该 artifact 由 `compose-route.js` 生成，不修改搜索、dominance、DP key 或 agenda 语义。

## Composition

| 部分 | route | decisions | final/start exact key SHA-256 |
| --- | --- | ---: | --- |
| prefix | `mt2-local-best-first-hp4176.route.json` | 12 | final `48da6e1ba15afd4186bda5a3317ea869efcd629984019c6d2184d26489678fea` |
| suffix | `mt2-hp3834-target-best-checkpoint-hybrid8.route.json` | 10 | start `48da6e1ba15afd4186bda5a3317ea869efcd629984019c6d2184d26489678fea` |
| composed | `mt2-hp3834-composed-from-initial.route.json` | 22 | final `e06d5be13ba95ae288a42b324036fc7298cfc3b703afd7b8d567a59951dd0df1` |

12→10 boundary exact key 完全相等。组合器同时校验 suffix 第一条 decision 的 `preExactStateKey` 与 boundary 相等，并将 suffix decision index 重编号为 13–22。

## Endpoint audit

| endpoint | exact key SHA-256 | HP | ATK / DEF / MDEF | visited floors |
| --- | --- | ---: | --- | --- |
| initial | `06f36b3cb0c1231bb35fd1aa07fbd7548ba20dbc4c69cc3597af59245872ac72` | 201 | 2 / 0 / 10 | MT1 |
| MT2 local boundary | `48da6e1ba15afd4186bda5a3317ea869efcd629984019c6d2184d26489678fea` | 4176 | 31 / 19 / 250 | MT1, MT2 |
| MT2 HP3834 final | `e06d5be13ba95ae288a42b324036fc7298cfc3b703afd7b8d567a59951dd0df1` | 6620 | 72 / 35 / 340 | MT1, MT2 |

最终 snapshot 保留：

```text
__leaveLoc__.MT1 = { x: 6, y: 0, direction: "up" }
__leaveLoc__.MT2 = { x: 6, y: 0, direction: "up" }
removed mutations: MT1=48, MT2=29
```

## Replay and loader checks

独立调用 `strictReplayRoute()`：

```text
performed = true
valid = true
stepsCompleted = 22
stepsAttempted = 22
expected/actual final exact state key = equal
```

随后运行：

```text
run-segmented-dp
  --start-route=mt2-hp3834-composed-from-initial.route.json
  --from-milestone=mt2-local-3582
  --to-milestone=mt2-hp3834
  --max-expansions=1
  --max-runtime-ms=1000
```

loader smoke 结果为 `found=true`、`reachedMilestone=mt2-hp3834`；对应原始 report 为 `mt2-hp3834-composed-start-route-load-smoke.json`。report 中 `initialState.floorId=MT2`、`hero=HP6620/72/35/340`、`traceLength=22`，说明 runner 已从游戏初始状态重放完整 composed route，而不是把 checkpoint-relative suffix 当成初始路线。

## Provenance

```text
composition source commit = 71828446b25708daf14853f63ef4242980cc1de7
prefix source = fe46718
suffix source = e3603b5
```
