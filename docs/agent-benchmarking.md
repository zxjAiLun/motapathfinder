# Agent Benchmarking

See `docs/multi-agent-framework.md` for the concrete agent directory layout, output contract, and permission model. See `docs/public-api.md` for the supported import surface.

Agent comparison is useful only as a controlled benchmark. It should not be reduced to “which model printed a route”.

## Leaderboards

### A. Agent-from-scratch

The agent receives:

- `shared-solver/public.js`
- Region/task specs
- Output contract
- Public suite

The agent may write only under its run/output roots. It cannot modify `shared-solver/**` or tower directories.

### B. Solver-improvement

The agent may modify `shared-solver/**`, but must pass public checks, boundary checks, and hidden suites. It still cannot modify tower project directories or legacy tower solver copies.

## Evaluation Dimensions

| Dimension | Meaning |
| --- | --- |
| Solving ability | Finds a route and produces `motapathfinder.route.v1` |
| Proof awareness | Reports `proofClaim`, `completeWithinActionSet`, budget/time/action-trim state |
| Generalization | Works across Only Up and Whiteisland tasks |
| Engineering discipline | Uses public API and writes only allowed outputs |
| Debugging ability | Reports failure class and repair direction when failing |
| Trap resistance | Handles resource timing traps such as early HP bottle mistakes |
| Cost | Expansions, wall time, route length, implementation complexity |
| Reproducibility | Fixed suite/spec/config; standard `route.json`, `metrics.json`, `diagnostics.json`, `agent-report.md` |

## Required Outputs

Each task run must produce:

- `route.json`
- `metrics.json`
- `diagnostics.json`
- `agent-report.md`

`metrics.json` must include:

- `found`
- `liveVerified`
- `proofLevel`
- `completeWithinActionSet`
- `proofClaim`
- `expansions`
- `wallMs`
- `routeLength`
- `illegalWrites`

## Hidden Tasks

Public tasks are for development and smoke checks. Hidden tasks are required for model comparison because public region specs can leak milestone knowledge.

Hidden suites should include:

- A region where immediate HP gain is a trap.
- A region where the best HP candidate is not the best combat candidate.
- A Whiteisland-style small tower with different floor naming and event start.
- A failure case where the correct output is a failure class, not a fake route.

## Harness

Run public suite:

```bash
node benchmarks/run-agent.js \
  --agent=agents/.templates/agent.json \
  --suite=benchmarks/public/region-suite.json
```

The harness owns output paths. Agents receive output paths through command placeholders or environment variables and must not choose their own write location.
