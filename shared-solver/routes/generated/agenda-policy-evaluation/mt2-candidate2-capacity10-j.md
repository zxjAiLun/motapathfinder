# PR-4.4j MT2 candidate-2 capacity counterfactual

Status: **completed**

## Contract

- auditStatus: **completed**
- capacityCounterfactualConfigVerified: **true**
- productionDefaultsUnchanged: **true**
- noTeacherInjection: **true**
- productionSemanticChange: **false**
- globalDefaultChangeRecommended: **not-established**

## Exact teacher-entry lifecycle

- goalAccepted: **true**
- raw archive retained / selected archive rank: **true / 9**
- raw sort rank: **9**
- segment-goal candidate retained: **true**
- merged checkpoint retained: **true**
- downstream agenda popped: **true**
- first exact-lineage drop: **{"decisionIndex":15,"classification":"pre-state-replaced-by-continuation-compatible-witness","reason":null}**
- exact lifecycle outcome: **exact-lineage-dropped-and-exactly-rejoined-at-final-milestone**

## Search and exact reproduction

- run found / reached: **true / true**
- exact HP3834 match: **true**
- retained-matrix completion: **inconclusive**
- strict natural route replay: **true**
- hard tiles preserved: **true**

## Conclusion

Increasing runtime raw goal-archive and checkpoint capacities to 10 allowed the naturally retained MT1 candidate-2 pipeline to reproduce the exact teacher HP3834 state. This establishes a known-witness capacity counterfactual only; it does not establish a global selector conclusion or a default-capacity change.

## Provenance

- data generation commit: 6efc8bb78f93f0bf5ba0d5a7671d180131338e74
- renderer commit: 3248051a936e049fedc5b15147b327897f3e1baf
- worktree clean at run start / finish: **true/true**
