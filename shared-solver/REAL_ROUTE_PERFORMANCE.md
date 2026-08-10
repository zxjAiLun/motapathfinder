# Real-route performance qualification

The MT1 `hero.exp >= 9` workload remains a micro correctness test. It is useful
for pinned A/B output, strict replay, and key-phase attribution, but its 116
expansions are not evidence for whole-solver performance.

## Test tiers

### Micro correctness

```bash
npm run check:candidate-key-smoke
```

The smoke performs exactly one production rollback solve and one guarded MT1
candidate solve. Those same two runs provide correctness, runtime strict replay,
and gross performance diagnostics. It does not repeat a second performance pair.

Qualification keeps four search-only samples in `A/B/B/A` order:

```bash
npm run check:candidate-key-paired-benchmark
```

### Tracked route checkpoints

`check-real-route-performance-qualification.js` replays tracked routes only to
construct trusted checkpoints. Search after the checkpoint is fresh branching
milestone DP; it does not follow teacher actions.

```bash
npm run check:real-route-performance-contract
npm run bench:real-route:mt2-mt3
npm run bench:real-route:mt4-manual
npm run bench:real-route:mt4-best
```

The registered fixtures are:

- `routes/fixtures/mt1-mt2-hp3834.route.json`
- `routes/fixtures/mt1-mt3-i893-hp8425.route.json`
- `routes/fixtures/mt1-mt4-hp4459-atk421-def318-mdef5012.route.json`
- `routes/fixtures/mt1-mt4-hp6428-best.route.json`

Every run reports search wall time, expansions, generated and accepted states,
dominance rejections, reachability calls/time/cache deltas, enumerate/apply/key
time, sampled memory, final hero, and offline strict recorded-decision replay.
Use separate single-side invocations for authoritative memory comparisons because
serial A/B runs share one Node process.

### Long horizon

```bash
npm run bench:real-route:long
```

This explicitly enables the MT3 I893 checkpoint to MT5 blueKing milestone chain.
It is not part of fast CI. A miss or budget stop is reported as
`INCOMPLETE_WITHIN_BUDGET`; it is never evidence that no route exists.

## Promotion boundary

Side A uses the production region key. Side B injects the existing
`without-start-component` builder through the research `dpStateKeyBuilder` hook.
The production `resolveDpKeyProfile` guard remains pinned to approved MT1:

- implicit MT2-MT5 scopes fall back to `production-region`;
- explicit `experimental-mt1-tower-ir-v1` fails closed;
- benchmark results never change the default profile or certify MT2-MT5.

## Initial local evidence

These Windows observations are directional, not pinned cross-machine timing:

| Case | Fixed work | A wall | B wall | B/A | Reachability A/B | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| MT2 hp3834 -> MT3 I893 | completed at 20 expansions | 2.84s | 2.29s | 0.81 | 38 / 28 | exact state + route parity |
| manual MT4 -> MT5 entry | 100 expansions | 27.92s | 10.61s | 0.38 | 274 / 108 | exact state + route parity |
| best MT4 -> MT5 entry | 47-expansion probe | 10.34s | 5.65s | 0.55 | 117 / 48 | exact state + route parity |

The MT4 data strengthens the conclusion that the candidate removes redundant
reachability work outside the original exp9 micro case. It still does not prove
general candidate-key safety or an overall solver speedup. The dominant absolute
cost remains walk reachability: even 100 expansions can take tens of seconds.

## Safe walk reachability fast path

Walk reachability now defaults to `safe-fast`, with `legacy-exact` as an explicit
rollback. The fast path is eligible only when the current state has no poison,
direction-sensitive tool, live auto event, movement hazard, custom step hook, or
stability-probe mutation. Every rejected or failed probe uses the original exact
step simulator. The DP key, dominance, agenda, action policy, and route selection
are unchanged.

Focused parity and fallback controls:

```bash
npm run check:walk-reachability-fast-path
```

Independent-process route comparison:

```bash
npm run bench:walk:mt4:compare
```

The comparison fixes candidate side B and 100 expansions on the tracked manual
MT4 checkpoint to MT5 entry workload. It requires exact final state, route
fingerprint, strict replay, and search-scale parity; timings are directional and
not pinned as a cross-machine correctness gate. The pre-change baseline at
`f55fc7c` was run three times at 8.97s / 10.25s / 10.22s (median 10.22s), with
108 reachability computations consuming 7.34s / 8.40s / 8.35s. Use the command
above for the current same-machine safe-fast versus explicit rollback result.

On the same machine, three independent safe-fast processes completed in 4.86s /
3.05s / 2.82s (median 3.05s), while reachability consumed 1.16s / 0.72s /
0.64s (median 0.72s). Against the three-run pre-change medians, that is a 3.35x
wall-clock speedup and an 11.66x reachability speedup. A separate paired run of
the explicit modes measured 12.78s versus 2.53s wall time (5.05x) and 10.60s
versus 0.57s reachability time (18.72x). All runs preserved 100 expanded / 302
generated / 212 accepted states, final exact-state fingerprint
`451f12da1f9e7ca8`, route fingerprint
`a2f663af8623113f8e99502f0d4925a8c141fedf281bf179b69871b9aecaa15b`, and
strict replay. The safe-fast runs used 91 static builds and conservatively fell
back to 17 exact builds after entering live-auto-event territory.

## Goal-directed first-feasible intent

`first-feasible` is an explicit speed-oriented search intent for callers that
need the first route satisfying the configured milestone. It combines
goal-directed agenda ordering with `stopOnFirstGoal=true`. The default remains
`skyline`; changing the intent is a caller-visible tradeoff and is not an
optimization-proof mode.

```bash
npm run bench:goal-directed:mt4:default
npm run bench:goal-directed:mt4:first-feasible
npm run check:goal-directed-search
```

On the tracked MT4 checkpoint to MT5 entry workload, three alternating
independent rounds measured the same-first-goal baseline at 1.11s / 0.75s /
0.76s (median 0.76s) and `first-feasible` at 0.76s / 0.68s / 0.59s (median
0.68s). Goal-directed ordering reached the milestone at expansion 17 instead
of 49, generated 69 instead of 108 actions, and accepted 65 instead of 93
states. The wall-time median improved by 1.11x under identical first-goal stop
semantics. Compared with the normal 100-expansion skyline median of 3.05s, the
explicit first-feasible intent returns a qualifying route about 4.49x sooner,
but it intentionally returns a different qualifying route rather than the
best route retained after the full budget. Both routes pass strict replay.

The MT2 checkpoint to MT3 control is stronger: both intents retain exact final
state and route fingerprints while goal-directed ordering reduces aggregate
work from 20 to 16 expansions and from 37 to 34 generated actions. Timing is
directional and is never a correctness gate.
