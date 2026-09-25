"use strict";

const assert = require("node:assert/strict");
const { StaticSimulator } = require("./lib/simulator");
const { searchDP, buildDpStateKey } = require("./lib/dp-search");
const { cloneState } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");
const { buildRouteRecord } = require("./lib/route-store");
const { createPerfTracker, getActivePerfTracker, setActivePerfTracker } = require("./lib/perf");

function makeContext(closePassage = false) {
  const floor = (id) => ({
    floorId: id, title: id, width: 3, height: 1, map: [[0, 0, 0]],
    events: {}, autoEvent: {}, firstArrive: [], eachArrive: [], changeFloor: {},
    canFlyFrom: true, canFlyTo: true, flyPoint: [0, 0],
  });
  const a = floor("A"), b = floor("B"), remote = floor("Remote");
  remote.map[0][1] = 2;
  if (closePassage) {
    a.autoEvent = { "1,0": { "0": {
      condition: "flag:got == 1", multiExecute: false,
      data: [{ type: "setBlock", number: "wall", loc: [1, 0] }],
    } } };
    b.eachArrive = [{ type: "setValue", name: "flag:got", value: "1" }];
  }
  const project = {
    root: __dirname,
    data: { firstData: { floorId: "A", hero: {
      hp: 100, atk: 1, def: 0, lv: 1, exp: 0, loc: { x: 0, y: 0, direction: "right" },
    }, levelUp: [] } },
    floorsById: { A: a, B: b, Remote: remote }, floorOrder: ["A", "B", "Remote"],
    mapTilesByNumber: {
      1: { id: "wall", cls: "terrains", noPass: true },
      2: { id: "E1649", cls: "enemys", noPass: true },
    },
    mapNumbersById: { wall: 1, E1649: 2 }, itemsById: {}, enemysById: {}, icons: {},
    defaultFlags: { flyRecordPosition: true }, values: {},
  };
  const sim = new StaticSimulator(project, {
    autoPickupEnabled: false, autoBattleEnabled: false, walkReachabilityMode: "safe-fast",
  });
  const state = sim.createInitialState();
  state.inventory.fly = 1;
  state.visitedFloors = { A: true, B: true };
  return { project, sim, state };
}

function checkDeparturesAndGuards() {
  const { sim, state } = makeContext();
  const actions = sim.enumerateFloorFlyActions(state);
  const left = actions.find((a) => a.stance.x === 0);
  const right = actions.find((a) => a.stance.x === 2);
  assert.ok(left && right, "different departure positions must survive target-floor deduplication");
  assert.ok(actions.every((a) => a.targetFloorId === "B"), "no self/unvisited-floor flights");
  const leftPost = sim.applyAction(state, left, { storeRoute: false });
  const rightPost = sim.applyAction(state, right, { storeRoute: false });
  assert.notEqual(buildStateKey(leftPost), buildStateKey(rightPost));
  assert.notEqual(buildDpStateKey(sim, leftPost), buildDpStateKey(sim, rightPost));
  assert.equal(sim.applyFloorFlyAction(cloneState(leftPost), { targetFloorId: "A" }).hero.loc.x, 0);
  assert.equal(sim.applyFloorFlyAction(cloneState(rightPost), { targetFloorId: "A" }).hero.loc.x, 2);

  const noFly = cloneState(state);
  delete noFly.inventory.fly;
  assert.deepEqual(sim.enumerateFloorFlyActions(noFly), []);
  const unvisited = cloneState(state);
  delete unvisited.visitedFloors.B;
  assert.deepEqual(sim.enumerateFloorFlyActions(unvisited), []);
  const blocked = makeContext();
  blocked.project.floorsById.A.map[0][1] = 2;
  assert.deepEqual(blocked.sim.enumerateFloorFlyActions(blocked.state), [], "current-floor blocker matters");
  const noLanding = makeContext();
  noLanding.project.floorsById.B.canFlyTo = false;
  assert.deepEqual(noLanding.sim.enumerateFloorFlyActions(noLanding.state), []);
  const noDeparture = makeContext();
  noDeparture.project.floorsById.A.canFlyFrom = false;
  assert.deepEqual(noDeparture.sim.enumerateFloorFlyActions(noDeparture.state), []);
}

function checkClosingPassageRoute() {
  const { project, sim, state } = makeContext(true);
  const options = {
    includeFloorFly: true, maxExpansions: 100, maxRuntimeMs: 3000,
    stopOnFirstGoal: true,
    goalPredicate: (s) => s.floorId === "A" && s.hero.loc.x === 2 && s.flags.got === 1,
  };
  const result = searchDP(sim, state, options);
  assert.ok(result.foundGoal, "depart from the right room, visit B, then fly back behind the closed passage");
  assert.equal(result.bestGoalState.route.length, 2);
  const record = buildRouteRecord({ project, simulator: sim, initialState: state, finalState: result.bestGoalState });
  assert.equal(record.decisions.length, 2, "route must pass the actual strict replay builder");
  assert.equal(record.final.exactStateKey, buildStateKey(result.bestGoalState));
  const off = searchDP(sim, state, { ...options, includeFloorFly: false });
  assert.equal(off.foundGoal, false);
}

function checkReachabilityReuse() {
  for (const profile of [null, "timing", "expansion"]) {
    const { sim, state } = makeContext();
    let scans = 0;
    const walk = sim.getWalkReachability.bind(sim);
    sim.getWalkReachability = (s) => { scans += 1; return walk(s); };
    const previous = getActivePerfTracker();
    try {
      setActivePerfTracker(profile ? createPerfTracker({ enabled: true, profileExpansionCost: profile === "expansion" }) : null);
      const result = searchDP(sim, state, {
        includeFloorFly: true, maxExpansions: 1, stopOnFirstGoal: false, goalPredicate: () => false,
      });
      assert.equal(result.expansions, 1);
      assert.equal(scans, 1, `${profile || "off"}: primitive and fly enumeration must share one scan`);
    } finally { setActivePerfTracker(previous); }
  }
  const { sim, state } = makeContext();
  let flyCalls = 0;
  const fly = sim.enumerateFloorFlyActions.bind(sim);
  sim.enumerateFloorFlyActions = (...args) => { flyCalls += 1; return fly(...args); };
  searchDP(sim, state, { includeFloorFly: true, actionProvider: () => [], goalPredicate: () => false });
  assert.equal(flyCalls, 0, "custom providers own their action scope");
}

checkDeparturesAndGuards();
checkClosingPassageRoute();
checkReachabilityReuse();
console.log("PASS floor-fly: departure-state preservation, legal two-flight strict replay, tool/visited/blocker guards, shared scan with profiler OFF/ON");
