"use strict";

// PR-5.31h gate: restoreRuntimeSnapshotStart must be AUTHORITATIVE for start
// flags. After restore the runtime's representable flags must equal exactly the
// snapshot's flags (not runtime-Start boot flags merged with snapshot
// overrides). Engine-internal flags are preserved; autoBattle is owned by the
// separate automation step. This is a pure-function contract test over
// restoreStartFlags / isRepresentableReplayFlag; the live 59-step witness
// replay is the integration gate (run separately).

const assert = require("node:assert/strict");
const {
  restoreStartFlags,
  isRepresentableReplayFlag,
} = require("./lib/live-replay");

// Project a restored runtime flag map to what captureRuntimeSnapshot would
// compare (representable flags only). This must match the snapshot's flags.
function representableProjection(flags) {
  const result = {};
  for (const [key, value] of Object.entries(flags || {})) {
    if (isRepresentableReplayFlag(key, value)) result[key] = value;
  }
  return result;
}

function main() {
  // Case 1: runtime Start boot flag (shop1) absent from snapshot must NOT leak.
  // This is the exact production symptom; the fix must not special-case shop1.
  {
    const runtime = { shop1: 1, saltygreen: 2, jc19f5: 1, nowatk: 1, nowlevel: 1, shiqu: 1 };
    const snapshot = { saltygreen: 2, jc19f5: 1, nowatk: 1, nowlevel: 1, shiqu: 1 };
    const restored = restoreStartFlags(runtime, snapshot);
    assert.deepEqual(representableProjection(restored), snapshot,
      "G1 FAIL: representable projection after restore must equal snapshot flags exactly");
    assert.equal(representableProjection(restored).shop1, undefined,
      "G1 FAIL: shop1 must not survive into the representable projection (cleared, not merged)");
  }

  // Case 2: snapshot flags are preserved; engine-internal flags are preserved.
  {
    const runtime = { __seed__: 12345, __step__: 7, __leaveLoc__: { Start: { x: 6, y: 1, direction: "down" } } };
    const snapshot = { saltygreen: 2, jc19f5: 1, __leaveLoc__: { TS11: { x: 6, y: 1, direction: "down" } } };
    const restored = restoreStartFlags(runtime, snapshot);
    assert.deepEqual(representableProjection(restored), snapshot,
      "G2 FAIL: snapshot flags (incl. __leaveLoc__) must be preserved exactly");
    assert.equal(restored.__seed__, 12345, "G2 FAIL: engine-internal __seed__ must be preserved");
    assert.equal(restored.__step__, 7, "G2 FAIL: engine-internal __step__ must be preserved");
    // __leaveLoc__ is representable, so the snapshot value must win over runtime.
    assert.deepEqual(restored.__leaveLoc__, snapshot.__leaveLoc__,
      "G2 FAIL: representable __leaveLoc__ must take the snapshot value");
  }

  // Case 3: same-named flag with different values -> snapshot value wins.
  {
    const runtime = { saltygreen: 9, jc19f5: 5, extra: 3 };
    const snapshot = { saltygreen: 2, jc19f5: 1 };
    const restored = restoreStartFlags(runtime, snapshot);
    assert.equal(restored.saltygreen, 2, "G3 FAIL: snapshot value must win on shared key saltygreen");
    assert.equal(restored.jc19f5, 1, "G3 FAIL: snapshot value must win on shared key jc19f5");
    assert.equal(representableProjection(restored).extra, undefined,
      "G3 FAIL: runtime-only 'extra' must be cleared");
    assert.deepEqual(representableProjection(restored), snapshot,
      "G3 FAIL: representable projection must equal snapshot exactly");
  }

  // autoBattle is intentionally excluded from the contract (owned by the
  // automation-configuration step); restore must not assert it.
  {
    const runtime = { autoBattle: 1, shop1: 1 };
    const snapshot = { saltygreen: 2 };
    const restored = restoreStartFlags(runtime, snapshot);
    assert.equal(restored.autoBattle, 1, "autoBattle must be left untouched by flag restore");
    assert.equal(representableProjection(restored).shop1, undefined, "shop1 must still be cleared even alongside autoBattle");
    assert.equal(isRepresentableReplayFlag("autoBattle", 1), false, "autoBattle is not part of the flag contract");
  }

  // Empty / missing inputs are safe.
  {
    assert.deepEqual(restoreStartFlags(undefined, undefined), {}, "empty inputs must yield {}");
    assert.deepEqual(representableProjection(restoreStartFlags({ shop1: 1 }, {})), {}, "no snapshot flags clears representable runtime flags");
  }

  // Idempotence: restoring an already-authoritative state is a no-op on the
  // representable projection.
  {
    const snapshot = { saltygreen: 2, jc19f5: 1, __leaveLoc__: { TS11: { x: 6, y: 1, direction: "down" } } };
    const once = restoreStartFlags({}, snapshot);
    const twice = restoreStartFlags(once, snapshot);
    assert.deepEqual(representableProjection(twice), snapshot, "idempotence FAIL");
  }

  console.log("PASS replay-start-state-contract: restore is snapshot-authoritative (runtime boot flags cleared without special-case; engine-internal flags preserved; snapshot wins on shared keys; autoBattle owned by automation step)");
}

main();
