# PR-4.4h-a exact pipeline and isolated checkpoint audit

Status: **inconclusive**

Candidate-2 downstream outcome: **inconclusive**.

## Gate summary

- Source route strict replay: **true**.
- Teacher exact MT2-entry goal accepted: **true**.
- Exact teacher entry pipeline retained (raw / segment / merged): **false / false / false**.
- First exact-lineage drop classified: **true**.
- Entry replacement continuation audited: **true**.
- All local checkpoints attempted in isolated processes: **true / true**.
- Child old-space actually applied to every worker: **true**.
- Lifecycle targets defined / last observed / first unobserved: **true / 12 / 13**.
- Post-drop decisions classified not-applicable: **true**.

## Exact teacher entry pipeline

- exact state key SHA-256: `d74ce433fc73828fa3849e53c1fbf98cfa6305e6acc258a670d37ce8b39624c2`
- expected teacher entry hero: {"hp":1601,"atk":21,"def":17,"mdef":130,"lv":3,"exp":6,"loc":{"x":6,"y":0,"direction":"up"}}
- first absent stage: **raw-dp-goal-archive**

| Stage | Exact state present | Matching candidates |
|---|:---:|---:|
| raw-dp-goal-archive | false | 0 |
| segment-goal-skyline | false | 0 |
| merged-checkpoint-frontier | false | 0 |

## Entry replacement oracle (decisions 13–23)

| Candidate | 13–14 executable | Exact rejoin decisions | Local reached | HP3834 reached | Complete suffix |
|---|:---:|---|:---:|:---:|:---:|
| mt2-entry:candidate-0 | true |  | true | false | true |
| mt2-entry:candidate-1 | true |  | true | false | true |
| mt2-entry:candidate-2 | true |  | true | false | true |
| mt2-entry:candidate-3 | true |  | true | false | true |
| mt2-entry:candidate-4 | true |  | true | false | true |
| mt2-entry:candidate-5 | true |  | true | false | true |
| mt2-entry:candidate-6 | true |  | true | false | true |
| mt2-entry:candidate-7 | true |  | true | false | true |

## Isolated MT2 HP3834 searches

| # | Candidate | Result | Completion | Expansions | Frontier | Stop | Peak heap / RSS | Old-space |
|---:|---|---|---|---:|---:|---|---:|:---:|
| 1 | mt2-local-3582:candidate-0 | not-found | inconclusive | 900 | 30 | null | 539.2 / 700.9 | true |
| 2 | mt2-local-3582:candidate-1 | not-found | inconclusive | 900 | 30 | null | 545.7 / 692 | true |
| 3 | mt2-local-3582:candidate-2 | not-found | failed | 866 | 0 | null | 570 / 719.6 | true |
| 4 | mt2-local-3582:candidate-3 | not-found | inconclusive | 900 | 32 | null | 640.6 / 799.4 | true |
| 5 | mt2-local-3582:candidate-4 | not-found | inconclusive | 900 | 31 | null | 580.6 / 729.9 | true |
| 6 | mt2-local-3582:candidate-5 | not-found | inconclusive | 900 | 31 | null | 580.2 / 726.9 | true |
| 7 | mt2-local-3582:candidate-6 | not-found | inconclusive | 900 | 34 | null | 570.7 / 731.8 | true |
| 8 | mt2-local-3582:candidate-7 | not-found | failed | 359 | 0 | null | 334.4 / 473.4 | true |

- All local checkpoint completion classification: **inconclusive**.
- Incomplete attempts are inconclusive and are not interpreted as dominance or selector failures.

## Oracle suffix from MT1 candidate-2

- completeSuffix=true, reached=mt2-entry@decision-12, mt2-local-3582@decision-14, mt2-hp3834@decision-23.
- final hero={"hp":3834,"atk":72,"def":35,"mdef":290,"lv":4,"exp":1,"loc":{"x":3,"y":5,"direction":"down"}}.
- all hard tiles present=true.

## Provenance

- data generation commit: 45dddee9096ea5d34729dd495a16c000cccea9cd
- renderer commit: 3ac74f19f7d0ed956c88611ddf6768031885147f
- artifact commit: pending-artifact-commit
- clean worktree at run start / finish: **true/true**
