"use strict";

/**
 * TEST GRADE: real-fixture-attribution
 *
 * PR-5.17a13 compares a known successful ordering with its single-variable
 * early-consumption counterfactual, then audits how the route-free
 * hierarchical planner currently represents the same I621 resource.
 *
 * The tracked route is a post-hoc oracle only. It is never passed to
 * runHierarchicalDiscovery or any planner/compiler input.
 */

const assert = require("node:assert");
const path = require("node:path");

const { battleStatus } = require("./lib/automatic-blocker-repair");
const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runHierarchicalDiscovery } = require("./lib/hierarchical-discovery-engine");
const { loadProject } = require("./lib/project-loader");
const { getTileDefinitionAt } = require("./lib/state");
const { makeSimulator, replayFixture } = require("./check-mt5-third-gate-resource-timing");
const { createMt5EntryState, detachCheckpoint } = require("./qualify-blind-discovery");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json");
const HEAL_TILE = Object.freeze({ floorId: "MT4", x: 7, y: 3, tileId: "I621" });
const HEAL_TRIGGER = "battle:skeletonKing@MT4:8,3";
const BLOCKER = Object.freeze({ floorId: "MT5", x: 9, y: 10, enemyId: "evilHero" });

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || [])
    .find((action) => action.summary === summary) ||
    simulator.enumerateActions(state).find((action) => action.summary === summary) ||
    null;
}

function replaySummaries(simulator, state, summaries) {
  let next = state;
  for (const summary of summaries) {
    const action = findAction(simulator, next, summary);
    assert.ok(action, `missing attribution action ${summary}`);
    next = simulator.applyAction(next, action);
  }
  return next;
}

function heroProjection(state) {
  const hero = state.hero || {};
  return {
    floorId: state.floorId,
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
  };
}

function nonHpHeroProjection(state) {
  const hero = heroProjection(state);
  delete hero.hp;
  return hero;
}

function healPresent(project, state) {
  const tile = getTileDefinitionAt(
    project,
    state,
    HEAL_TILE.floorId,
    HEAL_TILE.x,
    HEAL_TILE.y,
  );
  return Boolean(tile && tile.id === HEAL_TILE.tileId);
}

function evaluateBlocker(simulator, state) {
  const evaluation = simulator.battleResolver.evaluateBattle(
    state,
    BLOCKER.floorId,
    BLOCKER.x,
    BLOCKER.y,
    BLOCKER.enemyId,
  );
  const damage = evaluation.damageInfo && evaluation.damageInfo.damage;
  return {
    status: battleStatus(evaluation, state.hero.hp),
    hp: Number(state.hero.hp),
    damage: damage == null ? null : Number(damage),
    survivalMargin: damage == null ? null : Number(state.hero.hp) - Number(damage),
  };
}

function buildTimingAttribution(project) {
  const simulator = makeSimulator(project);
  const fixtureState = replayFixture(simulator);
  const common = replaySummaries(simulator, fixtureState, [
    "battle:greenKing@MT4:4,1",
    "battle:blueKnight@MT4:2,1",
    "changeFloor@MT4:6,0",
    "changeFloor@MT3:6,0",
    "battle:goldSlime@MT4:4,7",
    "battle:poisonSkeleton@MT4:6,6",
    "battle:poisonSkeleton@MT4:10,8",
    "battle:poisonSkeleton@MT4:2,8",
    "battle:poisonSkeleton@MT4:3,10",
    "battle:poisonBat@MT4:4,11",
    "changeFloor@MT4:6,12",
    "changeFloor@MT5:6,12",
    "battle:skeletonPriest@MT4:11,11",
    "battle:poisonBat@MT4:6,8",
  ]);
  assert.strictEqual(healPresent(project, common), true, "I621 must be present at the shared state");

  const earlyAfterTrigger = replaySummaries(simulator, common, [HEAL_TRIGGER]);
  assert.strictEqual(healPresent(project, earlyAfterTrigger), false, "early trigger must consume I621");
  const early = replaySummaries(simulator, earlyAfterTrigger, [
    "changeFloor@MT4:6,12",
    "changeFloor@MT5:6,12",
    "battle:skeletonKing@MT4:4,3",
    "changeFloor@MT4:6,12",
    "battle:skeletonKing@MT5:4,11",
    "battle:skeletonPresbyter@MT5:3,10",
    "battle:skeletonKing@MT5:8,11",
    "battle:devilWarrior@MT5:11,11",
    "battle:skeletonKnight@MT5:1,11",
  ]);

  const delayedBeforeTrigger = replaySummaries(simulator, common, [
    "battle:skeletonKing@MT4:4,3",
    "changeFloor@MT4:6,12",
    "battle:skeletonKing@MT5:4,11",
    "battle:skeletonPresbyter@MT5:3,10",
    "battle:skeletonKing@MT5:8,11",
    "battle:devilWarrior@MT5:11,11",
    "battle:skeletonKnight@MT5:1,11",
    "changeFloor@MT5:6,12",
  ]);
  assert.strictEqual(
    healPresent(project, delayedBeforeTrigger),
    true,
    "delayed ordering must preserve I621 through the costly battle chain",
  );
  const delayed = replaySummaries(simulator, delayedBeforeTrigger, [
    HEAL_TRIGGER,
    "changeFloor@MT4:6,12",
  ]);
  assert.strictEqual(healPresent(project, delayed), false, "delayed trigger must eventually consume I621");
  assert.deepStrictEqual(
    nonHpHeroProjection(early),
    nonHpHeroProjection(delayed),
    "the timing counterfactual must hold non-HP hero progress constant",
  );
  assert.strictEqual(delayed.hero.hp - early.hero.hp, 13846, "delayed I621 HP value");

  const tail = [
    "changeFloor@MT5:6,12",
    "battle:devilWarrior@MT4:10,5",
    "changeFloor@MT4:6,12",
  ];
  const earlyBeforeBlocker = replaySummaries(simulator, early, tail);
  const delayedBeforeBlocker = replaySummaries(simulator, delayed, tail);
  const earlyBlocker = evaluateBlocker(simulator, earlyBeforeBlocker);
  const delayedBlocker = evaluateBlocker(simulator, delayedBeforeBlocker);
  assert.strictEqual(earlyBlocker.damage, delayedBlocker.damage, "timing must not change blocker damage");
  assert.strictEqual(
    delayedBlocker.survivalMargin - earlyBlocker.survivalMargin,
    13846,
    "all blocker-margin improvement must come from delayed healing",
  );

  return {
    oracleUse: "post-hoc-only",
    sharedState: {
      hero: heroProjection(common),
      healPresent: healPresent(project, common),
    },
    firstDivergence: {
      decision: HEAL_TRIGGER,
      earlyEffect: "consume-I621-before-costly-chain",
      delayedEffect: "preserve-I621-through-costly-chain",
    },
    beforeConsumption: {
      early: {
        hero: heroProjection(earlyAfterTrigger),
        healPresent: healPresent(project, earlyAfterTrigger),
      },
      delayed: {
        hero: heroProjection(delayedBeforeTrigger),
        healPresent: healPresent(project, delayedBeforeTrigger),
      },
    },
    matchedProgressAfterConsumption: {
      early: heroProjection(early),
      delayed: heroProjection(delayed),
      sameNonHpHeroProgress: true,
      delayedHpAdvantage: Number(delayed.hero.hp) - Number(early.hero.hp),
    },
    blocker: {
      target: BLOCKER,
      early: earlyBlocker,
      delayed: delayedBlocker,
      marginAdvantage: delayedBlocker.survivalMargin - earlyBlocker.survivalMargin,
    },
  };
}

function buildPlannerVocabularyAudit(project) {
  const initialState = detachCheckpoint(createMt5EntryState(project));
  const terminalGoal = readBlindGoal(GOAL_FILE).goal;
  const result = runHierarchicalDiscovery(project, PROJECT_ROOT, initialState, terminalGoal, {
    towerId: "onlyup",
    maxRounds: 6,
    initialMaxExpansions: 64,
    localMaxExpansions: 32,
    candidateLimit: 8,
    repairCandidateLimit: 16,
    excludeTargetNodeId: "MT5:item:11,5:I894",
  });
  assert.strictEqual(result.inputContract.knownRouteUsed, false);
  const i621Round = result.rounds.find((round) =>
    round.repair && round.repair.sourceNodeId === "MT4:item:7,3:I621");
  assert.ok(i621Round, "route-free planner must independently discover I621");
  assert.strictEqual(i621Round.kind, "blocker-repair-rejected");
  assert.deepStrictEqual(i621Round.repair.goal, {
    type: "tileRemoved",
    floorId: "MT4",
    x: 7,
    y: 3,
  });
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(i621Round.repair.goal, "presentTiles"),
    false,
    "hierarchical repair currently has no preserve-now vocabulary for I621",
  );
  assert.strictEqual(i621Round.outcome.goalFound, false);
  assert.strictEqual(i621Round.outcome.frontierExhausted, true);
  assert.strictEqual(i621Round.outcome.budgetExhausted, false);
  assert.strictEqual(i621Round.outcome.searchComplete, true);

  return {
    plannerInput: result.inputContract,
    discoveredWithoutOracle: true,
    firstI621RepairRound: i621Round.round,
    completedBeforeI621: result.rounds
      .filter((round) => round.round < i621Round.round && round.completedPrerequisiteId)
      .map((round) => round.completedPrerequisiteId),
    representedGoal: i621Round.repair.goal,
    representedIntent: "consume-now",
    missingIntent: "preserve-now-consume-after-costly-chain",
    outcome: i621Round.outcome,
    totalThroughAttributionRound: result.rounds
      .filter((round) => round.round <= i621Round.round)
      .reduce((total, round) => {
        total.expansions += Number((round.outcome || {}).expansions || 0);
        total.generated += Number((round.outcome || {}).generated || 0);
        total.accepted += Number((round.outcome || {}).accepted || 0);
        total.rejected += Number((round.outcome || {}).rejected || 0);
        return total;
      }, { expansions: 0, generated: 0, accepted: 0, rejected: 0 }),
  };
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const timing = buildTimingAttribution(project);
  const planner = buildPlannerVocabularyAudit(project);
  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.d2-deferred-heal-attribution.v1",
    status: "passed",
    controls: {
      trackedRouteUse: "post-hoc-oracle-only",
      plannerKnownRouteUsed: planner.plannerInput.knownRouteUsed,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionSelectionChanged: false,
      maxRuntimeMs: 0,
    },
    badToGood: {
      bad: "consume-I621-before-costly-chain",
      good: "preserve-I621-then-consume-after-costly-chain",
      onlyCausalHeroDifference: "hp",
      hpAndBlockerMarginGain: timing.blocker.marginAdvantage,
    },
    timing,
    planner,
    verdict: "HIERARCHICAL_REPAIR_MISSING_DEFERRED_RESOURCE_INTENT",
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  buildPlannerVocabularyAudit,
  buildTimingAttribution,
  main,
};
