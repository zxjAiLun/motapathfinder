# PR-4.5b2 Bounded Abstraction Counterexample Search

Status: **completed**
Positive corpus outcome: **equivalent**
Negative control outcome: **mismatch-witness**

## Scope

This artifact is shadow-only. It does not modify the production DP key, dominance, agenda, capacity, or default strategy.

- manifest: **shared-solver\profiles\state-abstraction-corpus.json**
- bounded depth: **2**
- relation checks: **shared-prefix depths 0 through 2, inclusive**
- branch cap: **32**
- state cap: **256**

## Positive corpus

| Corpus | Fixed positive | Roots | Outcome | Incomplete roots |
|---|---:|---:|---|---:|
| candidate-6-7-decision-14-20 | true | 7 | equivalent | 0 |

### candidate-6-7-decision-14-20

- replay errors: **0**
- candidate keys match ancestry artifact: **true**
- candidate-6-7-decision-14-20@decision-14: **equivalent**, expanded pairs **37**, generated pairs **37**, multi-successor actions **0**, cross-product pairs **36**
- candidate-6-7-decision-14-20@decision-15: **equivalent**, expanded pairs **27**, generated pairs **27**, multi-successor actions **0**, cross-product pairs **26**
- candidate-6-7-decision-14-20@decision-16: **equivalent**, expanded pairs **34**, generated pairs **34**, multi-successor actions **0**, cross-product pairs **33**
- candidate-6-7-decision-14-20@decision-17: **equivalent**, expanded pairs **24**, generated pairs **24**, multi-successor actions **0**, cross-product pairs **23**
- candidate-6-7-decision-14-20@decision-18: **equivalent**, expanded pairs **16**, generated pairs **16**, multi-successor actions **0**, cross-product pairs **15**
- candidate-6-7-decision-14-20@decision-19: **equivalent**, expanded pairs **10**, generated pairs **10**, multi-successor actions **0**, cross-product pairs **9**
- candidate-6-7-decision-14-20@decision-20: **equivalent**, expanded pairs **10**, generated pairs **10**, multi-successor actions **0**, cross-product pairs **9**

## Negative controls

| Control | Outcome | Depth | Witness sequence | First unmatched |
|---|---|---:|---|---|
| synthetic-reentry-hidden-mutation-v1 | mismatch-witness | 1 | reenter-MT1 | historical-tile@MT1 |
| synthetic-reentry-depth-boundary-v1 | mismatch-witness | 2 | reenter-MT1 → enter-history-zone | historical-tile@MT1 |
| synthetic-off-diagonal-successor-v1 | mismatch-witness | 1 | branch | off-diagonal-mismatch |

The negative controls intentionally omit hidden mutation history from their projections. The witnesses confirm both an immediate re-entry mismatch and a mismatch first exposed at the configured depth boundary.

## Verdict

- positive candidate-6/7 corpus: **equivalent**
- negative control: **mismatch-witness**
- depth-boundary control witness: **true**
- any budget-incomplete run: **false**
- production semantic change: **false**

A bounded equivalent result is evidence for this manifest, depth, and budget only; it is not a proof that the projection is safe globally.

## Provenance

- generation commit: `38977238307a7cf18632b3e02428320ff0055458`
- production state-key SHA256: `f5be4802f9926744bc8e91f30ecb8ab8b09ab73057fdef7ceaa44ddbbec808a5`
