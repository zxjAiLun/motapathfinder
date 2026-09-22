# Cloud production / experiment takeover audit

```ini
STATUS = VERIFIED
LIVE_REPLAY_STATUS = BLOCKED
DATE_STARTED = 2026-09-22
BASE_COMMIT = e9d637db78c3e2a6b357256f76115a5d37e94d56
SCOPE = Verify cloud1 production identity, completed Fair4 128k evidence, route feasibility, and the next solver development gate
```

## Request and publication boundary

Owner requested a project-progress and cloud1 production/experiment comparison, manual route reasoning, failure attribution, and a development plan; subsequently asked the main session to take over. No subagents. Do not start/restart production, migrate the journal, overwrite a release, change pruning/defaults, or launch another long search in this audit.

Existing carry at entry: modified `20260804handoff.md`, `docs/260921/cloud-node-route-audit.md`, `shared-solver/lib/dp-search.js`; untracked `tools/motapath-observer-mcp/`. Preserve it. Audit publication: this document and a short correction at the top of handoff. Generated evidence stays in ignored `shared-solver/routes/generated/260922-cloud-progress-audit/`. No commit/push.

## Initial questions and gates

1. Identify 8787 UI, search service, probe scripts, actual code hashes, configuration and current process state separately. A release directory name is not an immutable code identity.
2. Read all current journal attempts and the already-completed PR-5.31f report; do not rerun 128k merely because handoff still calls it the next step.
3. Revalidate the authored TS14 witness against the frozen production simulator, distinguishing schema validation, internal strict replay, and browser/live replay. A witness is not autonomous discovery or five-floor completion.
4. Audit observer field semantics before declaring an exact prefix active/evicted or a causal cause of every failed route. Budget MISS is not impossibility.
5. Propose one bounded next capability gate, separate from deployment/provenance repair and performance work. No map-specific oracle input in future autonomous A/B.

## References

- [Prior node / route audit and Fair4 gates](../260921/cloud-node-route-audit.md)
- [PR-5.31a](../260921/5-31a.md)
- [Cloud operations](../operations/cloud-search.md)
- [Documentation contract](../project-documentation-system.md)

## Iteration 1 — takeover findings

- Local `dev == origin/dev == e9d637d`, remote ref checked. Existing carry preserved.
- 8787 uses release `20260921-progress-flags-967749e` and reads `runs/neko-zero-key`. Search service is inactive, journal paused; no active search/probe process observed.
- Journal: 133 attempts, 8,320,697 expansions, 43 entries (still only TS11–TS13), 20 pending; no final route.
- Existing `probes/pr531f/results/Fair4-128k-128000-report.json`: 128,000 expansions, `foundGoal=false`, deepest popped exact prefix 11, frontier 103,849, wall 1,372.191s, peak RSS 2,167.9MiB / heap 1,936MiB. No advance beyond the 64k prefix boundary. `stoppedReason:null` is the raw DP field; normalized outcome was omitted by the harness, not evidence of completion.
- P12 was inserted at 49,945 and no pop was recorded by 128k. The harness does not subscribe to evictions/rejections or prove end-of-run liveness of this particular node, so its final `queued` label is weaker than an exact active-membership check.
- Cloud search-release `lib/dp-search.js` hash equals local dirty code (`33457b4c91f26205eee38862cf5aac17466dca3eb5cec82516fcd19b52a03f78`), not committed HEAD (`c7fb193ad5e50451c7bf3a6c...`). This is evidence of mutable release contents; full fingerprint check is pending. No attempt to resume this directory.
- `check-route-record.js --route-file=...` passed (59 decisions): schema only. A browser replay was mistakenly pointed at Onlyup; it failed on missing TS11 floor (`defaultGround`). This is a wrong-project invocation, not evidence against the Neko route. Correct-project/internal replay remains to be verified.

## Iteration 2 — verified identity, replay and evidence corrections

### Actual code versus release labels

Read-only remote fingerprint evaluation at `2026-09-22T03:34:44Z`:

| Identity | Journal | Current release contents |
| --- | --- | --- |
| Problem | `0ca7d0b09e97dac015a8dc36e14988764b52185ae2ed5d63e3db8a3d6e0dec78` | same |
| Resume | `a3f4f1b5f025c220b05bddd0a4cb212e5cd6a24b4bfdc430bcb9182be575f51a` | `3aecbd54071e681b6ba6b58f9532b14218f8703ba5fe1aa757da05721c3d9909` |
| Execution | `1bb0c3328e8a01a839a3743a73e0fde9697ac99bba26ac6d252d6ae0a6fc1f63` | `229f60d456c8ecdaec2e3f03bdca35e8e020de32382ff16b0597d763c84e2cdf` |

Calling `recoverJournal` on an **in-memory copy** refuses with `SEARCH_SEMANTICS_DRIFT`. No server state was modified. Do not bypass this protection or resume the old directory as if it were the old baseline.

The previously extracted local `260921-cloud-node-audit/releases/...` directory was also modified; comparing against it initially showed no differences. Therefore re-extracted the original `snapshot.tar.gz` into a new generated `frozen/` directory. Archive SHA256 is still `8c318a37940ef332e5af245216862f8805a1ed6102fd3b36c8bf511569589e56`, and its solver resume fingerprint exactly matches the journal. Current cloud `lib/` differs from this archive only in `dp-search.js` (current files compared by hash). Original DP hash `c7fb193ad5e50451c7bf3a6ce6a911c1e20fc07f32bf34ccc222dadb9dc77239`; current dirty/cloud hash `33457b4c91f26205eee38862cf5aac17466dca3eb5cec82516fcd19b52a03f78`. Directory labels alone cannot certify experimental provenance.

Production versus experiment controls are **not identical in all respects**:
- Durable `runAttempt`: goal-relative best-first; does **not** forward `dpAgendaMode`/`fairnessEvery`; heap stop `floor(6144 * .85) = 5222 MiB`; configured time limit; action-provider errors fail the attempt.
- Probe: calls `searchDP` directly, hybrid-fair/Fair4/FIFO, heap stop 6144MiB, wall limit 0, exact-key observer. Neither memory nor wall stopped the observed 128k probe, but it is not a complete production A/B.
- `run-cloud-probe.js` reads the witness to identify checkpoints; the observer does not use them to rank/filter actions. Simulator/target setup occurs before search, so an unobserved clean-process control remains desirable for timing/cache parity.
- **Additional reproducible identity defect**: changing only `config.dpPriorityMode` from `goal-relative` to `resource-first` leaves `resumeSearchFingerprint` unchanged. The function hashes budgets/candidate limit but omits this effective search option. Future config plumbing must fingerprint every effective search option and test invalidation.

### PR-5.31f evidence, not promotion

Report SHA256 `9629c5b1c25b6a90a79d43465a376b836c4b476545611fb641fefd9539dbb83e`, mtime `2026-09-22T02:16:34.382Z` (10:16 Shanghai). Read without rerunning a search.

| Metric | Fair4 64k (previous report) | Fair4 128k |
| --- | ---: | ---: |
| Deepest popped exact suffix checkpoint | 11 | **11** |
| P12 inserted | 49,945 | 49,945 |
| P12 pop | absent | absent |
| Active frontier | 58,897 | 103,849 |
| Wall seconds | 609.4 | 1,372.191 |
| Peak RSS MiB | 1,686.9 | 2,167.9 |
| FIFO cursor / ever-enqueued | 27,526 / 130,394 | 55,987 / 246,847 |

No TS14, no route export; known-prefix boundary did not advance when work doubled. Raw `stoppedReason` is null because DP reports ordinary work-budget exhaustion via `searchOutcome` / `expansionBudgetExhausted`; the harness fails to save these. Here `expansions == budget` and live frontier establish a bounded, incomplete MISS.

Observer limitations requiring correction before the next experiment:
1. `candidateGenerated` contains the **parent** state's exact key. The probe matches it against target **post-state** keys; `generatedAt` is consequently not the successor's generation time. P12's `generatedAt:null` alongside a valid insertion is one manifestation. Use insertion as successor-acceptance evidence, not this field as first generation.
2. Probe subscribes to neither `skylineEvicted` nor `candidateRejected`; `queued` means inserted without a later observed pop, **not proven still-active at termination**. The cursor's failure to reach P12's insertion position supports a service-delay explanation, but does not certify its exact liveness.
3. No equivalent-DP-key/higher-HP representative trace, observer-error count, normalized outcome, first-goal time, or replayed goal route is saved. Exact teacher-prefix length is a diagnostic, not the definition of solving.
4. `skippedInactive` and `skippedAlreadyExpanded` are incremented by **both** best and fair pops. They cannot all be added to fair pops to derive cursor movement. `agendaRank.sequence` and `fairQueueOrdinal` should also be kept distinct.

Under the pre-existing 128k gate this is **NOT_PROMOTED**. Do not keep tuning fairnessEvery or spend another larger budget as the immediate next step. This does not prove all FIFO/non-FIFO schedulers impossible, nor that the entire search made no other progress.

### Route verification and manual reasoning

`reverify-witness.js` passed twice: original archive/journal-matched simulator and current solver against the same tower. Requires recorded fingerprint match, checks all 59 pre/post exact keys, re-applies actions rather than accepting cached resolved post-states, and invokes full route reconstruction plus internal strict replay. Both: TS14 / HP5609 / ATK12 / DEF1 / Lv3 / EXP19 / greenKey34; zero protected-key decreases.

The central resource-order counterexample remains intact: take TS12 +1 ATK before the DEF6 TS13 skeletons. HP temporarily falls 1960→795, but the improved order saves 2900 HP overall, yielding 14601 before the first rock instead of 11701. Rock damage is 14036, so the +25600 HP behind `rock@TS13:7,9` is collectible only after surviving with 565 HP. At this same prepared state the three immediately available rock choices have different consequences:
- `(7,9)` → HP26165 / ATK9 (large potion);
- `(11,3)` → HP2165 / ATK10 (gem but poor immediate survival margin);
- `(11,7)` → HP565 / ATK9 (no comparable reward).

This is an executable dependency-order problem, not a need to label all backward movement good or all rocks bad.

**New bounded manual extension (not autonomous)**: starting from the verified TS14 entry, choose `rock@9,10`, `rock@7,10`, free `steelDoor@4,10`, `slimeman@8,9`, `slimeman@8,8`. From original start, 64-decision full internal strict replay passes; TS14 HP727/ATK14/DEF1/Lv3/EXP25/greenKey34. No TS15 found. At this state immediate enumerated actions only return to TS13. By contrast taking nearby `zombieKnight@11,9` first gives HP2669/ATK13 and also only return actions. These two sequences are diagnostic examples, not exhaustive entry feasibility/optimality tests. The free door was not shown necessary; this is not a minimized route.

**Browser/live replay remains BLOCKED**, not PASS. Correct Neko project fails before decision 1: `initial.flags.shop1: type mismatch (undefined !== number)`. Evidence locates `shop1=1` in `project/floors/Start.js`; `restoreRuntimeSnapshotStart` overlays supplied flags but does not remove boot-only flags. This supports a startup-restoration contamination diagnosis, not a battle-route failure. Do not silence the comparison or add arbitrary flags to the recorded route. Requires a focused restore contract fix and fresh live replay before claiming real-runtime certification.

### Where cloud compute is currently spent

Current journal TS13→TS14: **84 attempts / 7,004,303 expansions**, 83 budget stops + one graceful cancellation, none with a goal. Whole journal remains 133 / 8,320,697.

On known-feasible seed's production 256k attempt: 1,444,028 generated successors, 995,760 rejected (68.96%); 785,989 same-HP/not-shorter rejects (54.43% of generated); portals 512,000 (35.46% of generated), of which 397,390 rejected (77.62%). These are optimization opportunities, not permission to delete actions or merge direction/flag-distinct states.

The durable scheduler restarts each tier from its checkpoint. Sum of per-checkpoint maximum work for TS13 entries = 4,508,303 versus actual 7,004,303; the difference 2,496,000 (35.64%) quantifies the tier-repeat opportunity **if** deterministic prefixes and controls match. It is not a measured unique-state overlap nor a guaranteed speedup. True frontier resume must save nodes/parents, DP authority, agenda ordering, counters and identity, not just the most promising hero state.

## Development order and gates

1. **Immediate prerequisite: reproducible execution/evidence contract.** Preserve this old journal and original archive. Put future experiments in separately hashed directories/new run IDs; no overwrite or automatic journal migration. Correct effective-option fingerprint coverage, profile plumbing and observer outcome/liveness reporting. Test same-config identity stability and changed-option rejection, source/pre/post semantics, negative controls and observer OFF/ON deterministic parity. Resolve live initial-state contamination separately before real-runtime route claims.
2. **Next capability candidate: PR-5.32a bounded preparation continuation.** Design only in this audit. Keep canonical DP key/dominance/action generator; retain FIFO and greedy service; permit a bounded local exploration episode from a fairly serviced node. The episode shares one **total active-expansion budget across the whole subtree**; children do not each receive a fresh/decremented depth budget. No nested renewal, inherited ancient queue position, oracle coordinates or independent unsound DP authority. Pending descendants remain globally eligible. Local ranking must not simply repeat the same global goal-distance starvation. Exact global budget accounting and fair-service shares must be predeclared.
3. Test that candidate first on synthetic branching/temporary-regression cases, then matched work **and** matched wall on cloud1 against Fair4. Primary success = independently discovered TS14 + original-start strict replay; teacher coverage is secondary. Fixed representative other seeds/towers check generalization. Do not select quantum repeatedly against P12. If no end-to-end gain at the frozen gate, record negative and stop that formulation, not another scheduler tuning ladder.
4. **Performance after a sound baseline:** profile enumeration/reachability, battle estimates, state clone/key, queue and observation/memory sampling. Cache only pure computations with complete dependency keys; route/state/expanded-count parity plus strict replay are gates. Measure portal duplicate effects before any equivalence contraction. Never infer that 69% rejected means 69% avoidable compute.
5. **Cloud productization:** queued experiment jobs with immutable code/config hashes, append-only attempt evidence and separate production/experimental/oracle panels; checkpoint continuation rather than repeated shallow restarts where proven compatible. On this 2-core host keep memory-bounded scheduling, not many competing full-RSS workers. Optimize verified progress per core-hour, not cumulative expansions or frontier size.

## Verification ledger and boundaries

- `git ls-remote origin refs/heads/dev`: local/remote e9d637d at entry.
- `systemctl --user show ...`, `/api/status`, process list: UI active, search paused, no running probe observed.
- Remote `inspect-cloud-identity.js` over `node -` stdin: read-only; identity drift reproduced on cloned journal, problem unchanged.
- Original archive hash and re-extracted resume identity: match original journal.
- `node .../reverify-witness.js`: exit 0, two complete 59-step exact replays.
- `node shared-solver/check-route-record.js --route-file=...`: exit 0, 59 decisions (schema only).
- `manual-extension.js` five authored actions with `VERIFY_MANUAL=1`: exit 0, 64-decision internal strict replay.
- Correct Neko `verify-route-live.js`: exit 1 before decision 1, shop1 mismatch; unresolved product gate, tracked separately.
- No new search, solver implementation, default change, service control, key/pruning edit, journal write, commit or push in this audit.

Audit facts above are **VERIFIED**, not independently ACCEPTED or a claim that live tests pass. PR-5.31f remains a bounded negative/non-promotion. Immediate next authorized work is the prerequisite execution/evidence contract, followed by a separately frozen capability design; not production restart.
