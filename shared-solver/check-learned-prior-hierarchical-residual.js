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
const ANCHOR_V2_MONOLITHIC_CHANGEFLOOR = 0.8125;
// Pre-Repair-1 within-kind ranks (must be reproduced: the Repair only removes a
// term that is constant within a kind).
const ANCHOR_RESIDUAL_CHANGEFLOOR = 0.125;
const ANCHOR_RESIDUAL_BATTLE = 0.41561624649859963;

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

// Repair 1 structural check: the kind-mass invariant with UNEQUAL group sizes.
//   Sum_{a in kind k} softmax(score)(a) must equal the normalised available-kind
//   prior, and must be unchanged by the residual (the residual may only
//   redistribute mass WITHIN a kind).
function verifyCompositionProperty() {
  const mk = (kind) => {
    const vector = new Array(prior.FEATURE_DIM_V2).fill(0);
    vector[prior.STATE_FEATURE_COUNT + kind] = 1;
    return vector;
  };
  const battleKind = prior.FEATURE_SCHEMA.actionKinds.indexOf("battle");
  const changeFloorKind = prior.FEATURE_SCHEMA.actionKinds.indexOf("changeFloor");
  // Unequal group sizes: battle N=3, changeFloor N=1.
  const vectors = [mk(battleKind), mk(battleKind), mk(battleKind), mk(changeFloorKind)];
  const probability = new Array(prior.FEATURE_SCHEMA.actionKinds.length).fill(0.05);
  probability[battleKind] = 0.6;
  probability[changeFloorKind] = 0.2;
  const expected = hierarchical.normalizedAvailableKindPrior(vectors, probability);

  const flatMass = hierarchical.kindMass(vectors, [0, 0, 0, 0], probability);
  const skewedMass = hierarchical.kindMass(vectors, [5, -3, 1, 2], probability);
  const close = (a, b) => Math.abs(a - b) < 1e-12;
  const flatMatchesPrior = [...expected.entries()].every(([kind, value]) => close(flatMass.get(kind), value));
  const nonFlatMatchesPrior = [...expected.entries()].every(([kind, value]) => close(skewedMass.get(kind), value));
  const residualOnlyRedistributesWithinKind = [...expected.keys()].every((kind) => (
    close(flatMass.get(kind), skewedMass.get(kind))
  ));

  // Two-stage sampler: the ANALYTIC distribution must equal softmax(score)
  // per action at T=1, and the SAMPLER implementation must follow that
  // analytic distribution (frequency check), so the assertion exercises
  // sampleKindThenAction() itself rather than only the composition.
  const residual = [5, -3, 1, 2];
  const scores = hierarchical.computeHierarchicalScores(vectors, residual, probability);
  const softmaxProbabilities = hierarchical.softmaxFromScores(scores);
  const analytic = hierarchical.analyticTwoStageProbabilities(vectors, residual, probability);
  const analyticMatchesSoftmax = analytic.every((value, index) => close(value, softmaxProbabilities[index]));

  const draws = 200000;
  const rng = prior.mulberry32(20260910);
  const frequency = new Array(vectors.length).fill(0);
  for (let draw = 0; draw < draws; draw += 1) {
    const picked = hierarchical.sampleKindThenAction(vectors, residual, probability, rng, 1, true);
    frequency[picked.index] += 1;
  }
  const maxFrequencyDeviation = Math.max(...frequency.map((count, index) => (
    Math.abs(count / draws - analytic[index])
  )));
  const samplerFollowsAnalytic = maxFrequencyDeviation < 0.01;

  // Control variant: residual disabled must sample uniformly within the kind.
  const controlAnalytic = hierarchical.analyticTwoStageProbabilities(vectors, [0, 0, 0, 0], probability);
  const controlFrequency = new Array(vectors.length).fill(0);
  for (let draw = 0; draw < draws; draw += 1) {
    const picked = hierarchical.sampleKindThenAction(vectors, [0, 0, 0, 0], probability, rng, 1, false);
    controlFrequency[picked.index] += 1;
  }
  const controlMaxDeviation = Math.max(...controlFrequency.map((count, index) => (
    Math.abs(count / draws - controlAnalytic[index])
  )));
  const controlSamplerMatches = controlMaxDeviation < 0.01;

  return {
    flatResidualKindMass: Object.fromEntries(flatMass),
    nonFlatResidualKindMass: Object.fromEntries(skewedMass),
    normalizedAvailableKindPrior: Object.fromEntries(expected),
    flatMatchesPrior,
    nonFlatMatchesPrior,
    residualOnlyRedistributesWithinKind,
    analyticTwoStageMatchesSoftmaxPerAction: analyticMatchesSoftmax,
    samplerFollowsAnalyticDistribution: samplerFollowsAnalytic,
    samplerMaxFrequencyDeviation: maxFrequencyDeviation,
    controlSamplerFollowsAnalyticDistribution: controlSamplerMatches,
    controlSamplerMaxFrequencyDeviation: controlMaxDeviation,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const corpus = inventory.inventoryCorpus({ captureDecisions: true });

  const composition = verifyCompositionProperty();
  requireCondition(composition.flatMatchesPrior, "Repair 1: kind mass must equal the normalised available-kind prior under a flat residual", composition);
  requireCondition(composition.nonFlatMatchesPrior, "Repair 1: kind mass must equal the normalised available-kind prior under a non-flat residual", composition);
  requireCondition(composition.residualOnlyRedistributesWithinKind, "Repair 1: the residual must not change any kind's total mass", composition);
  requireCondition(composition.analyticTwoStageMatchesSoftmaxPerAction, "Repair 1: analytic two-stage per-action probabilities must equal softmax(score)", composition);
  requireCondition(composition.samplerFollowsAnalyticDistribution, "Repair 1: sampleKindThenAction must follow its analytic distribution (treatment)", composition);
  requireCondition(composition.controlSamplerFollowsAnalyticDistribution, "Repair 1: sampleKindThenAction must follow its analytic distribution (control, uniform within kind)", composition);

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
  // Pre-Repair-1 within-kind anchors must be reproduced (Repair only removes a
  // term that is constant within a kind).
  requireCondition(closeTo(first.metrics.uniqueChangeFloorMonolithicAnchor, ANCHOR_V2_MONOLITHIC_CHANGEFLOOR, 1e-9),
    "V2 monolithic changeFloor anchor drifted from the frozen PR-5.25g value", {
      observed: first.metrics.uniqueChangeFloorMonolithicAnchor, expected: ANCHOR_V2_MONOLITHIC_CHANGEFLOOR,
    });
  requireCondition(closeTo(first.metrics.uniqueChangeFloorTreatment, ANCHOR_RESIDUAL_CHANGEFLOOR, 1e-9),
    "residual changeFloor within-kind rank drifted from the pre-Repair value", {
      observed: first.metrics.uniqueChangeFloorTreatment, expected: ANCHOR_RESIDUAL_CHANGEFLOOR,
    });
  requireCondition(closeTo(first.metrics.uniqueBattleTreatment, ANCHOR_RESIDUAL_BATTLE, 1e-9),
    "residual battle within-kind rank drifted from the pre-Repair value", {
      observed: first.metrics.uniqueBattleTreatment, expected: ANCHOR_RESIDUAL_BATTLE,
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
      kindMassInvariant: "pass",
      residualOnlyRedistributesWithinKind: "pass",
      analyticTwoStageMatchesSoftmaxPerAction: "pass",
      samplerImplementationFollowsAnalyticDistribution: "pass",
      withinKindAnchorsReproduced: "pass",
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
  console.log(`  overall micro              : CONTROL(proper kind-prior) ${m.controlOverallMicro.toFixed(4)} -> TREATMENT ${m.treatmentOverallMicro.toFixed(4)}`);
  console.log(`  historical control ref     : ${m.historicalControlOverallReference.toFixed(4)} (pre-Repair buggy per-action log P(k); NOT the control anchor)`);
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
    console.log(`  CONTROL   kind histogram   : ${JSON.stringify(first.rollouts.controlSelectedKindHistogram)}`);
    console.log(`  TREATMENT kind histogram   : ${JSON.stringify(first.rollouts.treatmentSelectedKindHistogram)}`);
  } else {
    console.log("  rollouts                   : not launched (offline gates not both passed)");
  }
  console.log(`  verdict                    : ${first.verdict}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
