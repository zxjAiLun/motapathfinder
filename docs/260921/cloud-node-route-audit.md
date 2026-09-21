# Cloud Node / Route Failure Audit — 2026-09-21

```ini
STATUS = VERIFIED
DATE_STARTED = 2026-09-21
BASE_COMMIT = fe57649d6e70f0c8daee49d8a6f1c8db8bd945d6
SCOPE = Read-only analysis of cloud1 persisted nodes, routes, bounded failures and remaining resources
```

## Request and boundaries

Owner requested analysis of the server's already-searched nodes/routes and why no feasible route has been found. No production code changes, service control, journal migration, pruning/selector changes or new long cloud searches are authorized by this audit. Work against a local copy of the production release and persisted data. Temporary scripts/results remain under ignored `shared-solver/routes/generated/260921-cloud-node-audit/`.

## Initial questions and gates

1. Verify the actual search release, problem/resume/execution identities and snapshot timestamps. UI/Observer release identity must not be confused with the search worker identity.
2. Aggregate **all journal history**, separating stages/budgets, goal hits, live frontiers, action trimming and true exhaustion. Cumulative expansions are not one continuous frontier.
3. Replay saved routes using copied production simulator; compare exact states and resource deltas. Group apparent duplicate entries conservatively; do not change keys.
4. Inspect representative preparation witnesses and remaining resource dependencies. A failed prescribed sequence is not a proof that every sequence fails. Artifact-only assertions do not independently certify exhaustive reachability.
5. Report established observations, bounded counterexamples and unresolved causal hypotheses separately. No claim of global impossibility without complete search/proof.

## Baseline inspection

- Local `dev == origin/dev == fe57649`; remote ref checked with `git ls-remote`. Pre-existing untracked carry: `tools/motapath-observer-mcp/` (not this round).
- 2026-09-21 11:23 UTC: search service active on `20260920-5-29a-56f6c7d`; progress UI uses `20260921-progress-flags-967749e`. Observer points to the UI release, not the running search release.
- Search journal execution identity `1bb0c3328e8a01a839a3743a73e0fde9697ac99bba26ac6d252d6ae0a6fc1f63`; resume fingerprint `a3f4f1b5f025c220b05bddd0a4cb212e5cd6a24b4bfdc430bcb9182be575f51a`; problem fingerprint `0ca7d0b09e97dac015a8dc36e14988764b52185ae2ed5d63e3db8a3d6e0dec78`.
- Snapshot transfer is read-only on cloud1. Initial full archive transfer timed out after 90s; retried with assets excluded. Partial archive is not evidence; successful `snapshot.tar.gz` is the analysis input.

## Related contracts

- [PR-5.30a1](../260920/5-30a1.md): fixed executable capability witness, including failure of a prescribed sequence.
- [PR-5.29c](../260920/5-29c.md): step-22 local resource-gap claim; scope/exhaustiveness requires verification.
- [Cloud operations](../operations/cloud-search.md): release and resume boundaries.
- [Documentation contract](../project-documentation-system.md).

## Findings / verification

### 1. Frozen cloud snapshot and search coverage

The successful archive contains journal mtime `2026-09-21T11:26:50Z` (Shanghai 19:26:50). The service continued running while files were copied: this is not an atomic whole-directory snapshot. The copied release fingerprints exactly match the journal, and every copied node replays to its exact key. Counts below use **only the frozen journal**, not mixed live counters.

- `completedAttempts = 129`, `totalExpansions = 7,396,394`.
- 43 persisted nodes: 1 TS11 initial, 18 TS12 entries, 24 TS13 entries; **0 TS14**.
- All 43 saved routes pass `buildRouteRecord` reconstruction **and internal strict replay**, including final exact-state-key equality, using the copied production release. No flags patch/local HEAD simulator was substituted.
- All 43 keys are distinct. Even omitting flags only as a diagnostic grouping produced 43 groups: same HP/stat summaries are **not** enough to declare duplicates. Example differences include cleared `steelDoor@TS11:6,6` and different TS12 monsters.
- TS13→TS14: 24 × 8k + 24 × 32k + 24 × 128k + 8 × 256k = **6,080,000 expansions in 80 attempts**. Every attempt: `foundGoal=false`, `searchComplete=false`, `actionTrimmed=0`, `stoppedReason=expansion-limit`.
- The eight completed 256k attempts retain **55,469–66,431 frontier nodes**. This current release is not stopped by heap-limit in those attempts. Older release heap failures must not be mixed into these counts.
- Stage 0 drains at 9,608 expansions, but returns a trimmed goal archive of 16. Two productive TS12 roots drain at 23,021 and 9,300 expansions, also returning 16-candidate trimmed archives. This is not exhaustive retention of every possible entry.
- Raw attempt output/diagnostics are deleted by the durable runner after integration (`attempts/` was empty). The journal preserves summaries, not every state lifecycle. `rejectedByHigherHp`, `sameHpRejected` and exact witness-prefix fate cannot be reconstructed from these summaries alone.
- Budgets restart a local DP from its checkpoint, not from the previous frontier. The 7.4M sum is not a single continuous search.

### 2. Controlled resource-order counterexample

**Authored diagnostic**, not autonomous discovery: reuse the old 22-step witness as a baseline, then move the TS12 gem/preparation visit to six predeclared cut points after TS13 steps 6/7/8/9/10/11. Run 7 sequences × all 24 persisted TS13 nodes = **168 cases**. Already-removed battles are skipped by exact map-mutation evidence (not treated as lethal failures); all applied actions are enumerated from the unchanged simulator and protected-item guards remain active.

- 94 sequences complete, 74 halt; among completed cases **31 node/sequence pairs across 11 distinct persisted nodes** actually defeat `rock@TS13:11,3` and pass full original-start strict replay.
- No original-order case survives the rock (21 complete; best 11,701 HP). This is a failure of that prescribed order, not the seeds.
- Best sampled successful source: `2-7f41f60b09a55951abd8931c`, already in the production journal, entry **HP 1353 / ATK 6 / DEF 0 / Lv2 / EXP18**. Root lineage remains unchanged: TS11→TS12 node `1-465821b4dfe18845e668b4ea`, then the saved 29-decision TS13 prefix.
- **Same source, same final exact-key fields except HP**: original order **11,701 HP**, earlier TS12 visit **14,601 HP**, net **+2,900 HP**. Same final map mutations, inventory, flags, ATK9/DEF1/Lv3/EXP15. This is an executable controlled counterexample, not an arithmetic upper bound.

| Battle | Old ATK / damage | New ATK / damage | HP saved |
| --- | --- | --- | ---: |
| TS13 skeleton@2,6 | 7 / 2533 | 8 / 1258 | 1275 |
| TS13 skeleton@1,9 | 7 / 2533 | 8 / 1258 | 1275 |
| TS13 three skeletonCaptains | 7 / 1180 each | 8 / 1040 each | 420 |
| TS13 bat@1,3 | 7 / 120 | 8 / 102 | 18 |
| TS12 vampire@1,10 (paid earlier) | 9 / 418 | 8 / 506 | -88 |
| **Net** | | | **2900** |

The useful order is: gain Lv3 on TS13, return to TS12 **before** fighting the two DEF6 skeletons, defeat `slimeman@TS12:9,3` and collect its accessible red gem, then return to TS13 at ATK8. After obtaining the TS13 gem (ATK9), collect the four TS11 skeleton-guarded large potion groups. Neither the initial state nor Stage 0/1 route is changed.

Important dependency trade-off: gem acquisition temporarily drops HP **1960→795**; the nearby vampire preparation raises it to 1089. A capability investment can look worse on immediate HP/distance while being essential for later survival.

### 3. Strict-replayed TS14 witness

From the best preparation state, a short authored suffix reaches the next stage:

| Step | Damage / pickup | Result HP | ATK |
| --- | --- | ---: | ---: |
| Prepared state | — | 14601 | 9 |
| rock@TS13:7,9 | -14036; I619 +25600 | 26165 | 9 |
| rock@TS13:11,3 | -14036; poisonWine +1600, redGem +1 ATK | 13729 | 10 |
| zombie@TS13:8,10 | -7980; I576 +2 ATK | 5749 | 12 |
| zombieKnight@TS13:10,9 | -3740; weakWine +3200 | 5209 | 12 |
| changeFloor@TS13:11,11 | TS14 yellowPotion +400 | **5609** | **12** |

- **59 decisions from the original TS11 initial state**, full reconstruction + strict replay PASS.
- Final **TS14 / HP5609 / ATK12 / DEF1 / Lv3 / EXP19 / greenKey34**.
- Per-decision green-key decreases: **0**. Initial keys 30, keys picked up to 34; “zero keys” means zero spending, not zero carried inventory.
- At the first rock, HP must be >14036 **before** the +25600 pickup; 14601 satisfies this with 565 HP immediately after combat. Future potion gain was not credited before survival.
- No TS15/Boss completion or optimality claim. This witness has not been inserted into the running journal or promoted as an autonomous solver result.

### 4. Search mechanism: evidence and remaining uncertainty

**Established:** legal productive continuation exists from already-retained TS13 entries; the production run has not found TS14 within its recorded budgets. Current bottleneck is search coverage/service of a cross-floor resource-order dependency, not absence of any feasible retained seed.

**Concrete scheduler pressure:** at the best witness's step-6 state (TS13 HP1960/ATK7/DEF1), continuing with `skeletonCaptain@TS13:9,8` has goal-relative distance **6**; returning through `changeFloor@TS13:1,1` to TS12 has distance **20**. Both share `bestFloorRank=539013`. `compareDpAgendaRank` compares smaller distance before HP/ATK, so it ranks forward movement above this necessary return **at this decision**. This supports a resource-preparation servicing hypothesis; it does not prove where the full search first loses the exact witness.

**Not established:** whether the exact first missing prefix is never expanded, same-key substituted, skyline-trimmed, or simply beyond the budget. `actionTrimmed=0` rules out the recorded per-state action quota as the observed cause, not all pruning/retention issues. No global proof of completeness from finite skyline caps or trimmed goal archives.

**Next proposed diagnostic (requires a separate bounded execution decision):** use the verified TS14 route as a read-only oracle for exact-prefix lifecycle tracking under the unchanged production configuration. Report first divergence as generated/registered/retained/expanded/replaced, together with first deciding rank field. Do not immediately replace the scheduler, enlarge archives, or change DP keys.

### 5. Corrections to prior audit claims

1. **PR-5.29c scope correction:** a depleted step-22 state's local remaining-resource gap can remain true for that state; it cannot be lifted to every route from the TS13 entry. `2-0241234b0ff83efa49a2fa5e` itself now has a strict-replayed rock witness after changing the order (HP14243 before rock). The previous “candidate universe mathematically dead / 100% entry closure” claim is disproven.
2. **PR-5.30a1 scope correction:** four fixed-sequence failures, including halting at an already-removed vampire, did not prove all four seeds infeasible. The claim that all retained entries require Stage 0/1 reoptimization is disproven by the saved-entry TS14 witness. Selector changes remain unmotivated by this result, but “selector globally not a cause” is also stronger than the narrow test proves.
3. **Level threshold:** production `data.firstData.levelUp` has needs 10,25,**75**,200 with `clear=true`; Lv3→4 is **75**, not 200 (200 is Lv4→5). Map enemy EXP totals are TS11=16, TS12=23, TS13=24, total63. Even granting all63, after spending10+25 at earlier levels only28 remains; this still does not reach75. Correcting the threshold does not itself create a level-up solution.
4. **Vampire damage:** the copied production simulator evaluates `vampire@TS13:4,10` at ATK9/DEF1 as **418**, not the 209 stated in 5.29c. Yellow potion +400 gives net **-18**, not +191. Do not reuse the old 11,850 upper-bound number as newly verified evidence.
5. The old `check-local-feasibility-gap-closure.js` and `check-executable-capability-witness.js` assert stored artifact values/verdicts; their PASS does not independently establish exhaustive closure or the broad causal assertions. They were not altered in this read-only round.

## Reproduction and evidence

All evidence below is local/ignored under `shared-solver/routes/generated/260921-cloud-node-audit/`:

```sh
node shared-solver/routes/generated/260921-cloud-node-audit/audit-nodes.js
# exit 0; all 43 routes exact reconstruction + strict replay PASS; fingerprints match
node shared-solver/routes/generated/260921-cloud-node-audit/audit-preparation.js
# exit 0; 168 cases, 31 strict-replayed rock witnesses across 11 persisted entries
node shared-solver/routes/generated/260921-cloud-node-audit/verify-ts14-witness.js
# exit 0; 59 decisions; TS14 HP5609 ATK12 DEF1; no green-key decreases
```

- Frozen `snapshot.tar.gz`: SHA256 `8c318a37940ef332e5af245216862f8805a1ed6102fd3b36c8bf511569589e56`.
- Frozen journal SHA256 `471c9498b22872a29a51780e536707d64ec77f0a0e7700920682ffc57021fac4`.
- `ts14-witness.route.json`: SHA256 `2529037e59336fe4bae7c24fc5353f207baed919dcac94d9a5d913e4c10eb4ec` (route-record timestamps can change on regeneration).
- `ts14-witness-result.json`: SHA256 `d1c48f52f4003822eb68061ba22bce25589d672325f119e5644f03ff3e3a8488`.
- `node-route-audit.json`, `preparation-audit.json`, `resource-order-comparison.json`, `priority-divergence.json` and `evidence-manifest.json` hold counts, comparisons and input/output hashes.
- Last live read 2026-09-21 12:01:37 UTC: service still running, error null, 129 completed attempts, current TS13 attempt215149 expansions with frontier151848. This is a later observation, not substituted into the frozen results.

## Iteration 2 — authorized exact-prefix lifecycle diagnostic

Owner repeatedly requested continuation after the TS14 counterexample. This authorizes a **local bounded diagnostic**, not a cloud restart or policy change.

Pre-run plan/gates:
- Keep copied production release unchanged; reuse source `2-7f41f60b09a55951abd8931c` and frozen profile. Witness checkpoints come from the strict route record (entry plus its 30-decision continuation).
- Observe existing `skylineInserted`, `candidateRejected`, `skylineEvicted`, `agendaPopped`, `actionSetGenerated`, and `candidateGenerated` events. No code instrumentation, action/rank/key override, or witness-guided decisions.
- Match **exact key** and separately **production DP key with HP >= witness**. Losing one literal route to an equally good representative is not a correctness failure. Track predecessor expansion and successor action availability before interpreting “never generated.”
- Gate 1: fresh-process 8k OFF/ON equality of deterministic result/route/counter signatures (observer timing/memory fields excluded). Observer errors must be zero.
- Gate 2: inspect first supported lifecycle boundary at 8k; allow one frozen next-tier 32k diagnostic if needed to test whether the boundary advances. No 128k/256k local rerun in this iteration. Keep original per-attempt wall/memory limits and stop if hit; such a run is bounded evidence only.
- Store bounded checkpoint tables and counts, not a full event stream. Conclusions must name work budget and distinguish exact-prefix fate, same-key representative service, and general feasibility.
- Run on local copies; do not change cloud release, journal, scheduler, candidate limits, or source entry.

## Review Verdict and Formal Hypotheses Reversal (2026-09-21)

Following the formal review of the 59-decision strict-replayed TS14 witness, PR-5.30a3 exact agenda trace, and PR-5.31a A/B experiment:

```text
PR-5.30a3 exact winning-prefix trace        APPROVED
P7 6639-expansion service debt              APPROVED
P8 queued >25352, never popped @32k          APPROVED
goal-relative distance causes starvation    ESTABLISHED

PR-5.31a fairness causal A/B                APPROVED
fairnessEvery=16 materially relieves block   ESTABLISHED
fairnessEvery=32 positive but weaker         ESTABLISHED

“agenda starvation is complete cause
of the historical 256k MISS”                TOO STRONG — narrow wording:
                                            "Agenda starvation is the first demonstrated causal blocker
                                             on the known winning ancestry, and is sufficient to explain
                                             why bounded searches fail to recover that ancestry."

production profile change                    NOT YET
next                                         PR-5.31b end-to-end fairness validation (fairnessEvery=16)
```

### Strategic Narrative Realignment
- **5.29a (Goal-relative priority)**: Effective in preventing uncontrolled old-floor bias; retained.
- **5.29c (Local feasibility gap)**: Holds strictly for the chosen, depleted step-22 state; revoking generalization that the entire entry/universe is dead. Earlier preparation detour avoids reaching this bottleneck state.
- **5.30a / 5.30a1 (Future capability projection)**: Static arithmetic projection remains unexecutable/unreliable; confirmed.
- **5.30a2 (Bounded candidate search)**: 32k search coverage was insufficient; Case C revoked.
- **Root Cause Realignment**: Feasible paths exist inside current durable search space. Production 256k MISS is neither action omission nor entry dead-end. Agenda starvation is the first demonstrated causal blocker on the known winning ancestry.
- **Next Milestone**: **PR-5.31b (End-to-End Fairness Validation)**: Fixed `fairnessEvery=16` on same durable seed `2-7f41f60b09a55951abd8931c` at 32k budget. Track all 30 teacher suffix decisions, continuous recovery depth, and memory/frontier growth.

## PR-5.30a3 Winning Suffix Agenda Trace Results (2026-09-21)

Using the strict 59-decision TS14 witness as a teacher route, we traced the exact lifecycle (generation, enqueue, dequeue/pop, wait, and priority tuple) of all 30 teacher suffix decisions starting from `2-7f41f60b09a55951abd8931c`.

### Agenda Trace Checkpoint Table (8k vs 16k vs 32k)

| Prefix | Action | Transition | GoalDist | Control (8k) Pop / Wait | Control (16k) Pop / Wait | Control (32k) Pop / Wait |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| **1** | `battle:bat@TS13:3,2` | TS13 -> TS13 | 18 | Pop 1 / Wait 0 | Pop 1 / Wait 0 | Pop 1 / Wait 0 |
| **2** | `battle:vampire@TS13:6,2` | TS13 -> TS13 | 15 | Pop 2 / Wait 0 | Pop 2 / Wait 0 | Pop 2 / Wait 0 |
| **3** | `battle:skeletonWarrior@TS13:7,3` | TS13 -> TS13 | 13 | Pop 3 / Wait 0 | Pop 3 / Wait 0 | Pop 3 / Wait 0 |
| **4** | `battle:slimeman@TS13:8,5` | TS13 -> TS13 | 10 | Pop 5 / Wait 1 | Pop 5 / Wait 1 | Pop 5 / Wait 1 |
| **5** | `battle:slimeman@TS13:10,5` | TS13 -> TS13 | 8 | Pop 6 / Wait 0 | Pop 6 / Wait 0 | Pop 6 / Wait 0 |
| **6** | `battle:skeletonWarrior@TS13:7,7` | TS13 -> TS13 | 9 | Pop 7 / Wait 0 | Pop 7 / Wait 0 | Pop 7 / Wait 0 |
| **7** | `changeFloor@TS13:1,1` | **TS13 -> TS12** | **20** | **Pop 6647 / Wait 6639** | **Pop 6647 / Wait 6639** | **Pop 6647 / Wait 6639** |
| **8** | `battle:slimeman@TS12:9,3` | **TS12 -> TS12** | **29** | **Queued (Wait > 1352)** | **Queued (Wait > 9352)** | **Queued (Wait > 25352)** |
| **9..30** | *TS12 prep, TS11 wine, rocks, TS14* | - | 30+ | *Not reached* | *Not reached* | *Not reached* |

### Root Cause Conclusion: ESTABLISHED
1. **P1..P6 (Forward exploration in TS13, GoalDist 8~18)**: Instantly popped with wait $\le 1$.
2. **P7 (`changeFloor@TS13:1,1`, GoalDist 20)**: Enqueued at expansion 8, starved for **6,639 expansions**, popped at 6,647.
3. **P8 (`battle:slimeman@TS12:9,3`, GoalDist 29)**: Enqueued at expansion 6,648. Because `GoalDist = 29` is strictly worse than any frontier node remaining on TS13 under `compareDpAgendaRank`, **it never pops within 8,000, 16,000, or even 32,000 expansions (wait > 25,352 expansions; frontier grows to 14,093)**.
4. **Causal Verdict**: `agenda starvation = root cause` is **ESTABLISHED**. The search does not lose the route to pruning or dead seeds; it indefinitely postpones servicing the necessary detour because the detour temporarily moves further away from the goal.

---

## PR-5.31a Agenda Fairness Controlled A/B Results

We tested the Bounded Service Debt / Fairness Lane mechanism without modifying distance metrics, DP keys, candidate limits, or dominance rules:
- **Control**: `dpAgendaMode: "best-first"` (production default)
- **Treatment A**: `dpAgendaMode: "hybrid-fair"`, `fairnessEvery: 32` (1 fair pop every 32 pops)
- **Treatment B**: `dpAgendaMode: "hybrid-fair"`, `fairnessEvery: 16` (1 fair pop every 16 pops)

### 8,000 Budget A/B Matrix

| Metric | Control (Best-First) | Fairness 32 | Fairness 16 | Delta (Treatment B vs Control) |
| :--- | :---: | :---: | :---: | :---: |
| **Expansions / Budget** | 8000 / 8000 | 8000 / 8000 | 8000 / 8000 | Parity |
| **Frontier Size** | 3,551 | 4,906 | 6,614 | Healthy breadth |
| **P7 (TS13->TS12) Pop Expansion** | **6,647** | **703** | **415** | **-6,232 (-93.7% wait)** |
| **P7 Queue Wait (Service Debt)** | **6,639** | **695** | **407** | **16.3x faster service** |
| **P8 (TS12 Slimeman) Status** | Queued (unserved) | Queued (unserved) | **Popped (Step 8 reached)** | **Unlocked next step** |
| **Deepest Continuous Prefix** | Step 7 / 30 | Step 7 / 30 | **Step 8 / 30** | **+1 step ahead at 8k** |

### 16,000 Budget A/B Matrix

| Metric | Control (Best-First) | Fairness 16 | Delta / Impact |
| :--- | :---: | :---: | :--- |
| **P7 Pop Expansion** | 6,647 | **415** | Accelerated to opening expansions |
| **P8 Pop Expansion** | *Never popped (wait > 9352)* | **7,935** | **Successfully serviced at TS12** |
| **P9 (`vampire@TS12:1,10`)** | *Not reached* | **Enqueued at 7,936** | **Preparation chain advancing** |
| **Deepest Continuous Prefix** | Step 7 | **Step 8 (Step 9 enqueued)** | **Detour deadlock broken** |

**Conclusion**: Agenda Fairness successfully dissolves the detour starvation bottleneck without sacrificing goal-directed guidance.

## Outcome / publication

`VERIFIED`: saved routes valid; **resource-order counterexample and TS14 witness established**. Not independently `REVIEWED`/`ACCEPTED`; no production policy changed. Generated witness remains ignored, not a promoted fixture. Publication boundary is this audit doc and corrections/links in handoff, 5.29c and 5.30a1. Observer untracked carry remains untouched. No commit/push in this round.
