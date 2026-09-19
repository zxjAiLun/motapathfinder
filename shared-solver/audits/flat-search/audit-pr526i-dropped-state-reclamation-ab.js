"use strict";

/**
 * PR-5.26i - Dropped candidate state reclamation, fixed-work memory stress A/B.
 *
 * SEARCH_POLICY_CHANGE = NONE. This round asks one question: does releasing the
 * state of already-dropped candidates change anything at all about the search,
 * and how much memory does that retention actually account for?
 *
 * The stress configuration is the one PR-5.26h identified as generating ~3x the
 * guided traffic (stableGuidedTieBreak ON). Using it here is explicitly NOT an
 * endorsement of that policy - PR-5.26h closed it as `NOT_A_GOOD_ACTIVE_POLICY`.
 * It is used because it is the most demanding pool-churn harness we have, so a
 * trajectory no-op proof here is stronger than at legacy churn levels.
 *
 * Both arms: 8000 expansions, no wall limit, cap 1024, dynamic Pareto ON,
 * neutral substitution ON, stable tie-break ON, retro demotion OFF. The only
 * difference is reclaimDroppedState.
 *
 * One child process per arm: maxRssMb is process-level and V8 does not return
 * freed heap, so sequential arms would inherit each other's footprint.
 *
 * RSS is reported but NOT gated on: V8 may free objects without returning pages
 * to the OS, so peakHeapUsedMb is the more direct diagnostic of whether the
 * payload was actually released. No pre-registered reduction threshold exists.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("../../lib/project-loader");
const { createTransportCollapsedSearch } = require("../../lib/transport-collapse");
const { buildDependencyFrontier } = require("../../lib/dependency-frontier");
const { makeSimulator, PROJECT_ROOT } = require("./audit-pr525t-oracle-survival");

const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr526i-dropped-state-reclamation-ab.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxExpansions: 8000,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 1024,
  rank20DynamicPareto: true,
  neutralParetoSubstitution: true,
  stableGuidedTieBreak: true,
  retroactiveGuidedSkylineDemotion: false,
  priorityMap: "ABSENT",
};

const ACCOUNTING_FIELDS = new Set([
  "wallMs", "peakRssMb", "peakHeapUsedMb", "droppedStatesReclaimed", "reclaimDroppedState", "signatureWallMs",
]);

const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

function runArm(arm) {
  const reclaim = arm === "on";
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontierReport = buildDependencyFrontier(project, initialState, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });
  const events = [];
  const result = createTransportCollapsedSearch(simulator).search(initialState, {
    isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    frontierSet: frontierReport.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    rank20DynamicPareto: FROZEN.rank20DynamicPareto,
    neutralParetoSubstitution: FROZEN.neutralParetoSubstitution,
    stableGuidedTieBreak: FROZEN.stableGuidedTieBreak,
    retroactiveGuidedSkylineDemotion: FROZEN.retroactiveGuidedSkylineDemotion,
    reclaimDroppedState: reclaim,
    trackPeakHeapUsed: true,
    onCandidateLifecycle: (event) => { events.push(event); return null; },
  });

  const resultForCompare = {};
  for (const [key, value] of Object.entries(result)) {
    if (ACCOUNTING_FIELDS.has(key)) continue;
    if (key === "route" || key === "routeTrace") continue;
    resultForCompare[key] = value;
  }
  const eventStream = events.map((e) => JSON.stringify(e)).join("\n");
  return {
    arm,
    reclaimDroppedState: result.reclaimDroppedState === true,
    found: result.found,
    strategicExpansions: result.strategicExpansions,
    stoppedReason: result.stoppedReason,
    peakRssMb: result.peakRssMb,
    peakHeapUsedMb: result.peakHeapUsedMb,
    wallMs: result.wallMs,
    deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
    deepestStrategicDepth: result.deepestStrategicDepth,
    candidatesDropped: result.candidatesDropped,
    droppedStatesReclaimed: result.droppedStatesReclaimed,
    registrySize: result.registrySize,
    guidedExpansions: result.guidedExpansions,
    neutralExpansions: result.neutralExpansions,
    guidedAdmittedGenerated: result.guidedAdmittedGenerated,
    liveGuidedPendingAtEnd: result.liveGuidedPendingAtEnd,
    eventTypeCounts: events.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {}),
    eventStreamHash: sha(eventStream),
    routeHash: sha(JSON.stringify(result.route)),
    routeTraceHash: sha(JSON.stringify(result.routeTrace)),
    resultForCompare,
  };
}

function spawnArm(arm) {
  const jsonPath = path.join(os.tmpdir(), `pr526i-ab-${process.pid}-${arm}.json`);
  const spawned = spawnSync(process.execPath, [__filename, "--child", `--arm=${arm}`, `--json=${jsonPath}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (spawned.status !== 0) {
    throw new Error(`child arm=${arm} failed:\n${spawned.stderr || spawned.stdout}`);
  }
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

function differingFields(a, b) {
  const out = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((t) => t.startsWith("--out="));
  const outPath = outArg ? path.resolve(outArg.slice("--out=".length)) : DEFAULT_OUT;

  if (args.includes("--child")) {
    const arm = (args.find((t) => t.startsWith("--arm=")) || "--arm=off").slice("--arm=".length);
    const jsonArg = args.find((t) => t.startsWith("--json="));
    const summary = runArm(arm);
    if (jsonArg) fs.writeFileSync(jsonArg.slice("--json=".length), JSON.stringify(summary));
    else console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("PR-5.26i dropped state reclamation - fixed-work memory stress A/B");
  console.log(`  workload: ${FROZEN.maxExpansions} expansions, no wall limit, cap ${FROZEN.pendingCandidateCap}, ` +
    "dynamic Pareto ON, neutral substitution ON, stable tie-break ON (stress config, not an endorsement), retro demotion OFF");

  const off = spawnArm("off");
  const on = spawnArm("on");

  const trajectoryDifferingFields = differingFields(off.resultForCompare, on.resultForCompare);
  const checks = {
    BOTH_ARMS_REACHED_FIXED_WORK: off.stoppedReason === "expansion-limit" && on.stoppedReason === "expansion-limit",
    SEARCH_TRAJECTORY_EQUAL: trajectoryDifferingFields.length === 0
      && off.eventStreamHash === on.eventStreamHash
      && off.routeHash === on.routeHash
      && off.routeTraceHash === on.routeTraceHash,
    REGISTRY_IDENTICAL: off.registrySize === on.registrySize,
    RECLAIMED_EQUALS_DROPPED: on.droppedStatesReclaimed === on.candidatesDropped && on.droppedStatesReclaimed > 0,
    RECLAMATION_OFF_IN_OFF_ARM: off.droppedStatesReclaimed === 0 && off.reclaimDroppedState === false,
  };

  const summary = {
    milestone: "PR-5.26i",
    audit: "DROPPED_CANDIDATE_STATE_RECLAMATION_FIXED_WORK_AB",
    searchPolicyChange: "NONE",
    mechanismIsResourceLifecycleOnly: true,
    stressConfigIsNotAnEndorsement: true,
    oracleUse: "NONE",
    frozen: FROZEN,
    preDeclaredGates: [
      "BOTH_ARMS_REACHED_FIXED_WORK = TRUE",
      "SEARCH_TRAJECTORY_EQUAL = TRUE",
      "REGISTRY_IDENTICAL = TRUE",
      "RECLAIMED_EQUALS_DROPPED = TRUE",
      "RECLAMATION_OFF_IN_OFF_ARM = TRUE",
    ],
    trajectoryDifferingFields,
    memory: {
      rssOffMb: off.peakRssMb,
      rssOnMb: on.peakRssMb,
      heapUsedOffMb: off.peakHeapUsedMb,
      heapUsedOnMb: on.peakHeapUsedMb,
      heapUsedDeltaMb: off.peakHeapUsedMb == null || on.peakHeapUsedMb == null ? null : on.peakHeapUsedMb - off.peakHeapUsedMb,
      rssDeltaMb: on.peakRssMb - off.peakRssMb,
    },
    checks,
    off,
    on,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const line = (a) => `  ${a.arm === "on" ? "ON " : "OFF"}: exp=${a.strategicExpansions} stopped=${a.stoppedReason} ` +
    `depth=${a.deepestStrategicDepth} floor=${a.deepestReachedFloorOrdinal} drops=${a.candidatesDropped} ` +
    `reclaimed=${a.droppedStatesReclaimed} registry=${a.registrySize} guided=${a.guidedExpansions} neutral=${a.neutralExpansions} ` +
    `admitted=${a.guidedAdmittedGenerated} | rss=${a.peakRssMb}MB heapUsed=${a.peakHeapUsedMb}MB wall=${a.wallMs}ms`;
  console.log(line(off));
  console.log(line(on));
  console.log(`  trajectory differing fields: ${JSON.stringify(trajectoryDifferingFields)}`);
  console.log(`  eventStream hashes: off=${off.eventStreamHash} on=${on.eventStreamHash}`);
  console.log(`  route hashes: off=${off.routeHash} on=${on.routeHash}`);
  console.log(`  heapUsed delta (on - off): ${summary.memory.heapUsedDeltaMb} MB | RSS delta: ${summary.memory.rssDeltaMb} MB`);
  for (const [name, value] of Object.entries(checks)) console.log(`  ${name} = ${value}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { FROZEN };
