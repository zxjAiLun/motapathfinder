"use strict";

/**
 * TEST GRADE: unit
 *
 * Synthetic contract checks for searchDP observer hooks. No tower project or
 * generated route is loaded here; observer payloads must never affect search.
 */

const assert = require("node:assert");

const { syncProgress } = require("./lib/progress");
const { searchDP } = require("./lib/dp-search");

function makeState(hp, route) {
  const state = {
    floorId: "SYNTHETIC",
    hero: {
      hp,
      hpmax: 100,
      atk: 1,
      def: 1,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      mana: 0,
      manamax: 0,
      loc: { x: 1, y: 1, direction: "down" },
      equipment: [],
      followers: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: { SYNTHETIC: true },
    floorStates: { SYNTHETIC: { removed: {}, replaced: {} } },
    route: Array.isArray(route) ? route.slice() : [],
    notes: [],
    meta: { decisionDepth: Array.isArray(route) ? route.length : 0 },
  };
  syncProgress(state);
  return state;
}

function makeSimulator() {
  return {
    project: {
      floorsById: {
        SYNTHETIC: { floorId: "SYNTHETIC", width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], changeFloor: {} },
      },
    },
    createInitialState: () => makeState(50, []),
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => state.route.length > 0
      ? { actions: [] }
      : {
          actions: [
            { kind: "battle", summary: "battle:a-low@SYNTHETIC:1,1", estimate: { damage: 90 } },
            { kind: "battle", summary: "battle:b-high@SYNTHETIC:1,1", estimate: { damage: 80 } },
            { kind: "battle", summary: "battle:c-multi@SYNTHETIC:1,1", estimate: { damage: 70 } },
          ],
        },
    applyAction: (state, action) => {
      if (action.summary.startsWith("battle:a-low")) return makeState(10, state.route.concat(action.summary));
      if (action.summary.startsWith("battle:b-high")) return makeState(90, state.route.concat(action.summary));
      if (action.summary.startsWith("battle:c-multi")) return [
        makeState(60, state.route.concat(`${action.summary}:low`)),
        makeState(80, state.route.concat(`${action.summary}:high`)),
      ];
      return makeState(state.hero.hp, state.route.concat(action.summary));
    },
  };
}

function collectEvents(options) {
  const events = [];
  const observer = {
    includeExactStateKey: true,
    onEvent(event) {
      events.push(event);
    },
  };
  const result = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 12,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 90,
    observerCaptureDominanceWitnesses: true,
    observer,
    ...(options || {}),
  });
  return { result, events };
}

function checkObserverDoesNotChangeResult() {
  const observed = collectEvents();
  const plain = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 12,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 90,
  });
  assert(observed.result.bestGoalState, "observer search should find the synthetic goal");
  assert(plain.bestGoalState, "plain search should find the synthetic goal");
  assert.equal(observed.result.bestGoalState.hero.hp, plain.bestGoalState.hero.hp);
  assert.deepEqual(observed.result.bestGoalState.route, plain.bestGoalState.route);
  assert.equal(observed.result.diagnostics.dp.observerEnabled, true);
  assert.equal(observed.result.diagnostics.dp.observerErrors, 0);
  assert.equal(plain.diagnostics.dp.observerEnabled, false);
  return observed;
}

function checkEventCoverage(observed) {
  const types = new Set(observed.events.map((event) => event.eventType));
  [
    "actionSetGenerated",
    "candidateGenerated",
    "candidateRejected",
    "skylineInserted",
    "skylineEvicted",
    "agendaPopped",
    "goalAccepted",
  ].forEach((type) => assert(types.has(type), `observer missing ${type}`));
  observed.events.forEach((event) => {
    assert.equal(event.eventVersion, "dp-observer.v1");
    assert.equal(typeof event.decisionDepth, "number");
    assert.ok(event.hero && event.hero.hp != null);
    assert.equal(typeof event.exactStateKey, "string");
  });
  const inserted = observed.events.filter((event) => event.eventType === "skylineInserted");
  assert(inserted.length > 0, "synthetic search should insert agenda nodes");
  inserted.forEach((event) => {
    assert(event.agendaRank && typeof event.agendaRank === "object");
    assert.equal(typeof event.enqueueExpansion, "number");
    assert.equal(typeof event.expansionsCompletedAtEnqueue, "number");
    assert.equal(typeof event.enqueueElapsedMs, "number");
    assert.equal(typeof event.agendaSizeAfterInsert, "number");
  });
  const popped = observed.events.filter((event) => event.eventType === "agendaPopped");
  assert(popped.length > 0, "synthetic search should pop agenda nodes");
  popped.forEach((event) => {
    assert(event.agendaRank && typeof event.agendaRank === "object");
    assert.equal(typeof event.popExpansion, "number");
    assert.equal(typeof event.expansionsCompletedBeforePop, "number");
    assert.equal(typeof event.popElapsedMs, "number");
    assert.equal(typeof event.queueAgeExpansions, "number");
    assert.equal(typeof event.queueAgeMs, "number");
    assert(event.queueAgeExpansions >= 0, "queue age cannot be negative");
    assert(event.queueAgeMs >= 0, "queue time age cannot be negative");
  });
  const multiSuccessors = observed.events
    .filter((event) => event.action && /c-multi/.test(event.action.summary || ""))
    .map((event) => event.successorId)
    .filter(Boolean);
  assert.equal(new Set(multiSuccessors).size, 2, "multi-successor action needs independent successor ids");
  const generatedBattle = observed.events.find((event) => event.eventType === "candidateGenerated");
  assert.equal(generatedBattle.action.fingerprint, `fp:${generatedBattle.action.summary}`);
  const eviction = observed.events.find((event) => event.eventType === "skylineEvicted");
  assert(eviction, "synthetic search should exercise skyline eviction");
  const evictedInsertion = observed.events.find((event) => event.eventType === "skylineInserted" && event.nodeId === eviction.evictedNodeId);
  const replacementInsertion = observed.events.find((event) => event.eventType === "skylineInserted" && event.nodeId === eviction.replacementNodeId);
  assert(evictedInsertion, "eviction should identify the previously inserted node");
  assert(replacementInsertion, "eviction should identify the replacement node");
  assert.equal(eviction.exactStateKey, evictedInsertion.exactStateKey);
  assert.equal(eviction.replacementExactStateKey, replacementInsertion.exactStateKey);
  assert.notEqual(eviction.exactStateKey, eviction.replacementExactStateKey);
  const dominance = observed.events.find(
    (event) => event.eventType === "candidateRejected" && event.reasonCode === "dominance-rejected",
  );
  assert(dominance, "synthetic search should exercise dominance rejection");
  assert(Array.isArray(dominance.dominanceWitnesses));
  assert(dominance.dominanceWitnesses.length > 0, "dominance rejection needs a witness");
  assert(dominance.dominanceComparison, "dominance rejection needs comparison details");
  assert.equal(typeof dominance.dominanceComparison.mode, "string");
  assert(dominance.dominanceStateDiff, "dominance rejection needs compact state diff");
  assert(dominance.dominanceWitnesses[0].action, "dominance witness needs the blocking action");
  assert(Array.isArray(dominance.dominanceWitnesses[0].skylineRoles));
  assert.equal(dominance.dominanceWitnessStates, undefined, "compact capture must not retain raw state");
  assert.equal(observed.result.diagnostics.dp.observerCaptureMode, "compact");
  assert.equal(typeof observed.result.diagnostics.dp.observerCaptureElapsedMs, "number");
  assert.equal(typeof observed.result.diagnostics.dp.wallMs, "number");
}

function checkTargetedCaptureFilter() {
  const noCaptureEvents = [];
  const noCaptureResult = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 12,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 90,
    observerCaptureMode: "compact",
    observer: {
      shouldCaptureDominanceWitness: () => false,
      onEvent: (event) => noCaptureEvents.push(event),
    },
  });
  const noCaptureDominanceEvents = noCaptureEvents.filter(
    (event) => event.eventType === "candidateRejected" && event.reasonCode === "dominance-rejected",
  );
  assert(noCaptureResult.bestGoalState, "disabled capture must not change the search result");
  assert(noCaptureDominanceEvents.length > 0);
  noCaptureDominanceEvents.forEach((event) => {
    assert.equal(event.dominanceWitnesses.length, 0);
    assert.equal(event.dominanceStateDiff, null);
    assert.equal(event.dominanceWitnessStates, undefined);
  });

  const throwingResult = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 12,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 90,
    observerCaptureMode: "compact",
    observer: {
      shouldCaptureDominanceWitness() {
        throw new Error("synthetic capture predicate failure");
      },
      onEvent() {},
    },
  });
  assert(throwingResult.bestGoalState, "capture predicate failure must not change the search result");
  assert(throwingResult.diagnostics.dp.observerErrors > 0);

  const events = [];
  let predicateCalls = 0;
  let captured = 0;
  const result = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 12,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 90,
    observerCaptureMode: "targeted-state",
    observer: {
      includeExactStateKey: true,
      shouldCaptureDominanceWitness(meta) {
        predicateCalls += 1;
        return meta && meta.action && meta.action.summary && captured === 0;
      },
      onEvent(event) {
        if (event.reasonCode === "dominance-rejected" && event.dominanceWitnesses.length > 0) captured += 1;
        events.push(event);
      },
    },
  });
  const dominanceEvents = events.filter(
    (event) => event.eventType === "candidateRejected" && event.reasonCode === "dominance-rejected",
  );
  assert(result.bestGoalState, "targeted capture must not change the search result");
  assert(predicateCalls > 0, "targeted capture predicate should be called");
  assert.equal(dominanceEvents.filter((event) => event.dominanceWitnesses.length > 0).length, 1);
  assert(dominanceEvents.some((event) => event.dominanceWitnessStates));
  assert.equal(result.diagnostics.dp.observerCaptureMode, "targeted-state");
  assert(result.diagnostics.dp.observerCaptureElapsedMs >= 0);
}

function checkTrimAndBudget() {
  const trimmed = collectEvents({ maxExpansions: 1, maxActionsPerState: 1 });
  assert(trimmed.result.diagnostics.dp.actionTrimmed > 0, "small action quota should trim candidates");
  assert(trimmed.events.some((event) => event.reasonCode === "action-trimmed"));
  const budgetEvent = trimmed.events.find((event) => event.eventType === "budgetStopped" && event.reasonCode === "expansion-limit");
  assert(budgetEvent, "expansion limit should emit a budget event");
  assert(budgetEvent.frontierSize > 0, "budget stop should retain a live frontier in this synthetic case");
  return trimmed;
}

function checkEventFilter() {
  const filtered = [];
  const result = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 2,
    goalPredicate: (state) => state.hero.hp >= 90,
    observer: {
      eventTypes: ["candidateRejected"],
      eventFilter: (event) => event.reasonCode === "dominance-rejected",
      onEvent: (event) => filtered.push(event),
    },
  });
  assert(result.bestGoalState, "event filtering must not change the search result");
  assert(filtered.length > 0, "event filter should retain matching events");
  assert(filtered.every((event) => event.eventType === "candidateRejected" && event.reasonCode === "dominance-rejected"));
}

function checkSkylineCapacityRejection() {
  const events = [];
  const simulator = {
    project: {
      floorsById: {
        SYNTHETIC: { floorId: "SYNTHETIC", width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], changeFloor: {} },
      },
    },
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => state.route.length > 0
      ? { actions: [] }
      : {
          actions: [
            { kind: "battle", summary: "battle:a-low@SYNTHETIC:2,1" },
            { kind: "battle", summary: "battle:b-mid@SYNTHETIC:2,1" },
            { kind: "battle", summary: "battle:z-goal@SYNTHETIC:2,1" },
          ],
        },
    applyAction: (state, action) => {
      const next = makeState(action.summary.includes("z-goal") ? 100 : action.summary.includes("b-mid") ? 70 : 60, state.route.concat(action.summary));
      next.hero.loc = { x: 2, y: 1, direction: "down" };
      return next;
    },
  };
  const result = searchDP(simulator, makeState(50, []), {
    maxExpansions: 1,
    maxActionsPerState: 10,
    // dpSkylineMax=1 uses the legacy single-state Map; 2 exercises SkylineSet.add(false).
    dpSkylineMax: 2,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 100,
    dominanceConfig: { compare: () => 1 },
    skylineCompare: () => -1,
    observer: { includeExactStateKey: true, onEvent: (event) => events.push(event) },
  });
  const rejected = events.find((event) => event.eventType === "candidateRejected" && event.reasonCode === "skyline-capacity-rejected");
  assert(rejected, "skyline capacity rejection should be observed");
  assert.equal(rejected.action.summary, "battle:z-goal@SYNTHETIC:2,1");
  assert(!events.some((event) => event.eventType === "skylineInserted" && event.action && event.action.summary === rejected.action.summary));
  assert(!events.some((event) => event.eventType === "goalAccepted" && event.action && event.action.summary === rejected.action.summary));
  assert.equal(result.bestGoalState, null, "capacity-rejected goal must not be returned");
  assert.equal(result.diagnostics.dp.actionsKeptByKind.battle, 2);
  assert.equal(result.diagnostics.dp.actionsDominatedByKind.battle, 1);
}

function checkProviderError() {
  const events = [];
  const result = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 1,
    goalPredicate: () => false,
    actionProvider: () => { throw new Error("synthetic provider failure"); },
    observer: { onEvent: (event) => events.push(event) },
  });
  assert.equal(result.bestGoalState, null);
  const errorEvent = events.find((event) => event.eventType === "actionProviderError");
  assert(errorEvent, "provider exception should be observed");
  assert.equal(errorEvent.reasonCode, "action-provider-error");
  return result;
}

function checkObserverCallbackFailure() {
  const result = searchDP(makeSimulator(), makeState(50, []), {
    maxExpansions: 1,
    goalPredicate: () => false,
    observer: { onActionSetGenerated: () => { throw new Error("observer failure"); } },
  });
  assert.equal(result.diagnostics.dp.observerEnabled, true);
  assert(result.diagnostics.dp.observerErrors > 0, "observer errors should be counted");
}

function main() {
  const observed = checkObserverDoesNotChangeResult();
  checkEventCoverage(observed);
  checkTrimAndBudget();
  checkEventFilter();
  checkSkylineCapacityRejection();
  checkProviderError();
  checkObserverCallbackFailure();
  checkTargetedCaptureFilter();
  console.log(`check-dp-observer: ok events=${observed.events.length}`);
}

if (require.main === module) main();

module.exports = {
  main,
  checkObserverDoesNotChangeResult,
  checkEventCoverage,
  checkTrimAndBudget,
  checkEventFilter,
  checkSkylineCapacityRejection,
  checkProviderError,
  checkObserverCallbackFailure,
  checkTargetedCaptureFilter,
};
