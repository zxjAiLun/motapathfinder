# Use the shared solver

This directory is kept as a legacy/debug copy. New solver changes should go to the repository-level `shared-solver/` directory.

From this tower root, run:

```bash
./solver.sh run --to-floor=MT3 --max-expansions=20
./solver.sh brute --to-floor=MT3 --max-expanded=100000
./solver.sh verify --route-file=routes/latest/mt1-mt3.route.json
./solver.sh gui --route-file=routes/latest/mt1-mt3.route.json
```
