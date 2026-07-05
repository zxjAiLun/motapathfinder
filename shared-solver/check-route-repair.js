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
const {
  buildCheaperCheck,
  tryRepairRoute,
  tryRepairRouteRecursive,
  replayPreState,
  replaceStepSummary,
} = require("./lib/route-repair-runner");
const { applyPatchAndReplay, consumeFutureMatches, decisionSatisfied, runIterativeRouteRepair } = require("./lib/iterative-route-repair");

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
    if (attempt.status === "repaired") {
      assert.ok(attempt.patch && attempt.patch.actions.length > 0, "repaired attempt should expose an action patch");
    }
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

function buildAuditContext() {
  const timeline = makeTimeline();
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const route = readRouteFile(ROUTE_FILE);
  const audit = auditRouteForExpensivePicks(simulator, project, timeline, {
    minDamageDelta: 500,
    minSavingsRatio: 0.2,
    maxIntents: 1,
  });
  return { timeline, project, simulator, route, audit };
}

function checkBattleActionDefinesReachability() {
  const { timeline, project, simulator, route, audit } = buildAuditContext();
  const finding = (audit.findings || []).find((entry) => entry.cheaper && entry.cheaper[0]);
  assert.ok(finding, "fixture should expose a cheaper battle finding");
  const state = replayPreState(project, simulator, route, finding.stepIndex);
  const summary = finding.cheaper[0].summary;
  const check = buildCheaperCheck(simulator, state, summary);
  assert.ok(check.action, "cheaper battle should be present in primitive actions");
  assert.equal(check.reachable, true, "matching battle action should define reachability");
  const walk = simulator.getWalkReachability(state);
  const parsed = check.parsed;
  assert.equal(Boolean(walk.visited && walk.visited[`${parsed.x},${parsed.y}`]), false, "enemy tile itself should not be walk visited");
  return { stepIndex: finding.stepIndex, summary };
}

function checkSequentialPatchReplay() {
  const { timeline, project, simulator, route, audit } = buildAuditContext();
  const finding = (audit.findings || []).find((entry) => entry.stepIndex === 20)
    || (audit.findings || [])[0];
  assert.ok(finding, "fixture should expose a repair candidate");
  const attempt = tryRepairRouteRecursive(simulator, project, route, timeline, {
    stepIndex: finding.stepIndex,
    cheaper: finding.cheaper,
  }, { maxDepth: 2, maxExpansions: 600, maxRuntimeMs: 1500 });
  assert.equal(attempt.status, "repaired", "candidate should be locally repairable");
  const replay = applyPatchAndReplay(project, simulator, route, attempt.patch, { projectRoot: PROJECT_ROOT });
  assert.equal(replay.ok, true, "reordered patch should fully replay");
  const decision = replay.route.decisions[finding.stepIndex - 1];
  assert.equal(decision.summary, attempt.patch.cheaperSummary, "rebuilt route should contain the cheaper action");
  assert.ok(decision.fingerprint, "rebuilt decision should include fingerprint");
  assert.ok(Array.isArray(decision.path), "rebuilt decision should include path");
  assert.ok(decision.target && decision.target.x != null, "rebuilt decision should include target");
  assert.ok(decision.enemyId, "rebuilt battle decision should include enemyId");
  const summaries = replay.route.decisions.map((entry) => entry.summary);
  assert.equal(summaries.filter((summary) => summary === attempt.patch.cheaperSummary).length, 1, "reorder should not duplicate the cheaper battle");
  assert.ok(summaries.includes(attempt.patch.originalSummary), "reorder should preserve the original picked battle later");
  return { stepIndex: finding.stepIndex, displaced: replay.displacedStepIndices };
}

function checkSequentialAcceptancePolicy() {
  const { project, simulator, route } = buildAuditContext();
  const before = JSON.stringify(route);
  const result = runIterativeRouteRepair(project, simulator, route, {
    projectRoot: PROJECT_ROOT,
    maxRepairs: 1,
    maxDepth: 2,
    maxExpansions: 600,
    maxRuntimeMs: 1500,
    minDamageDelta: 500,
    minSavingsRatio: 0.2,
    suffixBridge: false,
  });
  assert.equal(result.finalRouteVerified, true, "baseline/final route should be replay verified");
  assert.equal(result.acceptedCount, 0, "fixture candidates should not be accepted without final HP improvement");
  assert.equal(JSON.stringify(route), before, "rejected attempts must not mutate the source route");
  const reasons = result.iterations.flatMap((iteration) => iteration.candidateAttempts.map((attempt) => attempt.rejectedReason));
  assert.ok(reasons.includes("final-hp-not-improved"), "full replay without HP improvement should be rejected");
  return { acceptedCount: result.acceptedCount, stoppedReason: result.stoppedReason };
}

function checkSatisfiedDecisionAndBridgeLimit() {
  const removedState = {
    floorStates: { MT1: { removed: { "2,5": true }, replaced: {} } },
    hero: { equipment: ["I893"] },
  };
  assert.equal(decisionSatisfied(removedState, {
    kind: "battle",
    summary: "battle:skeletonCaptain@MT1:2,5",
    floorId: "MT1",
    target: { floorId: "MT1", x: 2, y: 5 },
  }).satisfied, true, "removed battle target should satisfy the suffix decision");
  assert.equal(decisionSatisfied(removedState, {
    kind: "equip",
    summary: "equip:I893",
    equipId: "I893",
  }).satisfied, true, "already-equipped item should satisfy the suffix decision");
  const consumed = new Set();
  const consumedSteps = consumeFutureMatches([
    { kind: "battle", summary: "battle:a@MT1:1,1" },
    { kind: "battle", summary: "battle:b@MT1:2,1" },
  ], 0, [{ kind: "battle", summary: "battle:b@MT1:2,1" }], consumed);
  assert.deepEqual(consumedSteps, [2], "bridge action should consume the first matching suffix decision");
  assert.equal(consumed.has(1), true);

  const { timeline, project, simulator, route, audit } = buildAuditContext();
  const finding = (audit.findings || []).find((entry) => entry.stepIndex === 11);
  const attempt = tryRepairRouteRecursive(simulator, project, route, timeline, {
    stepIndex: finding.stepIndex,
    cheaper: finding.cheaper,
  }, { maxDepth: 2, maxExpansions: 600, maxRuntimeMs: 1500 });
  const before = JSON.stringify(route);
  const replay = applyPatchAndReplay(project, simulator, route, attempt.patch, {
    projectRoot: PROJECT_ROOT,
    suffixBridge: true,
    maxSuffixBridges: 0,
  });
  assert.equal(replay.ok, false, "bridge limit fixture should remain rejected");
  assert.equal(replay.failure.reason, "suffix-bridge-limit");
  assert.equal(replay.firstReplayFailure.reason, "action-unavailable");
  assert.equal(replay.suffixBridges.length, 0);
  assert.equal(JSON.stringify(route), before, "bridge failure must not mutate the source route");
  return { failureStep: replay.failure.stepIndex, reason: replay.failure.reason };
}

function main() {
  const blockers = checkFindBlockerCandidates();
  const plan = checkPlanBlockerRepairsEmitsMilestones();
  const replace = checkReplaceStepSummary();
  const classify = checkTryRepairRouteClassification();
  const battleReachability = checkBattleActionDefinesReachability();
  const sequentialPatch = checkSequentialPatchReplay();
  const sequentialPolicy = checkSequentialAcceptancePolicy();
  const suffixBridge = checkSatisfiedDecisionAndBridgeLimit();
  console.log(JSON.stringify({ blockers, plan, replace, classify, battleReachability, sequentialPatch, sequentialPolicy, suffixBridge }, null, 2));
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
