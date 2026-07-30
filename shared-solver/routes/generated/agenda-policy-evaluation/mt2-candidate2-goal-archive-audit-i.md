# PR-4.4i goal archive witness audit

Status: **completed**

- auditStatus: **completed**
- teacherEntryArchiveOutcome: **rejected-by-goal-archive-capacity**
- boundaryWitnessContinuation: **inconclusive**
- productionSemanticChange: **false**

## Teacher entry archive decision

- goalAccepted: **true**
- raw goal archive retained: **false**
- insertionCount: **1**
- archiveDecision: **rejected-by-goal-archive-capacity**
- witnessKind: **goal-archive-capacity-boundary**
- activeAtFinish / selectedAtFinish: **true / false**
- goal nodes / goal archive capacity / DP skyline capacity: **10 / 8 / 4**
- capacity boundary witness: **true**
- actual replacement witness: **false**
- comparator: {"comparator":"compareGoalStates","result":-369,"hpDiff":-369,"effectiveAtkDiff":0,"effectiveDefDiff":0,"effectiveMdefDiff":0,"rawLvDiff":0,"rawExpDiff":-1,"rawAtkDiff":0,"rawDefDiff":0,"rawMdefDiff":0,"routeLengthDiff":-3,"firstDecidingField":"hp"}

## Witness-level continuation

- executed: **true**
- search found: **false**
- reached mt2-hp3834: **false**
- completion classification: **inconclusive**
- remaining frontier: **31**

## Conclusion

Teacher exact entry was goalAccepted but omitted from the raw goal archive by rejected-by-goal-archive-capacity; the capacity boundary witness was sent through production downstream continuation.

## Provenance

- data generation commit: 2dcbccddc5d0350ae29a1ac28fabc9b29855f5a9
- renderer commit: 2dcbccddc5d0350ae29a1ac28fabc9b29855f5a9
