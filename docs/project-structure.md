# 项目结构与代码边界

本文定义仓库的目录职责、solver 代码边界、旧塔内 solver 的处理策略，以及后续新增文件应放在哪里。

## 1. 当前结论

`shared-solver/` 是唯一 canonical solver。Only Up、Whiteisland 等塔目录只保留塔项目本体、包装入口、路线与日志，不再新增塔内 solver JS。

核心原则：

- 公共求解逻辑只进入 `shared-solver/**`。
- 塔项目原生 JS 不归 solver 管，除非任务明确要求改塔本体。
- 旧 `*/solver/**` 是 legacy 拷贝，只能归档或冻结，不能继续开发。
- 新的实验 agent、benchmark、区域 spec 必须进入独立目录，不能污染塔目录。

## 2. 顶层目录职责

| 目录 | 职责 | 写入策略 |
| --- | --- | --- |
| `shared-solver/` | canonical solver、公共 CLI、回放、DP、route schema、公共 API | solver 开发任务可写；agent 普通任务不可写 |
| `Only upV2.1/Only upV2.1/` | Only Up h5mota 项目本体与 `solver.sh` 包装入口 | 默认只读；不新增 solver JS |
| `whiteisland（9）/` | Whiteisland h5mota 项目本体与 `solver.sh` 包装入口 | 默认只读；不新增 solver JS |
| `towers/` | 跨塔的区域 spec、路线 fixture、benchmark task 数据 | 可写；不放 solver 实现 |
| `agents/` | 各模型 agent 的代码与私有 runs | agent 可写自己的目录 |
| `benchmarks/` | benchmark harness、public/hidden suites、结果目录 | 可写；hidden suite 不提交真实答案 |
| `routes/` | 仓库级生成路线输出 | 只放生成物；正式 route schema 仍由 `route-store` 维护 |
| `logs/` | 生成日志 | 只放生成物 |
| `runs/` | 日期/agent 维度的标准运行输出 | agent/harness 可写 |
| `tools/` | 仓库级审计、边界检查、清单生成脚本 | 可写；不放 tower-specific solver |
| `docs/` | 架构、边界、API、benchmark、清单文档 | 可写 |

## 3. JS 文件分类规则

文件清单由以下命令生成：

```bash
npm run audit:js --prefix shared-solver
```

分类规则：

| Pattern | Category | 处理 |
| --- | --- | --- |
| `shared-solver/**/*.js` | refined by `shared-solver/solver-manifest.json` (core / support / experimental / exploration / test / cli / archive-candidate) | 按 manifest status 维护；experimental/exploration 不是正确性证明 |
| `shared-solver/solver-manifest.json` | module identity | 新增 lib 模块后运行 `npm run manifest:refresh --prefix shared-solver` 并 `npm run check:manifest --prefix shared-solver` |
| `*/solver/**/*.js` | legacy solver candidate | 冻结；后续归档 |
| `*/project/**/*.js` | tower project data/runtime | 不动，属于 h5mota 项目 |
| `*/libs/**/*.js` | tower runtime/library | 不动，属于 h5mota 项目 |
| `tools/**/*.js` | repo tools | 保留 |
| `agents/**/*.js` | agent sandbox | 受边界检查约束 |
| `benchmarks/**/*.js` | benchmark harness | 保留 |
| `routes/**/*.js` / `logs/**/*.js` | suspicious generated JS | 默认不允许，需单独说明 |

生成文档：

- `docs/js-inventory.md`
- `docs/solver-entrypoints.md`
- `docs/legacy-tower-solver-js-baseline.json`

相关检查：

```bash
npm run check:manifest --prefix shared-solver
npm run check:teacher-divergence --prefix shared-solver
npm run check:mt5-51533-next-smoke --prefix shared-solver
```

测试分级（unit / unit-plus-micro / integration-local / local-regression / diagnostic / smoke / smoke-wrapper / closure）记录在 `shared-solver/solver-manifest.json` 的 `tests` 字段；smoke 允许 `found=false`，不要把 smoke 或 diagnostic 绿当成路线已闭环。closure 必须拒绝 `found=false` 并要求 strict replay。

Teacher divergence audit 是测试侧的 teacher-forced 诊断：它逐步确认 teacher action 是否可生成、successor 是否有效，以及 teacher 是否会被同 key 的 sibling/prior dominance 淘汰。它可以定位首次分叉原因，但不会向生产搜索提供 teacher action，也不证明目标路线已经自动搜索闭环。

## 4. Canonical 入口

普通塔入口仍从塔目录执行，但实际转发到 `shared-solver/`：

```bash
cd "Only upV2.1/Only upV2.1" && ./solver.sh
cd "whiteisland（9）" && ./solver.sh
```

公共 solver 直接入口：

```bash
npm run run:onlyup:segmented --prefix shared-solver
npm run run:onlyup:region1 --prefix shared-solver
npm run run:region:whiteisland --prefix shared-solver
```

GUI 回放统一使用：

```bash
node shared-solver/route-gui.js \
  --project-root="Only upV2.1/Only upV2.1" \
  --route-file="shared-solver/routes/latest/segmented-mt5-blueking.route.json" \
  --live=1 \
  --headless=0 \
  --runtime-auto-battle=1 \
  --runtime-auto-pickup=1
```

## 5. 旧塔内 solver 处理策略

当前策略是冻结，不直接删除。

阶段：

1. **清单化**：用 `tools/audit-js-files.js` 固化旧文件 hash 与分类。
2. **冻结新增**：`check:no-tower-solver-js` 阻止新增塔内 solver JS。
3. **入口统一**：只保留 `solver.sh`、`solver.config.json`、`routes/`、`logs/` 作为塔目录入口与输出。
4. **归档旧实现**：确认所有回放和检查通过后，移动到 `_archive/legacy-solver-<tower>-YYYYMMDD/`。
5. **删除候选**：归档稳定一段时间后，再决定是否真正删除旧拷贝。

禁止在以下目录继续开发 solver：

```text
Only upV2.1/Only upV2.1/solver/**
whiteisland（9）/solver/**
```

## 6. 新代码放置规则

| 新内容 | 放置位置 |
| --- | --- |
| DP/search/simulator/replay 公共逻辑 | `shared-solver/lib/**` |
| 公共 CLI | `shared-solver/*.js` |
| 区域任务 spec | `towers/<tower>/region-specs/**` |
| 小塔试炼 spec | `towers/<tower>/trial-specs/**` |
| 路线 fixture | `towers/<tower>/route-fixtures/**` |
| agent 代码 | `agents/<agent>/src/**` |
| agent 运行输出 | `agents/<agent>/runs/**` 或 `runs/**` |
| benchmark suite | `benchmarks/public/**` / `benchmarks/hidden/**` |
| 仓库审计脚本 | `tools/**` |

## 7. 边界检查

公共层开发检查：

```bash
npm run check:public-layer-boundaries --prefix shared-solver
```

旧塔内 solver 冻结检查：

```bash
npm run check:no-tower-solver-js --prefix shared-solver
```

严格 agent 输出检查：

```bash
npm run check:agent-boundaries --prefix shared-solver -- --agent=<agent-name>
```

`check:static` 已接入结构与边界相关轻量检查；完整 live replay 不进入默认静态检查，避免拖慢本地开发。

## 8. 当前结构债务

仍需处理：

- `shared-solver/lib/` 还没有物理拆成 `core/search/replay/cli`，目前先通过文档定义边界。
- `shared-solver/README.md` 仍保留早期 macro/top-k 叙述，需要逐步改成“canonical DP 为主、beam 为辅助”。
- 旧塔内 `solver/**` 文件仍存在，后续应按冻结策略归档。
- `routes/`、`logs/`、`runs/` 中生成物需要按任务清理，避免提交大体积临时输出。
