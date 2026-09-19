# PR-5.25y Repair 1 - Rank20 Drop Composition Capture

```ini
MILESTONE = PR-5.25y Repair 1
STATUS = IMPLEMENTED / CP9_DROP_CLASSIFIED_CASE_B_RANK20_SATURATION
DATE_STARTED = 2026-09-13
BASE_COMMIT = 29ee879 (5.25y closure)
FINAL_COMMIT = this milestone commit (see handoff)
SCOPE = Narrow observational telemetry repair (pureFill vs FIFO-head displacement) plus one fixed-work 8,000-expansion observation run; no search policy change
```

## Authorization

Owner ruling on `29ee879`:

```ini
0550892 = APPROVED
29ee879 = APPROVED_WITH_NARROW_P2_TELEMETRY_REPAIR
PR_5_25Y_PHASE_1 = PASS
CP9_CAUSAL_CRITICALITY = ESTABLISHED
CP8_TO_CP9 = OBSERVED_MULTI_STEP_RESOURCE_PREPARATION_CHAIN
"LARGEST_SINGLE_INVESTMENT_IN_PREFIX" = NOT_ESTABLISHED_BY_CURRENT_AUDIT
PR_5_25Y_PHASE_2 = INCONCLUSIVE_WITHIN_2000_EXPANSIONS
COMBAT_PROGRESS_RANK20 = KEEP
SEARCH_POLICY_CHANGE = NONE
NEXT = PR_5_25Y_REPAIR_1_RANK20_DROP_COMPOSITION_CAPTURE
REPAIR_1 = DISTINGUISH_PURE_FILL_DROP FROM_FIFO_HEAD_DISPLACEMENT
PHASE_2B = FIXED_WORK_8000_EXPANSIONS / SAME_MT4_POLICY / CAP1024 / NO_WALL_LIMIT / 2048MB_RSS / OBSERVATION_ONLY
IF_CP9_FATE_OBSERVED = CLASSIFY_A_B_C_D / RETURN_FOR_REVIEW
IF_CP9_FATE_NOT_OBSERVED_BY_8000 = STOP / RETURN_FOR_REVIEW
```

## The telemetry hole being repaired (P2)

The 5.25y trim telemetry computed `rank20CutoffPendingSeq` on the **final `keep`** set, i.e. *after* FIFO-head protection may have displaced a node. That makes two mechanically different events produce the same signature:

```text
rank20 candidate  +  dropped  +  seq <= cutoff
```

which could be either (a) a normal pure-fill insertion loss, or (b) a node the pure fill **did** admit and head protection then evicted. The second is a *designed consequence* of the FIFO guarantee, not a retention anomaly, but the old telemetry could not separate them. Waiting for a longer run and then reading an ambiguous snapshot would have wasted the run.

## Repair 1: observational only

`shared-solver/lib/transport-collapse.js` now emits, on the drop path, the sets the trim already computed — `pureFill` (what `(rank, insertion)` alone admits) and `keep` (pureFill plus head protection):

```ini
pureFillKept = pureFill.has(droppedId)
displacedByFifoHeadProtection = pureFillKept && !keep.has(droppedId)
olderRank20PendingCount = rank20 entries with pendingSeq < droppedNode.pendingSeq   (only when pureFillKept = false)
```

and on the trim composition:

```ini
pureFillRankCounts, pureFillRank20CutoffPendingSeq, pureFillKeptCount, finalKeepCount
fifoHeadId, fifoHeadProtectedThisTrim, fifoHeadDisplacedIds, pureFillRank20Ids
rank0PlusRank10Pending, rank20CapacityUnderPureFill, rank20PendingCount
```

```ini
SEARCH_BEHAVIOUR_CHANGE = NONE
RETENTION_ORDER_CHANGE = NONE
SCHEDULER_CHANGE = NONE
CAP_CHANGE = NONE
FRONTIER_CHANGE = NONE
OBSERVER_READ_ONLY = TRUE (inertness micro still passes)
```

## Mechanistic Case A/B/C/D classifier

Replaces the earlier fuzzy "rank10 fills most of the cap" reading:

```ini
CASE_A_HIGHER_RANK_EXHAUSTION   = rank0 + rank10 >= cap
CASE_B_RANK20_SATURATION        = rank0 + rank10 < cap
                                  AND rank20Pending > rank20CapacityUnderPureFill
                                  AND pureFillKept = FALSE
CASE_C_FIFO_HEAD_DISPLACEMENT   = pureFillKept = TRUE
                                  AND displacedByFifoHeadProtection = TRUE
CASE_D_UNEXPECTED               = none of the above
```

Case D exists so an unclassifiable trim is reported as unexpected rather than silently forced into A, B, or C.

## Micro coverage (both branches pinned)

`check:bounded-retention-contract` extended; all PASS.

- **Starvation scenario (cap=6)** pins **Case C**: `pending = {0:0, 10:6, 20:0, 30:1}`, `rank0+rank10 = 6 = cap`, so the pure fill kept all six rank-10 nodes; head protection then evicted one of them (`fifoHeadDisplacedIds = [8]`) to keep the rank-30 head. Reported as `pureFillKept = true`, `displaced = true`. Under the **old** telemetry this node showed the exact ambiguous signature above.
- **Combat-progress scenario (cap=2)** pins **Case A/B-style pure-fill drop**: both dropped neutrals report `pureFillKept = false`, `displaced = false`, `fifoHeadDisplacedIds = []`, with `rank0+rank10 = 1 < cap = 2` and `rank20CapacityUnderPureFill = 1`.

Two wrong predictions were made while writing these assertions and were corrected by the micros (first guessing the starvation drop was a pure-fill drop, then guessing no older rank-20 peer existed). Both are preserved here as the reason the micros exist rather than trusting the reading.

## Phase 2B: fixed-work observation

```ini
PR_5_25Y_REPAIR_1_PHASE_2B = AUTHORIZED
MAX_EXPANSIONS = 8000
MAX_RUNTIME_MS = 0          # wall time CANNOT truncate
MAX_RSS_MB = 2048
PENDING_CAP = 1024
GOAL = MT4                  # region MT1..MT4, rank chaos
SEARCH_POLICY = EXACTLY_CURRENT (no change this round)
THIS_IS_NOT_A_QUALIFICATION_RUN = TRUE
CAPABILITY_CLAIM_FROM_THIS_RUN = NONE
```

Rationale for 8,000 rather than a 180 s wall limit: the earlier MT4 full run already observed cp#9's drop within 7,174 expansions. 8,000 is a fixed-work budget that deterministically crosses a *known* observation point; a wall-clock run would instead measure machine speed.

Command:

```bash
node audits/flat-search/audit-pr525y-cp9-causality-saturation.js --phase2b --out=routes/generated/pr525y-phase2b-cp9-trim.json
```

## Result: CP9_DROP_CLASSIFICATION = CASE_B_RANK20_SATURATION

```ini
found = false
strategicExpansions = 8000 (expansion-limit)
candidatesDropped = 8226
deepestReachedFloorOrdinal = 3 (MT3)
fifoHeadProtected = 0
wall = 103,883 ms (run 1) / 97,827 ms (run 2)
cp9Fate = dropped
cp9EventCount = 6
oracle-key drop trims observed = 1 (exactly cp#9)
```

The trim that dropped cp#9:

```ini
pendingRankCounts = {0:0, 10:119, 20:907, 30:2}
pureFillRankCounts = {0:0, 10:119, 20:905, 30:0}
keptRankCounts = {0:0, 10:119, 20:905, 30:0}
fifoHeadDisplacedIds = []

rank0PlusRank10Pending = 119          < cap 1024        => NOT Case A
rank20PendingCount = 907
rank20CapacityUnderPureFill = 905     (1024 - 119)
rank20Overflow = 2
cp9.pendingSeq = 13029
pureFillRank20CutoffPendingSeq = 13025                  => cp#9 is BEYOND the cutoff
olderRank20PendingCount = 906                           => 906 rank-20 peers admitted first
```

Reading: at this trim the higher classes were far from exhausting the cap (119 of 1024). rank20 was eagerly admitted — 907 pending against 905 slots — and cp#9 sat two places beyond the pure-fill boundary, behind **906** earlier rank-20 candidates. cp#9 was therefore dropped by the ordinary `(rank, insertion)` fill, **not** by FIFO-head displacement and not by any lifecycle anomaly.

```ini
CP9_DROP_CLASSIFICATION = B_RANK20_SATURATION
CP9_DROP_CAUSE = PURE_FILL_INSERTION_LOSS_AMONG_RANK20_PEERS
CP9_DROPPED_BY_FIFO_HEAD_DISPLACEMENT = FALSE
CP9_RETENTION_LIFECYCLE_ANOMALY = FALSE
```

Repeatability: run twice with identical counts (8000 / 8226 / 151,177 events / same trim arithmetic / same classification). Wall time differed by ~6 s while every determinism-relevant quantity matched, confirming the fixed-work design decouples the observation from machine speed.

## What this answers and what it does not

Answers the owner's question: **rank20 is internally saturated.** The class that recognized cp#9 admitted 907 candidates into 905 slots, and cp#9 lost on insertion order among its own peers. The binary rank-20 class therefore **is** too coarse for cp#9 — the distinction that would save it is *within* rank20, not between rank20 and rank10 or rank20 and neutral.

Explicitly **not** established:

- Whether "older = more valuable" holds generally. `olderRank20PendingCount = 906` says cp#9 lost to earlier admissions; it says nothing about whether those 906 are more or less valuable than cp#9.
- That a chain-depth or magnitude dimension would fix it. Two rank-20 slots were lost at this trim; any replacement rule would need its own justification and is not authorized.
- Any capability claim. `found = false`, and the run is an observation run, not a qualification run.
- That cp#9 is reached at MT3-level depth in a way that generalizes; this is one trajectory.

## Non-claims and boundaries

- One fixed-work run repeated twice; no capability qualification, no repeatability claim beyond the identical counts above.
- `COMBAT_PROGRESS_RANK20 = KEEP`. Nothing in this round changes retention.
- `NO = CHAIN_DEPTH_PRIORITY, COMBAT_PROGRESS_MAGNITUDE_WEIGHT, HP_TO_STAT_RATIO, RANK20_PARETO, THRESHOLD_TUNING, EXP_ONLY_PROMOTION, CAP_INCREASE, FRONTIER_PATCH, PLANNER, BACKTRACKING, MT5_OR_MT8` — none were attempted.
- `fifoHeadProtected = 0` in this run: the FIFO-head guarantee was never exercised here, so this run says nothing about head protection under real load. The Case C micro is the only evidence that branch works.

## Verification

```ini
npm run check:bounded-retention-contract   PASS (both branches pinned)
npm run check:transport-collapse -- --smoke  6/6 micros pass; LOCAL_GATE FAIL is the pre-existing 5.25l-era gate (fails identically on the unmodified tree)
npm run check:changefloor-identity-parity   PASS
npm run check:strategic-poi-identity-parity  PASS
npm run check:strict-replay:phase0  PASS
npm run check:route-store-exact  ok
npm run check:manifest  166 modules / 206 graded tests
npm run check:no-tower-solver-js  PASS
```

## Next step (STOP_AND_RETURN)

Return for review. The open decision: whether rank20 needs an internal value distinction, and if so which one. No replacement rule, no chain-depth priority, and no further observational runs are self-authorized.
