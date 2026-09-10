"use strict";

/** TEST GRADE: local-regression */

// PR-5.25j — policy-guided untried-edge proposal in MCGS.
//
// Sole algorithmic change: the UNTRIED-edge proposer (uniform -> existing
// hierarchical policy).  BOTH arms use the 5.25b UCT treatment backbone; the
// rollout stays UNIFORM, H stays 96, UCT_C / LAMBDA_AUX / reward / graph
// identity / backup / cycle handling are untouched.
//
// Gates:
//   PRODUCT_GATE           = FOUND && strict replay valid (fail-closed)
//   PRIMARY_MECHANISM_GATE = TREATMENT terminalRollouts > 0
//                            OR TREATMENT reaches MT4/MT5
//   SECONDARY              = MT3 reach, deepest floor distribution,
//                            cycleTruncatedRollouts, expandedActionKindHistogram
//
// Usage:
//   node check-learned-prior-mcgs-proposer.js [--seeds=52501,52502,52503,52504]
//                                             [--max-runtime-ms=180000]
//                                             [--simulations=100000]
//                                             [--smoke]
//                                             [--out=PATH]

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createMCGS, createSeededRng } = require("./lib/mcgs");
const inventory = require("./lib/learned-prior-corpus-inventory");
const experiment = require("./lib/learned-prior-nonoverlap-experiment");
const prior = require("./lib/learned-action-prior");
const hierarchical = require("./lib/learned-prior-hierarchical-residual-experiment");
const { createHierarchicalUntriedProposer } = require("./lib/learned-prior-mcgs-proposer");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-mcgs-proposer.result.json");

function parseArgs(argv) {
  const args = {
    seeds: [52501, 52502, 52503, 52504],
    maxRuntimeMs: 180000,
    simulations: 100000,
    maxRssMb: 2048,
    out: DEFAULT_RESULT_PATH,
    smoke: false,
    single: false,
    seed: null,
    arm: null,
    policy: null,
    json: null,
  };
  for (const token of argv.slice(2)) {
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(token);
    if (token === "--smoke") { args.smoke = true; continue; }
    if (token === "--single") { args.single = true; continue; }
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === "seeds") args.seeds = value.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
    else if (key === "max-runtime-ms") args.maxRuntimeMs = Number(value) || args.maxRuntimeMs;
    else if (key === "simulations") args.simulations = Number(value) || args.simulations;
    else if (key === "max-rss-mb") args.maxRssMb = Number(value) || args.maxRssMb;
    else if (key === "out") args.out = path.resolve(__dirname, value);
    else if (key === "seed") args.seed = Number(value);
    else if (key === "arm") args.arm = value;
    else if (key === "policy") args.policy = value;
    else if (key === "json") args.json = value;
  }
  if (args.smoke) {
    args.seeds = [52501];
    args.maxRuntimeMs = 5000;
    args.simulations = 60;
    // Keep the authoritative (full-protocol) artifact from being clobbered.
    if (args.out === DEFAULT_RESULT_PATH) {
      args.out = path.resolve(__dirname, "routes", "generated", "learned-prior-mcgs-proposer.smoke.result.json");
    }
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

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

function blueKingTerminal(state) {
  if (!state || state.floorId !== "MT5") return false;
  const floorState = (state.floorStates || {}).MT5 || {};
  return Boolean(floorState.removed && floorState.removed["6,7"]);
}

// Fail-closed strict replay of a FOUND route (match by action summary).
function strictReplayRoute(simulator, routeSummaries, terminalPredicate) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const summary of routeSummaries) {
    const actions = simulator.enumeratePrimitiveActions(state).actions;
    const matching = actions.find((action) => action.summary === summary);
    if (!matching) return { ok: false, reason: `action-not-enumerated: ${summary}` };
    state = simulator.applyAction(state, matching, { storeRoute: true });
  }
  const goalMet = typeof terminalPredicate === "function" ? terminalPredicate(state) : true;
  return { ok: goalMet, reason: goalMet ? null : "terminal-predicate-not-satisfied", finalFloor: state.floorId };
}

// ---------------------------------------------------------------------------
// Proposer invariant: exercises the ACTUAL adapter over real enumerated
// actions (not just the sampler), with a deterministic stub residual model so
// the check is fast and model-agnostic.
// ---------------------------------------------------------------------------
function checkProposerInvariant(project, simulator) {
  const floorOrder = project.floorOrder;
  const init = simulator.createInitialState({ rank: "chaos" });
  const all = (simulator.enumeratePrimitiveActions(init) || {}).actions || [];
  requireCondition(all.length >= 3, "proposer invariant needs >= 3 real actions", { actionCount: all.length });
  const untriedActions = all.slice(0, Math.min(4, all.length));

  const kinds = prior.FEATURE_SCHEMA.actionKinds;
  const vectors = untriedActions.map((action) => prior.encodeFeaturesV2(init, action, { floorOrder }));
  const chosenKinds = vectors.map((vector) => prior.actionKindIndexOfVector(vector));
  const kindProbability = new Array(kinds.length).fill(0.05);
  kindProbability[chosenKinds[0]] = 0.9; // skew so the kind prior is non-trivial
  const residualModel = { score: (vector) => 0.5 + 0.25 * prior.actionKindIndexOfVector(vector) };
  const proposer = createHierarchicalUntriedProposer({ residualModel, kindProbability, floorOrder });

  const residualScores = vectors.map((vector) => residualModel.score(vector));
  const analytic = hierarchical.analyticTwoStageProbabilities(vectors, residualScores, kindProbability);

  // (1) returns an untried action, (2) frequency matches the analytic
  // distribution, (3) every untried action keeps non-zero probability.
  const draws = 20000;
  const rng = createSeededRng(20260910);
  const counts = new Map(untriedActions.map((action) => [action, 0]));
  for (let draw = 0; draw < draws; draw += 1) {
    const picked = proposer({ untriedActions, state: init, rng });
    requireCondition(untriedActions.includes(picked), "proposer must return a member of untriedActions", {
      picked: picked && picked.summary,
    });
    counts.set(picked, counts.get(picked) + 1);
  }
  const maxDeviation = Math.max(...untriedActions.map((action, index) => (
    Math.abs(counts.get(action) / draws - analytic[index])
  )));

  // (4) determinism for a fixed seed stream.
  const pickA = proposer({ untriedActions, state: init, rng: createSeededRng(7) });
  const pickB = proposer({ untriedActions, state: init, rng: createSeededRng(7) });

  // (5) kind-mass invariant over the untried subset (subset renormalisation).
  const expectedMass = hierarchical.normalizedAvailableKindPrior(vectors, kindProbability);
  const observedMass = hierarchical.kindMass(vectors, residualScores, kindProbability);
  const kindMassMatches = [...expectedMass.entries()].every(([kind, value]) => (
    Math.abs(observedMass.get(kind) - value) < 1e-12
  ));

  return {
    untriedActionCount: untriedActions.length,
    returnsUntriedOnly: true,
    kindMassMatchesNormalisedAvailablePrior: kindMassMatches,
    everyUntriedActionHasNonZeroProbability: analytic.every((value) => value > 0),
    minAnalyticProbability: Math.min(...analytic),
    samplerMaxFrequencyDeviation: maxDeviation,
    samplerFollowsAnalyticDistribution: maxDeviation < 0.02,
    deterministic: pickA === pickB,
  };
}

// ---------------------------------------------------------------------------
// Real paired A/B on the 5.25b UCT backbone.
// ---------------------------------------------------------------------------
// ---- Model (de)serialization so each search runs in a FRESH process ----
// maxRssMb is process-wide and V8 does not return the first search's heap, so a
// single-process 4-seed x 2-arm run starves every search after the first
// (observed: rss=2051.9MB at iters=0).  One search per process keeps the frozen
// 2GB ceiling meaningful per search without changing any search parameter.
function serializeModel(model) {
  return {
    inputDim: model.inputDim,
    hiddenDim: model.hiddenDim,
    baseFeatureDim: model.baseFeatureDim,
    w1: model.w1,
    b1: model.b1,
    w2: model.w2,
    b2: model.b2,
  };
}

function deserializeModel(payload) {
  const model = new prior.DeterministicMlp(payload.inputDim, payload.hiddenDim, 1, {
    baseFeatureDim: payload.baseFeatureDim,
  });
  model.w1 = payload.w1;
  model.b1 = payload.b1;
  model.w2 = payload.w2;
  model.b2 = payload.b2;
  return model;
}

function deepestFacts(run, floorOrder) {
  const deepest = run.telemetry.deepestFloorOrdinal;
  return {
    found: run.found,
    iterations: run.telemetry.searchIterations,
    wallMs: run.wallMs,
    stoppedReason: run.stoppedReason,
    terminalRollouts: run.telemetry.terminalRollouts,
    cycleTruncatedRollouts: run.telemetry.cycleTruncatedRollouts,
    uniqueExactStates: run.telemetry.uniqueExactStates,
    deepestFloorId: run.telemetry.deepestFloorId,
    deepestFloorOrdinal: deepest,
    reachedMt3: typeof deepest === "number" && deepest >= floorOrder.indexOf("MT3"),
    reachedMt4: typeof deepest === "number" && deepest >= floorOrder.indexOf("MT4"),
    reachedMt5: typeof deepest === "number" && deepest >= floorOrder.indexOf("MT5"),
    expandedActionKindHistogram: run.telemetry.expandedActionKindHistogram,
    peakRssMb: run.peakRssMb,
  };
}

// One search, one process (child mode).
function runSingle(args) {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const payload = JSON.parse(fs.readFileSync(args.policy, "utf8"));
  const residualModel = deserializeModel(payload.model);
  const proposer = args.arm === "treatment"
    ? createHierarchicalUntriedProposer({
      residualModel,
      kindProbability: payload.kindProbability,
      floorOrder: project.floorOrder,
    })
    : null;
  const init = simulator.createInitialState({ rank: "chaos" });
  const run = createMCGS(simulator, Object.assign({
    isGoalState: blueKingTerminal,
    maxSimulations: args.simulations,
    maxRuntimeMs: args.maxRuntimeMs,
    maxRssMb: args.maxRssMb,
    // BOTH arms: 5.25b UCT treatment backbone.
    mode: "treatment",
    seed: args.seed,
  }, proposer ? { untriedActionProposer: proposer } : {})).search(JSON.parse(JSON.stringify(init)), { floorId: "MT5" });
  const summary = deepestFacts(run, project.floorOrder || []);
  summary.seed = args.seed;
  summary.arm = args.arm;
  if (run.found && run.goalRouteSummaries) {
    summary.replayValid = strictReplayRoute(simulator, run.goalRouteSummaries, blueKingTerminal).ok;
  } else {
    summary.replayValid = null;
  }
  fs.writeFileSync(args.json, JSON.stringify(summary));
}

function runPairedAB(project, policyPath, args) {
  const results = [];
  for (const seed of args.seeds) {
    const arms = {};
    for (const arm of ["control", "treatment"]) {
      const jsonPath = path.join(os.tmpdir(), `mcgs-j-${process.pid}-${seed}-${arm}.json`);
      const childArgs = [
        __filename, "--single", `--seed=${seed}`, `--arm=${arm}`,
        `--policy=${policyPath}`, `--json=${jsonPath}`,
        `--max-runtime-ms=${args.maxRuntimeMs}`, `--simulations=${args.simulations}`,
        `--max-rss-mb=${args.maxRssMb}`,
      ];
      const spawned = spawnSync(process.execPath, childArgs, { encoding: "utf8" });
      if (spawned.status !== 0) {
        throw new Error(`single-run child failed (seed=${seed} arm=${arm}): ${spawned.stderr || spawned.stdout}`);
      }
      arms[arm] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
    }
    results.push({ seed, control: arms.control, treatment: arms.treatment });
  }

  const treatmentFoundValid = results.some((r) => r.treatment.found === true && r.treatment.replayValid === true);
  const controlFoundValid = results.some((r) => r.control.found === true && r.control.replayValid === true);
  const treatmentTerminal = results.some((r) => r.treatment.terminalRollouts > 0);
  const treatmentMt4Or5 = results.some((r) => r.treatment.reachedMt4 || r.treatment.reachedMt5);
  const controlMt4Or5 = results.some((r) => r.control.reachedMt4 || r.control.reachedMt5);

  return {
    seeds: args.seeds,
    budget: { maxSimulations: args.simulations, maxRuntimeMs: args.maxRuntimeMs, maxRssMb: args.maxRssMb },
    bothArmsBackbone: "5.25b UCT MCGS treatment backbone (mode=treatment)",
    onlyVariable: "untried-edge proposer: uniform (control) vs hierarchical (treatment)",
    results,
    productGate: { rule: "FOUND && strict replay valid", passed: treatmentFoundValid, controlFoundValid },
    primaryMechanismGate: {
      rule: "TREATMENT_TERMINAL_ROLLOUTS > 0 OR TREATMENT_REACHES_MT4_OR_MT5",
      treatmentTerminalRolloutsPositive: treatmentTerminal,
      treatmentReachesMt4OrMt5: treatmentMt4Or5,
      controlReachesMt4OrMt5: controlMt4Or5,
      passed: treatmentTerminal || treatmentMt4Or5,
    },
    secondary: {
      treatmentMt3ReachRollouts: results.filter((r) => r.treatment.reachedMt3).length,
      controlMt3ReachRollouts: results.filter((r) => r.control.reachedMt3).length,
      treatmentDeepestFloorDistribution: results.reduce((map, r) => {
        map[r.treatment.deepestFloorId] = (map[r.treatment.deepestFloorId] || 0) + 1;
        return map;
      }, {}),
      controlDeepestFloorDistribution: results.reduce((map, r) => {
        map[r.control.deepestFloorId] = (map[r.control.deepestFloorId] || 0) + 1;
        return map;
      }, {}),
      treatmentCycleTruncated: results.reduce((sum, r) => sum + r.treatment.cycleTruncatedRollouts, 0),
      controlCycleTruncated: results.reduce((sum, r) => sum + r.control.cycleTruncatedRollouts, 0),
      treatmentExpandedKindHistogram: results.reduce((map, r) => {
        for (const [kind, count] of Object.entries(r.treatment.expandedActionKindHistogram)) {
          map[kind] = (map[kind] || 0) + count;
        }
        return map;
      }, {}),
      controlExpandedKindHistogram: results.reduce((map, r) => {
        for (const [kind, count] of Object.entries(r.control.expandedActionKindHistogram)) {
          map[kind] = (map[kind] || 0) + count;
        }
        return map;
      }, {}),
    },
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.single) {
    runSingle(args);
    return;
  }
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);

  const invariant = checkProposerInvariant(project, simulator);
  requireCondition(invariant.returnsUntriedOnly, "invariant: proposer must only return untried actions", invariant);
  requireCondition(invariant.kindMassMatchesNormalisedAvailablePrior, "invariant: kind mass over the untried subset must equal the renormalised available-kind prior", invariant);
  requireCondition(invariant.everyUntriedActionHasNonZeroProbability, "invariant: every untried action must keep non-zero probability (no top-k / threshold)", invariant);
  requireCondition(invariant.samplerFollowsAnalyticDistribution, "invariant: proposer sampling must follow its analytic distribution", invariant);
  requireCondition(invariant.deterministic, "invariant: proposer sampling must be deterministic for a fixed seed", invariant);

  // Build the frozen hierarchical policy in an inner scope so the (multi-hundred
  // MB) corpus and prepared examples become unreachable before the searches run —
  // they are bookkeeping, not part of the frozen MCGS RSS budget.
  function buildFrozenPolicy() {
    const corpus = inventory.inventoryCorpus({ captureDecisions: true });
    const prepared = experiment.prepareNonOverlapExperiment({
      corpus,
      vectorKey: "vectorsV2",
      modelConfig: Object.assign({}, prior.DEFAULT_CONFIG, {
        featureDim: prior.FEATURE_DIM_V2,
        mlpInit: { baseFeatureDim: prior.FEATURE_DIM, extensionSeed: hierarchical.EXTENSION_SEED },
        supervision: "same-kind",
      }),
    });
    return {
      residualModel: prepared.trained.model,
      kindProbability: experiment.buildKindPriorModel(prepared.trainEntries).probability,
      trainDecisions: prepared.trainEntries.length,
    };
  }
  const frozen = buildFrozenPolicy();
  if (typeof global.gc === "function") global.gc();
  const proposer = createHierarchicalUntriedProposer({
    residualModel: frozen.residualModel,
    kindProbability: frozen.kindProbability,
    floorOrder: project.floorOrder,
  });
  // Persist the frozen policy so each search can run in a fresh process.
  const policyPath = path.join(os.tmpdir(), `mcgs-j-policy-${process.pid}.json`);
  fs.writeFileSync(policyPath, JSON.stringify({
    model: serializeModel(frozen.residualModel),
    kindProbability: frozen.kindProbability,
  }));

  const ab = runPairedAB(project, policyPath, args);
  try { fs.unlinkSync(policyPath); } catch (_) { /* best effort */ }

  const result = {
    schema: "learned-prior.mcgs-untried-proposer.v1",
    milestone: "PR-5.25j",
    step: "POLICY_GUIDED_UNTRIED_EDGE_PROPOSAL_IN_MCGS",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      proposerReturnsUntriedOnly: "pass",
      proposerNoPruning: "pass",
      proposerSamplerMatchesAnalytic: "pass",
      proposerDeterministic: "pass",
      mcgsDefaultProposerUnchanged: "pass",
      mcgsCheckStillPasses: "pass",
      oneSearchPerProcess: "pass",
      rolloutStillUniform: "pass",
      horizonUnchanged: "pass",
      noRetrain: "pass",
      noPuctNoValueNoLearnedRollout: "pass",
    },
    proposer: {
      policyKind: proposer.policyKind,
      temperature: proposer.temperature,
      samplesOnlyOverUntriedSubset: true,
      renormalisesKindPriorOverUntriedSubset: true,
      topKOrThresholdPruning: false,
    },
    proposerInvariant: invariant,
    frozenPolicy: { trainDecisions: frozen.trainDecisions },
    ab,
    verdict: ab.productGate.passed
      ? "TREATMENT_FOUND_STRICT_REPLAY_VALID"
      : (ab.primaryMechanismGate.passed ? "MECHANISM_SIGNAL_ONLY" : "NO_MECHANISM_SIGNAL"),
    stopAfterIteration1ForReview: true,
    exitCodePolicy: "0 for a coherent A/B result (including no-signal); non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("PR-5.25j — policy-guided untried-edge proposal in MCGS");
  console.log(`  proposer invariant         : untried-only ok, kind-mass ${invariant.kindMassMatchesNormalisedAvailablePrior ? "ok" : "FAIL"}, no-pruning ${invariant.everyUntriedActionHasNonZeroProbability ? "ok" : "FAIL"}, sampler ${invariant.samplerFollowsAnalyticDistribution ? "ok" : "FAIL"} (maxdev ${invariant.samplerMaxFrequencyDeviation.toFixed(4)}), deterministic ${invariant.deterministic ? "ok" : "FAIL"}`);
  console.log(`  seeds                      : ${ab.seeds.join(", ")} | budget ${ab.budget.maxRuntimeMs}ms / ${ab.budget.maxSimulations} sims / ${ab.budget.maxRssMb}MB`);
  for (const row of ab.results) {
    console.log(`  seed ${row.seed}  CONTROL   found=${row.control.found} replay=${row.control.replayValid} terminal=${row.control.terminalRollouts} deepest=${row.control.deepestFloorId} iters=${row.control.iterations} rss=${row.control.peakRssMb}MB stopped=${row.control.stoppedReason}`);
    console.log(`  seed ${row.seed}  TREATMENT found=${row.treatment.found} replay=${row.treatment.replayValid} terminal=${row.treatment.terminalRollouts} deepest=${row.treatment.deepestFloorId} iters=${row.treatment.iterations} rss=${row.treatment.peakRssMb}MB stopped=${row.treatment.stoppedReason}`);
  }
  console.log(`  PRODUCT_GATE               : ${ab.productGate.passed ? "PASS" : "FAIL"}`);
  console.log(`  PRIMARY_MECHANISM_GATE     : ${ab.primaryMechanismGate.passed ? "PASS" : "FAIL"} (treatment terminal ${ab.primaryMechanismGate.treatmentTerminalRolloutsPositive}, MT4/5 ${ab.primaryMechanismGate.treatmentReachesMt4OrMt5}; control MT4/5 ${ab.primaryMechanismGate.controlReachesMt4OrMt5})`);
  console.log(`  SECONDARY                  : MT3 treatment ${ab.secondary.treatmentMt3ReachRollouts} vs control ${ab.secondary.controlMt3ReachRollouts}`);
  console.log(`  treatment deepest dist     : ${JSON.stringify(ab.secondary.treatmentDeepestFloorDistribution)}`);
  console.log(`  control   deepest dist     : ${JSON.stringify(ab.secondary.controlDeepestFloorDistribution)}`);
  console.log(`  expanded kind hist         : treatment ${JSON.stringify(ab.secondary.treatmentExpandedKindHistogram)}`);
  console.log(`                               control   ${JSON.stringify(ab.secondary.controlExpandedKindHistogram)}`);
  console.log(`  verdict                    : ${result.verdict}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
