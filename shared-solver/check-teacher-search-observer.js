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

  const poppedThenEvicted = runCase([
    event("skylineInserted", post, {
      nodeId: 2,
      action: action("battle:teacher", "fp:teacher", "1:0", "1:0:0"),
    }),
    event("agendaPopped", post, { nodeId: 2 }),
    event("skylineEvicted", post, { evictedNodeId: 2, replacementNodeId: 3 }),
  ], index);
  assert.equal(poppedThenEvicted.steps[0].outcome, "teacher-post-inserted");
  assert.deepEqual(poppedThenEvicted.steps[0].poppedTeacherPostNodeIds, [2]);
  assert.deepEqual(poppedThenEvicted.steps[0].evictedBeforePopNodeIds, []);

  const providerError = runCase([
    event("agendaPopped", pre, { nodeId: 1 }),
    event("actionProviderError", pre, {
      reasonCode: "action-provider-error",
      error: { name: "Error", message: "synthetic provider failure" },
    }),
  ], index);
  assert.equal(providerError.steps[0].outcome, "teacher-action-provider-error");
  assert.equal(providerError.firstObservedSearchDivergenceStep, 0);

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

function checkPreNodeLineageAndCompetition() {
  const pre0 = makeState(50, [1, 1]);
  const pre1 = makeState(40, [2, 1], ["battle:first"]);
  const post1 = makeState(30, [3, 1], ["battle:first", "battle:second"]);
  const index = {
    steps: [
      {
        step: 0,
        summary: "battle:first",
        actionFingerprint: "fp:first",
        preExactStateKey: buildStateKey(pre0),
        postExactStateKey: buildStateKey(pre1),
      },
      {
        step: 1,
        summary: "battle:second",
        actionFingerprint: "fp:second",
        preExactStateKey: buildStateKey(pre1),
        postExactStateKey: buildStateKey(post1),
      },
    ],
    decisionCount: 2,
  };
  const rank = (sourceActionRank, sequence) => ({
    priorityMode: "default",
    bestFloorRank: 1,
    finiteNextDistance: 1,
    nextDistance: 1,
    currentFloorRank: 1,
    hp: 50,
    atk: 1,
    def: 1,
    mdef: 0,
    lv: 1,
    exp: 0,
    sourceActionRank,
    decisionDepth: sequence,
    routeLength: sequence,
    sequence,
  });
  const collector = createTeacherSearchObserver(index, { fromStep: 0, toStep: 2 });
  collector.observer.onEvent(event("skylineInserted", pre0, {
    nodeId: 1,
    parentId: null,
    action: null,
    agendaRank: rank(0, 0),
    enqueueExpansion: 0,
    enqueueElapsedMs: 0,
    agendaSizeAfterInsert: 1,
  }));
  collector.observer.onEvent(event("agendaPopped", pre0, {
    nodeId: 1,
    parentId: null,
    agendaRank: rank(0, 0),
    popExpansion: 0,
    popElapsedMs: 0,
    queueAgeExpansions: 0,
    queueAgeMs: 0,
  }));
  collector.observer.onEvent(event("candidateGenerated", pre0, {
    nodeId: 1,
    action: action("battle:first", "fp:first", "1:0", "1:0:0"),
  }));
  collector.observer.onEvent(event("skylineInserted", pre1, {
    nodeId: 2,
    parentId: 1,
    action: action("battle:first", "fp:first", "1:0", "1:0:0"),
    agendaRank: rank(5, 1),
    enqueueExpansion: 1,
    enqueueElapsedMs: 1,
    agendaSizeAfterInsert: 2,
  }));
  const competitor = makeState(45, [3, 1], ["competitor"]);
  collector.observer.onEvent(event("skylineInserted", competitor, {
    nodeId: 3,
    parentId: 1,
    action: action("battle:competitor", "fp:competitor", "1:1", "1:1:0"),
    agendaRank: rank(14, 2),
    enqueueExpansion: 1,
    enqueueElapsedMs: 1,
    agendaSizeAfterInsert: 3,
  }));
  collector.observer.onEvent(event("agendaPopped", competitor, {
    nodeId: 3,
    parentId: 1,
    action: action("battle:competitor", "fp:competitor", "1:1", "1:1:0"),
    agendaRank: rank(14, 2),
    popExpansion: 1,
    popElapsedMs: 2,
    queueAgeExpansions: 0,
    queueAgeMs: 1,
  }));
  collector.observer.onEvent(event("agendaPopped", pre1, {
    nodeId: 2,
    parentId: 1,
    agendaRank: rank(5, 1),
    popExpansion: 2,
    popElapsedMs: 3,
    queueAgeExpansions: 1,
    queueAgeMs: 2,
  }));
  collector.observer.onEvent(event("candidateGenerated", pre1, {
    nodeId: 2,
    action: action("battle:second", "fp:second", "2:0", "2:0:0"),
  }));
  collector.observer.onEvent(event("skylineInserted", post1, {
    nodeId: 4,
    parentId: 2,
    action: action("battle:second", "fp:second", "2:0", "2:0:0"),
    agendaRank: rank(5, 3),
    enqueueExpansion: 3,
    enqueueElapsedMs: 4,
    agendaSizeAfterInsert: 2,
  }));
  const report = collector.finalize({ diagnostics: { dp: {} }, frontierSize: 1 });
  assert.deepEqual(report.steps[0].teacherPreNodeIds, [1]);
  assert.deepEqual(report.steps[1].teacherPreNodeIds, [2]);
  assert.deepEqual(report.steps[1].poppedTeacherPreNodeIds, [2]);
  assert.equal(report.steps[1].teacherPreNodeDetails[0].enqueueExpansion, 1);
  assert.equal(report.steps[1].teacherPreNodeDetails[0].popExpansion, 2);
  assert.equal(report.steps[1].teacherPreNodeDetails[0].queueAgeExpansions, 1);
  assert.equal(report.steps[1].competitionSamples.earliest.length, 1);
  assert.equal(report.steps[1].competitionSamples.earliest[0].nodeId, 3);
  assert.equal(report.steps[1].competitionSamples.earliest[0].action.summary, "battle:competitor");
  assert.equal(report.steps[1].competitionSamples.earliest[0].rankDifferenceReason.field, "sourceActionRank");
  assert.equal(report.steps[1].outcome, "teacher-step-survived");

  const providerCollector = createTeacherSearchObserver(index, { fromStep: 0, toStep: 2 });
  providerCollector.observer.onEvent(event("skylineInserted", pre0, {
    nodeId: 20,
    parentId: null,
    action: null,
  }));
  providerCollector.observer.onEvent(event("skylineInserted", pre1, {
    nodeId: 21,
    parentId: 20,
    action: action("battle:first", "fp:first", "20:0", "20:0:0"),
  }));
  providerCollector.observer.onEvent(event("actionProviderError", pre1, {
    nodeId: 21,
    reasonCode: "action-provider-error",
  }));
  const providerReport = providerCollector.finalize({ diagnostics: { dp: {} } });
  assert.equal(providerReport.steps[0].actionProviderError, false);
  assert.equal(providerReport.steps[1].actionProviderError, true);

  const pendingCollector = createTeacherSearchObserver(index, { fromStep: 0, toStep: 1 });
  pendingCollector.observer.onEvent(event("skylineInserted", pre0, {
    nodeId: 10,
    parentId: null,
    action: null,
    agendaRank: rank(0, 0),
  }));
  const pending = pendingCollector.finalize({
    diagnostics: { dp: {} },
    frontierSize: 1,
  });
  const pendingOutcomeBeforeBudget = pending.steps[0].outcome;
  pendingCollector.observer.onEvent(event("budgetStopped", pre0, {
    frontierSize: 1,
    expansions: 0,
  }));
  const pendingAfterBudget = pendingCollector.finalize({
    diagnostics: { dp: {} },
    frontierSize: 1,
  });
  assert.equal(pendingOutcomeBeforeBudget, "teacher-pre-state-not-reached");
  assert.deepEqual(pendingAfterBudget.steps[0].pendingTeacherPreNodeIds, [10]);
  assert.equal(pendingAfterBudget.steps[0].outcome, "teacher-pre-state-pending-at-budget");
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
  assert.equal(observation.searchConfig.agendaMode, "best-first");
  assert.equal(observation.searchConfig.keyMode, "region");
  assert.equal(observation.searchConfig.maxExpansions, 2);
  assert.equal(observation.searchConfig.maxRuntimeMs, 1000);
  assert.equal(observation.searchConfig.actionProviderMode, "segment-provider");
  assert.equal(typeof observation.timing.searchElapsedMs, "number");
  assert.equal(typeof observation.timing.continuationAuditElapsedMs, "number");
  assert.equal(typeof observation.timing.totalElapsedMs, "number");
}

function checkDominanceContinuationIntegration() {
  const pre0 = makeState(50, [1, 1]);
  const post0 = makeState(45, [2, 1], ["battle:first"]);
  const post1 = makeState(40, [3, 1], ["battle:first", "battle:second"]);
  const index = {
    steps: [
      {
        step: 0,
        decision: { kind: "battle", summary: "battle:first", fingerprint: "fp:first" },
        summary: "battle:first",
        actionFingerprint: "fp:first",
        preExactStateKey: buildStateKey(pre0),
        postExactStateKey: buildStateKey(post0),
      },
      {
        step: 1,
        decision: { kind: "battle", summary: "battle:second", fingerprint: "fp:second" },
        summary: "battle:second",
        actionFingerprint: "fp:second",
        preExactStateKey: buildStateKey(post0),
        postExactStateKey: buildStateKey(post1),
      },
    ],
    decisionCount: 2,
  };
  let applyCalls = 0;
  const simulator = {
    project: {},
    getActionFingerprint: (actionEntry) => actionEntry.fingerprint || `fp:${actionEntry.summary}`,
    enumeratePrimitiveActions: (state) => ({
      actions: state.route.length === 1
        ? [{ kind: "battle", summary: "battle:second", fingerprint: "fp:second" }]
        : [],
    }),
    applyAction: (state, actionEntry) => {
      applyCalls += 1;
      return makeState(
        state.hero.hp - 5,
        [3, 1],
        state.route.concat(actionEntry.summary),
      );
    },
  };
  const collector = createTeacherSearchObserver(index, {
    fromStep: 0,
    toStep: 2,
    simulator,
    continuationAudit: { windows: [1], maxWitnesses: 1 },
  });
  collector.observer.onEvent(event("candidateRejected", post0, {
    reasonCode: "dominance-rejected",
    action: action("battle:first", "fp:first", "1:0", "1:0:0"),
    dominanceWitnesses: [{ nodeId: 9, action: action("battle:first", "fp:first") }],
    dominanceWitnessStates: [post0],
  }));
  assert.equal(applyCalls, 0, "continuation must not run from the observer callback");
  const report = collector.finalize({ diagnostics: { dp: {} }, frontierSize: 1 });
  const audits = report.steps[0].dominanceContinuationAudits;
  assert.equal(report.steps[0].outcome, "teacher-post-dominance-rejected");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].success, true);
  assert.equal(audits[0].steps[0].actionResolved, true);
  assert.equal(audits[0].steps[0].actionApplicable, true);
  assert.equal(audits[0].steps[0].teacherActionFingerprint, "fp:second");
  assert.equal(report.firstBenignDominanceStep, 0);
  assert.equal(report.firstHardDivergenceStep, null);
  assert(applyCalls > 0, "continuation should run during finalize after search events");
}

function checkFairnessTargetSummary() {
  const pre0 = makeState(50, [1, 1]);
  const pre1 = makeState(40, [2, 1], ["battle:first"]);
  const post1 = makeState(30, [3, 1], ["battle:first", "battle:target"]);
  const index = {
    steps: [
      {
        step: 0,
        summary: "battle:first",
        actionFingerprint: "fp:first",
        preExactStateKey: buildStateKey(pre0),
        postExactStateKey: buildStateKey(pre1),
      },
      {
        step: 1,
        summary: "battle:target",
        actionFingerprint: "fp:target",
        preExactStateKey: buildStateKey(pre1),
        postExactStateKey: buildStateKey(post1),
      },
    ],
    decisionCount: 2,
  };
  const collector = createTeacherSearchObserver(index, {
    fromStep: 0,
    toStep: 2,
    fairnessTargetStep: 1,
  });
  collector.observer.onEvent(event("skylineInserted", pre0, {
    nodeId: 1,
    parentId: null,
    fairQueueOrdinal: 0,
    fairCursorAtEnqueue: 0,
    fairPopsAtEnqueue: 0,
    olderEntriesAheadAtEnqueue: 0,
    enqueueExpansion: 0,
  }));
  collector.observer.onEvent(event("agendaPopped", pre0, {
    nodeId: 1,
    popSource: "best-first",
    expansionOrdinal: 1,
  }));
  collector.observer.onEvent(event("skylineInserted", pre1, {
    nodeId: 2,
    parentId: 1,
    action: action("battle:first", "fp:first", "1:0", "1:0:0"),
    fairQueueOrdinal: 1,
    fairCursorAtEnqueue: 0,
    fairPopsAtEnqueue: 0,
    olderEntriesAheadAtEnqueue: 0,
    enqueueExpansion: 1,
  }));
  collector.observer.onEvent(event("budgetStopped", pre1, {
    reasonCode: "expansion-limit",
    frontierSize: 1,
    expansions: 1,
    fairCursor: 0,
    fairPops: 0,
    fairnessEvery: 4,
  }));
  const report = collector.finalize({
    diagnostics: {
      dp: {
        agendaFairness: {
          enabled: true,
          fairnessEvery: 4,
          fairPops: 0,
          fairCursor: 0,
        },
      },
    },
    expansions: 1,
    frontierSize: 1,
  });
  assert.equal(report.targetStepSummary.step, 1);
  assert.equal(report.targetStepSummary.preReached, true);
  assert.equal(report.targetStepSummary.preExpanded, false);
  assert.equal(report.targetStepSummary.fairnessAudit.fairQueueOrdinal, 1);
  assert.equal(report.targetStepSummary.fairnessAudit.fairCursorAtStop, 0);
  assert.equal(report.targetStepSummary.fairnessAudit.fairPopsAfterEnqueue, 0);
  assert.equal(report.targetStepSummary.fairnessAudit.estimatedFairPopOrdinal, 4);
  assert.equal(report.targetStepSummary.fairnessAudit.poppedBy, null);
  assert.equal(report.firstInconclusiveStep, 1);
}

function main() {
  checkTeacherStepSurvived();
  checkPostInsertedOutcome();
  checkActionNotGenerated();
  checkTrimDominanceSkyline();
  checkEvictionAndBudget();
  checkExactAndMultiSuccessorMatching();
  checkPreNodeLineageAndCompetition();
  checkLegacyIndexUpgrade();
  checkSegmentForwarding();
  checkDominanceContinuationIntegration();
  checkFairnessTargetSummary();
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
  checkPreNodeLineageAndCompetition,
  checkLegacyIndexUpgrade,
  checkSegmentForwarding,
  checkDominanceContinuationIntegration,
  checkFairnessTargetSummary,
};
