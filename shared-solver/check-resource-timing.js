"use strict";

/**
 * TEST GRADE: integration-local
 * Depends on ignored routes/latest fixture; not clean-checkout safe.
 * See solver-manifest.json tests entry.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { searchDP } = require("./lib/dp-search");
const { readRouteFile } = require("./lib/route-store");

const ROOT = path.resolve(__dirname, "..");
const ONLYUP_MILESTONE = path.join(__dirname, "milestones", "onlyup-chaos-mt5-blueking.json");
const MT7_ROUTE = path.join(__dirname, "routes", "latest", "segmented-mt7-right-exp-crystal.route.json");
const REGION_SPECS = [
  path.join(ROOT, "towers", "onlyup", "region-specs", "region-1.json"),
  path.join(ROOT, "towers", "onlyup", "region-specs", "region-2.json"),
  path.join(ROOT, "towers", "whiteisland", "trial-specs", "trial-smoke.json"),
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function summariesFromRoute(filePath) {
  const route = readRouteFile(filePath);
  return (route.decisions || []).map((decision) => decision.summary);
}

function indexOfRequired(summaries, summary) {
  const index = summaries.indexOf(summary);
  assert.ok(index >= 0, `route should include ${summary}`);
  return index;
}

function assertBefore(summaries, earlier, later) {
  const earlierIndex = indexOfRequired(summaries, earlier);
  const laterIndex = indexOfRequired(summaries, later);
  assert.ok(
    earlierIndex < laterIndex,
    `expected ${earlier} before ${later}, got ${earlierIndex} >= ${laterIndex}`
  );
}

function routeSummaries(route) {
  return (route || []).map((entry) => typeof entry === "string" ? entry : entry && entry.summary);
}

function checkRegionTimingPolicies() {
  for (const specPath of REGION_SPECS) {
    const spec = readJson(specPath);
    assert.ok(spec.resourceTimingPolicy, `${spec.id}: resourceTimingPolicy is required`);
    assert.ok(Array.isArray(spec.expectedRegressionTraps) && spec.expectedRegressionTraps.length > 0, `${spec.id}: expectedRegressionTraps are required`);
    if ((spec.resourceTimingPolicy || {}).stopOnFirstGoalForTimingCriticalSegments === false) {
      assert.notEqual(spec.stopOnFirstGoal, true, `${spec.id}: timing-critical region must not force stopOnFirstGoal=true at region level`);
    }
  }
}

function checkMilestoneTimingAnnotations() {
  const spec = readJson(ONLYUP_MILESTONE);
  const byId = new Map((spec.milestones || []).map((milestone) => [milestone.id, milestone]));
  for (const id of [
    "mt5-sustain-balance",
    "mt5-i894-equipped",
    "mt5-before-blueking",
    "mt6-upper-right-blueking",
    "mt7-right-exp-crystal",
  ]) {
    const milestone = byId.get(id);
    assert.ok(milestone, `missing timing-critical milestone ${id}`);
    if ((milestone.dp || {}).stopOnFirstGoal === true) {
      assert.ok(
        typeof (milestone.dp || {}).firstGoalSafeReason === "string" && milestone.dp.firstGoalSafeReason.trim().length > 0,
        `${id}: stopOnFirstGoal=true must have firstGoalSafeReason`
      );
      assert.ok(
        ((milestone.goal || {}).presentTiles || []).length > 0 ||
          ((milestone.goal || {}).preferredPresentTiles || []).length > 0 ||
          ((milestone.goal || {}).removedTiles || []).length > 0,
        `${id}: stopOnFirstGoal=true must be protected by explicit tile/resource constraints`
      );
    }
  }
}

function checkKnownOnlyupResourceTimingRoute() {
  assert.ok(fs.existsSync(MT7_ROUTE), `missing resource timing route fixture: ${MT7_ROUTE}`);
  const summaries = summariesFromRoute(MT7_ROUTE);

  assertBefore(summaries, "getNext:weakWine@MT6:7,7", "battle:whiteHornSlime@MT6:1,11");
  assertBefore(summaries, "getNext:weakWine@MT6:7,7", "battle:whiteHornSlime@MT6:10,8");
  assertBefore(summaries, "battle:whiteHornSlime@MT6:1,11", "battle:silverSlime@MT6:6,6");
  assertBefore(summaries, "battle:whiteHornSlime@MT6:10,8", "battle:silverSlime@MT6:6,6");

  assertBefore(summaries, "battle:evilFairy@MT6:2,1", "battle:silverSlime@MT6:9,10");
  assertBefore(summaries, "battle:silverSlime@MT6:9,10", "battle:yellowPriest@MT6:11,11");
  assertBefore(summaries, "battle:yellowPriest@MT6:11,11", "battle:evilFairy@MT7:4,11");
  assertBefore(summaries, "battle:yellowPriest@MT6:11,11", "battle:evilFairy@MT7:8,11");
  assertBefore(summaries, "battle:evilFairy@MT7:4,11", "battle:yellowPriest@MT7:11,11");
  assertBefore(summaries, "battle:evilFairy@MT7:8,11", "battle:yellowPriest@MT7:11,11");

  assert.equal(
    summaries.includes("pickup:weakWine@MT6:7,7"),
    false,
    "MT6 7,7 weakWine should be face-picked with getNext/interactPickup, not stepped onto as a normal pickup"
  );
}

function createSyntheticTimingSimulator() {
  return {
    project: { floorOrder: ["T1"], floorsById: { T1: {} } },
    isTerminal: () => false,
    applyAction(state, action) {
      const next = JSON.parse(JSON.stringify(state));
      next.route = Array.isArray(next.route) ? next.route.slice() : [];
      next.route.push(action.summary);
      if (action.summary === "earlyPotion") {
        next.hero.hp += 50;
        next.flags.potionUsed = 1;
      } else if (action.summary === "fightAfterPotion") {
        next.hero.hp -= 90;
        next.flags.fought = 1;
      } else if (action.summary === "fightBeforePotion") {
        next.hero.hp -= 10;
        next.flags.fought = 1;
      } else if (action.summary === "latePotion") {
        next.hero.hp += 50;
        next.flags.potionUsed = 1;
      }
      next.meta.decisionDepth = next.route.length;
      return next;
    },
  };
}

function syntheticTimingActions(unusedSimulator, state) {
  const flags = state.flags || {};
  const actions = [];
  if (!flags.potionUsed && !flags.fought) {
    actions.push({ kind: "pickup", summary: "earlyPotion" });
    actions.push({ kind: "battle", summary: "fightBeforePotion", estimate: { damage: 10 } });
  }
  if (flags.potionUsed && !flags.fought) {
    actions.push({ kind: "battle", summary: "fightAfterPotion", estimate: { damage: 90 } });
  }
  if (flags.fought && !flags.potionUsed) {
    actions.push({ kind: "pickup", summary: "latePotion" });
  }
  return actions;
}

function checkLateResourceReplacesEarlySameKey() {
  const simulator = createSyntheticTimingSimulator();
  const initialState = {
    floorId: "T1",
    hero: {
      hp: 100,
      atk: 1,
      def: 1,
      mdef: 0,
      lv: 1,
      exp: 0,
      loc: { x: 0, y: 0 },
      equipment: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: {},
    floorStates: {},
    route: [],
    meta: { decisionDepth: 0 },
  };
  const result = searchDP(simulator, initialState, {
    dpKeyMode: "mutation",
    stopOnFirstGoal: false,
    maxExpansions: 10,
    maxActionsPerState: 10,
    actionProvider: syntheticTimingActions,
    goalPredicate: (state) => state.flags && state.flags.fought === 1 && state.flags.potionUsed === 1,
  });
  assert.ok(result.bestGoalState, "synthetic timing DP should find a goal");
  assert.equal(result.bestGoalState.hero.hp, 140, "late potion route should dominate early potion route at the same final key");
  assert.deepEqual(routeSummaries(result.bestGoalState.route), ["fightBeforePotion", "latePotion"]);
  assert.ok(
    Number((((result.diagnostics || {}).dp || {}).replacedLowerHp) || 0) >= 1,
    "DP diagnostics should record replacedLowerHp when late resource timing dominates"
  );
}

function main() {
  checkRegionTimingPolicies();
  checkMilestoneTimingAnnotations();
  checkKnownOnlyupResourceTimingRoute();
  checkLateResourceReplacesEarlySameKey();
  console.log("resource timing regression ok");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
