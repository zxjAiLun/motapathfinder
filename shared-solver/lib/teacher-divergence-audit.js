"use strict";

/**
 * Teacher-forced divergence audit (test-side diagnostics only).
 *
 * Walks a known-good route decision-by-decision and reports where the
 * solver's visible action set, DP key abstraction, or HP dominance would
 * diverge from the teacher path. Production search must never import teacher
 * action sequences from this module.
 */

const { buildDpStateKey } = require("./dp-search");
const {
  getTiming,
  resourceTimingRoles,
  resourceTimingScore,
  hasTimingConflict,
  annotateStateResourceTiming,
} = require("./resource-timing-model");
const { getDecisionDepth } = require("./state");

const AUDIT_VERSION = "teacher-divergence.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function heroSummary(state) {
  const hero = (state && state.hero) || {};
  return {
    floorId: state && state.floorId,
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
    loc: hero.loc ? { x: hero.loc.x, y: hero.loc.y } : null,
  };
}

function decisionDepthOf(state) {
  return getDecisionDepth(state);
}

function isBetterForSameDpKey(left, right) {
  if (!right) return true;
  const leftHp = number((left.hero || {}).hp, 0);
  const rightHp = number((right.hero || {}).hp, 0);
  if (leftHp !== rightHp) return leftHp > rightHp;
  const leftDepth = decisionDepthOf(left);
  const rightDepth = decisionDepthOf(right);
  if (leftDepth !== rightDepth) return leftDepth < rightDepth;
  const leftRoute = Array.isArray(left.route) ? left.route.length : leftDepth;
  const rightRoute = Array.isArray(right.route) ? right.route.length : rightDepth;
  return leftRoute < rightRoute;
}

function enumerateVisibleActions(simulator, state) {
  const bySummary = new Map();
  const pushAll = (actions) => {
    for (const action of actions || []) {
      if (!action || !action.summary) continue;
      if (!bySummary.has(action.summary)) bySummary.set(action.summary, action);
    }
  };

  try {
    pushAll((simulator.enumeratePrimitiveActions(state) || {}).actions || []);
  } catch (error) {
    // Primitive enumeration can throw on unsupported events; keep going.
  }
  try {
    pushAll(simulator.enumerateActions(state) || []);
  } catch (error) {
    // ignore
  }
  try {
    if (typeof simulator.enumerateInteractPickupActions === "function") {
      pushAll(simulator.enumerateInteractPickupActions(state) || []);
    }
  } catch (error) {
    // ignore
  }
  try {
    if (typeof simulator.enumerateFloorFlyActions === "function") {
      pushAll(simulator.enumerateFloorFlyActions(state) || []);
    }
  } catch (error) {
    // ignore
  }

  return {
    bySummary,
    summaries: Array.from(bySummary.keys()).sort(),
    actions: Array.from(bySummary.values()),
  };
}

function findTeacherAction(visible, decision) {
  if (!decision) return null;
  if (decision.summary && visible.bySummary.has(decision.summary)) {
    return visible.bySummary.get(decision.summary);
  }
  if (decision.fingerprint) {
    for (const action of visible.actions) {
      if (action.fingerprint === decision.fingerprint) return action;
    }
  }
  return null;
}

function timingMeta(state) {
  const timing = getTiming(state);
  if (!timing) {
    return {
      present: false,
      roles: [],
      score: 0,
    };
  }
  return {
    present: true,
    roles: resourceTimingRoles(state) || [],
    score: resourceTimingScore(timing),
    primary: timing.primary || null,
  };
}

function competitorRecord(entry) {
  if (!entry) return null;
  return {
    step: entry.step,
    summary: entry.summary || null,
    hero: entry.hero || null,
    roles: entry.roles || [],
    timingScore: entry.timingScore == null ? null : entry.timingScore,
    source: entry.source || "unknown",
  };
}

function classifyStepIssue(step) {
  if (!step.teacherActionGenerated) return "action-modeling";
  if (!step.teacherSuccessorValid) return "successor-invalid";
  if (step.prunedBySibling) return "dominance-sibling";
  if (step.prunedByPrior) return "dominance-prior";
  if (step.dpKeyCollision && step.wouldBeRejectedWithoutForce) return "dominance-key-collision";
  if (step.resourceTimingConflict) return "resource-timing-conflict";
  return null;
}

/**
 * @param {object} simulator
 * @param {object} routeRecord teacher route with decisions[]
 * @param {object} [options]
 * @param {object} [options.initialState] optional prebuilt start state
 * @param {number} [options.fromStep] inclusive decision index (0-based into decisions array)
 * @param {number} [options.toStep] exclusive end; default all
 * @param {number} [options.siblingLimit] max non-teacher successors evaluated per step
 * @param {boolean} [options.enableResourceTiming]
 * @param {object} [options.resourceTimingOptions]
 * @param {object} [options.dpKeyOptions]
 * @param {boolean} [options.forceKeepTeacher] always retain teacher on key map (default true)
 */
function runTeacherDivergenceAudit(simulator, routeRecord, options) {
  const config = options || {};
  const decisions = Array.isArray(routeRecord && routeRecord.decisions)
    ? routeRecord.decisions
    : [];
  const fromStep = Math.max(0, number(config.fromStep, 0));
  const toStep = Math.min(decisions.length, number(config.toStep, decisions.length));
  const siblingLimit = Math.max(0, number(config.siblingLimit, 12));
  const forceKeepTeacher = config.forceKeepTeacher !== false;
  const enableResourceTiming = config.enableResourceTiming === true;
  const dpKeyOptions = config.dpKeyOptions || { keyMode: "location" };

  let state = config.initialState
    ? config.initialState
    : simulator.createInitialState(config.initialStateOptions || { rank: "chaos" });

  // Replay prefix before fromStep without auditing.
  for (let index = 0; index < fromStep; index += 1) {
    const decision = decisions[index];
    const visible = enumerateVisibleActions(simulator, state);
    const action = findTeacherAction(visible, decision);
    if (!action) {
      return {
        version: AUDIT_VERSION,
        ok: false,
        error: `prefix-action-missing@${index}:${decision && decision.summary}`,
        fromStep,
        toStep,
        steps: [],
        summary: null,
      };
    }
    state = simulator.applyAction(state, action);
  }

  /** @type {Map<string, object>} */
  const bestByKey = new Map();
  const steps = [];
  let firstDivergence = null;
  let firstHardFailure = null;

  const remember = (key, record) => {
    const existing = bestByKey.get(key);
    if (!existing || isBetterForSameDpKey(record.state, existing.state)) {
      bestByKey.set(key, record);
      return { accepted: true, replaced: Boolean(existing), previous: existing || null };
    }
    return { accepted: false, replaced: false, previous: existing };
  };

  // Seed map with pre-audit state so step-0 collisions are visible.
  {
    const seedKey = buildDpStateKey(simulator, state, dpKeyOptions);
    if (enableResourceTiming) {
      try {
        annotateStateResourceTiming(simulator, state, config.segment || null, config.resourceTimingOptions || {});
      } catch (error) {
        // optional
      }
    }
    bestByKey.set(seedKey, {
      step: fromStep - 1,
      summary: "__start__",
      state,
      hero: heroSummary(state),
      roles: timingMeta(state).roles,
      timingScore: timingMeta(state).score,
      source: "start",
    });
  }

  for (let index = fromStep; index < toStep; index += 1) {
    const decision = decisions[index];
    const teacherSummary = decision && decision.summary;
    const before = state;
    const beforeHero = heroSummary(before);
    const visible = enumerateVisibleActions(simulator, before);
    const teacherAction = findTeacherAction(visible, decision);

    const step = {
      step: index,
      teacherSummary: teacherSummary || null,
      teacherKind: (decision && decision.kind) || (teacherAction && teacherAction.kind) || null,
      teacherActionGenerated: Boolean(teacherAction),
      visibleActionCount: visible.summaries.length,
      teacherSuccessorValid: false,
      teacherSuccessorHero: null,
      dpKey: null,
      dpKeyCollision: false,
      wouldBeRejectedWithoutForce: false,
      prunedBy: null,
      pruneReason: null,
      competitor: null,
      resourceTimingRoles: [],
      resourceTimingScore: null,
      resourceTimingConflict: false,
      siblingDominators: [],
      issueClass: null,
      forced: false,
    };

    if (!teacherAction) {
      step.issueClass = "action-modeling";
      step.pruneReason = "teacher-action-not-generated";
      steps.push(step);
      if (!firstDivergence) firstDivergence = step;
      if (!firstHardFailure) firstHardFailure = step;
      break;
    }

    let after;
    try {
      after = simulator.applyAction(before, teacherAction);
      step.teacherSuccessorValid = Boolean(after && after.hero);
    } catch (error) {
      step.teacherSuccessorValid = false;
      step.pruneReason = `apply-threw:${error && error.message ? error.message : String(error)}`;
      step.issueClass = "successor-invalid";
      steps.push(step);
      if (!firstDivergence) firstDivergence = step;
      if (!firstHardFailure) firstHardFailure = step;
      break;
    }

    if (!step.teacherSuccessorValid) {
      step.issueClass = "successor-invalid";
      step.pruneReason = "teacher-successor-invalid";
      steps.push(step);
      if (!firstDivergence) firstDivergence = step;
      if (!firstHardFailure) firstHardFailure = step;
      break;
    }

    if (enableResourceTiming) {
      try {
        annotateStateResourceTiming(simulator, after, config.segment || null, config.resourceTimingOptions || {});
      } catch (error) {
        // optional
      }
    }

    const afterTiming = timingMeta(after);
    step.teacherSuccessorHero = heroSummary(after);
    step.resourceTimingRoles = afterTiming.roles;
    step.resourceTimingScore = afterTiming.score;
    step.dpKey = buildDpStateKey(simulator, after, dpKeyOptions);

    const prior = bestByKey.get(step.dpKey);
    if (prior) {
      step.dpKeyCollision = true;
      const better = isBetterForSameDpKey(after, prior.state);
      if (!better) {
        step.wouldBeRejectedWithoutForce = true;
        step.prunedByPrior = true;
        step.prunedBy = `prior@step${prior.step}`;
        step.pruneReason = number((after.hero || {}).hp, 0) < number((prior.state.hero || {}).hp, 0)
          ? "hp-dominated-by-prior"
          : "same-or-worse-than-prior";
        step.competitor = competitorRecord(prior);
        if (hasTimingConflict(after, prior.state)) {
          step.resourceTimingConflict = true;
          step.issueClass = step.issueClass || "resource-timing-conflict";
        }
      }
    }

    // Evaluate sibling successors for dominance over the teacher successor.
    const siblingDominators = [];
    let siblingIndex = 0;
    for (const action of visible.actions) {
      if (action.summary === teacherSummary) continue;
      if (siblingIndex >= siblingLimit) break;
      siblingIndex += 1;
      let siblingState;
      try {
        siblingState = simulator.applyAction(before, action);
      } catch (error) {
        continue;
      }
      if (!siblingState || !siblingState.hero) continue;
      if (enableResourceTiming) {
        try {
          annotateStateResourceTiming(
            simulator,
            siblingState,
            config.segment || null,
            config.resourceTimingOptions || {},
          );
        } catch (error) {
          // optional
        }
      }
      const siblingKey = buildDpStateKey(simulator, siblingState, dpKeyOptions);
      if (siblingKey !== step.dpKey) continue;
      if (isBetterForSameDpKey(siblingState, after)) {
        const siblingTiming = timingMeta(siblingState);
        const record = {
          step: index,
          summary: action.summary,
          state: siblingState,
          hero: heroSummary(siblingState),
          roles: siblingTiming.roles,
          timingScore: siblingTiming.score,
          source: "sibling",
        };
        siblingDominators.push(competitorRecord(record));
        // Also remember sibling as a real competitor on the key map.
        remember(siblingKey, record);
      }
    }
    step.siblingDominators = siblingDominators;
    if (siblingDominators.length > 0) {
      step.prunedBySibling = true;
      if (!step.wouldBeRejectedWithoutForce) {
        step.wouldBeRejectedWithoutForce = true;
        step.prunedBy = `sibling:${siblingDominators[0].summary}`;
        step.pruneReason = "hp-dominated-by-sibling";
        step.competitor = siblingDominators[0];
      }
    }

    if (!step.issueClass) {
      step.issueClass = classifyStepIssue(step);
    }

    // Teacher-forced retention: always keep teacher successor when configured.
    const teacherRecord = {
      step: index,
      summary: teacherSummary,
      state: after,
      hero: step.teacherSuccessorHero,
      roles: step.resourceTimingRoles,
      timingScore: step.resourceTimingScore,
      source: "teacher",
    };
    if (forceKeepTeacher) {
      bestByKey.set(step.dpKey, teacherRecord);
      step.forced = Boolean(step.wouldBeRejectedWithoutForce);
    } else {
      const result = remember(step.dpKey, teacherRecord);
      if (!result.accepted) {
        step.wouldBeRejectedWithoutForce = true;
        step.prunedBy = result.previous ? `prior@step${result.previous.step}` : "unknown";
        step.pruneReason = step.pruneReason || "rejected-without-force";
        step.competitor = competitorRecord(result.previous);
        step.issueClass = step.issueClass || "dominance-key-collision";
      }
    }

    steps.push(step);
    if (step.issueClass && !firstDivergence) firstDivergence = step;
    if ((step.issueClass === "action-modeling" || step.issueClass === "successor-invalid") && !firstHardFailure) {
      firstHardFailure = step;
    }

    state = after;
    void beforeHero;
  }

  const counts = {
    stepsAudited: steps.length,
    teacherActionsMissing: steps.filter((step) => !step.teacherActionGenerated).length,
    successorInvalid: steps.filter((step) => step.teacherActionGenerated && !step.teacherSuccessorValid).length,
    dpKeyCollisions: steps.filter((step) => step.dpKeyCollision).length,
    wouldBeRejected: steps.filter((step) => step.wouldBeRejectedWithoutForce).length,
    siblingDominated: steps.filter((step) => step.prunedBySibling).length,
    resourceTimingConflicts: steps.filter((step) => step.resourceTimingConflict).length,
    forcedRetentions: steps.filter((step) => step.forced).length,
  };

  const issueBreakdown = {};
  for (const step of steps) {
    if (!step.issueClass) continue;
    issueBreakdown[step.issueClass] = number(issueBreakdown[step.issueClass], 0) + 1;
  }

  const finalState = state;
  return {
    version: AUDIT_VERSION,
    ok: !firstHardFailure,
    fromStep,
    toStep,
    decisionCount: decisions.length,
    forceKeepTeacher,
    enableResourceTiming,
    keyMode: String(dpKeyOptions.keyMode || dpKeyOptions.dpKeyMode || "location"),
    firstDivergenceStep: firstDivergence ? firstDivergence.step : null,
    firstDivergence: firstDivergence
      ? {
          step: firstDivergence.step,
          teacherSummary: firstDivergence.teacherSummary,
          issueClass: firstDivergence.issueClass,
          pruneReason: firstDivergence.pruneReason,
          prunedBy: firstDivergence.prunedBy,
          competitor: firstDivergence.competitor,
          teacherHero: firstDivergence.teacherSuccessorHero,
        }
      : null,
    firstHardFailureStep: firstHardFailure ? firstHardFailure.step : null,
    finalHero: heroSummary(finalState),
    counts,
    issueBreakdown,
    steps,
  };
}

function formatDivergenceReport(report, options) {
  const config = options || {};
  const maxSteps = Math.max(0, number(config.maxSteps, 40));
  const lines = [];
  lines.push(`Teacher divergence audit ${report.version}`);
  lines.push(`ok=${report.ok} keyMode=${report.keyMode} steps=${report.counts && report.counts.stepsAudited}`);
  lines.push(
    `missingActions=${report.counts.teacherActionsMissing} ` +
    `invalidSuccessors=${report.counts.successorInvalid} ` +
    `keyCollisions=${report.counts.dpKeyCollisions} ` +
    `wouldReject=${report.counts.wouldBeRejected} ` +
    `siblingDominated=${report.counts.siblingDominated} ` +
    `timingConflicts=${report.counts.resourceTimingConflicts}`,
  );
  if (report.firstDivergence) {
    const item = report.firstDivergence;
    lines.push(
      `firstDivergence: step ${item.step} class=${item.issueClass} ` +
      `action=${item.teacherSummary} reason=${item.pruneReason || "-"} prunedBy=${item.prunedBy || "-"}`,
    );
  } else {
    lines.push("firstDivergence: none");
  }
  const interesting = (report.steps || []).filter((step) => step.issueClass || step.wouldBeRejectedWithoutForce);
  for (const step of interesting.slice(0, maxSteps)) {
    lines.push(
      `step ${step.step}: generated=${step.teacherActionGenerated} ` +
      `valid=${step.teacherSuccessorValid} class=${step.issueClass || "-"} ` +
      `action=${step.teacherSummary} reason=${step.pruneReason || "-"} ` +
      `forced=${Boolean(step.forced)} ` +
      `teacherHp=${step.teacherSuccessorHero ? step.teacherSuccessorHero.hp : "-"} ` +
      `competitor=${step.competitor ? `${step.competitor.summary}@hp${step.competitor.hero && step.competitor.hero.hp}` : "-"}`,
    );
  }
  if (interesting.length > maxSteps) {
    lines.push(`… ${interesting.length - maxSteps} more issue steps omitted`);
  }
  return lines.join("\n");
}

module.exports = {
  AUDIT_VERSION,
  runTeacherDivergenceAudit,
  formatDivergenceReport,
  enumerateVisibleActions,
  findTeacherAction,
  isBetterForSameDpKey,
  heroSummary,
};
