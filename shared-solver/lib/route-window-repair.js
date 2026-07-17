"use strict";

const { buildRouteRecord, createStateFromSnapshot, normalizeAction } = require("./route-store");
const { searchSegmentDP } = require("./segment-dp");
const { cloneState, getTileDefinitionAt } = require("./state");
const { buildStateKey } = require("./state-key");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function heroHp(state) {
  return number(((state || {}).hero || {}).hp, 0);
}

function listFloorRemovedSet(floorState) {
  return new Set(Object.keys((floorState || {}).removed || {}));
}

function collectRemovedTilesDelta(startState, endState, floorIds) {
  const removedTiles = [];
  for (const floorId of floorIds) {
    const startRemoved = listFloorRemovedSet(
      ((startState || {}).floorStates || {})[floorId],
    );
    const endRemoved = listFloorRemovedSet(
      ((endState || {}).floorStates || {})[floorId],
    );
    for (const key of endRemoved) {
      if (!startRemoved.has(key)) {
        const parts = key.split(",");
        removedTiles.push({
          floorId,
          x: Number(parts[0]),
          y: Number(parts[1]),
        });
      }
    }
  }
  return removedTiles;
}

function replayDecisionList(simulator, initialState, decisions) {
  let state = cloneState(initialState);
  const resolvedActions = [];
  for (const decision of decisions) {
    const summary = decision.summary;
    const primitive = simulator.enumeratePrimitiveActions(state);
    let action = (primitive.actions || []).find(
      (candidate) => candidate.summary === summary,
    );
    // Mirror buildSegmentActionProvider (segment-dp.js): also check
    // interactPickup and floorFly enumerators, which are NOT included
    // in enumeratePrimitiveActions or enumerateActions.
    if (!action && typeof simulator.enumerateInteractPickupActions === "function") {
      const interactPickup = simulator.enumerateInteractPickupActions(state);
      action = (interactPickup || []).find(
        (candidate) => candidate.summary === summary,
      );
    }
    if (!action && typeof simulator.enumerateFloorFlyActions === "function") {
      const floorFly = simulator.enumerateFloorFlyActions(state);
      action = (floorFly || []).find(
        (candidate) => candidate.summary === summary,
      );
    }
    if (!action) {
      const all = simulator.enumerateActions(state);
      action = all.find((candidate) => candidate.summary === summary);
    }
    if (!action) {
      return {
        ok: false,
        failure: { reason: "action-unavailable", summary },
        state,
        resolvedActions,
      };
    }
    try {
      state = simulator.applyAction(state, action);
      resolvedActions.push(action);
    } catch (error) {
      return {
        ok: false,
        failure: {
          reason: "apply-failed",
          summary,
          error: error && error.message ? error.message : String(error),
        },
        state,
        resolvedActions,
      };
    }
  }
  return { ok: true, state, resolvedActions };
}

function buildStageGoals(stageIndex, profileGoal, stageThresholds) {
  if (Array.isArray(stageThresholds) && stageThresholds[stageIndex] != null) {
    return stageThresholds[stageIndex];
  }
  if (stageIndex === 0) {
    return { minHero: { lv: 7 } };
  }
  if (stageIndex === 1) {
    return {
      minHero: { atk: 907, def: 775, mdef: 5910, lv: 7 },
    };
  }
  return profileGoal;
}

function buildSegmentForStage(stageGoal, actionPolicy, dpConfig, stageId) {
  return {
    id: stageId,
    label: `Window repair ${stageId}`,
    startFrom: "previous",
    goal: stageGoal,
    actionPolicy,
    dp: {
      keyMode: "location",
      stopOnFirstGoal: false,
      goalSkylineLimit: number(dpConfig.goalSkylineLimit, 8),
      dpSkylineMax: number(dpConfig.dpSkylineMax, 4),
      preserveSkylineRoles: true,
      preserveGoalArchive: true,
      preserveSkylineAlternatives: true,
      maxExpansions: number(dpConfig.maxExpansions, 12000),
      maxRuntimeMs: number(dpConfig.maxRuntimeMs, 30000),
      dpPriorityMode: "resource-first",
      agendaMode: "best-first",
    },
  };
}

function extractWindowActions(candidateRoute, prefixRouteLength) {
  const route = Array.isArray(candidateRoute) ? candidateRoute : [];
  return route
    .slice(prefixRouteLength)
    .filter((entry) => !routeEntrySummary(entry).startsWith("auto:"));
}

function toDecisionEntry(entry) {
  if (typeof entry === "string") {
    return { summary: entry };
  }
  if (entry && entry.kind) {
    return normalizeAction(entry);
  }
  if (entry && entry.summary) {
    return entry;
  }
  return { summary: String(entry || "") };
}

function toSummaryDecision(entry) {
  return { summary: routeEntrySummary(entry) };
}

function candidateSortKey(candidate) {
  const hero = candidate.hero || {};
  const eff = candidate.effectiveHero || {};
  const route = Array.isArray(candidate.route) ? candidate.route : [];
  const atk = number(eff.atk || hero.atk, 0);
  const def = number(eff.def || hero.def, 0);
  const mdef = number(eff.mdef || hero.mdef, 0);
  const hp = number(hero.hp, 0);
  const lv = number(hero.lv, 0);
  const floorFlyCount = route.filter((entry) =>
    routeEntrySummary(entry).startsWith("floorFly:")
  ).length;
  const changeFloorCount = route.filter((entry) =>
    routeEntrySummary(entry).startsWith("changeFloor@")
  ).length;
  return {
    hp,
    atk,
    def,
    mdef,
    lv,
    routeLength: route.length,
    floorFlyCount,
    changeFloorCount,
    baselineMatchCount: number(candidate._baselineMatchCount, 0),
    baselineMobilityMatchCount: number(candidate._baselineMobilityMatchCount, 0),
    baselinePortalMatchCount: number(candidate._baselinePortalMatchCount, 0),
    // Composite combat score mirrors goalCandidateScore in segment-dp.js.
    combatScore: hp + atk * 10 + def * 10 + mdef + lv * 100,
  };
}

function compareCandidates(left, right) {
  const a = candidateSortKey(left);
  const b = candidateSortKey(right);
  return b.hp - a.hp
    || b.atk - a.atk
    || b.def - a.def
    || b.mdef - a.mdef
    || b.lv - a.lv
    || a.routeLength - b.routeLength;
}

// Role order matters: when candidateLimit < ROLE_PICKERS.length, the first
// `limit` roles get slots.  The priority order is designed so that the 4
// default slots capture the most diverse skyline:
//   1. highest-hp — survival/HP optimization
//   2. best-combat — composite offensive+defensive power
//   3. fewest-floorFly — baseline-like portal usage / position preservation
//   4. highest-atk — pure offensive diversity
// Baseline and portal match counts are reported for diagnostics, but are
// not used as default pickers yet: they can over-prefer same-transition
// floorFly routes while dropping higher-HP candidates.
const ROLE_PICKERS = [
  ["highest-hp", (k) => (left, right) => k(right).hp - k(left).hp],
  ["best-combat", (k) => (left, right) => k(right).combatScore - k(left).combatScore],
  ["fewest-floorFly", (k) => (left, right) =>
    k(left).floorFlyCount - k(right).floorFlyCount || compareCandidates(left, right)],
  ["highest-atk", (k) => (left, right) => k(right).atk - k(left).atk],
  ["shortest", (k) => (left, right) => k(left).routeLength - k(right).routeLength],
  ["highest-def", (k) => (left, right) => k(right).def - k(left).def],
  ["highest-mdef", (k) => (left, right) => k(right).mdef - k(left).mdef],
  ["highest-lv", (k) => (left, right) => k(right).lv - k(left).lv],
];

function deduplicateAndSortCandidates(allRaw, stageIndex, limit) {
  const seen = new Map();
  const result = [];
  let globalIndex = 0;
  for (const candidate of allRaw) {
    if (!candidate || !candidate.state) continue;
    const stateKey = buildStateKey(candidate.state);
    const traceKey = Array.isArray(candidate.route)
      ? candidate.route
          .map((entry) => (entry && entry.summary) || String(entry || ""))
          .join("|")
      : "";
    const dedupKey = `${stateKey}\ntrace:${traceKey}`;
    if (seen.has(dedupKey)) continue;
    seen.set(dedupKey, true);
    globalIndex += 1;
    result.push({
      ...candidate,
      // Fresh copy so role tags can be added without mutating the original.
      tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
      _globalId: `stage-${stageIndex + 1}-candidate-${globalIndex}`,
    });
  }

  // Role-aware selection: pick the best candidate for each role first,
  // then fill remaining slots with composite sort.  This mirrors the
  // preserveSkylineRoles strategy in selectGoalSkyline (segment-dp.js)
  // so that diversity is preserved across start states.
  for (const [tag, makeCompare] of ROLE_PICKERS) {
    if (result.length === 0) break;
    const compare = makeCompare(candidateSortKey);
    const winner = result.slice().sort(compare)[0];
    if (winner && !winner.tags.includes(tag)) {
      winner.tags.push(tag);
    }
  }

  const selected = [];
  const selectedIds = new Set();
  const keepCandidate = (candidate) => {
    if (!candidate || selectedIds.has(candidate._globalId) || selected.length >= limit)
      return;
    selectedIds.add(candidate._globalId);
    selected.push(candidate);
  };

  // Pick role winners first (dedup by _globalId).
  for (const [, makeCompare] of ROLE_PICKERS) {
    if (result.length === 0) break;
    const compare = makeCompare(candidateSortKey);
    keepCandidate(result.slice().sort(compare)[0]);
  }

  // Fill remaining slots with composite sort.
  result.sort(compareCandidates).forEach(keepCandidate);

  return selected.slice(0, limit);
}

function validateCandidateFully(project, state, finalGoal) {
  const failures = [];
  if (finalGoal.floorId && state.floorId !== finalGoal.floorId) {
    failures.push({
      field: "floorId",
      expected: finalGoal.floorId,
      actual: state.floorId,
    });
  }
  const hero = (state || {}).hero || {};
  const minHero = finalGoal.minHero || {};
  for (const [field, required] of Object.entries(minHero)) {
    if (number(hero[field], 0) < number(required, 0)) {
      failures.push({
        field: `hero.${field}`,
        expected: required,
        actual: number(hero[field], 0),
      });
    }
  }
  for (const itemId of finalGoal.equipmentIncludes || []) {
    if (!Array.isArray(hero.equipment) || !hero.equipment.includes(itemId)) {
      failures.push({
        field: "equipment",
        expected: itemId,
        actual: hero.equipment || [],
      });
    }
  }
  for (const required of finalGoal.removedTiles || []) {
    const tile = getTileDefinitionAt(project, state, required.floorId, required.x, required.y);
    if (tile != null) {
      failures.push({
        field: "removedTiles",
        expected: `${required.floorId}:${required.x},${required.y}=removed`,
        actual: tile.id || tile.number,
      });
    }
  }
  return failures;
}

function summarizeStageResult(stageIndex, segment, searchResults, rawCount, accepted) {
  const allDp = (searchResults || [])
    .map((r) => (r && r.diagnostics && r.diagnostics.dp) || {})
    .filter(Boolean);
  const totalExpansions = allDp.reduce((s, dp) => s + number(dp.expansions, 0), 0);
  const maxFrontier = allDp.reduce((s, dp) => Math.max(s, number(dp.frontierSize, 0)), 0);
  const stoppedReasons = allDp.map((dp) => dp.stoppedReason).filter(Boolean);
  const anyBudgetExhausted = allDp.some((dp) => dp.expansionBudgetExhausted);
  const totalActionTrimmed = allDp.reduce((s, dp) => s + number(dp.actionTrimmed, 0), 0);
  const anyFound = (searchResults || []).some((r) => r && r.found);
  const totalSkyline = (searchResults || []).reduce(
    (s, r) => s + (Array.isArray(r && r.goalSkyline) ? r.goalSkyline.length : 0),
    0,
  );
  return {
    stageIndex,
    segmentId: segment.id,
    found: anyFound,
    rawCandidateCount: rawCount,
    candidateCount: accepted.length,
    skylineCount: totalSkyline,
    expansions: totalExpansions,
    frontierSize: maxFrontier,
    stoppedReason: stoppedReasons.length > 0 ? stoppedReasons.join("; ") : null,
    expansionBudgetExhausted: anyBudgetExhausted,
    actionTrimmed: totalActionTrimmed,
    startStateCount: (searchResults || []).length,
    candidates: accepted.map((c) => ({
      id: c._globalId || c.id,
      hero: c.hero || null,
      effectiveHero: c.effectiveHero || null,
      routeLength: Array.isArray(c.route) ? c.route.length : 0,
      tags: Array.isArray(c.tags) ? c.tags.slice() : [],
      baselineMatchCount: number(c._baselineMatchCount, 0),
      baselineMobilityMatchCount: number(c._baselineMobilityMatchCount, 0),
      baselinePortalMatchCount: number(c._baselinePortalMatchCount, 0),
    })),
  };
}

function summarizeValidation(candidate, replayResult, baselineHp, goalFailures, accepted) {
  const finalHp = replayResult.ok ? heroHp(replayResult.state) : null;
  const windowActions = Array.isArray(candidate._windowActions)
    ? candidate._windowActions
    : [];
  const actionTrace = windowActions.map(
    (entry) => (entry && entry.summary) || String(entry || ""),
  );
  return {
    candidateId: candidate._globalId || candidate.id,
    hero: candidate.hero || null,
    effectiveHero: candidate.effectiveHero || null,
    tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
    baselineMatchCount: number(candidate._baselineMatchCount, 0),
    baselineMobilityMatchCount: number(candidate._baselineMobilityMatchCount, 0),
    baselinePortalMatchCount: number(candidate._baselinePortalMatchCount, 0),
    windowActionCount: windowActions.length,
    actionTrace,
    fullReplayOk: replayResult.ok,
    replayFailure: replayResult.ok ? null : replayResult.failure,
    goalFailures: goalFailures || [],
    finalHp,
    baselineHp,
    hpImproved: finalHp != null && finalHp > baselineHp,
    accepted,
    rejectedReason: accepted
      ? null
      : !replayResult.ok
        ? "full-replay-failed"
        : goalFailures.length > 0
          ? `goal-missing:${goalFailures[0].field}`
          : finalHp <= baselineHp
            ? "hp-not-improved"
            : "unknown",
  };
}

function decision(summary) {
  return { summary };
}

function actionIdentity(summary) {
  const text = String(summary || "");
  if (text.startsWith("battle:")) return text;
  if (text.startsWith("pickup:")) return text;
  if (text.startsWith("interactPickup:")) return text;
  if (text.startsWith("openDoor:")) return text;
  if (text.startsWith("useTool:")) return text;
  if (text.startsWith("equip:")) return text;
  return text;
}

function uniqueSummaries(summaries) {
  const seen = new Set();
  const result = [];
  for (const summary of summaries || []) {
    const key = actionIdentity(summary);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(summary);
  }
  return result;
}

function isProbeableSummary(summary) {
  const text = String(summary || "");
  return text.startsWith("battle:")
    || text.startsWith("pickup:")
    || text.startsWith("interactPickup:")
    || text.startsWith("openDoor:")
    || text.startsWith("useTool:")
    || text.startsWith("equip:")
    || text.startsWith("changeFloor@")
    || text.startsWith("floorFly:");
}

function multisetDiff(leftSummaries, rightSummaries) {
  const rightCounts = new Map();
  for (const summary of rightSummaries || []) {
    rightCounts.set(summary, (rightCounts.get(summary) || 0) + 1);
  }
  const onlyLeft = [];
  for (const summary of leftSummaries || []) {
    const count = rightCounts.get(summary) || 0;
    if (count > 0) {
      rightCounts.set(summary, count - 1);
    } else {
      onlyLeft.push(summary);
    }
  }
  const onlyRight = [];
  for (const [summary, count] of rightCounts.entries()) {
    for (let i = 0; i < count; i += 1) onlyRight.push(summary);
  }
  return { onlyLeft, onlyRight };
}

function evaluateWindowPatch(
  project,
  simulator,
  initialState,
  prefixDecisions,
  suffixDecisions,
  patchedWindow,
  finalGoal,
  baselineHp,
) {
  const actionEntries = []
    .concat(prefixDecisions)
    .concat(patchedWindow)
    .concat(suffixDecisions);
  const replay = replayDecisionList(simulator, initialState, actionEntries);
  const goalFailures = replay.ok && finalGoal
    ? validateCandidateFully(project, replay.state, finalGoal)
    : [];
  const finalHp = replay.ok ? heroHp(replay.state) : null;
  return {
    ok: replay.ok,
    replayFailure: replay.ok ? null : replay.failure,
    goalFailures,
    finalHp,
    hpDeltaVsBaseline: finalHp == null || baselineHp == null
      ? null
      : finalHp - baselineHp,
  };
}

function enumerateActionSummaries(simulator, state) {
  const summaries = new Set();
  const addActions = (actions) => {
    for (const action of actions || []) {
      if (action && action.summary) summaries.add(action.summary);
    }
  };
  const primitive = simulator.enumeratePrimitiveActions(state);
  addActions(primitive && primitive.actions);
  if (typeof simulator.enumerateInteractPickupActions === "function") {
    addActions(simulator.enumerateInteractPickupActions(state));
  }
  if (typeof simulator.enumerateFloorFlyActions === "function") {
    addActions(simulator.enumerateFloorFlyActions(state));
  }
  addActions(simulator.enumerateActions(state));
  return summaries;
}

function findInsertionOpportunities(
  simulator,
  initialState,
  prefixDecisions,
  candidateWindow,
  probeActions,
) {
  const actionSet = new Set(probeActions);
  const opportunities = [];
  let state = cloneState(initialState);
  if (prefixDecisions.length > 0) {
    const prefixReplay = replayDecisionList(simulator, state, prefixDecisions);
    if (!prefixReplay.ok) return opportunities;
    state = prefixReplay.state;
  }
  for (let insertAt = 0; insertAt <= candidateWindow.length; insertAt += 1) {
    const available = enumerateActionSummaries(simulator, state);
    for (const summary of actionSet) {
      if (available.has(summary)) {
        opportunities.push({ summary, insertAt });
      }
    }
    if (insertAt >= candidateWindow.length) break;
    const next = replayDecisionList(simulator, state, [candidateWindow[insertAt]]);
    if (!next.ok) break;
    state = next.state;
  }
  return opportunities;
}

function probeSingleInsertions(
  project,
  simulator,
  initialState,
  prefixDecisions,
  suffixDecisions,
  candidateWindow,
  baselineOnlySummaries,
  finalGoal,
  baselineHp,
  limit,
) {
  const probeActions = uniqueSummaries(baselineOnlySummaries)
    .filter(isProbeableSummary);
  const opportunities = findInsertionOpportunities(
    simulator,
    initialState,
    prefixDecisions,
    candidateWindow,
    probeActions,
  );
  const probes = [];
  for (const opportunity of opportunities) {
    const patchedWindow = candidateWindow
      .slice(0, opportunity.insertAt)
      .concat([decision(opportunity.summary)])
      .concat(candidateWindow.slice(opportunity.insertAt));
    probes.push({
      type: "insert",
      summary: opportunity.summary,
      insertAt: opportunity.insertAt,
      ...evaluateWindowPatch(
        project,
        simulator,
        initialState,
        prefixDecisions,
        suffixDecisions,
        patchedWindow,
        finalGoal,
        baselineHp,
      ),
    });
  }
  return probes
    .sort((left, right) =>
      Number(right.ok) - Number(left.ok)
      || (left.goalFailures || []).length - (right.goalFailures || []).length
      || number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
      || String(left.summary).localeCompare(String(right.summary))
      || left.insertAt - right.insertAt,
    )
    .slice(0, limit);
}

function probeInsertionThenSwap(
  project,
  simulator,
  initialState,
  prefixDecisions,
  suffixDecisions,
  candidateWindow,
  finalGoal,
  baselineHp,
  insertionProbes,
  seedLimit,
  resultLimit,
) {
  const seeds = (insertionProbes || [])
    .filter((probe) => probe.ok && (probe.goalFailures || []).length === 0)
    .slice()
    .sort((left, right) => number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity))
    .slice(0, seedLimit);
  const probes = [];
  for (const seed of seeds) {
    const seededWindow = candidateWindow
      .slice(0, seed.insertAt)
      .concat([decision(seed.summary)])
      .concat(candidateWindow.slice(seed.insertAt));
    for (let leftIndex = 0; leftIndex < seededWindow.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < seededWindow.length; rightIndex += 1) {
        const patchedWindow = seededWindow.slice();
        const tmp = patchedWindow[leftIndex];
        patchedWindow[leftIndex] = patchedWindow[rightIndex];
        patchedWindow[rightIndex] = tmp;
        probes.push({
          type: "insert-swap",
          insertedSummary: seed.summary,
          insertAt: seed.insertAt,
          swap: [leftIndex, rightIndex],
          leftSummary: routeEntrySummary(seededWindow[leftIndex]),
          rightSummary: routeEntrySummary(seededWindow[rightIndex]),
          ...evaluateWindowPatch(
            project,
            simulator,
            initialState,
            prefixDecisions,
            suffixDecisions,
            patchedWindow,
            finalGoal,
            baselineHp,
          ),
        });
      }
    }
  }
  return probes
    .filter((probe) => probe.ok || probe.swap[0] === 0)
    .sort((left, right) =>
      Number(right.ok) - Number(left.ok)
      || (left.goalFailures || []).length - (right.goalFailures || []).length
      || number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
      || left.swap[0] - right.swap[0]
      || left.swap[1] - right.swap[1],
    )
    .slice(0, resultLimit);
}

function applyWindowProbe(candidateWindow, selected) {
  let window = candidateWindow.slice();
  if (!selected) return window;
  if (selected.type === "insert" || selected.type === "insert-swap") {
    window = window
      .slice(0, selected.insertAt)
      .concat([decision(selected.insertedSummary || selected.summary)])
      .concat(window.slice(selected.insertAt));
  }
  if (selected.type === "insert-swap") {
    window = window.slice();
    const left = selected.swap[0];
    const right = selected.swap[1];
    const temp = window[left];
    window[left] = window[right];
    window[right] = temp;
  }
  return window;
}

function bestSuccessfulProbe(entries, baselineHp) {
  return (entries || [])
    .filter((entry) =>
      entry
      && entry.ok
      && (entry.goalFailures || []).length === 0
      && entry.finalHp != null
      && entry.finalHp > baselineHp
    )
    .slice()
    .sort((left, right) =>
      number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
      || String(left.sourceCandidateId || "").localeCompare(String(right.sourceCandidateId || ""))
    )[0] || null;
}

function runLocalWindowProbeSearch(params) {
  const {
    project,
    simulator,
    initialState,
    prefixDecisions,
    suffixDecisions,
    rawCandidates,
    prefixRouteLength,
    baselineWindowSummaries,
    finalGoal,
    baselineHp,
    candidateLimit,
    insertionLimit,
    insertionSeedLimit,
    swapLimit,
    swapCandidateLimit,
  } = params;
  const attempts = [];
  const accepted = [];
  const swapSeeds = [];
  const candidates = (rawCandidates || [])
    .slice()
    .sort(compareCandidates)
    .slice(0, candidateLimit);
  for (const candidate of candidates) {
    const candidateId = candidate._globalId || candidate.id || `raw-${attempts.length + 1}`;
    const candidateWindow = extractWindowActions(candidate.route, prefixRouteLength)
      .map((entry) => decision(routeEntrySummary(entry)));
    const candidateSummaries = candidateWindow.map(routeEntrySummary);
    const diff = multisetDiff(baselineWindowSummaries, candidateSummaries);
    const baseReplay = evaluateWindowPatch(
      project,
      simulator,
      initialState,
      prefixDecisions,
      suffixDecisions,
      candidateWindow,
      finalGoal,
      baselineHp,
    );
    const attempt = {
      candidateId,
      candidateFinalHp: number(((candidate.hero || {}).hp), null),
      baselineOnlyCount: diff.onlyLeft.length,
      candidateOnlyCount: diff.onlyRight.length,
      baseReplayOk: baseReplay.ok,
      baseReplayFailure: baseReplay.replayFailure,
      baseGoalFailures: baseReplay.goalFailures || [],
      baseFinalHp: baseReplay.finalHp,
      insertionProbeCount: 0,
      swapProbeCount: 0,
      bestInsertion: null,
      bestSwap: null,
      skippedReason: null,
      accepted: null,
    };
    if (!baseReplay.ok || (baseReplay.goalFailures || []).length > 0) {
      attempt.skippedReason = !baseReplay.ok
        ? "base-replay-failed"
        : "base-goal-mismatch";
      attempts.push(attempt);
      continue;
    }
    const insertionProbes = probeSingleInsertions(
      project,
      simulator,
      initialState,
      prefixDecisions,
      suffixDecisions,
      candidateWindow,
      diff.onlyLeft,
      finalGoal,
      baselineHp,
      insertionLimit,
    );
    const bestInsertion = insertionProbes.find(
      (probe) => probe.ok && (probe.goalFailures || []).length === 0,
    ) || null;
    const candidateAccepted = bestSuccessfulProbe(
      insertionProbes.map((probe) => ({
        ...probe,
        sourceCandidateId: candidateId,
      })),
      baselineHp,
    );
    attempt.insertionProbeCount = insertionProbes.length;
    attempt.bestInsertion = insertionProbes[0] || null;
    attempt.accepted = candidateAccepted || null;
    attempts.push(attempt);
    if (candidateAccepted) {
      accepted.push({
        candidate,
        candidateId,
        probe: candidateAccepted,
        patchedWindow: applyWindowProbe(candidateWindow, candidateAccepted),
      });
    }
    if (bestInsertion) {
      swapSeeds.push({
        candidate,
        candidateId,
        candidateWindow,
        insertionProbe: bestInsertion,
        attempt,
      });
    }
  }
  for (const seed of swapSeeds
    .slice()
    .sort((left, right) =>
      number(right.insertionProbe.finalHp, -Infinity)
        - number(left.insertionProbe.finalHp, -Infinity)
    )
    .slice(0, swapCandidateLimit)) {
    const swapProbes = probeInsertionThenSwap(
      project,
      simulator,
      initialState,
      prefixDecisions,
      suffixDecisions,
      seed.candidateWindow,
      finalGoal,
      baselineHp,
      [seed.insertionProbe],
      insertionSeedLimit,
      swapLimit,
    );
    const candidateAccepted = bestSuccessfulProbe(
      swapProbes.map((probe) => ({
        ...probe,
        sourceCandidateId: seed.candidateId,
      })),
      baselineHp,
    );
    seed.attempt.swapProbeCount = swapProbes.length;
    seed.attempt.bestSwap = swapProbes[0] || null;
    if (candidateAccepted) {
      seed.attempt.accepted = candidateAccepted;
      accepted.push({
        candidate: seed.candidate,
        candidateId: seed.candidateId,
        probe: candidateAccepted,
        patchedWindow: applyWindowProbe(seed.candidateWindow, candidateAccepted),
      });
    }
  }
  accepted.sort((left, right) =>
    number(right.probe.finalHp, -Infinity) - number(left.probe.finalHp, -Infinity)
    || String(left.candidateId).localeCompare(String(right.candidateId)),
  );
  return {
    attempts,
    accepted: accepted[0] || null,
  };
}

function runBaselineWindowSwapSearch(params) {
  const {
    project,
    simulator,
    initialState,
    prefixDecisions,
    suffixDecisions,
    baselineWindow,
    finalGoal,
    baselineHp,
    resultLimit,
    maxDepth,
    beamWidth,
  } = params;
  const attempts = [];
  let best = null;
  let frontier = [{
    window: baselineWindow.slice(),
    swaps: [],
    finalHp: baselineHp,
  }];
  const depthLimit = Math.max(1, Math.floor(number(maxDepth, 1)));
  const nextBeamWidth = Math.max(1, Math.floor(number(beamWidth, 1)));
  for (let depth = 0; depth < depthLimit; depth += 1) {
    const nextFrontier = [];
    for (const seed of frontier) {
      for (let leftIndex = 0; leftIndex < seed.window.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < seed.window.length; rightIndex += 1) {
          const swap = [leftIndex, rightIndex];
          const swapKey = swap.join(",");
          if ((seed.swaps || []).some((used) => used.join(",") === swapKey)) continue;
          const patchedWindow = seed.window.slice();
          const temp = patchedWindow[leftIndex];
          patchedWindow[leftIndex] = patchedWindow[rightIndex];
          patchedWindow[rightIndex] = temp;
          const evaluated = evaluateWindowPatch(
            project,
            simulator,
            initialState,
            prefixDecisions,
            suffixDecisions,
            patchedWindow,
            finalGoal,
            baselineHp,
          );
          const swaps = (seed.swaps || []).concat([swap]);
          const attempt = {
            type: swaps.length === 1 ? "baseline-swap" : "baseline-swap-chain",
            depth: swaps.length,
            swap,
            swaps,
            leftSummary: routeEntrySummary(seed.window[leftIndex]),
            rightSummary: routeEntrySummary(seed.window[rightIndex]),
            ...evaluated,
          };
          attempts.push(attempt);
          if (attempt.ok && (attempt.goalFailures || []).length === 0) {
            nextFrontier.push({
              window: patchedWindow,
              swaps,
              finalHp: attempt.finalHp,
              probe: attempt,
            });
            if (
              attempt.finalHp > baselineHp
              && (!best || attempt.finalHp > best.probe.finalHp)
            ) {
              best = {
                probe: attempt,
                patchedWindow,
              };
            }
          }
        }
      }
    }
    frontier = nextFrontier
      .sort((left, right) =>
        number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
        || left.swaps.length - right.swaps.length,
      )
      .slice(0, nextBeamWidth);
    if (frontier.length === 0) break;
  }
  return {
    attempts: attempts
      .filter((attempt) => attempt.ok || attempt.swap[0] === 0)
      .sort((left, right) =>
        Number(right.ok) - Number(left.ok)
        || (left.goalFailures || []).length - (right.goalFailures || []).length
        || number(right.finalHp, -Infinity) - number(left.finalHp, -Infinity)
        || left.swap[0] - right.swap[0]
        || left.swap[1] - right.swap[1],
      )
      .slice(0, resultLimit),
    accepted: best,
  };
}

function routeEntrySummary(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.summary === "string") return entry.summary;
  return String(entry || "");
}

function routeStartsWith(route, prefix) {
  if (!Array.isArray(route) || !Array.isArray(prefix)) return false;
  if (route.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (routeEntrySummary(route[i]) !== routeEntrySummary(prefix[i])) return false;
  }
  return true;
}

function isMobilitySummary(summary) {
  const text = String(summary || "");
  return text.startsWith("changeFloor@") || text.startsWith("floorFly:");
}

function countSummaryOverlap(summaries, referenceSummaries, filter) {
  const counts = new Map();
  for (const summary of referenceSummaries || []) {
    if (filter && !filter(summary)) continue;
    counts.set(summary, (counts.get(summary) || 0) + 1);
  }
  let matched = 0;
  for (const summary of summaries || []) {
    if (filter && !filter(summary)) continue;
    const count = counts.get(summary) || 0;
    if (count <= 0) continue;
    matched += 1;
    counts.set(summary, count - 1);
  }
  return matched;
}

function parsePortalTransition(summary, currentFloorId, floorIds) {
  const text = String(summary || "");
  if (text.startsWith("floorFly:")) {
    const match = text.match(/^floorFly:([^@]+)@([^:]+):/);
    if (!match) return null;
    return { from: match[2], to: match[1], kind: "floorFly" };
  }
  if (text.startsWith("changeFloor@")) {
    const match = text.match(/^changeFloor@([^:]+):/);
    if (!match) return null;
    const from = match[1] || currentFloorId;
    let to = null;
    const floors = Array.isArray(floorIds) ? floorIds.filter(Boolean) : [];
    if (floors.length === 2 && floors.includes(from)) {
      to = floors[0] === from ? floors[1] : floors[0];
    }
    return { from, to, kind: "changeFloor" };
  }
  return null;
}

function buildPortalTransitions(summaries, startFloorId, floorIds) {
  const transitions = [];
  let currentFloorId = startFloorId || null;
  for (const summary of summaries || []) {
    const transition = parsePortalTransition(summary, currentFloorId, floorIds);
    if (!transition) continue;
    transitions.push({
      from: transition.from || currentFloorId || null,
      to: transition.to || null,
      kind: transition.kind,
    });
    currentFloorId = transition.to || currentFloorId;
  }
  return transitions;
}

function portalTransitionKey(transition) {
  if (!transition || !transition.from || !transition.to) return null;
  return `${transition.from}->${transition.to}`;
}

function countPortalTransitionOverlap(transitions, referenceTransitions) {
  const counts = new Map();
  for (const transition of referenceTransitions || []) {
    const key = portalTransitionKey(transition);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let matched = 0;
  for (const transition of transitions || []) {
    const key = portalTransitionKey(transition);
    if (!key) continue;
    const count = counts.get(key) || 0;
    if (count <= 0) continue;
    matched += 1;
    counts.set(key, count - 1);
  }
  return matched;
}

function annotateBaselineMatches(
  candidate,
  prefixRouteLength,
  baselineWindowSummaries,
  baselinePortalTransitions,
  startFloorId,
  floorIds,
) {
  const windowSummaries = extractWindowActions(candidate.route, prefixRouteLength)
    .map(routeEntrySummary);
  candidate._baselineMatchCount = countSummaryOverlap(
    windowSummaries,
    baselineWindowSummaries,
    null,
  );
  candidate._baselineMobilityMatchCount = countSummaryOverlap(
    windowSummaries,
    baselineWindowSummaries,
    isMobilitySummary,
  );
  candidate._baselinePortalMatchCount = countPortalTransitionOverlap(
    buildPortalTransitions(windowSummaries, startFloorId, floorIds),
    baselinePortalTransitions,
  );
  return candidate;
}

function runRouteWindowRepair(project, simulator, routeRecord, profile, options) {
  const config = options || {};
  const decisions = routeRecord.decisions || [];
  const debugTrace = [];

  // 1-based closed interval from profile or config.
  const windowStart1 = number(config.windowStart, profile.windowStart);
  const windowEnd1 = number(config.windowEnd, profile.windowEnd);
  const startIndex = windowStart1 - 1;
  const endExclusive = windowEnd1;
  const baselineHpOverride = config.baselineHp != null
    ? number(config.baselineHp, null)
    : null;
  const maxExpansions = number(config.windowMaxExpansions, 12000);
  const maxRuntimeMs = number(config.windowMaxRuntimeMs, 30000);
  const candidateLimit = number(config.windowCandidateLimit, 4);
  const goalSkylineLimit = number(config.windowGoalSkylineLimit, 8);
  const dpSkylineMax = number(config.windowDpSkylineMax, 4);
  const preserveWindowPrefix = Math.max(0, Math.floor(number(config.preserveWindowPrefix, 0)));
  const localProbeEnabled = config.localProbe !== false;
  const localProbeCandidateLimit = Math.max(0, Math.floor(number(config.localProbeCandidateLimit, 32)));
  const localProbeInsertionLimit = Math.max(0, Math.floor(number(config.localProbeInsertionLimit, 40)));
  const localProbeInsertionSeedLimit = Math.max(0, Math.floor(number(config.localProbeInsertionSeedLimit, 3)));
  const localProbeSwapLimit = Math.max(0, Math.floor(number(config.localProbeSwapLimit, 60)));
  const localProbeSwapCandidateLimit = Math.max(0, Math.floor(number(config.localProbeSwapCandidateLimit, 4)));
  const baselineLocalProbeEnabled = config.baselineLocalProbe !== false;
  const baselineLocalProbeLimit = Math.max(0, Math.floor(number(config.baselineLocalProbeLimit, 40)));
  const baselineLocalProbeDepth = Math.max(1, Math.floor(number(config.baselineLocalProbeDepth, 3)));
  const baselineLocalProbeBeamWidth = Math.max(1, Math.floor(number(config.baselineLocalProbeBeamWidth, 1)));
  const floors = Array.isArray(config.windowFloors || profile.floors)
    ? config.windowFloors || profile.floors
    : [];
  const stageThresholds = profile.stageThresholds || null;
  // Action-policy switches: allow the caller to disable or deprioritize
  // floorFly actions.  The DP prefers floorFly over changeFloor (shorter
  // paths but different arrival positions → more damaging battle
  // sequences).  Disabling floorFly forces the search to use changeFloor,
  // matching the baseline route form.
  const disableFloorFly = Boolean(config.disableFloorFly);
  const maxFloorFlyPerTarget = config.maxFloorFlyPerTarget != null
    ? number(config.maxFloorFlyPerTarget, null)
    : null;
  // When disableFloorFly is true, this option re-enables floorFly for the
  // final stage only.  This gives the best of both worlds: stages 0–1 use
  // changeFloor (high HP), and the final stage can use floorFly to reach
  // tiles that are otherwise unreachable.
  const enableFloorFlyFinalStage = Boolean(config.enableFloorFlyFinalStage);

  if (startIndex < 0 || endExclusive < windowStart1 || endExclusive > decisions.length) {
    return {
      ok: false,
      stoppedReason: "invalid-window",
      windowStart: windowStart1,
      windowEnd: windowEnd1,
      startIndex,
      endExclusive,
      decisionCount: decisions.length,
      debugTrace,
    };
  }

  // Split decisions: prefix [0, startIndex), window [startIndex, endExclusive), suffix [endExclusive, end).
  const prefixDecisions = decisions.slice(0, startIndex);
  const windowDecisions = decisions.slice(startIndex, endExclusive);
  const suffixDecisions = decisions.slice(endExclusive);
  const baselineWindowSummaries = windowDecisions.map((entry) => entry.summary);
  const baselinePortalTransitions = buildPortalTransitions(
    baselineWindowSummaries,
    null,
    floors,
  );
  const preservedWindowDecisions = windowDecisions.slice(
    0,
    Math.min(preserveWindowPrefix, windowDecisions.length),
  );

  // Replay prefix to obtain window start state.
  const startSnapshot = routeRecord.start && routeRecord.start.snapshot;
  if (!startSnapshot) {
    return { ok: false, stoppedReason: "missing-start-snapshot", debugTrace };
  }
  const initialState = createStateFromSnapshot(project, startSnapshot, {
    rank: (routeRecord.source || {}).rank || "chaos",
  });
  const prefixReplay = replayDecisionList(simulator, initialState, prefixDecisions);
  if (!prefixReplay.ok) {
    return {
      ok: false,
      stoppedReason: "prefix-replay-failed",
      failure: prefixReplay.failure,
      debugTrace,
    };
  }
  const windowStartState = prefixReplay.state;
  const prefixRouteLength = Array.isArray(windowStartState.route)
    ? windowStartState.route.length
    : 0;
  const preservedReplay = replayDecisionList(
    simulator,
    windowStartState,
    preservedWindowDecisions,
  );
  if (!preservedReplay.ok) {
    return {
      ok: false,
      stoppedReason: "preserved-prefix-replay-failed",
      failure: preservedReplay.failure,
      debugTrace,
    };
  }
  const stageStartState = preservedReplay.state;

  debugTrace.push({
    marker: "window-start",
    floorId: windowStartState.floorId,
    heroLoc: { ...((windowStartState.hero || {}).loc || {}) },
    heroHp: heroHp(windowStartState),
    prefixRouteLength,
    windowStart: windowStart1,
    windowEnd: windowEnd1,
    preserveWindowPrefix: preservedWindowDecisions.length,
    baselinePortalTransitions: baselinePortalTransitions.map(portalTransitionKey).filter(Boolean),
  });

  // Replay window decisions to obtain window end state.
  const windowReplay = replayDecisionList(
    simulator,
    windowStartState,
    windowDecisions,
  );
  if (!windowReplay.ok) {
    return {
      ok: false,
      stoppedReason: "window-replay-failed",
      failure: windowReplay.failure,
      debugTrace,
    };
  }
  const windowEndState = windowReplay.state;

  // Full baseline replay to auto-derive HP and validate.
  const baselineFull = replayDecisionList(simulator, initialState, decisions);
  if (!baselineFull.ok) {
    return {
      ok: false,
      stoppedReason: "baseline-replay-failed",
      failure: baselineFull.failure,
      debugTrace,
    };
  }
  const baselineFinalHp = baselineHpOverride != null
    ? baselineHpOverride
    : heroHp(baselineFull.state);

  // Derive final goal from profile + baseline replay.
  const removedTiles = collectRemovedTilesDelta(windowStartState, windowEndState, floors);
  const baselineHero = baselineFull.state.hero || {};
  const profileGoal = profile.goal || {};
  const finalGoal = {
    floorId: profileGoal.floorId || baselineFull.state.floorId || "MT5",
    minHero: profileGoal.minHero || {
      atk: number(baselineHero.atk, 0),
      def: number(baselineHero.def, 0),
      mdef: number(baselineHero.mdef, 0),
      lv: number(baselineHero.lv, 0),
      exp: number(baselineHero.exp, 0),
    },
    equipmentIncludes: profileGoal.equipmentIncludes
      || (Array.isArray(baselineHero.equipment) ? baselineHero.equipment.slice() : []),
    removedTiles,
  };

  // Action policy and DP config.
  // When disableFloorFly is true, "floorFly" is omitted from actionKinds.
  // This forces the DP to use changeFloor actions for inter-floor travel,
  // matching the baseline route form (changeFloor@MT4:6,12).
  const baseActionKinds = [
    "battle", "pickup", "interactPickup", "equip",
    "openDoor", "useTool", "changeFloor", "event",
  ];
  const actionKinds = disableFloorFly
    ? baseActionKinds
    : baseActionKinds.concat("floorFly");
  const actionPolicy = {
    actionKinds,
    allowedFloors: floors,
    allowChangeFloors: floors,
    forbidUnsupportedEvents: true,
  };
  if (maxFloorFlyPerTarget != null) {
    actionPolicy.maxFloorFlyPerTarget = maxFloorFlyPerTarget;
  }
  debugTrace.push({
    label: "action-policy",
    disableFloorFly,
    enableFloorFlyFinalStage,
    maxFloorFlyPerTarget,
    actionKinds,
    preserveWindowPrefix: preservedWindowDecisions.length,
  });
  const dpConfig = { maxExpansions, maxRuntimeMs, goalSkylineLimit, dpSkylineMax };

  // Run three stages.
  const stages = [0, 1, 2];
  let currentStartStates = [{ state: stageStartState, originId: "baseline" }];
  const stageResults = [];
  let farthestStage = -1;
  let finalCandidates = [];
  let finalRawCandidates = [];

  for (const stageIndex of stages) {
    const stageGoal = buildStageGoals(stageIndex, finalGoal, stageThresholds);
    // Stage-specific action policy: when enableFloorFlyFinalStage is true
    // and this is the last stage, re-enable floorFly so the search can
    // reach tiles that are unreachable via changeFloor alone.
    let stageActionPolicy = actionPolicy;
    const isFinalStage = stageIndex === stages.length - 1;
    if (disableFloorFly && enableFloorFlyFinalStage && isFinalStage) {
      stageActionPolicy = {
        ...actionPolicy,
        actionKinds: actionKinds.concat("floorFly"),
      };
      debugTrace.push({
        label: "stage-action-policy-override",
        stageIndex,
        reason: "enableFloorFlyFinalStage",
        actionKinds: stageActionPolicy.actionKinds,
        maxFloorFlyPerTarget: stageActionPolicy.maxFloorFlyPerTarget,
      });
    }
    const segment = buildSegmentForStage(
      stageGoal,
      stageActionPolicy,
      dpConfig,
      `window-repair-stage-${stageIndex + 1}`,
    );
    const allRawCandidates = [];
    const allSearchResults = [];

    for (const startEntry of currentStartStates) {
      const searchResult = searchSegmentDP(simulator, startEntry.state, segment, {
        captureTrace: true,
        prefixTrace: [],
        maxExpansions: segment.dp.maxExpansions,
        maxRuntimeMs: segment.dp.maxRuntimeMs,
        candidateLimit: goalSkylineLimit,
        preserveSkylineRoles: true,
      });
      allSearchResults.push(searchResult);
      const rawSkyline = Array.isArray(searchResult.goalSkyline)
        ? searchResult.goalSkyline
        : [];
      // Prepend the start state's route so candidate.route is globally
      // accurate (prefix + previous stages + current stage DP actions).
      // searchSegmentDP's reconstructRoute only returns stage-local
      // actions for child nodes.  We accumulate by prepending the start
      // state's route, but must avoid double-prepending when the
      // candidate's route already includes it (e.g. root-node goal).
      const startRoute = Array.isArray(startEntry.state.route)
        ? startEntry.state.route.slice()
        : [];
      for (const candidate of rawSkyline) {
        if (!candidate || !candidate.state) continue;
        if (!routeStartsWith(candidate.route, startRoute)) {
          candidate.route = startRoute.concat(
            Array.isArray(candidate.route) ? candidate.route : [],
          );
        }
        // Sync state.route so the next stage's DP search starts
        // with the full accumulated route.
        candidate.state.route = candidate.route.slice();
        annotateBaselineMatches(
          candidate,
          prefixRouteLength,
          baselineWindowSummaries,
          baselinePortalTransitions,
          windowStartState.floorId,
          floors,
        );
        allRawCandidates.push(candidate);
      }
    }

    const deduped = deduplicateAndSortCandidates(
      allRawCandidates,
      stageIndex,
      candidateLimit,
    );
    const rawDeduped = deduplicateAndSortCandidates(
      allRawCandidates,
      stageIndex,
      Math.max(candidateLimit, localProbeCandidateLimit),
    );
    stageResults.push(
      summarizeStageResult(
        stageIndex,
        segment,
        allSearchResults,
        allRawCandidates.length,
        deduped,
      ),
    );
    farthestStage = stageIndex;

    const stageBestHp = deduped.reduce(
      (best, c) => Math.max(best, number(((c.hero || {}).hp), 0)),
      0,
    );
    debugTrace.push({
      marker: "stage-complete",
      stageIndex,
      rawCandidateCount: allRawCandidates.length,
      candidateCount: deduped.length,
      expansions: stageResults[stageResults.length - 1].expansions,
      bestCandidateHp: stageBestHp,
      candidateIds: deduped.map((c) => c._globalId),
    });

    if (deduped.length === 0) {
      return buildFailureResult({
        stoppedReason: "no-candidates",
        farthestStage,
        stageResults,
        baselineHp: baselineFinalHp,
        windowStart: windowStart1,
        windowEnd: windowEnd1,
        finalGoal,
        debugTrace,
      });
    }

    if (stageIndex === stages.length - 1) {
      finalCandidates = deduped;
      finalRawCandidates = rawDeduped;
    } else {
      currentStartStates = deduped.map((candidate) => ({
        state: candidate.state,
        originId: candidate._globalId,
      }));
    }
  }

  // Validate each final candidate with full replay from initial state.
  const validations = [];
  for (const candidate of finalCandidates) {
    const windowActions = extractWindowActions(candidate.route, prefixRouteLength);
    candidate._windowActions = windowActions;

    const fullReplay = replayDecisionList(
      simulator,
      cloneState(initialState),
      [].concat(
        prefixDecisions,
        windowActions.map((entry) => toDecisionEntry(entry)),
        suffixDecisions,
      ),
    );

    if (!fullReplay.ok) {
      validations.push(
        summarizeValidation(candidate, fullReplay, baselineFinalHp, [], false),
      );
      continue;
    }

    const goalFailures = validateCandidateFully(project, fullReplay.state, finalGoal);
    const finalHp = heroHp(fullReplay.state);
    const accepted = goalFailures.length === 0 && finalHp > baselineFinalHp;
    validations.push(
      summarizeValidation(candidate, fullReplay, baselineFinalHp, goalFailures, accepted),
    );
  }

  const acceptedValidations = validations.filter((entry) => entry.accepted);
  const bestValidationHp = validations.reduce(
    (best, entry) => Math.max(best, entry.finalHp || 0),
    0,
  );
  debugTrace.push({
    marker: "validation-complete",
    candidateCount: validations.length,
    acceptedCount: acceptedValidations.length,
    bestValidationHp,
    baselineHp: baselineFinalHp,
    rejections: validations.filter((v) => !v.accepted).map((v) => ({
      candidateId: v.candidateId,
      reason: v.rejectedReason,
      finalHp: v.finalHp,
    })),
  });

  let localProbeResult = null;
  let baselineLocalProbeResult = null;
  let best = null;
  let bestCandidate = null;
  if (baselineLocalProbeEnabled) {
    baselineLocalProbeResult = runBaselineWindowSwapSearch({
      project,
      simulator,
      initialState: cloneState(windowStartState),
      prefixDecisions: [],
      suffixDecisions,
      baselineWindow: windowDecisions.map((entry) => decision(entry.summary)),
      finalGoal,
      baselineHp: baselineFinalHp,
      resultLimit: baselineLocalProbeLimit,
      maxDepth: baselineLocalProbeDepth,
      beamWidth: baselineLocalProbeBeamWidth,
    });
    debugTrace.push({
      marker: "baseline-local-probe-complete",
      enabled: baselineLocalProbeEnabled,
      attemptedCount: (baselineLocalProbeResult.attempts || []).length,
      accepted: baselineLocalProbeResult.accepted
        ? {
            type: baselineLocalProbeResult.accepted.probe.type,
            finalHp: baselineLocalProbeResult.accepted.probe.finalHp,
            swap: baselineLocalProbeResult.accepted.probe.swap,
          }
        : null,
    });
    if (baselineLocalProbeResult.accepted) {
      const probe = baselineLocalProbeResult.accepted.probe;
      bestCandidate = {
        id: "baseline-local-probe",
        _globalId: `baseline-local-probe/${probe.type}`,
        _windowActions: baselineLocalProbeResult.accepted.patchedWindow,
        _localProbe: probe,
        hero: null,
        effectiveHero: null,
        tags: ["baseline-local-probe"],
      };
      best = {
        candidateId: bestCandidate._globalId,
        sourceCandidateId: "baseline",
        localProbe: true,
        baselineLocalProbe: true,
        probeType: probe.type,
        probe,
        hero: null,
        effectiveHero: null,
        tags: ["baseline-local-probe"],
        baselineMatchCount: baselineWindowSummaries.length,
        baselineMobilityMatchCount: countSummaryOverlap(
          baselineWindowSummaries,
          baselineWindowSummaries,
          isMobilitySummary,
        ),
        baselinePortalMatchCount: baselinePortalTransitions.length,
        windowActionCount: baselineLocalProbeResult.accepted.patchedWindow.length,
        actionTrace: baselineLocalProbeResult.accepted.patchedWindow.map(routeEntrySummary),
        fullReplayOk: true,
        replayFailure: null,
        goalFailures: probe.goalFailures || [],
        finalHp: probe.finalHp,
        baselineHp: baselineFinalHp,
        hpImproved: probe.finalHp > baselineFinalHp,
        accepted: true,
        rejectedReason: null,
      };
      validations.push(best);
      acceptedValidations.push(best);
    }
  }
  if (localProbeEnabled && finalRawCandidates.length > 0) {
    localProbeResult = runLocalWindowProbeSearch({
      project,
      simulator,
      initialState: cloneState(windowStartState),
      prefixDecisions: [],
      suffixDecisions,
      rawCandidates: finalRawCandidates,
      prefixRouteLength,
      baselineWindowSummaries,
      finalGoal,
      baselineHp: baselineFinalHp,
      candidateLimit: localProbeCandidateLimit,
      insertionLimit: localProbeInsertionLimit,
      insertionSeedLimit: localProbeInsertionSeedLimit,
      swapLimit: localProbeSwapLimit,
      swapCandidateLimit: localProbeSwapCandidateLimit,
    });
    debugTrace.push({
      marker: "local-probe-complete",
      enabled: localProbeEnabled,
      candidateCount: finalRawCandidates.length,
      attemptedCount: (localProbeResult.attempts || []).length,
      accepted: localProbeResult.accepted
        ? {
            candidateId: localProbeResult.accepted.candidateId,
            type: localProbeResult.accepted.probe.type,
            finalHp: localProbeResult.accepted.probe.finalHp,
          }
        : null,
    });
    if (localProbeResult.accepted) {
      const probe = localProbeResult.accepted.probe;
      const probeCandidate = {
        ...localProbeResult.accepted.candidate,
        _globalId: `${localProbeResult.accepted.candidateId}/probe-${probe.type}`,
        _windowActions: localProbeResult.accepted.patchedWindow,
        _localProbe: probe,
      };
      const probeValidation = {
        candidateId: probeCandidate._globalId,
        sourceCandidateId: localProbeResult.accepted.candidateId,
        localProbe: true,
        probeType: probe.type,
        probe,
        hero: probeCandidate.hero || null,
        effectiveHero: probeCandidate.effectiveHero || null,
        tags: Array.isArray(probeCandidate.tags) ? probeCandidate.tags.slice() : [],
        baselineMatchCount: number(probeCandidate._baselineMatchCount, 0),
        baselineMobilityMatchCount: number(probeCandidate._baselineMobilityMatchCount, 0),
        baselinePortalMatchCount: number(probeCandidate._baselinePortalMatchCount, 0),
        windowActionCount: localProbeResult.accepted.patchedWindow.length,
        actionTrace: localProbeResult.accepted.patchedWindow.map(routeEntrySummary),
        fullReplayOk: true,
        replayFailure: null,
        goalFailures: probe.goalFailures || [],
        finalHp: probe.finalHp,
        baselineHp: baselineFinalHp,
        hpImproved: probe.finalHp > baselineFinalHp,
        accepted: true,
        rejectedReason: null,
      };
      validations.push(probeValidation);
      acceptedValidations.push(probeValidation);
      if (!best || (probeValidation.finalHp || 0) > (best.finalHp || 0)) {
        best = probeValidation;
        bestCandidate = probeCandidate;
      }
    }
  }

  if (acceptedValidations.length === 0) {
    return buildFailureResult({
      stoppedReason: "no-accepted-candidate",
      farthestStage,
      stageResults,
      validations,
      localProbeAttempts: localProbeResult ? localProbeResult.attempts : [],
      baselineLocalProbeAttempts: baselineLocalProbeResult ? baselineLocalProbeResult.attempts : [],
      baselineHp: baselineFinalHp,
      bestCandidateHp: bestValidationHp,
      windowStart: windowStart1,
      windowEnd: windowEnd1,
      finalGoal,
      debugTrace,
    });
  }

  acceptedValidations.sort((a, b) => (b.finalHp || 0) - (a.finalHp || 0));
  if (!best || (acceptedValidations[0].finalHp || 0) > (best.finalHp || 0)) {
    best = acceptedValidations[0];
    bestCandidate = finalCandidates.find(
      (c) => (c._globalId || c.id) === best.candidateId,
    );
  }

  debugTrace.push({
    marker: "route-selected",
    candidateId: best.candidateId,
    finalHp: best.finalHp,
    baselineHp: baselineFinalHp,
    hpImproved: best.hpImproved,
    actionTrace: best.actionTrace,
    windowActionCount: best.windowActionCount,
  });

  // Build repaired route record (no allowRouteMismatch).
  const windowActions = bestCandidate._windowActions || [];
  const fullActionEntries = [].concat(
    prefixDecisions.map(toSummaryDecision),
    windowActions.map((entry) => toDecisionEntry(entry)),
    suffixDecisions.map(toSummaryDecision),
  );

  let repairedRoute = null;
  let rebuildError = null;
  try {
    const rebuiltFinalState = replayDecisionList(simulator, initialState, fullActionEntries);
    if (!rebuiltFinalState.ok) {
      throw new Error(`Rebuilt replay failed: ${rebuiltFinalState.failure.reason}`);
    }
    repairedRoute = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState: rebuiltFinalState.state,
      actionEntries: fullActionEntries,
      options: {
        rank: (routeRecord.source || {}).rank || "chaos",
        solver: "window-repair",
        profile: profile.id || null,
        goalType: (routeRecord.goal || {}).type || "floor",
        toFloor: (routeRecord.goal || {}).floorId || finalGoal.floorId,
        metadata: routeRecord.metadata || null,
        projectRoot: config.projectRoot || null,
      },
    });
  } catch (error) {
    rebuildError = error && error.message ? error.message : String(error);
  }

  // Strict replay of the rebuilt route, then re-validate goal and HP.
  let strictReplayOk = false;
  let strictReplayError = null;
  let strictFinalHp = null;
  let strictGoalFailures = null;
  if (repairedRoute) {
    try {
      const strictReplay = replayDecisionList(
        simulator,
        cloneState(initialState),
        repairedRoute.decisions || [],
      );
      strictReplayOk = strictReplay.ok;
      if (!strictReplay.ok) {
        strictReplayError = strictReplay.failure;
      } else {
        // Re-validate full goal against strict replay terminal state.
        strictGoalFailures = validateCandidateFully(project, strictReplay.state, finalGoal);
        strictFinalHp = heroHp(strictReplay.state);
      }
    } catch (error) {
      strictReplayError = error && error.message ? error.message : String(error);
    }
  }

  debugTrace.push({
    marker: "strict-replay",
    repairedRouteBuilt: repairedRoute != null,
    strictReplayOk,
    strictFinalHp,
    baselineHp: baselineFinalHp,
    strictGoalFailures: strictGoalFailures
      ? strictGoalFailures.map((f) => f.field)
      : [],
    rebuildError: rebuildError || null,
    strictReplayError: strictReplayError
      ? (strictReplayError.reason || strictReplayError)
      : null,
  });

  // Reject if strict replay fails, goal not met, or HP not improved.
  if (repairedRoute && !strictReplayOk) {
    return buildFailureResult({
      stoppedReason: "rebuilt-route-strict-replay-failed",
      farthestStage,
      stageResults,
      validations,
      localProbeAttempts: localProbeResult ? localProbeResult.attempts : [],
      baselineLocalProbeAttempts: baselineLocalProbeResult ? baselineLocalProbeResult.attempts : [],
      baselineHp: baselineFinalHp,
      bestCandidateHp: best.finalHp,
      windowStart: windowStart1,
      windowEnd: windowEnd1,
      finalGoal,
      strictReplayError,
      debugTrace,
    });
  }
  if (repairedRoute && strictReplayOk && strictGoalFailures.length > 0) {
    return buildFailureResult({
      stoppedReason: "rebuilt-route-goal-mismatch",
      farthestStage,
      stageResults,
      validations,
      localProbeAttempts: localProbeResult ? localProbeResult.attempts : [],
      baselineLocalProbeAttempts: baselineLocalProbeResult ? baselineLocalProbeResult.attempts : [],
      baselineHp: baselineFinalHp,
      bestCandidateHp: best.finalHp,
      windowStart: windowStart1,
      windowEnd: windowEnd1,
      finalGoal,
      strictReplayError: { reason: "goal-mismatch", failures: strictGoalFailures },
      debugTrace,
    });
  }
  if (repairedRoute && strictReplayOk && strictFinalHp != null && strictFinalHp <= baselineFinalHp) {
    return buildFailureResult({
      stoppedReason: "rebuilt-route-hp-not-improved",
      farthestStage,
      stageResults,
      validations,
      localProbeAttempts: localProbeResult ? localProbeResult.attempts : [],
      baselineLocalProbeAttempts: baselineLocalProbeResult ? baselineLocalProbeResult.attempts : [],
      baselineHp: baselineFinalHp,
      bestCandidateHp: best.finalHp,
      strictFinalHp,
      windowStart: windowStart1,
      windowEnd: windowEnd1,
      finalGoal,
      debugTrace,
    });
  }

  return {
    ok: repairedRoute != null && strictReplayOk,
    route: repairedRoute,
    finalHp: strictFinalHp != null ? strictFinalHp : best.finalHp,
    baselineHp: baselineFinalHp,
    accepted: best,
    validations,
    localProbeAttempts: localProbeResult ? localProbeResult.attempts : [],
    baselineLocalProbeAttempts: baselineLocalProbeResult ? baselineLocalProbeResult.attempts : [],
    stageResults,
    farthestStage,
    windowStart: windowStart1,
    windowEnd: windowEnd1,
    finalGoal,
    rebuildError,
    strictReplayOk,
    strictFinalHp,
    strictGoalFailures,
    debugTrace,
    stoppedReason: repairedRoute && strictReplayOk ? "accepted" : "rebuild-failed",
  };
}

function buildFailureResult(detail) {
  return {
    ok: false,
    route: null,
    finalHp: null,
    baselineHp: detail.baselineHp || 0,
    accepted: null,
    validations: detail.validations || [],
    localProbeAttempts: detail.localProbeAttempts || [],
    baselineLocalProbeAttempts: detail.baselineLocalProbeAttempts || [],
    stageResults: detail.stageResults || [],
    farthestStage: detail.farthestStage,
    windowStart: detail.windowStart,
    windowEnd: detail.windowEnd,
    finalGoal: detail.finalGoal || null,
    bestCandidateHp: detail.bestCandidateHp || null,
    strictFinalHp: detail.strictFinalHp || null,
    rebuildError: detail.rebuildError || null,
    strictReplayError: detail.strictReplayError || null,
    debugTrace: detail.debugTrace || [],
    stoppedReason: detail.stoppedReason,
  };
}

module.exports = {
  runRouteWindowRepair,
  collectRemovedTilesDelta,
  replayDecisionList,
  buildStageGoals,
  validateCandidateFully,
  deduplicateAndSortCandidates,
  compareCandidates,
  candidateSortKey,
  buildPortalTransitions,
  countPortalTransitionOverlap,
};
