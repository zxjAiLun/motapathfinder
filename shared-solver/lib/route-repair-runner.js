"use strict";

const { searchSegmentDP } = require("./segment-dp");
const { createStateFromSnapshot, normalizeAction } = require("./route-store");
const { parseBattleSummary } = require("./battle-thresholds");
const { runRepairMilestoneChain } = require("./route-repair-runner-chain");
const {
  findBlockerCandidates,
  buildBlockerRepairMilestone,
} = require("./route-audit-repair");
const { scanResourceIntents } = require("./resource-intent-scanner");

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

function buildCheaperCheck(simulator, state, cheaperSummary) {
  const parsed = parseBattleSummary(cheaperSummary);
  if (!parsed) {
    return { reachable: false, action: null, parsed: null, error: "unparseable-cheaper" };
  }
  let action = null;
  try {
    const primitive = simulator.enumeratePrimitiveActions(state);
    action = (primitive.actions || []).find((a) => a && a.summary === cheaperSummary) || null;
  } catch (error) {
    action = null;
  }
  let reachable = Boolean(action);
  if (!reachable) {
    try {
      const reach = simulator.getWalkReachability(state);
      const targetKey = `${parsed.x},${parsed.y}`;
      reachable = Boolean(reach.visited && reach.visited[targetKey]);
    } catch (error) {
      reachable = false;
    }
  }
  return { reachable, action, parsed, error: null };
}

function tryApplyCheaper(simulator, state, cheaperSummary) {
  const check = buildCheaperCheck(simulator, state, cheaperSummary);
  if (!check.action) {
    return { ok: false, reason: "cheaper-not-in-candidates", check };
  }
  try {
    const next = simulator.applyAction(state, check.action, { storeRoute: false });
    return {
      ok: true,
      next,
      action: check.action,
      finalHp: Number((next.hero || {}).hp || 0),
      finalFloor: next.floorId,
    };
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : String(error), check };
  }
}

function synthesizeBlockerFailure(blocker) {
  if (blocker.kind === "door") {
    return {
      failureClass: "target-tile-not-cleared",
      missingGoalFields: [{
        field: "removedTiles",
        expected: `${blocker.floorId}:${blocker.x},${blocker.y}=removed`,
        actual: "door-blocker",
      }],
    };
  }
  return {
    failureClass: "hp-deficit",
    missingGoalFields: [
      {
        field: "actionSurvivable",
        expected: `battle:${blocker.enemyId}@${blocker.floorId}:${blocker.x},${blocker.y}`,
        actual: "blocker-walk-unreachable",
        damage: 0,
      },
      {
        field: "hero.hp",
        expected: 1,
        actual: 0,
      },
    ],
  };
}

function buildRoundMilestone(simulator, blocker, options) {
  const failure = synthesizeBlockerFailure(blocker);
  let intent = null;
  const scannedCount = { ok: 0, noRecords: 0 };
  const targetBattle = options.targetBattle || null;
  try {
    const scanned = scanResourceIntents(simulator, [{ id: `route-audit-round:${blocker.floorId}:${blocker.x},${blocker.y}`, state: options.currentState }], failure, {
      intentDepth: options.intentDepth || 1,
      maxIntentNodes: options.maxIntentNodes || 60,
      maxIntentRecords: options.maxIntentRecords || 12,
      recordsPerIntent: options.recordsPerIntent || 4,
      maxIntents: 1,
      includeBlockedResources: true,
      targetBattle,
    });
    if (Array.isArray(scanned)) {
      if (scanned.length === 0) {
        scannedCount.noRecords += 1;
      } else {
        scannedCount.ok += 1;
      }
    }
    intent = scanned && scanned[0];
  } catch (error) {
    intent = null;
    if (process.env.ROUTE_REPAIR_DEBUG) {
      console.error("buildRoundMilestone scan error:", error && error.stack ? error.stack : error);
    }
  }
  if (!intent && process.env.ROUTE_REPAIR_DEBUG) {
    console.error(`buildRoundMilestone no intent for ${blocker.kind} ${blocker.enemyId || blocker.doorId}@${blocker.floorId}:${blocker.x},${blocker.y} scanned=${JSON.stringify(scannedCount)}`);
  }
  if (!intent) return null;
  return buildBlockerRepairMilestone(simulator, intent, blocker, options.finding || {}, options);
}

function ensureFloorStates(state) {
  if (!state) return state;
  if (!state.floorStates || typeof state.floorStates !== "object") state.floorStates = {};
  if (!state.visitedFloors || typeof state.visitedFloors !== "object") state.visitedFloors = {};
  if (!state.inventory || typeof state.inventory !== "object") state.inventory = {};
  if (!state.flags || typeof state.flags !== "object") state.flags = {};
  if (state.floorId && !state.floorStates[state.floorId]) {
    state.floorStates[state.floorId] = { removed: {}, replaced: {} };
  }
  return state;
}

function tryRepairRouteRecursive(simulator, project, routeRecord, timeline, entry, options) {
  const config = options || {};
  const maxDepth = Math.max(1, number(config.maxDepth, 3));
  const perRoundExpansions = number(config.maxExpansions, 2000);
  const perRoundRuntimeMs = number(config.maxRuntimeMs, 4000);
  const stepIndex = entry.stepIndex;
  const cheaperSummary = entry.cheaper && entry.cheaper[0] && entry.cheaper[0].summary;
  if (!cheaperSummary) {
    return {
      stepIndex,
      status: "no-cheaper-record",
      rounds: [],
      totalExpansions: 0,
    };
  }
  let currentState = replayPreState(project, simulator, routeRecord, stepIndex);
  if (!currentState) {
    return {
      stepIndex,
      status: "replay-failed",
      rounds: [],
      totalExpansions: 0,
    };
  }
  const rounds = [];
  const usedBlockerKeys = new Set();
  const patchActions = [];
  let totalExpansions = 0;
  const targetBattle = parseBattleSummary(cheaperSummary);
  if (!targetBattle) {
    return {
      stepIndex,
      status: "no-cheaper-record",
      rounds: [{ roundIndex: 0, reachable: false, stopReason: "cheaper-unparseable" }],
      totalExpansions: 0,
    };
  }
  for (let roundIndex = 0; roundIndex < maxDepth; roundIndex += 1) {
    const check = buildCheaperCheck(simulator, currentState, cheaperSummary);
    if (check.reachable) {
      const apply = tryApplyCheaper(simulator, currentState, cheaperSummary);
      rounds.push({
        roundIndex,
        reachable: true,
        finalFloor: currentState.floorId,
        finalHp: Number((currentState.hero || {}).hp || 0),
        applied: apply.ok,
        applyError: apply.ok ? null : apply.reason,
        appliedFinalHp: apply.ok ? apply.finalHp : null,
      });
      return {
        stepIndex,
        status: apply.ok ? "repaired" : "applied-failed",
        rounds,
        totalExpansions,
        cheaperApplied: apply.ok
          ? { summary: cheaperSummary, finalHp: apply.finalHp, finalFloor: apply.finalFloor }
          : { summary: cheaperSummary, error: apply.reason },
        patch: apply.ok
          ? {
              sourceStepIndex: stepIndex,
              originalSummary: routeRecord.decisions[stepIndex - 1] && routeRecord.decisions[stepIndex - 1].summary,
              actions: patchActions.concat([apply.action]).map(normalizeAction),
              cheaperSummary,
            }
          : null,
      };
    }
    const allBlockers = findBlockerCandidates(simulator, currentState, targetBattle, {
      blockerRadius: number(config.blockerRadius, 4),
    });
    const blockers = allBlockers
      .filter((b) => !usedBlockerKeys.has(`${b.kind}:${b.enemyId || b.doorId}@${b.floorId}:${b.x},${b.y}`));
    const candidateBlockersBefore = blockers.map((b) => ({ kind: b.kind, id: b.enemyId || b.doorId, floorId: b.floorId, x: b.x, y: b.y }));
    if (blockers.length === 0) {
      const preCheck = buildCheaperCheck(simulator, currentState, cheaperSummary);
      const remainingBlockersAfter = allBlockers
        .filter((b) => !usedBlockerKeys.has(`${b.kind}:${b.enemyId || b.doorId}@${b.floorId}:${b.x},${b.y}`));
      rounds.push({
        roundIndex,
        reachable: false,
        stopReason: "no-more-blockers",
        rawBlockerCount: allBlockers.length,
        usedBlockerCount: usedBlockerKeys.size,
        finalFloor: currentState.floorId,
        finalHp: Number((currentState.hero || {}).hp || 0),
        cheaperTarget: { floorId: targetBattle.floorId, x: targetBattle.x, y: targetBattle.y },
        cheaperReachableAfter: preCheck.reachable,
        cheaperActionAvailableAfter: Boolean(preCheck.action),
        remainingBlockersAfter: remainingBlockersAfter.map((b) => ({ kind: b.kind, id: b.enemyId || b.doorId, floorId: b.floorId, x: b.x, y: b.y })),
        allBlockers: allBlockers.map((b) => ({ kind: b.kind, id: b.enemyId || b.doorId, floorId: b.floorId, x: b.x, y: b.y })),
      });
      return {
        stepIndex,
        status: "still-unreachable",
        rounds,
        totalExpansions,
      };
    }
    const blockersThisRound = blockers.slice(0, Math.max(1, number(config.maxBlockersPerRound, 1)));
    const milestones = [];
    const roundBlockers = [];
    const blockerKeysThisRound = [];
    for (const blocker of blockersThisRound) {
      const key = `${blocker.kind}:${blocker.enemyId || blocker.doorId}@${blocker.floorId}:${blocker.x},${blocker.y}`;
      blockerKeysThisRound.push(key);
      roundBlockers.push({
        kind: blocker.kind,
        id: blocker.enemyId || blocker.doorId,
        floorId: blocker.floorId,
        x: blocker.x,
        y: blocker.y,
      });
      const milestone = buildRoundMilestone(simulator, blocker, {
        currentState,
        finding: entry,
        targetBattle,
        intentDepth: number(config.intentDepth, 1),
        maxIntentNodes: number(config.maxIntentNodes, 60),
        maxIntentRecords: number(config.maxIntentRecords, 12),
        recordsPerIntent: number(config.recordsPerIntent, 4),
      });
      if (milestone) milestones.push(milestone);
    }
    if (milestones.length === 0) {
      const preCheck = buildCheaperCheck(simulator, currentState, cheaperSummary);
      const noIntentRemaining = allBlockers
        .filter((b) => !usedBlockerKeys.has(`${b.kind}:${b.enemyId || b.doorId}@${b.floorId}:${b.x},${b.y}`));
      rounds.push({
        roundIndex,
        reachable: false,
        stopReason: "no-intent-from-blocker",
        blockerCount: blockersThisRound.length,
        finalFloor: currentState.floorId,
        finalHp: Number((currentState.hero || {}).hp || 0),
        cheaperTarget: { floorId: targetBattle.floorId, x: targetBattle.x, y: targetBattle.y },
        cheaperReachableAfter: preCheck.reachable,
        cheaperActionAvailableAfter: Boolean(preCheck.action),
        remainingBlockersAfter: noIntentRemaining.map((b) => ({ kind: b.kind, id: b.enemyId || b.doorId, floorId: b.floorId, x: b.x, y: b.y })),
        attemptedBlockers: roundBlockers,
        roundBlockers,
        candidateBlockersBefore,
      });
      return { stepIndex, status: "still-unreachable", rounds, totalExpansions };
    }
    const chainResult = runRepairMilestoneChain(simulator, currentState, milestones, {
      maxExpansions: perRoundExpansions,
      maxRuntimeMs: perRoundRuntimeMs,
    });
    totalExpansions += chainResult.totalExpansions || 0;
    if (!chainResult.finalState) {
      const preCheck = buildCheaperCheck(simulator, currentState, cheaperSummary);
      const chainFailedRemaining = findBlockerCandidates(simulator, currentState, targetBattle, {
        blockerRadius: number(config.blockerRadius, 4),
      })
        .filter((b) => !usedBlockerKeys.has(`${b.kind}:${b.enemyId || b.doorId}@${b.floorId}:${b.x},${b.y}`));
      rounds.push({
        roundIndex,
        reachable: false,
        stopReason: "chain-failed",
        blockerCount: milestones.length,
        chainHistory: chainResult.history,
        finalFloor: currentState.floorId,
        finalHp: Number((currentState.hero || {}).hp || 0),
        cheaperTarget: { floorId: targetBattle.floorId, x: targetBattle.x, y: targetBattle.y },
        cheaperReachableAfter: preCheck.reachable,
        cheaperActionAvailableAfter: Boolean(preCheck.action),
        remainingBlockersAfter: chainFailedRemaining.map((b) => ({ kind: b.kind, id: b.enemyId || b.doorId, floorId: b.floorId, x: b.x, y: b.y })),
        attemptedBlockers: roundBlockers,
        roundBlockers,
        candidateBlockersBefore,
      });
      return { stepIndex, status: "no-repair-route", rounds, totalExpansions };
    }
    const postState = ensureFloorStates(chainResult.finalState);
    patchActions.push(...(chainResult.actions || []));
    for (const key of blockerKeysThisRound) {
      usedBlockerKeys.add(key);
    }
    const postCheck = buildCheaperCheck(simulator, postState, cheaperSummary);
    const remainingBlockersAfter = findBlockerCandidates(simulator, postState, targetBattle, {
      blockerRadius: number(config.blockerRadius, 4),
    })
      .filter((b) => !usedBlockerKeys.has(`${b.kind}:${b.enemyId || b.doorId}@${b.floorId}:${b.x},${b.y}`))
      .map((b) => ({ kind: b.kind, id: b.enemyId || b.doorId, floorId: b.floorId, x: b.x, y: b.y }));
    rounds.push({
      roundIndex,
      reachable: false,
      blockerCount: milestones.length,
      finalFloor: postState.floorId,
      finalHp: Number((postState.hero || {}).hp || 0),
      chainHistory: chainResult.history,
      roundBlockers,
      cheaperTarget: { floorId: targetBattle.floorId, x: targetBattle.x, y: targetBattle.y },
      cheaperReachableAfter: postCheck.reachable,
      cheaperActionAvailableAfter: Boolean(postCheck.action),
      remainingBlockersAfter,
      candidateBlockersBefore,
    });
    currentState = postState;
  }
  const finalAllBlockers = findBlockerCandidates(simulator, currentState, targetBattle, {
    blockerRadius: number(config.blockerRadius, 4),
  });
  const finalRemaining = finalAllBlockers
    .filter((b) => !usedBlockerKeys.has(`${b.kind}:${b.enemyId || b.doorId}@${b.floorId}:${b.x},${b.y}`));
  const finalCheck = buildCheaperCheck(simulator, currentState, cheaperSummary);
  rounds.push({
    roundIndex: rounds.length,
    reachable: false,
    stopReason: "max-depth-reached",
    finalFloor: currentState.floorId,
    finalHp: Number((currentState.hero || {}).hp || 0),
    cheaperTarget: { floorId: targetBattle.floorId, x: targetBattle.x, y: targetBattle.y },
    cheaperReachableAfter: finalCheck.reachable,
    cheaperActionAvailableAfter: Boolean(finalCheck.action),
    remainingBlockersAfter: finalRemaining.map((b) => ({ kind: b.kind, id: b.enemyId || b.doorId, floorId: b.floorId, x: b.x, y: b.y })),
  });
  return { stepIndex, status: "still-unreachable", rounds, totalExpansions };
}

function tryRepairRoute(simulator, project, routeRecord, timeline, repairEntries, options) {
  const config = options || {};
  const results = [];
  for (const entry of repairEntries) {
    const result = tryRepairRouteRecursive(simulator, project, routeRecord, timeline, entry, config);
    results.push(result);
  }
  const repairedSteps = results
    .filter((r) => r.status === "repaired" && r.cheaperApplied && r.cheaperApplied.summary)
    .map((r) => ({ stepIndex: r.stepIndex, newSummary: r.cheaperApplied.summary }));
  const patches = results.filter((r) => r.status === "repaired" && r.patch).map((r) => r.patch);
  return { results, repairedSteps, patches };
}

module.exports = {
  runRepairSegment,
  replayPreState,
  replaceStepSummary,
  tryRepairRoute,
  tryRepairRouteRecursive,
  buildCheaperCheck,
  tryApplyCheaper,
};
