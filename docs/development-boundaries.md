# Development Boundaries

See `docs/project-structure.md` for the full directory ownership model and `docs/multi-agent-framework.md` for strict external-agent write rules.

This repository now treats `shared-solver/` as the canonical solver and tower `solver/` directories as frozen legacy copies.

## P0: Stop Expanding Solver Sprawl

New solver code can be added only under:

- `shared-solver/**`
- `agents/**`
- `tools/**`
- `benchmarks/**`
- `towers/**`

Generated agent/search outputs can be written under:

- `runs/**`
- `routes/generated/**`
- `logs/generated/**`
- `benchmarks/results/**`

Do not add or modify solver code under:

- `Only upV2.1/Only upV2.1/solver/**`
- `whiteisland（9）/solver/**`

Do not write project/runtime changes during solver-public-layer work:

- `Only upV2.1/**`
- `whiteisland（9）/**`
- `猫可露露V5.9（屑猫头基础教程）/**`

Tower native JS under `project/`, `libs/`, `extensions/`, `_server/`, and `main.js` is h5mota runtime/project code. It is not solver code and should be left untouched unless the task explicitly targets tower content.

## Boundary Checks

Public-layer development check:

```bash
npm run check:public-layer-boundaries --prefix shared-solver
```

Legacy tower solver freeze check:

```bash
npm run check:no-tower-solver-js --prefix shared-solver
```

Strict external-agent submission check:

```bash
npm run check:agent-boundaries --prefix shared-solver -- --agent=<agent-name>
```

`check:agent-boundaries` only allows agent output writes under `agents/<agent>/runs/**`, `runs/**`, `routes/generated/**`, `logs/generated/**`, and `benchmarks/results/**`.

## P1: Canonical Entrypoints

Only Up:

```bash
cd "Only upV2.1/Only upV2.1" && ./solver.sh
```

Whiteisland:

```bash
cd "whiteisland（9）" && ./solver.sh
```

Canonical shared solver:

```bash
npm run run:onlyup:segmented --prefix shared-solver
```

JS inventory:

```bash
npm run audit:js --prefix shared-solver
```

Unified region DP:

```bash
npm run run:onlyup:region1 --prefix shared-solver
```

`linear-main` / beam / macro search is an exploration tool. Region DP and segment DP are the correctness path for near-unique tower routes.

Public benchmark harness:

```bash
node benchmarks/run-agent.js \
  --agent=agents/.templates/agent.json \
  --suite=benchmarks/public/region-suite.json
```

Public API for agents:

```js
const solver = require("../../shared-solver/public");
```

Agent code must not import `shared-solver/lib/**` or tower `solver/**` files directly.
