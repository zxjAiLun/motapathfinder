# PR-4.5c State Abstraction Collision Inventory

Status: **completed**

This is a shadow-only inventory. It reads existing MT1/MT2 JSON artifacts and reuses the PR-4.5b3 bounded runner; it does not modify production DP state keys, dominance, agenda, capacity, or default policy.

- source artifacts: **2**
- states scanned: **40**
- collision groups: **12**
- exact-distinct pairs: **12**
- pairs selected: **8**
- pairs skipped by cap: **4**
- search: depth **2**, branch cap **32**, state cap **256**

## Sources

| Source | SHA256 matches manifest | States | Collision groups | Pair cap |
|---|---:|---:|---:|---:|
| mt2-candidate2-natural-search-audit | true | 20 | 5 | 4 |
| mt2-candidate2-capacity10-j | true | 20 | 7 | 4 |

## Selected pair outcomes

| Pair | Group | Outcome | Risks (true) |
|---|---|---|---|
| pair-285e93d1eb45542d | collision-1981d0728653eb7b | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-3e9e2b6efe518b63 | collision-65d161c7f079815f | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-56d844bfe57f58b0 | collision-1981d0728653eb7b | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-5aec405522f8963c | collision-525cbdbf6523c718 | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-76ff53ff129974eb | collision-3736d53c669215b6 | equivalent | nonCurrentFloorMutationDiff, crossFloorActionAvailable, exactRejoinObserved |
| pair-98b621afcd564561 | collision-1aeddbf2e6765b01 | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |
| pair-be97aba6dbc5ee0a | collision-3736d53c669215b6 | equivalent | nonCurrentFloorMutationDiff, crossFloorActionAvailable, exactRejoinObserved |
| pair-d89f7f8e0655b590 | collision-525cbdbf6523c718 | mismatch-witness | nonCurrentFloorMutationDiff, crossFloorActionAvailable |

## Fixed candidate-6/7 control

- candidate-6-7-local-control: **equivalent**, expected **equivalent**, pair **pair-136b0c9d130a22b3**

## Verdict

- selected outcome counts: **{"equivalent":2,"mismatch-witness":6,"incomplete":0}**
- fixed candidate-6/7 control equivalent: **true**
- any incomplete selected pair: **false**
- production semantic change: **false**

An equivalent bounded result is evidence for the selected real-corpus pairs and configured budget only; it is not a global proof of projection safety.

## Provenance

- manifest: **shared-solver\profiles\state-abstraction-mining-sources.json**
- generation commit: **2b66846baf8a22d0da23cdd5cd68ef80c64834e8**
- relation evaluator: **bounded-abstraction-counterexample-search.runPairedExpansion**
