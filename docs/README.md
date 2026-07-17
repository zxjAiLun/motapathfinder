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

## 常用检查

```bash
npm run check:static --prefix shared-solver
npm run check:no-tower-solver-js --prefix shared-solver
npm run check:public-layer-boundaries --prefix shared-solver
npm run check:region-specs --prefix shared-solver
npm run check:resource-timing --prefix shared-solver
```
