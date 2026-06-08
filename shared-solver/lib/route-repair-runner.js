"use strict";

const { searchSegmentDP } = require("./segment-dp");
const { createStateFromSnapshot } = require("./route-store");
const { parseBattleSummary } = require("./battle-thresholds");
const { runRepairMilestoneChain } = require("./route-repair-runner-chain");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function replayPreState(project, simulator, routeRecord, upToStepIndex) {
  const startSnapshot = (routeRecord.start || {}).snapshot;
  if (!startSnapshot) return null;
  let state = createStateFromSnapshot(project, startSnapshot, { rank: "chaos" });
  const decisions = routeRecord.decisions || [];
  const limit = Math.max(0, Math.min(upToStepIndex - 1, decisions.length));
  for (let i = 0; i < limit; i += 1) {
    const decision = decisions[i];
    if (!decision || !decision.summary) continue;
    let action = null;
    try {
      const primitive = simulator.enumeratePrimitiveActions(state);
      action = (primitive.actions || []).find((a) => a && a.summary === decision.summary);
      if (!action && simulator.enumerateActions) {
        action = (simulator.enumerateActions(state) || []).find((a) => a && a.summary === decision.summary);
      }
    } catch (error) {
      action = null;
    }
    if (!action) return null;
    try {
      state = simulator.applyAction(state, action);
    } catch (error) {
      return null;
    }
  }
  return state;
}

function runRepairSegment(simulator, startState, segment, options) {
  const config = options || {};
  let result;
  try {
    result = searchSegmentDP(simulator, startState, segment, {
      captureTrace: false,
      maxExpansions: config.maxExpansions,
      maxRuntimeMs: config.maxRuntimeMs,
    });
  } catch (error) {
    return { found: false, error: error && error.message ? error.message : String(error) };
  }
  const dpDiag = (result && result.diagnostics && result.diagnostics.dp) || {};
  const finalState = result && (result.bestGoalState || result.firstGoalState);
  if (!finalState) {
    return {
      found: false,
      expansions: dpDiag.expansions,
      stoppedReason: dpDiag.stoppedReason,
    };
  }
  return {
    found: true,
    finalState,
    finalHp: Number((finalState.hero || {}).hp || 0),
    finalFloor: finalState.floorId,
    routeLength: Array.isArray(finalState.route) ? finalState.route.length : 0,
    expansions: dpDiag.expansions,
    stoppedReason: dpDiag.stoppedReason,
  };
}

function replaceStepSummary(routeRecord, stepIndex, newSummary) {
  const decisions = routeRecord.decisions || [];
  if (stepIndex < 1 || stepIndex > decisions.length) return null;
  const updated = JSON.parse(JSON.stringify(routeRecord));
  const target = updated.decisions[stepIndex - 1];
  target.summary = newSummary;
  if (target.fingerprint) {
    const match = /battle:([^@]+)@([^:]+):(\d+),(\d+)$/.exec(newSummary);
    if (match) {
      target.fingerprint = `battle|${match[2]}|${match[3]},${match[4]}|${match[1]}`;
    }
  }
  return updated;
}

function tryRepairRoute(simulator, project, routeRecord, timeline, repairEntries, options) {
  const config = options || {};
  const results = [];
  for (const entry of repairEntries) {
    const stepIndex = entry.stepIndex;
    if (!stepIndex) continue;
    const preState = replayPreState(project, simulator, routeRecord, stepIndex);
    if (!preState) {
      results.push({ stepIndex, status: "replay-failed" });
      continue;
    }
    const chainResult = runRepairMilestoneChain(simulator, preState, entry.milestones, {
      maxExpansions: config.maxExpansions || 4000,
      maxRuntimeMs: config.maxRuntimeMs || 8000,
    });
    if (!chainResult.finalState) {
      results.push({
        stepIndex,
        status: "no-repair-route",
        history: chainResult.history,
      });
      continue;
    }
    const cheaperSummary = entry.cheaper && entry.cheaper[0] && entry.cheaper[0].summary;
    if (!cheaperSummary) {
      results.push({ stepIndex, status: "no-cheaper-record" });
      continue;
    }
    const parsedCheaper = parseBattleSummary(cheaperSummary);
    let afterReachable = false;
    try {
      const reach = simulator.getWalkReachability(chainResult.finalState);
      const targetKey = `${parsedCheaper.x},${parsedCheaper.y}`;
      afterReachable = Boolean(reach.visited && reach.visited[targetKey]);
    } catch (error) {
      afterReachable = false;
    }
    if (!afterReachable) {
      results.push({
        stepIndex,
        status: "still-unreachable",
        finalFloor: chainResult.finalState.floorId,
        repairFinalHp: Number((chainResult.finalState.hero || {}).hp || 0),
      });
      continue;
    }
    let cheaperApplied = null;
    try {
      const primitive = simulator.enumeratePrimitiveActions(chainResult.finalState);
      const action = (primitive.actions || []).find((a) => a && a.summary === cheaperSummary);
      if (action) {
        const next = simulator.applyAction(chainResult.finalState, action, { storeRoute: false });
        cheaperApplied = {
          summary: cheaperSummary,
          finalHp: Number((next.hero || {}).hp || 0),
        };
      } else {
        cheaperApplied = { summary: cheaperSummary, error: "cheaper-not-in-candidates" };
      }
    } catch (error) {
      cheaperApplied = { summary: cheaperSummary, error: error.message };
    }
    results.push({
      stepIndex,
      status: cheaperApplied && !cheaperApplied.error ? "repaired" : "applied-failed",
      cheaperApplied,
      repairExpansions: chainResult.totalExpansions,
      repairFinalHp: Number((chainResult.finalState.hero || {}).hp || 0),
      history: chainResult.history,
    });
  }
  const repairedSteps = results
    .filter((r) => r.status === "repaired" && r.cheaperApplied && r.cheaperApplied.summary)
    .map((r) => ({ stepIndex: r.stepIndex, newSummary: r.cheaperApplied.summary }));
  return { results, repairedSteps };
}

module.exports = {
  runRepairSegment,
  replayPreState,
  replaceStepSummary,
  tryRepairRoute,
};
