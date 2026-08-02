"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { scanResourceIntents } = require("./lib/resource-intent-scanner");
const { createResourceIntentScenario } = require("./resource-intent-contract-synthetic-simulator");

const DEFAULT_OUT = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.7a-resource-intent-evidence-contract.json",
);
const DEFAULT_OUT_MD = DEFAULT_OUT.replace(/\.json$/i, ".md");
const CONTRACT_SCHEMA = "motapathfinder.pr-4.7a1-resource-intent-evidence-contract.v1";
const OUTPUT_KINDS = Object.freeze([
  "stat-gain",
  "equipment",
  "levelup",
  "path-blocker",
  "deferred-resource",
]);

const CASES = Object.freeze([
  {
    id: "atk-pickup",
    scenario: "atk-pickup",
    failureClass: "atk-deficit",
    scannerKind: "stat-atk",
    outputKind: "stat-gain",
    failure: {
      failureClass: "atk-deficit",
      missingGoalFields: [{ field: "effectiveHero.atk", expected: 15, actual: 1 }],
    },
    relevance: "direct attack stat pickup",
  },
  {
    id: "atk-equipment",
    scenario: "equipment",
    failureClass: "atk-deficit",
    scannerKind: "equipment",
    outputKind: "equipment",
    failure: {
      failureClass: "atk-deficit",
      missingGoalFields: [
        { field: "effectiveHero.atk", expected: 12, actual: 1 },
        { field: "equipment", expected: "trainingSword", actual: [] },
      ],
    },
    relevance: "attack equipment candidate",
  },
  {
    id: "atk-levelup",
    scenario: "atk-levelup",
    failureClass: "atk-deficit",
    scannerKind: "exp",
    outputKind: "levelup",
    failure: {
      failureClass: "atk-deficit",
      missingGoalFields: [{ field: "effectiveHero.atk", expected: 12, actual: 1 }],
    },
    relevance: "low-cost combat experience for attack progression",
  },
  {
    id: "hp-pickup",
    scenario: "hp-pickup",
    failureClass: "hp-deficit",
    scannerKind: "stat-hp",
    outputKind: "stat-gain",
    failure: {
      failureClass: "hp-deficit",
      missingGoalFields: [{ field: "hero.hp", expected: 140, actual: 100 }],
    },
    relevance: "direct HP pickup",
  },
  {
    id: "hp-low-damage-exp",
    scenario: "hp-levelup",
    failureClass: "hp-deficit",
    scannerKind: "exp",
    outputKind: "levelup",
    failure: {
      failureClass: "hp-deficit",
      missingGoalFields: [{ field: "hero.hp", expected: 140, actual: 100 }],
    },
    relevance: "low-damage experience candidate for HP-constrained progress",
  },
  {
    id: "hp-deferred-resource",
    scenario: "deferred-resource",
    failureClass: "hp-deficit",
    scannerKind: "blocked-hp-resource",
    outputKind: "deferred-resource",
    targetBattle: { floorId: "S1", x: 0, y: 0, enemyId: "targetEnemy" },
    failure: {
      failureClass: "hp-deficit",
      missingGoalFields: [{
        field: "actionSurvivable",
        expected: "hp > 100",
        actual: 50,
        action: "battle:targetEnemy@S1:0,0",
        damage: 100,
        minHpToSurvive: 101,
      }],
    },
    relevance: "defer HP pickup until its blocker is survivable",
  },
  {
    id: "target-door-path-blocker",
    scenario: "path-blocker",
    failureClass: "target-action-unreachable",
    scannerKind: "path-blocker",
    outputKind: "path-blocker",
    failure: {
      failureClass: "target-action-unreachable",
      missingGoalFields: [{ field: "floorId", expected: "S2", actual: "S1" }],
    },
    relevance: "door opening creates a newly reachable floor transition",
  },
]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) options[match[1]] = match[2];
  });
  return options;
}

function scannerOptions(caseDef) {
  return {
    maxIntentRecords: 24,
    recordsPerIntent: 6,
    maxIntents: 6,
    intentDepth: 2,
    maxIntentNodes: 80,
    blockedResourceRadius: 8,
    ...(caseDef.targetBattle ? { targetBattle: caseDef.targetBattle } : {}),
  };
}

function canonicalOutputKind(scannerKind) {
  if (scannerKind === "equipment") return "equipment";
  if (scannerKind === "exp") return "levelup";
  if (scannerKind === "blocked-hp-resource") return "deferred-resource";
  if (scannerKind === "path-blocker" || scannerKind === "path-blocker-chain") return "path-blocker";
  if (String(scannerKind || "").startsWith("stat-")) return "stat-gain";
  return null;
}

function buildScannerScoreBreakdown(record, desiredStats, failureClass) {
  const delta = record.delta || {};
  const blockedResource = record.blockedResource || {};
  const frontier = record.frontierDelta || {};
  const damage = number(record.damage, 0);
  const includes = (stat) => desiredStats.includes(stat);
  const attackContribution = includes("atk")
    ? Math.max(0, number(delta.atk, 0)) * 160000 +
      Math.max(0, number(delta.lv, 0)) * 80000 +
      Math.max(0, number(delta.exp, 0)) * 1400
    : 0;
  const defenseContribution = includes("def")
    ? Math.max(0, number(delta.def, 0)) * 130000 +
      Math.max(0, number(delta.lv, 0)) * 70000 +
      Math.max(0, number(delta.exp, 0)) * 1200
    : 0;
  const magicDefenseContribution = includes("mdef")
    ? Math.max(0, number(delta.mdef, 0)) * 16000 +
      Math.max(0, number(delta.lv, 0)) * 50000 +
      Math.max(0, number(delta.exp, 0)) * 1200
    : 0;
  const hpContribution = includes("hp")
    ? Math.max(0, number(delta.hp, 0)) * 3 +
      Math.max(0, number(delta.def, 0)) * 60000 +
      Math.max(0, number(delta.mdef, 0)) * 5000
    : 0;
  const survivabilityRelevant = [
    "life-limit-hp-deficit",
    "action-survivability-deficit",
    "hp-deficit",
  ].includes(failureClass);
  const survivabilityContribution = survivabilityRelevant
    ? Math.max(0, number(delta.hp, 0)) * 8 +
      Math.max(0, number(delta.def, 0)) * 90000 +
      Math.max(0, number(delta.atk, 0)) * 30000
    : 0;
  const blockedResourceContribution = survivabilityRelevant
    ? Math.max(0, number(blockedResource.hpGain, 0)) * 12 +
      Math.max(0, number(blockedResource.netHpAfterBlocker, 0)) * 4
    : 0;
  let targetBattleContribution = 0;
  if (survivabilityRelevant && record.targetBattleImpact && record.targetBattleImpact.damageReduced > 0) {
    targetBattleContribution += record.targetBattleImpact.damageReduced * 2;
  }
  if (survivabilityRelevant && record.targetBattleImpact && record.targetBattleImpact.survivableAfter) {
    targetBattleContribution += 2000000;
  }
  const equipmentContribution = includes("equipment")
    ? (delta.equipment || []).length * 900000 + (record.actionKind === "equip" ? 300000 : 0)
    : 0;
  let pathContribution = 0;
  if (includes("path")) {
    pathContribution += Math.max(0, number(frontier.targetFloorProgress, 0)) * 900000;
    pathContribution += Math.max(0, number(frontier.floorDelta, 0)) * 700000;
    pathContribution += Math.max(0, number(frontier.newChangeFloorCount, 0)) * 250000;
    pathContribution += Math.max(0, number(frontier.newPickupCount, 0)) * 120000;
    pathContribution += Math.max(0, number(frontier.newBattleCount, 0)) * 80000;
    pathContribution += Math.max(0, number(frontier.newDoorToolCount, 0)) * 80000;
    if (["battle", "openDoor", "useTool"].includes(record.actionKind)) pathContribution += 100000;
    if (frontier.targetFloor != null && frontier.targetFloorProgress <= 0 && record.actionKind === "changeFloor") {
      pathContribution -= 500000;
    }
  }
  let actionKindContribution = 0;
  if (record.actionKind === "pickup") actionKindContribution += 160000;
  if (record.actionKind === "equip") actionKindContribution += 150000;
  if (record.actionKind === "battle") actionKindContribution += 90000;
  if (["openDoor", "useTool"].includes(record.actionKind)) actionKindContribution += 80000;
  if (record.actionKind === "changeFloor") actionKindContribution += 120000;
  const damagePenalty = Math.max(0, damage) * (includes("hp") ? 1.5 : 0.4);
  const hpLossPenalty = Math.max(0, -number(delta.hp, 0)) * 0.25;
  const depthPenalty = Math.max(0, number(record.depth, 1) - 1) * 60000;
  let rawTotal = 0;
  rawTotal += attackContribution;
  rawTotal += defenseContribution;
  rawTotal += magicDefenseContribution;
  rawTotal += hpContribution;
  rawTotal += survivabilityContribution;
  rawTotal += blockedResourceContribution;
  rawTotal += targetBattleContribution;
  rawTotal += equipmentContribution;
  rawTotal += pathContribution;
  rawTotal += actionKindContribution;
  rawTotal -= damagePenalty;
  rawTotal -= hpLossPenalty;
  rawTotal -= depthPenalty;
  return {
    attackContribution,
    defenseContribution,
    magicDefenseContribution,
    hpContribution,
    survivabilityContribution,
    blockedResourceContribution,
    targetBattleContribution,
    equipmentContribution,
    pathContribution,
    actionKindContribution,
    damagePenalty,
    hpLossPenalty,
    depthPenalty,
    rawTotal,
    roundedTotal: Math.round(rawTotal),
  };
}

function buildEvidenceRecord(record, intent, caseDef) {
  const targetTile = record.resourceTile || record.tile || null;
  const targetFloor = (targetTile && targetTile.floorId) ||
    (intent.goal && intent.goal.floorId) ||
    (record.after && record.after.floorId) ||
    null;
  const delta = cloneJson(record.delta || {});
  const deferred = caseDef.outputKind === "deferred-resource";
  return {
    sourceAction: record.actionSummary,
    sourceActionKind: record.actionKind,
    actionChain: cloneJson(record.actionChain || []),
    sourceTile: cloneJson(record.tile || null),
    targetTile: cloneJson(targetTile),
    targetFloor,
    before: cloneJson(record.before || null),
    after: cloneJson(record.after || null),
    beforeAfterDelta: delta,
    damage: number(record.damage, 0),
    cost: {
      damage: number(record.damage, 0),
      hpCost: Math.max(0, -number(delta.hp, 0)),
      moneyCost: Math.max(0, -number(delta.money, 0)),
      actionCount: Array.isArray(record.actionChain) ? record.actionChain.length : 0,
    },
    failureClass: caseDef.failureClass,
    failureClassRelevance: caseDef.relevance,
    score: {
      scannerScore: number(record.score, 0),
      scoreBreakdown: buildScannerScoreBreakdown(record, intent.desiredStats || [], caseDef.failureClass),
    },
    generatedTemporaryGoal: cloneJson(intent.goal || null),
    actionPolicy: cloneJson(intent.actionPolicy || null),
    frontierEvidence: cloneJson(record.frontierDelta || null),
    targetBattleImpact: cloneJson(record.targetBattleImpact || null),
    blockedResource: cloneJson(record.blockedResource || null),
    deferredResource: {
      isDeferred: deferred,
      immediatePickup: false,
    },
  };
}

function buildCase(caseDef) {
  const { simulator, initialState } = createResourceIntentScenario(caseDef.scenario);
  const candidate = {
    id: `${caseDef.id}#0`,
    state: initialState,
    route: [],
  };
  const intents = scanResourceIntents(
    simulator,
    [candidate],
    caseDef.failure,
    scannerOptions(caseDef),
  );
  const intent = intents.find((entry) => entry.kind === caseDef.scannerKind);
  if (!intent) {
    throw new Error(`${caseDef.id}: expected scanner kind ${caseDef.scannerKind}, got ${intents.map((entry) => entry.kind).join(",")}`);
  }
  const outputKind = canonicalOutputKind(intent.kind);
  if (outputKind !== caseDef.outputKind) {
    throw new Error(`${caseDef.id}: expected output ${caseDef.outputKind}, got ${outputKind}`);
  }
  const directActions = simulator.enumeratePrimitiveActions(initialState).actions || [];
  return {
    id: caseDef.id,
    failureClass: caseDef.failureClass,
    outputKind,
    scannerKind: intent.kind,
    primaryStat: intent.primaryStat || null,
    score: Math.round(number(intent.score, 0)),
    desiredStats: cloneJson(intent.desiredStats || []),
    records: intent.records.map((record) => buildEvidenceRecord(record, intent, caseDef)),
    generatedTemporaryGoal: cloneJson(intent.goal || null),
    actionPolicy: cloneJson(intent.actionPolicy || null),
    controls: {
      expectedRelevance: caseDef.relevance,
      directActionCount: directActions.length,
      directImmediatePickupAvailable: directActions.some((action) => action.kind === "pickup"),
    },
  };
}

function stableOrderingControl() {
  const { simulator } = createResourceIntentScenario("stable-order");
  const lowState = simulator.initialState({ flags: { orderVariant: "low" } });
  const highState = simulator.initialState({ flags: { orderVariant: "high" } });
  const candidates = [
    { id: "candidate-low", state: lowState, route: [] },
    { id: "candidate-high", state: highState, route: [] },
  ];
  const failure = {
    failureClass: "atk-deficit",
    missingGoalFields: [{ field: "effectiveHero.atk", expected: 15, actual: 1 }],
  };
  const run = (inputCandidates) => {
    const intents = scanResourceIntents(simulator, inputCandidates, failure, {
      maxIntentRecords: 24,
      recordsPerIntent: 6,
      maxIntents: 6,
      intentDepth: 1,
      maxIntentNodes: 80,
    });
    const intent = intents.find((entry) => entry.kind === "stat-atk");
    if (!intent) throw new Error("stable-order: expected stat-atk intent");
    return intent.records.map((record) => ({
      candidateId: record.startCandidateId,
      sourceAction: record.actionSummary,
      scannerScore: Math.round(number(record.score, 0)),
    }));
  };
  const forward = run(candidates);
  const reversed = run(candidates.slice().reverse());
  const repeated = run(candidates);
  return {
    failureClass: "atk-deficit",
    forwardInputOrder: candidates.map((candidate) => candidate.id),
    reversedInputOrder: candidates.slice().reverse().map((candidate) => candidate.id),
    observedOrder: forward,
    reversedObservedOrder: reversed,
    repeatedOrder: repeated,
    strictScoreOrderingRepeatable:
      JSON.stringify(forward) === JSON.stringify(reversed) &&
      JSON.stringify(forward) === JSON.stringify(repeated),
    higherCandidate: "candidate-high",
    lowerCandidate: "candidate-low",
  };
}

function emptyIntentControl() {
  const { simulator, initialState } = createResourceIntentScenario("empty");
  const intents = scanResourceIntents(
    simulator,
    [{ id: "empty#0", state: initialState, route: [] }],
    {
      failureClass: "atk-deficit",
      missingGoalFields: [{ field: "effectiveHero.atk", expected: 15, actual: 1 }],
    },
    { maxIntentRecords: 24, maxIntents: 6 },
  );
  return {
    failureClass: "atk-deficit",
    intentCount: intents.length,
    intents: cloneJson(intents),
    returnedEmpty: intents.length === 0,
  };
}

function failureIntentControls(cases) {
  const controls = {};
  cases.forEach((item) => {
    if (!controls[item.failureClass]) {
      controls[item.failureClass] = {
        observedOutputKinds: [],
        sourceCases: [],
      };
    }
    const entry = controls[item.failureClass];
    if (!entry.observedOutputKinds.includes(item.outputKind)) entry.observedOutputKinds.push(item.outputKind);
    entry.sourceCases.push(item.id);
  });
  Object.values(controls).forEach((entry) => {
    entry.observedOutputKinds.sort();
    entry.sourceCases.sort();
  });
  return controls;
}

function buildReport() {
  const cases = CASES.map(buildCase);
  const stableOrdering = stableOrderingControl();
  const emptyIntent = emptyIntentControl();
  const deferredCase = cases.find((item) => item.outputKind === "deferred-resource");
  const pathCase = cases.find((item) => item.outputKind === "path-blocker");
  const deferredRecord = deferredCase && deferredCase.records[0];
  const pathRecord = pathCase && pathCase.records[0];
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "shadow-only",
      scanner: "shared-solver/lib/resource-intent-scanner.js",
      syntheticSimulator: "shared-solver/resource-intent-contract-synthetic-simulator.js",
      generationCommit: generationCommit(),
      productionPlannerChanged: false,
      productionDefaultPolicyChanged: false,
    },
    contract: {
      id: "PR-4.7a1",
      title: "Scanner Score Attribution",
      fixedOutputKinds: OUTPUT_KINDS.slice(),
      requiredEvidenceFields: [
        "sourceAction",
        "actionChain",
        "targetTile",
        "targetFloor",
        "before",
        "after",
        "beforeAfterDelta",
        "damage",
        "cost",
        "failureClassRelevance",
        "score.scoreBreakdown",
        "generatedTemporaryGoal",
        "actionPolicy",
      ],
      expectedFailureControls: {
        "atk-deficit": ["stat-gain", "equipment", "levelup"],
        "hp-deficit": ["stat-gain", "levelup", "deferred-resource"],
        "target-action-unreachable": ["path-blocker"],
      },
      deterministicFullReportRebuild: true,
    },
    controls: {
      fixedOutputKindsObserved: OUTPUT_KINDS.every((kind) => cases.some((item) => item.outputKind === kind)),
      failureIntentControls: failureIntentControls(cases),
      strictScoreOrderingRepeatable: stableOrdering,
      equalScoreTieDeterminism: {
        status: "not-established",
        reason: "scanner sorts equal scores without an explicit secondary key",
      },
      emptyIntentReturnsEmpty: emptyIntent,
      deferredResourceNotImmediatePickup: {
        outputKind: deferredCase && deferredCase.outputKind,
        directImmediatePickupAvailable: deferredCase && deferredCase.controls.directImmediatePickupAvailable,
        sourceActionKind: deferredRecord && deferredRecord.sourceActionKind,
        actionChain: deferredRecord && deferredRecord.actionChain,
        isDeferred: deferredRecord && deferredRecord.deferredResource.isDeferred,
      },
      pathBlockerRequiresObservedFrontierAction: {
        sourceAction: pathRecord && pathRecord.sourceAction,
        targetTile: pathRecord && pathRecord.targetTile,
        newActionCount: pathRecord && pathRecord.frontierEvidence && pathRecord.frontierEvidence.newActionCount,
        sampleNewActions: pathRecord && pathRecord.frontierEvidence && pathRecord.frontierEvidence.sampleNewActions,
      },
      deterministicLiveRebuild: true,
    },
    cases,
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

function markdownReport(report) {
  const lines = [
    "# PR-4.7a1 Scanner Score Attribution",
    "",
    `Schema: \`${report.schema}\``,
    "Status: completed",
    "Mode: shadow-only",
    "",
    "## Fixed scanner outputs",
    "",
    `fixed outputs: ${report.contract.fixedOutputKinds.join(", ")}`,
    "",
    "Every generated record carries the source action and chain, target tile/floor, before/after delta, damage/cost, failure-class relevance, an exact scanner score breakdown, generated temporary goal, and action policy.",
    "",
    "## Observed controls",
    "",
    "| Case | Failure | Output | Scanner kind | Top source action |",
    "| --- | --- | --- | --- | --- |",
  ];
  report.cases.forEach((item) => {
    lines.push(`| ${item.id} | ${item.failureClass} | ${item.outputKind} | ${item.scannerKind} | ${(item.records[0] && item.records[0].sourceAction) || "none"} |`);
  });
  lines.push(
    "",
    "## Contract gates",
    "",
    `- atk-deficit controls: ${report.contract.expectedFailureControls["atk-deficit"].join(" / ")}`,
    `- hp-deficit controls: ${report.contract.expectedFailureControls["hp-deficit"].join(" / ")}`,
    `- target-action-unreachable control: ${report.contract.expectedFailureControls["target-action-unreachable"].join(" / ")}`,
    `- strict unequal-score ordering with reversed input: ${report.controls.strictScoreOrderingRepeatable.strictScoreOrderingRepeatable ? "passed" : "failed"}`,
    `- equal-score tie determinism: ${report.controls.equalScoreTieDeterminism.status}`,
    `- no available intent returns empty: ${report.controls.emptyIntentReturnsEmpty.returnedEmpty ? "passed" : "failed"}`,
    `- deferred resource direct pickup: ${report.controls.deferredResourceNotImmediatePickup.directImmediatePickupAvailable ? "available" : "not available"}`,
    `- path blocker observed new action count: ${report.controls.pathBlockerRequiresObservedFrontierAction.newActionCount}`,
    "- deterministic full-report rebuild: required",
    "",
    "The deferred-resource case records a blocker battle followed by a hypothetical pickup chain; it is not labeled as an immediate pickup. The path-blocker case is accepted only because the door preview exposes a new action, not because the tile is merely typed as a door.",
    "",
    "## Scope boundary",
    "",
    "This contract does not claim a complete OnlyUp route, safe mapping for every real corpus failure, blocker/openDoor repair in the production planner, or any production default policy change.",
  );
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const options = parseArgs(argv);
  const out = options.out ? path.resolve(__dirname, options.out) : DEFAULT_OUT;
  const outMd = options["out-md"] ? path.resolve(__dirname, options["out-md"]) : DEFAULT_OUT_MD;
  const report = buildReport();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outMd, markdownReport(report));
  process.stdout.write(`resource intent evidence contract wrote ${out} (${report.cases.length} cases)\n`);
  return report;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  CASES,
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  OUTPUT_KINDS,
  buildReport,
  markdownReport,
  main,
};
