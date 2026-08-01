# PR-4.5b Bounded Abstraction Counterexample Search

Status: **completed**
Positive corpus outcome: **equivalent**
Negative control outcome: **mismatch-witness**

## Scope

This artifact is shadow-only. It does not modify the production DP key, dominance, agenda, capacity, or default strategy.

- manifest: **shared-solver\profiles\state-abstraction-corpus.json**
- bounded depth: **2**
- branch cap: **32**
- state cap: **256**

## Positive corpus

| Corpus | Fixed positive | Roots | Outcome | Incomplete roots |
|---|---:|---:|---|---:|
| candidate-6-7-decision-14-20 | true | 7 | equivalent | 0 |

### candidate-6-7-decision-14-20

- replay errors: **0**
- candidate keys match ancestry artifact: **true**
- candidate-6-7-decision-14-20@decision-14: **equivalent**, expanded pairs **7**, generated pairs **37**
- candidate-6-7-decision-14-20@decision-15: **equivalent**, expanded pairs **6**, generated pairs **27**
- candidate-6-7-decision-14-20@decision-16: **equivalent**, expanded pairs **7**, generated pairs **34**
- candidate-6-7-decision-14-20@decision-17: **equivalent**, expanded pairs **6**, generated pairs **24**
- candidate-6-7-decision-14-20@decision-18: **equivalent**, expanded pairs **5**, generated pairs **16**
- candidate-6-7-decision-14-20@decision-19: **equivalent**, expanded pairs **4**, generated pairs **10**
- candidate-6-7-decision-14-20@decision-20: **equivalent**, expanded pairs **3**, generated pairs **10**

## Negative controls

| Control | Outcome | Depth | Witness sequence | First unmatched |
|---|---|---:|---|---|
| synthetic-reentry-hidden-mutation-v1 | mismatch-witness | 1 | reenter-MT1 | historical-tile@MT1 |

The negative control intentionally omits all mutation history from its projection. The witness confirms that a shared re-entry action can expose a hidden-history action-set mismatch.

## Verdict

- positive candidate-6/7 corpus: **equivalent**
- negative control: **mismatch-witness**
- any budget-incomplete run: **false**
- production semantic change: **false**

A bounded equivalent result is evidence for this manifest, depth, and budget only; it is not a proof that the projection is safe globally.

## Provenance

- generation commit: `76cecf7eecdd7a30ff5f7a4458d6eebd7ae162c7`
- production state-key SHA256: `f5be4802f9926744bc8e91f30ecb8ab8b09ab73057fdef7ceaa44ddbbec808a5`
