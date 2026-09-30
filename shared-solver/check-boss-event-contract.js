"use strict";

// TEST GRADE: unit-plus-micro, clean checkout. No Neko data or authored route input.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { executeActionList, applyFloorArrival, UnsupportedEventError } = require("./lib/events");
const { EventResolver, analyzeActionList, actionListHasStateChange } = require("./lib/event-resolver");
const { loadProject } = require("./lib/project-loader");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { createStateFromSnapshot } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");
const { buildDpStateKey } = require("./lib/dp-search");
const { diffRouteSnapshot, buildRuntimeProjectedSolverStateKeyFromSnapshot } = require("./lib/live-replay");
const d = require("./lib/durable-search");

const RESET = { type: "function", function: 'function(){\ncore.setFlag("__visited__", {});\n}' };
function makeState() {
  return {
    floorId: "A",
    hero: { hp: 100, hpmax: 999, mana: 0, manamax: 0, atk: 20, def: 4, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: 0, y: 0, direction: "right" }, equipment: ["sword"], followers: [] },
    flags: { __atk_buff__: 1.25 }, inventory: { greenKey: 30 },
    visitedFloors: { A: true }, floorStates: { A: { removed: {}, replaced: {} } },
    triggeredAutoEvents: {}, route: [], notes: [], meta: {},
  };
}
function makeProject() {
  const floor = (floorId) => ({ floorId, title: floorId, width: 3, height: 1, map: [[0, 0, 0]],
    events: {}, firstArrive: [], eachArrive: [], afterBattle: {}, autoEvent: {}, changeFloor: {} });
  return {
    data: { main: { floorIds: ["A", "B"], equipName: ["weapon"], nameMap: { alias: "friend.png" } }, firstData: { floorId: "A", hero: makeState().hero, levelUp: [] } },
    floorOrder: ["A", "B"], floorsById: { A: floor("A"), B: floor("B") },
    itemsById: { sword: { cls: "equips", equip: { type: 0, value: { atk: 5 }, percentage: { atk: 25 } } } },
    enemysById: {}, mapTilesByNumber: {}, mapNumbersById: {}, icons: {}, values: {}, defaultFlags: {},
    commonEvents: { finish: [RESET, { type: "unfollow", name: "alias" }, { type: "unloadEquip", pos: 0 },
      { type: "setValue", name: "flag:finished", value: "1" }] },
  };
}
function unsupported(project, actions) {
  assert.throws(() => executeActionList(project, makeState(), actions, {}, {}), (error) =>
    error instanceof UnsupportedEventError && error.code === "UNSUPPORTED_EVENT_ACTION");
}
function checkScriptsAndCommonEvents() {
  const project = makeProject();
  for (const script of ["function(){ core.setStatus('hp', 0); }", "function(){ core.unknown(); }",
    "function(){ core.setFlag('__visited__', {}); core.setStatus('hp', 0); }", "function(){ while(true) {} }"]) {
    unsupported(project, [{ type: "function", function: script }]);
    assert(analyzeActionList(project, makeState(), [{ type: "function", function: script }], {})[0].unsupported.length > 0);
  }
  unsupported(project, [{ ...RESET, async: true }]);
  const empty = makeState();
  executeActionList(project, empty, ["presentation", { type: "function", function: "function () { }" }], {}, {});
  assert.equal(empty.hero.hp, 100);
  assert.equal(actionListHasStateChange([RESET]), true);
  const mixed = analyzeActionList(project, makeState(), [{ type: "choices", choices: [
    { text: "unknown", action: [{ type: "function", function: "function(){ core.unknown(); }" }] },
    { text: "leave", action: [] },
  ] }], {});
  assert(mixed.some((branch) => branch.choicePath[0] === 1 && branch.unsupported.length === 0), "valid no-op choice is retained");
  assert(mixed.some((branch) => branch.choicePath[0] === 0 && branch.unsupported.length > 0), "unknown choice remains explicit");
  assert.equal(actionListHasStateChange([{ type: "function", function: "function(){}" }]), false);
  const unknownChoice = analyzeActionList(project, makeState(), [{ type: "choices", choices: [
    { text: "unmodeled", action: [{ type: "setEnemy", id: "boss", name: "hp", value: "0" }] },
    { text: "leave", action: [] },
  ] }], {});
  assert(unknownChoice.some((branch) => branch.choicePath[0] === 0 && branch.unsupported.length > 0), "unknown event types cannot disappear behind a no-op menu exit");
  assert(unknownChoice.some((branch) => branch.choicePath[0] === 1 && branch.unsupported.length === 0));
  assert.equal(mixed.find((branch) => branch.choicePath[0] === 1).hasStateChange, false, "exit does not inherit unknown sibling effects");
  const changingMenu = [{ type: "choices", choices: [
    { text: "reset", action: [RESET] }, { text: "leave", action: [] },
  ] }];
  const changingBranches = analyzeActionList(project, makeState(), changingMenu, {});
  assert.equal(changingBranches[0].hasStateChange, true);
  assert.equal(changingBranches[1].hasStateChange, false, "exit does not inherit supported sibling effects");
  project.floorsById.A.events["1,0"] = { data: changingMenu };
  const menuActions = new EventResolver().enumerateActions({ project, helper: {
    findAdjacencyActions(predicate, build) {
      return build({ x: 0, y: 0 }, "right", 1, 0, null, [], makeState());
    },
  } });
  assert.deepEqual(menuActions.map((action) => action.hasStateChange), [true, false], "descriptors carry selected-branch effects");
  assert.equal(analyzeActionList(project, makeState(), [RESET, ...changingMenu], {})[1].hasStateChange, true, "effects outside the menu still apply to its exit");

  const state = makeState();
  state.hero.followers = [{ name: "friend.png", x: 2 }, { name: "friend.png", x: 2 }, { name: "other.png" }];
  state.flags.arg2 = 9;
  state.flags["@temp@boss"] = 1;
  state.flags.argument = 7;
  executeActionList(project, state, [
    { type: "insert", name: "finish", args: ["status:hp", null, 7] },
    ...[0, 1, 2, 3].map((index) => ({ type: "setValue", name: `flag:seenArg${index}`, value: `flag:arg${index}` })),
  ], {}, {});
  assert.equal(state.flags.seenArg0, "finish");
  assert.equal(state.flags.seenArg1, "status:hp", "common-event arguments are literal values, not evaluated expressions");
  assert.equal(state.flags.seenArg2, 9, "null arguments retain their previous value during the event");
  assert.equal(state.flags.seenArg3, 7);
  assert.equal(Object.keys(state.flags).some((key) => /^arg\d+$/.test(key) || key.startsWith("@temp@")), false, "event completion clears temporary arguments");
  assert.equal(state.flags.argument, 7, "only numbered argument flags are temporary");
  assert.equal(state.flags.finished, 1);
  assert.deepEqual(state.visitedFloors, {});
  assert.equal(state.hero.atk, 15);
  assert.equal(state.flags.__atk_buff__, 1);
  assert.equal(state.inventory.sword, 1);
  assert.deepEqual(state.hero.equipment, [null]);
  assert.deepEqual(state.hero.followers.map((f) => f.name), ["friend.png", "other.png"], "unfollow removes the first match only");
  for (const follower of state.hero.followers) assert.deepEqual(follower, { name: follower.name, x: 0, y: 0, direction: "right", stop: true });
  executeActionList(project, state, [{ type: "unloadEquip", pos: 0 }, { type: "unloadEquip", pos: 5 }], {}, {});
  assert.equal(state.inventory.sword, 1, "empty slots do not duplicate equipment");
  executeActionList(project, state, [{ type: "unfollow" }], {}, {});
  assert.deepEqual(state.hero.followers, []);

  project.commonEvents.outer = [{ type: "insert", name: "finish" },
    { type: "setValue", name: "flag:nestedArg0", value: "flag:arg0" }, { type: "setValue", name: "flag:outer", value: "1" }];
  const nested = makeState();
  executeActionList(project, nested, [{ type: "insert", name: "outer" }], {}, {});
  assert.equal(nested.flags.nestedArg0, "finish", "nested arg flags are not restored on return before the outer queue ends");
  assert.equal(nested.flags.arg0, undefined, "outer queue completion clears nested arguments too");
  assert.equal(nested.flags.outer, 1);
  project.commonEvents.loop = [{ type: "insert", name: "loop" }];
  unsupported(project, [{ type: "insert", name: "loop" }]);
  assert(analyzeActionList(project, makeState(), [{ type: "insert", name: "loop" }], {})[0].unsupported.length > 0);
  for (const action of [{ type: "insert", name: "missing" }, { type: "insert", loc: [1, 0] },
    { type: "insert", name: "finish", args: [{}] }, { type: "unloadEquip", pos: -1 }]) unsupported(project, [action]);
}
function checkVisitedHistorySnapshots() {
  const project = makeProject(), before = makeState(), after = makeState();
  executeActionList(project, after, [RESET], {}, {});
  assert.notEqual(buildStateKey(before), buildStateKey(after));
  assert.notEqual(buildDpStateKey(null, before), buildDpStateKey(null, after));
  const snapshot = buildSolverSnapshot(project, after, { floorIds: ["A", "B"] });
  assert.deepEqual(snapshot.visitedFloors, [], "verification floors are not visited history");
  const restored = createStateFromSnapshot(project, snapshot);
  assert.deepEqual(restored.visitedFloors, {}, "current floor must not be re-marked visited after an explicit reset");
  assert.deepEqual(restored.hero.followers, []);
  const nonempty = buildSolverSnapshot(project, before, { floorIds: ["A", "B"] });
  const expected = buildSolverSnapshot(project, before, { floorIds: ["A", "B"] });
  const runtime = { ...expected, visitedFloors: [] };
  assert.match(diffRouteSnapshot(expected, runtime, {}, []), /visitedFloors/);
  const unobserved = { ...expected }; delete unobserved.visitedFloors;
  assert.equal(diffRouteSnapshot(unobserved, runtime, {}, []), null, "legacy snapshots do not claim visitation parity");
  const missing = { ...expected }; delete missing.visitedFloors;
  assert.match(diffRouteSnapshot(expected, missing, {}, []), /visitedFloors/, "new explicit history cannot be masked by a missing runtime field");
  const projected = JSON.parse(buildRuntimeProjectedSolverStateKeyFromSnapshot(runtime, buildStateKey(before), {}));
  assert.deepEqual(projected.visitedFloors, [], "runtime projection uses visitation, not verification scope");
  assert.deepEqual(createStateFromSnapshot(project, nonempty).visitedFloors, { A: true });
  const legacy = { ...nonempty }; delete legacy.visitedFloors;
  assert.deepEqual(createStateFromSnapshot(project, legacy).visitedFloors, { A: true, B: true }, "legacy inference is preserved only when history is absent");
  project.floorsById.B.firstArrive = [RESET];
  after.floorId = "B";
  applyFloorArrival(project, after, "B", {});
  assert.deepEqual(after.visitedFloors, {}, "runtime marks a floor before executing its queued first-arrive actions");
  const transition = makeState();
  executeActionList(project, transition, [{ type: "changeFloor", floorId: "B", loc: [2, 0], direction: "down" }], {}, {});
  assert.deepEqual(transition.flags.__leaveLoc__.A, { x: 0, y: 0, direction: "right" }, "event transfers record departure before applying the destination location");
  assert.deepEqual(transition.hero.loc, { x: 2, y: 0, direction: "down" });
  project.floorsById.B.firstArrive = [{ type: "insert", name: "finish", args: [42] }];
  project.floorsById.B.eachArrive = [{ type: "setValue", name: "flag:arrivalArg", value: "flag:arg1" }];
  const arriving = makeState(); arriving.floorId = "B";
  applyFloorArrival(project, arriving, "B", {});
  assert.equal(arriving.flags.arrivalArg, 42, "firstArrive and eachArrive share one event queue");
  assert.equal(arriving.flags.arg1, undefined);
}
function checkLoaderAndDurableClosure() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "boss-event-contract-"));
  try {
    const project = makeProject();
    project.commonEvents.finish.push({ type: "changeFloor", floorId: "B", loc: [0, 0], direction: "right" });
    project.floorsById.A.map = [[0, 1, 0]];
    project.floorsById.A.events["1,0"] = { data: [{ type: "insert", name: "finish" }] };
    project.mapTilesByNumber = { 1: { id: "npc", cls: "npcs", noPass: true, trigger: "action" } };
    const dir = path.join(temp, "tower", "project"); fs.mkdirSync(path.join(dir, "floors"), { recursive: true });
    const objects = { data: project.data, items: project.itemsById, enemys: {}, maps: project.mapTilesByNumber,
      icons: {}, functions: {}, events: { commonEvent: project.commonEvents } };
    for (const [name, object] of Object.entries(objects)) fs.writeFileSync(path.join(dir, name + ".js"), `var ${name}_test = ${JSON.stringify(object)};`);
    for (const [id, floor] of Object.entries(project.floorsById)) fs.writeFileSync(path.join(dir, "floors", id + ".js"), `main.floors.${id} = ${JSON.stringify(floor)};`);
    const root = path.dirname(dir), loaded = loadProject(root);
    assert.equal(loaded.commonEvents.finish[0].type, "function");
    const config = { title: "Boss event micro contract", initial: { floorId: "A", hero: makeState().hero, inventory: { greenKey: 30 }, flags: { __atk_buff__: 1.25 } },
      allowedFloors: ["A", "B"], protectedItems: ["greenKey"], stages: [{ floorId: "B" }],
      budgets: [{ expansions: 30, runtimeMs: 5000 }], candidateLimit: 2, heapMb: 256, maxRssMb: 512, maxRuntimeMs: 10000 };
    function attempt(name) {
      const input = loadProject(root), sim = d.makeSimulator(input, config), initial = d.initialState(input, sim, config);
      const run = path.join(temp, name), task = { id: "entry", stage: 0, tier: 0 };
      d.atomicJson(path.join(run, "initial.json"), initial);
      d.atomicJson(path.join(run, "states", "entry.json"), initial);
      return d.runAttempt(config, root, run, task);
    }
    const result = attempt("good");
    assert.equal(result.verified && result.verified.strictReplay, true, JSON.stringify(result.stats));
    project.commonEvents.finish.unshift({ type: "function", function: "function(){ core.setStatus('hp', 0); }" });
    fs.writeFileSync(path.join(dir, "events.js"), `var events_test = ${JSON.stringify({ commonEvent: project.commonEvents })};`);
    const failed = attempt("unsupported");
    assert(!failed.verified, "unknown nested script cannot certify the terminal");
    assert(failed.stats.modelErrors > 0, JSON.stringify(failed.stats));
    assert.equal(failed.stats.searchComplete, false);
    assert.equal(failed.stats.modelErrorsEncountered, true);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function main() {
  checkScriptsAndCommonEvents();
  checkVisitedHistorySnapshots();
  checkLoaderAndDurableClosure();
  console.log("PASS boss-event-contract: fail-closed scripts, named common calls, unload/followers/visited history, snapshot round-trip, real DP + durable strict replay and negative terminal control");
}
if (require.main === module) main();
module.exports = { main };
