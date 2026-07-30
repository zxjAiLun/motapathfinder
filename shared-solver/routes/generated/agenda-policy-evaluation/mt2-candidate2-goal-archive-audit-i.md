# PR-4.4i goal archive witness audit

Status: **completed**

## Teacher entry archive decision

- goalAccepted: **true**
- raw goal archive retained: **false**
- insertionCount: **1**
- archiveDecision: **rejected-by-goal-archive-capacity**
- activeAtFinish / selectedAtFinish: **true / false**
- goal nodes / goal archive capacity / DP skyline capacity: **10 / 8 / 4**
- actual archive witness: **true**
- comparator: {"comparator":"compareGoalStates","result":-369,"hpDiff":-369,"atkDiff":0,"defDiff":0,"mdefDiff":0,"lvDiff":0,"expDiff":-1,"routeLengthDiff":3,"firstDecidingField":"hp"}

## Witness-level continuation

- executed: **true**
- search found: **false**
- reached mt2-hp3834: **false**
- completion classification: **inconclusive**
- remaining frontier: **31**

## Conclusion

Teacher exact entry was goalAccepted but omitted from the raw goal archive by rejected-by-goal-archive-capacity; the recorded actual archive witness was sent through production downstream continuation.

## Provenance

- data generation commit: c630f981e45987fbbe00d4f7f41886b070131a58
- renderer commit: c630f981e45987fbbe00d4f7f41886b070131a58
