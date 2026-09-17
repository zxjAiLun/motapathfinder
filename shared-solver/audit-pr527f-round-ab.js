"use strict";

/**
 * PR-5.27f - 40-round round A/B harness (NOT a graded contract check).
 *
 * Purpose: run the real tower dependency loop under a fixed configuration and
 * report (a) the same-prerequisite identity conversion counters introduced in
 * 5.27f, and (b) the relevance-gate comparison. Output goes to an ignored
 * generated path; nothing here is a pass/fail gate.
 *
 * Usage:
 *   node audit-pr527f-round-ab.js --arm=off --rounds=40
 *   node audit-pr527f-round-ab.js --arm=on  --rounds=40
 */

const path = require("node:path");
const fs = require("node:fs");

const { runDependencyFeedbackLoop } = require("./lib/dependency-feedback-controller");
const { makeBlindSimulator } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((entry) => entry.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function main() {
  const arm = arg("arm", "off");
  const rounds = Number(arg("rounds", "40"));
  const terminalFloor = arg("terminal", "MT3");
  const outDir = path.join(__dirname, "routes", "generated");
  fs.mkdirSync(outDir, { recursive: true });

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeBlindSimulator(project);
  const initialState = simulator.createInitialState({ rank: "chaos" });

  const result = runDependencyFeedbackLoop(
    project,
    PROJECT_ROOT,
    { type: "floorReached", floorId: terminalFloor },
    initialState,
    {
      towerId: "onlyup",
      maxRounds: rounds,
      maxTotalLocalExpansions: 4096,
      localMaxExpansions: 64,
      candidateLimit: 8,
      commitSuccessfulLineage: true,
      failureConditionedResourceRepair: true,
      battleRelevantRepairOnly: arm === "on",
      simulatorFactory: () => makeBlindSimulator(project),
    },
  );

  const branches = result.branches || [];
  const repair = result.globalState.resourceRepair || {};
  const attempts = result.globalState.resourceRepairAttempts || [];
  const conversions = result.globalState.resourceRepairConversions || [];
  const floors = {};
  for (const branch of branches) {
    if (branch.floorId) floors[branch.floorId] = (floors[branch.floorId] || 0) + 1;
  }

  const summary = {
    arm,
    rounds,
    terminalFloor,
    controls: result.controls,
    terminal: {
      reached: result.terminal.reached,
      terminationReason: result.terminal.terminationReason,
      terminationClass: result.terminal.terminationClass,
      finalFloorId: result.terminal.finalFloorId,
    },
    search: {
      roundCount: result.globalState.roundCount,
      branchCount: result.globalState.branchCount,
      maxBranchDepth: branches.reduce((max, b) => Math.max(max, b.depth || 0), 0),
      maxCumulativeDecisions: branches.reduce((max, b) => Math.max(max, b.cumulativeDecisionCount || 0), 0),
      deepestFloors: floors,
      totalLocalExpansions: result.globalState.totalLocalExpansions,
      advanceableBranchCount: result.globalState.advanceableBranchCount,
      openBranchCount: result.globalState.openBranchCount,
    },
    repair: {
      generated: repair.generated,
      selected: repair.selected,
      checkpointsCreated: repair.checkpointsCreated,
      exactSamePrerequisiteConversions: repair.exactSamePrerequisiteConversions,
      convertedToViableBroad: repair.convertedToViable,
      rejectedByRelevance: repair.rejectedByRelevance,
      rejectedIntentKinds: repair.rejectedIntentKinds,
      blockedStatusesSeen: repair.blockedStatusesSeen,
    },
    pathUnlockSelections: attempts.filter((entry) => entry.repairKind === "path/unlock").length,
    pathUnlockSelectionsAndIntent: attempts
      .filter((entry) => String(entry.intentId || "").includes("path_unlock")).length,
    repairKindCounts: attempts.reduce((acc, entry) => {
      const key = String(entry.repairKind || "unknown");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    pathUnlockExactConversions: conversions
      .filter((entry) => String(entry.intentId || "").includes("path_unlock"))
      .reduce((sum, entry) => sum + (entry.identityConversions || [])
        .filter((c) => c.converted).length, 0),
    exactConversions: conversions.flatMap((entry) => entry.identityConversions || [])
      .filter((entry) => entry.converted),
    fullRouteStrictReplay: result.fullRouteStrictReplay,
    timing: result.timing,
  };

  const outPath = path.join(outDir, `5-27f-round-ab-${arm}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify({ summary, result }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { main };
