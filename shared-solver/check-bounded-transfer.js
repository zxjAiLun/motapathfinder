"use strict";
/**
 * PR-5.25p - Bounded Candidate Capability Transfer (CHAOS MT1 -> MT4).
 *
 * TRANSFER qualification, not a new heuristic. The PR-5.25o configuration that
 * first produced a strictly replayable MT1 -> MT3 route is reused verbatim.
 * The ONLY changed inputs are the terminal goal and the allowed region:
 *
 *   PR-5.25o : goal floorReached(MT3), region MT1..MT3
 *   PR-5.25p : goal floorReached(MT4), region MT1..MT4
 *
 * Frozen everywhere else: same StaticSimulator config, same transport-collapsed
 * successor generator, same autonomous dependency frontier, same
 * resourceSkylinePriority ordering, same pendingCandidateCap = 1024, same
 * 180000ms / 2048MB / 120000-expansion budget, fresh child process per run.
 *
 * Single formal attempt. If it finds MT4 and strictly replays, one fresh-child
 * repeatability rerun is executed. If it misses, this harness stops and reports;
 * it never raises the cap, changes ordering, or adds a planner.
 *
 * A KNOWN_SOLVABLE oracle is available (`--oracle`) but is never fed to the
 * search: it only proves that a CHAOS MT1 -> MT4 route exists in the tracked
 * fixture corpus, so a miss is a solver result and not an unsolvable task.
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
const { verifyStrictReplay } = require("./lib/strict-replay");
const { resolveRecordedAction } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "bounded-transfer.result.json");
const ORACLE_FIXTURE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  pendingCandidateCap: 1024,
  maxRuntimeMs: 180000,
  maxRssMb: 2048,
  maxExpansions: 120000,
  freshChildProcess: true,
  searchPolicyChange: "NONE",
  training: "NONE",
  witnessInSearch: "NONE",
  manualMilestone: "NONE",
  recursiveSubgoal: "NONE",
  backtracking: "NONE",
  capTuning: "NONE",
  transferBasis: "PR-5.25o cap=1024 winner configuration",
};

function parseArgs(argv) {
  const args = {
    out: DEFAULT_RESULT_PATH,
    child: false,
    oracleOnly: false,
    skipOracle: false,
    cap: FROZEN.pendingCandidateCap,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    maxExpansions: FROZEN.maxExpansions,
    json: null,
  };
  for (const token of argv) {
    if (token === "--child") { args.child = true; continue; }
    if (token === "--oracle") { args.oracleOnly = true; continue; }
    if (token === "--skip-oracle") { args.skipOracle = true; continue; }
    if (token.startsWith("--out=")) { args.out = path.resolve(token.slice("--out=".length)); continue; }
    if (token.startsWith("--cap=")) { args.cap = Number(token.slice("--cap=".length)); continue; }
    if (token.startsWith("--max-runtime-ms=")) { args.maxRuntimeMs = Number(token.slice("--max-runtime-ms=".length)); continue; }
    if (token.startsWith("--max-rss-mb=")) { args.maxRssMb = Number(token.slice("--max-rss-mb=".length)); continue; }
    if (token.startsWith("--max-expansions=")) { args.maxExpansions = Number(token.slice("--max-expansions=".length)); continue; }
    if (token.startsWith("--json=")) { args.json = token.slice("--json=".length); continue; }
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
 * Read-only solvability oracle.
 *
 * Replays a TRACKED CHAOS MT1 -> MT4 route fixture decision by decision through
 * the same prompt-independent resolver the strict gate uses. This never runs the
 * search and never shares any route content with it; it only establishes
 * KNOWN_SOLVABLE = true for the MT4 task.
 */
function runOracle() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const record = JSON.parse(fs.readFileSync(ORACLE_FIXTURE, "utf8"));
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  if (decisions.length === 0) throw new Error("oracle fixture has no decisions");

  let state = simulator.createInitialState({ rank: FROZEN.initialRank });
  if (state.floorId !== "MT1") {
    throw new Error("canonical CHAOS initial state is not on MT1");
  }

  for (let i = 0; i < decisions.length; i += 1) {
    const decision = decisions[i];
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, state, {
      ...decision,
      postExactStateKey: decision.postStateKey || decision.postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) {
      throw new Error(`oracle replay failed to resolve decision ${i} (${decision.summary}): ${resolved && resolved.reason}`);
    }
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) {
      throw new Error(`oracle replay died at decision ${i}`);
    }
  }

  if (state.floorId !== FROZEN.goalFloorId) {
    throw new Error(`oracle replay ended on ${state.floorId}, not ${FROZEN.goalFloorId}`);
  }

  // Independent end-state cross-check against the fixture's recorded final hero.
  // The fixture's own stateKey strings use an older projected format (hero
  // hp/hpmax/manamax nulled), so they are not comparable via buildStateKey;
  // the concrete hero attributes are compared instead.
  const recordedHero = record.final && record.final.snapshot && record.final.snapshot.hero;
  if (recordedHero) {
    for (const field of ["hp", "atk", "def", "mdef", "lv", "exp"]) {
      if (recordedHero[field] !== undefined && recordedHero[field] !== state.hero[field]) {
        throw new Error(`oracle replay hero.${field} ${state.hero[field]} != recorded ${recordedHero[field]}`);
      }
    }
  }

  return {
    knownSolvable: true,
    oracleFixture: path.relative(path.resolve(__dirname, ".."), ORACLE_FIXTURE),
    oracleDecisions: decisions.length,
    oracleFinalFloorId: state.floorId,
    oracleFinalHeroHp: state.hero.hp,
    oracleEndStateCrossChecked: Boolean(recordedHero),
    fedToSearch: false,
  };
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
    found: result.found,
    replayValid: replay ? replay.ok : null,
    replayReason: replay && !replay.ok ? replay.reason : null,
    routeLength: result.route ? result.route.length : null,
    route: result.found ? result.route : null,
    routeTrace: result.found ? result.routeTrace : null,
    finalExactStateKey: result.finalState ? buildStateKey(result.finalState) : null,
    replayFinalExactStateKey: replay && replay.ok ? replay.finalKey : null,
    replayGoalReasserted: replay && replay.ok ? replay.goalReasserted : null,
    stoppedReason: result.stoppedReason,
    searchComplete: result.searchComplete,
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
    frontierGuidedGenerated: result.frontierGuidedGenerated,
    guidedAdmittedGenerated: result.guidedAdmittedGenerated,
    frontierGuidedDominatedGenerated: result.frontierGuidedDominatedGenerated,
    frontierGuidedByKind: result.frontierGuidedByKind,
    guidedAdmittedByKind: result.guidedAdmittedByKind,
    frontierGuidedDominatedByKind: result.frontierGuidedDominatedByKind,
    fifoReserveTarget: result.fifoReserveTarget,
    fifoReserveKept: result.fifoReserveKept,
    droppedByRetentionLane: result.droppedByRetentionLane,
    wallMs: result.wallMs,
    peakRssMb: result.peakRssMb,
  };
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(summary));
  return summary;
}

function spawnAttempt(args, tag) {
  const jsonPath = path.join(os.tmpdir(), `transfer-${process.pid}-${tag}.json`);
  const childArgs = [
    __filename, "--child", `--cap=${args.cap}`, `--json=${jsonPath}`,
    `--max-expansions=${args.maxExpansions}`,
    `--max-runtime-ms=${args.maxRuntimeMs}`,
    `--max-rss-mb=${args.maxRssMb}`,
  ];
  const spawned = spawnSync(process.execPath, childArgs, { encoding: "utf8" });
  if (spawned.status !== 0) {
    throw new Error(`child (${tag}) failed: ${spawned.stderr || spawned.stdout}`);
  }
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

function logAttempt(label, row) {
  console.log(
    `  ${label}: found=${row.found} replay=${row.replayValid} strategic=${row.strategicExpansions} ` +
    `dropped=${row.candidatesDropped} reached=${row.deepestReachedFloorOrdinal} ` +
    `depth=${row.deepestStrategicDepth} stopped=${row.stoppedReason} wall=${row.wallMs}ms rss=${row.peakRssMb}MB`,
  );
  if (row.found && row.replayValid !== true) {
    console.log(`    strict replay FAILED: ${row.replayReason}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child) { runChild(args); return; }

  if (args.oracleOnly) {
    const oracle = runOracle();
    console.log(JSON.stringify(oracle, null, 2));
    return;
  }

  console.log("PR-5.25p - Bounded Candidate Capability Transfer");
  console.log(`  goal: CHAOS_MT1 -> floorReached(${FROZEN.goalFloorId}), region ${FROZEN.region.join("..")}`);
  console.log(`  frozen cap: ${FROZEN.pendingCandidateCap} (no tuning)`);
  console.log(`  budget: ${args.maxRuntimeMs}ms / ${args.maxRssMb}MB / ${args.maxExpansions} expansions`);
  console.log(`  SEARCH_POLICY_CHANGE = ${FROZEN.searchPolicyChange}`);
  console.log(`  transfer basis: ${FROZEN.transferBasis}`);

  let oracle = null;
  if (!args.skipOracle) {
    oracle = runOracle();
    console.log(`  oracle: KNOWN_SOLVABLE = true (${oracle.oracleDecisions} decisions, tracked fixture, not fed to search)`);
  } else {
    console.log("  oracle: SKIPPED BY FLAG");
  }

  console.log("  formal attempt 1: running in fresh child process...");
  const attempt1 = spawnAttempt(args, "a1");
  logAttempt("attempt 1", attempt1);

  const attempts = [attempt1];
  let verdict;
  if (!attempt1.found) {
    verdict = "MISS_UNDER_FROZEN_CAP_1024";
  } else if (attempt1.replayValid === true) {
    verdict = "TRANSFER_CONFIRMED_AT_CAP_1024";
  } else {
    verdict = "FOUND_BUT_STRICT_REPLAY_INVALID";
  }

  let repeat = null;
  let repeatability = null;
  if (verdict === "TRANSFER_CONFIRMED_AT_CAP_1024") {
    console.log("  repeatability rerun: running in fresh child process...");
    repeat = spawnAttempt(args, "a2");
    logAttempt("repeat", repeat);
    attempts.push(repeat);
    repeatability = repeat.found && repeat.replayValid === true && repeat.routeLength === attempt1.routeLength
      ? "REPRODUCED_SAME_ROUTE_LENGTH"
      : "NOT_REPRODUCED";
  }

  console.log(`  BOUNDED_CANDIDATE_TRANSFER: ${verdict}`);
  if (repeatability) console.log(`  REPEATABILITY: ${repeatability}`);

  const artifact = {
    milestone: "PR-5.25p",
    verdict,
    frozen: FROZEN,
    oracle,
    attempts,
    repeatability,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(artifact, null, 2));
  console.log(`  result artifact: ${path.relative(process.cwd(), args.out)}`);

  if (verdict !== "TRANSFER_CONFIRMED_AT_CAP_1024") process.exitCode = 1;
}

main();
