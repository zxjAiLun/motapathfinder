"use strict";

const { resolveRecordedAction } = require("./route-store");
const { buildStateKey } = require("./state-key");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function heroSummary(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    loc: hero.loc ? { x: hero.loc.x, y: hero.loc.y } : null,
  };
}

function exactStateKey(state) {
  if (!state) return null;
  try {
    return buildStateKey(state);
  } catch (error) {
    return null;
  }
}

function compactAction(simulator, action) {
  if (!action) return null;
  let fingerprint = action.fingerprint || null;
  if (!fingerprint && simulator && typeof simulator.getActionFingerprint === "function") {
    try {
      fingerprint = simulator.getActionFingerprint(action);
    } catch (error) {
      fingerprint = null;
    }
  }
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    fingerprint,
  };
}

function normalizeWindow(window) {
  if (window === "until-goal" || window === "until-failure") return window;
  const parsed = Number(window);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

/**
 * Replay teacher decisions from a dominance witness without feeding teacher
 * actions into production search. The witness state is supplied by the
 * diagnostics observer and is never serialized as part of the report.
 */
function runTeacherContinuationAudit(simulator, teacherIndex, witnessState, options) {
  const config = options || {};
  const allSteps = Array.isArray(teacherIndex && teacherIndex.steps)
    ? teacherIndex.steps
    : [];
  const startStep = Math.max(0, number(config.startStep, 0));
  const window = normalizeWindow(config.window);
  const goalPredicate = typeof config.goalPredicate === "function"
    ? config.goalPredicate
    : null;
  const maxStep = typeof window === "number"
    ? Math.min(allSteps.length, startStep + window)
    : allSteps.length;
  let state = witnessState;
  const steps = [];
  let failureStep = null;
  let goalReachedAt = null;

  for (let index = startStep; index < maxStep; index += 1) {
    const teacherStep = allSteps[index] || {};
    const decision = teacherStep.decision || {
      summary: teacherStep.summary,
      kind: teacherStep.kind,
      fingerprint: teacherStep.actionFingerprint,
    };
    let resolved = null;
    let action = null;
    let failureReason = null;
    try {
      resolved = resolveRecordedAction(simulator, state, decision, {
        project: simulator.project,
      });
      action = resolved && resolved.action || null;
      if (!action) failureReason = resolved && resolved.reason || "teacher-action-not-resolved";
    } catch (error) {
      failureReason = error && error.message ? error.message : String(error);
    }
    let resultingState = null;
    let actionApplicable = false;
    if (action) {
      try {
        const applied = simulator.applyAction(state, action, { storeRoute: false });
        const successors = Array.isArray(applied) ? applied : [applied];
        resultingState = successors.find(
          (candidate) => exactStateKey(candidate) === teacherStep.postExactStateKey,
        ) || successors[0] || null;
        actionApplicable = successors.length > 0 && Boolean(resultingState);
        if (!resultingState) failureReason = "teacher-action-no-successor";
        else if (exactStateKey(resultingState) !== teacherStep.postExactStateKey) {
          failureReason = "teacher-post-exact-mismatch";
        }
      } catch (error) {
        failureReason = error && error.message ? error.message : String(error);
      }
    }
    const result = {
      step: index,
      actionResolved: Boolean(action),
      actionApplicable,
      action: compactAction(simulator, action),
      teacherActionFingerprint: teacherStep.actionFingerprint || null,
      resultingHero: resultingState ? heroSummary(resultingState) : null,
      resultingExactStateKey: exactStateKey(resultingState),
      failureReason,
    };
    steps.push(result);
    if (failureReason && failureStep == null) {
      failureStep = index;
      if (window === "until-failure" || config.stopOnFailure !== false) break;
    }
    if (resultingState) {
      state = resultingState;
      if (goalPredicate && goalPredicate(state)) {
        goalReachedAt = index;
        if (window === "until-goal") break;
      }
    }
  }

  return {
    startStep,
    window,
    toStep: maxStep,
    success: failureStep == null,
    failureStep,
    goalReachedAt,
    steps,
    finalHero: state ? heroSummary(state) : null,
    finalExactStateKey: exactStateKey(state),
  };
}

module.exports = {
  runTeacherContinuationAudit,
};
