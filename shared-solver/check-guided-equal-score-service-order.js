"use strict";

/** PR-5.26e Phase 2: freeze the current guided equal-score heap behavior. */

const assert = require("assert");
const { guidedHeapPush, guidedHeapPop } = require("./lib/transport-collapse");

function drain(heap) {
  const ids = [];
  for (let entry = guidedHeapPop(heap); entry; entry = guidedHeapPop(heap)) ids.push(entry.id);
  return ids;
}

function build(entries) {
  const heap = [];
  for (const entry of entries) guidedHeapPush(heap, entry);
  return heap;
}

function main() {
  const equalScoreOrder = drain(build([
    { id: "A", score: 100 },
    { id: "B", score: 100 },
    { id: "C", score: 100 },
    { id: "D", score: 100 },
  ]));
  assert.deepStrictEqual(equalScoreOrder, ["A", "D", "C", "B"]);
  assert.notDeepStrictEqual(equalScoreOrder, ["A", "B", "C", "D"]);

  const interleavedHeap = build([
    { id: "A", score: 100 },
    { id: "B", score: 100 },
    { id: "C", score: 100 },
  ]);
  const interleavedOrder = [guidedHeapPop(interleavedHeap).id];
  guidedHeapPush(interleavedHeap, { id: "D", score: 100 });
  guidedHeapPush(interleavedHeap, { id: "E", score: 100 });
  interleavedOrder.push(...drain(interleavedHeap));
  assert.deepStrictEqual(interleavedOrder, ["A", "C", "E", "D", "B"]);

  const higherScoreOrder = drain(build([
    { id: "A", score: 100 },
    { id: "H", score: 101 },
    { id: "B", score: 100 },
  ]));
  assert.deepStrictEqual(higherScoreOrder, ["H", "B", "A"]);

  console.log("PR-5.26e guided equal-score heap micro: PASS");
  console.log(`  equal-score push A,B,C,D -> ${equalScoreOrder.join(",")}`);
  console.log(`  interleaved push/pop -> ${interleavedOrder.join(",")}`);
  console.log(`  higher score control -> ${higherScoreOrder.join(",")}`);
  console.log("  EQUAL_SCORE_ORDER_IS_FIFO = FALSE");
  console.log("  HIGHER_SCORE_STILL_WINS = TRUE");
}

if (require.main === module) main();

module.exports = { build, drain, main };
