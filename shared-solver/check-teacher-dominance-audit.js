"use strict";

/**
 * TEST GRADE: unit
 *
 * Synthetic continuation checks for dominance witnesses. The continuation
 * helper is diagnostics-only and must never provide actions to searchDP.
 */

const assert = require("node:assert");

const { syncProgress } = require("./lib/progress");
const { buildStateKey } = require("./lib/state-key");
const { runTeacherContinuationAudit } = require("./lib/teacher-dominance-audit");

function makeState(route) {
  const state = {
    floorId: "SYNTHETIC",
    hero: {
      hp: 100,
      hpmax: 100,
      atk: 1,
      def: 1,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      mana: 0,
      manamax: 0,
      loc: { x: route.length, y: 1, direction: "right" },
      equipment: [],
      followers: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: { SYNTHETIC: true },
    floorStates: { SYNTHETIC: { removed: {}, replaced: {} } },
    route: route.slice(),
    notes: [],
    meta: { decisionDepth: route.length },
  };
  syncProgress(state);
  return state;
}

function buildTeacherIndex() {
  const pre = makeState([]);
  const postOne = makeState(["battle:one"]);
  const postTwo = makeState(["battle:one", "battle:two"]);
  return {
    steps: [
      {
        step: 0,
        decision: { kind: "battle", summary: "battle:one", fingerprint: "fp:one" },
        actionFingerprint: "fp:one",
        postExactStateKey: buildStateKey(postOne),
      },
      {
        step: 1,
        decision: { kind: "battle", summary: "battle:two", fingerprint: "fp:two" },
        actionFingerprint: "fp:two",
        postExactStateKey: buildStateKey(postTwo),
      },
    ],
    pre,
  };
}

function makeSimulator() {
  return {
    project: {},
    getActionFingerprint: (action) => action.fingerprint || `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => {
      if (state.route.length === 0) return { actions: [{ kind: "battle", summary: "battle:one", fingerprint: "fp:one" }] };
      if (state.route.length === 1) return { actions: [{ kind: "battle", summary: "battle:two", fingerprint: "fp:two" }] };
      return { actions: [] };
    },
    applyAction: (state, action) => makeState(state.route.concat(action.summary)),
  };
}

function checkContinuationWindows() {
  const teacher = buildTeacherIndex();
  const simulator = makeSimulator();
  const oneStep = runTeacherContinuationAudit(simulator, teacher, teacher.pre, {
    startStep: 0,
    window: 1,
  });
  assert.equal(oneStep.success, true);
  assert.equal(oneStep.steps.length, 1);
  assert.equal(oneStep.steps[0].actionResolved, true);
  assert.equal(oneStep.steps[0].actionApplicable, true);

  const threeSteps = runTeacherContinuationAudit(simulator, teacher, teacher.pre, {
    startStep: 0,
    window: 3,
  });
  assert.equal(threeSteps.success, true);
  assert.equal(threeSteps.steps.length, 2);
  assert.equal(threeSteps.finalHero.hp, 100);

  const missing = runTeacherContinuationAudit(simulator, teacher, makeState(["unrelated", "x"]), {
    startStep: 0,
    window: 3,
  });
  assert.equal(missing.success, false);
  assert.equal(missing.failureStep, 0);
  assert.equal(missing.steps[0].failureReason, "no-visible-actions");
}

function checkExactPostMismatch() {
  const teacher = buildTeacherIndex();
  const simulator = makeSimulator();
  const mismatchedTeacher = {
    ...teacher,
    steps: teacher.steps.map((step, index) => index === 0
      ? { ...step, postExactStateKey: buildStateKey(makeState(["wrong", "x"])) }
      : step),
  };
  const report = runTeacherContinuationAudit(simulator, mismatchedTeacher, teacher.pre, {
    startStep: 0,
    window: 1,
  });
  assert.equal(report.success, false);
  assert.equal(report.failureStep, 0);
  assert.equal(report.steps[0].actionResolved, true);
  assert.equal(report.steps[0].actionApplicable, true);
  assert.equal(report.steps[0].failureReason, "teacher-post-exact-mismatch");
}

function main() {
  checkContinuationWindows();
  checkExactPostMismatch();
  console.log("check-teacher-dominance-audit: ok");
}

if (require.main === module) main();

module.exports = {
  checkContinuationWindows,
  checkExactPostMismatch,
  main,
};
