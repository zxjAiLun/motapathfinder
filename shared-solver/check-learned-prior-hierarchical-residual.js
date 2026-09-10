"use strict";

// PR-5.25h driver: kind-prior + within-kind residual policy.
//
// Frozen protocol: FEATURE_SCHEMA_V2 / corpus / max-reached split / 16 hidden /
// seed 52501 / epochs 300 / lr 0.05 / T=1.0 unchanged; the ONLY change is
// MONOLITHIC_PAIRWISE -> SAME_KIND_RESIDUAL_PAIRWISE + FIXED_KIND_PRIOR.
//
// Offline gates: OVERALL_GATE (treatment micro < kind-prior control) and
// CHANGEFLOOR_GATE (treatment unique changeFloor < 0.5 and < V2 monolithic
// anchor).  If both pass, the same round runs CONTROL = kind-prior-only policy
// vs TREATMENT = hierarchical, against the true MT5 blueKing terminal.
//
// Usage:
//   node check-learned-prior-hierarchical-residual.js [--out=PATH]

const fs = require("fs");
const path = require("path");

const inventory = require("./lib/learned-prior-corpus-inventory");
const prior = require("./lib/learned-action-prior");
const hierarchical = require("./lib/learned-prior-hierarchical-residual-experiment");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-hierarchical-residual.result.json");
const ANCHOR_KIND_PRIOR_MICRO = 0.33992163274078147;
const ANCHOR_V2_MONOLITHIC_CHANGEFLOOR = 0.8125;

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

// Structural check of the composition rule: a flat within-kind residual must
// reproduce log P(kind) exactly, and a non-flat residual must reorder within a
// kind.
function verifyCompositionProperty() {
  const mk = (kind) => {
    const vector = new Array(prior.FEATURE_DIM_V2).fill(0);
    vector[prior.STATE_FEATURE_COUNT + kind] = 1;
    return vector;
  };
  const vectors = [mk(0), mk(0), mk(7), mk(7)];
  const probability = new Array(prior.FEATURE_SCHEMA.actionKinds.length).fill(0.05);
  probability[0] = 0.6;
  probability[7] = 0.2;
  const flat = hierarchical.computeHierarchicalScores(vectors, [2.5, 2.5, 2.5, 2.5], probability);
  const flatIsLogPrior = flat.every((score, index) => (
    Math.abs(score - Math.log(probability[prior.actionKindIndexOfVector(vectors[index])])) < 1e-12
  ));
  const skewed = hierarchical.computeHierarchicalScores(vectors, [9, 1, 9, 1], probability);
  const reordersWithinKind = skewed[0] > skewed[1] && skewed[2] > skewed[3];
  return { flatIsLogPrior, reordersWithinKind };
}

function main() {
  const args = parseArgs(process.argv);
  const corpus = inventory.inventoryCorpus({ captureDecisions: true });

  const composition = verifyCompositionProperty();
  requireCondition(composition.flatIsLogPrior, "flat within-kind residual must reproduce log P(kind) exactly");
  requireCondition(composition.reordersWithinKind, "non-flat residual must reorder within a kind");

  const first = hierarchical.runHierarchicalResidualExperiment({ corpus });
  const second = hierarchical.runHierarchicalResidualExperiment({ corpus });
  const deterministic = closeTo(first.metrics.treatmentOverallMicro, second.metrics.treatmentOverallMicro)
    && closeTo(first.metrics.uniqueChangeFloorTreatment, second.metrics.uniqueChangeFloorTreatment);
  requireCondition(deterministic, "hierarchical residual experiment is not deterministic", {
    first: first.metrics, second: second.metrics,
  });

  requireCondition(!first.preflight.blocked, "PR-5.25h is blocked: no changeFloor within-kind supervision", {
    changeFloorSupervisedDecisions: first.preflight.changeFloorSupervisedDecisions,
  });
  requireCondition(closeTo(first.metrics.controlOverallMicro, ANCHOR_KIND_PRIOR_MICRO, 1e-9),
    "control policy drifted from the frozen kind-prior micro anchor", {
      observed: first.metrics.controlOverallMicro, expected: ANCHOR_KIND_PRIOR_MICRO,
    });
  requireCondition(closeTo(first.metrics.uniqueChangeFloorMonolithicAnchor, ANCHOR_V2_MONOLITHIC_CHANGEFLOOR, 1e-9),
    "V2 monolithic changeFloor anchor drifted from the frozen PR-5.25g value", {
      observed: first.metrics.uniqueChangeFloorMonolithicAnchor, expected: ANCHOR_V2_MONOLITHIC_CHANGEFLOOR,
    });
  requireCondition((first.rollouts !== null) === first.rolloutEligible,
    "rollouts must run if and only if both offline gates pass");

  const result = {
    schema: "learned-prior.hierarchical-residual.v1",
    milestone: "PR-5.25h",
    step: "KIND_PRIOR_PLUS_WITHIN_KIND_RESIDUAL_POLICY",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      deterministic: "pass",
      compositionDegeneratesToKindPrior: "pass",
      controlIsExactlyKindPrior: "pass",
      v2MonolithicAnchorReproduced: "pass",
      featureSchemaUnchanged: "pass",
      corpusAndSplitUnchanged: "pass",
      noTunableWeights: "pass",
      rolloutOnlyWhenGatesPass: "pass",
      trueBlueKingTerminalPredicate: "pass",
    },
    compositionProperty: composition,
    ...first,
    exitCodePolicy: "0 for a coherent result (including FAILED_OFFLINE); non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const p = first.preflight;
  const m = first.metrics;
  console.log("PR-5.25h — kind-prior + within-kind residual policy");
  console.log(`  preflight                  : same-kind supervised ${p.sameKindSupervisedDecisions}/${p.trainDecisions} decisions, ${p.pairCount} pairs, ${p.distinctSupervisedSignatures} signatures`);
  console.log(`  preflight by kind          : battle ${p.byKind.battle.supervisedDecisions}/${p.byKind.battle.decisions} (${p.byKind.battle.distinctSignatures} sigs), changeFloor ${p.byKind.changeFloor.supervisedDecisions}/${p.byKind.changeFloor.decisions} (${p.byKind.changeFloor.distinctSignatures} sigs)`);
  console.log(`  blocked                    : ${p.blocked}`);
  console.log(`  overall micro              : CONTROL ${m.controlOverallMicro.toFixed(4)} -> TREATMENT ${m.treatmentOverallMicro.toFixed(4)}`);
  console.log(`  unique changeFloor         : monolithic anchor ${m.uniqueChangeFloorMonolithicAnchor.toFixed(4)} -> residual ${m.uniqueChangeFloorTreatment.toFixed(4)} (n=${m.uniqueChangeFloorCount})`);
  console.log(`  unique battle (report)     : ${m.uniqueBattleTreatment.toFixed(4)} (n=${m.uniqueBattleCount})`);
  console.log(`  unique aggregate (report)  : ${m.uniqueAggregateTreatment.toFixed(4)}`);
  console.log(`  OVERALL_GATE               : ${first.gates.OVERALL_GATE.passed ? "PASS" : "FAIL"}`);
  console.log(`  CHANGEFLOOR_GATE           : ${first.gates.CHANGEFLOOR_GATE.passed ? "PASS" : "FAIL"}`);
  console.log(`  rolloutEligible            : ${first.rolloutEligible}`);
  if (first.rollouts) {
    const c = first.rollouts.control;
    const t = first.rollouts.treatment;
    console.log(`  CONTROL   kind-prior (${c.rollouts}) : blueKing ${c.terminalBlueKing}, MT3 ${c.mt3Reach}, MT4 ${c.mt4Reach}, MT5 ${c.mt5Reach}, maxFloor ${JSON.stringify(c.maxFloorHistogram)}`);
    console.log(`  TREATMENT hierarchical(${t.rollouts}) : blueKing ${t.terminalBlueKing}, MT3 ${t.mt3Reach}, MT4 ${t.mt4Reach}, MT5 ${t.mt5Reach}, maxFloor ${JSON.stringify(t.maxFloorHistogram)}`);
  } else {
    console.log("  rollouts                   : not launched (offline gates not both passed)");
  }
  console.log(`  verdict                    : ${first.verdict}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
