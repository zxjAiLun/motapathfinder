"use strict";

/**
 * Progressive Planner → Milestone Suggestion Bridge
 *
 * 用法:
 *   node shared-solver/check-progressive-to-milestone.js \
 *     --from=milestone-id --to=milestone-id \
 *     [--project-root=PATH] [--route-name=NAME] [--out=OUTPUT.json]
 *
 * 功能:
 *   1. 运行 progressive monster planner 自动探索前进路径
 *   2. 从探索结果中提取 checkpoint（楼层切换、特殊目标击败、最佳得分）
 *   3. 将 checkpoint 转换为 candidate milestone 建议
 *   4. 输出候选 milestone JSON，可直接或被调整后喂给 segment DP
 */

const path = require("node:path");
const fs = require("node:fs");

const { runProgressiveMonsterPlanner } = require("./lib/progressive-monster-planner");
const { getMilestoneSpec, getMilestoneById } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { buildRouteRecord, writeRouteFile } = require("./lib/route-store");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

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

function replayRouteFile(simulator, routeFile) {
  const { readRouteFile } = require("./lib/route-store");
  let state = simulator.createInitialState({ rank: "chaos" });
  const record = readRouteFile(routeFile);
  for (const decision of record.decisions || []) {
    const actions = [];
    try {
      actions.push(...(simulator.enumeratePrimitiveActions(state).actions || []));
    } catch (e) { /* ignore */ }
    const action = actions.find((a) => a.summary === decision.summary);
    if (!action) throw new Error(`Cannot replay action at ${decision.index}: ${decision.summary}`);
    if (Object.prototype.hasOwnProperty.call(state, "routeTrace")) delete state.routeTrace;
    state = simulator.applyAction(state, action);
  }
  return state;
}

/**
 * Convert a progressive planner checkpoint into a candidate milestone entry.
 */
function checkpointToMilestone(checkpoint, floorOrder, existingMilestoneIds) {
  const baseId = checkpoint.type === "entered-floor"
    ? `auto-floor-${checkpoint.floorId}`
    : checkpoint.type === "special-target-defeated"
      ? `auto-target-${sanitizeId(checkpoint.target)}`
      : `auto-score-${Math.round(checkpoint.score / 1000000)}M`;

  // Ensure unique ID
  let id = baseId;
  let counter = 1;
  while (existingMilestoneIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter++;
  }
  existingMilestoneIds.add(id);

  const milestone = {
    id,
    label: checkpoint.type === "entered-floor"
      ? `Auto: enter ${checkpoint.floorId}`
      : checkpoint.type === "special-target-defeated"
        ? `Auto: defeat ${checkpoint.target}`
        : `Auto: score ${Math.round(checkpoint.score / 1000000)}M`,
    goal: {
      floorId: checkpoint.floorId || undefined,
      minHero: {
        hp: checkpoint.hero ? checkpoint.hero.hp : undefined,
        atk: checkpoint.hero ? checkpoint.hero.atk : undefined,
        def: checkpoint.hero ? checkpoint.hero.def : undefined,
      },
    },
    actionPolicy: {
      actionKinds: ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "event"],
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

  // For entered-floor checkpoints, add a softer goal
  if (checkpoint.type === "entered-floor") {
    milestone.goal.floorId = checkpoint.floorId;
  }

  return milestone;
}

function sanitizeId(text) {
  return String(text || "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60);
}

/**
 * Validate candidate milestones by running segment DP on each.
 * Returns which ones are feasible.
 */
function validateMilestones(simulator, initialState, candidateMilestones, config) {
  const results = [];
  let frontierState = initialState;

  for (const milestone of candidateMilestones) {
    const spec = {
      routeName: "auto-validated",
      milestones: [milestone],
    };

    const result = runMilestoneGraph(simulator, frontierState, spec, {
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
      milestone,
      found: result.found,
      doctor: doctor ? doctor.line : null,
      candidateCount: result.finalCandidates ? result.finalCandidates.length : 0,
    });

    if (result.found && result.finalCandidate && result.finalCandidate.state) {
      frontierState = result.finalCandidate.state;
    } else {
      // Stop validating further milestones if this one failed
      break;
    }
  }

  return results;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const routeName = args["route-name"] || "onlyup-chaos-mt5-blueking";
  const spec = getMilestoneSpec(project, routeName);

  // Determine start state from a known milestone or start route
  let initialState;
  const startRoute = args["start-route"] ? path.resolve(args["start-route"]) : null;
  if (startRoute) {
    initialState = replayRouteFile(simulator, startRoute);
  } else if (args["from"]) {
    const fromMilestone = getMilestoneById(project, routeName, args["from"]);
    if (!fromMilestone) {
      console.error(`Unknown milestone: ${args["from"]}`);
      process.exit(1);
    }
    // Run segment DP to reach this milestone, then use its best state
    const reachResult = runMilestoneGraph(simulator,
      simulator.createInitialState({ rank: "chaos" }),
      spec,
      {
        fromMilestoneId: null,
        toMilestoneId: args["from"],
        candidateLimit: 8,
        maxRuntimeMs: 30000,
      }
    );
    if (!reachResult.found || !reachResult.finalCandidate) {
      console.error(`Cannot reach milestone ${args["from"]}`);
      process.exit(1);
    }
    initialState = reachResult.finalCandidate.state;
  } else {
    initialState = simulator.createInitialState({ rank: "chaos" });
  }

  // Determine target floor from "to" milestone
  let targetFloorId = null;
  if (args["to"]) {
    const toMilestone = getMilestoneById(project, routeName, args["to"]);
    if (toMilestone && toMilestone.goal && toMilestone.goal.floorId) {
      targetFloorId = toMilestone.goal.floorId;
    }
  }

  console.log(`=== Progressive Planner → Milestone Suggestion ===`);
  console.log(`From: ${args["from"] || "start"}, To: ${args["to"] || "auto"}`);
  console.log(`Target floor: ${targetFloorId || "auto-detect"}`);
  console.log(`Start state floor: ${initialState.floorId}, HP: ${(initialState.hero || {}).hp}\n`);

  // Run progressive planner
  const plannerResult = runProgressiveMonsterPlanner(simulator, initialState, {
    maxRounds: optionalNumber(args["planner-rounds"]) || 50,
    beamWidth: optionalNumber(args["planner-beam"]) || 16,
    maxTargetsPerState: optionalNumber(args["planner-targets"]) || 12,
    maxSuccessorsPerTarget: optionalNumber(args["planner-successors"]) || 2,
    maxRuntimeMs: optionalNumber(args["planner-runtime-ms"]) || 60000,
    targetFloorId,
    allowedFloors: args["allowed-floors"]
      ? String(args["allowed-floors"]).split(",").map((s) => s.trim())
      : undefined,
    specialTargets: args["special-targets"]
      ? String(args["special-targets"]).split(",").map((s) => s.trim())
      : [],
  });

  console.log(`Planner: found=${plannerResult.found}, stopped=${plannerResult.diagnostics.stoppedReason}`);
  console.log(`  rounds=${plannerResult.diagnostics.rounds}, states=${plannerResult.diagnostics.statesExpanded}`);
  console.log(`  checkpoints=${plannerResult.checkpoints.length}\n`);

  // Extract checkpoints
  const floorOrder = project.floorOrder || [];
  const existingMilestoneIds = new Set((spec.milestones || []).map((m) => m.id));
  const candidateMilestones = [];

  plannerResult.checkpoints.forEach((checkpoint) => {
    const milestone = checkpointToMilestone(checkpoint, floorOrder, existingMilestoneIds);
    candidateMilestones.push(milestone);
  });

  console.log(`Generated ${candidateMilestones.length} candidate milestones:`);
  candidateMilestones.forEach((milestone) => {
    console.log(`  - ${milestone.id}: ${milestone.label}`);
    if (milestone.goal.floorId) console.log(`    floorId=${milestone.goal.floorId}`);
    if (milestone.goal.minHero) {
      const h = milestone.goal.minHero;
      const parts = [];
      if (h.hp) parts.push(`hp>=${h.hp}`);
      if (h.atk) parts.push(`atk>=${h.atk}`);
      if (h.def) parts.push(`def>=${h.def}`);
      if (parts.length > 0) console.log(`    ${parts.join(", ")}`);
    }
  });

  // Optionally validate with segment DP
  if (parseBoolean(args["validate"], false) && candidateMilestones.length > 0) {
    console.log(`\n=== Validating with segment DP (conservative card-HP mode) ===`);
    const validation = validateMilestones(simulator, initialState, candidateMilestones, {
      candidateLimit: optionalNumber(args["candidate-limit"]) || 16,
      dpKeyMode: args["dp-key-mode"] || "location",
      maxExpansions: optionalNumber(args["max-expansions"]) || 4000,
      maxRuntimeMs: optionalNumber(args["max-runtime-ms"]) || 10000,
      preserveSkylineRoles: true,
      dpSkylineMax: optionalNumber(args["dp-skyline-max"]) || 3,
      goalSkylineLimit: optionalNumber(args["goal-skyline-limit"]) || 16,
    });

    let passed = 0;
    let failed = 0;
    validation.forEach((result) => {
      if (result.found) {
        passed++;
        console.log(`  ✓ ${result.milestone.id}: passed (${result.candidateCount} candidates)`);
      } else {
        failed++;
        console.log(`  ✗ ${result.milestone.id}: FAILED`);
        if (result.doctor) console.log(`    ${result.doctor}`);
      }
    });
    console.log(`\n  Passed: ${passed}, Failed: ${failed}`);
  }

  // Write output
  const out = args.out ? path.resolve(args.out) : null;
  if (out) {
    const output = {
      generatedBy: "progressive-to-milestone",
      timestamp: new Date().toISOString(),
      fromMilestone: args["from"] || "start",
      toMilestone: args["to"] || "auto",
      plannerDiagnostics: plannerResult.diagnostics,
      candidateMilestones,
      bestRoute: plannerResult.bestRoute || [],
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(output, null, 2), "utf8");
    console.log(`\nOutput written: ${out}`);
  }
}

main();
