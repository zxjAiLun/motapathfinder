"use strict";

// PR-5.25c Phase 1 executable experiment + regression driver.
//
// It builds the frozen two-route dataset by strict replay, verifies provenance
// and strict-replay invariants (fail closed), trains the deterministic pairwise
// ranking MLP, runs the two-fold leave-one-route-out sanity gate, and only when
// the gate passes launches matched CONTROL/TREATMENT rollouts.
//
// Exit-code policy: invariant violations and unexpected errors throw and exit
// non-zero.  A BLOCK_REAL_ROLLOUT sanity outcome is a valid, preservation-worthy
// experimental result (it is reported and returns 0) rather than an
// infrastructure failure.  The authoritative status is always in the result
// artifact and the printed `phase1Status` line.
//
// Usage:
//   node check-learned-action-prior.js [--rollouts=N] [--horizon=N] [--out=PATH]

const fs = require("fs");
const path = require("path");

const dataset = require("./lib/learned-prior-dataset");
const prior = require("./lib/learned-action-prior");
const { buildStateKey } = require("./lib/state-key");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-action-prior-phase1.result.json");

function parseArgs(argv) {
  const args = { rollouts: 32, horizon: 96, out: DEFAULT_RESULT_PATH };
  for (const token of argv.slice(2)) {
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(token);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === "rollouts") args.rollouts = Math.max(1, Number(value) || 1);
    else if (key === "horizon") args.horizon = Math.max(1, Number(value) || 1);
    else if (key === "out") args.out = path.resolve(__dirname, value);
  }
  return args;
}

function requireCondition(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details || null;
    throw error;
  }
}

function decisionSignature(example) {
  return `${buildStateKey(example.state)}|${example.fingerprint}`;
}

// Secondary transparency metric (NOT the frozen gate): rank the chosen action
// only on held-out decisions whose exact (state, fingerprint) signature does
// not appear in the training fold.  The two fixture routes share a long prefix,
// so this isolates genuinely unseen decisions.
function nonOverlapSanity(examples, config) {
  const routes = Array.from(new Set(examples.map((example) => example.routeId))).sort();
  if (routes.length < 2) return { applicable: false, reason: "fewer-than-two-routes" };
  const folds = [];
  for (const heldOutRoute of routes) {
    const train = examples.filter((example) => example.routeId !== heldOutRoute);
    const trainSignatures = new Set(train.map(decisionSignature));
    const test = examples.filter((example) => (
      example.routeId === heldOutRoute && !trainSignatures.has(decisionSignature(example))
    ));
    if (test.length === 0) {
      folds.push({ heldOutRoute, unseenTestExamples: 0, meanNormalizedRank: null, top1Rate: null });
      continue;
    }
    const trained = prior.trainModel(train, config);
    const metric = prior.evaluateChosenRank(trained.model, test);
    folds.push({
      heldOutRoute,
      unseenTestExamples: test.length,
      meanNormalizedRank: metric.meanNormalizedRank,
      top1Rate: metric.top1Rate,
    });
  }
  const withData = folds.filter((fold) => fold.unseenTestExamples > 0);
  const total = withData.reduce((sum, fold) => sum + fold.unseenTestExamples, 0);
  const weighted = withData.reduce((sum, fold) => sum + fold.meanNormalizedRank * fold.unseenTestExamples, 0);
  return {
    applicable: total > 0,
    note: "transparency metric only; the frozen gate is the full leave-one-route-out aggregate",
    folds,
    aggregateMeanNormalizedRank: total > 0 ? weighted / total : null,
    unseenTestExamples: total,
    uniformBaselineMeanNormalizedRank: 0.5,
    beatsUniform: total > 0 ? weighted / total < 0.5 : false,
  };
}

function runExperiment(args) {
  const startedAt = new Date().toISOString();
  const built = dataset.buildDataset();
  const modelConfig = prior.DEFAULT_CONFIG;

  // --- provenance / strict-replay invariants (fail closed) ---
  requireCondition(built.provenance.length === 2, `expected exactly 2 allowlisted routes, got ${built.provenance.length}`);
  requireCondition(built.inventory.includedCount === 2, `expected exactly 2 included routes, got ${built.inventory.includedCount}`);
  requireCondition(built.examples.length > 0, "strict replay produced zero examples");
  const includedPaths = built.inventory.included.map((row) => row.path).sort();
  const allowlistSorted = dataset.TRAIN_ALLOWLIST.slice().sort();
  requireCondition(
    JSON.stringify(includedPaths) === JSON.stringify(allowlistSorted),
    "inventory inclusion set does not equal the frozen allowlist",
    { includedPaths, allowlistSorted },
  );
  for (const stat of built.routeStats) {
    requireCondition(stat.decisionsReplayed === stat.examplesExtracted, `decision/example count mismatch for ${stat.path}`);
    requireCondition(stat.finalFloor === (stat.path === "shared-solver/routes/fixtures/mt1-mt2-hp3834.route.json" ? "MT2" : "MT3"),
      `unexpected final floor for ${stat.path}: ${stat.finalFloor}`);
  }

  // --- determinism invariant: identical seed => identical held-out metric ---
  const determinismProbeA = prior.evaluateChosenRank(prior.trainModel(built.examples, modelConfig).model, built.examples);
  const determinismProbeB = prior.evaluateChosenRank(prior.trainModel(built.examples, modelConfig).model, built.examples);
  const deterministic = determinismProbeA.meanNormalizedRank === determinismProbeB.meanNormalizedRank
    && determinismProbeA.top1Rate === determinismProbeB.top1Rate;
  requireCondition(deterministic, "training is not deterministic for a fixed seed", {
    a: determinismProbeA.meanNormalizedRank,
    b: determinismProbeB.meanNormalizedRank,
  });

  // --- offline sanity gate ---
  const sanity = prior.runSanityGate(built.examples, modelConfig);
  const sanitySummary = {
    status: sanity.status,
    reason: sanity.reason,
    routeCount: sanity.routeCount,
    aggregate: sanity.aggregate,
    folds: sanity.folds.map((fold) => ({
      heldOutRoute: fold.heldOutRoute,
      trainExamples: fold.trainExamples,
      testExamples: fold.testExamples,
      finalLoss: fold.finalLoss,
      meanNormalizedRank: fold.metric.meanNormalizedRank,
      top1Rate: fold.metric.top1Rate,
      uniformBaselineMeanNormalizedRank: fold.metric.uniformBaselineMeanNormalizedRank,
      beatsUniform: fold.metric.beatsUniform,
    })),
  };
  const robustness = nonOverlapSanity(built.examples, modelConfig);

  const examplesByRoute = {};
  for (const example of built.examples) {
    if (!examplesByRoute[example.routeId]) examplesByRoute[example.routeId] = [];
    examplesByRoute[example.routeId].push(example);
  }
  const sharedPrefixDecisions = prior.sharedPrefixSize(examplesByRoute);

  // --- final fit over both routes ---
  const finalFit = prior.trainModel(built.examples, modelConfig);
  const finalInSample = prior.evaluateChosenRank(finalFit.model, built.examples);

  // --- rollouts (only when the frozen sanity gate passes) ---
  let rolloutReport = null;
  let phase1Status;
  if (!sanity.aggregate || !sanity.aggregate.beatsUniform) {
    phase1Status = "BLOCK_REAL_ROLLOUT";
  } else {
    const project = dataset.loadGameProject();
    const simulator = dataset.createSimulator(project);
    const rollouts = prior.runRollouts(simulator, finalFit.model, {
      rollouts: args.rollouts,
      horizon: args.horizon,
      temperature: modelConfig.temperature,
    });
    const terminalRollouts = rollouts.treatmentAggregate.terminalRollouts;
    phase1Status = terminalRollouts > 0 ? "TERMINAL_ROLLOUTS_POSITIVE" : "NO_TERMINAL_ROLLOUTS";
    rolloutReport = {
      horizon: rollouts.horizon,
      temperature: rollouts.temperature,
      simulatorStopFloorId: "MT11",
      terminalCriterion: "simulator.isTerminal(state) === (state.floorId === stopFloorId)",
      rolloutsPerArm: args.rollouts,
      seedSchedule: { baseSeed: 52501, rule: "baseSeed + index * 7919 (matched across arms)" },
      control: rollouts.controlAggregate,
      treatment: rollouts.treatmentAggregate,
      controlMaxFloorHistogram: rollouts.control.reduce((map, result) => {
        map[result.maxFloorId] = (map[result.maxFloorId] || 0) + 1;
        return map;
      }, {}),
      treatmentMaxFloorHistogram: rollouts.treatment.reduce((map, result) => {
        map[result.maxFloorId] = (map[result.maxFloorId] || 0) + 1;
        return map;
      }, {}),
    };
  }

  const phase1Gate = {
    criterion: "treatment.terminalRollouts > 0 permits Phase 2 (MCGS integration)",
    terminalRollouts: rolloutReport ? rolloutReport.treatment.terminalRollouts : null,
    passed: rolloutsPositive(rolloutReport),
    mt4Mt5ReachIsSecondaryOnly: true,
  };

  return {
    schema: "learned-action-prior.phase1.v1",
    milestone: "PR-5.25c",
    startedAt,
    finishedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    dataset: {
      allowlist: built.allowlist,
      legacyKeyNormalization: built.legacyKeyNormalization,
      totals: built.totals,
      routeStats: built.routeStats,
      provenance: built.provenance,
      inventorySummary: {
        includedCount: built.inventory.includedCount,
        witnessCount: built.inventory.witnessCount,
        generatedCount: built.inventory.generatedCount,
        generatedDirectoryPolicy: built.inventory.generatedDirectoryPolicy,
        witnesses: built.inventory.witnesses,
      },
    },
    model: {
      featureSchema: prior.FEATURE_SCHEMA,
      featureDim: prior.FEATURE_DIM,
      stateFeatureCount: prior.STATE_FEATURE_COUNT,
      actionFeatureCount: prior.ACTION_FEATURE_COUNT,
      config: modelConfig,
    },
    invariants: {
      strictReplay: "pass",
      deterministicTraining: deterministic ? "pass" : "fail",
      includedEqualsAllowlist: "pass",
      sharedPrefixDecisions,
    },
    sanity: sanitySummary,
    sanityRobustnessNonOverlap: robustness,
    finalFit: {
      examples: finalFit.examples,
      finalLoss: finalFit.finalLoss,
      inSample: {
        meanNormalizedRank: finalInSample.meanNormalizedRank,
        top1Rate: finalInSample.top1Rate,
      },
    },
    rollouts: rolloutReport,
    phase1Gate,
    phase1Status,
    exitCodePolicy: "0 for a coherent experiment result (including BLOCK_REAL_ROLLOUT); non-zero only on invariant violation",
  };
}

function rolloutsPositive(rolloutReport) {
  if (!rolloutReport) return false;
  return rolloutReport.treatment.terminalRollouts > 0;
}

function main() {
  const args = parseArgs(process.argv);
  const result = runExperiment(args);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const s = result.sanity.aggregate;
  console.log("PR-5.25c learned-action-prior Phase 1");
  console.log(`  allowlist                 : ${result.dataset.allowlist.length} routes (${result.dataset.totals.examples} examples)`);
  console.log(`  witnesses excluded        : ${result.dataset.inventorySummary.witnessCount} (fixtures+latest), ${result.dataset.inventorySummary.generatedCount} generated`);
  console.log(`  shared prefix decisions   : ${result.invariants.sharedPrefixDecisions}`);
  console.log(`  sanity aggregate rank     : ${s.meanNormalizedRank.toFixed(4)} vs uniform 0.5000 (${result.sanity.status})`);
  console.log(`  sanity non-overlap rank   : ${result.sanityRobustnessNonOverlap.aggregateMeanNormalizedRank == null ? "n/a" : result.sanityRobustnessNonOverlap.aggregateMeanNormalizedRank.toFixed(4)} over ${result.sanityRobustnessNonOverlap.unseenTestExamples} unseen decisions`);
  if (result.rollouts) {
    const c = result.rollouts.control;
    const t = result.rollouts.treatment;
    console.log(`  rollout control   (${c.rollouts})   : terminal ${c.terminalRollouts}, MT4 ${c.mt4Reach}, MT5 ${c.mt5Reach}, meanSteps ${c.meanSteps.toFixed(1)}`);
    console.log(`  rollout treatment (${t.rollouts})   : terminal ${t.terminalRollouts}, MT4 ${t.mt4Reach}, MT5 ${t.mt5Reach}, meanSteps ${t.meanSteps.toFixed(1)}`);
  } else {
    console.log("  rollouts                  : not launched (sanity gate blocked)");
  }
  console.log(`  phase1Status              : ${result.phase1Status}`);
  console.log(`  result artifact           : ${path.relative(process.cwd(), args.out)}`);

  if (result.phase1Status === "BLOCK_REAL_ROLLOUT") {
    console.warn("  [BLOCKED] held-out sanity did not beat uniform; this is a preserved negative result, not an infrastructure failure.");
  }
}

main();
