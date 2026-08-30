# Frozen Iteration-5 qualification harness (byte-identical to local .tmp-*)

- `qualify-iteration5.js` — orchestrator (OFF/ON 3+3 sequence, fresh process per run)
- `qualify-iteration5-run.js` — single-run child (frozen config: 30s/50k/256MB-260/depth3/limit8)

## SHA256 (must match local frozen versions and the copies executed in CI)

```
qualify-iteration5.js      83147509769EE830D758556514E530C56BD189F21135B18A9A62FA34CF1F1285
qualify-iteration5-run.js A006AAD5FA02822C91B0090BE24651C4AE5187862B009871D1B410E6AFB649E1
```

`run-qualification.js` is a thin CI wrapper: it verifies the SHA256 of the two
frozen harness files, copies them byte-for-byte back to
`shared-solver/.tmp-qualify-iteration5{,-run}.js`, and executes them. It also
implements the authorized Stage-1 environment gate (one OFF smoke; PASS iff no
rss-limit, no heap-limit, processTreePeakMb < 250, unknownCompletion == 0) and
Stage-2 (the frozen 3+3 sequence). No solver files or experiment configuration
are modified on this branch.

Base commit: `7d67cc75e2c2c57b16721fbd50122e114f6b5a8b` (dev).
Qualification conclusions are NOT committed on this branch — only evidence
artifacts (uploaded via GitHub Actions artifacts) pending cloud review.
