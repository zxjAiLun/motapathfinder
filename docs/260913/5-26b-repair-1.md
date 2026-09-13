# PR-5.26b Repair 1 - CP9 Registration-Time Queue Attribution

```ini
MILESTONE = PR-5.26b Repair 1
STATUS = IMPLEMENTED / OBSERVED / BOTTLENECK_COMPOSITION_IDENTIFIED
DATE_STARTED = 2026-09-13
BASE_COMMIT = 95aafcc (PR-5.26b)
SCOPE = Diagnostic only. Enqueue-time telemetry plus one registration-time attribution run.
SEARCH_POLICY_CHANGE = NONE
CAP_CHANGE = NONE
BUDGET_CHANGE = NONE
```

## Authorization

Owner ruling on `95aafcc`:

```ini
95aafcc = APPROVED_WITH_NARROW_DIAGNOSTIC_CORRECTION
PR_5_26B_PHASE_0 = PASS
CP9 = REGISTERED, RETAINED, UNEXPANDED
GLOBAL_COVERAGE_LIMITATION = NOT_ESTABLISHED
S_B_NEUTRAL_SCHEDULING_LATENCY = PLAUSIBLE, NOT_ESTABLISHED_BY_CURRENT_CUT
LATE_GENERATION_CUT_6967 = RETRACT_AS_CLASSIFICATION_BOUNDARY
NEXT = PR_5_26B_REPAIR_1_REGISTRATION_TIME_QUEUE_ATTRIBUTION
```

## The retracted boundary

PR-5.26b classified cp#9 as `S_B` by projecting the **end-of-run** backlog (300) at the **whole-run** average neutral service rate (0.2905) and subtracting from 8000, giving a "late generation cut" of 6967.

That computation answers *"how much longer would the residual queue take to drain starting from expansion 8000?"*. It cannot answer *"was cp#9 registered early enough when it entered at 5958?"*, because the queue state and the service counters **at registration time** were never recorded. The basis for the boundary was therefore missing, and the owner retired it:

```ini
LATE_GENERATION_CUT_6967 = RETRACT_AS_CLASSIFICATION_BOUNDARY
CP9_REGISTERED_AT_EXPANSION = 5958_OF_8000
CP9_LATE_GENERATION = NOT_YET_ISOLATED
END_SNAPSHOT_PROJECTED_DRAIN_AT_WHOLE_RUN_AVERAGE_SERVICE_RATE = kept as a metric, no longer a boundary
```

## Phase 1 - enqueue-time telemetry

`lib/transport-collapse.js`:

- A new generic `enqueued` lifecycle event, emitted immediately after `neutralQueue.push(child.id)` - the moment the candidate becomes schedulable, and the point at which every node registered in an **earlier** iteration already has its final `guidedAdmitted`/`combatProgress`.
- Fields: `neutralHeadAtEnqueue`, `neutralQueueAbsoluteIndexAtEnqueue`, `liveNeutralAheadAtEnqueue`, `liveAheadByRank{0,10,20,30}`, `liveAheadGuidedAdmitted`, `liveAheadCombatProgress`, `guidedExpansionsAtEnqueue`, `neutralExpansionsAtEnqueue`, `strategicExpansionsAtEnqueue`.
- `rank20ParetoDominatedAtEnqueue` is deliberately **not** emitted: no trim has classified the group at that moment, so any value would be fabricated. The artifact records the omission explicitly.
- The child's own class is emitted as `rankClassBeforeGuidedAdmission`, not `rankClass`: `guidedAdmitted` is assigned in the frontier branch *after* enqueue, so at that instant every child is still pre-admission. Naming it exactly avoids a number that reads like a final rank but is not. The `liveAheadByRank` figures are unaffected because those nodes are final.

Two supporting changes keep this from disturbing search:

- `pendingRank()`'s logic was extracted into a pure `rankClassOf()`; `pendingRank()` now delegates to it and caches, so the two can never drift, and telemetry reads a class **without** mutating `node.rankValue`.
- `pending` is mirrored into an opt-in `Set` (`livePendingIds`) created only when `emitEnqueueTelemetry` or `emitPendingSnapshot` is set. When it is `null` the three guarded update sites are no-ops, so **every capability run is byte-for-byte unchanged**. `buildPendingSnapshot()` cross-checks the mirror against `pending.length` and reports `pendingMirrorConsistent` rather than silently trusting it - observed `true`.

Telemetry is pure observation: no oracle input, no writes to ranking, retention, scheduling or termination.

## Phase 2 - the observation

`npm run audit:pr526b:scheduling-latency`, same frozen workload as PR-5.26b (fixed 8000 expansions, `MAX_RUNTIME_MS = 0`, cap 1024, region MT1..MT4, goal MT4, dynamic Pareto ON). Two runs were **identical on every field including the full pending snapshot**.

### Registration-time queue - the quantity PR-5.26b was missing

```ini
CP9_REGISTERED_AT_EXPANSION             = 5958_OF_8000
CP9_PRE_TRIM_LIVE_AHEAD                 = 1027
POST_RETENTION_EXACT_COUNT_AT_THAT_MOMENT = NOT_MEASURED
AHEAD_BY_RANK_AT_REGISTRATION           = {0: 0, 10: 118, 20: 907, 30: 2}
PRE_TRIM_RANK20_AHEAD                   = 907
AHEAD_GUIDED_ADMITTED_AT_REGISTRATION   = 118
AHEAD_COMBAT_PROGRESS_AT_REGISTRATION   = 984
neutralHeadAtEnqueue = 2014   absoluteIndex = 3041
guidedExpansions = 3974   neutralExpansions = 1984
```

cp#9 did **not** enter behind a 300-deep queue. It entered behind a **1027-deep** queue - essentially the entire cap. And that queue was **907 rank-20 / 118 rank-10 / 2 rank-30**.

**Wording correction (owner review of `fe817e4`).** The 1027 is an **enqueue-time, pre-trim** snapshot: the cap is 1024 and the trim runs after an expansion has registered all its children, so `pending` may briefly exceed the cap. Describing these 907 as already-retained survivors is therefore wrong:

```ini
CP9_PRE_TRIM_LIVE_AHEAD = 1027
PRE_TRIM_RANK20_AHEAD = 907
POST_RETENTION_EXACT_COUNT_AT_THAT_MOMENT = NOT_MEASURED
"ALL_907_WERE_ALREADY_RETENTION_SURVIVORS" = NOT_ESTABLISHED
RANK20_DOMINATED_BACKLOG = ROBUSTLY_OBSERVED   # direction unaffected
S_A_S_B_S_C = RETIRED_FOR_THIS_DIAGNOSIS
GLOBAL_NEUTRAL_RATE_PROBLEM = NOT_ESTABLISHED
```

The conclusion is unaffected: the over-cap excess is small, the end snapshot is still `239/300 = 80%` rank-20, and rank-30 goes from 2 at registration to 0 at the end.

### Wait window

```ini
CP9_AHEAD_AT_END                        = 300
AHEAD_REMOVED_DURING_WAIT               = 727
NEUTRAL_EXPANSIONS_DURING_WAIT          = 340
GUIDED_EXPANSIONS_DURING_WAIT           = 1702
OBSERVED_AHEAD_DRAIN_PER_STRATEGIC_EXPANSION = 0.35602   # window-local
whole-run neutral service rate          = 0.2905
END_SNAPSHOT_PROJECTED_DRAIN_AT_WHOLE_RUN_AVERAGE_SERVICE_RATE = 1032.7
```

727 candidates ahead of cp#9 were removed during its 2042-expansion wait, while only 340 neutral expansions occurred in that window - so a large share of that drain came from cap eviction and from guided-lane expansions rather than from neutral service.

### End-snapshot composition of what was still ahead

```ini
END_AHEAD_TOTAL            = 300
END_AHEAD_BY_RANK          = {0: 0, 10: 61, 20: 239, 30: 0}
END_AHEAD_GUIDED_ADMITTED  = 61
END_AHEAD_COMBAT_PROGRESS  = 280
```

```ini
CP9_REGISTERED_WITH_BACKLOG      = true
CP9_BACKLOG_DRAINED_PARTIALLY    = true
CP9_BACKLOG_DRAINED_FULLY        = false
CP9_STILL_AHEAD_AT_END           = true
CP9_LATE_GENERATION              = NOT_YET_ISOLATED
```

Queue state at end: `livePendingTotal = 1023/1024`, `liveNeutralPending = 1023`, `guidedHeapLiveCount = 274`, `pendingMirrorConsistent = true`.

## The finding

The owner's pre-registered decision tree had three branches, keyed on what the backlog ahead actually was. The data lands cleanly in the third:

```ini
AHEAD_IS_MOSTLY_RANK10_GUIDED     = NO   (118 at registration, 61 at end)
AHEAD_IS_MOSTLY_RANK30_ORDINARY   = NO   (2 at registration, 0 at end)
AHEAD_IS_MOSTLY_RANK20            = YES  (907 at registration = 88%, 239 at end = 80%)
COMBAT_PROGRESS_SCHEDULING_BACKLOG = OBSERVED
```

Ordinary neutral exploration is **not** what blocks cp#9 - there are 2 such candidates at registration and none at the end. What blocks it is a deep backlog of **combatProgress rank-20 investment candidates that retention (PR-5.25x/5.26a) deliberately keeps alive and that the scheduler then serves in pure FIFO age order**.

That is a materially different diagnosis from "the neutral lane is too infrequent". It is also, at least partly, a consequence of the fix: PR-5.25x/5.26a made rank-20 combatProgress candidates survive cap pressure (PR-5.26a alone rescued 3149 in the fixed-work A/B), and they now dominate the pending pool and queue behind one another.

## What this establishes, and what it does not

Established:

- cp#9 entered at expansion 5958 behind 1027 pre-trim live candidates, of which 907 were rank-20 combatProgress - the pending pool was effectively full and rank-20-dominated.
- It was served `false` by the guided heap, waited 2042 expansions, and still had 300 live candidates ahead (239 rank-20) when the budget ended.
- The enqueue telemetry is deterministic and its opt-in mirror agrees with `pending` (`pendingMirrorConsistent = true`).

**Not** established:

- **No causal claim that a rank-20 scheduling change would fix MT4.** The composition of the backlog is now known; that serving cp#9 earlier would have reached MT4 is still unproven.
- **No verdict at all on S-A/S-B/S-C.** `CP9_LATE_GENERATION = NOT_YET_ISOLATED`. This round reports facts and deliberately asserts no label.
- No judgement on whether 1027-deep is "too deep", or on what the correct rank-20 scheduling policy should be. `NEUTRAL_EVERY` was not touched.
- MT4 remains a MISS. No capability claim.
- The 727 "removed during wait" figure is not decomposed between neutral service, guided-lane expansion and cap eviction.

## Next step (STOP_AND_RETURN)

Return for review. The owner pre-registered that if the backlog turned out to be dominated by rank-20 combatProgress candidates, a *within*-rank-20 scheduling policy may be the topic - but explicitly deferred authorizing it, and listed `RANK20_SCHEDULER_PRIORITY_YET` under `NO` for this round. This round measured only.

Not authorized: `NEUTRAL_EVERY` change, `COMBAT_PROGRESS_TO_GUIDED`, rank-20 scheduler priority, cap or budget change, chain depth, magnitude weight, frontier patch, planner, backtracking.
