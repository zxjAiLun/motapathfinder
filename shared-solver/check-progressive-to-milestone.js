"use strict";

/**
 * Progressive Planner → Milestone Suggestion Bridge (v2)
 *
 * Fixes from v1:
 *  1. special-target checkpoints generate tileRemoval goals with removedTiles
 *  2. All checkpoint types include floorId + effectiveHero
 *  3. validateMilestones() validates each independently (not as a chain)
 *  4. minHero/minEffectiveHero are complete (hp/atk/def/mdef/lv/exp)
 *  5. allowedFloors defaults to floor range derived from from/to milestones
 *  6. start-route replay enumerates full action sources
 *  7. Validation results written to output JSON
 */

const path = require("node:path");
const fs = require("node:fs");

const {
  runProgressiveMonsterPlanner,
} = require("./lib/progressive-monster-planner");
const { getMilestoneSpec, getMilestoneById } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const {
  buildRouteRecord,
  writeRouteFile,
  readRouteFile,
} = require("./lib/route-store");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");

const DEFAULT_PROJECT_ROOT = path.resolve(
  __dirname,
  "..",
  "Only upV2.1",
  "Only upV2.1",
);

// =========================================================================
// CLI helpers
// =========================================================================

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

// =========================================================================
// Simulator
// =========================================================================

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: null,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

/**
 * Find an action matching a summary string, using the full action enumeration
 * pattern from run-segmented-dp.js (primitive + interactPickup + floorFly).
 */
function findAction(simulator, state, summary) {
  const actions = [];
  try {
    actions.push(...(simulator.enumeratePrimitiveActions(state).actions || []));
  } catch (e) {
    /* ignore */
  }
  try {
    actions.push(...(simulator.enumerateActions(state) || []));
  } catch (e) {
    /* ignore */
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      actions.push(...(simulator.enumerateInteractPickupActions(state) || []));
    }
  } catch (e) {
    /* ignore */
  }
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      actions.push(...(simulator.enumerateFloorFlyActions(state) || []));
    }
  } catch (e) {
    /* ignore */
  }
  return actions.find((action) => action.summary === summary) || null;
}

function replayRouteFile(simulator, routeFile) {
  let state = simulator.createInitialState({ rank: "chaos" });
  const record = readRouteFile(routeFile);
  for (const decision of record.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action)
      throw new Error(
        `Unable to replay start route at ${decision.index}: ${decision.summary}`,
      );
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace"))
      delete state.routeTrace;
    state = simulator.applyAction(state, action);
  }
  return state;
}

// =========================================================================
// Floor range derivation
// =========================================================================

function deriveFloorRange(project, routeName, fromMilestoneId, toMilestoneId) {
  const spec = getMilestoneSpec(project, routeName);
  const milestones = spec.milestones || [];
  const floorOrder = project.floorOrder || [];

  const fromIndex = fromMilestoneId
    ? milestones.findIndex((m) => m.id === fromMilestoneId)
    : -1;
  const toIndex = toMilestoneId
    ? milestones.findIndex((m) => m.id === toMilestoneId)
    : -1;

  if (fromIndex < 0 && toIndex < 0) return null;

  // Collect floor IDs from milestones in range
  const start = fromIndex >= 0 ? fromIndex : 0;
  const end = toIndex >= 0 ? toIndex : milestones.length - 1;
  const relevantFloorIds = new Set();

  for (let i = start; i <= end; i++) {
    const goal = (milestones[i] || {}).goal || {};
    if (goal.floorId) relevantFloorIds.add(goal.floorId);
  }

  if (relevantFloorIds.size === 0) return null;

  // Expand to include all floors between min and max in floor order
  const ordered = floorOrder.filter((fid) => relevantFloorIds.has(fid));
  if (ordered.length > 0) {
    const minIdx = floorOrder.indexOf(ordered[0]);
    const maxIdx = floorOrder.indexOf(ordered[ordered.length - 1]);
    if (minIdx >= 0 && maxIdx >= 0) {
      return floorOrder.slice(minIdx, maxIdx + 1);
    }
  }

  return [...relevantFloorIds];
}

// =========================================================================
// Battle summary parser
// =========================================================================

function parseBattleSummary(summary) {
  // Format: "battle:enemyId@floorId:x,y"
  const match = /^battle:([^@]+)@([^:]+):(\d+),(\d+)$/.exec(
    String(summary || ""),
  );
  if (!match) return null;
  return {
    enemyId: match[1],
    floorId: match[2],
    x: Number(match[3]),
    y: Number(match[4]),
  };
}

// =========================================================================
// Checkpoint → Milestone conversion
// =========================================================================

function sanitizeId(text) {
  return String(text || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 60);
}

function buildMinHero(hero) {
  if (!hero) return {};
  const result = {};
  if (hero.hp != null) result.hp = hero.hp;
  if (hero.atk != null) result.atk = hero.atk;
  if (hero.def != null) result.def = hero.def;
  if (hero.mdef != null) result.mdef = hero.mdef;
  if (hero.lv != null) result.lv = hero.lv;
  if (hero.exp != null) result.exp = hero.exp;
  return result;
}

function buildMinEffectiveHero(effectiveHero) {
  if (!effectiveHero) return {};
  const result = {};
  if (effectiveHero.atk != null) result.atk = effectiveHero.atk;
  if (effectiveHero.def != null) result.def = effectiveHero.def;
  if (effectiveHero.mdef != null) result.mdef = effectiveHero.mdef;
  return result;
}

function checkpointToMilestone(checkpoint, existingMilestoneIds) {
  const baseId =
    checkpoint.type === "entered-floor"
      ? `auto-floor-${checkpoint.floorId}`
      : checkpoint.type === "special-target-defeated"
        ? `auto-target-${sanitizeId(checkpoint.target)}`
        : `auto-score-${Math.round((checkpoint.score || 0) / 1000000)}M`;

  let id = baseId;
  let counter = 1;
  while (existingMilestoneIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter++;
  }
  existingMilestoneIds.add(id);

  const goal = {
    floorId: checkpoint.floorId || undefined,
    minHero: buildMinHero(checkpoint.hero),
    minEffectiveHero: buildMinEffectiveHero(checkpoint.effectiveHero),
  };

  // For special-target-defeated: parse battle summary and add tileRemoval
  if (checkpoint.type === "special-target-defeated" && checkpoint.target) {
    const parsed = parseBattleSummary(checkpoint.target);
    if (parsed) {
      goal.type = "tileRemoved";
      goal.floorId = parsed.floorId;
      goal.x = parsed.x;
      goal.y = parsed.y;
      goal.removedTiles = [
        { floorId: parsed.floorId, x: parsed.x, y: parsed.y },
      ];
    }
  }

  const milestone = {
    id,
    label:
      checkpoint.type === "entered-floor"
        ? `Auto: enter ${checkpoint.floorId}`
        : checkpoint.type === "special-target-defeated"
          ? `Auto: defeat ${checkpoint.target}`
          : `Auto: score ${Math.round((checkpoint.score || 0) / 1000000)}M`,
    goal,
    actionPolicy: {
      actionKinds: [
        "battle",
        "pickup",
        "equip",
        "openDoor",
        "useTool",
        "changeFloor",
        "event",
      ],
      forbidUnsupportedEvents: true,
    },
    dp: {
      keyMode: "location",
      stopOnFirstGoal: false,
      goalSkylineLimit: 16,
      dpSkylineMax: 3,
      maxExpansions: 8000,
      maxRuntimeMs: 15000,
    },
    _meta: {
      generatedBy: "progressive-monster-planner",
      checkpointType: checkpoint.type,
      candidateId: checkpoint.candidateId,
    },
  };

  return milestone;
}

// =========================================================================
// Validation — each milestone validated independently from same start
// =========================================================================

function validateMilestones(
  simulator,
  initialState,
  candidateMilestones,
  config,
) {
  const results = [];

  for (const milestone of candidateMilestones) {
    const spec = {
      routeName: "auto-validated",
      milestones: [milestone],
    };

    const result = runMilestoneGraph(simulator, initialState, spec, {
      candidateLimit: config.candidateLimit || 16,
      dpKeyMode: config.dpKeyMode || "location",
      maxExpansions: config.maxExpansions || 4000,
      maxRuntimeMs: config.maxRuntimeMs || 10000,
      stopOnFirstGoal: false,
      preserveSkylineRoles: true,
      dpSkylineMax: config.dpSkylineMax || 3,
      goalSkylineLimit: config.goalSkylineLimit || 16,
    });

    const doctor = result.found ? null : buildSolverDoctorReport(result);
    results.push({
      milestoneId: milestone.id,
      label: milestone.label,
      found: result.found,
      doctor: doctor
        ? {
            line: doctor.line,
            failureClass: doctor.failureClass,
            deficitDetail: doctor.deficitDetail,
          }
        : null,
      candidateCount: result.finalCandidates
        ? result.finalCandidates.length
        : 0,
      goalSummary: milestone.goal,
    });
  }

  return results;
}

// =========================================================================
// Main
// =========================================================================

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(
    args["project-root"] || DEFAULT_PROJECT_ROOT,
  );
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const routeName = args["route-name"] || "onlyup-chaos-mt5-blueking";
  const spec = getMilestoneSpec(project, routeName);

  // --- Resolve start state ---
  let initialState;
  const startRoute = args["start-route"]
    ? path.resolve(args["start-route"])
    : null;
  if (startRoute) {
    initialState = replayRouteFile(simulator, startRoute);
  } else if (args["from"]) {
    const reachResult = runMilestoneGraph(
      simulator,
      simulator.createInitialState({ rank: "chaos" }),
      spec,
      {
        fromMilestoneId: null,
        toMilestoneId: args["from"],
        candidateLimit: 8,
        maxRuntimeMs: 30000,
      },
    );
    if (!reachResult.found || !reachResult.finalCandidate) {
      console.error(`Cannot reach milestone ${args["from"]}`);
      process.exit(1);
    }
    initialState = reachResult.finalCandidate.state;
  } else {
    initialState = simulator.createInitialState({ rank: "chaos" });
  }

  // --- Resolve target floor ---
  let targetFloorId = null;
  if (args["to"]) {
    const toMilestone = getMilestoneById(project, routeName, args["to"]);
    if (toMilestone && toMilestone.goal && toMilestone.goal.floorId) {
      targetFloorId = toMilestone.goal.floorId;
    }
  }

  // --- Derive allowed floors ---
  const userAllowed = args["allowed-floors"]
    ? String(args["allowed-floors"])
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  const derivedFloors = deriveFloorRange(
    project,
    routeName,
    args["from"],
    args["to"],
  );
  const allowedFloors = userAllowed || derivedFloors;

  if (!allowedFloors && parseBoolean(args["require-allowed-floors"], true)) {
    console.error("Cannot derive allowed floors from from/to milestones.");
    console.error(
      "Pass --allowed-floors=MT5,MT6,MT7 or set --require-allowed-floors=0 to scan all floors.",
    );
    process.exit(1);
  }

  console.log(`=== Progressive Planner → Milestone Suggestion (v2) ===`);
  console.log(`From: ${args["from"] || "start"}, To: ${args["to"] || "auto"}`);
  console.log(`Target floor: ${targetFloorId || "auto-detect"}`);
  console.log(
    `Allowed floors: ${allowedFloors ? allowedFloors.join(",") : "all"}`,
  );
  console.log(
    `Start state floor: ${initialState.floorId}, HP: ${(initialState.hero || {}).hp}\n`,
  );

  // --- Run progressive planner ---
  const plannerResult = runProgressiveMonsterPlanner(simulator, initialState, {
    maxRounds: optionalNumber(args["planner-rounds"]) || 50,
    beamWidth: optionalNumber(args["planner-beam"]) || 16,
    maxTargetsPerState: optionalNumber(args["planner-targets"]) || 12,
    maxSuccessorsPerTarget: optionalNumber(args["planner-successors"]) || 2,
    maxRuntimeMs: optionalNumber(args["planner-runtime-ms"]) || 60000,
    targetFloorId,
    allowedFloors: allowedFloors || undefined,
    specialTargets: args["special-targets"]
      ? String(args["special-targets"])
          .split(",")
          .map((s) => s.trim())
      : [],
  });

  console.log(
    `Planner: found=${plannerResult.found}, stopped=${plannerResult.diagnostics.stoppedReason}`,
  );
  console.log(
    `  rounds=${plannerResult.diagnostics.rounds}, states=${plannerResult.diagnostics.statesExpanded}`,
  );
  console.log(`  checkpoints=${plannerResult.checkpoints.length}\n`);

  // --- Convert checkpoints to candidate milestones ---
  const existingMilestoneIds = new Set(
    (spec.milestones || []).map((m) => m.id),
  );
  const candidateMilestones = [];

  plannerResult.checkpoints.forEach((checkpoint) => {
    const milestone = checkpointToMilestone(checkpoint, existingMilestoneIds);
    candidateMilestones.push(milestone);
  });

  console.log(`Generated ${candidateMilestones.length} candidate milestones:`);
  candidateMilestones.forEach((milestone) => {
    console.log(`  - ${milestone.id}: ${milestone.label}`);
    if (milestone.goal.floorId)
      console.log(`    floorId=${milestone.goal.floorId}`);
    if (milestone.goal.type) console.log(`    type=${milestone.goal.type}`);
    if (milestone.goal.removedTiles) {
      milestone.goal.removedTiles.forEach((t) =>
        console.log(`    removedTiles: ${t.floorId}:${t.x},${t.y}`),
      );
    }
    const h = milestone.goal.minHero || {};
    const eh = milestone.goal.minEffectiveHero || {};
    const parts = [];
    if (h.hp) parts.push(`hp>=${h.hp}`);
    if (h.atk) parts.push(`atk>=${h.atk}`);
    if (h.def) parts.push(`def>=${h.def}`);
    if (h.mdef) parts.push(`mdef>=${h.mdef}`);
    if (h.lv) parts.push(`lv>=${h.lv}`);
    if (h.exp) parts.push(`exp>=${h.exp}`);
    if (Object.keys(eh).length > 0) parts.push(`eff:${JSON.stringify(eh)}`);
    if (parts.length > 0) console.log(`    ${parts.join(", ")}`);
  });

  // --- Optionally validate with segment DP ---
  let validation = null;
  if (parseBoolean(args["validate"], false) && candidateMilestones.length > 0) {
    console.log(
      `\n=== Validating with segment DP (conservative, independent) ===`,
    );
    validation = validateMilestones(
      simulator,
      initialState,
      candidateMilestones,
      {
        candidateLimit: optionalNumber(args["candidate-limit"]) || 16,
        dpKeyMode: args["dp-key-mode"] || "location",
        maxExpansions: optionalNumber(args["max-expansions"]) || 4000,
        maxRuntimeMs: optionalNumber(args["max-runtime-ms"]) || 10000,
        preserveSkylineRoles: true,
        dpSkylineMax: optionalNumber(args["dp-skyline-max"]) || 3,
        goalSkylineLimit: optionalNumber(args["goal-skyline-limit"]) || 16,
      },
    );

    let passed = 0;
    let failed = 0;
    validation.forEach((result) => {
      if (result.found) {
        passed++;
        console.log(
          `  ✓ ${result.milestoneId}: passed (${result.candidateCount} candidates)`,
        );
      } else {
        failed++;
        console.log(`  ✗ ${result.milestoneId}: FAILED`);
        if (result.doctor) console.log(`    ${result.doctor.line}`);
      }
    });
    console.log(`\n  Passed: ${passed}, Failed: ${failed}`);
  }

  // --- Write output ---
  const out = args.out ? path.resolve(args.out) : null;
  if (out) {
    const output = {
      generatedBy: "progressive-to-milestone-v2",
      timestamp: new Date().toISOString(),
      fromMilestone: args["from"] || "start",
      toMilestone: args["to"] || "auto",
      allowedFloors: allowedFloors || [],
      plannerDiagnostics: plannerResult.diagnostics,
      candidateMilestones,
      bestRoute: plannerResult.bestRoute || [],
      validation: validation || undefined,
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(output, null, 2), "utf8");
    console.log(`\nOutput written: ${out}`);
  }
}

main();
