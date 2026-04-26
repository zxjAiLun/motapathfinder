#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOLVER_ROOT="$(cd "$PROJECT_ROOT/../../shared-solver" && pwd)"
COMMAND="${1:-run}"
if [[ $# -gt 0 ]]; then shift; fi

HAS_AUTO_BATTLE_ARG=0
for arg in "$@"; do
  case "$arg" in
    --auto-battle|--auto-battle=*|--runtime-auto-battle|--runtime-auto-battle=*)
      HAS_AUTO_BATTLE_ARG=1
      ;;
  esac
done

case "$COMMAND" in
  run|topk)
    SCRIPT="run-route.js"
    ;;
  brute|bruteforce)
    SCRIPT="find-route-bruteforce.js"
    ;;
  verify)
    SCRIPT="verify-route-live.js"
    ;;
  verify-mt)
    SCRIPT="verify-mt1-mt3-live.js"
    ;;
  gui)
    SCRIPT="route-gui.js"
    ;;
  check-core)
    SCRIPT="check-core-regressions.js"
    ;;
  check-stage)
    SCRIPT="check-stage-acceptance.js"
    ;;
  *.js)
    SCRIPT="$COMMAND"
    ;;
  *)
    echo "Unknown solver command: $COMMAND" >&2
    echo "Usage: ./solver.sh {run|brute|verify|verify-mt|gui|check-core|check-stage|script.js} [args...]" >&2
    exit 2
    ;;
esac

cd "$PROJECT_ROOT"
if [[ "$HAS_AUTO_BATTLE_ARG" == "1" ]]; then
  exec node "$SOLVER_ROOT/$SCRIPT" --project-root="$PROJECT_ROOT" "$@"
else
  exec node "$SOLVER_ROOT/$SCRIPT" --project-root="$PROJECT_ROOT" --auto-battle=0 "$@"
fi
