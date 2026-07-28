# PR-4.4d HP3834 teacher fixture current-exact divergence audit

Status: **completed**

## Gate result

- Current-exact route strict replay: **valid (33/33)**
- Original fixture strict replay: invalid at step 12: post-exact-state-mismatch
- Current-exact route: shared-solver\routes\generated\agenda-policy-evaluation\mt1-mt3-i893-hp8425.current-exact.route.json
- Production checkpoint strict replay: valid (12/12)

## Joint witness comparison

- Teacher witness: decision ?; HP 3834; ATK/DEF/MDEF 72/35/290.
- Production witness: depth 21; HP 2828; ATK/DEF/MDEF 72/35/290.
- Same dominance key: **true**; exact key equal: **false**.
- Same mutation/flags/inventory/location: **true**.
- HP delta (teacher minus production): **1006**.

## Common boundary

- Status: **no-common-dominance-boundary**.
- Teacher earliest mt2-local-3582: state index 14.
- Production checkpoint: route state index 12.
- Exact prefix length: 2; dominance prefix length: 2.

The local checkpoint is not treated as a common continuation state because its dominance key differs from the teacher's earliest local-goal state.

## Pre-goal step audit

Audit mode: single-step-search-observer; anchored to production checkpoint: **false**.

| Decision | Action | Provider | Successor | Dominance reject | Skyline insert/evict | Agenda pop |
|---:|---|:---:|:---:|:---:|:---:|:---:|
| 15 | changeFloor@MT2:6,0 | true | true | false | true/false | false |
| 16 | changeFloor@MT1:6,0 | true | true | false | true/false | false |
| 17 | battle:zombie@MT2:8,3 | true | true | false | true/false | false |
| 18 | battle:zombieKnight@MT2:9,4 | true | true | false | true/false | false |
| 19 | battle:ghostSoldier@MT2:10,5 | true | true | false | true/false | false |
| 20 | battle:slimeman@MT2:2,5 | true | true | false | true/false | false |
| 21 | battle:zombieKnight@MT2:4,3 | true | true | false | true/false | false |
| 22 | battle:rock@MT2:10,1 | true | true | false | true/false | false |
| 23 | battle:rock@MT2:3,6 | true | true | false | true/false | false |

Null lifecycle fields mean no production search was claimed at that row; the production local checkpoint was not a dominance-equivalent anchor.

## Provenance

- solver commit: 3db4fdb4dc254d8c4bfb938a9b7529155885fda7
- started/finished stable: **true**
- node: v22.12.0
- clean worktree at start/finish: **true/true**

Raw JSON: shared-solver\routes\generated\agenda-policy-evaluation\mt2-hp3834-teacher-fixture-current-exact-divergence-audit.json
Current-exact route: shared-solver\routes\generated\agenda-policy-evaluation\mt1-mt3-i893-hp8425.current-exact.route.json

