"use strict";

// PR-5.25f driver: estimate-only battle baseline probe.
//
// One fixed, unfitted lexicographic estimate.damage/turn baseline (no damage-only
// / turn-only / weight sweep), compared against the UNCHANGED PR-5.25d model on
// the exact same estimate-valid intersection of unique-signature, battle-only,
// same-kind decisions.  No rollouts, no MCGS, no corpus expansion, no production
// change.
//
// Usage:
//   node check-learned-prior-estimate-baseline-probe.js [--out=PATH]

const fs = require("fs");
const path = require("path");

const inventory = require("./lib/learned-prior-corpus-inventory");
const probe = require("./lib/learned-prior-estimate-baseline-probe");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-estimate-baseline.result.json");

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

  const first = probe.runEstimateBaselineProbe({ corpus });
  const second = probe.runEstimateBaselineProbe({ corpus });
  const deterministic = first.intersection.fullModelMeanNormalizedRank === second.intersection.fullModelMeanNormalizedRank
    && first.intersection.estimateOnlyMeanNormalizedRank === second.intersection.estimateOnlyMeanNormalizedRank
    && first.intersection.decisions === second.intersection.decisions;
  requireCondition(deterministic, "estimate baseline probe is not deterministic", {
    first: first.intersection,
    second: second.intersection,
  });
  requireCondition(first.counts.intersection === first.counts.estimateEvaluable, "intersection must equal the estimate-evaluable set");
  requireCondition(first.intersection.decisions > 0, "no decisions in the estimate-valid intersection");
  requireCondition(first.protocol.noFitting === true && first.protocol.noSweep === true && first.protocol.noWeightTuning === true,
    "protocol must be a single fixed unfitted baseline");

  const result = {
    schema: "learned-prior.estimate-baseline-probe.v1",
    milestone: "PR-5.25f",
    step: "ESTIMATE_ONLY_BATTLE_BASELINE_PROBE",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      deterministic: "pass",
      sameIntersectionForBothRankers: "pass",
      noFitting: "pass",
      noWeightTuning: "pass",
      noSweep: "pass",
      modelUnchangedFrom: "PR-5.25d",
      noCorpusExpansion: "pass",
      noRollouts: "pass",
    },
    ...first,
    exitCodePolicy: "0 for a coherent probe result; non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const c = first.counts;
  const i = first.intersection;
  console.log("PR-5.25f — estimate-only battle baseline probe");
  console.log(`  protocol                   : ${first.protocol.evaluation} | baseline ${first.protocol.estimateBaseline} (${first.protocol.primaryKey1}, tie ${first.protocol.tieBreakKey2})`);
  console.log(`  UNIQUE battle chosen       : ${c.uniqueBattleChosenSignatures} / ${c.uniqueUnseenSignatures} unique unseen signatures`);
  console.log(`  same-kind evaluable        : ${c.uniqueBattleSameKindEvaluable}`);
  console.log(`  ESTIMATE_EVALUABLE         : ${c.estimateEvaluable} (dropped for missing estimate: ${c.droppedForMissingEstimate})`);
  console.log(`  intersection decisions     : ${i.decisions}`);
  console.log(`  FULL_MODEL_RANK_ON_INTERSECTION    : ${i.fullModelMeanNormalizedRank.toFixed(4)} (top1 ${i.fullModelTop1Rate.toFixed(3)})`);
  console.log(`  ESTIMATE_ONLY_RANK_ON_INTERSECTION : ${i.estimateOnlyMeanNormalizedRank.toFixed(4)} (top1 ${i.estimateOnlyTop1Rate.toFixed(3)})`);
  console.log(`  UNIFORM                            : 0.5000`);
  console.log(`  reference full same-kind set       : ${first.referenceFullSameKindSet.decisions} decisions, model ${first.referenceFullSameKindSet.fullModelMeanNormalizedRank.toFixed(4)} (transparency only)`);
  console.log(`  PRIMARY_COMPARISON (full < estimate): ${first.primaryComparison.value}`);
  console.log(`  verdict                    : ${first.verdict}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
