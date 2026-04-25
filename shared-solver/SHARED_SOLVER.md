# Shared Solver

`shared-solver` is the single canonical solver implementation for the towers in this repository.

Run it through each tower's wrapper so relative inputs/outputs stay tower-local:

```bash
cd "Only upV2.1/Only upV2.1"
./solver.sh run --to-floor=MT3 --max-expansions=20

cd "../../whiteisland（9）"
./solver.sh run --to-floor=MT3 --max-expansions=20
```

Supported wrapper commands:

- `run` / `topk` -> `run-mt1-mt11.js`
- `brute` / `bruteforce` -> `find-route-bruteforce.js`
- `verify` -> `verify-route-live.js`
- `verify-mt` -> `verify-mt1-mt3-live.js`
- `gui` -> `route-gui.js`
- `check-core` -> `check-core-regressions.js`
- `check-stage` -> `check-stage-acceptance.js`
- any `*.js` filename in `shared-solver`

All wrapper commands pass `--project-root=<tower root>` automatically.
