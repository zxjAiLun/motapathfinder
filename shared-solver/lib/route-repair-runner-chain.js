"use strict";

const { searchSegmentDP } = require("./segment-dp");

function routeDelta(beforeState, afterState) {
  const before = Array.isArray(beforeState && beforeState.route) ? beforeState.route.length : 0;
  const after = Array.isArray(afterState && afterState.route) ? afterState.route : [];
  return after.slice(before).filter((entry) => entry && typeof entry === "object");
}

function runRepairMilestoneChain(simulator, startState, milestones, options) {
  const config = options || {};
  const maxExpansions = Number(config.maxExpansions || 4000);
  const maxRuntimeMs = Number(config.maxRuntimeMs || 8000);
  const perMilestoneRuntimeMs = Math.max(1500, Math.floor(maxRuntimeMs / Math.max(1, milestones.length)));
  const perMilestoneExpansions = Math.max(500, Math.floor(maxExpansions / Math.max(1, milestones.length)));
  let state = startState;
  let totalExpansions = 0;
  const history = [];
  const actions = [];
  for (const milestone of milestones) {
    if (!milestone) continue;
    let result;
    try {
      result = searchSegmentDP(simulator, state, milestone, {
        captureTrace: false,
        maxExpansions: perMilestoneExpansions,
        maxRuntimeMs: perMilestoneRuntimeMs,
      });
    } catch (error) {
      history.push({ milestoneId: milestone.id, status: "error", error: error.message });
      return { finalState: null, totalExpansions, history };
    }
    const dpDiag = (result && result.diagnostics && result.diagnostics.dp) || {};
    totalExpansions += Number(dpDiag.expansions || 0);
    const goalCandidate = (result && result.goalSkyline && result.goalSkyline[0]) || null;
    const bestSeen = (result && result.bestSeen) || null;
    let finalState = (goalCandidate && goalCandidate.state) || bestSeen || null;
    const expanded = Number(dpDiag.expansions || 0) > 0;
    let milestoneActions = expanded ? routeDelta(state, finalState) : [];
    if (finalState && !expanded) {
      // start-survivable: chain did not actually mutate state. Try to apply
      // the goal actionSurvivable summary directly so the post-state reflects
      // the blocker being cleared.
      const goalSummary = milestone && milestone.goal && milestone.goal.actionSurvivable && milestone.goal.actionSurvivable.summary;
      if (goalSummary) {
        try {
          const primitive = simulator.enumeratePrimitiveActions(state);
          const candidate = (primitive.actions || []).find((a) => a && a.summary === goalSummary);
          if (candidate) {
            finalState = simulator.applyAction(state, candidate, { storeRoute: false });
            milestoneActions = [candidate];
            totalExpansions += 1;
          }
        } catch (error) {
          /* fall through */
        }
      }
    }
    if (!finalState) {
      history.push({
        milestoneId: milestone.id,
        status: "not-found",
        expansions: dpDiag.expansions,
        stoppedReason: dpDiag.stoppedReason,
      });
      return { finalState: null, totalExpansions, history };
    }
    if (finalState.floorId == null) {
      history.push({
        milestoneId: milestone.id,
        status: "error",
        error: "chain returned state without floorId",
      });
      return { finalState: null, totalExpansions, history };
    }
    actions.push(...milestoneActions);
    history.push({
      milestoneId: milestone.id,
      status: "found",
      expansions: dpDiag.expansions,
      finalHp: Number((finalState.hero || {}).hp || 0),
    });
    state = finalState;
  }
  return { finalState: state, totalExpansions, history, actions };
}

module.exports = { runRepairMilestoneChain };
