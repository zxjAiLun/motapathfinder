# PR-4.4e MT1 first divergence audit

Status: **completed**

## Scope

- Common root: state index 1, after `battle:blackSlime@MT1:8,7`.
- Segment: `mt1-gate-1559`.
- Search ran with the production defaults: best-first, dp skyline 4, candidate/goal skyline 8, preserve skyline roles enabled.

## First route divergence

- Teacher decision 2: battle:redSlime@MT1:9,6
- Production decision 2: battle:redSlime@MT1:10,8
- Common exact state: **true**; common dominance state: **true**.

## Lineage result

| Lineage | Provider | Candidate | Successor | Root skyline | Root dominance reject | Root evicted | Root agenda pop | Any goal | Classification |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| teacher-decision-2 | true | true | true | false | true | false | false | false | dominance-rejected |
| production-decision-2 | true | true | true | true | false | false | true | true | reached-mt1-goal |

Search: found=true, expansions=21, frontier=39.
Route-fixture checkpoint matches: none.
Teacher lineage checkpoint matches: 0; production lineage checkpoint matches: 2.

The lineage audit is diagnostic-only and does not modify dominance, DP keys, skyline size, or agenda defaults.

## Provenance

- solver commit: a0bcc8f309eb38bccee88f2ff2030601223827dc
- commit stable: **true**
- clean worktree: **false/false**
