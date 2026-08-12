"use strict";

/** TEST GRADE: synthetic-controller-contract */

const assert = require("node:assert");

const { repairRejectionReason } = require("./lib/hierarchical-discovery-engine");

function execution(closureClass, options) {
  const config = options || {};
  return {
    outcome: { goalFound: config.goalFound !== false },
    checkpoints: config.checkpoints === false ? [] : [{}],
    repairVerification: closureClass ? { closureClass } : null,
  };
}

function main() {
  const cases = [
    ["blocker-unblocked", null],
    ["improved-but-still-blocked", null],
    ["no-net-improvement", "no-net-improvement"],
    ["repair-target-not-realized", "repair-target-not-realized"],
  ];
  for (const [closureClass, expected] of cases) {
    assert.strictEqual(repairRejectionReason(execution(closureClass)), expected);
  }
  assert.strictEqual(
    repairRejectionReason(execution(null, { goalFound: false })),
    "local-execution-did-not-produce-checkpoint",
  );
  assert.strictEqual(
    repairRejectionReason(execution(null, { checkpoints: false })),
    "local-execution-did-not-produce-checkpoint",
  );
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    accepted: ["blocker-unblocked", "improved-but-still-blocked"],
    rejected: [
      "no-net-improvement",
      "repair-target-not-realized",
      "local-execution-did-not-produce-checkpoint",
    ],
    verdict: "ACTUAL_REPAIR_CLOSURE_CONTROLS_COMMIT_OR_ROLLBACK",
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
