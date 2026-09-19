"use strict";

/**
 * PR-5.26h - Guided pool saturation composition and flow audit.
 *
 * PURE DIAGNOSTIC. SEARCH_POLICY_CHANGE = NONE. No mechanism is added, no
 * quota/reserve is configured, no cap or budget is changed, and nothing found
 * here is acted on inside the search.
 *
 * The question is the one PR-5.26g left open: the capped pending pool ends up
 * ~99% rank-10 (guided-admitted), and demoting 3152 members of that pool left
 * 1018/1024 still rank 10. So: what is IN those ~1020 slots, how fast do they
 * enter and leave, and is the stable tie-break creating that state or only
 * amplifying something that already exists?
 *
 * MATCHED WORK. Both arms run 8000 strategic expansions with no wall limit,
 * cap 1024, dynamic Pareto ON, neutral substitution ON, and
 * retroactiveGuidedSkylineDemotion explicitly OFF (PR-5.26g is closed and must
 * not be combined into this run, or "who counts as guided" and "how guided work
 * is served" would change at the same time). The ONLY difference is
 * stableGuidedTieBreak.
 *
 * 8000 is a diagnostic observation window: it sits below the 9193 at which the
 * PR-5.26g ON arm hit the RSS ceiling, and it is long enough for cap saturation
 * to be observable. It is NOT a capability budget.
 *
 * If either arm terminates on RSS before 8000 -> STOP, no retry.
 *
 * Two child processes, one per arm: maxRssMb is process-level and V8 does not
 * return freed heap, so running both arms in one process would corrupt the
 * second arm's RSS baseline.
 *
 * Oracle keys are not used at all in this audit: ORACLE_USE = NONE.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("../../lib/project-loader");
const { createTransportCollapsedSearch } = require("../../lib/transport-collapse");
const { buildDependencyFrontier } = require("../../lib/dependency-frontier");
const { makeSimulator, PROJECT_ROOT } = require("./audit-pr525t-oracle-survival");

const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr526h-guided-pool-audit.json");

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
  retroactiveGuidedSkylineDemotion: false,
  emitGuidedPoolTelemetry: true,
  priorityMap: "ABSENT",
};

/**
 * Pre-declared mechanical labels for the snapshot composition. These are
 * DESCRIPTIVE THRESHOLDS on measured counts, not search policy and not a
 * verdict; the raw numbers are always reported next to the label.
 */
const COMPOSITION_THRESHOLDS = {
  variantMultiplicityRatio: 10,
  broadGuidanceDistinctIdentities: FROZEN.pendingCandidateCap / 2,
};

const PREFLIGHT = {
  maxExpansions: 300,
  pendingCandidateCap: 8,
  rank20DynamicPareto: true,
  neutralParetoSubstitution: true,
};

function searchOptions(overrides) {
  return Object.assign({
    isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    rank20DynamicPareto: FROZEN.rank20DynamicPareto,
    neutralParetoSubstitution: FROZEN.neutralParetoSubstitution,
    retroactiveGuidedSkylineDemotion: FROZEN.retroactiveGuidedSkylineDemotion,
    stableGuidedTieBreak: false,
    emitGuidedPoolTelemetry: FROZEN.emitGuidedPoolTelemetry,
  }, overrides);
}

function runArm(arm) {
  const stable = arm === "stable";
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontierReport = buildDependencyFrontier(project, initialState, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });
  const result = createTransportCollapsedSearch(simulator).search(
    initialState,
    searchOptions({ frontierSet: frontierReport.frontierSet, stableGuidedTieBreak: stable }),
  );
  const g = result.guidedPool;
  return {
    arm,
    stableGuidedTieBreak: result.stableGuidedTieBreak === true,
    retroactiveGuidedSkylineDemotion: result.retroactiveGuidedSkylineDemotion === true,
    found: result.found,
    strategicExpansions: result.strategicExpansions,
    stoppedReason: result.stoppedReason,
    peakRssMb: result.peakRssMb,
    wallMs: result.wallMs,
    deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
    deepestStrategicDepth: result.deepestStrategicDepth,
    guidedExpansions: result.guidedExpansions,
    neutralExpansions: result.neutralExpansions,
    candidatesDropped: result.candidatesDropped,
    guidedAdmittedGenerated: result.guidedAdmittedGenerated,
    liveGuidedPendingAtEnd: result.liveGuidedPendingAtEnd,
    rank10PendingAtEnd: result.rank10PendingAtEnd,
    guidedPool: g,
  };
}

function spawnChild(args) {
  const jsonPath = path.join(os.tmpdir(), `pr526h-${process.pid}-${args.arm}.json`);
  const spawned = spawnSync(process.execPath, [__filename, ...args.flags, `--json=${jsonPath}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (spawned.status !== 0) {
    throw new Error(`child (${args.arm}) failed:\n${spawned.stderr || spawned.stdout}`);
  }
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

/**
 * The telemetry must not change any search decision. Two cheap runs (300
 * expansions, cap 8 so trims actually happen) with the flag off and on; every
 * result field except the telemetry payload itself, wall time, and RSS must be
 * identical.
 */
function runTelemetryNoOpPreflight() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const base = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontierReport = buildDependencyFrontier(project, base, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });
  const runOnce = (telemetry) => createTransportCollapsedSearch(simulator).search(
    simulator.createInitialState({ rank: FROZEN.initialRank }),
    {
      isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
      allowedFloors: FROZEN.region,
      maxExpansions: PREFLIGHT.maxExpansions,
      maxRuntimeMs: 0,
      maxRssMb: FROZEN.maxRssMb,
      frontierSet: frontierReport.frontierSet,
      resourceSkylinePriority: true,
      pendingCandidateCap: PREFLIGHT.pendingCandidateCap,
      rank20DynamicPareto: PREFLIGHT.rank20DynamicPareto,
      neutralParetoSubstitution: PREFLIGHT.neutralParetoSubstitution,
      retroactiveGuidedSkylineDemotion: false,
      stableGuidedTieBreak: false,
      emitGuidedPoolTelemetry: telemetry,
    },
  );
  const off = runOnce(false);
  const on = runOnce(true);
  const ignored = new Set(["guidedPool", "wallMs", "peakRssMb", "signatureWallMs"]);
  const differing = [];
  for (const key of new Set([...Object.keys(off), ...Object.keys(on)])) {
    if (ignored.has(key)) continue;
    if (JSON.stringify(off[key]) !== JSON.stringify(on[key])) differing.push(key);
  }
  return {
    differringSearchFields: differing,
    noOp: differing.length === 0,
    telemetryProducedTrims: Boolean(on.guidedPool && on.guidedPool.trims > 0),
    telemetryIsNullWhenOff: off.guidedPool == null,
  };
}

function occupancyOf(arm) {
  const g = arm.guidedPool || {};
  const f = g.rank10OccupancyFraction || {};
  const flow = g.flow || {};
  const expansions = arm.strategicExpansions || 0;
  return {
    trims: g.trims == null ? null : g.trims,
    fracMin: f.min == null ? null : f.min,
    fracMean: f.mean == null ? null : f.mean,
    fracMax: f.max == null ? null : f.max,
    trimsGe90: g.trimsWithRank10Ge90PercentCap == null ? null : g.trimsWithRank10Ge90PercentCap,
    trimsGe99: g.trimsWithRank10Ge99PercentCap == null ? null : g.trimsWithRank10Ge99PercentCap,
    firstExpansionGe90: g.firstExpansionRank10Ge90PercentCap == null ? null : g.firstExpansionRank10Ge90PercentCap,
    finalKeepRank: g.finalKeepRank || null,
    admitted: flow.guidedAdmitted == null ? null : flow.guidedAdmitted,
    removedByExpansion: flow.guidedPendingRemovedByExpansion == null ? null : flow.guidedPendingRemovedByExpansion,
    removedByDrop: flow.guidedPendingRemovedByDrop == null ? null : flow.guidedPendingRemovedByDrop,
    liveGuidedEnd: flow.liveGuidedPendingAtEnd == null ? null : flow.liveGuidedPendingAtEnd,
    counterAtEnd: flow.liveGuidedCounterAtEnd == null ? null : flow.liveGuidedCounterAtEnd,
    admissionsPerExpansion: expansions > 0 && flow.guidedAdmitted != null ? flow.guidedAdmitted / expansions : null,
    removalsByExpansionPerExpansion: expansions > 0 && flow.guidedPendingRemovedByExpansion != null
      ? flow.guidedPendingRemovedByExpansion / expansions : null,
    removalsByDropPerExpansion: expansions > 0 && flow.guidedPendingRemovedByDrop != null
      ? flow.guidedPendingRemovedByDrop / expansions : null,
  };
}

function flowIdentityHolds(arm) {
  const g = arm.guidedPool;
  if (!g || !g.flow) return null;
  const f = g.flow;
  return f.guidedAdmitted === f.guidedPendingRemovedByExpansion + f.guidedPendingRemovedByDrop + f.liveGuidedPendingAtEnd;
}

/**
 * Pre-declared mechanical label for the snapshot composition. Descriptive only.
 */
function classifyComposition(snapshot) {
  if (!snapshot) return "SNAPSHOT_NOT_TAKEN";
  if (snapshot.liveGuidedCount === 0) return "NO_LIVE_GUIDED_TO_OBSERVE";
  const ratio = snapshot.liveGuidedCount / Math.max(1, snapshot.distinctSemanticIdentities);
  if (snapshot.distinctSemanticIdentities >= COMPOSITION_THRESHOLDS.broadGuidanceDistinctIdentities) {
    return "FRONTIER_GUIDANCE_BROAD_ACROSS_IDENTITIES";
  }
  if (ratio >= COMPOSITION_THRESHOLDS.variantMultiplicityRatio) return "GUIDED_VARIANT_MULTIPLICITY";
  return "MIXED_IDENTITY_AND_VARIANT";
}

function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((token) => token.startsWith("--out="));
  const outPath = outArg ? path.resolve(outArg.slice("--out=".length)) : DEFAULT_OUT;

  if (args.includes("--child")) {
    const arm = (args.find((token) => token.startsWith("--arm=")) || "--arm=legacy").slice("--arm=".length);
    const jsonArg = args.find((token) => token.startsWith("--json="));
    const summary = runArm(arm);
    if (jsonArg) fs.writeFileSync(jsonArg.slice("--json=".length), JSON.stringify(summary));
    else console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("PR-5.26h guided pool saturation composition and flow audit");
  console.log(`  workload: ${FROZEN.maxExpansions} expansions, no wall limit, cap ${FROZEN.pendingCandidateCap}, ` +
    `dynamic Pareto ON, neutral substitution ON, retro demotion OFF, priorityMap ABSENT`);
  console.log("  SEARCH_POLICY_CHANGE = NONE (diagnostic telemetry only)");

  const preflight = runTelemetryNoOpPreflight();
  console.log(`  preflight telemetry no-op: differing fields=${JSON.stringify(preflight.differringSearchFields)} ` +
    `trims observed=${preflight.telemetryProducedTrims} null-when-off=${preflight.telemetryIsNullWhenOff}`);

  const legacy = spawnChild({ arm: "legacy", flags: ["--child", "--arm=legacy"] });
  const stable = spawnChild({ arm: "stable", flags: ["--child", "--arm=stable"] });

  const legacyOccupancy = occupancyOf(legacy);
  const stableOccupancy = occupancyOf(stable);
  const stoppedEarly = [legacy, stable].filter((arm) => arm.stoppedReason !== "expansion-limit");

  const stableMinusLegacyFracMean = legacyOccupancy.fracMean == null || stableOccupancy.fracMean == null
    ? null : stableOccupancy.fracMean - legacyOccupancy.fracMean;

  const flowComparison = {
    legacyAdmissionsPerExpansion: legacyOccupancy.admissionsPerExpansion,
    stableAdmissionsPerExpansion: stableOccupancy.admissionsPerExpansion,
    legacyRemovedByExpansionPerExpansion: legacyOccupancy.removalsByExpansionPerExpansion,
    stableRemovedByExpansionPerExpansion: stableOccupancy.removalsByExpansionPerExpansion,
    legacyRemovedByDropPerExpansion: legacyOccupancy.removalsByDropPerExpansion,
    stableRemovedByDropPerExpansion: stableOccupancy.removalsByDropPerExpansion,
  };

  const checks = {
    TELEMETRY_IS_READ_ONLY: preflight.noOp === true && preflight.telemetryIsNullWhenOff === true,
    TELEMETRY_OBSERVED_TRIMS_IN_PREFLIGHT: preflight.telemetryProducedTrims === true,
    BOTH_ARMS_MATCHED_WORK: legacy.strategicExpansions === FROZEN.maxExpansions
      && stable.strategicExpansions === FROZEN.maxExpansions,
    NO_ARM_TERMINATED_BEFORE_MATCHED_WORK: stoppedEarly.length === 0,
    GUIDED_FLOW_IDENTITY_HOLDS: flowIdentityHolds(legacy) === true && flowIdentityHolds(stable) === true,
    LIVE_GUIDED_COUNTER_MATCHES_POOL: legacyOccupancy.counterAtEnd === legacyOccupancy.liveGuidedEnd
      && stableOccupancy.counterAtEnd === stableOccupancy.liveGuidedEnd,
    RETRO_DEMOTION_IS_OFF: legacy.retroactiveGuidedSkylineDemotion === false && stable.retroactiveGuidedSkylineDemotion === false,
  };

  const summary = {
    milestone: "PR-5.26h",
    audit: "GUIDED_POOL_SATURATION_COMPOSITION_AND_FLOW_AUDIT",
    searchPolicyChange: "NONE",
    oracleUse: "NONE",
    mechanismIsDiagnosticOnly: true,
    frozen: FROZEN,
    compositionThresholds: COMPOSITION_THRESHOLDS,
    preflight,
    checks,
    stoppedEarly: stoppedEarly.map((arm) => ({ arm: arm.arm, stoppedReason: arm.stoppedReason, expansions: arm.strategicExpansions, peakRssMb: arm.peakRssMb })),
    stableMinusLegacyRank10FracMean: stableMinusLegacyFracMean,
    occupancy: { legacy: legacyOccupancy, stable: stableOccupancy },
    flowComparison,
    composition: {
      legacyFirst99: legacy.guidedPool ? legacy.guidedPool.snapshots.first99PercentGuidedSaturation : null,
      stableFirst99: stable.guidedPool ? stable.guidedPool.snapshots.first99PercentGuidedSaturation : null,
      legacyEnd: legacy.guidedPool ? legacy.guidedPool.snapshots.end : null,
      stableEnd: stable.guidedPool ? stable.guidedPool.snapshots.end : null,
      legacyFirst99Class: classifyComposition(legacy.guidedPool ? legacy.guidedPool.snapshots.first99PercentGuidedSaturation : null),
      stableFirst99Class: classifyComposition(stable.guidedPool ? stable.guidedPool.snapshots.first99PercentGuidedSaturation : null),
    },
    legacy,
    stable,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const line = (arm, occ) => `  ${arm === "stable" ? "STABLE" : "LEGACY"}: exp=${arm === "stable" ? stable.strategicExpansions : legacy.strategicExpansions} ` +
    `stopped=${arm === "stable" ? stable.stoppedReason : legacy.stoppedReason} rss=${arm === "stable" ? stable.peakRssMb : legacy.peakRssMb}MB ` +
    `depth=${arm === "stable" ? stable.deepestStrategicDepth : legacy.deepestStrategicDepth} | trims=${occ.trims} ` +
    `rank10Frac min/mean/max=${occ.fracMin == null ? "-" : occ.fracMin.toFixed(3)}/${occ.fracMean == null ? "-" : occ.fracMean.toFixed(3)}/${occ.fracMax == null ? "-" : occ.fracMax.toFixed(3)} ` +
    `ge90=${occ.trimsGe90} ge99=${occ.trimsGe99} firstGe90Exp=${occ.firstExpansionGe90} | admitted=${occ.admitted} removedByExpansion=${occ.removedByExpansion} ` +
    `removedByDrop=${occ.removedByDrop} liveGuidedEnd=${occ.liveGuidedEnd}`;
  console.log(line("legacy", legacyOccupancy));
  console.log(line("stable", stableOccupancy));
  console.log(`  final kept rank split: legacy=${JSON.stringify(legacyOccupancy.finalKeepRank)} stable=${JSON.stringify(stableOccupancy.finalKeepRank)}`);
  console.log(`  flow per expansion: ${JSON.stringify(flowComparison)}`);
  console.log(`  composition first-99%: legacy=${summary.composition.legacyFirst99Class} stable=${summary.composition.stableFirst99Class}`);
  if (summary.composition.stableFirst99) {
    const s = summary.composition.stableFirst99;
    console.log(`    stable S99: live=${s.liveGuidedCount} identities=${s.distinctSemanticIdentities} structuralKeys=${s.distinctStructuralKeys} ` +
      `multiVariantGroups=${s.multiVariantStructuralGroupCount} maxVariants=${s.maxVariantsPerStructuralGroup} ` +
      `dominated=${s.liveGuidedParetoDominatedWithinStructuralGroup} nondominated=${s.liveGuidedParetoNondominatedWithinStructuralGroup}`);
  }
  for (const [name, value] of Object.entries(checks)) console.log(`  ${name} = ${value}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { FROZEN, COMPOSITION_THRESHOLDS, classifyComposition };
