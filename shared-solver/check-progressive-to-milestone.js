"use strict";

/**
 * Progressive Planner → Milestone Suggestion Bridge (v4)
 *
 * Changes from v3:
 *  - Special target priority pushed down into reach-and-battle-oracle
 *    (before internal targets.sort + slice, not after return)
 *  - Per-pattern SpecialTargetTracker: only stop when ALL required patterns defeated
 *  - inferSpecialTargetsFromMilestone() resolves enemyId from project tile data
 *  - assertTileRemovalGoalPresent checks each inferred target individually
 *  - Archive diagnostics: specialTargetGenerated/Accepted/RejectedByArchive
 */

const path = require("node:path");
const fs = require("node:fs");

const {
  runProgressiveMonsterPlanner,
} = require("./lib/progressive-monster-planner");
const { getMilestoneSpec, getMilestoneById } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
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
// Milestone ordering check
// =========================================================================

function milestoneIndexOf(milestones, milestoneId) {
  return milestones.findIndex((m) => m.id === milestoneId);
}

function checkMilestoneOrder(milestones, fromId, toId) {
  if (!fromId || !toId) return null;
  const fromIdx = milestoneIndexOf(milestones, fromId);
  const toIdx = milestoneIndexOf(milestones, toId);
  if (fromIdx < 0) return `Unknown --from milestone: ${fromId}`;
  if (toIdx < 0) return `Unknown --to milestone: ${toId}`;
  if (fromIdx >= toIdx)
    return `Invalid order: --from=${fromId} (index ${fromIdx}) must appear before --to=${toId} (index ${toIdx}) in the milestone route`;
  return null;
}

// =========================================================================
// Floor range derivation
// =========================================================================

function deriveFloorRange(project, routeName, fromMilestoneId, toMilestoneId) {
  const spec = getMilestoneSpec(project, routeName);
  const milestones = spec.milestones || [];
  const floorOrder = project.floorOrder || [];

  const fromIndex = fromMilestoneId
    ? milestoneIndexOf(milestones, fromMilestoneId)
    : -1;
  const toIndex = toMilestoneId
    ? milestoneIndexOf(milestones, toMilestoneId)
    : -1;
  if (fromIndex < 0 && toIndex < 0) return null;

  const start = fromIndex >= 0 ? fromIndex : 0;
  const end = toIndex >= 0 ? toIndex : milestones.length - 1;
  const relevantFloorIds = new Set();

  for (let i = start; i <= end; i++) {
    const goal = (milestones[i] || {}).goal || {};
    if (goal.floorId) relevantFloorIds.add(goal.floorId);
  }

  if (relevantFloorIds.size === 0) return null;

  const ordered = floorOrder.filter((fid) => relevantFloorIds.has(fid));
  if (ordered.length > 0) {
    const minIdx = floorOrder.indexOf(ordered[0]);
    const maxIdx = floorOrder.indexOf(ordered[ordered.length - 1]);
    if (minIdx >= 0 && maxIdx >= 0) return floorOrder.slice(minIdx, maxIdx + 1);
  }

  return [...relevantFloorIds];
}

// =========================================================================
// Special target inference from milestone goal
// =========================================================================

function parseBattleSummary(summary) {
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

/**
 * Extract battle target summaries from a milestone's goal definition.
 * Sources checked (in order):
 *  1. goal.actionSurvivable.summary  (exact, e.g. "battle:poisonZombie@MT7:1,11")
 *  2. goal.type === "tileRemoved"   → looks up enemy at floor:x,y, generates exact summary
 *  3. goal.removedTiles[]           → looks up enemy at each tile, generates exact summaries
 *
 * When the enemyId can be determined from project data, generates exact battle summary.
 * Falls back to wildcard "battle:*@floor:x,y" only if the tile lookup fails.
 *
 * Returns deduplicated array of battle summary strings.
 */
function inferSpecialTargetsFromMilestone(milestone, project) {
  if (!milestone || !milestone.goal) return [];
  const goal = milestone.goal;
  const targets = new Set();

  function addExactOrWildcard(floorId, x, y) {
    if (floorId == null || x == null || y == null) return;
    const enemyId = lookupEnemyAtTile(project, floorId, x, y);
    if (enemyId) {
      targets.add(`battle:${enemyId}@${floorId}:${x},${y}`);
    } else {
      targets.add(`battle:*@${floorId}:${x},${y}`);
    }
  }

  // Source 1: actionSurvivable.summary (already exact)
  if (goal.actionSurvivable && goal.actionSurvivable.summary) {
    const parsed = parseBattleSummary(goal.actionSurvivable.summary);
    if (parsed) targets.add(goal.actionSurvivable.summary);
  }

  // Source 2: type=tileRemoved on goal itself
  if (
    goal.type === "tileRemoved" &&
    goal.floorId != null &&
    goal.x != null &&
    goal.y != null
  ) {
    addExactOrWildcard(goal.floorId, goal.x, goal.y);
  }

  // Source 3: removedTiles array
  (goal.removedTiles || []).forEach((tile) => {
    if (tile && tile.floorId != null && tile.x != null && tile.y != null) {
      addExactOrWildcard(tile.floorId, tile.x, tile.y);
    }
  });

  return [...targets];
}

/** Look up the enemy ID at a given tile position in project data */
function lookupEnemyAtTile(project, floorId, x, y) {
  try {
    const floors = project.floorsById || {};
    const floor = floors[floorId];
    if (!floor || !floor.map) return null;
    const row = floor.map[y];
    if (!row || x >= row.length) return null;
    const tile = row[x];
    if (tile && tile.cls === "enemys" && tile.id) return tile.id;
    return null;
  } catch (e) {
    return null;
  }
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

  return {
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
}

// =========================================================================
// Validation — each milestone independently from same start state
// =========================================================================

function validateMilestones(
  simulator,
  initialState,
  candidateMilestones,
  config,
) {
  const results = [];
  for (const milestone of candidateMilestones) {
    const spec = { routeName: "auto-validated", milestones: [milestone] };
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
// Focused check: ensure special-target-derived milestone has tileRemoved
// =========================================================================

function assertTileRemovalGoalPresent(candidateMilestones, inferredTargets) {
  if (inferredTargets.length === 0) return true;

  // Collect all tileRemoval milestones' removedTiles into a set of "floorId:x,y" keys
  const removedKeys = new Set();
  candidateMilestones
    .filter(
      (m) =>
        m.goal &&
        m.goal.type === "tileRemoved" &&
        Array.isArray(m.goal.removedTiles) &&
        m.goal.removedTiles.length > 0,
    )
    .forEach((m) => {
      m.goal.removedTiles.forEach((tile) => {
        if (tile && tile.floorId != null && tile.x != null && tile.y != null) {
          removedKeys.add(`${tile.floorId}:${tile.x},${tile.y}`);
        }
      });
    });

  // Each inferred target should map to at least one removed location
  const missing = [];
  for (const target of inferredTargets) {
    const parsed = parseBattleSummary(target);
    if (!parsed) continue;
    const key = `${parsed.floorId}:${parsed.x},${parsed.y}`;
    if (!removedKeys.has(key)) missing.push(target);
  }

  if (missing.length === 0) return true;

  console.error("FOCUSED CHECK FAILED:");
  console.error(
    `  Inferred special targets: ${JSON.stringify(inferredTargets)}`,
  );
  console.error(
    `  Missing tileRemoval milestones for: ${JSON.stringify(missing)}`,
  );
  console.error(
    "  Planner did not produce checkpoints for all inferred targets.",
  );
  return false;
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

  // --- Check milestone order ---
  const orderError = checkMilestoneOrder(
    spec.milestones || [],
    args["from"],
    args["to"],
  );
  if (orderError) {
    console.error(orderError);
    process.exit(1);
  }

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

  // --- Resolve target floor and special targets ---
  let targetFloorId = null;
  const inferredTargets = [];
  if (args["to"]) {
    const toMilestone = getMilestoneById(project, routeName, args["to"]);
    if (toMilestone) {
      if (toMilestone.goal && toMilestone.goal.floorId) {
        targetFloorId = toMilestone.goal.floorId;
      }
      inferredTargets.push(
        ...inferSpecialTargetsFromMilestone(toMilestone, project),
      );
    }
  }

  // Merge with CLI special-targets (dedup)
  const cliTargets = args["special-targets"]
    ? String(args["special-targets"])
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const allSpecialTargets = [...new Set([...cliTargets, ...inferredTargets])];

  const hasInferredTargets = inferredTargets.length > 0;

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
      "Pass --allowed-floors=MT5,MT6,MT7 or set --require-allowed-floors=0.",
    );
    process.exit(1);
  }

  console.log(`=== Progressive Planner → Milestone Suggestion (v3) ===`);
  console.log(`From: ${args["from"] || "start"}, To: ${args["to"] || "auto"}`);
  console.log(`Target floor: ${targetFloorId || "auto-detect"}`);
  console.log(
    `Allowed floors: ${allowedFloors ? allowedFloors.join(",") : "all"}`,
  );
  console.log(
    `CLI special targets: ${cliTargets.length > 0 ? cliTargets.join(",") : "none"}`,
  );
  console.log(
    `Inferred special targets: ${inferredTargets.length > 0 ? inferredTargets.join(",") : "none"}`,
  );
  if (hasInferredTargets)
    console.log(
      `  (planner will continue past targetFloorId until special targets appear)`,
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
    // When inferred special targets exist, pass them AND suppress early stop at targetFloorId
    targetFloorId: hasInferredTargets ? null : targetFloorId,
    allowedFloors: allowedFloors || undefined,
    specialTargets: allSpecialTargets,
    noProgressRounds: optionalNumber(args["planner-no-progress"]) || 5,
  });

  console.log(
    `Planner: found=${plannerResult.found}, stopped=${plannerResult.diagnostics.stoppedReason}`,
  );
  console.log(
    `  rounds=${plannerResult.diagnostics.rounds}, states=${plannerResult.diagnostics.statesExpanded}`,
  );
  console.log(`  checkpoints=${plannerResult.checkpoints.length}`);
  const specCheckpoints = plannerResult.checkpoints.filter(
    (c) => c.type === "special-target-defeated",
  );
  console.log(`  special-target checkpoints: ${specCheckpoints.length}`);
  specCheckpoints.forEach((c) => console.log(`    - ${c.target}`));
  const stDiag = plannerResult.diagnostics.specialTargets;
  if (stDiag && stDiag.required && stDiag.required.length > 0) {
    console.log(`  special-target tracker:`);
    console.log(`    required: ${JSON.stringify(stDiag.required)}`);
    console.log(`    defeated: ${JSON.stringify(stDiag.defeated)}`);
    if (stDiag.missing && stDiag.missing.length > 0) {
      console.log(`    missing: ${JSON.stringify(stDiag.missing)}`);
    }
    const oracle = plannerResult.diagnostics.oracle || {};
    console.log(
      `    visible: ${oracle.specialTargetVisible || 0}, afterCap: ${oracle.specialTargetAfterCap || 0}, capDrops: ${oracle.specialTargetCapDrops || 0}`,
    );
    console.log(
      `    generated: ${plannerResult.diagnostics.specialTargetGenerated || 0}, accepted: ${plannerResult.diagnostics.specialTargetAccepted || 0}, rejectedByArchive: ${plannerResult.diagnostics.specialTargetRejectedByArchive || 0}`,
    );
  }
  const perf = plannerResult.diagnostics.perf;
  if (perf) {
    console.log(
      "  perf: fastPaths=" +
        (perf.currentFloorFastPaths || 0) +
        " portalSearches=" +
        (perf.portalFloorSearches || 0) +
        " reachCalls=" +
        (perf.totalReachabilityCalls || 0),
    );
    console.log(
      "  perf: floorMs=" +
        (perf.totalFloorMs || 0) +
        " reachMs=" +
        (perf.totalReachMs || 0) +
        " battleMs=" +
        (perf.totalBattleMs || 0),
    );
    if (perf.portalStatesExpanded > 0) {
      console.log(
        "  portal: statesExpanded=" +
          (perf.portalStatesExpanded || 0) +
          " actionsConsidered=" +
          (perf.portalActionsConsidered || 0) +
          " applyMs=" +
          (perf.portalApplyMs || 0),
      );
    }
  }
  console.log();

  // --- Convert checkpoints to candidate milestones ---
  const existingMilestoneIds = new Set(
    (spec.milestones || []).map((m) => m.id),
  );
  const candidateMilestones = plannerResult.checkpoints.map((cp) =>
    checkpointToMilestone(cp, existingMilestoneIds),
  );

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

  // --- Focused check ---
  if (hasInferredTargets) {
    const ok = assertTileRemovalGoalPresent(
      candidateMilestones,
      inferredTargets,
    );
    if (!ok) {
      console.error(
        "\nFOCUSED CHECK FAILED: No tileRemoval milestone for inferred special targets.",
      );
      console.error("The planner output may be incomplete.");
      process.exitCode = 1;
    } else {
      console.log(
        "\n✓ Focused check passed: tileRemoval milestone(s) present for inferred special targets.",
      );
    }
  }

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
      generatedBy: "progressive-to-milestone-v4",
      timestamp: new Date().toISOString(),
      fromMilestone: args["from"] || "start",
      toMilestone: args["to"] || "auto",
      allowedFloors: allowedFloors || [],
      cliSpecialTargets: cliTargets,
      inferredSpecialTargets: inferredTargets,
      allSpecialTargets,
      plannerDiagnostics: plannerResult.diagnostics,
      specialTargetDiagnostics:
        plannerResult.diagnostics.specialTargets || null,
      candidateMilestones,
      bestRoute: plannerResult.bestRoute || [],
      validation: validation || undefined,
      focusedCheck: hasInferredTargets
        ? {
            inferredTargets,
            tileRemovalMilestonesFound: candidateMilestones
              .filter(
                (m) =>
                  m.goal &&
                  m.goal.type === "tileRemoved" &&
                  Array.isArray(m.goal.removedTiles) &&
                  m.goal.removedTiles.length > 0,
              )
              .map((m) => m.id),
          }
        : undefined,
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(output, null, 2), "utf8");
    console.log(`\nOutput written: ${out}`);
  }
}

main();
