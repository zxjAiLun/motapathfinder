"use strict";

/**
 * PR-5.26f - Stable guided equal-score tie-break, fixed-work A/B.
 *
 * Both arms run the SAME pipeline on the SAME commit with the frozen workload
 * (12000 expansions, no wall limit, cap 1024, dynamic Pareto ON, neutral
 * substitution ON). The ONLY difference is `stableGuidedTieBreak`.
 *
 * This mechanism is a SERVICE FAIRNESS CONTRACT, not a cp#16 heuristic, so this
 * phase deliberately sets NO capability pass/fail gate on cp#14/cp#16's fate.
 * It verifies only:
 *
 *   STABLE_EQUAL_SCORE_ORDER_ACTIVE   = TRUE
 *   HIGHER_SCORE_PRIORITY_PRESERVED   = TRUE
 *   NO_CORRECTNESS_REGRESSION         = TRUE
 *
 * Each arm runs in its own child process: `maxRssMb` is a process-level limit
 * and V8 does not return freed heap, so running both arms in one process would
 * give the second arm a corrupted starting RSS baseline.
 *
 * Oracle exact keys are used ONLY as a post-hoc filter in the callback. They are
 * never visible to the search: ORACLE_KEYS_AFFECT_SEARCH_DECISIONS = FALSE.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("../../lib/project-loader");
const { createTransportCollapsedSearch } = require("../../lib/transport-collapse");
const { buildDependencyFrontier } = require("../../lib/dependency-frontier");
const { buildOracleCheckpoints, makeSimulator, PROJECT_ROOT } = require("./audit-pr525t-oracle-survival");

const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr526f-tie-break-ab.json");

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
  priorityMap: "ABSENT",
};

// PR-5.26e anchor: the OFF arm must reproduce these exactly, or the comparator
// refactor changed legacy behaviour.
const PR526E_ANCHOR = { guidedAdmittedGenerated: 8916, cp14ExpandedAt: 10351, cp16ExpandedAt: null };

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function summarizeWaitAges(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: sorted.length === 0 ? null : percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length === 0 ? null : sorted[sorted.length - 1],
  };
}

function runChild(arm) {
  const stable = arm === "on";
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

  const waitAges = [];
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
    stableGuidedTieBreak: stable,
    emitGuidedServiceTelemetry: true,
    onCandidateLifecycle: (event) => {
      const target = targets.get(event.exactKey);
      if (target) targetEvents.get(target).push(event);
      if (event.type === "expanded" && event.guidedWaitAgeAtExpansion != null) {
        waitAges.push(event.guidedWaitAgeAtExpansion);
        if (guidedExpansionSeq.length < 400) guidedExpansionSeq.push(event.guidedPendingSeq);
      }
      return null;
    },
  });

  const targetSummary = (name) => {
    const events = targetEvents.get(name);
    const registered = [...events].reverse().find((event) => event.type === "registered") || null;
    const expanded = [...events].reverse().find((event) => event.type === "expanded") || null;
    return {
      registeredAt: registered ? registered.registeredAtStrategicExpansion : null,
      pendingSeq: registered ? registered.pendingSeq : null,
      expanded: Boolean(expanded),
      expandedAt: expanded ? expanded.strategicExpansion : null,
      dropped: events.some((event) => event.type === "dropped"),
    };
  };

  return {
    arm,
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
    cp14: targetSummary("cp14"),
    cp16: targetSummary("cp16"),
    guidedWaitAgeAtExpansion: summarizeWaitAges(waitAges),
    guidedExpansionSeq,
  };
}

function spawnArm(arm) {
  const jsonPath = path.join(os.tmpdir(), `pr526f-${process.pid}-${arm}.json`);
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

  console.log("PR-5.26f stable guided equal-score tie-break - fixed-work A/B");
  console.log(`  workload: ${FROZEN.maxExpansions} expansions, no wall limit, cap ${FROZEN.pendingCandidateCap}, ` +
    `dynamic Pareto ON, neutral substitution ON, priorityMap ABSENT`);

  const off = spawnArm("off");
  const on = spawnArm("on");

  const offMatchesAnchor = off.guidedAdmittedGenerated === PR526E_ANCHOR.guidedAdmittedGenerated
    && off.cp14.expandedAt === PR526E_ANCHOR.cp14ExpandedAt
    && off.cp16.expandedAt === PR526E_ANCHOR.cp16ExpandedAt;
  const orderChanged = orderDiffers(off.guidedExpansionSeq, on.guidedExpansionSeq);

  const gates = {
    STABLE_EQUAL_SCORE_ORDER_ACTIVE: on.stableGuidedTieBreak === true && off.stableGuidedTieBreak === false && orderChanged === true,
    HIGHER_SCORE_PRIORITY_PRESERVED: Object.keys(on.guidedScoreHistogram || {}).length === 1
      && Object.keys(off.guidedScoreHistogram || {}).length === 1,
    NO_CORRECTNESS_REGRESSION: off.stoppedReason === "expansion-limit"
      && on.stoppedReason === "expansion-limit"
      && offMatchesAnchor === true,
  };

  const summary = {
    milestone: "PR-5.26f",
    audit: "STABLE_GUIDED_EQUAL_SCORE_TIE_BREAK_FIXED_WORK_AB",
    searchPolicyChange: "GUIDED_HEAP_EQUAL_SCORE_ORDER_ONLY",
    mechanismIsOptIn: true,
    oracleUse: "POST_HOC_LOOKUP_ONLY",
    oracleKeysAffectSearchDecisions: false,
    target: "DEFINED_EQUAL_SCORE_GUIDED_SERVICE_SEMANTICS",
    notTarget: "MAKE_CP16_EXPAND",
    cp16RescuePredicted: false,
    frozen: FROZEN,
    preDeclaredGates: [
      "STABLE_EQUAL_SCORE_ORDER_ACTIVE = TRUE",
      "HIGHER_SCORE_PRIORITY_PRESERVED = TRUE",
      "NO_CORRECTNESS_REGRESSION = TRUE",
    ],
    offArmMatchesPr526eAnchor: offMatchesAnchor,
    guidedServiceOrderDiffersBetweenArms: orderChanged,
    gates,
    off,
    on,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const line = (arm) => `  ${arm.stableGuidedTieBreak ? "ON " : "OFF"}: guided=${arm.guidedExpansions} neutral=${arm.neutralExpansions} ` +
    `admitted=${arm.guidedAdmittedGenerated} highest=${arm.deepestReachedFloorOrdinal} depth=${arm.deepestStrategicDepth} ` +
    `dropped=${arm.candidatesDropped} exp=${arm.strategicExpansions} stopped=${arm.stoppedReason} rss=${arm.peakRssMb}MB wall=${arm.wallMs}ms | ` +
    `cp14 reg=${arm.cp14.registeredAt} exp=${arm.cp14.expandedAt} | cp16 reg=${arm.cp16.registeredAt} exp=${arm.cp16.expandedAt} | ` +
    `waitAge n=${arm.guidedWaitAgeAtExpansion.count} med=${arm.guidedWaitAgeAtExpansion.median} ` +
    `p95=${arm.guidedWaitAgeAtExpansion.p95} max=${arm.guidedWaitAgeAtExpansion.max}`;
  console.log(line(off));
  console.log(line(on));
  console.log(`  score histograms: off=${JSON.stringify(off.guidedScoreHistogram)} on=${JSON.stringify(on.guidedScoreHistogram)}`);
  console.log(`  OFF_ARM_MATCHES_5_26E_ANCHOR = ${offMatchesAnchor}`);
  console.log(`  GUIDED_SERVICE_ORDER_DIFFERS_BETWEEN_ARMS = ${orderChanged}`);
  for (const [name, value] of Object.entries(gates)) console.log(`  ${name} = ${value}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
  if (!Object.values(gates).every(Boolean)) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { FROZEN, orderDiffers, summarizeWaitAges };
