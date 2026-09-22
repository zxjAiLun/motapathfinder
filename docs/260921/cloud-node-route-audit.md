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

## Review Verdict and Formal Hypotheses Reversal (2026-09-21 / 2026-09-22)

Following formal review of the 59-decision strict TS14 witness, agenda traces (5.30a3), fairness A/B (5.31a/b), rate probes (5.31c), and split-lane debt trials (5.31d):

```text
PR-5.31c Fair4 @32k / 64k                   APPROVED
P10 recovered @49943                        ESTABLISHED
P11 immediate greedy service                ESTABLISHED
P12 becomes new starvation boundary         ESTABLISHED
fixed-rate FIFO fairness
only moves the starvation boundary          ESTABLISHED
继续调 fairnessEvery                        STOP

PR-5.31d split debt-lane implementation     NEGATIVE / CLOSED
无配额 debt lane 会垄断 fair service         ESTABLISHED
配额化 debt lane 会拖慢原 FIFO cursor         ESTABLISHED
Q2/Q4 + tested shares 均未超过 Fair4          ESTABLISHED

PR-5.31e Single-Lane Inherited Position A/B  NEGATIVE / CLOSED
单队列继承公平位置导致子树雪崩垄断               ESTABLISHED (7,999/8,000 pops 被首批节点后代独占)
P7 在 5.31e 下严重回归饿死 (Step 6 vs Fair4 Step 9) ESTABLISHED
当前把父代古老位置复制给后代的方案正式关闭       ESTABLISHED
(5.31e 的实测证明了将古老入队位置复制给子树后代的具体方案失败；
并不构成对所有非 FIFO 调度、分层队列或有界局部切片的普遍否定。)

PR-5.31f Fair4 @ 128k Production-Viability   HIT GATE B / CLOSED
foundGoal = false                           ESTABLISHED
deepestExactTeacherPrefix = Step 11         ESTABLISHED
P12 enqueued @49945 (seq 103929), unpopped  ESTABLISHED (fairCursor 55987, gap 47942)
fixed-rate global FIFO lacks practical      ESTABLISHED
efficiency for multi-step preparation chains
No 256k escalation; no Fair2/Fair8 tuning   STOP

next                                         PR-5.32a Bounded Fair Continuation Slice A/B
```

### Strategic Narrative Realignment
- **5.29a (Goal-relative priority)**: Effective in preventing uncontrolled old-floor bias; retained.
- **5.29c (Local feasibility gap)**: Holds strictly for the chosen, depleted step-22 state; revoking generalization that the entire entry/universe is dead. Earlier preparation detour avoids reaching this bottleneck state.
- **5.30a / 5.30a1 (Future capability projection)**: Static arithmetic projection remains unexecutable/unreliable; confirmed.
- **5.30a2 (Bounded candidate search)**: 32k search coverage was insufficient; Case C revoked.
- **Root Cause Realignment**: Feasible paths exist inside current durable search space. Production 256k MISS is neither action omission nor entry dead-end. Agenda starvation is the first demonstrated causal blocker on the known winning ancestry.
- **Fairness Evolution**:
  - `best-first`: starved at P7.
  - `Fair16`: recovered P7/P8, starved at P9 (insufficient fairness throughput).
  - `Fair4`: recovered P7..P11, starved at P12 (FIFO dilution shifts boundary, does not eliminate compounding debt).
  - `Fair4 + split debt lane (5.31d)`: splitting 25% fair capacity into two lanes slowed the primary FIFO cursor, causing net regression.
  - `Fair4 + single-lane inherited position (5.31e)`: inherited queue order triggered an exponential subtree flood (7,999/8,000 fair pops monopolized by earliest nodes), drowning P7 completely (regression to Step 6).
- **Core Scientific Conclusion on Fairness Order**:
  - Proven: split debt lane steals FIFO throughput; inherited fair order causes subtree-branching flood that monopolizes fair pops.
  - Not proven: that every priority inheritance concept is mathematically impossible, or that global FIFO is universally the only valid fairness basis.
- **Three-Way Architecture Decision (Reviewer Directive)**:
  - **Route A (Fair4 128k Production-Viability Probe)**: **Active now**. Run single 128k probe on cloud1 with pure `hybrid-fair` / `fairnessEvery=4` / `fairOrderMode=fifo`. If found TS14 with strict replay PASS, Fair4 becomes production candidate without complex scheduler machinery.
  - **Route B (Two-Stage Goal Switching)**: **Held**. High risk of baking map/gem-specific knowledge into the planner; conflicts with lean generalist goals.
  - **Route C (Bounded Preparation Continuation Slice / PR-5.32a)**: **Primary fallback if Route A MISSes**. After a fair pop, grant a short, bounded local continuation episode (temporal locality of exploration) without permanent priority inheritance or queue-tail dilution.

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
| **Frontier Size** | 3,551 | 4,906 | 6,614 | Frontier expansion (+86.3%) |
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

**Conclusion**: Agenda Fairness demonstrates causal efficacy in relieving detour starvation, but fixed-ratio FIFO fairness does not guarantee bounded service wait as queue backlog grows.

---

## PR-5.31c Fair-Service Rate Sufficiency Probe (Fair4 @ 32k / 64k, executed on cloud1)

Following the reviewer's single derived treatment directive, we tested `hybrid-fair` with `fairnessEvery = 4` (25% fair share) on the same seed `2-7f41...` against Control (`best-first`) and Fair16. All runs were offloaded to `cloud1` to avoid local CPU/thermal saturation.

### 1. 32,000 Expansions 3-Way Comparison

| Metric | Control (`best-first`) | Fair16 (5.31b) | Fair4 (5.31c) | Diagnosis |
| :--- | :---: | :---: | :---: | :--- |
| **Fair Share** | 0% (greedy) | 6.25% (1/16) | **25.0% (1/4)** | 4x fair throughput |
| **Wall Time (s)** | 155.8s | 162.8s | **299.2s** | **~1.9x Control cost** |
| **Frontier Size** | 14,093 | 20,265 | **33,695** | Broadened exploration |
| **Peak RSS / Heap (MB)** | 1,688 / 1,526.4 | 1,836 / 1,663.5 | **1,427.3 / 1,275.8** | Safe vs 8GB limit (cannot infer long-horizon trend from two points) |
| **Deepest Continuous Prefix** | Step 7 / 30 | Step 8 / 30 | **Step 9 / 30** | +2 vs Control |
| **P7 (`changeFloor@TS13:1,1`)** | Pop 6,647 (Wait 6,639) | Pop 415 (Wait 407) | **Pop 143 (Wait 133)** | Earliest service |
| **P8 (`battle:slimeman@TS12:9,3`)** | Never popped | Pop 7,935 (Wait 7,519) | **Pop 1,467 (Wait 1,323)** | 5.4x faster |
| **P9 (`battle:vampire@TS12:1,10`)** | Not reached | Queued (unserved) | **Popped @ 10,651 (Wait 9,183)** | **P9 starvation relieved** |
| **P10 (`changeFloor@TS12:1,1`)** | Not reached | Not reached | **Queued @ 10,652 (Seq 21,365)** | Generated + accepted |

### 2. 64,000 Expansions Structural Probe (Fair4)

**Headline result: Reviewer Gate B scenario confirmed.**

| Metric | Fair4 @ 32k | Fair4 @ 64k | Structural Meaning |
| :--- | :---: | :---: | :--- |
| **Wall Time (s)** | 299.2s | **609.4s** | Linear-ish scaling, ~2.04x |
| **Frontier Size** | 33,695 | **58,897** | +74.8% |
| **Peak RSS / Heap (MB)** | 1,427.3 / 1,275.8 | **1,686.9 / 1,519.2** | Stable, far below 8GB solver limit |
| **Fair Cursor / Backlog** | 13,181 / 67,926 | **27,526 / 130,394** | Cursor advances ~14k per 32k budget |
| **Fair Pops / Best Pops** | 8,000 / 24,000 | **16,000 / 48,000** | Fixed 25% share |
| **Skipped Inactive / Expanded** | 1,099 / 4,192 | **3,930 / 8,060** | Stale-entry skip overhead grows |
| **Deepest Continuous Prefix** | Step 9 / 30 | **Step 11 / 30** | P10 + P11 recovered |
| **P10 (`changeFloor@TS12:1,1`)** | Queued | **Popped @ 49,943 (Wait 39,291)** | Crossed at ~50k |
| **P11 (`skeletonCaptain@TS13:9,8`)** | Not reached | **Popped @ 49,944 (Wait 0)** | **Greedy instantly served after return to TS13** |
| **P12 (`battle:bat@TS13:1,3`)** | Not reached | **Queued @ 49,945 (GoalDist 19)** | New FIFO debt boundary |

- **P10 at 64k**: The pre-run estimate was that P10 (sequence 21,365) would *likely* be crossed because cursor reached 27,526 > 21,365. This was **confirmed empirically**: P10 popped at expansion 49,943.
- **P11 instant service**: As predicted, once back on TS13, `P11 (GoalDist 6)` was popped immediately at 49,944 with **Wait 0** by the greedy best-first lane, confirming goal-relative heuristic remains effective for on-target forward progression.
- **P12 new boundary**: `P12 (GoalDist 19)` was generated at 49,945 and remained queued at 64k. Its GoalDist (19) is not close enough to win greedy competition, so it re-enters the fair FIFO lane behind ~58k active backlog entries.
- **Structural verdict**: Fixed-rate FIFO fairness **shifts the blocker deeper but does not retire service debt**. Each new prefix on the serial preparation chain must wait for another full FIFO rotation (~40k-50k expansions at 25% share). Extrapolating 30 prefixes at this rate exceeds any practical budget. **Stop `fairnessEvery` tuning.**

### 3. Cost / Benefit Realignment (per reviewer correction)
- Fair4 is **not** "negligible scheduling overhead". Its ~1.9x wall time and 2.4x frontier vs Control reflect the expected mechanism cost: stronger fairness services more distant, high-branching preparation states, generating more successors and more simulator/reachability work per expansion.
- Fair4 materially improves winning-preparation coverage, but trades higher search breadth and runtime. Production decisions must balance this explicitly.
- Peak RSS at 64k (1,686.9 MB) remains far below the production `maxRssMb = 8192` solver limit. However, two bounded points cannot establish a long-horizon memory trend; GC timing and process state materially affect peak numbers, and Fair4's lower 32k RSS vs Fair16 despite larger frontier confirms single-run RSS is noisy.

---

## PR-5.31b End-to-End Fairness Validation Results (32k & 64k)

Following reviewer guidance, we fixed `fairnessEvery = 16` (no parameter tuning sweeps) on the exact same durable seed `2-7f41f60b09a55951abd8931c` and evaluated end-to-end teacher prefix recovery against the unchanged Control (`best-first`).

### 1. 32,000 Expansions End-to-End Comparison

| Metric | Control (`best-first`) | Treatment (`hybrid-fair`, `fairnessEvery=16`) | Impact / Diagnosis |
| :--- | :---: | :---: | :--- |
| **Actual Expansions** | 32,000 / 32,000 | 32,000 / 32,000 | Identical deterministic work |
| **Wall Time (s)** | 155.8s | 162.8s | +4.5% wall overhead (negligible) |
| **Frontier Size** | 14,093 | 20,265 | +43.8% breadth expansion |
| **Peak RSS / Peak Heap** | 1,688 MB / 1,526.4 MB | 1,836 MB / 1,663.5 MB | Well within 6GB node headroom |
| **Deepest Continuous Prefix** | **Step 7 / 30** | **Step 8 / 30** (Step 9 queued) | Progress unbroken |
| **P7 (`changeFloor@TS13:1,1`)** | Pop 6,647 (Wait 6,639) | **Pop 415 (Wait 407)** | 16.3x acceleration |
| **P8 (`battle:slimeman@TS12:9,3`)** | **Never popped (Wait > 25,352)** | **Popped @ 7,935 (Wait 7,519)** | **Deadlock broken** |
| **P9 (`battle:vampire@TS12:1,10`)** | Not reached | **Queued @ 7,936 (Seq 15,693, GoalDist 30)** | Active, not rejected, not evicted |
| **First Unpopped Blocker** | Step 8 (starved) | **Step 9 (`battle:vampire@TS12:1,10`)** | Queue position 15,693 vs cursor 4,871 |

### 2. 64,000 Expansions Diagnostic on Treatment (Fairness 16)

To determine whether Step 9 (P9) was blocked by dominance/replacement or by FIFO queue throughput:
- **Expansions**: 64,000 (338.3s)
- **Frontier Size**: 33,208
- **Peak RSS / Peak Heap**: 2,636.7 MB / 2,448.7 MB (64k 范围内内存增长与更大的 active frontier 同时发生，峰值仍处于当前资源限制内，未观察到异常失控迹象)
- **Fair Cursor Progression**: Advanced from 4,871 (at 32k) to **9,355** (at 64k) out of 104,611 total fair entries.
- **Fair Pop Skips**: `skippedInactive = 1,916`, `skippedAlreadyExpanded = 3,767`.
- **P9 Status at 64k**: **`status: queued`, perfectly valid, active in skyline and fairEntries, zero rejection, zero eviction**.
- **Structural Finding**: P9 was assigned FIFO `sequence = 15,693` upon insertion at expansion 7,936. At 64k expansions, `popFair` (1 pop per 16 expansions = 4,000 fair pops) plus skipped entries advanced the cursor to index **9,355**, which had not yet reached index **15,693**.
- **Verdict**: The remaining latency is **pure FIFO queue service dilution** (because 93.75% of pops remain greedy `best-first`, continuously generating forward branches that push detour entries deeper down the shared queue). P9 encounters **zero semantic or dominance blockers**.

---

## PR-5.31d Split Debt-Lane Trial (Negative / Closed)

To address the FIFO backlog dilution where each new prefix resets to the queue tail, we implemented an inherited service-debt lane where fairly-served nodes pass their debt origin to successors with a bounded continuation quantum.

### 32,000 Expansions Diagnostic Matrix

| Configuration | Deepest Prefix | P7 Pop / Wait | P8 Pop / Wait | P9 Pop / Wait | P10 | Frontier | Cursor / Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Fair4 Baseline (5.31c)** | **Step 9** | **143 / 133** | **1,467 / 1,323** | **10,651 / 9,183** | Queued | 33,695 | 13,181 / 67,926 |
| Debt v1 (Q2, no quota) | Step 6 (regression) | Never popped | — | — | — | 36,200 | 2 / 76,310 |
| Debt v2 (Q2, share 0.5) | Step 9 | 203 / 193 | 3,067 / 2,863 | 30,491 / 27,423 | Queued | 37,314 | 7,909 / 75,650 |
| Debt v3 (Q4, share 0.25) | Step 9 | 143 / 133 | 1,771 / 1,627 | 14,019 / 12,247 | Queued | 32,694 | 11,375 / 70,385 |

### Causal Findings
1. **Uncapped debt lane causes monopoly (v1)**: Without an explicit share cap, the debt lane consumed almost 100% of fair pops (`cursor = 2 / 76,310`), starving the primary FIFO and preventing even P7 from emerging (regression to Step 6).
2. **Quota-capped debt lane slows primary FIFO (v2/v3)**: Capping debt-lane share eliminated monopoly (v3 cursor reached 11,375), but every debt pop subtracted from the primary FIFO's throughput. Because P8/P9 themselves originally required the FIFO cursor to advance, slowing the FIFO cursor delayed P8 (1,771 vs 1,467) and P9 (14,019 vs 10,651).
3. **Verdict**: Splitting the fixed 25% fair capacity into two competing lanes is counterproductive. PR-5.31d is closed as a negative result.
4. **Scope of Negative Finding**: *The tested split debt-lane formulations failed because debt service consumed the fixed fairness budget and slowed the primary FIFO service rate. Whether inherited fair position is useful without splitting fairness capacity remains open.*

---

## PR-5.31e Single-Lane Inherited Fair Position (Negative / Closed)

Rather than splitting capacity into two lanes (5.31d), we tested maintaining a **single unified fair queue** (25% share, `BinaryHeap(compareFairOrder)`) where nodes whose ancestry earned fair service inherit `effectiveFairOrder = parent.effectiveFairOrder` with a bounded continuation allowance (N=8 inherited pops per ancestry), returning to normal `enqueueSequence` once exhausted.

### 32,000 Expansions Diagnostic Comparison

| Metric | Fair4 Baseline (5.31c) | SingleLane-Inherited-Fair4 (5.31e) | Diagnosis |
| :--- | :---: | :---: | :--- |
| **Deepest Continuous Prefix** | **Step 9 / 30** | **Step 6 / 30 (severe regression)** | Starved at P7 |
| **P7 (`changeFloor@TS13:1,1`)** | **Popped @ 143 (Wait 133)** | **Never popped (Queued at end)** | Drowned by early inheritors |
| **P8 (`battle:slimeman@TS12:9,3`)** | **Popped @ 1,467 (Wait 1,323)** | Not reached | Blocked |
| **P9 (`battle:vampire@TS12:1,10`)** | **Popped @ 10,651 (Wait 9,183)** | Not reached | Blocked |
| **P10 (`changeFloor@TS12:1,1`)** | Queued @ 10,652 | Not reached | Blocked |
| **Frontier Size** | 33,695 | 32,824 | Comparable |
| **Peak RSS / Heap (MB)** | 1,427.3 / 1,275.8 | 1,455.6 / 1,307.1 | Stable |
| **Fair Pops / Best Pops** | 8,000 / 24,000 | 8,000 / 24,000 | Fixed 25% share |
| **Inherited Order Enqueued** | 0 (FIFO) | **73,735** | **Branching tree explosion** |
| **Inherited Order Pops** | 0 (FIFO) | **7,999 / 8,000 (99.99%)** | **Complete monopoly** |
| **Inherited Order Resets** | 0 | 257 | Allowances exhausted |
| **Wall Time (s)** | 299.2s | 295.9s | Parity |

### Causal Mechanism: Tree-Branching Avalanche in Inherited Order
1. **Exponential Fanout Flood**: In a branching search tree with branching factor $b > 1$, granting an inherited order (e.g. order 4 at expansion 4) causes every successor branch down $N$ generations to inherit that ancient order. Across $N=8$ generations, $1 + b + b^2 + \dots + b^N$ entries (here **73,735 enqueued nodes**) all shared tiny orders ($\le 8$).
2. **Breadth-First Inversion**: Because all these 73,735 descendant entries carry orders $\le 8$, they bubble to the top of the fair min-heap ahead of P7 (which has normal enqueue order 10).
3. **Monopoly**: **7,999 out of 8,000 fair pops (99.99%)** were consumed exclusively by the subtrees of the very first fair-popped nodes from expansions 4 and 8. The single fair queue devolved from breadth-first FIFO fairness into a depth-first traversal of the earliest fair-popped subtrees.
4. **Definitive Conclusion**: The idea of "inheriting an ancient queue position/debt" across tree branches is fundamentally incompatible with fairness. Whether split-lane (5.31d) or single-lane (5.31e), priority inheritance causes an exponential descendant flood that drowns all subsequently enqueued states.
5. **Architectural Ruling**: The tested implementation of copying ancient queue positions to child subtrees failed catastrophically due to branching-factor cascade. While this refutes the specific priority-inheritance scheme, it does not mathematically prove that all non-FIFO or local-slice fairness designs are invalid.
6. **PR-5.31f Directive**: Proceed immediately with **Route A (Fair4 @ 128k on cloud1)** as a single, decisive engineering viability test of the pure, simple `hybrid-fair` mechanism. If TS14 is found and strict-replayed, Fair4 advances to production profile validation. If 128k MISSes, stop budget expansion and pivot to **Route C (PR-5.32a Bounded Preparation Continuation Slice)**.

---

## PR-5.31f Fair4 Production-Viability Probe (128k on cloud1)

Executed on `cloud1` with `dpAgendaMode="hybrid-fair"`, `fairnessEvery=4` (25% fairness share), `fairOrderMode="fifo"`, budget **128,000 expansions**.

### Quantitative Results & Diagnostics

| Metric | Measured Value | Notes / Interpretation |
| :--- | :---: | :--- |
| `foundGoal` | **false** | No TS14 goal found |
| `deepestExactTeacherPrefix` | **Step 11 / 30** | Step 11 (`skeletonCaptain@TS13:9,8`) popped at exp 49,944 |
| `totalPopped` | 11 / 30 | Exactly same continuous prefix depth as 64k |
| `totalQueued` | 1 | Only P12 is active and unserved |
| **P12 Status** | **queued (unpopped)** | `battle:bat@TS13:1,3` (GoalDist 19) |
| P12 `enqueuedAt` (expansions) | 49,945 | Enqueued immediately after P11 greedy pop |
| P12 `sequence` (FIFO ordinal) | **103,929** | Position in `fairEntries` queue |
| P12 `serviceDebt` | **47,942 positions** | `fairCursor` at 55,987 vs sequence 103,929 |
| P12 Queue Wait | **>78,055 expansions** | Never served from 49,945 to 128,000 |
| Next Popped Prefix | *none* | P12 is the first unpopped prefix |
| Next Queued-Unserved Prefix | **P12 (Step 12)** | Blocker for all downstream P13..P30 |
| `fairCursor` | **55,987** | Advanced 55,987 slots in `fairEntries` |
| `fairQueueLength` | **246,847** | Active unexpanded: 103,849 |
| `fairPops` / `bestPops` | 32,000 / 96,000 | Strict 1:3 pop ratio maintained |
| `skippedInactive` | 8,677 | Dominated / dead skyline entries |
| `skippedAlreadyExpanded` | 16,007 | Best-first popped entries |
| `frontierSize` | **103,849** | Broad exploration frontier |
| `peakRssMb` / `peakHeapUsedMb`| **2,167.9 MB / 1,936.0 MB** | Well within 8,192 MB limit |
| `wallMs` | **1,372.2s (~22.9 min)** | Cloud ARM64 execution |

### Teacher Prefix Status at 128,000 Expansions

| Step | Action | Transition | Status | Enqueued | Popped | Wait | GoalDist |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `battle:bat@TS13:3,2` | TS13 -> TS13 | popped | 1 | 1 | 0 | 18 |
| 2 | `battle:vampire@TS13:6,2` | TS13 -> TS13 | popped | 2 | 2 | 0 | 15 |
| 3 | `battle:skeletonWarrior@TS13:7,3` | TS13 -> TS13 | popped | 3 | 4 | 1 | 13 |
| 4 | `battle:slimeman@TS13:8,5` | TS13 -> TS13 | popped | 5 | 6 | 1 | 10 |
| 5 | `battle:slimeman@TS13:10,5` | TS13 -> TS13 | popped | 7 | 8 | 1 | 8 |
| 6 | `battle:skeletonWarrior@TS13:7,7` | TS13 -> TS13 | popped | 9 | 9 | 0 | 9 |
| 7 | `changeFloor@TS13:1,1` | TS13 -> TS12 | popped | 10 | 143 | 133 | 20 |
| 8 | `battle:slimeman@TS12:9,3` | TS12 -> TS12 | popped | 144 | 1,467 | 1,323 | 29 |
| 9 | `battle:vampire@TS12:1,10` | TS12 -> TS12 | popped | 1,468 | 10,651 | 9,183 | 30 |
| 10 | `changeFloor@TS12:1,1` | TS12 -> TS13 | popped | 10,652 | 49,943 | 39,291 | 20 |
| 11 | `battle:skeletonCaptain@TS13:9,8` | TS13 -> TS13 | popped | 49,944 | 49,944 | 0 | 6 |
| 12 | `battle:bat@TS13:1,3` | TS13 -> TS13 | queued | 49,945 | - | - | 19 |
| 13..30 | *Downstream preparation & rocks* | - | not-reached | - | - | - | - |

### Causal Mechanism & Structural Conclusion (Gate B Hit)

1. **Service Rate vs Backlog Growth**:
   - In 128,000 expansions, 32,000 fair pops combined with 24,684 skips advanced the `fairCursor` by **55,987 positions** (an effective advance rate of ~0.437 queue slots per total expansion).
   - Because of branching, by expansion 49,945 (when P11 popped and P12 was enqueued), the FIFO queue length had reached **103,929**.
   - At expansion 128,000, `fairCursor` reached only 55,987, still **47,942 positions behind P12**.
   - Reaching P12 under Fair4 would require approximately $\frac{103,929 - 55,987}{0.437} \approx 110,000$ additional expansions (total ~238,000 expansions).
2. **Compounding Serial Backlog Dilution**:
   - Even if P12 popped at ~238k expansions, P13 would be enqueued into a queue that by then exceeded 450,000 items, requiring another ~500,000 expansions.
   - For a 30-step strategic preparation chain, pure fixed-rate global FIFO incurs a compounding queue wait at every single non-greedy transition.
3. **Verdict**:
   - **Gate B is Hit**: Pure Fair4 with fixed-rate global FIFO does not possess practical engineering efficiency for autonomous multi-step preparation chains within reasonable production budgets.
   - **Stop Policy Enforced**: No escalation to 256k, no tuning to Fair2 or Fair8.
   - **Immediate Strategic Pivot**: Proceed to **Route C (PR-5.32a Bounded Fair Continuation Slice)**.

## Outcome / publication

`VERIFIED`: saved routes valid; **resource-order counterexample and TS14 witness established**. Not independently `REVIEWED`/`ACCEPTED`; no production policy changed. Generated witness remains ignored, not a promoted fixture. Publication boundary is this audit doc and corrections/links in handoff, 5.29c and 5.30a1. Observer untracked carry remains untouched. No commit/push in this round.
