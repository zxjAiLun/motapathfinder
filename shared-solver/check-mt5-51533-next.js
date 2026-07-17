"use strict";

const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { runMilestoneGraph } = require("./lib/segment-dp");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");
const { StaticSimulator } = require("./lib/simulator");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const SEED_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "window-repair-mt5.route.json",
);
const ROUTE_NAME = "onlyup-mt5-51533-next";
const TARGET_MILESTONE = "mt5-i894-equipped-from-51533";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
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
    actions.push(...(simulator.enumerateActions(state) || []));
  } catch (error) {
    /* ignore */
  }
  try {
    actions.push(...((simulator.enumeratePrimitiveActions(state) || {}).actions || []));
  } catch (error) {
    /* ignore */
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      actions.push(...(simulator.enumerateInteractPickupActions(state) || []));
    }
  } catch (error) {
    /* ignore */
  }
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      actions.push(...(simulator.enumerateFloorFlyActions(state) || []));
    }
  } catch (error) {
    /* ignore */
  }
  return actions.find((action) => action && action.summary === summary) || null;
}

function replayRoute(simulator, routeRecord) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of routeRecord.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    assert(action, `seed route replay failed at #${decision.index}: ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function checkSeedRouteReplay(project, simulator) {
  const route = readRouteFile(SEED_ROUTE);
  assert(route.decisions.length === 80, `expected 80 seed decisions, got ${route.decisions.length}`);
  const state = replayRoute(simulator, route);
  const hero = state.hero || {};
  assert(state.floorId === "MT5", `expected final floor MT5, got ${state.floorId}`);
  assert(hero.hp === 51533, `expected final hp 51533, got ${hero.hp}`);
  assert(hero.atk === 1097, `expected atk 1097, got ${hero.atk}`);
  assert(hero.def === 915, `expected def 915, got ${hero.def}`);
  assert(hero.mdef === 6310, `expected mdef 6310, got ${hero.mdef}`);
  assert(Array.isArray(hero.equipment) && hero.equipment.includes("I893"), "expected I893 equipped");
  assert(hero.loc && hero.loc.x === 6 && hero.loc.y === 12, `expected loc 6,12, got ${JSON.stringify(hero.loc)}`);
  assert(project.floorsById[state.floorId], "final floor must exist in project");
  return state;
}

function checkMilestoneSpec(project) {
  const spec = getMilestoneSpec(project, ROUTE_NAME);
  assert(spec.routeName === ROUTE_NAME, `unexpected routeName ${spec.routeName}`);
  assert(spec.milestones.length === 1, `expected one milestone, got ${spec.milestones.length}`);
  const milestone = spec.milestones[0];
  assert(milestone.id === TARGET_MILESTONE, `unexpected final milestone ${milestone.id}`);
  assert(milestone.goal.floorId === "MT5", "target floor must be MT5");
  assert((milestone.goal.equipmentIncludes || []).includes("I894"), "target must require I894");
  assert((milestone.goal.removedTiles || []).length === 4, "target must keep four required removed tiles");
  assert((milestone.goal.presentTiles || []).length === 4, "target must preserve four downstream tiles");
  assert((milestone.goal.minEffectiveHero || {}).atk === 2075, "target must require I894 effective atk");
  assert((milestone.actionPolicy.allowedFloors || []).join(",") === "MT5", "target action policy must stay on MT5");
  assert((milestone.actionPolicy.allowChangeFloors || []).includes("MT5:6,12"), "target must allow the MT5 stair action");
  assert(milestone.dp.keyMode === "location", "target dp keyMode must be location");
  assert(milestone.dp.stopOnFirstGoal === false, "target dp must keep goal skyline");
  return spec;
}

function checkSegmentedSmoke(simulator, startState, spec) {
  const result = runMilestoneGraph(simulator, startState, spec, {
    toMilestoneId: TARGET_MILESTONE,
    candidateLimit: 2,
    goalSkylineLimit: 2,
    dpSkylineMax: 2,
    preserveSkylineRoles: true,
    maxExpansions: 1,
    maxRuntimeMs: 100,
  });
  assert(result.segmentResults.length === 1, `expected one segment result, got ${result.segmentResults.length}`);
  const milestoneIds = new Set((spec.milestones || []).map((milestone) => milestone.id));
  assert(
    result.found || (result.failedSegment && milestoneIds.has(result.failedSegment.segmentId)),
    "smoke must either find target or fail with target diagnostics",
  );
  if (!result.found) {
    const doctor = buildSolverDoctorReport(result);
    assert(milestoneIds.has(doctor.failedSegmentId), `unexpected doctor segment ${doctor.failedSegmentId}`);
    assert(doctor.failureClass, "doctor must classify the smoke failure");
  }
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const seedFinalState = checkSeedRouteReplay(project, simulator);
  const spec = checkMilestoneSpec(project);
  checkSegmentedSmoke(simulator, seedFinalState, spec);
  console.log("check-mt5-51533-next: ok");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
