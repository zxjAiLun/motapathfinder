# Use the shared solver

This legacy `solver/` directory now forwards key commands to the repository-level `shared-solver/` implementation.

Preferred commands from the tower root:

```bash
./solver.sh run-whiteisland-trial-topk.js --max-expansions=200 --top-k=1 --out-dir=routes/latest
./solver.sh gui --route-file=routes/latest/whiteisland-trial-best-progress.route.json --live=1 --headless=0
```

Legacy commands from this directory still work for GUI/trial generation, but new agents should output the tower-root `./solver.sh` form.
