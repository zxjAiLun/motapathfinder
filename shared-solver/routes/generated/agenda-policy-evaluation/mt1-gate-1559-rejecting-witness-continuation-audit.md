# PR-4.4f MT1 rejecting-witness continuation audit

Status: **completed**

## Gates

| Gate | Result |
|---|:---:|
| teacherStrictReplay | true |
| productionStrictReplay | true |
| commonExactState | true |
| commonDominanceState | true |
| rejectingWitnessCaptured | true |
| searchFoundMt1Goal | true |
| teacherSuffixReachedMt1Goal | true |

Failed gates: none.

## Captured rejecting witness

- Teacher action: battle:redSlime@MT1:9,6.
- Candidate exact key captured: **true**.
- Candidate dpKey present: **true**.
- Witness node: 2.
- Witness exact key captured: **true**.
- Witness action: battle:redSlime@MT1:10,8.
- First deciding field: custom.
- Candidate/witness region key equal: **true**.

## Teacher suffix continuation

| Decision | Provider T/W | Successor T/W | Exact equal | Dominance equal | Witness HP delta |
|---:|:---:|:---:|:---:|:---:|---:|
| 3 | true/true | true/true | true | true | 0 |
| 4 | true/true | true/true | true | true | 0 |
| 5 | true/true | true/true | true | true | 0 |
| 6 | true/true | true/true | true | true | 0 |
| 7 | true/true | true/true | true | true | 0 |
| 8 | true/true | true/true | true | true | 0 |
| 9 | true/true | true/true | true | true | 0 |
| 10 | true/true | true/true | true | true | 0 |

- Teacher reached MT1 gate: **true**.
- Witness reached MT1 gate: **true**.
- Witness resource/attribute non-inferior: **true**.
- Exact continuation rejoined: **true**.
- Verdict: **continuation-compatible**.

The audit is oracle-only for the teacher suffix. It does not inject teacher actions into production search and does not modify dominance, DP keys, skyline limits, or agenda defaults.

## Search boundary

- Found MT1 goal: **true**.
- Expansions: 17; frontier: 34.
- Stopped reason: time-limit.

## Provenance

- solver commit: 4c3e6622794727262f2ae1732b16b5f9efe385c5
- commit stable: **true**
- clean worktree: **true/true**
