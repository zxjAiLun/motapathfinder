# PR-4.5c1 State Abstraction Collision Inventory

Status: **completed**

This is a shadow-only inventory. It reads existing MT1/MT2 JSON artifacts and reuses the PR-4.5b3 bounded runner; it does not modify production DP state keys, dominance, agenda, capacity, or default policy.

- source artifacts: **2**
- states scanned: **40**
- collision occurrences: **12**
- unique collision signatures: **7**
- duplicate signature occurrences: **5**
- exact-distinct pairs: **12**
- selected pair occurrences: **8**
- selected unique signatures: **5**
- repeated selected signatures: **3**
- pairs skipped by cap: **4**
- unique signatures skipped by cap: **3**
- search: depth **2**, branch cap **32**, state cap **256**

## Sources

| Source | SHA256 matches manifest | States | Occurrences | Unique signatures | Pair cap |
|---|---:|---:|---:|---:|---:|
| mt2-candidate2-natural-search-audit | true | 20 | 5 | 5 | 4 |
| mt2-candidate2-capacity10-j | true | 20 | 7 | 7 | 4 |

## Selected pair outcomes

| Pair | Group | Outcome | Risks (true) |
|---|---|---|---|
| pair-11cec6a5f310031c | occurrence-c71b42f739f3372f | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-130c13a9af1762d4 | occurrence-795d4bf97484ddc2 | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-49f587da8e0c8c54 | occurrence-ea97de6b89731723 | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-5bc2408a0ea338e4 | occurrence-8dad8dacc9ed379c | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-5bee390b0cf25ff2 | occurrence-eb861b415eab0de8 | equivalent | nonCurrentFloorMutationDiff, crossFloorActionAvailable, exactRejoinObserved |
| pair-6ced6eb6087fc42c | occurrence-1b2ab894fe0b15b9 | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-a1d7bd817cb51d1f | occurrence-742c9e9020b6974c | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-d34460544b8e66ff | occurrence-3c5ed53a4315754c | equivalent | nonCurrentFloorMutationDiff, crossFloorActionAvailable, exactRejoinObserved |

## Fixed candidate-6/7 control

- candidate-6-7-local-control: **equivalent**, expected **equivalent**, pair **pair-02d64376fd4f33c5**

## Verdict

- selected outcome counts: **{"equivalent":2,"mismatch-witness":6,"incomplete":0}**
- selected risk-strata denominator: **8**
- fixed-control risk-strata denominator: **1**
- fixed candidate-6/7 control equivalent: **true**
- any incomplete selected pair: **false**
- production semantic change: **false**

An equivalent bounded result is evidence for the selected real-corpus pairs and configured budget only; it is not a global proof of projection safety.

## Provenance

- manifest: **shared-solver\profiles\state-abstraction-mining-sources.json**
- generation commit: **6fdd3658678982763828f9f21bc1f07de4e6b2be**
- relation evaluator: **bounded-abstraction-counterexample-search.runPairedExpansion**
