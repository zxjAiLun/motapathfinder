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
