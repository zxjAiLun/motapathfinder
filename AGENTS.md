# Repository Guidelines

## Project Structure & Module Organization

`shared-solver/` is the canonical Node.js solver implementation. Put reusable solver logic in `shared-solver/lib/`, runnable CLIs and regression checks in top-level `shared-solver/*.js`, milestones in `shared-solver/milestones/`, profiles in `shared-solver/profiles/`, GUI code in `shared-solver/gui/`, and generated or fixture routes under `shared-solver/routes/`.

Tower snapshots live in `Only upV2.1/Only upV2.1/` and `whiteisland（9）/`. Their `libs/`, `project/`, `extensions/`, `_server/`, `main.js`, assets, saves, and runtime folders are h5mota project/runtime content, not canonical solver code. Tower-local `solver/` directories were removed and are forbidden; `npm run check:no-tower-solver-js --prefix shared-solver` fails if solver JS appears under them. All solver work belongs in `shared-solver/`.

Shared region and trial specs live in `towers/`, public and template agents in `agents/`, benchmark harnesses and suites in `benchmarks/`, cross-repo tools in `tools/`, and design/architecture notes in `docs/`.

## Documentation System

Follow `docs/project-documentation-system.md` for every material solver or product round. Project-specific settings are:

```text
HANDOFF_PATH = 20260804handoff.md
HANDOFF_PUBLICATION = tracked
MILESTONE_PATTERN = docs/YYMMDD/<milestone-id-with-hyphens>.md
DATE_TIMEZONE = Asia/Shanghai
GENERATED_ARTIFACT_POLICY = ignored generated directories unless explicitly promoted as a tracked fixture
STATUS_VOCABULARY = project default from docs/project-documentation-system.md
```

Before planning or changing a material round:

1. Read this file, `20260804handoff.md`, and the active dated milestone document.
2. Read the architecture/contract files linked by that milestone.
3. Verify branch, `HEAD`, remote relation, worktree carry, and relevant artifacts rather than trusting old prose.

Use the date on which the coherent round begins, not one document per day. For example, PR-5.18c started on 2026-08-14 lives at `docs/260814/5-18c.md` even if later iterations happen on another date. Create or update the milestone document before or alongside material implementation. Keep initial design and gates intact; append iteration findings and corrections instead of rewriting history.

The handoff is the current project truth and milestone index. `20260804checkpoint.md` and `shared-solver/RESEARCH_PROGRESS.md` are cumulative history, not competing current-status documents. Update the handoff whenever a milestone status, accepted baseline, formal artifact, known limitation, or next authorized step changes.

Use the controlled status vocabulary literally: design, authorization, implementation, verification, review, and acceptance are separate states. A bounded not-found result is evidence, not infrastructure failure; faster not-found is not route closure. Do not record future commit hashes. Keep generated probes and benchmark outputs in ignored generated paths unless a milestone explicitly promotes a small stable fixture.

At round completion, reconcile the milestone against actual code and commands, update the handoff snapshot/next step, check links and status consistency, run `git diff --check`, and stage only files within the round's publication boundary. Preserve valid negative results and append corrections instead of silently rewriting the initial design or gate.

## Solver Architecture

Treat region/segment canonical DP as the correctness path. The current main line is primitive canonical DP plus segment DP, milestone/region specs, skyline candidate preservation, route replay, and failure diagnostics. `linear-main`, beam, macro search, top-k, resource pocket/cluster/chain, and brute force entrypoints are useful exploration or regression tools, but they are not proof that a card-HP, unique, or near-unique route is impossible.

Core layers:

- State and simulation: `state.js`, `state-key.js`, `simulator.js`, `step-simulator.js`, `reachability.js`, `battle-resolver.js`, `events.js`, `floor-transitions.js`.
- Correctness search: `dp-search.js`, `segment-dp.js`, `adaptive-segment-planner.js`, `region-spec.js`, `run-segmented-dp.js`, `run-adaptive-segment-dp.js`, `run-region-dp.js`.
- Exploration: `search.js`, `search-worker.js`, `search-profiles.js`, `resource-pocket`, `resource-cluster`, `resource-chain`, and progressive planner modules.
- Replay and productization: `route-store.js`, `route-snapshot.js`, `live-replay.js`, `replay-session.js`, `route-gui.js`, `verify-route-live.js`.
- Diagnostics and governance: `solver-doctor.js`, `pruning-diagnostics.js`, `audit-state-dependencies.js`, `tools/audit-js-files.js`, `tools/check-agent-boundaries.js`.

When a segment/adaptive run fails, inspect the doctor report and raw failure fields before changing search behavior. Key fields include `failureClass`, `actionTrimmed`, `expansionBudgetExhausted`, `stoppedReason`, `frontierSize`, `rejectedByHigherHp`, `sameHpRejected`, `uniqueBattleTargets`, and `uniquePortalEntries`.

## Build, Test, and Development Commands

Install dependencies from the canonical solver package:

```bash
npm ci --prefix shared-solver
```

Run a quick search smoke test:

```bash
npm run smoke --prefix shared-solver
```

Run static regression checks:

```bash
npm run check:static --prefix shared-solver
```

Run the broader validation path, including live progress verification:

```bash
npm run check:validation --prefix shared-solver
```

Useful focused checks:

```bash
npm run check:core --prefix shared-solver
npm run check:productization --prefix shared-solver
npm run check:resource-timing --prefix shared-solver
npm run check:onlyup:segments --prefix shared-solver
npm run check:region-specs --prefix shared-solver
npm run check:agent-boundaries --prefix shared-solver
```

Canonical DP/region runs:

```bash
npm run run:onlyup:segmented --prefix shared-solver
npm run run:onlyup:adaptive --prefix shared-solver
npm run run:onlyup:region1 --prefix shared-solver
npm run run:onlyup:region2 --prefix shared-solver
npm run run:region:whiteisland --prefix shared-solver
```

GUI/live replay commands are available through `route-gui.js`, `verify-route-live.js`, and scripts such as `npm run gui:route --prefix shared-solver`. Use screenshots only for GUI-facing changes.

## Coding Style & Naming Conventions

Use CommonJS JavaScript with `"use strict";`, `const`/`let`, two-space indentation, semicolons, and descriptive kebab-case filenames such as `check-route-record.js` or `solver-doctor.js`. Prefer explicit option names such as `--max-expansions`, `--max-runtime-ms`, `--route-file`, and `--candidate-limit`.

Keep reusable logic in `shared-solver/lib/`; keep CLI orchestration in top-level `shared-solver/*.js`; keep generated artifacts out of source directories. Run `node -c <file>` for syntax checks on changed scripts when `node` is on PATH; otherwise rely on the matching npm check scripts, which run in the configured package environment.

Avoid broad refactors while debugging solver behavior. For route-quality or card-HP failures, first widen DP/segment settings such as `stopOnFirstGoal=false`, `goalSkylineLimit`, `candidateLimit`, `dpSkylineMax`, and `preserveSkylineRoles`, then check whether action scope or region/milestone goals are overconstrained.

## Testing Guidelines

There is no separate unit test framework; regression coverage is implemented as executable Node scripts and npm `check:*` commands. Add or extend a focused `check-*.js` script when changing search, DP keys, route replay, state keys, dominance, skyline selection, resource timing, doctor diagnostics, region specs, or agent boundaries.

Generated outputs should go to ignored/generated locations such as `shared-solver/routes/generated/`, `routes/generated/`, `logs/generated/`, `runs/`, or `benchmarks/results/`. Do not commit stale generated routes unless the task explicitly asks for fixture or benchmark updates.

Before treating a failed search as evidence of no route, check whether the run hit `time-limit`, `memory-limit`, `actionTrimmed > 0`, `expansionBudgetExhausted`, a live `frontierSize`, or a narrow action policy. Beam drops and action quotas are exploration diagnostics, not correctness proofs.

Validation is layered to keep iteration latency low. During development run only targeted checks for the changed area (e.g. `node -c <file>` plus the matching `check:*` script; target under 2 minutes). Every push/PR runs the fast CI layer (manifest, no-tower-solver-js, solver-job, launcher, route-free-state, tower-ir-shadow, candidate-key-smoke). The full evidence suite (key-dependency, dual-key-shadow, perf-baseline, candidate-key-promotion, paired benchmark, MT1 workload matrix) runs only for marker commits (`docs: record/close/baseline/promotion/qualification ...`), PRs requesting qualification, or `workflow_dispatch` — the cloud qualification is the authoritative clean-environment certification, so do not duplicate the full suite locally.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Add --only and --skip CLI filters and memory limit support` or `Refactor route reconstruction and simplify route patch building`. Keep subjects specific, mention the affected subsystem, and avoid vague messages like `fix stuff`.

Pull requests should summarize behavior changes, list validation commands run, link related issues or docs, and include screenshots only for GUI changes such as `shared-solver/gui/` or `route-gui.js`. For solver changes, include the relevant failure class, doctor summary, route fixture, or replay evidence when available.

## Agent-Specific Instructions

For public agent work, import only `shared-solver/public.js`; do not import `shared-solver/lib/**` or tower-local solver files directly. Run boundary checks before submitting agent changes:

```bash
npm run check:agent-boundaries --prefix shared-solver
```

For solver implementation work, modify `shared-solver/` first. Keep tower-local runtime files untouched unless the task explicitly asks for tower project/runtime behavior. Run `npm run check:no-tower-solver-js --prefix shared-solver` after any tower-area change to confirm no tower-local solver JS was introduced.
