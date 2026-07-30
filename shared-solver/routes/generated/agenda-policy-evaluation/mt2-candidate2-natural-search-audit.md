# PR-4.4h MT2 candidate-2 natural search audit

Status: **inconclusive**

Candidate-2-only outcome: **inconclusive**.

## Contract

- Source route strict replay: **true**.
- Candidate-2 exact start matched the MT1 gate: **true**.
- Production search executed without teacher action injection: **true / true**.
- Candidate-2 was naturally retained by the MT1 merged checkpoint: **true**.
- Candidate-2 lifecycle observer covered decisions 11–23: **true**.
- Pipeline observed for entry/local/HP3834: **true / true / true**.
- Oracle suffix complete and hard tiles checked: **true / true**.
- Search completion classification: **inconclusive**.
- Natural milestone reach: entry=true, local-3582=true, HP3834=false.
- Incomplete attempts: mt2-local-3582:candidate-0 (expansions=900, frontier=30, reasons=frontier-nonempty+expansion-budget-exhausted); mt2-local-3582:candidate-1 (expansions=145, frontier=111, reasons=frontier-nonempty+heap-limit).
- Full-frontier condition met (candidate-2 success): **false**.
- Full four-candidate frontier run: **not-applicable**.

## Candidate-2-only result

- found=false, reachedMilestone=mt2-local-3582.
- final hero=null.
- budget=null.

| Decision | Segment | Generated | Post rejoin | Dominance reject | Skyline insert | Evicted | Popped | Goal accepted | Classification |
|---:|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 11 | mt2-entry | true | true | false | true | false | true | false | skyline-retained-or-pending |
| 12 | mt2-entry | true | true | false | true | true | true | true | goal-accepted |
| 13 | mt2-local-3582 | false | false | false | false | false | false | false | candidate-not-generated |
| 14 | mt2-local-3582 | false | false | false | false | false | false | false | candidate-not-generated |
| 15 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 16 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 17 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 18 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 19 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 20 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 21 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 22 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |
| 23 | mt2-hp3834 | false | false | false | false | false | false | false | candidate-not-generated |

## Pipeline stages

| Segment | Production attempts | DP bucket retention | Raw goal archive | Segment candidates | Merged checkpoint |
|---|---:|:---:|---:|---:|---:|
| mt2-entry | 1 | true | 8 | 8 | 8 |
| mt2-local-3582 | 8 | true | 12 | 12 | 8 |
| mt2-hp3834 | 2 | true | 0 | 0 | 0 |

## Oracle-only suffix

- executed=true, completeSuffix=true.
- reached milestones=mt2-entry@decision-12, mt2-local-3582@decision-14, mt2-hp3834@decision-23.
- final hero={"hp":3834,"atk":72,"def":35,"mdef":290,"lv":4,"exp":1,"loc":{"x":3,"y":5,"direction":"down"}}.
- all hard tiles present=true.

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
| candidate-2-only | mt2-hp3834 | 11 | mt2-local-3582:candidate-1 | 145 | 111 | heap-limit |

The full-frontier run is conditional: it is executed only after candidate-2-only naturally reaches `mt2-hp3834`.

## Provenance

- solver commit: 700710f852bae2f839ac332d54ec2874da08abfb
- commit stable: **true**
- clean worktree: **true/true**
