"use strict";
/**
 * PR-5.26c - Neutral-turn Pareto substitution, fixed-work A/B.
 *
 * The mechanism-validation gate that must pass BEFORE any capability gate runs.
 * Both arms use the identical frozen workload on which cp#9's retention fate and
 * queue position were already established deterministically (8000 expansions,
 * MAX_RUNTIME_MS = 0, cap 1024, region MT1..MT4, goal MT4, dynamic Pareto ON).
 * The ONLY difference is neutralParetoSubstitution.
 *
 * PRE-DECLARED SUCCESS CONDITION (owner-specified, fixed before the run)
 *   OFF: CP9_EXPANDED = FALSE
 *   ON : CP9_EXPANDED = TRUE
 *
 * If the ON arm still fails to expand cp#9, that is STOP - not a prompt to tune.
 * This mechanism has no ratio or quota to tune; it either reaches the node or it
 * does not.
 *
 * Observation only otherwise: no cap, budget, scheduler-frequency, retention or
 * frontier change in either arm.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("../../lib/project-loader");
const { createTransportCollapsedSearch } = require("../../lib/transport-collapse");
const { buildDependencyFrontier } = require("../../lib/dependency-frontier");
const { buildCp9Key, makeSimulator, FROZEN, PROJECT_ROOT } = require("./audit-pr526b-scheduling-latency");

const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr526c-substitution-ab.json");

function runArm(project, simulator, cp9Key, substitution) {
  const initial = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontier = buildDependencyFrontier(project, initial, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });
  const events = [];
  const started = Date.now();
  const result = createTransportCollapsedSearch(simulator).search(initial, {
    isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    frontierSet: frontier.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    rank20DynamicPareto: FROZEN.rank20DynamicPareto,
    neutralParetoSubstitution: substitution === true,
    emitPendingSnapshot: true,
    onCandidateLifecycle: (event) => {
      if (event.exactKey === cp9Key) events.push(event);
      return null;
    },
  });
  const wallMs = Date.now() - started;

  const types = new Set(events.map((e) => e.type));
  const expandedEvent = events.find((e) => e.type === "expanded") || null;
  const droppedEvent = events.find((e) => e.type === "dropped") || null;
  const snapshot = result.pendingSnapshot;
  const inSnapshot = snapshot ? snapshot.nodes.find((n) => n.exactKey === cp9Key) || null : null;

  return {
    neutralParetoSubstitution: substitution === true,
    cp9: {
      generated: types.has("strategicGenerated"),
      registered: types.has("registered"),
      dropped: types.has("dropped"),
      expanded: types.has("expanded"),
      expandedAtExpansion: expandedEvent ? expandedEvent.strategicExpansion : null,
      droppedAtExpansion: null,
      stillPendingAtEnd: Boolean(inSnapshot),
      neutralQueueDistanceFromHead: inSnapshot ? inSnapshot.neutralQueueLiveAhead : null,
    },
    allocation: {
      neutralEveryRule: 5,
      note: "neutralEvery and the due-condition are NOT touched; guided/neutral below are the REALIZED mix, which moves because the trajectory changes",
      neutralShareOfExpansions: result.strategicExpansions > 0 && snapshot
        ? snapshot.neutralExpansions / result.strategicExpansions
        : null,
    },
    mechanism: {
      neutralParetoSubstitutions: result.neutralParetoSubstitutions,
      neutralParetoSubstitutionScans: result.neutralParetoSubstitutionScans,
      rank20ParetoRescuedTotal: result.rank20ParetoRescuedTotal,
      rank20ParetoChangedTrims: result.rank20ParetoChangedTrims,
    },
    search: {
      found: result.found,
      strategicExpansions: result.strategicExpansions,
      candidatesDropped: result.candidatesDropped,
      deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
      deepestStrategicDepth: result.deepestStrategicDepth,
      stoppedReason: result.stoppedReason,
      guidedExpansions: snapshot ? snapshot.guidedExpansions : null,
      neutralExpansions: snapshot ? snapshot.neutralExpansions : null,
      livePendingTotal: snapshot ? snapshot.livePendingTotal : null,
      wallMs,
    },
  };
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const cp9 = buildCp9Key(simulator);

  console.log("PR-5.26c neutral-turn Pareto substitution - fixed-work A/B");
  console.log(`  cp#9 (${cp9.summary}) workload: ${FROZEN.maxExpansions} expansions, no wall limit, cap ${FROZEN.pendingCandidateCap}`);

  const off = runArm(project, simulator, cp9.postKey, false);
  const on = runArm(project, simulator, cp9.postKey, true);

  const conditionMet = off.cp9.expanded === false && on.cp9.expanded === true;

  const summary = {
    milestone: "PR-5.26c",
    audit: "NEUTRAL_TURN_PARETO_SUBSTITUTION_FIXED_WORK_AB",
    searchPolicyChange: "NEUTRAL_TURN_PARETO_SUBSTITUTION_ONLY",
    oracleUse: "POST_HOC_LOOKUP_ONLY",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    cp9Summary: cp9.summary,
    preDeclaredCondition: "OFF: CP9_EXPANDED = FALSE  AND  ON: CP9_EXPANDED = TRUE",
    preDeclaredConditionMet: conditionMet,
    off,
    on,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const line = (arm) => {
    const c = arm.cp9;
    return `  ${arm.neutralParetoSubstitution ? "ON " : "OFF"}: cp9 expanded=${c.expanded}` +
      `${c.expandedAtExpansion == null ? "" : ` atExpansion=${c.expandedAtExpansion}`}` +
      ` dropped=${c.dropped} stillPending=${c.stillPendingAtEnd} ahead=${c.neutralQueueDistanceFromHead} | ` +
      `substitutions=${arm.mechanism.neutralParetoSubstitutions}/${arm.mechanism.neutralParetoSubstitutionScans} scans | ` +
      `exp=${arm.search.strategicExpansions} dropped=${arm.search.candidatesDropped} deepest=${arm.search.deepestReachedFloorOrdinal} ` +
      `guided=${arm.search.guidedExpansions} neutral=${arm.search.neutralExpansions} wall=${arm.search.wallMs}ms`;
  };
  console.log(line(off));
  console.log(line(on));
  console.log(`  PRE_DECLARED_CONDITION_MET = ${conditionMet}`);
  if (!conditionMet) {
    console.log("  STOP: the mechanism validation gate did not pass. Do not tune - this mechanism has no ratio to tune.");
  }
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
  if (!conditionMet) process.exitCode = 1;
}

main();
