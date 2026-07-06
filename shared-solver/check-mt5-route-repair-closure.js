"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { applyPatchAndReplay, replayRouteRecord } = require("./lib/iterative-route-repair");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { buildRouteTimeline } = require("./lib/route-debugger");
const { auditRouteForExpensivePicks } = require("./lib/route-audit");
const { tryRepairRouteRecursive } = require("./lib/route-repair-runner");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_FILE = path.resolve(__dirname, "routes", "latest", "mt5-problem-before-9-10.route.json");

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  const route = readRouteFile(ROUTE_FILE);
  const baseline = replayRouteRecord(project, simulator, route, { projectRoot: PROJECT_ROOT });
  assert.equal(baseline.ok, true, "mt5 baseline must fully replay");
  const timeline = buildRouteTimeline(project, simulator, route, {
    actionInspector: "visible",
    actionInspectorMode: "pre",
    candidateLimit: 200,
    stopOnError: true,
  });
  const audit = auditRouteForExpensivePicks(simulator, project, timeline, {
    minDamageDelta: 1000,
    minSavingsRatio: 0.15,
    maxIntents: 4,
  });
  const finding = audit.findings.find((entry) => entry.stepIndex === 67);
  assert.ok(finding, "mt5 audit should expose step 67");
  const attempt = tryRepairRouteRecursive(simulator, project, route, timeline, {
    stepIndex: 67,
    cheaper: finding.cheaper,
  }, { maxDepth: 3, maxExpansions: 800, maxRuntimeMs: 1500 });
  const candidate = applyPatchAndReplay(project, simulator, route, attempt.patch, {
    projectRoot: PROJECT_ROOT,
    suffixBridge: true,
    maxSuffixBridges: 3,
    suffixMaxExpansions: 2000,
    suffixMaxRuntimeMs: 3000,
  });
  assert.ok(
    candidate.suffixBridges && candidate.suffixBridges.length > 0,
    `step 67 should attempt a suffix bridge: ${JSON.stringify(candidate.failure || null)}`,
  );
  assert.equal(candidate.suffixBridges[0].failureStepIndex, 71, "step 67 should reconnect at the original step 71 failure");
  assert.ok(candidate.suffixBridges[0].candidates.length >= 2, "step 67 should preserve multiple bridge skyline candidates");
  assert.ok(candidate.suffixBridges[0].candidates.length <= 4, "bridge skyline should respect the balanced limit");
  assert.ok(candidate.suffixBridges[0].candidates.filter((entry) => entry.shortlisted).length <= 2, "only two bridge candidates may receive full replay");
  assert.ok(candidate.suffixBridges[0].searchNodesUsed <= 16, "bridge search should respect the global node limit");
  if (candidate.ok) {
    const replay = replayRouteRecord(project, simulator, candidate.route, { projectRoot: PROJECT_ROOT });
    assert.equal(replay.ok, true, "successful mt5 candidate must replay independently");
  }
  console.log(JSON.stringify({
    baselineFinalHp: Number((baseline.finalState.hero || {}).hp || 0),
    candidateOk: candidate.ok,
    candidateFinalHp: candidate.ok ? Number((candidate.finalState.hero || {}).hp || 0) : null,
    suffixBridges: candidate.suffixBridges.map((bridge) => ({
      stepIndex: bridge.failureStepIndex,
      status: bridge.status,
      actionCount: bridge.actions.length,
      expansions: bridge.expansions,
      stoppedReason: bridge.stoppedReason,
      candidateCount: bridge.candidates.length,
      selectedCandidateId: bridge.selectedCandidateId,
    })),
    failure: candidate.failure || null,
  }, null, 2));
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
