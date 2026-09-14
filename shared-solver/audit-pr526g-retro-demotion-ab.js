"use strict";

/**
 * PR-5.26g - Retroactive guided skyline demotion, fixed-work A/B.
 *
 * Both arms run the SAME pipeline on the SAME commit with the frozen workload
 * (12000 expansions, no wall limit, cap 1024, dynamic Pareto ON, neutral
 * substitution ON, stable guided tie-break ON). The ONLY difference is
 * `retroactiveGuidedSkylineDemotion`.
 *
 * WHY the stable tie-break is ON in BOTH arms: PR-5.26f showed the memory
 * problem is not "the stable order" but "guided admission is arrival-order
 * sensitive, and changing service order changes which states are generated".
 * So the repair is measured on top of the configuration that exposed it, and
 * the OFF arm must reproduce the PR-5.26f ON-arm anchor exactly. If it does not,
 * the comparator/config refactor changed 5.26f behaviour and the run is void.
 *
 * Each arm runs in its own child process: `maxRssMb` is process-level and V8
 * does not return freed heap, so both arms in one process would give the second
 * a corrupted RSS baseline.
 *
 * Oracle exact keys are used ONLY as a post-hoc filter. They are never visible
 * to the search: ORACLE_KEYS_AFFECT_SEARCH_DECISIONS = FALSE.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("./lib/project-loader");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { buildOracleCheckpoints, makeSimulator, PROJECT_ROOT } = require("./audit-pr525t-oracle-survival");

const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr526g-retro-demotion-ab.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxExpansions: 12000,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 1024,
  rank20DynamicPareto: true,
  neutralParetoSubstitution: true,
  stableGuidedTieBreak: true,
  priorityMap: "ABSENT",
};

// PR-5.26f ON-arm anchor (the stable-tie-break treatment arm). The PR-5.26g OFF
// arm is byte-identical to it and must reproduce these exactly.
const PR526F_ON_ANCHOR = {
  guidedAdmittedGenerated: 15792,
  candidatesDropped: 26371,
  cp14ExpandedAt: 2439,
  cp16ExpandedAt: 2501,
};

function runChild(arm) {
  const retro = arm === "on";
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const oracle = buildOracleCheckpoints(simulator);
  const cp14 = oracle.allSteps.find((step) => step.step === 14);
  const cp16 = oracle.allSteps.find((step) => step.step === 16);
  if (!cp14 || !cp16) throw new Error("oracle fixture is missing cp#14 or cp#16");
  const targets = new Map([[cp14.postKey, "cp14"], [cp16.postKey, "cp16"]]);

  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontierReport = buildDependencyFrontier(project, initialState, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });

  const guidedExpansionSeq = [];
  const targetEvents = new Map([["cp14", []], ["cp16", []]]);

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
    retroactiveGuidedSkylineDemotion: retro,
    emitGuidedServiceTelemetry: true,
    onCandidateLifecycle: (event) => {
      const target = targets.get(event.exactKey);
      if (target) targetEvents.get(target).push(event);
      if (event.type === "expanded" && guidedExpansionSeq.length < 400 && event.guidedAdmitted === true) {
        guidedExpansionSeq.push(event.guidedPendingSeq);
      }
      return null;
    },
  });

  const targetSummary = (name) => {
    const events = targetEvents.get(name);
    const registered = [...events].reverse().find((event) => event.type === "registered") || null;
    const expanded = [...events].reverse().find((event) => event.type === "expanded") || null;
    const demoted = [...events].reverse().find((event) => event.type === "guidedRetroDemotion") || null;
    return {
      registeredAt: registered ? registered.registeredAtStrategicExpansion : null,
      pendingSeq: registered ? registered.pendingSeq : null,
      expanded: Boolean(expanded),
      expandedAt: expanded ? expanded.strategicExpansion : null,
      dropped: events.some((event) => event.type === "dropped"),
      retroDemotedAt: demoted ? demoted.demotedAtExpansion : null,
    };
  };

  return {
    arm,
    retroactiveGuidedSkylineDemotion: result.retroactiveGuidedSkylineDemotion === true,
    stableGuidedTieBreak: result.stableGuidedTieBreak === true,
    found: result.found,
    strategicExpansions: result.strategicExpansions,
    stoppedReason: result.stoppedReason,
    peakRssMb: result.peakRssMb,
    wallMs: result.wallMs,
    deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
    deepestStrategicDepth: result.deepestStrategicDepth,
    candidatesDropped: result.candidatesDropped,
    guidedExpansions: result.guidedExpansions,
    neutralExpansions: result.neutralExpansions,
    guidedAdmittedGenerated: result.guidedAdmittedGenerated,
    guidedScoreHistogram: result.guidedScoreHistogram,
    guidedPriorityMapProvided: result.guidedPriorityMapProvided,
    guidedRetroDemotions: result.guidedRetroDemotions,
    guidedRetroDemotionScans: result.guidedRetroDemotionScans,
    guidedHeapStaleDemotionSkips: result.guidedHeapStaleDemotionSkips,
    guidedGroupTrackedIds: result.guidedGroupTrackedIds,
    guidedGroupSweeps: result.guidedGroupSweeps,
    guidedGroupSweepThreshold: result.guidedGroupSweepThreshold,
    guidedActivePeak: result.guidedActivePeak,
    liveGuidedPendingAtEnd: result.liveGuidedPendingAtEnd,
    rank10PendingAtEnd: result.rank10PendingAtEnd,
    retroDemotedStillPendingAtEnd: result.retroDemotedStillPendingAtEnd,
    cp14: targetSummary("cp14"),
    cp16: targetSummary("cp16"),
    guidedExpansionSeq,
  };
}

function spawnArm(arm) {
  const jsonPath = path.join(os.tmpdir(), `pr526g-${process.pid}-${arm}.json`);
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

function orderDiffers(off, on) {
  const length = Math.min(off.length, on.length);
  if (length === 0) return null;
  for (let i = 0; i < length; i += 1) {
    if (off[i] !== on[i]) return true;
  }
  return off.length !== on.length;
}

function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((token) => token.startsWith("--out="));
  const outPath = outArg ? path.resolve(outArg.slice("--out=".length)) : DEFAULT_OUT;

  if (args.includes("--child")) {
    const arm = (args.find((token) => token.startsWith("--arm=")) || "--arm=off").slice("--arm=".length);
    const jsonArg = args.find((token) => token.startsWith("--json="));
    const summary = runChild(arm);
    if (jsonArg) fs.writeFileSync(jsonArg.slice("--json=".length), JSON.stringify(summary));
    else console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("PR-5.26g retroactive guided skyline demotion - fixed-work A/B");
  console.log(`  workload: ${FROZEN.maxExpansions} expansions, no wall limit, cap ${FROZEN.pendingCandidateCap}, ` +
    `dynamic Pareto ON, neutral substitution ON, stable guided tie-break ON, priorityMap ABSENT`);

  const off = spawnArm("off");
  const on = spawnArm("on");

  const offMatchesAnchor = off.guidedAdmittedGenerated === PR526F_ON_ANCHOR.guidedAdmittedGenerated
    && off.candidatesDropped === PR526F_ON_ANCHOR.candidatesDropped
    && off.cp14.expandedAt === PR526F_ON_ANCHOR.cp14ExpandedAt
    && off.cp16.expandedAt === PR526F_ON_ANCHOR.cp16ExpandedAt;

  const micros = spawnSync(process.execPath, [path.resolve(__dirname, "check-guided-retro-demotion.js")], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });

  const gates = {
    OFF_ARM_MATCHES_5_26F_STABLE_ANCHOR: offMatchesAnchor === true,
    ON_DEMOTIONS_BEFORE_BUDGET_END: on.guidedRetroDemotions > 0,
    ON_REACHES_FIXED_WORK_WITHOUT_RSS_LIMIT: on.stoppedReason === "expansion-limit",
    NO_CORRECTNESS_REGRESSION: micros.status === 0 && off.stoppedReason === "expansion-limit",
  };

  const summary = {
    milestone: "PR-5.26g",
    audit: "RETROACTIVE_GUIDED_SKYLINE_DEMOTION_FIXED_WORK_AB",
    searchPolicyChange: "GUIDED_ADMISSION_MEMBERSHIP_ONLY",
    mechanismIsOptIn: true,
    hardPruning: false,
    oracleUse: "POST_HOC_LOOKUP_ONLY",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    preDeclaredGates: [
      "OFF_ARM_MATCHES_5_26F_STABLE_ANCHOR = TRUE",
      "ON_DEMOTIONS_BEFORE_BUDGET_END = TRUE",
      "ON_REACHES_FIXED_WORK_WITHOUT_RSS_LIMIT = TRUE",
      "NO_CORRECTNESS_REGRESSION = TRUE",
    ],
    offArmMatchesPr526fAnchor: offMatchesAnchor,
    guidedServiceOrderDiffersBetweenArms: orderDiffers(off.guidedExpansionSeq, on.guidedExpansionSeq),
    correctnessMicroExitCode: micros.status,
    gates,
    off,
    on,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const line = (arm) => `  ${arm.retroactiveGuidedSkylineDemotion ? "ON " : "OFF"}: guided=${arm.guidedExpansions} neutral=${arm.neutralExpansions} ` +
    `admitted=${arm.guidedAdmittedGenerated} highest=${arm.deepestReachedFloorOrdinal} depth=${arm.deepestStrategicDepth} ` +
    `dropped=${arm.candidatesDropped} exp=${arm.strategicExpansions} stopped=${arm.stoppedReason} rss=${arm.peakRssMb}MB wall=${arm.wallMs}ms | ` +
    `liveGuidedEnd=${arm.liveGuidedPendingAtEnd} rank10End=${arm.rank10PendingAtEnd} peak=${arm.guidedActivePeak} ` +
    `retroDemoted=${arm.guidedRetroDemotions} retroStillPending=${arm.retroDemotedStillPendingAtEnd} staleSkips=${arm.guidedHeapStaleDemotionSkips} ` +
    `groupIds=${arm.guidedGroupTrackedIds}/${arm.guidedGroupSweepThreshold} sweeps=${arm.guidedGroupSweeps} | ` +
    `cp14 reg=${arm.cp14.registeredAt} exp=${arm.cp14.expandedAt} demoted=${arm.cp14.retroDemotedAt} | ` +
    `cp16 reg=${arm.cp16.registeredAt} exp=${arm.cp16.expandedAt} demoted=${arm.cp16.retroDemotedAt}`;
  console.log(line(off));
  console.log(line(on));
  console.log(`  OFF_ARM_MATCHES_5_26F_STABLE_ANCHOR = ${offMatchesAnchor}`);
  console.log(`  GUIDED_SERVICE_ORDER_DIFFERS_BETWEEN_ARMS = ${summary.guidedServiceOrderDiffersBetweenArms}`);
  console.log(`  correctness micros exit = ${micros.status}`);
  for (const [name, value] of Object.entries(gates)) console.log(`  ${name} = ${value}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
  if (!Object.values(gates).every(Boolean)) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { FROZEN, orderDiffers };
