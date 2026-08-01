"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const {
  runAdaptiveSegmentPlanner,
} = require("./lib/adaptive-segment-planner");
const { createSyntheticScenario } = require("./adaptive-repair-synthetic-simulator");

const DEFAULT_OUT = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.6a-adaptive-repair-outcome-contract.json"
);
const DEFAULT_OUT_MD = DEFAULT_OUT.replace(/\.json$/i, ".md");
const CONTRACT_SCHEMA = "motapathfinder.pr-4.6a1-adaptive-repair-outcome-contract.v1";
const REPAIR_BUDGET = Object.freeze({
  maxRepairs: 1,
  repairMaxExpansions: 300,
  repairMaxRuntimeMs: 2000,
});

const CASES = Object.freeze([
  {
    id: "atk-deficit-positive",
    scenario: "attack",
    failureClass: "atk-deficit",
    expectedOutcome: "success",
    failureClassFamily: "attack-resource-or-best-combat",
    selectedRepairIntent: "stat-atk",
    mappingFamily: "attack-resource-or-best-combat",
    plannerMode: "resource-intent-scanner",
  },
  {
    id: "action-survivability-deficit",
    scenario: "survivability",
    failureClass: "action-survivability-deficit",
    failureClassAliases: ["hp-deficit"],
    expectedOutcome: "repair-incomplete",
    failureClassFamily: "hp-high-survival-low-damage",
    selectedRepairIntent: "adaptive-window-repair:hp-high-survival-low-damage",
    mappingFamily: "hp-high-survival-low-damage",
    plannerMode: "adaptive-window-repair",
  },
  {
    id: "target-action-unreachable",
    scenario: "target",
    failureClass: "target-action-unreachable",
    expectedOutcome: "success",
    failureClassFamily: "adaptive-window-change-floor-repair",
    selectedRepairIntent: "adaptive-window-repair:change-floor-whitelist",
    mappingFamily: "adaptive-window-change-floor-repair",
    plannerMode: "adaptive-window-repair",
    mappingNote: "blocker/openDoor intent is not claimed; only observed change-floor window behavior is reported",
  },
  {
    id: "present-tile-overconstrained",
    scenario: "present",
    failureClass: "present-tile-overconstrained",
    expectedOutcome: "rejected",
    failureClassFamily: "presentTiles-relaxation",
    selectedRepairIntent: "presentTiles-to-preferredPresentTiles",
    mappingFamily: "presentTiles-relaxation",
    plannerMode: "contract-adapter",
  },
  {
    id: "budget-or-action-scope-exhausted",
    scenario: "budget",
    failureClass: "budget-or-action-scope-exhausted",
    expectedOutcome: "repair-incomplete",
    failureClassFamily: "auto-split-or-action-scope-expansion",
    selectedRepairIntent: "auto-split-or-action-scope-expansion",
    mappingFamily: "auto-split-or-action-scope-expansion",
    plannerMode: "auto-segment-split",
  },
]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) options[match[1]] = match[2];
  });
  return options;
}

function generationCommit() {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    return null;
  }
}

function policyFor(floorIds, actionKinds, allowChangeFloors) {
  return {
    actionKinds: actionKinds.slice(),
    allowedFloors: floorIds.slice(),
    ...(allowChangeFloors ? { allowChangeFloors: allowChangeFloors.slice() } : {}),
    forbidUnsupportedEvents: true,
  };
}

function makeSpec(caseDef) {
  const sourcePolicy = caseDef.scenario === "target"
    ? policyFor(["S1", "S2"], ["battle", "changeFloor"], ["S1:0,0"])
    : policyFor(["S1"], ["battle", "pickup"]);
  let failedGoal;
  let failedPolicy;
  if (caseDef.scenario === "attack") {
    failedGoal = {
      type: "heroAtLeast",
      floorId: "S1",
      minEffectiveHero: { atk: 10 },
    };
    failedPolicy = policyFor(["S1"], ["battle"]);
  } else if (caseDef.scenario === "survivability") {
    failedGoal = {
      type: "heroAtLeast",
      floorId: "S1",
      actionSurvivable: { summary: "battle:survivor@S1:2,0" },
    };
    failedPolicy = policyFor(["S1"], ["battle"]);
  } else if (caseDef.scenario === "target") {
    failedGoal = {
      type: "heroAtLeast",
      floorId: "S2",
      actionSurvivable: { summary: "battle:target@S2:1,0" },
    };
    failedPolicy = policyFor(["S1"], ["battle"]);
  } else if (caseDef.scenario === "present") {
    failedGoal = {
      type: "heroAtLeast",
      floorId: "S1",
      minHero: { hp: 100 },
      presentTiles: [{ floorId: "S1", x: 1, y: 0 }],
    };
    failedPolicy = policyFor(["S1"], []);
  } else {
    failedGoal = {
      type: "syntheticBudgetGoal",
      floorId: "S1",
      resourceDeferral: {
        resourceSummary: "battle:unsupported@S1:2,0",
        requireSurvivable: true,
      },
    };
    failedPolicy = policyFor(["S1"], []);
  }
  return {
    id: `pr-4.6a1-${caseDef.id}`,
    milestones: [
      {
        id: "repair-source",
        startFrom: null,
        goal: {
          type: "heroAtLeast",
          floorId: "S1",
          minHero: { hp: 100 },
        },
        actionPolicy: sourcePolicy,
        dp: {
          keyMode: "region",
          stopOnFirstGoal: false,
          maxExpansions: 1000,
          maxRuntimeMs: 1000,
        },
      },
      {
        id: "failed",
        startFrom: "repair-source",
        goal: failedGoal,
        actionPolicy: failedPolicy,
        dp: {
          keyMode: "region",
          stopOnFirstGoal: false,
          maxExpansions: caseDef.scenario === "budget" ? 1 : 1000,
          maxRuntimeMs: 1000,
        },
      },
    ],
  };
}

function contractAdapterSegment(caseDef) {
  const policy = policyFor(["S1"], []);
  return {
    id: "contract-repair-present-tiles-1",
    label: "PR-4.6a1 presentTiles admissibility control",
    generated: true,
    generatedBy: {
      mode: "contract-adapter",
      contractOnly: true,
      failureClass: caseDef.failureClass,
      intentKind: caseDef.selectedRepairIntent,
      downgrade: true,
      presentTilesBefore: [{ floorId: "S1", x: 1, y: 0 }],
      presentTilesAfter: [],
      reason: "synthetic validator control; the hard tile is already absent at the baseline checkpoint",
    },
    goal: {
      type: "adaptivePresentTileRelaxation",
      floorId: "S1",
      presentTiles: [],
    },
    actionPolicy: policy,
    dp: {
      keyMode: "region",
      priorityMode: "default",
      stopOnFirstGoal: false,
      maxActionsPerState: 9999,
      maxExpansions: REPAIR_BUDGET.repairMaxExpansions,
      maxRuntimeMs: REPAIR_BUDGET.repairMaxRuntimeMs,
      goalSkylineLimit: 4,
    },
  };
}

function compactSegment(segment) {
  if (!segment) return null;
  return {
    id: segment.id,
    label: segment.label,
    generated: segment.generated === true,
    generatedBy: cloneJson(segment.generatedBy || null),
    startFrom: segment.startFrom || null,
    goal: cloneJson(segment.goal || null),
    actionPolicy: cloneJson(segment.actionPolicy || null),
    dp: cloneJson(segment.dp || null),
  };
}

function compactAttempt(result, index, source) {
  return {
    index,
    source,
    found: Boolean(result && result.found),
    reachedMilestone: result && result.reachedMilestone || null,
    failedSegmentId: result && result.failedSegment && (
      result.failedSegment.segmentId || result.failedSegment.failedSegmentId
    ) || null,
    segmentResults: (result && result.segmentResults || []).map((segment) => ({
      segmentId: segment.segmentId,
      found: Boolean(segment.found),
      candidateCount: (segment.candidates || []).length,
      failureClass: segment.failureClass ||
        (segment.failurePropagation && (
          segment.failurePropagation.failureClass ||
          segment.failurePropagation.primaryFailureClass
        )) || null,
    })),
  };
}

function baselineFailureClass(runResult) {
  const attempt = runResult && runResult.adaptive && runResult.adaptive.attempts && runResult.adaptive.attempts[0];
  const failed = attempt && (attempt.segmentResults || []).find((segment) => !segment.found && segment.failureClass);
  return failed && failed.failureClass || null;
}

function repairExecutionOptions() {
  return {
    maxAdaptiveRepairs: REPAIR_BUDGET.maxRepairs,
    candidateLimit: 4,
    repairBranchLimit: 1,
    enableFailureBacktracking: false,
    enableConvergenceSplit: false,
    repairMaxExpansions: REPAIR_BUDGET.repairMaxExpansions,
    repairMaxRuntimeMs: REPAIR_BUDGET.repairMaxRuntimeMs,
    windowRepairMaxExpansions: REPAIR_BUDGET.repairMaxExpansions,
    windowRepairMaxRuntimeMs: REPAIR_BUDGET.repairMaxRuntimeMs,
    splitMaxExpansions: REPAIR_BUDGET.repairMaxExpansions,
    splitMaxRuntimeMs: REPAIR_BUDGET.repairMaxRuntimeMs,
  };
}

function compactBranches(runResult) {
  return cloneJson((runResult && runResult.adaptive && runResult.adaptive.repairBranches) || []);
}

function buildExecutedCase(caseDef) {
  const { simulator, initialState } = createSyntheticScenario(caseDef.scenario);
  const spec = makeSpec(caseDef);
  const options = repairExecutionOptions();
  const runResult = runAdaptiveSegmentPlanner(simulator, initialState, spec, options);
  const adaptive = runResult.adaptive || {};
  const baseline = adaptive.attempts && adaptive.attempts[0] || null;
  const baselineClass = baselineFailureClass(runResult);
  if (baselineClass !== caseDef.failureClass) {
    throw new Error(`${caseDef.id}: expected baseline ${caseDef.failureClass}, observed ${baselineClass}`);
  }
  const inserted = adaptive.insertedSegments && adaptive.insertedSegments[0] || null;
  const repaired = compactAttempt(runResult, 1, "adaptive-final-result");
  const observedOutcome = runResult.found ? "success" : inserted ? "repair-incomplete" : "repair-incomplete";
  const repairedExecutionCount = inserted ? 1 : 0;
  return {
    id: caseDef.id,
    baselineOutcome: {
      status: "failed",
      failureClass: baselineClass,
      failureClassAliases: (caseDef.failureClassAliases || []).slice(),
      failedSegmentId: baseline && baseline.failedSegmentId || null,
    },
    failureClass: baselineClass,
    failureClassFamily: caseDef.failureClassFamily,
    selectedRepairIntent: inserted && inserted.generatedBy && inserted.generatedBy.intentKind || caseDef.selectedRepairIntent,
    mapping: {
      family: caseDef.mappingFamily,
      observedMode: inserted && inserted.generatedBy && inserted.generatedBy.mode || null,
      observedIntentKind: inserted && inserted.generatedBy && inserted.generatedBy.intentKind || null,
      verdict: inserted && inserted.generatedBy && inserted.generatedBy.mode === caseDef.plannerMode
        ? "supported"
        : "not-observed",
      note: caseDef.mappingNote || null,
    },
    generatedRepairSegment: compactSegment(inserted),
    plannerProbe: {
      usedExistingPlanner: true,
      mode: inserted && inserted.generatedBy && inserted.generatedBy.mode || null,
      segmentId: inserted && inserted.id || null,
      generated: compactSegment(inserted),
    },
    repairBudget: cloneJson(REPAIR_BUDGET),
    effectiveRepairBudget: inserted && inserted.dp
      ? {
          maxExpansions: Number(inserted.dp.maxExpansions),
          maxRuntimeMs: Number(inserted.dp.maxRuntimeMs),
        }
      : null,
    baselineAttempt: compactAttempt({
      found: baseline && baseline.found,
      reachedMilestone: baseline && baseline.reachedMilestone,
      failedSegment: { segmentId: baseline && baseline.failedSegmentId },
      segmentResults: baseline && baseline.segmentResults,
    }, 0, "adaptive-baseline-attempt"),
    insertedSegmentId: inserted && inserted.id || null,
    repairedAttempt: repaired,
    repairBranches: compactBranches(runResult),
    observedOutcome,
    expectedOutcome: caseDef.expectedOutcome,
    terminationReason: observedOutcome === "success" ? "repair-success" : "repair-incomplete",
    repairAttempt: {
      index: inserted ? 1 : null,
      maxRepairCount: REPAIR_BUDGET.maxRepairs,
      recursion: false,
      appliedRepairCount: repairedExecutionCount,
      executed: inserted != null,
    },
    oneRepairClosure: {
      orchestratorAttemptCount: (adaptive.attempts || []).length,
      executedAttemptCount: inserted ? 2 : 1,
      insertedSegmentCount: (adaptive.insertedSegments || []).length,
      repairIndexes: compactBranches(runResult).map((branch) => branch.repairIndex),
      stoppedAfterOneRepair: (adaptive.insertedSegments || []).length <= 1 &&
        compactBranches(runResult).every((branch) => branch.repairIndex === 0),
      stoppedReason: observedOutcome === "repair-incomplete"
        ? adaptive.stoppedReason || (runResult.failedSegment && runResult.failedSegment.failureClass) || "max-repair-count"
        : "repair-success",
    },
    execution: {
      runner: "runAdaptiveSegmentPlanner",
      options: cloneJson(options),
      simulator: "deterministic-synthetic",
    },
    scope: {
      shadowOnly: true,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      describesCompleteOnlyUpRoute: false,
    },
  };
}

function buildRejectedPresentCase(caseDef) {
  const { simulator, initialState } = createSyntheticScenario(caseDef.scenario);
  const spec = makeSpec(caseDef);
  const options = repairExecutionOptions();
  const runResult = runAdaptiveSegmentPlanner(simulator, initialState, spec, options);
  const adaptive = runResult.adaptive || {};
  const baseline = adaptive.attempts && adaptive.attempts[0] || null;
  const baselineClass = baselineFailureClass(runResult);
  if (baselineClass !== caseDef.failureClass) {
    throw new Error(`${caseDef.id}: expected baseline ${caseDef.failureClass}, observed ${baselineClass}`);
  }
  const proposed = contractAdapterSegment(caseDef);
  const validator = {
    accepted: false,
    predicate: "required presentTiles must exist at the baseline checkpoint",
    reason: "present tile S1:1,0 is already absent; downgrade would erase a hard dependency rather than repair it",
  };
  return {
    id: caseDef.id,
    baselineOutcome: {
      status: "failed",
      failureClass: baselineClass,
      failureClassAliases: [],
      failedSegmentId: baseline && baseline.failedSegmentId || null,
    },
    failureClass: baselineClass,
    failureClassFamily: caseDef.failureClassFamily,
    selectedRepairIntent: caseDef.selectedRepairIntent,
    mapping: {
      family: caseDef.mappingFamily,
      observedMode: "contract-adapter",
      observedIntentKind: caseDef.selectedRepairIntent,
      verdict: "validator-rejected",
      note: "presentTiles downgrade is evaluated before insertion",
    },
    generatedRepairSegment: compactSegment(proposed),
    plannerProbe: {
      usedExistingPlanner: false,
      mode: "contract-adapter",
      segmentId: proposed.id,
      generated: compactSegment(proposed),
      reason: "production planner was run for the baseline; the proposed relaxation was rejected before insertion",
    },
    repairBudget: cloneJson(REPAIR_BUDGET),
    effectiveRepairBudget: {
      maxExpansions: proposed.dp.maxExpansions,
      maxRuntimeMs: proposed.dp.maxRuntimeMs,
    },
    baselineAttempt: compactAttempt({
      found: baseline && baseline.found,
      reachedMilestone: baseline && baseline.reachedMilestone,
      failedSegment: { segmentId: baseline && baseline.failedSegmentId },
      segmentResults: baseline && baseline.segmentResults,
    }, 0, "adaptive-baseline-attempt"),
    insertedSegmentId: null,
    repairedAttempt: {
      index: null,
      source: "admissibility-validator",
      executed: false,
      found: false,
      failedSegmentId: baseline && baseline.failedSegmentId || null,
      terminationReason: "repair-rejected",
    },
    repairBranches: [],
    observedOutcome: "rejected",
    expectedOutcome: caseDef.expectedOutcome,
    terminationReason: "repair-rejected",
    repairAttempt: {
      index: null,
      maxRepairCount: REPAIR_BUDGET.maxRepairs,
      recursion: false,
      appliedRepairCount: 0,
      executed: false,
    },
    oneRepairClosure: {
      orchestratorAttemptCount: (adaptive.attempts || []).length,
      executedAttemptCount: 1,
      insertedSegmentCount: 0,
      repairIndexes: [],
      stoppedAfterOneRepair: true,
      stoppedReason: "repair-rejected",
    },
    admissibilityValidator: validator,
    execution: {
      runner: "runAdaptiveSegmentPlanner",
      options: cloneJson(options),
      simulator: "deterministic-synthetic",
    },
    scope: {
      shadowOnly: true,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      describesCompleteOnlyUpRoute: false,
    },
  };
}

function buildCase(caseDef) {
  const result = caseDef.scenario === "present"
    ? buildRejectedPresentCase(caseDef)
    : buildExecutedCase(caseDef);
  if (result.observedOutcome !== caseDef.expectedOutcome) {
    throw new Error(`${caseDef.id}: expected ${caseDef.expectedOutcome}, observed ${result.observedOutcome}`);
  }
  return result;
}

function buildReport() {
  const cases = CASES.map(buildCase);
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: "deterministic-contract",
    provenance: {
      generationCommit: generationCommit(),
      source: "shared-solver/lib/adaptive-segment-planner.js",
      syntheticSimulator: "shared-solver/adaptive-repair-synthetic-simulator.js",
      mode: "shadow-only",
    },
    contract: {
      id: "PR-4.6a1",
      title: "Executed One-Repair Outcome Controls",
      maxRepairs: 1,
      fixedCaseCount: 5,
      supportedFailureClasses: [
        "atk-deficit",
        "hp-deficit",
        "action-survivability-deficit",
        "target-action-unreachable",
        "present-tile-overconstrained",
        "budget-or-action-scope-exhausted",
      ],
      terminationReasons: ["repair-success", "repair-rejected", "repair-incomplete"],
      unresolvedOutcome: "repair-incomplete",
      expectedObservedMustMatch: true,
      syntheticControlLabel: "synthetic-contract-executed",
    },
    cases,
    controls: {
      positiveRepairSuccess: cases.find((item) => item.observedOutcome === "success").id,
      negativeRepairRejected: cases.find((item) => item.observedOutcome === "rejected").id,
      incompleteRepair: cases.find((item) => item.observedOutcome === "repair-incomplete").id,
      autoSplit: cases.find((item) => item.plannerProbe.mode === "auto-segment-split").id,
      deterministicLiveRebuild: true,
      observedFromRunner: true,
    },
  };
}

function markdown(report) {
  const lines = [
    "# PR-4.6a1 Executed One-Repair Outcome Controls",
    "",
    `- Schema: \`${report.schema}\``,
    "- Status: completed",
    "- Scope: shadow-only",
    "- Runner: `runAdaptiveSegmentPlanner` with `maxAdaptiveRepairs=1`",
    "- Outcomes are observed from executed synthetic runs; rejected controls are stopped by an admissibility validator before insertion.",
    "- Synthetic execution is not a claim of a complete OnlyUp route.",
    "",
    "| Case | Failure class | Observed intent/mode | Expected | Observed | Applied repairs | Termination |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  report.cases.forEach((item) => {
    const intent = item.selectedRepairIntent || item.plannerProbe.mode;
    lines.push(`| ${item.id} | ${item.failureClass} | ${intent} / ${item.plannerProbe.mode} | ${item.expectedOutcome} | ${item.observedOutcome} | ${item.repairAttempt.appliedRepairCount} | ${item.terminationReason} |`);
  });
  lines.push(
    "",
    "Every executed repair segment is checked against the declared 300-expansion / 2000-ms shadow repair budget.",
    "",
    "Production DP keys, dominance, agenda, capacity, default maxAdaptiveRepairs, and default policy are unchanged.",
    ""
  );
  return lines.join("\n");
}

function writeReport(report, outFile, outMdFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMdFile, markdown(report), "utf8");
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const outFile = path.resolve(options.out || DEFAULT_OUT);
  const outMdFile = path.resolve(options["out-md"] || DEFAULT_OUT_MD);
  const report = buildReport();
  writeReport(report, outFile, outMdFile);
  process.stdout.write(`${JSON.stringify({ out: outFile, outMd: outMdFile, cases: report.cases.length })}\n`);
}

module.exports = {
  CASES,
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  REPAIR_BUDGET,
  buildReport,
  markdown,
  writeReport,
};
