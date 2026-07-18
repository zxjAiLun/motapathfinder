"use strict";

/**
 * TEST GRADE: unit
 *
 * Synthetic contract checks for real-search teacher event classification.
 * No tower project or teacher action sequence is loaded here.
 */

const assert = require("node:assert");

const { syncProgress } = require("./lib/progress");
const { buildStateKey } = require("./lib/state-key");
const {
  buildTeacherStepIndex,
  createTeacherSearchObserver,
  runTeacherSearchObservation,
} = require("./lib/teacher-search-observer");

function makeState(hp, loc, route) {
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
      loc: { x: loc[0], y: loc[1], direction: "down" },
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

function makeIndex(pre, post, fingerprint, summary) {
  return {
    steps: [{
      step: 0,
      summary,
      actionFingerprint: fingerprint,
      preExactStateKey: buildStateKey(pre),
      postExactStateKey: buildStateKey(post),
    }],
    decisionCount: 1,
  };
}

function action(summary, fingerprint, candidateId, successorId) {
  return {
    kind: "battle",
    summary,
    fingerprint,
    candidateId,
    successorId,
  };
}

function event(eventType, state, extra) {
  return {
    eventVersion: "dp-observer.v1",
    eventType,
    exactStateKey: buildStateKey(state),
    ...(extra || {}),
  };
}

function runCase(events, index) {
  const collector = createTeacherSearchObserver(index, { fromStep: 0, toStep: 1 });
  events.forEach((item) => collector.observer.onEvent(item));
  return collector.finalize({
    diagnostics: { dp: { stoppedReason: null } },
    expansions: 1,
    frontierSize: 0,
  });
}

function checkTeacherStepSurvived() {
  const pre = makeState(50, [1, 1]);
  const post = makeState(40, [2, 1], ["battle:teacher"]);
  const index = makeIndex(pre, post, "fp:teacher", "battle:teacher");
  const report = runCase([
    event("agendaPopped", pre, { nodeId: 1 }),
    event("candidateGenerated", pre, { action: action("battle:teacher", "fp:teacher", "1:0", "1:0:0") }),
    event("skylineInserted", post, { action: action("battle:teacher", "fp:teacher", "1:0", "1:0:0"), nodeId: 2 }),
  ], index);
  assert.equal(report.steps[0].outcome, "teacher-step-survived");
}

function checkPostInsertedOutcome() {
  const pre = makeState(50, [1, 1]);
  const post = makeState(40, [2, 1]);
  const index = makeIndex(pre, post, "fp:teacher", "battle:teacher");
  const report = runCase([
    event("skylineInserted", post, {
      action: action("battle:teacher", "fp:teacher", "1:0", "1:0:0"),
      nodeId: 2,
    }),
  ], index);
  assert.equal(report.steps[0].outcome, "teacher-post-inserted");
}

function checkActionNotGenerated() {
  const pre = makeState(50, [1, 1]);
  const post = makeState(40, [2, 1]);
  const index = makeIndex(pre, post, "fp:teacher", "battle:teacher");
  const report = runCase([event("agendaPopped", pre, { nodeId: 1 })], index);
  assert.equal(report.steps[0].outcome, "teacher-action-not-generated");
  assert.equal(report.firstObservedSearchDivergenceStep, 0);
}

function checkTrimDominanceSkyline() {
  const pre = makeState(50, [1, 1]);
  const post = makeState(40, [2, 1]);
  const index = makeIndex(pre, post, "fp:teacher", "battle:teacher");
  const trimmed = runCase([
    event("candidateRejected", pre, {
      reasonCode: "action-trimmed",
      action: action("battle:teacher", "fp:teacher", "1:trimmed:0", null),
    }),
  ], index);
  assert.equal(trimmed.steps[0].outcome, "teacher-action-trimmed");

  const dominance = runCase([
    event("candidateRejected", post, {
      reasonCode: "dominance-rejected",
      action: action("battle:teacher", "fp:teacher", "1:0", "1:0:0"),
    }),
  ], index);
  assert.equal(dominance.steps[0].outcome, "teacher-post-dominance-rejected");

  const skyline = runCase([
    event("candidateRejected", post, {
      reasonCode: "skyline-capacity-rejected",
      action: action("battle:teacher", "fp:teacher", "1:0", "1:0:0"),
    }),
  ], index);
  assert.equal(skyline.steps[0].outcome, "teacher-post-skyline-rejected");
}

function checkEvictionAndBudget() {
  const pre = makeState(50, [1, 1]);
  const post = makeState(40, [2, 1]);
  const index = makeIndex(pre, post, "fp:teacher", "battle:teacher");
  const evicted = runCase([
    event("skylineInserted", post, { nodeId: 2, action: action("battle:teacher", "fp:teacher") }),
    event("skylineEvicted", post, { evictedNodeId: 2, replacementNodeId: 3 }),
  ], index);
  assert.equal(evicted.steps[0].outcome, "teacher-post-evicted");
  assert.equal(evicted.firstObservedSearchDivergenceStep, 0);

  const pending = runCase([
    event("skylineInserted", pre, { nodeId: 1 }),
    event("budgetStopped", pre, { reasonCode: "expansion-limit", frontierSize: 1, expansions: 1 }),
  ], index);
  assert.equal(pending.steps[0].outcome, "teacher-pre-state-pending-at-budget");
  assert.equal(pending.firstObservedSearchDivergenceStep, null);
  assert.equal(pending.firstInconclusiveStep, 0);
}

function checkExactAndMultiSuccessorMatching() {
  const pre = makeState(50, [1, 1]);
  const wrongPost = makeState(30, [2, 1], ["wrong"]);
  const correctPost = makeState(40, [2, 1], ["correct"]);
  const index = makeIndex(pre, correctPost, "fp:shared", "battle:shared");
  const collector = createTeacherSearchObserver(index, { fromStep: 0, toStep: 1 });
  collector.observer.onEvent(event("candidateGenerated", pre, {
    action: action("battle:shared", "fp:shared", "1:0", "1:0:0"),
  }));
  collector.observer.onEvent(event("skylineInserted", wrongPost, {
    action: action("battle:shared", "fp:shared", "1:0", "1:0:0"),
    nodeId: 2,
    successorId: "1:0:0",
  }));
  collector.observer.onEvent(event("skylineInserted", correctPost, {
    action: action("battle:shared", "fp:shared", "1:0", "1:0:1"),
    nodeId: 3,
    successorId: "1:0:1",
  }));
  const report = collector.finalize({ diagnostics: { dp: {} }, frontierSize: 0 });
  assert.equal(report.steps[0].outcome, "teacher-step-survived");
  assert.deepEqual(report.steps[0].successorIds, ["1:0:1"]);

  const wrongFingerprint = runCase([
    event("agendaPopped", pre, { nodeId: 1 }),
    event("candidateGenerated", pre, {
      action: action("battle:shared", "fp:other", "1:0", "1:0:0"),
    }),
  ], index);
  assert.equal(wrongFingerprint.steps[0].outcome, "teacher-action-not-generated");
}

function checkLegacyIndexUpgrade() {
  const pre = makeState(50, [1, 1]);
  const post = makeState(40, [2, 1], ["battle:teacher"]);
  const actionSummary = "battle:teacher";
  const simulator = {
    project: {},
    createInitialState: () => pre,
    getActionFingerprint: (actionEntry) => `fp:${actionEntry.summary}`,
    enumeratePrimitiveActions: () => ({ actions: [{ kind: "battle", summary: actionSummary }] }),
    applyAction: () => post,
  };
  const index = buildTeacherStepIndex(simulator, {
    decisions: [{ kind: "battle", summary: actionSummary }],
  });
  assert.equal(index.steps[0].preExactStateKey, buildStateKey(pre));
  assert.equal(index.steps[0].postExactStateKey, buildStateKey(post));
  assert.equal(index.steps[0].actionFingerprint, "fp:battle:teacher");
}

function checkSegmentForwarding() {
  const pre = makeState(50, [1, 1]);
  const post = makeState(90, [2, 1], ["battle:teacher"]);
  const summary = "battle:teacher";
  const simulator = {
    project: {
      floorsById: {
        SYNTHETIC: { floorId: "SYNTHETIC", width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
      },
    },
    getActionFingerprint: (actionEntry) => `fp:${actionEntry.summary}`,
    createInitialState: () => pre,
    enumeratePrimitiveActions: (state) => state.route.length > 0
      ? { actions: [] }
      : { actions: [{ kind: "battle", summary, floorId: "SYNTHETIC", estimate: { damage: 1 } }] },
    applyAction: () => post,
  };
  const teacherIndex = buildTeacherStepIndex(simulator, {
    decisions: [{ kind: "battle", summary, fingerprint: "fp:battle:teacher" }],
  });
  const observation = runTeacherSearchObservation(simulator, pre, {
    id: "synthetic-segment",
    goal: { floorId: "SYNTHETIC", minHero: { hp: 90 } },
    actionPolicy: { allowedFloors: ["SYNTHETIC"] },
    dp: { maxExpansions: 2, maxRuntimeMs: 1000 },
  }, {
    teacherIndex,
    fromStep: 0,
    toStep: 1,
  });
  assert.equal(observation.steps[0].outcome, "teacher-step-survived");
  assert.equal(observation.foundGoal, true);
  assert(observation.eventCount > 0, "segment DP must forward real observer events");
}

function main() {
  checkTeacherStepSurvived();
  checkPostInsertedOutcome();
  checkActionNotGenerated();
  checkTrimDominanceSkyline();
  checkEvictionAndBudget();
  checkExactAndMultiSuccessorMatching();
  checkLegacyIndexUpgrade();
  checkSegmentForwarding();
  console.log("check-teacher-search-observer: ok");
}

if (require.main === module) main();

module.exports = {
  main,
  checkTeacherStepSurvived,
  checkPostInsertedOutcome,
  checkActionNotGenerated,
  checkTrimDominanceSkyline,
  checkEvictionAndBudget,
  checkExactAndMultiSuccessorMatching,
  checkLegacyIndexUpgrade,
  checkSegmentForwarding,
};
