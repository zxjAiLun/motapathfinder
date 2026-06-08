"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildRouteTimeline } = require("./lib/route-debugger");
const {
  identifyExpensiveSteps,
  auditRouteForExpensivePicks,
  verifyRepairMilestones,
} = require("./lib/route-audit");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_FILE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json");

function makeSimulator(project) {
  return new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
}

function checkIdentifyExpensiveSteps() {
  const route = readRouteFile(ROUTE_FILE);
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const timeline = buildRouteTimeline(project, simulator, route, {
    snapshotFloorIds: ["MT1", "MT2"],
    actionInspector: "visible",
    actionInspectorMode: "pre",
    candidateLimit: 200,
  });
  const findings = identifyExpensiveSteps(timeline, {
    minDamageDelta: 500,
    minSavingsRatio: 0.2,
  });
  assert.ok(findings.length > 0, "timeline should yield at least one expensive step");
  const first = findings[0];
  assert.ok(first.picked && first.cheaper && first.cheaper.length > 0, "finding should include cheaper candidates");
  assert.ok(first.bestSaving > 0, "saving should be positive");
  assert.ok(
    first.cheaper[0].damage < first.picked.damage,
    "cheaper candidate must have lower damage than the picked action",
  );
  return { findingCount: findings.length, firstStep: first.stepIndex };
}

function checkAuditEmitsMilestones() {
  const route = readRouteFile(ROUTE_FILE);
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const timeline = buildRouteTimeline(project, simulator, route, {
    snapshotFloorIds: ["MT1", "MT2"],
    actionInspector: "visible",
    actionInspectorMode: "pre",
    candidateLimit: 200,
  });
  const result = auditRouteForExpensivePicks(simulator, project, timeline, {
    minDamageDelta: 500,
    minSavingsRatio: 0.2,
    maxIntents: 2,
  });
  assert.ok(result.intents.length > 0, "audit should generate at least one intent");
  assert.equal(
    result.intents.length,
    result.milestones.length,
    "every intent should map to a milestone",
  );
  for (const milestone of result.milestones) {
    assert.ok(milestone.goal && milestone.goal.floorId, "milestone must include floorId");
    assert.ok(
      milestone._meta && milestone._meta.source === "route-audit",
      "milestone meta should mark source=route-audit",
    );
    assert.ok(
      milestone._meta.finding && milestone._meta.finding.cheaper,
      "milestone meta should record the cheaper alternative",
    );
  }
  return {
    findingCount: result.findings.length,
    intentCount: result.intents.length,
    milestoneCount: result.milestones.length,
  };
}

function checkIdentifyExpensiveStepsSynthetic() {
  const timeline = {
    steps: [
      { index: 0, summary: "start", hero: { hp: 1, atk: 0 }, floorId: "MT1" },
      {
        index: 1,
        summary: "battle:boss@MT1:1,1",
        floorId: "MT1",
        hero: { hp: 100, atk: 10 },
        preInspector: {
          plannedNextSummary: "battle:boss@MT1:1,1",
          plannedFoundInCandidates: true,
          totalActions: 2,
          shownActions: 2,
          categories: { battle: 2 },
          candidates: [
            {
              index: 0,
              kind: "battle",
              category: "battle",
              summary: "battle:boss@MT1:1,1",
              fingerprint: "battle|MT1|1,1|boss",
              damage: 5000,
              lethal: false,
              supported: true,
              plannedNext: true,
            },
            {
              index: 1,
              kind: "battle",
              category: "battle",
              summary: "battle:trash@MT1:1,2",
              fingerprint: "battle|MT1|1,2|trash",
              damage: 50,
              lethal: false,
              supported: true,
              plannedNext: false,
            },
          ],
        },
      },
    ],
  };
  const findings = identifyExpensiveSteps(timeline, {
    minDamageDelta: 100,
    minSavingsRatio: 0.5,
  });
  assert.equal(findings.length, 1, "should flag the boss pick vs trash");
  assert.equal(findings[0].picked.summary, "battle:boss@MT1:1,1");
  assert.equal(findings[0].cheaper[0].summary, "battle:trash@MT1:1,2");
  return { findingCount: findings.length };
}

function checkVerifyRepairClassification() {
  const route = readRouteFile(ROUTE_FILE);
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const timeline = buildRouteTimeline(project, simulator, route, {
    snapshotFloorIds: ["MT1", "MT2"],
    actionInspector: "visible",
    actionInspectorMode: "pre",
    candidateLimit: 200,
  });
  const audit = auditRouteForExpensivePicks(simulator, project, timeline, {
    minDamageDelta: 500,
    minSavingsRatio: 0.2,
    maxIntents: 2,
  });
  const verification = verifyRepairMilestones(simulator, project, timeline, audit.milestones, {
    maxExpansions: 2000,
    maxRuntimeMs: 4000,
  });
  assert.ok(verification.results.length > 0, "verify should produce one result per milestone");
  for (const result of verification.results) {
    assert.ok(
      ["no-repair-needed", "repair-routes-found", "cheaper-unreachable", "cheaper-not-survivable", "no-repair-route"].includes(result.reason),
      `unexpected reason: ${result.reason}`,
    );
    assert.ok(
      typeof result.startSurvivable === "boolean",
      "result must include startSurvivable",
    );
    assert.ok(
      typeof result.startReachable === "boolean",
      "result must include startReachable",
    );
    assert.equal(result.improved, Boolean(result.found && result.startReachable));
  }
  const reasons = verification.results.reduce((acc, r) => {
    acc[r.reason] = (acc[r.reason] || 0) + 1;
    return acc;
  }, {});
  return {
    verifiedCount: verification.results.length,
    reasons,
  };
}

function main() {
  const identify = checkIdentifyExpensiveSteps();
  const identifySynthetic = checkIdentifyExpensiveStepsSynthetic();
  const audit = checkAuditEmitsMilestones();
  const verify = checkVerifyRepairClassification();
  console.log(JSON.stringify({ identify, identifySynthetic, audit, verify }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main };
