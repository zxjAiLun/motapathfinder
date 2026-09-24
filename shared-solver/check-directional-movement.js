"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { cloneState, removeTileAt } = require("./lib/state");
const { buildReachability, canTraverseEdge } = require("./lib/reachability");
const { stepOntoTile } = require("./lib/step-simulator");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "directional-movement-"));
try {
  const dir = path.join(temp, "project");
  fs.mkdirSync(path.join(dir, "floors"), { recursive: true });
  const hero = { hp: 100, atk: 10, def: 10, lv: 1, loc: { x: 3, y: 0, direction: "left" } };
  for (const [name, value] of Object.entries({
    data: { main: { floorIds: ["K"] }, firstData: { floorId: "K", hero, levelUp: [] }, flags: {}, values: {} },
    maps: { 1: { cls: "items", id: "potion" }, 2: { cls: "terrains", id: "arrowRight", canPass: true, cannotOut: ["up", "down", "left"], cannotIn: ["right"] } },
    items: { potion: { cls: "items", itemEffect: "core.status.hero.hp += 25600" } },
    enemys: {}, icons: {}, functions: {}, events: { commonEvent: {} },
  })) fs.writeFileSync(path.join(dir, `${name}.js`), `var ${name}_test = ${JSON.stringify(value)};`);
  const floor = { floorId: "K", title: "K", width: 4, height: 1, map: [[1, 0, 2, 0]], events: {}, firstArrive: [], eachArrive: [], afterBattle: {}, autoEvent: {}, changeFloor: {} };
  fs.writeFileSync(path.join(dir, "floors/K.js"), `main.floors.K = ${JSON.stringify(floor)};`);
  const project = loadProject(temp);
  const sim = new StaticSimulator(project, { autoPickupEnabled: true, autoBattleEnabled: false });
  const state = sim.createInitialState();
  assert.equal(state.hero.hp, 100, "automatic pickup must not cross the reverse arrow");
  assert.equal(canTraverseEdge(project, state, "K", 3, 0, "left"), false, "cannotIn uses opposite direction");
  assert.equal(canTraverseEdge(project, state, "K", 1, 0, "right"), true);
  assert.equal(canTraverseEdge(project, state, "K", 2, 0, "left"), false, "source cannotOut");
  assert.equal(canTraverseEdge(project, state, "K", 2, 0, "right"), true);
  assert.equal(stepOntoTile(project, state, "left", {}, new Map()), null, "direct transit must reject forbidden edge before hazards");
  assert.equal(buildReachability(project, state).visited["0,0"], undefined);
  for (const mode of ["safe-fast", "legacy-exact"]) {
    const walker = new StaticSimulator(project, { autoPickupEnabled: false, autoBattleEnabled: false, walkReachabilityMode: mode });
    const reach = walker.getWalkReachability(state);
    assert.deepEqual([...new Set(Object.values(reach.visited).map(n => n.x))], [3], mode);
    assert.equal(walker.enumeratePrimitiveActions(state).actions.some(a => a.kind === "pickup"), false, "adjacent actions must respect directed approach");
  }
  const removed = cloneState(state);
  removeTileAt(removed, "K", 2, 0);
  assert.ok(canTraverseEdge(project, removed, "K", 3, 0, "left"), "removed arrow must no longer restrict movement");
  assert.equal(sim.stabilizeState(removed).hero.hp, 25700, "accessible supply still collected");
  project.floorsById.K.cannotMove = { "3,0": ["left"] };
  assert.equal(canTraverseEdge(project, removed, "K", 3, 0, "left"), false);
  project.floorsById.K.cannotMove = {};
  project.floorsById.K.cannotMoveIn = { "2,0": ["right"] };
  assert.equal(canTraverseEdge(project, removed, "K", 3, 0, "left"), false);
  project.floorsById.K.cannotMoveIn = {};
  // A failed right-side approach must not mark a tile visited and suppress a
  // later legal approach from the left in the same flood-fill.
  project.floorsById.K.height = 2;
  project.floorsById.K.map.push([0, 0, 0, 0]);
  const around = buildReachability(project, state);
  assert.ok(around.visited["2,0"]);
  assert.equal(around.visited["2,0"].direction, "up");
  assert.ok(around.visited["0,0"]);
  console.log("directional movement PASS: cannotIn/out, floor restrictions, removed tile, alternate approach, automatic pickup, safe/exact walking and primitive actions");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
