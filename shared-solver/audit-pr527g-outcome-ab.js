"use strict";

/**
 * PR-5.27g - Repair Outcome Feedback A/B Harness (NOT a graded contract check).
 *
 * Runs the real OnlyUp dependency loop under matched controls and classifies
 * each failure-conditioned repair against the SAME blocker identity:
 *   CONVERTED / IMPROVED / NO_PROGRESS / NOT_PRESENT
 *
 * Phase 2 (observation only):
 *   node audit-pr527g-outcome-ab.js --mode=phase2
 *   (runs 4096/64/8 controls matching 5.27f broad arm, classifies all 34 repairs)
 *
 * Phase 3 (matched-control A/B):
 *   node audit-pr527g-outcome-ab.js --arm=off --mode=phase3
 *   node audit-pr527g-outcome-ab.js --arm=on  --mode=phase3
 *   (controls: 2000 total / 200 local / 8 candidateLimit / battleRelevantRepairOnly=false)
 */

const fs = require("node:fs");
const path = require("node:path");

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
  const mode = arg("mode", "phase3");
  const arm = arg("arm", "off");
  const rounds = Number(arg("rounds", "40"));
  const terminalFloor = arg("terminal", "MT3");
  const useJournal = arg("journal", "1") !== "0";

  const isPhase2 = mode === "phase2";
  const maxTotalLocalExpansions = isPhase2 ? 4096 : Number(arg("total-exp", "2000"));
  const localMaxExpansions = isPhase2 ? 64 : Number(arg("local-exp", "200"));
  const candidateLimit = Number(arg("candidate-limit", "8"));
  const outcomeCommitment = isPhase2 ? false : (arm === "on");

  const outDir = path.join(__dirname, "routes", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const journalPath = useJournal
    ? path.join(outDir, `5-27g-journal-${isPhase2 ? "phase2" : arm}.json`)
    : null;

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
      maxTotalLocalExpansions,
      localMaxExpansions,
      candidateLimit,
      commitSuccessfulLineage: true,
      failureConditionedResourceRepair: true,
      battleRelevantRepairOnly: false, // Permanently DEFAULT_OFF per 5.27f verdict
      outcomeConditionedRepairCommitment: outcomeCommitment,
      portfolioJournalPath: journalPath,
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

  // Outcome breakdown by intent kind (path_unlock vs exp/level vs others)
  const outcomesByKind = {};
  for (const record of conversions) {
    const kind = String(record.repairKind || "unknown");
    if (!outcomesByKind[kind]) {
      outcomesByKind[kind] = { CONVERTED: 0, IMPROVED: 0, NO_PROGRESS: 0, NOT_PRESENT: 0, total: 0 };
    }
    const outcome = record.outcome || "NO_PROGRESS";
    outcomesByKind[kind][outcome] = (outcomesByKind[kind][outcome] || 0) + 1;
    outcomesByKind[kind].total += 1;
  }

  // Identity-level detail for audit
  const allIdentityConversions = conversions.flatMap((entry) => (entry.identityConversions || []).map((idConv) => ({
    round: entry.round,
    intentId: entry.intentId,
    repairKind: entry.repairKind,
    blockedPrerequisiteId: idConv.blockedPrerequisiteId,
    beforeStatus: idConv.beforeStatus,
    afterStatus: idConv.afterStatus,
    outcome: idConv.outcome,
  })));

  const summary = {
    mode,
    arm: isPhase2 ? "phase2-broad" : arm,
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
      commitmentsWithheld: repair.commitmentsWithheld,
      outcomeCounts: repair.outcomeCounts || {},
      outcomesByKind,
      blockedStatusesSeen: repair.blockedStatusesSeen,
    },
    attempts: {
      total: attempts.length,
      byKind: attempts.reduce((acc, entry) => {
        const key = String(entry.repairKind || "unknown");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
    conversions: {
      total: conversions.length,
      withOutcomeConverted: conversions.filter((c) => c.outcome === "CONVERTED").length,
      withOutcomeImproved: conversions.filter((c) => c.outcome === "IMPROVED").length,
      withOutcomeNoProgress: conversions.filter((c) => c.outcome === "NO_PROGRESS").length,
      exactConversions: conversions.flatMap((entry) => entry.identityConversions || []).filter((e) => e.converted),
      allIdentityOutcomes: allIdentityConversions,
    },
    journal: {
      path: journalPath,
      exists: journalPath ? fs.existsSync(journalPath) : false,
      sizeBytes: journalPath && fs.existsSync(journalPath) ? fs.statSync(journalPath).size : 0,
    },
    fullRouteStrictReplay: result.fullRouteStrictReplay,
    timing: result.timing,
  };

  const outFileName = isPhase2 ? "5-27g-phase2-broad.json" : `5-27g-round-ab-${arm}.json`;
  const outPath = path.join(outDir, outFileName);
  fs.writeFileSync(outPath, `${JSON.stringify({ summary, result }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { main };
