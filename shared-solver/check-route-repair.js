"use strict";

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildRouteTimeline } = require("./lib/route-debugger");
const { auditRouteForExpensivePicks } = require("./lib/route-audit");
const { planBlockerRepairs, findBlockerCandidates } = require("./lib/route-audit-repair");
const { tryRepairRoute, replayPreState, replaceStepSummary } = require("./lib/route-repair-runner");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_FILE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json");

function makeSimulator(project) {
  return new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
}

function makeTimeline() {
  const route = readRouteFile(ROUTE_FILE);
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  return buildRouteTimeline(project, simulator, route, {
    snapshotFloorIds: ["MT1", "MT2"],
    actionInspector: "visible",
    actionInspectorMode: "pre",
    candidateLimit: 200,
  });
}

function checkFindBlockerCandidates() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const route = readRouteFile(ROUTE_FILE);
  const preState = replayPreState(project, simulator, route, 11);
  if (!preState) throw new Error("replayPreState should produce a state for step 11");
  const targetBattle = {
    floorId: "MT1",
    x: 8,
    y: 1,
    enemyId: "skeleton",
  };
  const blockers = findBlockerCandidates(simulator, preState, targetBattle, { blockerRadius: 4 });
  assert.ok(Array.isArray(blockers), "blocker list should be an array");
  // Not every pre-state has a cheaper alternative blocked by an enemy/door.
  // At minimum the helper should respect radius and project floor bounds.
  for (const blocker of blockers) {
    assert.ok(blocker.floorId === "MT1", "blockers should stay on the picked floor");
    assert.ok(blocker.x >= 0 && blocker.y >= 0, "blocker coordinates must be valid");
  }
  return { blockerCount: blockers.length };
}

function checkPlanBlockerRepairsEmitsMilestones() {
  const timeline = makeTimeline();
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const audit = auditRouteForExpensivePicks(simulator, project, timeline, {
    minDamageDelta: 500,
    minSavingsRatio: 0.2,
    maxIntents: 1,
  });
  // Build a verification-shaped list: each finding is treated as a
  // 'cheaper-unreachable' (the repair is the natural follow-up) so we
  // can exercise planBlockerRepairs without a separate verify pass.
  const verifyLike = {
    results: (audit.findings || []).map((finding) => ({
      stepIndex: finding.stepIndex,
      reason: "cheaper-unreachable",
      pickedSummary: finding.picked && finding.picked.summary,
    })),
    findings: audit.findings,
  };
  const repairs = planBlockerRepairs(simulator, project, timeline, verifyLike, { maxIntents: 1 });
  for (const repair of repairs) {
    assert.ok(repair.milestone && repair.milestone.id, "repair should expose a milestone");
    assert.ok(
      repair.milestone._meta && repair.milestone._meta.generatedBy === "route-audit-blocker-repair",
      "milestone meta should mark generatedBy=route-audit-blocker-repair",
    );
    assert.ok(repair.blocker && repair.blocker.floorId, "blocker should include floorId");
  }
  return {
    repairCount: repairs.length,
    byBlockerKind: repairs.reduce((acc, r) => {
      acc[r.blocker.kind] = (acc[r.blocker.kind] || 0) + 1;
      return acc;
    }, {}),
  };
}

function checkReplaceStepSummary() {
  const route = readRouteFile(ROUTE_FILE);
  const summary = (route.decisions[2] && route.decisions[2].summary) || "";
  const updated = replaceStepSummary(route, 3, "battle:synthetic@MT1:9,9");
  assert.equal(updated.decisions[2].summary, "battle:synthetic@MT1:9,9");
  assert.notEqual(updated.decisions[2].summary, summary, "summary must change");
  assert.equal(route.decisions[2].summary, summary, "original route must remain untouched");
  return { newSummary: updated.decisions[2].summary };
}

function checkTryRepairRouteClassification() {
  const timeline = makeTimeline();
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const route = readRouteFile(ROUTE_FILE);
  const audit = auditRouteForExpensivePicks(simulator, project, timeline, {
    minDamageDelta: 500,
    minSavingsRatio: 0.2,
    maxIntents: 1,
  });
  const verifyLike = {
    results: (audit.findings || []).map((finding) => ({
      stepIndex: finding.stepIndex,
      reason: "cheaper-unreachable",
      pickedSummary: finding.picked && finding.picked.summary,
    })),
    findings: audit.findings,
  };
  const repairs = planBlockerRepairs(simulator, project, timeline, verifyLike, { maxIntents: 1 });
  const perStep = new Map();
  for (const repair of repairs) {
    const list = perStep.get(repair.stepIndex) || [];
    list.push(repair);
    perStep.set(repair.stepIndex, list);
  }
  const entries = [];
  for (const [stepIndex, list] of perStep) {
    const finding = (audit.findings || []).find((f) => f.stepIndex === stepIndex);
    const cheaper = finding && finding.cheaper ? finding.cheaper : null;
    entries.push({
      stepIndex,
      milestones: list.slice(0, 1).map((entry) => entry.milestone),
      cheaper,
    });
  }
  const result = tryRepairRoute(simulator, project, route, timeline, entries, {
    maxExpansions: 600,
    maxRuntimeMs: 1500,
    maxDepth: 2,
  });
  assert.ok(result.results.length > 0, "tryRepairRoute should return at least one attempt");
  const allowed = new Set([
    "repaired",
    "still-unreachable",
    "no-repair-route",
    "no-cheaper-record",
    "applied-failed",
    "replay-failed",
  ]);
  for (const attempt of result.results) {
    assert.ok(allowed.has(attempt.status), `unexpected status: ${attempt.status}`);
    assert.ok(Array.isArray(attempt.rounds), "recursive attempts should expose rounds");
    for (const round of attempt.rounds) {
      assert.ok(typeof round.roundIndex === "number", "round should expose roundIndex");
      assert.ok(typeof round.reachable === "boolean", "round should expose reachable");
      assert.ok(typeof round.finalHp === "number", "round should expose finalHp");
    }
  }
  return {
    attemptCount: result.results.length,
    statusCounts: result.results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
    totalRounds: result.results.reduce((sum, r) => sum + (r.rounds ? r.rounds.length : 0), 0),
  };
}

function main() {
  const blockers = checkFindBlockerCandidates();
  const plan = checkPlanBlockerRepairsEmitsMilestones();
  const replace = checkReplaceStepSummary();
  const classify = checkTryRepairRouteClassification();
  console.log(JSON.stringify({ blockers, plan, replace, classify }, null, 2));
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
