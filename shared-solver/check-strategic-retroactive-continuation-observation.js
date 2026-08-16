"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
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

  let qualificationObservation = null;
  if (includeQualification1000) {
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
      enableBattleStagePrerequisiteDecomposition: true,
    });

    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 6);
    assert.strictEqual(candidate.stats.continuationDerivedCalls, 1);

    const stageChild = candidate.stats.battleAccessPrerequisiteWitnesses
      .find((witness) => witness.prerequisiteKind === "battle-stage-prerequisite");
    assert.ok(stageChild);
    assert.strictEqual(stageChild.status, "satisfied");
    assert.strictEqual(stageChild.afterStage, "lethal");
    assert.strictEqual(stageChild.finalCreated, false);

    const stageContinuation = candidate.stats.parentDependencyContinuationWitnesses
      .find((witness) => witness.satisfiedPrerequisiteId === stageChild.prerequisiteId);
    assert.ok(stageContinuation);
    assert.strictEqual(stageContinuation.finalCreated, false);
    assert.strictEqual(stageContinuation.status, "waiting-for-parent-floor");
    assert.strictEqual(stageContinuation.currentFloorId, "MT4");
    assert.strictEqual(stageContinuation.targetFloorId, "MT5");
    assert.strictEqual(stageContinuation.callsRemainingAtContinuationCreation, 2);
    assert.strictEqual(stageContinuation.eligibleHistoricalDescendantsAtCreation, 0);
    assert.strictEqual(stageContinuation.eligibleHistoricalTargetFloorDescendants, 0);
    assert.deepStrictEqual(stageContinuation.retroactiveResumeCandidateNodeIds, []);
    assert.strictEqual(stageContinuation.futureDescendantsObservedAfterCreation, 0);
    assert.strictEqual(stageContinuation.priorityStillActiveAtSearchEnd, true);

    // Observation conclusion: retroactive historical-descendant hypothesis is
    // not supported for this frozen workload. The instruction is to stop and
    // re-attribute the real breakpoint; no retroactive mechanism is enabled.
    assert.strictEqual(
      stageContinuation.eligibleHistoricalTargetFloorDescendants > 0 ||
      stageContinuation.futureDescendantsObservedAfterCreation > 0,
      false,
    );

    qualificationObservation = {
      totalSearchExpansions: candidate.stats.totalSearchExpansions,
      strategicExpansions: candidate.stats.expansions,
      battleAccessPrerequisiteExpansions: candidate.stats.battleAccessPrerequisiteExpansions,
      calls: candidate.stats.battleAccessPrerequisiteCalls,
      rootLevelCalls: candidate.stats.rootLevelCalls,
      continuationDerivedCalls: candidate.stats.continuationDerivedCalls,
      stageChild: {
        prerequisiteId: stageChild.prerequisiteId,
        boundary: stageChild.boundary,
        beforeStage: stageChild.beforeStage,
        afterStage: stageChild.afterStage,
        finalCreated: stageChild.finalCreated,
      },
      stageContinuation,
      hypothesisConclusion: "historical-descendant-reentry-not-supported",
      action: "stop-retroactive-mechanism-and-re-attribute-real-breakpoint",
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    qualificationObservation,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
