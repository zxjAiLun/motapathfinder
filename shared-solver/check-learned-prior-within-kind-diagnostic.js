"use strict";

// PR-5.25e driver: within-kind state-conditional signal probe.
//
// Reuses the frozen PR-5.25d model (same deterministic preparation path, no
// retraining of a different model, no data/config/objective change) and removes
// the global action-kind base rate from the ranking metric by ranking the chosen
// action only among legal SAME-KIND alternatives.  No rollouts, no MCGS, no
// production change.
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

function main() {
  const args = parseArgs(process.argv);
  const corpus = inventory.inventoryCorpus({ captureDecisions: true });

  const first = diagnostic.runWithinKindDiagnostic({ corpus });
  const second = diagnostic.runWithinKindDiagnostic({ corpus });
  const deterministic = first.withinKind.modelMeanNormalizedRank === second.withinKind.modelMeanNormalizedRank
    && first.referenceOverall.modelMicroMeanNormalizedRank === second.referenceOverall.modelMicroMeanNormalizedRank;
  requireCondition(deterministic, "within-kind diagnostic is not deterministic for the frozen seed", {
    first: first.withinKind.modelMeanNormalizedRank,
    second: second.withinKind.modelMeanNormalizedRank,
  });
  requireCondition(first.kindPriorWithinKindCheck.passed, "kind-prior within-kind rank check failed (expected exactly 0.5)", {
    observed: first.kindPriorWithinKindCheck.observedMeanNormalizedRank,
  });
  requireCondition(first.withinKind.evaluableDecisions > 0, "no evaluable within-kind decisions (chosen action never had a same-kind alternative)");

  const result = {
    schema: "learned-prior.within-kind-diagnostic.v1",
    milestone: "PR-5.25e",
    step: "STATE_CONDITIONAL_SIGNAL_PROBE",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      deterministic: "pass",
      kindPriorWithinKindIsExactlyUniform: "pass",
      modelUnchangedFrom: "PR-5.25d",
      retrainedForThisDiagnostic: "false",
      noDataChange: "pass",
      noRollouts: "pass",
    },
    ...first,
    exitCodePolicy: "0 for a coherent diagnostic result; non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const wk = first.withinKind;
  console.log("PR-5.25e — within-kind state-conditional signal probe");
  console.log(`  reference (same unseen set): model ${first.referenceOverall.modelMicroMeanNormalizedRank.toFixed(4)} | kind-prior ${first.referenceOverall.kindPriorMicroMeanNormalizedRank.toFixed(4)} | uniform 0.5000`);
  console.log(`  evaluable decisions        : ${wk.evaluableDecisions} / ${wk.totalDecisions} (${wk.nonEvaluableDecisions} excluded: only same-kind legal action)`);
  console.log(`  same-kind set size histogram: ${JSON.stringify(wk.sameKindSetSizeHistogram)}`);
  console.log(`  WITHIN_KIND model rank     : ${wk.modelMeanNormalizedRank.toFixed(4)} vs uniform 0.5000  (top1 ${wk.modelTop1Rate.toFixed(3)})`);
  console.log(`  kind-prior within-kind rank: ${first.kindPriorWithinKindCheck.observedMeanNormalizedRank.toFixed(4)} (sanity: must be exactly 0.5000)`);
  for (const row of wk.perKind) {
    console.log(`    ${row.kind.padEnd(14)} n=${String(row.evaluableDecisions).padStart(3)} rank ${row.meanNormalizedRank.toFixed(4)} top1 ${row.top1Rate.toFixed(3)} ${row.beatsUniform ? "" : "(>= uniform)"}`);
  }
  console.log(`  excluded by kind           : ${JSON.stringify(wk.nonEvaluableByKind)}`);
  console.log(`  verdict                    : ${first.verdict}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
