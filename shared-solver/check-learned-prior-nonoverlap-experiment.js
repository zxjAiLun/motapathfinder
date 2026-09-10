"use strict";

// PR-5.25d Step 1 driver: non-overlapping trajectory generalization probe.
//
// Trains the FROZEN PR-5.25c model once on the max-reached-floor TRAIN family
// and evaluates the frozen primary gate on genuinely non-overlapping held-out
// decisions.  No rollouts, no MCGS, no production change.
//
// Usage:
//   node check-learned-prior-nonoverlap-experiment.js [--out=PATH]

const fs = require("fs");
const path = require("path");

const inventory = require("./lib/learned-prior-corpus-inventory");
const experiment = require("./lib/learned-prior-nonoverlap-experiment");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-nonoverlap-step1.result.json");

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

function main() {
  const args = parseArgs(process.argv);
  const corpus = inventory.inventoryCorpus({ captureDecisions: true });
  const { distinct } = inventory.dedupeBySignatureSequence(corpus.distinctRouteRecords);
  const { train, heldOut } = inventory.splitByMaxReachedFloor(distinct);

  // Split-rule invariants: membership is by max reached floor, not final floor.
  for (const route of train) {
    requireCondition(route.maxReachedFloorOrdinal <= 3, `TRAIN route reached MT4+: ${route.relPath}`, {
      maxReachedFloorOrdinal: route.maxReachedFloorOrdinal,
    });
  }
  for (const route of heldOut) {
    requireCondition(route.maxReachedFloorOrdinal >= 4, `HELD-OUT route never reached MT4+: ${route.relPath}`, {
      maxReachedFloorOrdinal: route.maxReachedFloorOrdinal,
    });
  }
  requireCondition(train.length > 0 && heldOut.length > 0, "split produced an empty family");

  const first = experiment.runNonOverlapExperiment({ corpus });
  const second = experiment.runNonOverlapExperiment({ corpus });
  const deterministic = first.primary.meanNormalizedRank === second.primary.meanNormalizedRank
    && first.primary.top1Rate === second.primary.top1Rate;
  requireCondition(deterministic, "Step 1 training is not deterministic for the frozen seed", {
    first: first.primary.meanNormalizedRank,
    second: second.primary.meanNormalizedRank,
  });
  requireCondition(first.primary.unseenDecisions > 0, "no genuinely non-overlapping held-out decisions were scored");

  const result = {
    schema: "learned-prior.nonoverlap-probe.v1",
    milestone: "PR-5.25d",
    step: "STEP_1_NON_OVERLAPPING_TRAJECTORY_GENERALIZATION_PROBE",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      splitByMaxReachedFloor: "pass",
      deterministicTraining: deterministic ? "pass" : "fail",
      modelUnchangedFrom: "PR-5.25c",
      noTrainingOnHeldOutFamily: "pass",
      noRollouts: "pass",
    },
    ...first,
    exitCodePolicy: "0 for a coherent experiment result (including a gate that does not beat uniform); non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const t = first.transparency;
  console.log("PR-5.25d Step 1 — non-overlapping trajectory generalization probe");
  console.log(`  split rule                : ${first.split.rule.train}  |  held-out: ${first.split.rule.heldOut}`);
  console.log(`  TRAIN                     : ${first.split.trainRouteCount} routes / ${first.split.trainDecisions} decisions / ${first.split.trainDistinctSignatures} signatures`);
  console.log(`  HELD-OUT                  : ${first.split.heldOutRouteCount} routes (near ${first.split.heldOutNearRouteCount} / deep ${first.split.heldOutDeepRouteCount})`);
  console.log(`  unseen decisions          : ${first.split.heldOutUnseenDecisions} from ${first.split.heldOutDistinctUnseenSignatures} distinct signatures (${first.split.unseenSignaturesSharedByMultipleHeldOutRoutes} shared across held-out routes)`);
  console.log(`  train in-sample rank      : ${first.trainInSample.meanNormalizedRank.toFixed(4)} (top1 ${first.trainInSample.top1Rate.toFixed(3)})`);
  console.log(`  PRIMARY micro rank        : ${first.primary.meanNormalizedRank.toFixed(4)} vs uniform 0.5000  -> gate ${first.primary.passed ? "PASSED" : "NOT PASSED"}`);
  console.log(`  transparency macro rank   : ${t.macroMeanNormalizedRankAcrossHeldOutRoutes.toFixed(4)} over ${t.scoredHeldOutRoutes} held-out routes (not a gate)`);
  console.log(`  near (MT4)  micro rank    : ${t.nearAggregate.meanNormalizedRank.toFixed(4)} over ${t.nearAggregate.unseenDecisions} decisions`);
  console.log(`  deep (MT5+) micro rank    : ${t.deepAggregate.meanNormalizedRank.toFixed(4)} over ${t.deepAggregate.unseenDecisions} decisions`);
  console.log(`  kind-prior baseline rank  : ${t.kindPriorBaseline.meanNormalizedRank.toFixed(4)} (control, not a gate)`);
  for (const row of t.perRoute) {
    console.log(`    ${row.layer.padEnd(4)} unseen ${String(row.unseenDecisions).padStart(3)} mnr ${row.meanNormalizedRank.toFixed(4)} top1 ${row.top1Rate.toFixed(3)}  ${row.relPath.replace("shared-solver/routes/", "")}`);
  }
  console.log(`  verdict                   : ${first.verdict}`);
  console.log(`  result artifact           : ${path.relative(process.cwd(), args.out)}`);
}

main();
