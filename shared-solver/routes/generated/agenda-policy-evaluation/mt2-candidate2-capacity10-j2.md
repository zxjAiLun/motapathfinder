# PR-4.4j2 candidate-2 ancestry attribution

Status: **completed**

## Corrected conclusion

The joint 10/10/4 configuration naturally reproduced the exact teacher HP3834 terminal state through an alternate mutation ancestry. The winning route did not pass through the exact teacher entry or teacher-local checkpoint, so known exact teacher-witness capacity recovery remains not-established.

## candidate-6 vs teacher-local exact diff

- resourceEquivalent: **true**
- exactEquivalent: **false**
- heroDiff: `{}`
- inventoryDiff: `{}`
- flagsDiff: `{}`
- MT2 mutation diff: `{}`
- mutations only in winner: **MT1:4,1**
- mutations only in teacher: **MT1:8,1**

## Replayed ancestry prefix

- source: natural MT1 candidate-2 gate, decision depth **10**
- first divergence decision: **11**
- first divergence actions: **battle:skeleton@MT1:4,1** vs **battle:skeleton@MT1:8,1**
- candidate-6 decision-12 entry: **mt2-entry:candidate-0**
- candidate-7 decision-12 entry: **mt2-entry:candidate-3**
- candidate-6 decision-14 local: **mt2-local-3582:candidate-6**
- candidate-7 decision-14 local: **mt2-local-3582:candidate-7**
- first exact rejoin under shared continuation: **20**
- prefix replay: **4/4** and **4/4**
- shared continuation final exact match: **true**

## Baseline-8 cross-check

- winner entry raw / segment / merged: **true / true / true**
- winner local raw / segment / merged: **false / false / false**
- baseline executed the exact winner-local HP attempt: **false**
- capacity dependency classification: **insufficient-existing-evidence**

## Isolated candidate workers

| Candidate | Found | Reached | Expansions | Stop | Report valid |
|---|---:|---|---:|---|---:|
| mt2-local-3582:candidate-6 | true | mt2-hp3834 | 900 | - | true |
| mt2-local-3582:candidate-7 | true | mt2-hp3834 | 900 | - | true |

## Verdict

- terminalExactConvergenceViaAlternateAncestry: **true**
- knownExactTeacherWitnessRecovery: **not-established**
- winningAncestryCapacityDependency: **insufficient-existing-evidence**
- globalDefaultChangeRecommended: **not-established**

No production solver, DP key, dominance comparator, agenda default, or milestone definition was changed.

## Provenance

- j artifact: `shared-solver\routes\generated\agenda-policy-evaluation\mt2-candidate2-capacity10-j.json`
- baseline-8 artifact: `shared-solver\routes\generated\agenda-policy-evaluation\mt2-candidate2-natural-search-audit-v2.json`
- j2 generation commit: `c90432836a6bc5d56e18e1c2b440b496419633a6`
