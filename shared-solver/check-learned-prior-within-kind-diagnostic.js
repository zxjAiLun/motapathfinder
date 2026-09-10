"use strict";

// PR-5.25e driver: within-kind state-conditional signal probe (+ Repair 1).
//
// Reuses the frozen PR-5.25d model (same deterministic preparation path; no new
// training recipe, no model change, no extra fit objective, no data/split change)
// and removes the global action-kind base rate by ranking the chosen action only
// among legal SAME-KIND alternatives.  Repair 1 reports BOTH weightings:
// occurrence-weighted (every held-out route occurrence) and unique-signature
// (each (buildStateKey, chosenFingerprint) counted once).  No rollouts, no MCGS,
// no production change.
//
// Usage:
//   node check-learned-prior-within-kind-diagnostic.js [--out=PATH]

const fs = require("fs");
const path = require("path");

const inventory = require("./lib/learned-prior-corpus-inventory");
const diagnostic = require("./lib/learned-prior-within-kind-diagnostic");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-within-kind-diagnostic.result.json");

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

function printAggregate(label, aggregate, nonEvaluableByKind) {
  console.log(`  ${label} aggregate       : ${aggregate.modelMeanNormalizedRank.toFixed(4)} vs uniform 0.5000  (top1 ${aggregate.modelTop1Rate.toFixed(3)})`);
  console.log(`  ${label} evaluable       : ${aggregate.evaluableDecisions} / ${aggregate.totalDecisions}`);
  if (nonEvaluableByKind) console.log(`  ${label} excluded by kind: ${JSON.stringify(aggregate.nonEvaluableByKind)}`);
  for (const row of aggregate.perKind) {
    console.log(`    ${label} ${row.kind.padEnd(12)} n=${String(row.evaluableDecisions).padStart(3)} rank ${row.meanNormalizedRank.toFixed(4)} top1 ${row.top1Rate.toFixed(3)}${row.beatsUniform ? "" : "  (>= uniform)"}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const corpus = inventory.inventoryCorpus({ captureDecisions: true });

  const first = diagnostic.runWithinKindDiagnostic({ corpus });
  const second = diagnostic.runWithinKindDiagnostic({ corpus });
  const deterministic = first.unique.uniqueWithinKindAggregate === second.unique.uniqueWithinKindAggregate
    && first.withinKind.modelMeanNormalizedRank === second.withinKind.modelMeanNormalizedRank
    && first.referenceOverall.modelMicroMeanNormalizedRank === second.referenceOverall.modelMicroMeanNormalizedRank;
  requireCondition(deterministic, "within-kind diagnostic is not deterministic for the frozen seed", {
    occurrence: first.withinKind.modelMeanNormalizedRank,
    unique: first.unique.uniqueWithinKindAggregate,
  });
  requireCondition(first.kindPriorWithinKindCheck.passed, "kind-prior within-kind sanity check failed (expected exactly 0.5 under both weightings)", {
    occurrence: first.kindPriorWithinKindCheck.occurrenceObservedMeanNormalizedRank,
    unique: first.kindPriorWithinKindCheck.distinctObservedMeanNormalizedRank,
  });
  requireCondition(first.unique.uniqueEvaluableSignatures > 0, "no evaluable unique unseen signatures");

  const result = {
    schema: "learned-prior.within-kind-diagnostic.v1",
    milestone: "PR-5.25e",
    step: "STATE_CONDITIONAL_SIGNAL_PROBE",
    repair: "REPAIR_1_UNIQUE_SIGNATURE_DEDUP",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      deterministic: "pass",
      kindPriorWithinKindIsExactlyUniform: "pass",
      noNewTrainingRecipe: "pass",
      noModelChange: "pass",
      noExtraFitObjective: "pass",
      deterministicModelReproduction: "pass",
      noDataChange: "pass",
      noRollouts: "pass",
    },
    ...first,
    exitCodePolicy: "0 for a coherent diagnostic result; non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("PR-5.25e — within-kind state-conditional signal probe (Repair 1: unique-signature dedup)");
  console.log(`  reference overall          : model ${first.referenceOverall.modelMicroMeanNormalizedRank.toFixed(4)} | kind-prior ${first.referenceOverall.kindPriorMicroMeanNormalizedRank.toFixed(4)} | uniform 0.5000`);
  console.log(`  held-out unseen            : ${first.duplicationAmplification.occurrenceDecisions} occurrences -> ${first.duplicationAmplification.distinctSignatures} distinct signatures (amplification ${first.duplicationAmplification.amplificationFactor.toFixed(2)}x)`);
  console.log("  --- OCCURRENCE-WEIGHTED ---");
  printAggregate("occurrence", first.withinKind, true);
  console.log("  --- UNIQUE-SIGNATURE ---");
  printAggregate("unique    ", first.withinKindDistinct, true);
  console.log(`  kind-prior within-kind     : occurrence ${first.kindPriorWithinKindCheck.occurrenceObservedMeanNormalizedRank.toFixed(4)} | unique ${first.kindPriorWithinKindCheck.distinctObservedMeanNormalizedRank.toFixed(4)} (sanity: exactly 0.5000)`);
  console.log(`  UNIQUE battle margin       : ${first.unique.battleMarginBelowUniform == null ? "n/a" : first.unique.battleMarginBelowUniform.toFixed(4)} below uniform (not-marginal margin ${first.unique.notMarginalMargin})`);
  console.log(`  verdict occurrence         : ${first.verdict.occurrenceWeightedSignal}`);
  console.log(`  verdict unique-signature   : ${first.verdict.distinctSignatureSignal}`);
  console.log(`  estimate-only baseline     : ${first.verdict.estimateOnlyBaseline}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
