"use strict";
/**
 * PR-5.25o - Bounded Candidate Search Capability Qualification.
 *
 * CAPABILITY qualification, not a causal throughput A/B study. The question is
 * not "how much faster is pruning?" but "can the solver autonomously find a
 * correct MT1 -> MT3 route at all, once it may genuinely DISCARD candidates?"
 *
 * Pipeline (all pre-existing): StaticSimulator -> transport-collapsed
 * strategic successors -> autonomous dependency frontier -> 5.25n ordering.
 *
 * Single new variable: pendingCandidateCap. When pending candidates exceed the
 * cap, keep the ones the existing ordering would expand first and truly DROP
 * the rest. Dropped candidates do not enter a neutral fallback queue and never
 * return. Completeness is explicitly abandoned; correctness is not.
 *
 * Two predeclared attempts. Attempt 2 only enlarges capacity; no new mechanism
 * may be invented after seeing Attempt 1.
 *
 *   ATTEMPT_1: PENDING_CANDIDATE_CAP = 256
 *   ATTEMPT_2: PENDING_CANDIDATE_CAP = 1024
 *
 * Both frozen: CHAOS_MT1 -> floorReached(MT3), region MT1..MT3, 180s, 2048MB,
 * 120000 strategic expansions, fresh child process per attempt, no training,
 * no witness in search, no manual milestone, no recursive subgoal, no
 * backtracking.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { verifyStrictReplay: verifyStrictReplayShared } = require("./lib/strict-replay");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "bounded-candidate.result.json");

// Predeclared capacities. Frozen before execution; order matters (stop on first FOUND).
const ATTEMPTS = [256, 1024];

// Frozen capability budget.
const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3"],
  goalFloorId: "MT3",
  maxRuntimeMs: 180000,
  maxRssMb: 2048,
  maxExpansions: 120000,
  freshChildProcess: true,
  training: "NONE",
  witnessInSearch: "NONE",
  manualMilestone: "NONE",
  recursiveSubgoal: "NONE",
  backtracking: "NONE",
};

function parseArgs(argv) {
  const args = {
    smoke: false,
    out: DEFAULT_RESULT_PATH,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    maxExpansions: FROZEN.maxExpansions,
    child: false,
    cap: null,
    json: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--smoke") { args.smoke = true; continue; }
    if (token.startsWith("--out=")) { args.out = path.resolve(token.slice("--out=".length)); continue; }
    if (token.startsWith("--max-runtime-ms=")) { args.maxRuntimeMs = Number(token.slice("--max-runtime-ms=".length)); continue; }
    if (token.startsWith("--max-rss-mb=")) { args.maxRssMb = Number(token.slice("--max-rss-mb=".length)); continue; }
    if (token.startsWith("--max-expansions=")) { args.maxExpansions = Number(token.slice("--max-expansions=".length)); continue; }
    if (token.startsWith("--cap=")) { args.cap = Number(token.slice("--cap=".length)); continue; }
    if (token.startsWith("--json=")) { args.json = token.slice("--json=".length); continue; }
    if (token === "--child") { args.child = true; continue; }
  }
  if (args.smoke) {
    args.maxRuntimeMs = 20000;
    args.out = path.resolve(__dirname, "routes", "generated", "bounded-candidate.smoke.result.json");
  }
  return args;
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

/**
 * Strict replay gate. Every step must resolve to exactly one action, no lethal
 * transition, replayed terminal key must equal searched final key, and goal
 * must be re-asserted on the replayed terminal state.
 */
function verifyStrictReplay(simulator, route, options) {
  return verifyStrictReplayShared(simulator, route, options);
}

function runChild(args) {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const terminalGoal = { type: "floorReached", floorId: FROZEN.goalFloorId };
  const isGoalState = (state) => state.floorId === FROZEN.goalFloorId;

  const search = createTransportCollapsedSearch(simulator);
  const frontierReport = buildDependencyFrontier(project, initialState, terminalGoal);

  const result = search.search(initialState, {
    isGoalState,
    allowedFloors: FROZEN.region,
    maxExpansions: args.maxExpansions,
    maxRuntimeMs: args.maxRuntimeMs,
    maxRssMb: args.maxRssMb,
    frontierSet: frontierReport.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: args.cap,
  });

  let replay = null;
  if (result.found && result.route) {
    replay = verifyStrictReplay(simulator, result.route, {
      initialState,
      isGoalState,
      expectedFinalState: result.finalState,
      routeTrace: result.routeTrace,
    });
  }

  const summary = {
    cap: args.cap,
    budget: {
      maxExpansions: args.maxExpansions,
      maxRuntimeMs: args.maxRuntimeMs,
      maxRssMb: args.maxRssMb,
    },
    frozen: FROZEN,
    found: result.found,
    replayValid: replay ? replay.ok : null,
    replayReason: replay && !replay.ok ? replay.reason : null,
    routeLength: result.route ? result.route.length : null,
    route: result.found ? result.route : null,
    routeTrace: result.found ? result.routeTrace : null,
    stoppedReason: result.stoppedReason,
    searchComplete: result.searchComplete,
    deepestFloorOrdinal: result.deepestFloorOrdinal,
    deepestExpandedNonGoalFloorOrdinal: result.deepestExpandedNonGoalFloorOrdinal,
    deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
    deepestFloorHistogram: result.deepestFloorHistogram,
    deepestReachedFloorHistogram: result.deepestReachedFloorHistogram,
    deepestStrategicDepth: result.deepestStrategicDepth,
    strategicExpansions: result.strategicExpansions,
    candidatesDropped: result.candidatesDropped,
    pendingCandidateCap: result.pendingCandidateCap,
    guidedChangeFloorGenerated: result.guidedChangeFloorGenerated,
    guidedChangeFloorNodesExpanded: result.guidedChangeFloorNodesExpanded,
    guidedForwardFloorChildrenGenerated: result.guidedForwardFloorChildrenGenerated,
    wallMs: result.wallMs,
    peakRssMb: result.peakRssMb,
  };
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(summary));
  return summary;
}

function spawnAttempt(args, cap) {
  const jsonPath = path.join(os.tmpdir(), `bounded-${process.pid}-${cap}.json`);
  const childArgs = [
    __filename, "--child", `--cap=${cap}`, `--json=${jsonPath}`,
    `--max-expansions=${args.maxExpansions}`,
    `--max-runtime-ms=${args.maxRuntimeMs}`,
    `--max-rss-mb=${args.maxRssMb}`,
  ];
  const spawned = spawnSync(process.execPath, childArgs, { encoding: "utf8" });
  if (spawned.status !== 0) {
    throw new Error(`child (cap=${cap}) failed: ${spawned.stderr || spawned.stdout}`);
  }
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child) {
    runChild(args);
    return;
  }

  console.log("PR-5.25o - Bounded Candidate Search Capability Qualification");
  console.log(`  goal: CHAOS_MT1 -> floorReached(${FROZEN.goalFloorId}), region ${FROZEN.region.join("..")}`);
  console.log(`  budget: ${args.maxRuntimeMs}ms / ${args.maxRssMb}MB / ${args.maxExpansions} expansions`);
  console.log(`  predeclared capacities: ${ATTEMPTS.join(", ")}`);
  console.log(`  COMPLETENESS = ABANDONED (candidates are genuinely dropped)`);
  console.log(`  CORRECTNESS  = STRICT (unique resolution + terminal key + re-asserted goal)`);

  const attempts = [];
  let verdict = "NO_CAPABILITY_WINNER_UNDER_TWO_PREDECLARED_CAPACITIES";
  let winner = null;

  for (const cap of ATTEMPTS) {
    console.log(`  attempt cap=${cap}: running in fresh child process...`);
    const row = spawnAttempt(args, cap);
    attempts.push(row);
    console.log(
      `    found=${row.found} replay=${row.replayValid} strategic=${row.strategicExpansions} ` +
      `dropped=${row.candidatesDropped} deepestNonGoal=${row.deepestExpandedNonGoalFloorOrdinal} ` +
      `reached=${row.deepestReachedFloorOrdinal} depth=${row.deepestStrategicDepth} stopped=${row.stoppedReason} ` +
      `wall=${row.wallMs}ms rss=${row.peakRssMb}MB`,
    );
    if (row.found && row.replayValid === true) {
      verdict = "CAPABILITY_WINNER";
      winner = row;
      console.log(`    FOUND and strict-replay valid at cap=${cap}; stopping (no further attempts).`);
      break;
    }
    if (row.found && row.replayValid !== true) {
      verdict = "FOUND_BUT_STRICT_REPLAY_INVALID";
      winner = row;
      console.log(`    FOUND but strict replay FAILED (${row.replayReason}); stopping.`);
      break;
    }
  }

  console.log(`  BOUNDED_CANDIDATE_SEARCH: ${verdict}`);

  const out = {
    milestone: "PR-5.25o",
    verdict,
    frozen: FROZEN,
    attempts,
    winnerCap: winner ? winner.cap : null,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.log(`  result artifact: ${path.relative(process.cwd(), args.out)}`);

  if (verdict !== "CAPABILITY_WINNER") process.exitCode = 1;
}

main();
