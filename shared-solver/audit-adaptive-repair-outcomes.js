"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { buildRepairSegment } = require("./lib/adaptive-segment-planner");

const DEFAULT_OUT = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.6a-adaptive-repair-outcome-contract.json"
);
const DEFAULT_OUT_MD = DEFAULT_OUT.replace(/\.json$/i, ".md");
const CONTRACT_SCHEMA = "motapathfinder.pr-4.6a-adaptive-repair-outcome-contract.v1";
const REPAIR_BUDGET = Object.freeze({
  maxRepairs: 1,
  repairMaxExpansions: 300,
  repairMaxRuntimeMs: 2000,
});

const CASES = Object.freeze([
  {
    id: "atk-deficit-positive",
    failureClass: "atk-deficit",
    failureClassFamily: "attack-resource",
    selectedRepairIntent: "attack-resource-or-best-combat",
    plannerMode: "contract-adapter",
    controlOutcome: "success",
    missingGoalFields: ["effectiveHero.atk"],
    goal: {
      type: "adaptiveResourceIntent",
      minEffectiveHero: { atk: 120 },
      resourceIntent: "attack-resource-or-best-combat",
    },
  },
  {
    id: "action-survivability-deficit",
    failureClass: "action-survivability-deficit",
    failureClassAliases: ["hp-deficit"],
    failureClassFamily: "hp-high-survival-low-damage",
    selectedRepairIntent: "hp-high-survival-low-damage",
    plannerMode: "adaptive-window-repair",
    controlOutcome: "repair-incomplete",
    missingGoalFields: ["actionSurvivable", "hero.hp"],
    goal: {
      type: "heroAtLeast",
      floorId: "MT2",
      minHero: { hp: 2500, def: 80 },
    },
  },
  {
    id: "target-action-unreachable",
    failureClass: "target-action-unreachable",
    failureClassFamily: "blocker-open-door-change-floor",
    selectedRepairIntent: "blocker-open-door-change-floor-whitelist",
    plannerMode: "adaptive-window-repair",
    controlOutcome: "success",
    missingGoalFields: ["targetAction"],
    goal: {
      type: "heroAtLeast",
      floorId: "MT2",
      minHero: { hp: 1200 },
      targetAction: "battle:target-blocker@MT2:1,1",
    },
  },
  {
    id: "present-tile-overconstrained",
    failureClass: "present-tile-overconstrained",
    failureClassFamily: "presentTiles-relaxation",
    selectedRepairIntent: "presentTiles-to-preferredPresentTiles",
    plannerMode: "contract-adapter",
    controlOutcome: "rejected",
    missingGoalFields: ["presentTiles"],
    goal: {
      type: "heroAtLeast",
      floorId: "MT2",
      minHero: { hp: 1200 },
      presentTiles: [
        { floorId: "MT2", x: 1, y: 1 },
        { floorId: "MT2", x: 2, y: 1 },
      ],
      preferredPresentTiles: [{ floorId: "MT2", x: 1, y: 1 }],
    },
  },
  {
    id: "budget-or-action-scope-exhausted",
    failureClass: "budget-or-action-scope-exhausted",
    failureClassFamily: "budget-or-action-scope",
    selectedRepairIntent: "auto-split-or-action-scope-expansion",
    plannerMode: "auto-segment-split",
    controlOutcome: "repair-incomplete",
    missingGoalFields: ["budget", "actionScope"],
    goal: {
      type: "heroAtLeast",
      floorId: "MT2",
      minHero: { hp: 1500, atk: 100 },
    },
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

function policyFor(floorIds) {
  return {
    actionKinds: ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor"],
    allowedFloors: floorIds.slice(),
    allowChangeFloors: floorIds.map((floorId) => `${floorId}:0,0`),
    forbidUnsupportedEvents: true,
  };
}

function makeSpec(caseDef) {
  const sourcePolicy = policyFor(["MT1"]);
  const failedPolicy = policyFor(["MT1", "MT2"]);
  return {
    id: `pr-4.6a-${caseDef.id}`,
    milestones: [
      {
        id: "repair-source",
        startFrom: null,
        goal: {
          type: "heroAtLeast",
          floorId: "MT1",
          minHero: { hp: 1000 },
        },
        actionPolicy: sourcePolicy,
        dp: { keyMode: "region", stopOnFirstGoal: false, maxExpansions: 1000, maxRuntimeMs: 1000 },
      },
      {
        id: "failed",
        startFrom: "repair-source",
        goal: cloneJson(caseDef.goal),
        actionPolicy: failedPolicy,
        dp: { keyMode: "region", stopOnFirstGoal: false, maxExpansions: 8000, maxRuntimeMs: 15000 },
      },
    ],
  };
}

function makeAttempts(caseDef) {
  if (caseDef.failureClass !== "budget-or-action-scope-exhausted") return [];
  return [{
    diagnostics: {
      dp: {
        stoppedReason: "time-limit",
        actionTrimmed: 0,
        statesWithActionTrim: 0,
      },
      failure: {
        bestSeen: {
          floorId: "MT1",
          hero: {
            hp: 1234,
            atk: 56,
            def: 78,
            mdef: 90,
            lv: 3,
            exp: 12,
            equipment: ["IX"],
          },
          effectiveHero: {
            hp: 1234,
            atk: 112,
            def: 156,
            mdef: 180,
            lv: 3,
            exp: 12,
          },
        },
      },
    },
  }];
}

function makePlannerResult(caseDef) {
  return {
    found: false,
    failedSegment: {
      segmentId: "failed",
      failureClass: caseDef.failureClass,
      missingGoalFields: caseDef.missingGoalFields.slice(),
      attempts: makeAttempts(caseDef),
    },
    finalCandidates: [],
  };
}

function contractAdapterSegment(caseDef) {
  const policy = policyFor(["MT1", "MT2"]);
  if (caseDef.failureClass === "atk-deficit") {
    return {
      id: "contract-repair-atk-deficit-1",
      label: "PR-4.6a attack-resource repair contract",
      generated: true,
      generatedBy: {
        mode: "contract-adapter",
        contractOnly: true,
        failureClass: caseDef.failureClass,
        intentKind: caseDef.selectedRepairIntent,
        reason: "shadow contract control for attack resource or best-combat repair",
      },
      goal: cloneJson(caseDef.goal),
      actionPolicy: policy,
      dp: {
        keyMode: "region",
        priorityMode: "combat-first",
        stopOnFirstGoal: false,
        maxActionsPerState: 9999,
        maxExpansions: REPAIR_BUDGET.repairMaxExpansions,
        maxRuntimeMs: REPAIR_BUDGET.repairMaxRuntimeMs,
        goalSkylineLimit: 4,
      },
    };
  }
  return {
    id: "contract-repair-present-tiles-1",
    label: "PR-4.6a presentTiles downgrade contract",
    generated: true,
    generatedBy: {
      mode: "contract-adapter",
      contractOnly: true,
      failureClass: caseDef.failureClass,
      intentKind: caseDef.selectedRepairIntent,
      downgrade: true,
      presentTilesBefore: cloneJson(caseDef.goal.presentTiles),
      presentTilesAfter: cloneJson(caseDef.goal.preferredPresentTiles),
      reason: "shadow contract control for a one-step presentTiles relaxation",
    },
    goal: {
      type: "adaptivePresentTileRelaxation",
      floorId: caseDef.goal.floorId,
      minHero: cloneJson(caseDef.goal.minHero),
      presentTiles: cloneJson(caseDef.goal.preferredPresentTiles),
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

function buildPlannerProbe(caseDef, spec, plannerResult) {
  if (caseDef.plannerMode === "contract-adapter") {
    return {
      usedExistingPlanner: false,
      mode: "contract-adapter",
      reason: "case is deliberately a shadow contract control; production planner is unchanged",
    };
  }
  const plannerSegment = buildRepairSegment(null, plannerResult, {
    currentSpec: spec,
    repairIndex: 0,
    candidateLimit: 4,
    repairMaxExpansions: REPAIR_BUDGET.repairMaxExpansions,
    repairMaxRuntimeMs: REPAIR_BUDGET.repairMaxRuntimeMs,
    splitMaxExpansions: REPAIR_BUDGET.repairMaxExpansions,
    splitMaxRuntimeMs: REPAIR_BUDGET.repairMaxRuntimeMs,
  });
  return {
    usedExistingPlanner: Boolean(plannerSegment),
    mode: plannerSegment && plannerSegment.generatedBy && plannerSegment.generatedBy.mode || null,
    segmentId: plannerSegment && plannerSegment.id || null,
    failureClass: caseDef.failureClass,
    generated: compactSegment(plannerSegment),
  };
}

function evaluateRepair(caseDef, segment) {
  const outcome = caseDef.controlOutcome;
  return {
    repairedOutcome: outcome,
    terminationReason: outcome === "success"
      ? "repair-success"
      : outcome === "rejected"
        ? "repair-rejected"
        : "repair-incomplete",
    evidence: "synthetic-contract-only",
    appliedRepairCount: segment ? 1 : 0,
  };
}

function buildCase(caseDef) {
  const spec = makeSpec(caseDef);
  const plannerResult = makePlannerResult(caseDef);
  const plannerProbe = buildPlannerProbe(caseDef, spec, plannerResult);
  const generated = plannerProbe.generated || compactSegment(contractAdapterSegment(caseDef));
  const repair = evaluateRepair(caseDef, generated);
  return {
    id: caseDef.id,
    baselineOutcome: {
      status: "failed",
      failureClass: caseDef.failureClass,
      failureClassAliases: (caseDef.failureClassAliases || []).slice(),
      failedSegmentId: "failed",
    },
    failureClass: caseDef.failureClass,
    failureClassFamily: caseDef.failureClassFamily,
    selectedRepairIntent: caseDef.selectedRepairIntent,
    generatedRepairSegment: generated,
    plannerProbe,
    repairBudget: cloneJson(REPAIR_BUDGET),
    repairedOutcome: repair.repairedOutcome,
    terminationReason: repair.terminationReason,
    repairAttempt: {
      index: 1,
      maxRepairCount: REPAIR_BUDGET.maxRepairs,
      recursion: false,
      outcomeEvidence: repair.evidence,
      appliedRepairCount: repair.appliedRepairCount,
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

function buildReport() {
  const cases = CASES.map(buildCase);
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: "deterministic-contract",
    provenance: {
      generationCommit: generationCommit(),
      source: "shared-solver/lib/adaptive-segment-planner.js",
      mode: "shadow-only",
    },
    contract: {
      id: "PR-4.6a",
      title: "Adaptive Repair Outcome Contract",
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
      syntheticControlLabel: "synthetic-contract-only",
    },
    cases,
    controls: {
      positiveRepairSuccess: cases.find((item) => item.repairedOutcome === "success").id,
      negativeRepairRejected: cases.find((item) => item.repairedOutcome === "rejected").id,
      incompleteRepair: cases.find((item) => item.repairedOutcome === "repair-incomplete").id,
      autoSplit: cases.find((item) => item.plannerProbe.mode === "auto-segment-split").id,
      deterministicLiveRebuild: true,
    },
  };
}

function markdown(report) {
  const lines = [
    "# PR-4.6a Adaptive Repair Outcome Contract",
    "",
    `- Schema: \`${report.schema}\``,
    "- Status: completed",
    "- Scope: shadow-only",
    "- Maximum repair count: 1",
    "- Synthetic controls use the label `synthetic-contract-only` and are not claims of a complete OnlyUp route.",
    "",
    "| Case | Failure class | Selected intent | Planner mode | Repaired outcome | Termination |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  report.cases.forEach((item) => {
    lines.push(`| ${item.id} | ${item.failureClass} | ${item.selectedRepairIntent} | ${item.plannerProbe.mode} | ${item.repairedOutcome} | ${item.terminationReason} |`);
  });
  lines.push(
    "",
    "The contract records baseline outcome, failure class, selected intent, generated repair segment, repair budget, repaired outcome, and explicit termination reason.",
    "",
    "Production DP keys, dominance, agenda, capacity, and default policy are unchanged.",
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
