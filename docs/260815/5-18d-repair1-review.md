# PR-5.18d Repair 1 — 独立复核与远端 CI 绑定

```ini
MILESTONE = PR-5.18d
REVIEW_SUBJECT = Repair 1（shared-budget hard cap / outcome taxonomy / checker / CI / diagnostics / handoff）
STATUS = REVIEWED
DATE_STARTED = 2026-08-15
BASE_COMMIT = e02d78adf356981c3780b6e5ca2dfb5715ee6cb5
REVIEWED_COMMITS = 5db3ff39e8c00b7dee11be2a4446d42501e0e630, 7acba36b517a51eee8f33ec8c5bb5f93bbc4a3d5
REMOTE_CI_RUN = 31821010021
REMOTE_CI_JOB = 94833914405（qualification-strategic-blocker-connector）
SCOPE = 逐项复核 2026-08-15 云端 REQUEST_CHANGES（P1×5 + P2×1）；不改变 PR-5.18d 的 VERIFIED / NOT_PROMOTED 研究结论。
```

## 背景

云端 review 对 PR-5.18d 的研究结论认可并保持 `VERIFIED / NOT_PROMOTED`，但 committed implementation 提出 5 个 P1：

1. `maxTotalSearchExpansions` 不是严格 hard cap（connector 与 strategic expansion 之间没有重新守门，且 `Math.max(1)` 会在 remaining=0 时强制启动 connector）。
2. 因 total cap 停止时，outcome taxonomy 可能得到 `frontierExhausted=false` 但 verdict 落到 `FRONTIER_EXHAUSTED` 的自相矛盾结果。
3. committed checker 没有真正测试 shared-budget feature。
4. 5.18d 新 checker 没有进入远端 CI。
5. handoff 顶部仍是“PR-5.18d 已实现并跑完、待提交”，与远端真实状态不符。

另有 1 个 P2：`blockerConnectorFrontierExhausted / blockerConnectorFrontierTrimmed` 两个诊断字段永远为 0。

本文件只记录 Repair 1 的复核结果，不复述 5.18d 的设计与原始实验；设计、迭代、原始 1000-work A/B 与 `NOT_PROMOTED` 依据见 [`../260814/5-18d.md`](../260814/5-18d.md)。

## 复核矩阵

| Finding | 修复位置 | 本机验证 | 结果 |
| --- | --- | --- | --- |
| P1-1 hard cap | `shared-solver/lib/strategic-d2-search.js`：loop entry、每次 lazy drain 后、strategic expansion 前重新 gate；`connectorExpansionBudget()` 允许 0 且不再 `Math.max(1)` | checker 新增 cap=0 / remaining=1 / remaining=0 / remaining=3 四个 shared-budget edge controls，全部通过 | PASS |
| P1-2 taxonomy | outcome 增加 `strategicBudgetExhausted`、`totalSearchBudgetExhausted`、`stoppedReason`；`budgetExhausted = strategic OR total`；verdict 先走 `INCOMPLETE_WITHIN_BUDGET` | cap=0/1/2/4 场景均 `frontierExhausted=false`、`budgetExhausted=true`、`stoppedReason=total-search-budget`；1000-work 场景为 `strategic-and-total-search-budget` | PASS |
| P1-3 checker | `shared-solver/check-strategic-blocker-connector.js` 增加真实 total-work synthetic controls，而不是只做 120+4×20=200 的人工组合 | `npm run check:strategic-blocker-connector` exit 0 | PASS |
| P1-4 CI | `shared-solver/package.json` 注册两个 script；`.github/workflows/solver-regression.yml` 增加 marker-only `qualification-strategic-blocker-connector` job 并纳入 summary | 远端 run 31821010021 实际执行该 job 且 success；对照 run 31802204913 没有该 job | PASS |
| P1-5 handoff | `20260804handoff.md` 在本文件所在提交更新为 Repair 1 后的当前真相 | 提交后工作树与 `origin/dev` 同步，顶部快照与 git 实际状态一致 | PASS |
| P2-1 diagnostics | `strategic-blocker.js` 返回 `stoppedReason`/`frontierExhausted`；D2 集成按 `budget-exhausted / frontier-exhausted / frontier-trimmed` 真实累加 | real 64-expansion control 返回 `stoppedReason=budget-exhausted`；shared-budget cases 正确累计 `blockerConnectorBudgetExhausted` | PASS |

## 本机验证证据（2026-08-15）

```text
command: npm run check:strategic-blocker-connector
result: PASS (exit 0)
wall: 约 10.9s（仅方向性）

blocker analysis: attack-blocked / attackMargin -1223 / combat-power
synthetic: bestScore 3 / chain 3 / replay valid
real 64-expansion connector: -1223 → -1073 / delta +150 / chain 2 / replay valid / stoppedReason budget-exhausted
shared-budget edge controls:
  cap=0            total 0 / strategic 0 / connector calls 0
  remaining=1      total 2 / strategic 1 / connector 1 / no further strategic expansion
  remaining=0      total 1 / strategic 1 / connector calls 0
  remaining=3      total 4 / strategic 1 / connector 3 / requested 20 clamped to 3
focused 200-work A/B:
  baseline strategic 200:   best attackMargin -903 / terminal action 0
  candidate blocker 120+80: best attackMargin -903 / terminal action 0 / improved 4/4
```

```text
command: npm run qualification:strategic-blocker-connector
result: PASS (exit 0)
wall: 本机约 12.3s / 20.1s（baseline/candidate，仅方向性）

baseline strategic-1000
  total 1000 / strategic 1000 / best attackMargin -903 / terminal action 0

candidate blocker 600+400
  total 1000 / strategic 600 / connector 400 / calls 8 / improved 8
  best attackMargin -903 / terminal action 0
  budgetExhausted true
  stoppedReason strategic-and-total-search-budget
```

```text
command: npm run check:strategic-d2-search
result: PASS (exit 0)

command: npm run check:manifest
result: PASS (exit 0; 132 modules, 139 graded tests)
```

以上 1000-work 重跑与 `docs/260814/5-18d.md` 冻结的结论一致：`bestAttackMargin` 仍为 `-903`，terminal action 仍为 0；Repair 1 只改变了预算/诊断正确性与证据 plumbing，没有改变 `NOT_PROMOTED`。

## 远端 CI 证据（GitHub Actions）

- 远端 `origin/dev = 7acba36b517a51eee8f33ec8c5bb5f93bbc4a3d5`，与本地 `dev` HEAD 一致。
- run **31821010021**（push `7acba36 docs: close PR-5.18d Repair 1 shared-budget qualification`）conclusion：**success**。
- 该 run 的 job 列表包含 **`qualification-strategic-blocker-connector`**（job ID 94833914405），conclusion：**success**，耗时约 1m27s。
- 对照 run **31802204913**（push `e02d78a`）没有 `qualification-strategic-blocker-connector` job，确认远端 CI gap 已随 Repair 1 关闭。
- 当前 `git ls-remote --heads origin` 仅显示 `dev` 与 `main` 持久分支；本次没有为 `functional`/`marker` 保留长期分支。

## 结论

- P1×5 + P2×1 全部关闭。
- PR-5.18d 研究结论保持 `VERIFIED / NOT_PROMOTED`，D2 仍 OPEN。
- Repair 1 复核状态：**PASS**；`maxTotalSearchExpansions` 现在是严格 hard cap，outcome taxonomy 正交，checker 真实覆盖 shared-budget，CI 已实际运行并通过，handoff 恢复为当前真相。
- 下一授权 gate 不变：5.18e 必须给 blocker connector 一个战略 frontier 本身不做的、真正不同的中间目标（例如由 feasibility/dependency 编译的 resource/equipment acquisition），并在相同 total search work 下证明 best terminal blocker progress 或 terminal action 前移；完成前不进入 dominance 或 D3。
