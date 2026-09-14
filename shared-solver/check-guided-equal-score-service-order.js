"use strict";

/**
 * PR-5.26e Phase 2 / PR-5.26f Phase 1 - guided equal-score service order.
 *
 * Locks BOTH contracts:
 *
 *   LEGACY (stableGuidedTieBreak = false)
 *     equal scores are equivalent, so the binary heap's array mechanics decide
 *     the order. This is the pre-5.26f behaviour and must stay byte-identical.
 *
 *   STABLE (stableGuidedTieBreak = true)
 *     equal scores are ordered by `pendingSeq` ascending, i.e. registration
 *     order. Still a tie-break only - a higher score always wins.
 */

const assert = require("assert");
const { guidedHeapPush, guidedHeapPop, guidedComesBefore } = require("./lib/transport-collapse");

function drain(heap, stable) {
  const ids = [];
  for (let entry = guidedHeapPop(heap, stable); entry; entry = guidedHeapPop(heap, stable)) ids.push(entry.id);
  return ids;
}

/** Entries are labelled A, B, C... and assigned pendingSeq in insertion order. */
function entries(labels, scores) {
  return labels.map((id, index) => ({
    id,
    score: scores && scores[id] != null ? scores[id] : 100,
    pendingSeq: index,
  }));
}

function build(list, stable) {
  const heap = [];
  for (const entry of list) guidedHeapPush(heap, entry, stable);
  return heap;
}

function main() {
  // --- LEGACY contract (pre-5.26f, unchanged) ---
  const legacyOrder = drain(build(entries(["A", "B", "C", "D"]), false), false);
  assert.deepStrictEqual(legacyOrder, ["A", "D", "C", "B"], "legacy equal-score order changed");
  assert.notDeepStrictEqual(legacyOrder, ["A", "B", "C", "D"]);

  const legacyHeap = build(entries(["A", "B", "C"]), false);
  const legacyInterleaved = [guidedHeapPop(legacyHeap, false).id];
  for (const entry of entries(["D", "E"]).map((e, i) => ({ ...e, pendingSeq: 3 + i }))) {
    guidedHeapPush(legacyHeap, entry, false);
  }
  legacyInterleaved.push(...drain(legacyHeap, false));
  assert.deepStrictEqual(legacyInterleaved, ["A", "C", "E", "D", "B"], "legacy interleaved order changed");

  // --- STABLE contract (PR-5.26f) ---
  const stableOrder = drain(build(entries(["A", "B", "C", "D"]), true), true);
  assert.deepStrictEqual(stableOrder, ["A", "B", "C", "D"], "stable equal-score order is not registration order");

  const stableHeap = build(entries(["A", "B", "C"]), true);
  const stableInterleaved = [guidedHeapPop(stableHeap, true).id];
  for (const entry of entries(["D", "E"]).map((e, i) => ({ ...e, pendingSeq: 3 + i }))) {
    guidedHeapPush(stableHeap, entry, true);
  }
  stableInterleaved.push(...drain(stableHeap, true));
  assert.deepStrictEqual(stableInterleaved, ["A", "B", "C", "D", "E"], "stable interleaved order is not FIFO");

  // --- Higher score always wins, with or without the flag ---
  for (const stable of [false, true]) {
    const high = drain(build(entries(["A", "H", "B"], { H: 101 }), stable), stable);
    assert.strictEqual(high[0], "H", `higher score must be served first (stable=${stable})`);

    // "new high" must overtake "old low": this is a tie-break, not a plain FIFO.
    const overtake = drain(build(entries(["LOW", "HIGH"], { LOW: 100, HIGH: 101 }), stable), stable);
    assert.deepStrictEqual(overtake, ["HIGH", "LOW"], `new higher score must overtake old lower (stable=${stable})`);

    assert.strictEqual(guidedComesBefore({ score: 101, pendingSeq: 9 }, { score: 100, pendingSeq: 0 }, stable), true);
    assert.strictEqual(guidedComesBefore({ score: 100, pendingSeq: 0 }, { score: 101, pendingSeq: 9 }, stable), false);
  }

  console.log("PR-5.26e/5.26f guided equal-score heap micro: PASS");
  console.log(`  LEGACY equal-score push A,B,C,D -> ${legacyOrder.join(",")}`);
  console.log(`  LEGACY interleaved push/pop     -> ${legacyInterleaved.join(",")}`);
  console.log(`  STABLE equal-score push A,B,C,D -> ${stableOrder.join(",")}`);
  console.log(`  STABLE interleaved push/pop     -> ${stableInterleaved.join(",")}`);
  console.log("  EQUAL_SCORE_ORDER_IS_FIFO (legacy) = FALSE");
  console.log("  EQUAL_SCORE_ORDER_IS_FIFO (stable) = TRUE");
  console.log("  HIGHER_SCORE_STILL_WINS = TRUE (both modes)");
}

if (require.main === module) main();

module.exports = { build, drain, entries, main };
