"use strict";

const fs = require("node:fs");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildStateKey } = require("./lib/state-key");
const { runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { createNoStateChangeChoiceResolver } = require("./lib/onlyup-mt1-real-route-gate");

function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node segment-worker.js <inputPath> <outputPath>");
    process.exit(1);
  }

  const rawInput = fs.readFileSync(inputPath, "utf8");
  const payload = JSON.parse(rawInput);

  const project = loadProject(payload.projectRoot || payload.projectDir);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    choiceResolver,
  });

  // Verify round-trip stateKey on input candidates
  if (Array.isArray(payload.inputFrontier) && Array.isArray(payload.parentInputStateKeys)) {
    for (let i = 0; i < payload.inputFrontier.length; i += 1) {
      const cand = payload.inputFrontier[i];
      const expectedKey = payload.parentInputStateKeys[i];
      const actualKey = buildStateKey(cand.state);
      if (expectedKey && actualKey !== expectedKey) {
        console.error(`Input candidate ${cand.id} stateKey mismatch: expected ${expectedKey}, got ${actualKey}`);
        process.exit(2);
      }
    }
  }

  const startedAt = Date.now();
  const result = runSegmentAgainstFrontierLocal(
    simulator,
    payload.segment,
    payload.inputFrontier,
    payload.config,
    payload.overrides,
  );
  const searchWallMs = Date.now() - startedAt;

  // Annotate output candidates with authoritative state keys
  if (Array.isArray(result.merged)) {
    result.merged.forEach((cand) => {
      cand.outputStateKey = buildStateKey(cand.state);
    });
  }

  const memory = process.memoryUsage();
  const workerPeakRssMb = Math.round((Number(memory.rss || 0) / 1048576) * 10) / 10;
  const workerHeapUsedMb = Math.round((Number(memory.heapUsed || 0) / 1048576) * 10) / 10;

  const totalExpansions = (result.attempts || []).reduce((sum, att) => {
    const dp = att && att.diagnostics && att.diagnostics.dp;
    return sum + Number((dp && dp.expansions) || 0);
  }, 0);

  const response = {
    success: true,
    merged: result.merged,
    summary: result.summary,
    attempts: (result.attempts || []).map((att) => ({
      startCandidateId: att.startCandidateId,
      found: att.found,
      goalCount: (att.goalSkyline || []).length,
      diagnostics: att.diagnostics,
    })),
    candidateLimit: result.candidateLimit,
    memoryLimited: result.memoryLimited,
    memoryStopReason: result.memoryStopReason,
    consumedExpansions: totalExpansions,
    searchWallMs,
    workerPeakRssMb,
    workerHeapUsedMb,
  };

  fs.writeFileSync(outputPath, JSON.stringify(response));
  process.exit(0);
}

if (require.main === module) {
  main();
}
