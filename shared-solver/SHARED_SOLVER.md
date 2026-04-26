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

- `run` / `topk` -> `run-route.js`
- `brute` / `bruteforce` -> `find-route-bruteforce.js`
- `verify` -> `verify-route-live.js`
- `verify-mt` -> `verify-mt1-mt3-live.js`
- `gui` -> `route-gui.js`
- `check-core` -> `check-core-regressions.js`
- `check-stage` -> `check-stage-acceptance.js`
- any `*.js` filename in `shared-solver`

All wrapper commands pass `--project-root=<tower root>` automatically.

Primary profiles:

- `linear-main`: default route search profile; macro-first, checkpoint reuse/save, resource cluster/chain, confluence HP dominance.
- `resource-prep-main`: resource-heavy preparation profile for broader resource exploration.
- `debug-local-resource`: local resource ordering/debug profile with deeper pocket search and no checkpoint reuse/save by default.

Legacy compatibility profiles remain available but should not be used in new docs or commands:

- `stage-mt1-mt11`
- `stage-mt1-mt11-resource-prep`

Portable configs should default `confluenceRoutePolicy` to `slack`. Use `ignore-length` only for audited towers or floor ranges where the confluence key is known to cover every future-relevant state component.
