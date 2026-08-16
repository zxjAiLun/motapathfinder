"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { runStrategicD2Search } = require("./lib/strategic-d2-search");
const {
  dependencyTargetFloorId,
  isNodeDescendantOf,
  parentContinuationId,
  parentContinuationKey,
} = require("./lib/strategic-parent-continuation");
const { LazyWorkQueue } = require("./lib/strategic-lazy-work");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const includeQualification1000 = process.argv.includes("--qualification-1000");
  const project = loadProject(PROJECT_ROOT);
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;

  // --- Pure identity contract: parentDependencyId + exactStateKey -----------
  const stateA = "exact-state-A";
  const stateB = "exact-state-B";
  assert.strictEqual(parentContinuationKey("parent-1", stateA), "parent-1@exact-state-A");
  assert.strictEqual(parentContinuationKey("parent-1", stateA), parentContinuationKey("parent-1", stateA));
  assert.notStrictEqual(parentContinuationKey("parent-1", stateA), parentContinuationKey("parent-2", stateA));
  assert.notStrictEqual(parentContinuationKey("parent-1", stateA), parentContinuationKey("parent-1", stateB));
  assert.strictEqual(parentContinuationId("parent-1", stateA), parentContinuationId("parent-1", stateA));
  assert.notStrictEqual(parentContinuationId("parent-1", stateA), parentContinuationId("parent-1", stateB));

  assert.strictEqual(dependencyTargetFloorId({ floorId: "MT5", x: 1, y: 2 }), "MT5");
  assert.strictEqual(dependencyTargetFloorId({
    type: "equip-item",
    acquisition: { floorId: "MT4", x: 2, y: 5 },
  }), "MT4");
  assert.strictEqual(dependencyTargetFloorId(null), null);

  // --- Lineage-safe resume synthetic tree ------------------------------------
  // root(0)
  //  ├─ A(1)
  //  │   └─ S(2)  <- canonical post-state anchor (P(B) final, may be merged)
  //  │       └─ MT4(4)
  //  │           └─ MT5-descendant(5)  <- MUST resume
  //  └─ X(3)
  //      └─ MT5-unrelated(6)           <- MUST NOT resume
  const lineageNodes = new Map([
    [0, { nodeId: 0, parentId: null }],
    [1, { nodeId: 1, parentId: 0 }],
    [2, { nodeId: 2, parentId: 1 }],
    [3, { nodeId: 3, parentId: 0 }],
    [4, { nodeId: 4, parentId: 2 }],
    [5, { nodeId: 5, parentId: 4 }],
    [6, { nodeId: 6, parentId: 3 }],
  ]);
  assert.strictEqual(isNodeDescendantOf(lineageNodes, lineageNodes.get(2), 2), true);
  assert.strictEqual(isNodeDescendantOf(lineageNodes, lineageNodes.get(5), 2), true);
  assert.strictEqual(isNodeDescendantOf(lineageNodes, lineageNodes.get(6), 2), false);
  assert.strictEqual(isNodeDescendantOf(lineageNodes, lineageNodes.get(1), 2), false);
  assert.strictEqual(isNodeDescendantOf(lineageNodes, lineageNodes.get(5), 99), false);

  // --- Lazy work kind registration ------------------------------------------
  const lazyWork = new LazyWorkQueue();
  const continuationWork = lazyWork.enqueue({
    kind: "parent-dependency-continuation",
    sourceNodeId: 1,
    continuation: { id: "continuation-1", parentDependency: { id: "parent-1" } },
  });
  assert.strictEqual(continuationWork.status, "queued");
  assert.strictEqual(lazyWork.resolve(continuationWork, "synthetic-check").status, "resolved");

  // --- Focused real on/off control -------------------------------------------
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
  };
  const focusedOff = runStrategicD2Search({
    ...focusedOptions,
    enableParentDependencyContinuation: false,
  });
  const focusedOn = runStrategicD2Search({
    ...focusedOptions,
    enableParentDependencyContinuation: true,
  });
  assert.strictEqual(focusedOff.stats.totalSearchExpansions, focusedOn.stats.totalSearchExpansions);
  assert.strictEqual(focusedOff.stats.expansions, focusedOn.stats.expansions);
  assert.strictEqual(focusedOff.stats.battleAccessPrerequisiteExpansions,
    focusedOn.stats.battleAccessPrerequisiteExpansions);
  assert.strictEqual(focusedOff.stats.battleAccessPrerequisiteCalls,
    focusedOn.stats.battleAccessPrerequisiteCalls);
  assert.strictEqual(focusedOff.stats.battleAccessPrerequisiteSatisfied,
    focusedOn.stats.battleAccessPrerequisiteSatisfied);
  assert.strictEqual(focusedOn.stats.parentDependencyContinuationsCreated, 0);

  let qualificationContinuation = null;
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
    });

    assert.strictEqual(baseline.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteSatisfied, 2);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteStateCreated, 1);
    assert.strictEqual(candidate.stats.parentDependencyContinuationsCreated, 2);
    assert.strictEqual(candidate.stats.parentDependencyContinuationsMerged, 0);
    assert.strictEqual(candidate.stats.parentDependencyContinuationResumes, 2);
    assert.strictEqual(candidate.stats.parentDependencyContinuationCalls, 4);
    assert.strictEqual(candidate.stats.parentDependencyContinuationWaitingForParentFloor, 2);
    assert.strictEqual(candidate.stats.parentDependencyContinuationNextPrerequisiteCompiled, 2);
    assert.ok(candidate.stats.parentDependencyContinuationLineageRejected > 0);
    assert.strictEqual(candidate.stats.parentDependencyContinuationWitnesses.length, 4);
    assert.strictEqual(candidate.bestTerminalBlocker.attackMargin, -903);
    assert.strictEqual(candidate.stats.terminalActionGenerated, 0);
    assert.strictEqual(candidate.outcome.goalFound, false);

    const successful = candidate.stats.battleAccessPrerequisiteWitnesses
      .filter((witness) => witness.status === "satisfied");
    assert.strictEqual(successful.length, 2);
    successful.forEach((witness) => {
      assert.strictEqual(typeof witness.finalCreated, "boolean");
      assert.ok(witness.parentDependencyContinuationId);
    });
    assert.strictEqual(successful.filter((witness) => witness.finalCreated === false).length, 1);
    assert.strictEqual(successful.filter((witness) => witness.finalCreated === true).length, 1);

    const witnesses = candidate.stats.parentDependencyContinuationWitnesses;
    const waitingWitnesses = witnesses
      .filter((witness) => witness.status === "waiting-for-parent-floor");
    const resumedWitnesses = witnesses
      .filter((witness) => witness.currentFloorId === "MT5");
    assert.strictEqual(waitingWitnesses.length, 2);
    assert.strictEqual(resumedWitnesses.length, 2);
    waitingWitnesses.forEach((waiting) => {
      const resumed = resumedWitnesses.find((witness) =>
        witness.continuationId === waiting.continuationId);
      assert.ok(resumed);
      assert.strictEqual(waiting.currentFloorId, "MT4");
      assert.strictEqual(waiting.targetFloorId, "MT5");
      assert.ok(Number.isInteger(waiting.anchorNodeId));
      assert.strictEqual(waiting.statusReason, "post-state-not-on-parent-target-floor");
      assert.strictEqual(resumed.currentFloorId, "MT5");
      assert.strictEqual(resumed.targetFloorId, "MT5");
      assert.strictEqual(resumed.anchorNodeId, waiting.anchorNodeId);
      assert.strictEqual(resumed.nextBoundary.kind, "battle-unsurvivable");
      assert.ok(["next-prerequisite-compiled", "next-prerequisite-not-schedulable"].includes(resumed.status));
      assert.ok(resumed.nextPrerequisiteId);
      if (resumed.status === "next-prerequisite-not-schedulable") {
        assert.ok(["call-cap-exhausted", "outstanding-barrier", "attempt-deduplicated", "no-selection"]
          .includes(resumed.statusReason));
      }
    });

    qualificationContinuation = {
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
        battleAccessPrerequisiteCompiled: candidate.stats.battleAccessPrerequisiteCompiled,
        calls: candidate.stats.battleAccessPrerequisiteCalls,
        satisfied: candidate.stats.battleAccessPrerequisiteSatisfied,
        noSatisfied: candidate.stats.battleAccessPrerequisiteNoSatisfied,
        stateCreated: candidate.stats.battleAccessPrerequisiteStateCreated,
        parentContinuationsCreated: candidate.stats.parentDependencyContinuationsCreated,
        parentContinuationsMerged: candidate.stats.parentDependencyContinuationsMerged,
        parentContinuationResumes: candidate.stats.parentDependencyContinuationResumes,
        parentContinuationLineageRejected: candidate.stats.parentDependencyContinuationLineageRejected,
        parentContinuationCalls: candidate.stats.parentDependencyContinuationCalls,
        waitingForParentFloor: candidate.stats.parentDependencyContinuationWaitingForParentFloor,
        nextPrerequisiteCompiled: candidate.stats.parentDependencyContinuationNextPrerequisiteCompiled,
        parentContinuationWitnesses: candidate.stats.parentDependencyContinuationWitnesses,
        battleAccessSuccessWitnesses: candidate.stats.battleAccessPrerequisiteWitnesses
          .filter((witness) => witness.status === "satisfied"),
        bestAttackMargin: candidate.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: candidate.stats.terminalActionGenerated,
        goalFound: candidate.outcome.goalFound,
        stoppedReason: candidate.outcome.stoppedReason,
      },
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    identityContract: {
      sameParentSameState: parentContinuationKey("parent-1", stateA),
      sameParentDifferentState: parentContinuationKey("parent-1", stateB),
      differentParentSameState: parentContinuationKey("parent-2", stateA),
      directTargetFloor: dependencyTargetFloorId({ floorId: "MT5", x: 1, y: 2 }),
      acquisitionTargetFloor: dependencyTargetFloorId({
        type: "equip-item",
        acquisition: { floorId: "MT4", x: 2, y: 5 },
      }),
    },
    lineageSafeResume: {
      anchorSelf: isNodeDescendantOf(lineageNodes, lineageNodes.get(2), 2),
      legalDescendant: isNodeDescendantOf(lineageNodes, lineageNodes.get(5), 2),
      unrelatedBranch: isNodeDescendantOf(lineageNodes, lineageNodes.get(6), 2),
      ancestor: isNodeDescendantOf(lineageNodes, lineageNodes.get(1), 2),
      missingAnchor: isNodeDescendantOf(lineageNodes, lineageNodes.get(5), 99),
    },
    lazyWorkKind: continuationWork.kind,
    focusedNoSemanticChange: {
      offTotal: focusedOff.stats.totalSearchExpansions,
      onTotal: focusedOn.stats.totalSearchExpansions,
      offCalls: focusedOff.stats.battleAccessPrerequisiteCalls,
      onCalls: focusedOn.stats.battleAccessPrerequisiteCalls,
    },
    qualificationContinuation,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
