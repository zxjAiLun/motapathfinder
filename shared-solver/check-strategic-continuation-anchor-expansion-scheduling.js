"use strict";

/** TEST GRADE: integration-local */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");
const { AnchorExpansionRequestQueue } = require("./lib/strategic-anchor-expansion-request");
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

  // --- Synthetic one-shot request lifecycle ----------------------------------
  const queue = new AnchorExpansionRequestQueue((value) => value);
  assert.strictEqual(queue.request({
    continuationId: "C1",
    anchorNodeId: 10,
    requestedAtExpansion: 40,
    targetFloor: "MT5",
    anchorExists: true,
    anchorExpanded: false,
  }).accepted, true);
  assert.strictEqual(queue.request({
    continuationId: "C1",
    anchorNodeId: 10,
    requestedAtExpansion: 41,
    targetFloor: "MT5",
    anchorExists: true,
    anchorExpanded: false,
  }).accepted, false);
  const selected = queue.select({
    evaluate: () => ({
      anchorExists: true,
      anchorExpanded: false,
      continuationActive: true,
      continuationParked: true,
    }),
  });
  assert.strictEqual(selected.type, "selected");
  assert.strictEqual(selected.request.anchorNodeId, 10);
  assert.strictEqual(queue.select({
    evaluate: () => ({
      anchorExists: true,
      anchorExpanded: false,
      continuationActive: true,
      continuationParked: true,
    }),
  }).type, "none");

  // Already expanded by normal agenda -> stale skip, no selection.
  assert.strictEqual(queue.request({
    continuationId: "C2",
    anchorNodeId: 11,
    requestedAtExpansion: 50,
    targetFloor: "MT5",
    anchorExists: true,
    anchorExpanded: false,
  }).accepted, true);
  assert.strictEqual(queue.select({
    evaluate: () => ({
      anchorExists: true,
      anchorExpanded: true,
      continuationActive: true,
      continuationParked: true,
    }),
  }).reason, "already-expanded-or-anchor-missing");

  // Inactive continuation -> stale skip, no selection.
  assert.strictEqual(queue.request({
    continuationId: "C3",
    anchorNodeId: 12,
    requestedAtExpansion: 60,
    targetFloor: "MT5",
    anchorExists: true,
    anchorExpanded: false,
  }).accepted, true);
  assert.strictEqual(queue.select({
    evaluate: () => ({
      anchorExists: true,
      anchorExpanded: false,
      continuationActive: false,
      continuationParked: false,
    }),
  }).reason, "inactive-continuation");

  let qualificationScheduling = null;
  if (includeQualification1000) {
    const runControl = (enable) => runStrategicD2Search({
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
      enableContinuationAnchorExpansionScheduling: enable,
    });

    const control = runControl(false);
    const candidate = runControl(true);

    assert.strictEqual(control.stats.totalSearchExpansions, 1000);
    assert.strictEqual(candidate.stats.totalSearchExpansions, 1000);
    assert.strictEqual(control.stats.battleAccessPrerequisiteCalls, 6);
    assert.strictEqual(candidate.stats.battleAccessPrerequisiteCalls, 8);
    assert.strictEqual(candidate.stats.continuationDerivedCalls, 2);
    assert.strictEqual(candidate.stats.continuationAnchorExpansionRequests, 2);
    assert.strictEqual(candidate.stats.continuationAnchorExpansionSelections, 2);
    assert.strictEqual(candidate.stats.continuationAnchorExpansionAlreadyExpandedSkips, 0);
    assert.strictEqual(candidate.stats.continuationAnchorExpansionInactiveSkips, 0);
    assert.strictEqual(candidate.stats.anchorExpansionWitnesses.length, 2);
    assert.strictEqual(candidate.stats.expandedByQueue["parent-continuation-anchor"], 2);

    const stageChild = candidate.stats.battleAccessPrerequisiteWitnesses
      .find((witness) => witness.prerequisiteKind === "battle-stage-prerequisite");
    assert.ok(stageChild);
    assert.strictEqual(stageChild.status, "satisfied");
    assert.strictEqual(stageChild.afterStage, "lethal");

    const stageContinuation = candidate.stats.parentDependencyContinuationWitnesses
      .find((witness) => witness.satisfiedPrerequisiteId === stageChild.prerequisiteId);
    assert.ok(stageContinuation);

    const stageAnchorAttribution = candidate.stats.canonicalSuccessorEdgeAttributions
      .find((entry) => entry.continuationId === stageContinuation.continuationId);
    assert.ok(stageAnchorAttribution);
    assert.strictEqual(stageAnchorAttribution.anchorEverExpanded, true);
    assert.strictEqual(stageAnchorAttribution.anchorExpandedAfterContinuation, true);

    const resumed = candidate.stats.parentDependencyContinuationWitnesses
      .find((witness) => witness.continuationId === stageContinuation.continuationId &&
        witness.status === "next-prerequisite-compiled");
    assert.ok(resumed);
    assert.strictEqual(resumed.prerequisiteKind, "battle-access-prerequisite");
    assert.ok(resumed.nextPrerequisiteId);

    const secondChild = candidate.stats.battleAccessPrerequisiteWitnesses
      .filter((witness) => witness.hierarchyLevel > 0)
      .find((witness) => witness.prerequisiteId === resumed.nextPrerequisiteId);
    assert.ok(secondChild);
    assert.strictEqual(secondChild.status, "not-satisfied");
    assert.strictEqual(secondChild.prerequisiteKind, "battle-access-prerequisite");

    assert.strictEqual(candidate.bestTerminalBlocker.attackMargin, -903);
    assert.strictEqual(candidate.stats.terminalActionGenerated, 0);
    assert.strictEqual(candidate.outcome.goalFound, false);

    qualificationScheduling = {
      control: {
        totalSearchExpansions: control.stats.totalSearchExpansions,
        strategicExpansions: control.stats.expansions,
        battleAccessPrerequisiteExpansions: control.stats.battleAccessPrerequisiteExpansions,
        calls: control.stats.battleAccessPrerequisiteCalls,
        stageAnchorEverExpanded: control.stats.canonicalSuccessorEdgeAttributions
          .find((entry) => entry.continuationId === stageContinuation.continuationId)
          .anchorEverExpanded,
        bestAttackMargin: control.bestTerminalBlocker.attackMargin,
      },
      candidate: {
        totalSearchExpansions: candidate.stats.totalSearchExpansions,
        strategicExpansions: candidate.stats.expansions,
        battleAccessPrerequisiteExpansions: candidate.stats.battleAccessPrerequisiteExpansions,
        calls: candidate.stats.battleAccessPrerequisiteCalls,
        rootLevelCalls: candidate.stats.rootLevelCalls,
        continuationDerivedCalls: candidate.stats.continuationDerivedCalls,
        anchorExpansionRequests: candidate.stats.continuationAnchorExpansionRequests,
        anchorExpansionSelections: candidate.stats.continuationAnchorExpansionSelections,
        anchorExpansionWitnesses: candidate.stats.anchorExpansionWitnesses,
        stageAnchorExpansionAfterContinuation: stageAnchorAttribution.anchorExpandedAfterContinuation,
        resumedNextPrerequisite: resumed,
        secondChild,
        bestAttackMargin: candidate.bestTerminalBlocker.attackMargin,
        terminalActionGenerated: candidate.stats.terminalActionGenerated,
        goalFound: candidate.outcome.goalFound,
      },
    };
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    syntheticOneShot: {
      requestAccepted: true,
      duplicateRejected: true,
      selectedOnce: true,
      staleAfterSelection: true,
      alreadyExpandedSkipped: true,
      inactiveContinuationSkipped: true,
    },
    qualificationScheduling,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
