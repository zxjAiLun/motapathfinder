# 文档入口

## 项目状态与轮次文档

- [`../20260804handoff.md`](../20260804handoff.md)：tracked 的当前项目真相、里程碑索引和下一授权步骤。
- [`project-documentation-system.md`](project-documentation-system.md)：两层文档制度、状态词、证据层级、日期命名和 artifact policy。
- [`260815/5-19c.md`](260815/5-19c.md)：当前活动轮 PR-5.19c Battle Viability Deficit Attribution（`AUTHORIZED`，observation-only）。
- [`260815/5-19b.md`](260815/5-19b.md)：最近完成轮 PR-5.19b Battle Access-Prerequisite Compiler（`MECHANISM POSITIVE / NOT PROMOTED` + `APPROVED / CLOSED`）。
- [`260815/5-19a.md`](260815/5-19a.md)：最近完成轮 PR-5.19a Dependency Access Attribution（`APPROVED / CLOSED`，Repair 1/2 本地+远端 qualification 双 PASS，observation-only）。
- [`260815/5-18e.md`](260815/5-18e.md)：最近完成轮 PR-5.18e Dependency-Derived Intermediate Target（`VERIFIED / NOT_PROMOTED` + `APPROVED / CLOSED`，本地+远端 qualification 双 PASS）。
- [`260814/5-18d.md`](260814/5-18d.md)：最近完成轮 PR-5.18d（`VERIFIED / NOT_PROMOTED` + `APPROVED / CLOSED`，D2 仍 OPEN）。
- [`260815/5-18d-repair1-review.md`](260815/5-18d-repair1-review.md)：2026-08-15 PR-5.18d Repair 1 独立复核与用户验收记录（本机检查 + 远端 CI run `31821010021` 绑定）。

轮次文档使用上海日期和稳定 milestone ID：

```text
docs/YYMMDD/<milestone-id-with-hyphens>.md
docs/260814/5-18d.md
docs/260815/5-18d-repair1-review.md
docs/260815/5-18e.md
docs/260815/5-19a.md
docs/260815/5-19b.md
```

同一轮跨日时继续更新原文件，不按天复制。`20260804checkpoint.md` 与 `shared-solver/RESEARCH_PROGRESS.md` 保留历史累计证据，但不作为第二份当前状态。

## 主文档

- `docs/project-structure.md`：仓库目录职责、JS 分类、塔内旧 solver 冻结与归档策略。
- `docs/solver-roadmap.md`：solver 后续主线，RegionSpec、segment DP、HP skyline、adaptive planner 与 replay 验证。
- `docs/multi-agent-framework.md`：多 agent 公共 API、输出契约、权限边界、benchmark 方案。

## 配套文档

- `docs/solver-architecture.md`：当前 solver 架构方向。
- `docs/development-boundaries.md`：写入边界与检查命令。
- `docs/public-api.md`：`shared-solver/public.js` 稳定 API。
- `docs/agent-benchmarking.md`：agent benchmark 评价维度。
- `docs/solver-entrypoints.md`：solver CLI 与 legacy solver 清单。
- `docs/js-inventory.md`：JS 文件库存。
- `docs/solver-architecture.zh-CN.md`：面向项目负责人的中文运行链路与四层候选筛选说明。
- `docs/solver-glossary.zh-CN.md`：skyline、DP key、dominance、witness、gate 等术语对照表。
- `docs/onlyup-current-model.md`：Only Up 当前精确模型、启发式、oracle-only 边界与建模缺口。
- `docs/archive/2026-07-29-solver-explanation-notes.md`：2026-07-29 的历史解释与讨论归档，不是当前规范。

## Windows 可视化

固定 current-exact route 的 Route GUI smoke：

```powershell
powershell -ExecutionPolicy Bypass -File .\shared-solver\run-windows-route-gui-smoke.ps1
```

默认打开可见浏览器并自动播放 live replay。只看 timeline、不启动真实游戏时加 `-NoLive`；只打开 live 界面但不自动播放时加 `-NoAutoPlay`；希望播放结束自动关闭时加 `-CloseWhenDone`。

## 常用检查

```bash
npm run check:static --prefix shared-solver
npm run check:no-tower-solver-js --prefix shared-solver
npm run check:public-layer-boundaries --prefix shared-solver
npm run check:region-specs --prefix shared-solver
npm run check:resource-timing --prefix shared-solver
```
