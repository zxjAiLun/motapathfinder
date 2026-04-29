# Agent Sandbox

Agents may keep their own implementation under `agents/<agent>/src/**`, but normal run outputs should go under `agents/<agent>/runs/**`.

External agents must import only:

```js
const solver = require("../../shared-solver/public");
```

Required output files per run:

- `route.json`
- `metrics.json`
- `diagnostics.json`
- `agent-report.md`

Strict boundary check:

```bash
npm run check:agent-boundaries --prefix shared-solver -- --agent=<agent-name>
```

Benchmark method and evaluation dimensions are documented in `docs/agent-benchmarking.md`.
