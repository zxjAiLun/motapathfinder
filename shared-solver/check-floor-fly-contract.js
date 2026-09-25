"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP } = require("./lib/dp-search");

console.log("Running check-floor-fly-contract...");

let projectPath = null;
if (fs.existsSync(path.resolve(__dirname, "../tower/project/floors/TS11.js"))) {
  projectPath = path.resolve(__dirname, "../tower");
} else if (fs.existsSync(path.resolve(__dirname, "../neko591"))) {
  const projectDir = fs.readdirSync(path.resolve(__dirname, "../neko591")).find((n) =>
    fs.existsSync(path.resolve(__dirname, "../neko591", n, "project/floors/TS11.js"))
  );
  if (projectDir) projectPath = path.resolve(__dirname, "../neko591", projectDir);
}
assert.ok(projectPath, "tower project directory found with TS11");
const project = loadProject(projectPath);

const config = {
  allowedFloors: ["TS11", "TS12", "TS13", "TS14", "TS15"],
  protectedItems: ["greenKey"],
  protectedSpendLimits: { greenKey: 1 },
  includeFloorFly: true,
};

const sim = new StaticSimulator(project, config);

// Test 1: Verify canUseFloorFly is NOT globally blocked by E1649 on K15
const testState = {
  floorId: "TS15",
  hero: { hp: 1000, atk: 10, def: 0, lv: 1, exp: 0, loc: { x: 6, y: 0, direction: "up" }, equipment: [] },
  inventory: { greenKey: 30, fly: 1 },
  flags: { __leaveLoc__: { TS11: { x: 6, y: 12, direction: "down" }, TS14: { x: 6, y: 0, direction: "up" } } },
  visitedFloors: { TS11: true, TS14: true, TS15: true },
  floorStates: {},
};

const flyActions = sim.enumerateFloorFlyActions(testState);
console.log("Emitted fly action summaries:", flyActions.map((a) => a.summary));
assert.ok(flyActions.length > 0, "Floor fly actions must be generated when hero has fly: 1");
assert.ok(flyActions.some((a) => a.targetFloorId === "TS11"), "Must include fly to TS11");
assert.ok(flyActions.some((a) => a.targetFloorId === "TS14"), "Must include fly to TS14");
assert.ok(!flyActions.some((a) => a.targetFloorId === "TS15"), "Must not fly to current floor");

// Deduplication check: at most one action per target floor
const targetCounts = flyActions.reduce((acc, a) => {
  acc[a.targetFloorId] = (acc[a.targetFloorId] || 0) + 1;
  return acc;
}, {});
for (const [targetFloor, count] of Object.entries(targetCounts)) {
  assert.equal(count, 1, `Target floor ${targetFloor} must have exactly 1 deduplicated fly action`);
}

// Test 2: Hero without fly tool cannot fly
const noFlyState = structuredClone(testState);
noFlyState.inventory.fly = 0;
const noFlyActions = sim.enumerateFloorFlyActions(noFlyState);
assert.equal(noFlyActions.length, 0, "Hero without fly item must generate 0 fly actions");

// Test 3: applyFloorFlyAction transitions hero correctly
const flyTo11Action = flyActions.find((a) => a.targetFloorId === "TS11");
const stateAfterFly = sim.applyFloorFlyAction(structuredClone(testState), flyTo11Action);
assert.equal(stateAfterFly.floorId, "TS11", "Floor must be TS11 after flying");
assert.equal(stateAfterFly.hero.loc.x, 6, "Hero x must match TS11 leaveLoc");
assert.equal(stateAfterFly.hero.loc.y, 12, "Hero y must match TS11 leaveLoc");
assert.ok(stateAfterFly.flags.__leaveLoc__.TS15, "TS15 leave location must be recorded upon flight");

// Test 4: dp-search integration with includeFloorFly: true
const dpResult = searchDP(sim, testState, {
  includeFloorFly: true,
  maxExpansions: 20,
  maxRuntimeMs: 5000,
  goalPredicate: (s) => s.floorId === "TS11",
  stopOnFirstGoal: true,
});
console.log("dp-search with includeFloorFly result:", {
  foundGoal: dpResult.foundGoal,
  expansions: dpResult.expansions,
});
assert.ok(dpResult.foundGoal, "dp-search with includeFloorFly must reach TS11 goal via floorFly");

// Test 5: dp-search with includeFloorFly: false does not reach TS11 within 20 expansions
const dpResultOff = searchDP(sim, testState, {
  includeFloorFly: false,
  maxExpansions: 20,
  maxRuntimeMs: 5000,
  goalPredicate: (s) => s.floorId === "TS11",
  stopOnFirstGoal: true,
});
assert.ok(!dpResultOff.foundGoal, "dp-search with includeFloorFly:false cannot reach TS11 via flight");

console.log("check-floor-fly-contract: ALL PASS");
