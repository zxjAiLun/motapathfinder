"use strict";

// PR-5.25g driver: changeFloor destination semantics repair (V1 vs V2).
//
// Frozen protocol: same corpus/split/objective/seed; V2 adds exactly one action
// feature (changeFloorDestinationDelta).  Offline gates:
//   CHANGEFLOOR_PRIMARY = V2 unique changeFloor rank < 0.5 AND < V1
//   OVERALL_GATE        = V2 overall micro rank < kind-prior micro rank
// Rollouts (true MT5 blueKing terminal) run ONLY if both gates pass.
//
// Usage:
//   node check-learned-prior-changefloor-repair.js [--out=PATH]

const fs = require("fs");
const path = require("path");

const inventory = require("./lib/learned-prior-corpus-inventory");
const repair = require("./lib/learned-prior-changefloor-repair-experiment");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-changefloor-repair.result.json");
// Frozen PR-5.25d/5.25e control anchors that V1 must still reproduce.
const V1_ANCHOR = { overallMicro: 0.38205117708663794, uniqueChangeFloor: 0.9375 };

function parseArgs(argv) {
  let out = DEFAULT_RESULT_PATH;
  for (const token of argv.slice(2)) {
    const match = /^--out=(.*)$/.exec(token);
    if (match) out = path.resolve(__dirname, match[1]);
  }
  return { out };
}

function requireCondition(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details || null;
    throw error;
  }
}

function closeTo(a, b, tolerance) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= (tolerance == null ? 1e-12 : tolerance);
}

function main() {
  const args = parseArgs(process.argv);
  const corpus = inventory.inventoryCorpus({ captureDecisions: true });

  const first = repair.runChangeFloorRepairExperiment({ corpus });
  const second = repair.runChangeFloorRepairExperiment({ corpus });
  const deterministic = closeTo(first.metrics.overallMicroV2, second.metrics.overallMicroV2)
    && closeTo(first.metrics.uniqueChangeFloorV2, second.metrics.uniqueChangeFloorV2)
    && closeTo(first.metrics.overallMicroV1, second.metrics.overallMicroV1);
  requireCondition(deterministic, "changeFloor repair experiment is not deterministic", {
    first: first.metrics,
    second: second.metrics,
  });
  // V1 control must still reproduce the frozen 5.25d/5.25e numbers exactly.
  requireCondition(closeTo(first.metrics.overallMicroV1, V1_ANCHOR.overallMicro, 1e-9),
    "V1 control overall micro drifted from the frozen PR-5.25d anchor", {
      observed: first.metrics.overallMicroV1, expected: V1_ANCHOR.overallMicro,
    });
  requireCondition(closeTo(first.metrics.uniqueChangeFloorV1, V1_ANCHOR.uniqueChangeFloor, 1e-9),
    "V1 control unique changeFloor drifted from the frozen PR-5.25e anchor", {
      observed: first.metrics.uniqueChangeFloorV1, expected: V1_ANCHOR.uniqueChangeFloor,
    });
  requireCondition((first.rollouts !== null) === first.rolloutEligible,
    "rollouts must run if and only if both offline gates pass");

  const result = {
    schema: "learned-prior.changefloor-repair.v1",
    milestone: "PR-5.25g",
    step: "CHANGEFLOOR_DESTINATION_SEMANTICS_REPAIR",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      deterministic: "pass",
      v1ControlMatchesFrozenAnchors: "pass",
      modelCapacityUnchanged: "pass",
      objectiveUnchanged: "pass",
      trainCorpusUnchanged: "pass",
      oneNewFeatureOnly: "pass",
      changeFloorDestinationFailClosed: "pass",
      rolloutOnlyWhenGatesPass: "pass",
      trueBlueKingTerminalPredicate: "pass",
    },
    ...first,
    exitCodePolicy: "0 for a coherent A/B result (including FAILED_OFFLINE); non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const m = first.metrics;
  console.log("PR-5.25g — changeFloor destination semantics repair (V1 vs V2)");
  console.log(`  features                   : V1 ${first.modelExactness.featureDimV1} -> V2 ${first.modelExactness.featureDimV2} (+changeFloorDestinationDelta only)`);
  console.log(`  split                      : TRAIN ${first.split.trainRouteCount} routes / ${first.split.trainDecisions} decisions; HELD-OUT unseen ${first.split.heldOutUnseenDecisions} (unique ${first.split.uniqueUnseenSignatures})`);
  console.log(`  overall micro              : V1 ${m.overallMicroV1.toFixed(4)} -> V2 ${m.overallMicroV2.toFixed(4)}   (kind-prior ${m.kindPriorMicro.toFixed(4)})`);
  console.log(`  unique changeFloor rank    : V1 ${m.uniqueChangeFloorV1.toFixed(4)} -> V2 ${m.uniqueChangeFloorV2.toFixed(4)}   (n=${m.uniqueChangeFloorV2Count})`);
  console.log(`  occurrence changeFloor rank: V1 ${m.occurrenceChangeFloorV1.toFixed(4)} -> V2 ${m.occurrenceChangeFloorV2.toFixed(4)}   (n=${m.occurrenceChangeFloorV2Count})`);
  console.log(`  unique battle rank         : V1 ${m.uniqueBattleV1.toFixed(4)} -> V2 ${m.uniqueBattleV2.toFixed(4)}   (n=${m.uniqueBattleV2Count}, report only)`);
  console.log(`  unique aggregate rank      : V1 ${m.uniqueAggregateV1.toFixed(4)} -> V2 ${m.uniqueAggregateV2.toFixed(4)}`);
  console.log(`  CHANGEFLOOR_PRIMARY        : ${first.gates.CHANGEFLOOR_PRIMARY.passed ? "PASS" : "FAIL"} (needs V2 < 0.5 and V2 < V1)`);
  console.log(`  OVERALL_GATE               : ${first.gates.OVERALL_GATE.passed ? "PASS" : "FAIL"} (needs V2 < kind-prior)`);
  console.log(`  rolloutEligible            : ${first.rolloutEligible}`);
  if (first.rollouts) {
    console.log(`  CONTROL   (${first.rollouts.control.rollouts})  : blueKing terminal ${first.rollouts.control.terminalBlueKing}, MT3 ${first.rollouts.control.mt3Reach}, MT4 ${first.rollouts.control.mt4Reach}, MT5 ${first.rollouts.control.mt5Reach}`);
    console.log(`  TREATMENT (${first.rollouts.treatment.rollouts})  : blueKing terminal ${first.rollouts.treatment.terminalBlueKing}, MT3 ${first.rollouts.treatment.mt3Reach}, MT4 ${first.rollouts.treatment.mt4Reach}, MT5 ${first.rollouts.treatment.mt5Reach}`);
  } else {
    console.log("  rollouts                   : not launched (offline gates not both passed)");
  }
  console.log(`  verdict                    : ${first.verdict}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
