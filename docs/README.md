# 文档入口

## 主文档

- `docs/project-structure.md`：仓库目录职责、JS 分类、塔内旧 solver 冻结与归档策略。
- `docs/solver-roadmap.md`：solver 后续主线，RegionSpec、segment DP、HP skyline、adaptive planner 与 replay 验证。
- `docs/multi-agent-framework.md`：多 agent 公共 API、输出契约、权限边界、benchmark 方案。

## 配套文档

- `docs/auto-decomposition-handoff.md`：自动因果拆段当前实现、MT5 I894 进度、HY3 后续计划与代码 review 门禁。
- `docs/solver-architecture.md`：当前 solver 架构方向。
- `docs/development-boundaries.md`：写入边界与检查命令。
- `docs/public-api.md`：`shared-solver/public.js` 稳定 API。
- `docs/agent-benchmarking.md`：agent benchmark 评价维度。
- `docs/solver-entrypoints.md`：solver CLI 与 legacy solver 清单。
- `docs/js-inventory.md`：JS 文件库存。
- `docs/solver-architecture.zh-CN.md`：面向项目负责人的中文运行链路与四层候选筛选说明。
- `docs/solver-glossary.zh-CN.md`：skyline、DP key、dominance、witness、gate 等术语对照表。
- `docs/onlyup-current-model.md`：Only Up 当前精确模型、启发式、oracle-only 边界与建模缺口。

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
