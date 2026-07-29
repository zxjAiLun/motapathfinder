# PR-4.4h MT2 candidate-2 natural search audit

Status: **failed**

## Contract

- Candidate-2-only natural search reached `mt2-hp3834`: **false**.
- No teacher actions were injected: **true**.
- Candidate-2 was naturally retained by the MT1 merged checkpoint: **true**.
- Candidate-2 lifecycle observer covered decisions 11–23: **true**.
- Full-frontier condition met (candidate-2 success): **false**.
- Full four-candidate frontier run: **not-applicable**.

## Candidate-2-only result

- found=false, reachedMilestone=mt2-local-3582.
- final hero=null.
- budget=null.

| Decision | Segment | Generated | Dominance reject | Skyline insert | Evicted | Popped | Goal accepted | Classification |
|---:|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 11 | mt2-entry | true | false | true | false | true | false | skyline-retained-or-pending |
| 12 | mt2-entry | true | true | true | true | true | true | goal-accepted |
| 13 | mt2-local-3582 | false | false | false | false | false | false | candidate-not-generated |
| 14 | mt2-local-3582 | false | false | false | false | false | false | candidate-not-generated |
| 15 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 16 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 17 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 18 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 19 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 20 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 21 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 22 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |
| 23 | mt2-hp3834 | false | false | false | false | false | false | candidate-not-generated |

## Segment attempts

| Run | Segment | Attempt order | Start candidate | Expansions | Frontier | Stop |
|---|---|---:|---|---:|---:|---|
| candidate-2-only | mt2-entry | 1 | initial#0 | 14 | 0 | null |
| candidate-2-only | mt2-local-3582 | 2 | mt2-entry:candidate-0 | 294 | 0 | null |
| candidate-2-only | mt2-local-3582 | 3 | mt2-entry:candidate-1 | 230 | 0 | null |
| candidate-2-only | mt2-local-3582 | 4 | mt2-entry:candidate-2 | 276 | 0 | null |
| candidate-2-only | mt2-local-3582 | 5 | mt2-entry:candidate-3 | 294 | 0 | null |
| candidate-2-only | mt2-local-3582 | 6 | mt2-entry:candidate-4 | 276 | 0 | null |
| candidate-2-only | mt2-local-3582 | 7 | mt2-entry:candidate-5 | 169 | 0 | null |
| candidate-2-only | mt2-local-3582 | 8 | mt2-entry:candidate-6 | 160 | 0 | null |
| candidate-2-only | mt2-local-3582 | 9 | mt2-entry:candidate-7 | 160 | 0 | null |
| candidate-2-only | mt2-hp3834 | 10 | mt2-local-3582:candidate-0 | 900 | 30 | null |
| candidate-2-only | mt2-hp3834 | 11 | mt2-local-3582:candidate-1 | 900 | 30 | null |
| candidate-2-only | mt2-hp3834 | 12 | mt2-local-3582:candidate-2 | 866 | 0 | null |
| candidate-2-only | mt2-hp3834 | 13 | mt2-local-3582:candidate-3 | 900 | 32 | null |
| candidate-2-only | mt2-hp3834 | 14 | mt2-local-3582:candidate-4 | 900 | 31 | null |
| candidate-2-only | mt2-hp3834 | 15 | mt2-local-3582:candidate-5 | 900 | 31 | null |
| candidate-2-only | mt2-hp3834 | 16 | mt2-local-3582:candidate-6 | 900 | 34 | null |
| candidate-2-only | mt2-hp3834 | 17 | mt2-local-3582:candidate-7 | 359 | 0 | null |
| candidate-2-only | mt2-local-3582 | 18 | mt2-entry:candidate-0 | 294 | 0 | null |
| candidate-2-only | mt2-local-3582 | 19 | mt2-entry:candidate-1 | 230 | 0 | null |
| candidate-2-only | mt2-local-3582 | 20 | mt2-entry:candidate-2 | 276 | 0 | null |
| candidate-2-only | mt2-local-3582 | 21 | mt2-entry:candidate-3 | 294 | 0 | null |
| candidate-2-only | mt2-local-3582 | 22 | mt2-entry:candidate-4 | 276 | 0 | null |
| candidate-2-only | mt2-local-3582 | 23 | mt2-entry:candidate-5 | 169 | 0 | null |
| candidate-2-only | mt2-local-3582 | 24 | mt2-entry:candidate-6 | 160 | 0 | null |
| candidate-2-only | mt2-local-3582 | 25 | mt2-entry:candidate-7 | 160 | 0 | null |
| candidate-2-only | mt2-hp3834 | 26 | mt2-local-3582:candidate-0 | 900 | 30 | null |
| candidate-2-only | mt2-hp3834 | 27 | mt2-local-3582:candidate-1 | 900 | 30 | null |
| candidate-2-only | mt2-hp3834 | 28 | mt2-local-3582:candidate-2 | 866 | 0 | null |
| candidate-2-only | mt2-hp3834 | 29 | mt2-local-3582:candidate-3 | 900 | 32 | null |
| candidate-2-only | mt2-hp3834 | 30 | mt2-local-3582:candidate-4 | 900 | 31 | null |
| candidate-2-only | mt2-hp3834 | 31 | mt2-local-3582:candidate-5 | 900 | 31 | null |
| candidate-2-only | mt2-hp3834 | 32 | mt2-local-3582:candidate-6 | 900 | 34 | null |
| candidate-2-only | mt2-hp3834 | 33 | mt2-local-3582:candidate-7 | 900 | 34 | null |
| candidate-2-only | mt2-hp3834 | 34 | mt2-local-3582:candidate-8 | 359 | 0 | null |
| candidate-2-only | mt2-hp3834 | 35 | mt2-local-3582:candidate-9 | 359 | 0 | null |
| candidate-2-only | mt2-hp3834 | 36 | mt2-local-3582:candidate-10 | 871 | 0 | null |
| candidate-2-only | mt2-hp3834 | 37 | mt2-local-3582:candidate-11 | 871 | 0 | null |

The full-frontier run is conditional: it is executed only after candidate-2-only naturally reaches `mt2-hp3834`.

## Provenance

- solver commit: 1ab7a8aeb9c7a3d0f6400efc0a1743ddb9d404ba
- commit stable: **true**
- clean worktree: **true/true**
