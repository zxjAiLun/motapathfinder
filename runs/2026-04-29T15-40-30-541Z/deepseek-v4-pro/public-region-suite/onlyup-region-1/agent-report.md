# Agent Report: deepseek-v4-pro

## Result
- Task: onlyup-region-1
- Found: false
- Proof level: not-found
- Route length: 0
- Expansions: 1
- Wall ms: 51

## Strategy
- Algorithm: segment DP via solver.runMilestoneGraph
- stopOnFirstGoal: always false (skyline candidate mode)
- enableFailureBacktracking: true
- Fallback attempts: 5

## Failure / Diagnostics
- Failure class: no-path
- No valid route could be constructed within budget.

### Attempts
- Attempt 0: candidateLimit=8, dpKeyMode=region, found=false, wallMs=19
- Attempt 1: candidateLimit=12, dpKeyMode=region, found=false, wallMs=1
- Attempt 2: candidateLimit=8, dpKeyMode=location, found=false, wallMs=0
- Attempt 3: candidateLimit=8, dpKeyMode=region, found=false, wallMs=0
- Attempt 4: candidateLimit=16, dpKeyMode=region, found=false, wallMs=0
