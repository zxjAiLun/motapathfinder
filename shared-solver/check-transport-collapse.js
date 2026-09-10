"use strict";

/**
 * PR-5.25l — Transport-Collapsed Irreversible Decision Search: gates.
 *
 *   4 micros on a stub simulator (the dangerous correctness edges)
 *   Phase 1 real probe: CHAOS MT1 -> REACH MT3, region MT1..MT3
 *   Phase 2 real qualification (only if Phase 1 passes): CHAOS MT1 -> MT5 blueKing
 *
 * CONTROL   = PR-5.25a event-forward search, evaluator OFF
 * TREATMENT = transport-collapsed search, no scorer
 * SAME      = simulator, exact state semantics, terminal predicate, region,
 *             wall, RSS, expansion ceiling
 *
 * One search per child process: `maxRssMb` is process-wide and V8 does not
 * return freed heap (PR-5.25j), so sequential in-process searches would starve
 * each other.
 *
 * Usage:
 *   node check-transport-collapse.js [--smoke] [--phase1-only] [--out=PATH]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createEventForwardSearch } = require("./lib/event-forward-search");
const { createTransportCollapsedSearch, transportSignature } = require("./lib/transport-collapse");
const { buildStateKey } = require("./lib/state-key");
const { cloneState } = require("./lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "transport-collapse-phase1.result.json");

function parseArgs(argv) {
  const args = {
    smoke: false,
    phase1Only: false,
    out: DEFAULT_RESULT_PATH,
    child: false,
    arm: null,
    phase: null,
    maxExpansions: 120000,
    maxRuntimeMs: 180000,
    maxRssMb: 2048,
    json: null,
  };
  for (const token of argv.slice(2)) {
    if (token === "--smoke") { args.smoke = true; continue; }
    if (token === "--phase1-only") { args.phase1Only = true; continue; }
    if (token === "--child") { args.child = true; continue; }
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(token);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "arm") args.arm = value;
    else if (key === "phase") args.phase = Number(value);
    else if (key === "out") args.out = path.resolve(__dirname, value);
    else if (key === "json") args.json = value;
    else if (key === "max-expansions") args.maxExpansions = Number(value);
    else if (key === "max-runtime-ms") args.maxRuntimeMs = Number(value);
    else if (key === "max-rss-mb") args.maxRssMb = Number(value);
  }
  if (args.smoke) {
    args.phase1Only = true;
    args.maxExpansions = 4000;
    args.maxRuntimeMs = 20000;
    if (args.out === DEFAULT_RESULT_PATH) {
      args.out = path.resolve(__dirname, "routes", "generated", "transport-collapse.smoke.result.json");
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

// ---------------------------------------------------------------------------
// Stub simulator: a tiny, fully controlled world for the correctness micros.
// ---------------------------------------------------------------------------

function stubState(options) {
  const config = options || {};
  const floorId = config.floorId || "MT1";
  const visited = config.visited || [floorId];
  const state = {
    floorId,
    hero: {
      hp: 100, hpmax: 100, mana: 0, manamax: 0, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: config.x == null ? 0 : config.x, y: config.y == null ? 0 : config.y, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {}, visitedFloors: {},
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
  for (const id of visited) state.visitedFloors[id] = true;
  if (config.flags) state.flags = Object.assign({}, config.flags);
  return state;
}

function stubAction(summary, kind, apply) {
  return { summary, kind, __apply: apply };
}

function createStubSimulator(actionProvider) {
  return {
    enumeratePrimitiveActions(state) {
      return { actions: actionProvider(state) || [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function stubReplay(startState, summaries, simulator) {
  let state = cloneState(startState);
  for (const summary of summaries) {
    const actions = simulator.enumeratePrimitiveActions(state).actions;
    const matching = actions.find((action) => action.summary === summary);
    if (!matching) return { ok: false, reason: `action-not-enumerated: ${summary}` };
    state = simulator.applyAction(state, matching, { storeRoute: true });
  }
  return { ok: true, finalKey: buildStateKey(state) };
}

/**
 * Micro 1 — PURE_PING_PONG: A<->B change nothing but floor and position, so the
 * closure walks both but must not create a single strategic branch.
 */
function microPurePingPong() {
  const toB = (state) => { state.floorId = "MT2"; state.hero.loc = { x: 0, y: 0, direction: "down" }; };
  const toA = (state) => { state.floorId = "MT1"; state.hero.loc = { x: 0, y: 0, direction: "down" }; };
  const simulator = createStubSimulator((state) => (
    state.floorId === "MT1"
      ? [stubAction("transport:A->B", "changeFloor", toB)]
      : [stubAction("transport:B->A", "changeFloor", toA)]
  ));
  const start = stubState({ floorId: "MT1", visited: ["MT1", "MT2"] });
  const search = createTransportCollapsedSearch(simulator);
  const result = search.search(start, { isGoalState: () => false, maxExpansions: 50 });
  requireCondition(result.transportClosureVisited === 2, "PURE_PING_PONG: closure must visit both states", result);
  requireCondition(result.transportActionsAbsorbed === 2, "PURE_PING_PONG: both directions must be absorbed", result);
  requireCondition(result.strategicBranches === 0, "PURE_PING_PONG: no strategic branch may be created", result);
  requireCondition(result.exactSuccessors === 0, "PURE_PING_PONG: no successor may be registered", result);
  requireCondition(result.found === false && result.searchComplete === true, "PURE_PING_PONG: the closure must be exhausted", result);
  return { micro: "PURE_PING_PONG", pass: true, closureStates: result.transportClosureVisited, absorbed: result.transportActionsAbsorbed, strategicBranches: result.strategicBranches };
}

/**
 * Micro 2 — FIRST_ARRIVE_MUTATION: a changeFloor that records the new floor (or
 * sets a flag) is a world change and must stay a strategic branch.
 */
function microFirstArriveMutation() {
  const climb = (state) => { state.floorId = "MT2"; state.visitedFloors.MT2 = true; };
  const climbWithFlag = (state) => { state.floorId = "MT2"; state.flags.firstArriveMT2 = 1; };
  const results = [];
  for (const [label, apply] of [["visited-floor", climb], ["flag", climbWithFlag]]) {
    const simulator = createStubSimulator(() => [stubAction(`climb:${label}`, "changeFloor", apply)]);
    const start = stubState({ floorId: "MT1", visited: ["MT1"] });
    const search = createTransportCollapsedSearch(simulator);
    const result = search.search(start, { isGoalState: (state) => state.floorId === "MT2", maxExpansions: 10 });
    requireCondition(result.transportActionsAbsorbed === 0, `FIRST_ARRIVE_MUTATION(${label}): must not be absorbed`, result);
    requireCondition(result.strategicBranches === 1, `FIRST_ARRIVE_MUTATION(${label}): must be one strategic branch`, result);
    requireCondition(result.found === true, `FIRST_ARRIVE_MUTATION(${label}): the mutation must stay searchable`, result);
    // The signature must actually differ: guard against an over-broad signature.
    requireCondition(
      transportSignature(start) !== transportSignature(simulator.applyAction(start, simulator.enumeratePrimitiveActions(start).actions[0])),
      `FIRST_ARRIVE_MUTATION(${label}): signature must change`,
    );
    results.push({ label, absorbed: result.transportActionsAbsorbed, strategicBranches: result.strategicBranches });
  }
  return { micro: "FIRST_ARRIVE_MUTATION", pass: true, cases: results };
}

/**
 * Micro 3 — ONE_WAY_TRANSPORT: A->B with no B->A must collapse into navigation
 * without inventing a return edge.
 */
function microOneWayTransport() {
  const toB = (state) => { state.floorId = "MT2"; state.hero.loc = { x: 1, y: 1, direction: "down" }; };
  const simulator = createStubSimulator((state) => (
    state.floorId === "MT1" ? [stubAction("transport:A->B", "changeFloor", toB)] : []
  ));
  const start = stubState({ floorId: "MT1", visited: ["MT1", "MT2"] });
  const search = createTransportCollapsedSearch(simulator);
  const result = search.search(start, { isGoalState: () => false, maxExpansions: 10 });
  requireCondition(result.transportClosureVisited === 2, "ONE_WAY_TRANSPORT: only the reachable direction may appear", result);
  requireCondition(result.transportActionsAbsorbed === 1, "ONE_WAY_TRANSPORT: exactly one transport action", result);
  requireCondition(result.strategicBranches === 0 && result.found === false, "ONE_WAY_TRANSPORT: no phantom branch or return", result);
  return { micro: "ONE_WAY_TRANSPORT", pass: true, closureStates: result.transportClosureVisited, absorbed: result.transportActionsAbsorbed };
}

/**
 * Micro 4 — REPLAY: the macro chain must expand back to the identical primitive
 * execution, so strict replay remains the final authority.
 */
function microReplay() {
  const walk = (state) => { state.hero.loc.x += 1; };
  const walkBack = (state) => { state.hero.loc.x -= 1; };
  const battle = (state) => { state.hero.exp += 1; };
  const simulator = createStubSimulator((state) => {
    const actions = [];
    if (state.floorId === "MT1" && state.hero.loc.x < 2) actions.push(stubAction(`walk:${state.hero.loc.x}`, "event", walk));
    if (state.floorId === "MT1" && state.hero.loc.x > 0) actions.push(stubAction(`walkBack:${state.hero.loc.x}`, "event", walkBack));
    if (state.floorId === "MT1" && state.hero.loc.x === 2) actions.push(stubAction("battle:boss", "battle", battle));
    if (state.floorId === "MT1" && state.hero.exp >= 1) actions.push(stubAction("changeFloor:MT1->MT2", "changeFloor", (next) => { next.floorId = "MT2"; next.visitedFloors.MT2 = true; }));
    return actions;
  });
  const start = stubState({ floorId: "MT1", visited: ["MT1"] });
  const search = createTransportCollapsedSearch(simulator);
  const result = search.search(start, { isGoalState: (state) => state.hero.exp >= 1, maxExpansions: 50 });
  requireCondition(result.found === true, "REPLAY: the stub goal must be found", result);
  const expected = ["walk:0", "walk:1", "battle:boss"];
  requireCondition(
    JSON.stringify(result.route) === JSON.stringify(expected),
    "REPLAY: the macro chain must be the full transport+strategic summary sequence",
    { route: result.route, expected },
  );
  const replay = stubReplay(start, result.route, simulator);
  requireCondition(replay.ok, "REPLAY: every macro summary must re-enumerate", replay);
  requireCondition(replay.finalKey === buildStateKey(result.finalState), "REPLAY: macro expansion must equal primitive execution", {
    replay: replay.finalKey, search: buildStateKey(result.finalState),
  });
  return { micro: "REPLAY", pass: true, route: result.route, replayMatchesSearch: true };
}

function runMicros() {
  const micros = [microPurePingPong(), microFirstArriveMutation(), microOneWayTransport(), microReplay()];
  requireCondition(micros.every((micro) => micro.pass), "every micro must pass", micros);
  return micros;
}

// ---------------------------------------------------------------------------
// Real phases (one search per child process)
// ---------------------------------------------------------------------------

const PHASES = {
  1: { label: "MT1->MT3", allowedFloors: ["MT1", "MT2", "MT3"] },
  2: { label: "MT1->MT5-blueKing", allowedFloors: ["MT1", "MT2", "MT3", "MT4", "MT5"] },
};

function goalForPhase(phase) {
  if (phase === 1) return (state) => state.floorId === "MT3";
  return (state) => {
    if (state.floorId !== "MT5") return false;
    const floorState = (state.floorStates || {}).MT5 || {};
    return Boolean(floorState.removed && floorState.removed["6,7"]);
  };
}

function strictReplayPrimitive(simulator, summaries) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const summary of summaries) {
    const actions = simulator.enumeratePrimitiveActions(state).actions;
    const matching = actions.find((action) => action.summary === summary);
    if (!matching) return { ok: false, reason: `action-not-enumerated: ${summary}` };
    state = simulator.applyAction(state, matching, { storeRoute: true });
  }
  return { ok: true, finalFloor: state.floorId, finalKey: buildStateKey(state) };
}

function runChild(args) {
  const phase = args.phase;
  const arm = args.arm;
  requireCondition(PHASES[phase], `unknown phase ${phase}`);
  requireCondition(arm === "control" || arm === "treatment", `unknown arm ${arm}`);
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const start = simulator.createInitialState({ rank: "chaos" });
  const isGoalState = goalForPhase(phase);
  const budget = {
    maxExpansions: args.maxExpansions,
    maxRuntimeMs: args.maxRuntimeMs,
    maxRssMb: args.maxRssMb,
  };
  const searchConfig = Object.assign({ isGoalState, allowedFloors: PHASES[phase].allowedFloors }, budget);

  let result;
  if (arm === "control") {
    result = createEventForwardSearch(simulator).search(JSON.parse(JSON.stringify(start)), searchConfig);
  } else {
    result = createTransportCollapsedSearch(simulator).search(JSON.parse(JSON.stringify(start)), searchConfig);
  }

  let replay = null;
  if (result.found && result.route) {
    replay = strictReplayPrimitive(simulator, result.route);
  }
  const summary = {
    phase,
    phaseLabel: PHASES[phase].label,
    arm,
    budget,
    found: result.found,
    replayValid: replay ? replay.ok : null,
    replayReason: replay && !replay.ok ? replay.reason : null,
    routeLength: result.route ? result.route.length : null,
    stoppedReason: result.stoppedReason,
    searchComplete: result.searchComplete,
    wallMs: result.wallMs,
    peakRssMb: result.peakRssMb,
    registrySize: result.registrySize,
    duplicatesSkipped: result.duplicatesSkipped,
    controlExpansions: result.expansions == null ? null : result.expansions,
    strategicExpansions: result.strategicExpansions == null ? null : result.strategicExpansions,
    strategicBranches: result.strategicBranches == null ? null : result.strategicBranches,
    exactSuccessors: result.exactSuccessors == null ? null : result.exactSuccessors,
    transportActionsAbsorbed: result.transportActionsAbsorbed == null ? null : result.transportActionsAbsorbed,
    transportClosureVisited: result.transportClosureVisited == null ? null : result.transportClosureVisited,
    signatureCalls: result.signatureCalls == null ? null : result.signatureCalls,
    signatureWallMs: result.signatureWallMs == null ? null : result.signatureWallMs,
    deepestFloorOrdinal: result.deepestFloorOrdinal == null ? null : result.deepestFloorOrdinal,
    deepestFloorHistogram: result.deepestFloorHistogram == null ? null : result.deepestFloorHistogram,
    deepestStrategicDepth: result.deepestStrategicDepth == null ? null : result.deepestStrategicDepth,
  };
  fs.writeFileSync(args.json, JSON.stringify(summary));
}

function spawnArm(args, phase, arm) {
  const jsonPath = path.join(os.tmpdir(), `transport-collapse-${process.pid}-${phase}-${arm}.json`);
  const childArgs = [
    __filename, "--child", `--phase=${phase}`, `--arm=${arm}`, `--json=${jsonPath}`,
    `--max-expansions=${args.maxExpansions}`, `--max-runtime-ms=${args.maxRuntimeMs}`,
    `--max-rss-mb=${args.maxRssMb}`,
  ];
  const spawned = spawnSync(process.execPath, childArgs, { encoding: "utf8" });
  if (spawned.status !== 0) {
    throw new Error(`child (phase ${phase} ${arm}) failed: ${spawned.stderr || spawned.stdout}`);
  }
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.child) {
    runChild(args);
    return;
  }

  const micros = runMicros();
  const phase1 = {
    control: spawnArm(args, 1, "control"),
    treatment: spawnArm(args, 1, "treatment"),
  };
  const localGate = {
    rule: "TREATMENT_MT3_FOUND AND STRICT_REPLAY_VALID",
    treatmentFound: phase1.treatment.found,
    treatmentReplayValid: phase1.treatment.replayValid,
    passed: Boolean(phase1.treatment.found && phase1.treatment.replayValid === true),
  };

  let phase2 = null;
  let fullProductGate = null;
  if (localGate.passed && !args.phase1Only) {
    phase2 = {
      control: spawnArm(args, 2, "control"),
      treatment: spawnArm(args, 2, "treatment"),
    };
    fullProductGate = {
      rule: "MT5_BLUEKING_FOUND AND STRICT_REPLAY_VALID",
      treatmentFound: phase2.treatment.found,
      treatmentReplayValid: phase2.treatment.replayValid,
      passed: Boolean(phase2.treatment.found && phase2.treatment.replayValid === true),
    };
  }

  const result = {
    schema: "transport-collapse.gates.v1",
    milestone: "PR-5.25l",
    title: "TRANSPORT_COLLAPSED_IRREVERSIBLE_DECISION_SEARCH",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    protocol: {
      control: "PR-5.25a event-forward search, evaluator OFF",
      treatment: "transport-collapsed search, no scorer",
      same: "simulator, exact state semantics, terminal predicate, region, wall, RSS, expansion ceiling",
      transportDetection: "SIMULATED_STATE_DELTA, never action kind",
      globalStateMerge: "NONE",
      heuristic: "NONE",
      learnedPolicy: "NONE",
      manualSubgoals: "NONE",
      routeHints: "NONE",
      oneSearchPerProcess: true,
    },
    micros,
    phase1,
    localGate,
    phase2,
    fullProductGate,
    verdict: localGate.passed
      ? (fullProductGate && fullProductGate.passed ? "FULL_PRODUCT_GATE_PASSED" : "LOCAL_GATE_ONLY")
      : "LOCAL_GATE_FAILED",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("PR-5.25l — transport-collapsed irreversible decision search");
  for (const micro of micros) console.log(`  micro ${micro.micro.padEnd(24)} pass`);
  for (const [name, phase] of [["phase1", phase1], ["phase2", phase2]]) {
    if (!phase) continue;
    for (const arm of ["control", "treatment"]) {
      const row = phase[arm];
      const expansions = row.controlExpansions == null ? `strategic ${row.strategicExpansions}` : `expansions ${row.controlExpansions}`;
      console.log(`  ${name} ${arm.padEnd(9)} found=${row.found} replay=${row.replayValid} ${expansions} absorbed=${row.transportActionsAbsorbed} closure=${row.transportClosureVisited} deepest=${row.deepestFloorOrdinal} stopped=${row.stoppedReason} wall=${row.wallMs}ms rss=${row.peakRssMb}MB`);
    }
  }
  console.log(`  LOCAL_GATE                 ${localGate.passed ? "PASS" : "FAIL"}`);
  if (fullProductGate) console.log(`  FULL_PRODUCT_GATE          ${fullProductGate.passed ? "PASS" : "FAIL"}`);
  console.log(`  verdict                    ${result.verdict}`);
  console.log(`  result artifact            ${path.relative(process.cwd(), args.out)}`);
}

main();
