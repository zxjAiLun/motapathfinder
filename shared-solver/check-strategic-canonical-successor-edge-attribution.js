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

  let qualificationAttribution = null;
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
    assert.ok(candidate.stats.canonicalSuccessorEdgeCount > 0);
    assert.ok(candidate.stats.canonicalExpansionSummaryCount > 0);

    const stageChild = candidate.stats.battleAccessPrerequisiteWitnesses
      .find((witness) => witness.prerequisiteKind === "battle-stage-prerequisite");
    assert.ok(stageChild);
    assert.strictEqual(stageChild.status, "satisfied");
    assert.strictEqual(stageChild.afterStage, "lethal");

    const stageContinuation = candidate.stats.parentDependencyContinuationWitnesses
      .find((witness) => witness.satisfiedPrerequisiteId === stageChild.prerequisiteId);
    assert.ok(stageContinuation);

    const stageAttribution = candidate.stats.canonicalSuccessorEdgeAttributions
      .find((entry) => entry.continuationId === stageContinuation.continuationId);
    assert.ok(stageAttribution);
    assert.strictEqual(stageAttribution.anchorEverExpanded, false);
    assert.strictEqual(stageAttribution.anchorExpansionOrdinal, null);
    assert.strictEqual(stageAttribution.anchorExpandedBeforeContinuation, false);
    assert.strictEqual(stageAttribution.anchorExpandedAfterContinuation, false);
    assert.strictEqual(stageAttribution.outgoing, null);
    assert.strictEqual(stageAttribution.canonicalGraphReachableTargetFloor, false);
    assert.deepStrictEqual(stageAttribution.canonicalGraphTargetFloorCandidateNodeIds, []);

    // The earlier continuation shows the mixed case: its anchor WAS expanded
    // and the canonical edge graph reached MT5 through a new-child floor
    // transition. This proves the observer can distinguish the four cases.
    const firstAttribution = candidate.stats.canonicalSuccessorEdgeAttributions
      .find((entry) => entry.anchorEverExpanded === true);
    assert.ok(firstAttribution);
    assert.strictEqual(firstAttribution.canonicalGraphReachableTargetFloor, true);

    qualificationAttribution = {
      totalSearchExpansions: candidate.stats.totalSearchExpansions,
      strategicExpansions: candidate.stats.expansions,
      battleAccessPrerequisiteExpansions: candidate.stats.battleAccessPrerequisiteExpansions,
      calls: candidate.stats.battleAccessPrerequisiteCalls,
      canonicalSuccessorEdgeCount: candidate.stats.canonicalSuccessorEdgeCount,
      canonicalExpansionSummaryCount: candidate.stats.canonicalExpansionSummaryCount,
      canonicalFloorTransitionActionCount: candidate.stats.canonicalFloorTransitionActionCount,
      stageAttribution,
      controlAttribution: firstAttribution,
      observationCase: "case-1-anchor-never-expanded",
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    qualificationAttribution,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
