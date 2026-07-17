"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { runRouteWindowRepair } = require("./lib/route-window-repair");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const MT5_ROUTE_FILE = path.join(
  __dirname,
  "routes",
  "latest",
  "mt5-problem-before-9-10.route.json",
);

// Relaxed profile for deterministic candidate discovery in closure tests.
// Uses a small 2-step window (79-80) and very relaxed stage thresholds so
// all three DP stages reliably produce candidates without huge budgets.
const RELAXED_PROFILE = {
  id: "relaxed-closure",
  windowStart: 79,
  windowEnd: 80,
  floors: ["MT4", "MT5"],
  goal: { floorId: "MT5", minHero: { lv: 1 } },
  stageThresholds: [
    { minHero: { lv: 1 } },
    { minHero: { lv: 1 } },
    null,
  ],
};

function makeContext() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
  });
  const route = readRouteFile(MT5_ROUTE_FILE);
  return { project, simulator, route };
}

// ── Auto-derive and mutation safety (full window, tiny budget) ────────

function checkBaselineAutoDerive() {
  const { project, simulator, route } = makeContext();
  const result = runRouteWindowRepair(project, simulator, route, {
    id: "auto", windowStart: 60, windowEnd: 80, floors: ["MT4", "MT5"],
  }, {
    windowStart: 60, windowEnd: 80,
    windowMaxExpansions: 10, windowMaxRuntimeMs: 2000,
    windowCandidateLimit: 1, windowGoalSkylineLimit: 2,
    windowFloors: ["MT4", "MT5"],
  });
  assert.equal(result.baselineHp, 48049, "auto-derived baseline HP should be 48049");
  assert.ok(result.finalGoal, "should expose finalGoal");
  assert.ok(Array.isArray(result.finalGoal.removedTiles));
  assert.ok(result.finalGoal.removedTiles.length > 0, "removedTiles should be non-empty");
  assert.equal(result.finalGoal.floorId, "MT5");
  assert.ok(Array.isArray(result.stageResults));
  assert.ok(result.stageResults.length > 0, "at least one stage should run");
  return {
    baselineHp: result.baselineHp,
    removedTileCount: result.finalGoal.removedTiles.length,
    stageCount: result.stageResults.length,
  };
}

function checkNoMutationGuarantee() {
  const { project, simulator, route } = makeContext();
  const before = JSON.stringify(route);
  runRouteWindowRepair(project, simulator, route, {
    id: "no-mut", windowStart: 60, windowEnd: 80, floors: ["MT4", "MT5"],
  }, {
    windowStart: 60, windowEnd: 80,
    windowMaxExpansions: 10, windowMaxRuntimeMs: 2000,
    windowCandidateLimit: 1, windowGoalSkylineLimit: 2,
    windowFloors: ["MT4", "MT5"],
  });
  assert.equal(JSON.stringify(route), before, "source route must not be mutated");
  return { ok: true };
}

// ── Hard-asserted candidate discovery (relaxed profile, 2-step window) ─

function checkGlobalCandidateIdsAndValidations() {
  const { project, simulator, route } = makeContext();
  const result = runRouteWindowRepair(project, simulator, route, RELAXED_PROFILE, {
    windowStart: 79, windowEnd: 80,
    windowMaxExpansions: 300, windowMaxRuntimeMs: 10000,
    windowCandidateLimit: 4, windowGoalSkylineLimit: 8,
    windowFloors: ["MT4", "MT5"],
  });

  // Hard assertion: all 3 stages must have run and found candidates.
  assert.equal(result.stageResults.length, 3, "all 3 stages should run");
  for (const stage of result.stageResults) {
    assert.ok(
      stage.candidateCount > 0,
      `stage ${stage.stageIndex} should have candidates, got ${stage.candidateCount}`,
    );
  }

  // Hard assertion: validations must be non-empty.
  assert.ok(
    Array.isArray(result.validations),
    "validations should be array",
  );
  assert.ok(
    result.validations.length > 0,
    "validations should be non-empty (hard assertion, not conditional)",
  );

  // All final candidate IDs must be unique and start with stage-3-.
  const ids = result.validations.map((v) => v.candidateId);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "candidate IDs must be unique",
  );
  for (const id of ids) {
    assert.ok(
      typeof id === "string" && id.startsWith("stage-3-"),
      `final candidate ID should start with stage-3-, got: ${id}`,
    );
  }

  // Each validation must have goalFailures, actionTrace, and rejectedReason (if not accepted).
  for (const v of result.validations) {
    assert.ok(Array.isArray(v.goalFailures), "each validation needs goalFailures");
    assert.ok(Array.isArray(v.actionTrace), "each validation needs actionTrace");
    assert.ok(typeof v.finalHp === "number" || v.finalHp === null, "finalHp should be number or null");
    assert.ok(typeof v.baselineHp === "number", "baselineHp should be number");
    if (!v.accepted) {
      assert.ok(typeof v.rejectedReason === "string", "rejected needs rejectedReason");
    }
  }

  return {
    ok: result.ok,
    stoppedReason: result.stoppedReason,
    validationCount: result.validations.length,
    stageCount: result.stageResults.length,
  };
}

function checkStageResultsAggregation() {
  const { project, simulator, route } = makeContext();
  const result = runRouteWindowRepair(project, simulator, route, RELAXED_PROFILE, {
    windowStart: 79, windowEnd: 80,
    windowMaxExpansions: 300, windowMaxRuntimeMs: 10000,
    windowCandidateLimit: 4, windowGoalSkylineLimit: 8,
    windowFloors: ["MT4", "MT5"],
  });

  // Hard assertion: all 3 stages present with candidates.
  assert.equal(result.stageResults.length, 3, "should have exactly 3 stage results");
  for (const stage of result.stageResults) {
    assert.ok(typeof stage.expansions === "number", "stage.expansions should be number");
    assert.ok(typeof stage.candidateCount === "number", "stage.candidateCount should be number");
    assert.ok(stage.candidateCount > 0, `stage ${stage.stageIndex} should have candidates`);
    assert.ok(Array.isArray(stage.candidates), "stage.candidates should be array");
    assert.ok(typeof stage.startStateCount === "number", "stage.startStateCount should exist");
    assert.ok(typeof stage.skylineCount === "number", "stage.skylineCount should exist");
    for (const c of stage.candidates) {
      assert.ok(c.id, "each candidate should have id");
      assert.ok(c.hero, "each candidate should have hero");
      assert.ok(Array.isArray(c.tags), "each candidate should have tags array");
    }
  }

  return {
    stageCount: result.stageResults.length,
    stagesWithCandidates: result.stageResults.filter((s) => s.candidateCount > 0).length,
  };
}

// ── Synthetic accepted route (low baseline HP → guaranteed acceptance) ─

function checkSyntheticAcceptedRoute() {
  const { project, simulator, route } = makeContext();
  const result = runRouteWindowRepair(project, simulator, route, RELAXED_PROFILE, {
    windowStart: 79, windowEnd: 80,
    baselineHp: 1,
    windowMaxExpansions: 300, windowMaxRuntimeMs: 10000,
    windowCandidateLimit: 4, windowGoalSkylineLimit: 8,
    windowFloors: ["MT4", "MT5"],
  });

  // Hard assertion: the accepted path must be exercised.
  assert.equal(result.ok, true, `synthetic accepted route should succeed: ${result.stoppedReason}`);
  assert.ok(result.route, "should produce a rebuilt route record");
  assert.equal(result.strictReplayOk, true, "strict replay of rebuilt route should succeed");
  assert.ok(
    Array.isArray(result.strictGoalFailures) && result.strictGoalFailures.length === 0,
    "strict replay should meet full goal",
  );
  assert.ok(
    result.finalHp > result.baselineHp,
    `final HP ${result.finalHp} should exceed baseline ${result.baselineHp}`,
  );
  assert.ok(result.accepted, "should have an accepted validation entry");
  assert.ok(
    result.validations.some((v) => v.accepted),
    "at least one validation should be accepted",
  );

  // Verify action trace is present in all validations.
  for (const v of result.validations) {
    assert.ok(Array.isArray(v.actionTrace), "each validation should have actionTrace");
    assert.ok(
      typeof v.windowActionCount === "number",
      "each validation should have windowActionCount",
    );
  }

  return {
    ok: result.ok,
    finalHp: result.finalHp,
    baselineHp: result.baselineHp,
    strictReplayOk: result.strictReplayOk,
    validationCount: result.validations.length,
  };
}

function checkMt5BaselineLocalProbeAccepted() {
  const { project, simulator, route } = makeContext();
  const result = runRouteWindowRepair(project, simulator, route, {
    id: "mt5-baseline-local",
    windowStart: 60,
    windowEnd: 80,
    floors: ["MT4", "MT5"],
  }, {
    windowStart: 60, windowEnd: 80,
    windowMaxExpansions: 1000, windowMaxRuntimeMs: 3000,
    windowCandidateLimit: 2, windowGoalSkylineLimit: 4,
    windowFloors: ["MT4", "MT5"],
    disableFloorFly: true,
    enableFloorFlyFinalStage: true,
    maxFloorFlyPerTarget: 1,
    preserveWindowPrefix: 2,
    localProbe: false,
  });

  assert.equal(result.ok, true, `baseline-local probe should be accepted: ${result.stoppedReason}`);
  assert.equal(result.strictReplayOk, true, "baseline-local route should strict replay");
  assert.equal(result.finalHp, 51533, "baseline-local swap chain should improve MT5 route to 51533 HP");
  assert.ok(result.finalHp > result.baselineHp, "baseline-local route should improve HP");
  assert.equal(result.accepted && result.accepted.baselineLocalProbe, true);
  assert.equal(result.accepted && result.accepted.probeType, "baseline-swap-chain");
  assert.deepEqual(
    result.accepted && result.accepted.probe && result.accepted.probe.swaps,
    [[7, 8], [5, 7], [6, 7]],
  );
  assert.ok(result.route, "accepted baseline-local probe should produce a route record");
  assert.equal((result.route.decisions || []).length, 80, "rebuilt route should keep 80 decisions");

  return {
    ok: result.ok,
    finalHp: result.finalHp,
    baselineHp: result.baselineHp,
    strictReplayOk: result.strictReplayOk,
    probeType: result.accepted.probeType,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const autoDerive = checkBaselineAutoDerive();
  const noMutation = checkNoMutationGuarantee();
  const globalIds = checkGlobalCandidateIdsAndValidations();
  const aggregation = checkStageResultsAggregation();
  const accepted = checkSyntheticAcceptedRoute();
  const baselineLocal = checkMt5BaselineLocalProbeAccepted();
  console.log(JSON.stringify({
    autoDerive,
    noMutation,
    globalIds,
    aggregation,
    accepted,
    baselineLocal,
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
