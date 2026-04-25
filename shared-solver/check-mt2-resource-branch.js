"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { formatActionLabel } = require("./lib/enemy-labels");
const { createSearchProfile } = require("./lib/search-profiles");
const { searchTopK } = require("./lib/search");
const { buildResourcePocketSearchOptions, resolveProjectRoot } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");

const BASELINE_ROUTE = path.join(__dirname, "routes/latest/fixed-1f-mt2-four-priests-hp3834.route.json");

const USER_BRANCH = [
  "battle:bluePriest@MT2:2,8",
  "battle:brownWizard@MT2:3,10",
  "battle:slimeman@MT2:4,11",
  "changeFloor@MT2:6,12",
  "changeFloor@MT3:6,12",
  "battle:redWizard@MT2:11,11",
  "battle:brownWizard@MT2:6,6",
  "battle:yellowGateKeeper@MT2:6,8",
  "equip:I893",
  "changeFloor@MT2:6,12",
];

function makeSimulator(options) {
  const project = loadProject(resolveProjectRoot(process.argv.slice(2), path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1")));
  return new StaticSimulator(project, {
    stopFloorId: (options && options.stopFloorId) || "MT3",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: Boolean(options && options.enableFightToLevelUp),
    enableResourcePocket: Boolean(options && options.enableResourcePocket),
    enableResourceChain: Boolean(options && options.enableResourceChain),
    resourcePocketSearchOptions: buildResourcePocketSearchOptions({ "resource-pocket-mode": "lite" }),
  });
}

function findAction(simulator, state, entry) {
  const actions = simulator.enumerateActions(state);
  if (entry && entry.fingerprint) {
    const found = actions.find((action) => simulator.getActionFingerprint(action) === entry.fingerprint);
    if (found) return found;
  }
  const summary = typeof entry === "string" ? entry : entry && entry.summary;
  if (summary) return actions.find((action) => action.summary === summary) || null;
  return null;
}

function replayEntries(simulator, state, entries) {
  return entries.reduce((current, entry, index) => {
    const action = findAction(simulator, current, entry);
    const summary = typeof entry === "string" ? entry : entry && entry.summary;
    assert.ok(action, `missing action #${index + 1}: ${summary || (entry && entry.fingerprint)}`);
    return simulator.applyAction(current, action);
  }, state);
}

function loadBaselineState(simulator) {
  assert.ok(fs.existsSync(BASELINE_ROUTE), `missing baseline route: ${path.relative(__dirname, BASELINE_ROUTE)}`);
  const route = readRouteFile(BASELINE_ROUTE);
  return replayEntries(simulator, simulator.createInitialState({ rank: "chaos" }), route.decisions || []);
}

function assertBranchGoal(state, prefix) {
  assert.equal(state.floorId, "MT3", `${prefix}: expected floor MT3, got ${state.floorId}`);
  assert.ok(state.hero.hp >= 8425, `${prefix}: expected hp >= 8425, got ${state.hero.hp}`);
  assert.ok(state.hero.atk >= 107, `${prefix}: expected atk >= 107, got ${state.hero.atk}`);
  assert.ok(state.hero.def >= 100, `${prefix}: expected def >= 100, got ${state.hero.def}`);
  assert.ok(state.hero.mdef >= 510, `${prefix}: expected mdef >= 510, got ${state.hero.mdef}`);
  assert.ok(state.hero.exp >= 31, `${prefix}: expected exp >= 31, got ${state.hero.exp}`);
  assert.ok((state.hero.equipment || []).includes("I893"), `${prefix}: expected equipment to include I893`);
}

function checkStaticReplay() {
  const simulator = makeSimulator({ enableFightToLevelUp: false, enableResourcePocket: false, enableResourceChain: false, stopFloorId: "MT5" });
  const baseline = loadBaselineState(simulator);
  assert.equal(baseline.floorId, "MT2");
  assert.ok(baseline.hero.hp >= 3834, `expected baseline hp >= 3834, got ${baseline.hero.hp}`);
  const finalState = replayEntries(simulator, baseline, USER_BRANCH);
  assertBranchGoal(finalState, "static replay");
  return { hp: finalState.hero.hp, atk: finalState.hero.atk, def: finalState.hero.def, mdef: finalState.hero.mdef, exp: finalState.hero.exp };
}

function findSummary(actions, summary) {
  return actions.find((action) => action.summary === summary);
}

function checkFirstActionRanking() {
  const simulator = makeSimulator({ enableFightToLevelUp: false, enableResourcePocket: false, enableResourceChain: false, stopFloorId: "MT5" });
  const baseline = loadBaselineState(simulator);
  const actions = simulator.enumerateActions(baseline);
  const profile = createSearchProfile("stage-mt1-mt11-resource-prep", simulator, { targetFloorId: "MT5" });
  const sorted = profile.sortStateActions(baseline, actions.slice());
  const blue = findSummary(actions, "battle:bluePriest@MT2:2,8");
  const back = findSummary(actions, "changeFloor@MT2:6,0");
  assert.ok(blue, `expected action ${formatActionLabel(simulator.project, "battle:bluePriest@MT2:2,8")}`);
  assert.ok(back, "expected action changeFloor@MT2:6,0");
  const blueIndex = sorted.indexOf(blue);
  const backIndex = sorted.indexOf(back);
  assert.ok(blueIndex >= 0, "bluePriest action should be retained by sorted actions");
  assert.ok(
    blueIndex <= backIndex,
    `${formatActionLabel(simulator.project, blue)} should rank no worse than changeFloor@MT2:6,0: blue=${blueIndex}, back=${backIndex}`
  );
  return { blueIndex, backIndex, blueLabel: formatActionLabel(simulator.project, blue) };
}

async function checkSearchFindsBranch() {
  const simulator = makeSimulator({ enableFightToLevelUp: false, enableResourcePocket: false, enableResourceChain: true, stopFloorId: "MT5" });
  const baseline = loadBaselineState(simulator);
  const profile = createSearchProfile("stage-mt1-mt11-resource-prep", simulator, { targetFloorId: "MT3" });
  const result = await searchTopK(simulator, baseline, {
    ...profile,
    targetFloorId: "MT3",
    topK: 8,
    maxExpansions: 400,
    maxActionsPerState: profile.maxActionsPerState,
    safeDominanceMode: true,
    enableConfluenceHpDominance: true,
  });
  const candidates = [result.goalState, ...(result.results || []), result.bestProgressState, result.bestSeenState].filter(Boolean);
  const found = candidates.find((state) => state.floorId === "MT3" &&
    state.hero.hp >= 8425 &&
    state.hero.atk >= 107 &&
    state.hero.def >= 100 &&
    state.hero.mdef >= 510 &&
    state.hero.exp >= 31 &&
    (state.hero.equipment || []).includes("I893"));
  assert.ok(found, `search should find MT2 resource branch within budget; best=${JSON.stringify(result.diagnostics && result.diagnostics.best)}`);
  assertBranchGoal(found, "search");
  const routeText = (found.route || []).join("\n");
  [
    "battle:bluePriest@MT2:2,8",
    "battle:brownWizard@MT2:3,10",
    "battle:slimeman@MT2:4,11",
    "equip:I893",
  ].forEach((summary) => assert.ok(routeText.includes(summary), `search route should include ${formatActionLabel(simulator.project, summary)}`));
  return { hp: found.hero.hp, routeLength: (found.route || []).length, expansions: result.expansions };
}

async function main() {
  const staticReplay = checkStaticReplay();
  const ranking = checkFirstActionRanking();
  const shouldRunSearch = process.argv.includes("--search") || process.argv.includes("--full");
  const search = shouldRunSearch ? await checkSearchFindsBranch() : { skipped: true, reason: "pass --search to run bounded topK search" };
  console.log(JSON.stringify({ staticReplay, ranking, search }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
