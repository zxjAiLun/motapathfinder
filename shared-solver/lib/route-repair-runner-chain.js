"use strict";

const { searchSegmentDP } = require("./segment-dp");

function runRepairMilestoneChain(simulator, startState, milestones, options) {
  const config = options || {};
  const maxExpansions = Number(config.maxExpansions || 4000);
  const maxRuntimeMs = Number(config.maxRuntimeMs || 8000);
  const perMilestoneRuntimeMs = Math.max(2000, Math.floor(maxRuntimeMs / Math.max(1, milestones.length)));
  const perMilestoneExpansions = Math.max(500, Math.floor(maxExpansions / Math.max(1, milestones.length)));
  let state = startState;
  let totalExpansions = 0;
  const history = [];
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
    const finalState = (result && result.goalSkyline && result.goalSkyline[0])
      || (result && result.bestSeen)
      || null;
    if (!finalState) {
      history.push({
        milestoneId: milestone.id,
        status: "not-found",
        expansions: dpDiag.expansions,
        stoppedReason: dpDiag.stoppedReason,
      });
      return { finalState: null, totalExpansions, history };
    }
    history.push({
      milestoneId: milestone.id,
      status: "found",
      expansions: dpDiag.expansions,
      finalHp: Number((finalState.hero || {}).hp || 0),
    });
    state = finalState;
  }
  return { finalState: state, totalExpansions, history };
}

module.exports = { runRepairMilestoneChain };
