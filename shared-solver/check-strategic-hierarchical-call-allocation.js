"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { HierarchyPriorityController } = require("./lib/strategic-hierarchy-priority");
const { LazyWorkQueue } = require("./lib/strategic-lazy-work");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Synthetic active hierarchy priority -----------------------------------
  // maxCalls = 4
  // call 1: root S0 fail        -> no hierarchy priority
  // call 2: root S1 satisfied   -> activate continuation C1
  // root S2 must be deferred while C1 active
  // strategic progression reaches parent floor -> child P2 gets call 3
  // child feedback -> release
  // call 4 may go back to sibling S2 or next hierarchy step.
  const controller = new HierarchyPriorityController();
  assert.strictEqual(controller.isActive(), false);
  assert.strictEqual(controller.activate("C1"), true);
  assert.strictEqual(controller.activate("C1"), false);
  assert.strictEqual(controller.isActive(), true);
  assert.strictEqual(controller.activeContinuationIds().join(","), "C1");

  const lazyWork = new LazyWorkQueue();
  const deferredSibling = { kind: "battle-access-prerequisite-choice", sourceNodeId: 1, prerequisite: { id: "S2" } };
  if (controller.isActive()) {
    // Paused sibling attempt is not enqueued; this is the scheduler decision.
  } else {
    lazyWork.enqueue(deferredSibling);
  }
  assert.strictEqual(lazyWork.activeSize(), 0);

  const childCall = lazyWork.enqueue({
    kind: "battle-access-prerequisite-choice",
    sourceNodeId: 2,
    prerequisite: { id: "P2" },
    hierarchyLevel: 1,
    originContinuationId: "C1",
  });
  assert.strictEqual(childCall.status, "queued");
  assert.strictEqual(controller.isActive(), true);
  assert.strictEqual(controller.releaseForCall("C1"), true);
  assert.strictEqual(controller.isActive(), false);
  lazyWork.enqueue(deferredSibling);
  assert.strictEqual(lazyWork.queued().filter((work) => work.prerequisite.id === "S2").length, 1);
  lazyWork.resolve(childCall, "synthetic-child-feedback");
  lazyWork.resolve(lazyWork.queued().find((work) => work.prerequisite.id === "S2"), "synthetic-sibling");

  // --- Focused on/off control -------------------------------------------------
  const focusedOptions = {
    project,
    projectRoot: PROJECT_ROOT,
    initialState,
    terminalGoal,
    simulatorFactory: () => makeBlindSimulator(project),
    connectorMode: "battle-access-prerequisite",
    enableConnector: true,
    maxExpansions: 64,
    connectorMaxExpansions: 20,
    connectorMaxCalls: 4,
    lazyDrainEvery: 8,
    maxTotalSearchExpansions: 200,
    enableParentDependencyContinuation: true,
  };
  const focusedOff = runStrategicD2Search({
    ...focusedOptions,
    enableHierarchicalCallAllocation: false,
  });
  const focusedOn = runStrategicD2Search({
    ...focusedOptions,
    enableHierarchicalCallAllocation: true,
  });
  assert.strictEqual(focusedOff.stats.totalSearchExpansions, focusedOn.stats.totalSearchExpansions);
  assert.strictEqual(focusedOff.stats.expansions, focusedOn.stats.expansions);
  assert.strictEqual(focusedOff.stats.battleAccessPrerequisiteExpansions,
    focusedOn.stats.battleAccessPrerequisiteExpansions);
  assert.strictEqual(focusedOff.stats.battleAccessPrerequisiteCalls,
    focusedOn.stats.battleAccessPrerequisiteCalls);
  assert.strictEqual(focusedOn.stats.battleAccessPrerequisiteSatisfied, 0);

  let qualificationAllocation = null;
  if (includeQualification1000) {
    const baseline = runStrategicD2Search({
      project,
      projectRoot: PROJECT_ROOT,
      initialState,
      terminalGoal,
      simulatorFactory: () => makeBlindSimulator(project),
      maxExpansions: 1000,
      enableConnector: false,
      maxTotalSearchExpansions: 1000,
    });
    const candidate = runStrategicD2Search({
      project,
      projectRoot: PROJECT_ROOT,
      initialState,
      terminalGoal,
      simulatorFactory: () => makeBlindSimulator(project),
      connectorMode: "battle-access-prerequisite",
      enableConnector: true,
      maxExpansions: 1000,
      connectorMaxExpansions: 50,
      connectorMaxCalls: 8,
      lazyDrainEvery: 8,
      maxTotalSearchExpansions: 1000,
      enableParentDependencyContinuation: true,
      enableHierarchicalCallAllocation: true,
    });

    assert.strictEqual(baseline.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(candidate.stats.rootLevelCalls, 7);
    assert.strictEqual(candidate.stats.continuationDerivedCalls, 1);
    assert.strictEqual(candidate.stats.childPrerequisitesCompiled, 1);
    assert.strictEqual(candidate.stats.childPrerequisitesScheduled, 1);
    assert.strictEqual(candidate.stats.childPrerequisitesExecuted, 1);
    assert.strictEqual(candidate.stats.childPrerequisitesSatisfied, 0);
    assert.strictEqual(candidate.stats.maxHierarchyDepthAttempted, 1);
    assert.strictEqual(candidate.stats.hierarchyPriorityActivations, 1);
    assert.ok(candidate.stats.rootAttemptsDeferredForHierarchy > 0);
    assert.strictEqual(candidate.bestTerminalBlocker.attackMargin, -903);
    assert.strictEqual(candidate.stats.terminalActionGenerated, 0);
    assert.strictEqual(candidate.outcome.goalFound, false);

    const childWitnesses = candidate.stats.battleAccessPrerequisiteWitnesses
      .filter((witness) => witness.hierarchyLevel === 1);
    assert.strictEqual(childWitnesses.length, 1);
    const child = childWitnesses[0];
    assert.strictEqual(child.prerequisiteId, "cb70ef61ad4b231a");
    assert.strictEqual(child.status, "not-satisfied");
    assert.ok(child.originContinuationId);
    assert.strictEqual(typeof child.sourceExactStateFingerprint, "string");
    assert.strictEqual(child.sourceExactStateFingerprint.length, 16);

    qualificationAllocation = {
      baseline: {
        totalSearchExpansions: baseline.stats.totalSearchExpansions,
        strategicExpansions: baseline.stats.expansions,
        bestAttackMargin: baseline.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: baseline.stats.terminalActionGenerated,
      },
      candidate: {
        totalSearchExpansions: candidate.stats.totalSearchExpansions,
        strategicExpansions: candidate.stats.expansions,
        battleAccessPrerequisiteExpansions: candidate.stats.battleAccessPrerequisiteExpansions,
        compiled: candidate.stats.battleAccessPrerequisiteCompiled,
        calls: candidate.stats.battleAccessPrerequisiteCalls,
        rootLevelCalls: candidate.stats.rootLevelCalls,
        continuationDerivedCalls: candidate.stats.continuationDerivedCalls,
        hierarchyPriorityActivations: candidate.stats.hierarchyPriorityActivations,
        rootAttemptsDeferredForHierarchy: candidate.stats.rootAttemptsDeferredForHierarchy,
        childPrerequisitesCompiled: candidate.stats.childPrerequisitesCompiled,
        childPrerequisitesScheduled: candidate.stats.childPrerequisitesScheduled,
        childPrerequisitesExecuted: candidate.stats.childPrerequisitesExecuted,
        childPrerequisitesSatisfied: candidate.stats.childPrerequisitesSatisfied,
        maxHierarchyDepthAttempted: candidate.stats.maxHierarchyDepthAttempted,
        parentContinuationsCreated: candidate.stats.parentDependencyContinuationsCreated,
        parentContinuationResumes: candidate.stats.parentDependencyContinuationResumes,
        childWitnesses,
        bestAttackMargin: candidate.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: candidate.stats.terminalActionGenerated,
        goalFound: candidate.outcome.goalFound,
        stoppedReason: candidate.outcome.stoppedReason,
      },
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticHierarchyPriority: {
      activated: true,
      duplicateActivationIgnored: true,
      activeWhilePendingChild: true,
      siblingDeferredWhileActive: true,
      releasedAfterChildFeedback: true,
      siblingResumedAfterRelease: true,
    },
    focusedNoSemanticChange: {
      offTotal: focusedOff.stats.totalSearchExpansions,
      onTotal: focusedOn.stats.totalSearchExpansions,
      offCalls: focusedOff.stats.battleAccessPrerequisiteCalls,
      onCalls: focusedOn.stats.battleAccessPrerequisiteCalls,
    },
    qualificationAllocation,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
