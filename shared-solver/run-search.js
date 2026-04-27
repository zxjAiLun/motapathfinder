"use strict";

const path = require("path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildActionExpansionCacheOptions, buildConfluenceDominanceOptions, buildResourceChainOptions, buildResourceClusterSearchOptions, buildResourcePocketSearchOptions, parseBooleanFlag, parseKeyValueArgs, parseOptionalNumber, resolveProjectRoot, shouldEnableResourceChain, shouldEnableResourceCluster, shouldEnableResourcePocket } = require("./lib/cli-options");
const { evaluateExpression } = require("./lib/expression");
const { summarizeLandmarks } = require("./lib/landmarks");
const { loadProject } = require("./lib/project-loader");
const { getProgress } = require("./lib/progress");
const { analyzeProgressBlocker } = require("./lib/progress-blockers");
const { repairFromCheckpoints } = require("./lib/checkpoint-repair");
const { checkpointPoolFromStore, loadCheckpointStore, mergeCheckpointPoolIntoStore, prependCheckpointPoolRoutePrefix, sanitizeCheckpointStore, saveCheckpointStore, selectCheckpointSeeds, summarizeStore, buildRouteFingerprint } = require("./lib/checkpoint-store");
const { buildRouteRecord, writeRouteFile } = require("./lib/route-store");
const { formatScore, getFloorOrder } = require("./lib/score");
const { searchTopK } = require("./lib/search");
const { searchDP } = require("./lib/dp-search");
const { createSearchProfile } = require("./lib/search-profiles");
const { applyConfigDefaults, loadSolverConfig } = require("./lib/solver-config");
const { summarizeStageObjective } = require("./lib/stage-policy");
const { StaticSimulator } = require("./lib/simulator");
const { cloneState, getDecisionDepth } = require("./lib/state");
const { summarizeConfluence, summarizePruning } = require("./lib/pruning-diagnostics");

function summarizeRepair(repair) {
  if (!repair) return null;
  return {
    attempted: repair.attempted,
    repaired: repair.repaired,
    selectedCheckpointId: repair.selectedCheckpointId,
    reason: repair.reason,
    candidatePlan: repair.candidatePlan,
    attempts: repair.attempts,
    finalFloorId: repair.repairedState && repair.repairedState.floorId,
    blockerType: repair.blocker && repair.blocker.blockerType,
  };
}

function countNotes(routeOrNotes) {
  return (routeOrNotes || []).reduce((result, note) => {
    result[note] = Number(result[note] || 0) + 1;
    return result;
  }, {});
}

function printActionPreview(actions) {
  const grouped = actions.reduce((result, action) => {
    result[action.kind] = (result[action.kind] || 0) + 1;
    return result;
  }, {});

  console.log("Reachable macro actions:");
  Object.keys(grouped)
    .sort()
    .forEach((kind) => {
      console.log(`  ${kind}: ${grouped[kind]}`);
    });

  actions.slice(0, 12).forEach((action) => {
    const detail =
      action.stance && action.direction
        ? ` from ${action.stance.x},${action.stance.y} -> ${action.direction}`
        : "";
    console.log(`  - ${action.summary}${detail}`);
  });
}

function summarizeAction(action) {
  const details = [];
  if (action.stance) details.push(`from=${action.stance.x},${action.stance.y}`);
  if (action.target) details.push(`to=${action.target.x},${action.target.y}`);
  else if (action.x != null && action.y != null) details.push(`to=${action.x},${action.y}`);
  if (action.direction) details.push(`dir=${action.direction}`);
  if (action.tool) details.push(`tool=${action.tool}`);
  if (action.estimate) {
    details.push(`dmg=${Number(action.estimate.damage || 0)}`);
    if (action.estimate.hpDelta != null) details.push(`hpDelta=${Number(action.estimate.hpDelta || 0)}`);
    details.push(`exp=${Number(action.estimate.exp || 0)}`);
    details.push(`money=${Number(action.estimate.money || 0)}`);
    if (action.estimate.lv) details.push(`lvDelta=${Number(action.estimate.lv || 0)}`);
    if (action.estimate.score) details.push(`score=${Math.round(Number(action.estimate.score || 0))}`);
  }
  const plan = Array.isArray(action.plan) ? ` plan=[${action.plan.join(" -> ")}]` : "";
  return `${action.kind}: ${action.summary}${details.length ? ` (${details.join(" ")})` : ""}${plan}`;
}


function summarizeSearchClaim(profileName, targetFloor, args, result) {
  const diagnostics = result.diagnostics || {};
  const dp = diagnostics.dp || null;
  const algorithm = diagnostics.algorithm || null;
  return {
    claim: result.foundGoal ? "found-route-under-budget" : "no-route-found-under-budget",
    profile: profileName,
    targetFloor,
    algorithm,
    budget: {
      maxExpansions: Number(args["max-expansions"] || 80),
      topK: Number(args["top-k"] || 3),
      beamWidth: args["beam-width"] != null ? Number(args["beam-width"]) : null,
      perFloorBeamWidth: args["per-floor-beam-width"] != null ? Number(args["per-floor-beam-width"]) : null,
      perRegionBeamWidth: args["per-region-beam-width"] != null ? Number(args["per-region-beam-width"]) : null,
      maxActionsPerState: args["max-actions-per-state"] != null ? Number(args["max-actions-per-state"]) : null,
    },
    dp: dp ? {
      completeWithinActionSet: Boolean(dp.completeWithinActionSet),
      maxActionsPerState: dp.maxActionsPerState,
      actionTrimmed: dp.actionTrimmed,
      statesWithActionTrim: dp.statesWithActionTrim,
      keyMode: dp.keyMode,
      agendaMode: dp.agendaMode,
      stopOnFirstGoal: dp.stopOnFirstGoal,
    } : null,
    pruning: {
      dominanceMode: args["dominance-mode"] || (parseBooleanFlag(args["disable-dominance"], false) ? "off" : "default"),
      safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
      reserveProgressActions: true,
    },
    semantics: algorithm === "dp"
      ? "canonical DP over enumerated action set; complete only when completeWithinActionSet=true and expansion budget is not exhausted"
      : "heuristic beam-search result; not a proof of global optimality or completeness",
    expansions: result.expansions,
    frontierRemaining: result.frontierSize,
  };
}

function summarizeReplayConfidence(state, liveVerified) {
  if (!state) {
    return {
      liveVerified: false,
      status: "no-state",
      verifiedFloor: null,
      routeLength: 0,
      unsupportedNoteCount: 0,
      unsupportedNotesPreview: [],
    };
  }
  const notes = state.notes || [];
  const unsupportedNotes = notes.filter((note) => /unsupported|未支持|not supported/i.test(String(note)));
  return {
    liveVerified: Boolean(liveVerified),
    status: liveVerified ? "live-verified" : "not-live-verified",
    verifiedFloor: liveVerified ? state.floorId : null,
    solverFloor: state.floorId,
    routeLength: Array.isArray(state.route) ? state.route.length : 0,
    unsupportedNoteCount: unsupportedNotes.length,
    unsupportedNotesPreview: unsupportedNotes.slice(0, 5),
    hazardStats: state.meta && state.meta.hazardStats ? state.meta.hazardStats : null,
  };
}

function printActionsForState(label, simulator, state, limit) {
  if (!state) return;
  const actions = simulator.enumerateActions(state);
  const grouped = actions.reduce((result, action) => {
    const key = action.kind === "useTool" && action.tool ? `${action.kind}:${action.tool}` : action.kind;
    result[key] = Number(result[key] || 0) + 1;
    return result;
  }, {});
  console.log(`${label} actions (${actions.length}): ${JSON.stringify(grouped)}`);
  actions.slice(0, limit || 40).forEach((action, index) => {
    console.log(`  ${String(index + 1).padStart(2, "0")}. ${summarizeAction(action)}`);
  });
}

function getNextLevelInfo(project, state) {
  const entries = (((project || {}).data || {}).firstData || {}).levelUp || [];
  const level = Number((state.hero || {}).lv || 0);
  const next = entries[level] || null;
  if (!next) return null;
  const need = Number(evaluateExpression(next.need, project, state, { floorId: state.floorId }) || 0);
  const exp = Number((state.hero || {}).exp || 0);
  return {
    level,
    exp,
    need,
    deficit: Math.max(0, need - exp),
  };
}

function summarizeNextGateDeficit(project, simulator, state) {
  if (!state) return null;
  const currentFloorOrder = getFloorOrder(state.floorId);
  const actions = simulator.enumerateActions(state);
  const forwardChangeFloors = actions.filter((action) => {
    if (action.kind !== "changeFloor") return false;
    const targetFloorId = action.changeFloor && action.changeFloor.floorId;
    if (targetFloorId === ":next") return true;
    return getFloorOrder(targetFloorId) > currentFloorOrder;
  });
  const battleActions = actions.filter((action) => action.kind === "battle");
  const resourcePocketActions = actions.filter((action) => action.kind === "resourcePocket" || action.kind === "resourceCluster" || action.kind === "resourceChain");
  const fightToLevelUpActions = actions.filter((action) => action.kind === "fightToLevelUp");
  const totalAvailableExp = battleActions.reduce((sum, action) => sum + Number((action.estimate || {}).exp || 0), 0);
  const totalAvailableDamage = battleActions.reduce((sum, action) => sum + Number((action.estimate || {}).damage || 0), 0);
  const minDamageBattle = battleActions.reduce((best, action) => {
    if (!best) return action;
    return Number((action.estimate || {}).damage || 0) < Number((best.estimate || {}).damage || 0) ? action : best;
  }, null);
  const nextLevel = getNextLevelInfo(project, state);
  const reasons = [];
  if (forwardChangeFloors.length === 0) reasons.push("no-forward-changeFloor-action");
  if (nextLevel && nextLevel.deficit > 0 && totalAvailableExp < nextLevel.deficit) reasons.push("insufficient-visible-exp-for-levelup");
  if (battleActions.length === 0) reasons.push("no-visible-battle-actions");

  return {
    floorId: state.floorId,
    currentFloorOrder,
    forwardChangeFloorCount: forwardChangeFloors.length,
    forwardChangeFloors: forwardChangeFloors.map((action) => action.summary),
    visibleBattleCount: battleActions.length,
    resourcePocketCount: resourcePocketActions.length,
    fightToLevelUpCount: fightToLevelUpActions.length,
    resourcePockets: resourcePocketActions.slice(0, 5).map((action) => ({
      summary: action.summary,
      exp: Number((action.estimate || {}).exp || 0),
      hpDelta: Number((action.estimate || {}).hpDelta || 0),
      lv: Number((action.estimate || {}).lv || 0),
      stopReasons: (action.estimate || {}).stopReasons || [],
      plan: action.plan || [],
    })),
    fightToLevelUps: fightToLevelUpActions.slice(0, 5).map((action) => ({
      summary: action.summary,
      exp: Number((action.estimate || {}).exp || 0),
      damage: Number((action.estimate || {}).damage || 0),
      plan: action.plan || [],
    })),
    totalAvailableExp,
    totalAvailableDamage,
    minDamageBattle: minDamageBattle ? {
      summary: minDamageBattle.summary,
      damage: Number((minDamageBattle.estimate || {}).damage || 0),
      exp: Number((minDamageBattle.estimate || {}).exp || 0),
    } : null,
    nextLevel,
    reasons,
  };
}

function printStateSummary(label, simulator, state, options) {
  if (!state) return;
  const config = options || {};
  console.log(
    `${label}: floor=${state.floorId} hp=${state.hero.hp} atk=${state.hero.atk} def=${state.hero.def} mdef=${state.hero.mdef} ` +
      `score=${formatScore(simulator.score(state))} decisions=${getDecisionDepth(state)} routeLen=${state.route.length}`
  );
  if (state.meta && state.meta.hazardStats) {
    console.log(`Hazards: ${JSON.stringify(state.meta.hazardStats)}`);
  }
  if (config.printBestRoute) {
    state.route.forEach((step) => console.log(`  ${step}`));
  }
  const notes = Object.keys(countNotes(state.notes || []));
  if (notes.length > 0) {
    console.log("Notes:");
    notes.slice(0, 12).forEach((note) => console.log(`  ${note}`));
  }
}


function topObjectEntries(object, limit) {
  return Object.entries(object || {})
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, limit || 8)
    .map(([key, value]) => ({ key, value }));
}

function summarizeDroppedActions(diagnostics) {
  const byKind = Object.entries((diagnostics || {}).byActionType || {})
    .map(([kind, stats]) => ({
      kind,
      trimmed: Number(stats.trimmed || 0),
      dominated: Number(stats.dominated || 0),
      beamDropped: Number(stats.beamDropped || 0),
    }))
    .filter((entry) => entry.trimmed || entry.dominated || entry.beamDropped)
    .sort((left, right) => (right.trimmed + right.dominated + right.beamDropped) - (left.trimmed + left.dominated + left.beamDropped));
  return {
    byKind,
    byReason: (diagnostics.droppedProgressActions || {}).byReason || {},
    examples: ((diagnostics.droppedProgressActions || {}).samples || []).slice(0, 8),
  };
}

function summarizeProgressBlockers(project, simulator, state) {
  const nextGate = summarizeNextGateDeficit(project, simulator, state);
  const reasons = (nextGate && nextGate.reasons || []).slice();
  if (nextGate && nextGate.forwardChangeFloorCount === 0) reasons.push("next-stair-not-currently-generated");
  if (nextGate && nextGate.visibleBattleCount === 0) reasons.push("no-visible-battle-frontier");
  if (nextGate && nextGate.resourcePocketCount === 0) reasons.push("no-visible-resource-pocket");
  return {
    reasons: Array.from(new Set(reasons)),
    nextGate,
  };
}

function printDiagnosticsMainView(project, simulator, result) {
  const diagnostics = result.diagnostics || {};
  const bestProgressState = result.bestProgressState || result.bestSeenState;
  const view = {
    pruningOverview: diagnostics.pruningOverview || summarizePruning(diagnostics),
    confluence: summarizeConfluence(diagnostics),
    confluenceDominance: diagnostics.confluenceDominance || {},
    graph: diagnostics.graph || {},
    quota: diagnostics.quota || {},
    resourceCluster: diagnostics.resourceCluster || {},
    checkpointReuse: diagnostics.checkpointReuse || {},
    checkpointStore: diagnostics.checkpointStore || {},
    actionExpansionCache: diagnostics.actionExpansionCache || {},
    best: diagnostics.best || {},
    topFrontierBuckets: (((diagnostics.frontier || {}).topBuckets) || []).slice(0, 8),
    droppedActions: summarizeDroppedActions(diagnostics),
    progressBlockers: summarizeProgressBlockers(project, simulator, bestProgressState),
    landmarks: summarizeLandmarks(simulator, bestProgressState, { limit: 10 }),
  };
  console.log(`Diagnostics main view: ${JSON.stringify(view)}`);
}

function printProgressDebug(project, simulator, result, args) {
  const bestProgressState = result.bestProgressState || result.bestSeenState;
  if (parseBooleanFlag(args["print-best-progress-route"], false)) {
    printStateSummary("Best progress", simulator, bestProgressState, { printBestRoute: true });
  }
  if (parseBooleanFlag(args["print-best-progress-actions"], false)) {
    const nextLevel = bestProgressState ? getNextLevelInfo(project, bestProgressState) : null;
    if (nextLevel) {
      console.log(`Best progress next level: lv=${nextLevel.level} exp=${nextLevel.exp} need=${nextLevel.need} deficit=${nextLevel.deficit}`);
    }
    printActionsForState("Best progress", simulator, bestProgressState, Number(args["action-limit"] || 60));
  }
  if (parseBooleanFlag(args["print-stage-objective"], parseBooleanFlag(args.diagnostics, false))) {
    console.log(`Stage objective: ${JSON.stringify(summarizeStageObjective(simulator, bestProgressState, { targetFloorId: args["to-floor"] || simulator.stopFloorId }))}`);
  }
  if (parseBooleanFlag(args["print-next-gate-deficit"], false)) {
    console.log(`Next gate deficit: ${JSON.stringify(summarizeNextGateDeficit(project, simulator, bestProgressState))}`);
  }
  if (parseBooleanFlag(args.perf, false) && result.diagnostics && result.diagnostics.perf) {
    console.log(`Perf: ${JSON.stringify(result.diagnostics.perf)}`);
  }
}

function routeStartsWith(route, prefixRoute) {
  if (!Array.isArray(prefixRoute) || prefixRoute.length === 0) return true;
  if (!Array.isArray(route) || route.length < prefixRoute.length) return false;
  return prefixRoute.every((step, index) => route[index] === step);
}

function prependRoutePrefix(state, prefixRoute, prefixDecisionDepth) {
  if (!state || !Array.isArray(prefixRoute) || prefixRoute.length === 0) return state;
  const currentRoute = Array.isArray(state.route) ? state.route : [];
  const alreadyPrefixed = routeStartsWith(currentRoute, prefixRoute);
  const suffixDecisionDepth = getDecisionDepth(state);
  const addedDecisionDepth = Number.isFinite(Number(prefixDecisionDepth)) ? Number(prefixDecisionDepth) : prefixRoute.length;
  state.route = alreadyPrefixed ? currentRoute.slice() : prefixRoute.concat(currentRoute);
  if (state.meta) state.meta.decisionDepth = alreadyPrefixed ? suffixDecisionDepth : addedDecisionDepth + suffixDecisionDepth;
  return state;
}

function prependResultRoutePrefix(result, prefixRoute, prefixDecisionDepth) {
  if (!result || !Array.isArray(prefixRoute) || prefixRoute.length === 0) return result;
  const seen = new Set();
  [result.goalState, result.bestSeenState, result.bestProgressState, ...((result.results || []))].forEach((state) => {
    if (!state || seen.has(state)) return;
    seen.add(state);
    prependRoutePrefix(state, prefixRoute, prefixDecisionDepth);
  });
  return result;
}

function validateCheckpointReplay(project, simulator, initialState, checkpoint, options) {
  if (!checkpoint || !checkpoint.state) return { ok: false, reason: "missing-checkpoint-state" };
  const finalState = cloneState(checkpoint.state);
  finalState.route = Array.isArray(checkpoint.route)
    ? checkpoint.route.slice()
    : (Array.isArray(finalState.route) ? finalState.route.slice() : []);
  if (finalState.meta) finalState.meta.decisionDepth = finalState.route.length;
  try {
    const record = buildRouteRecord({
      project,
      simulator,
      initialState: cloneState(initialState),
      finalState,
      options: {
        projectRoot: options && options.projectRoot,
        toFloor: checkpoint.toFloorId || (options && options.targetFloorId),
        profile: options && options.profileName,
        rank: options && options.rank,
        solver: "checkpoint-store-validation",
        commit: null,
      },
    });
    const mismatch = (record.notes || []).find((note) => String(note).startsWith("route-store: reconstructed dominance key differs"));
    if (mismatch) return { ok: false, reason: mismatch };
    if (checkpoint.toFloorId && record.final && record.final.floorId !== checkpoint.toFloorId) {
      return { ok: false, reason: `checkpoint final floor mismatch: expected=${checkpoint.toFloorId} actual=${record.final.floorId}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : String(error) };
  }
}

function refreshResultBestDiagnostics(result) {
  if (!result) return result;
  result.diagnostics = result.diagnostics || {};
  const bestSeenState = result.bestSeenState;
  const bestProgressState = result.bestProgressState;
  result.diagnostics.best = {
    ...(result.diagnostics.best || {}),
    bestSeenFloor: bestSeenState && bestSeenState.floorId,
    bestSeenStage: bestSeenState ? getProgress(bestSeenState).stageIndex : null,
    bestSeenRouteLength: bestSeenState && Array.isArray(bestSeenState.route) ? bestSeenState.route.length : null,
    bestProgressFloor: bestProgressState && bestProgressState.floorId,
    bestProgressStage: bestProgressState ? getProgress(bestProgressState).stageIndex : null,
  };
  return result;
}

function compareSearchResults(simulator, left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftState = left.goalState || left.bestProgressState || left.bestSeenState;
  const rightState = right.goalState || right.bestProgressState || right.bestSeenState;
  if (Boolean(left.goalState) !== Boolean(right.goalState)) return right.goalState ? right : left;
  if (!leftState) return right;
  if (!rightState) return left;
  return simulator.compareSearchStates(rightState, leftState) > 0 ? right : left;
}

async function searchWithCheckpointSeeds(simulator, initialState, searchOptions, checkpointSeeds) {
  const seeds = Array.isArray(checkpointSeeds) ? checkpointSeeds : [];
  if (seeds.length === 0) return searchTopK(simulator, initialState, searchOptions);
  let bestResult = null;
  const attempts = [];
  for (const checkpoint of seeds) {
    if (!checkpoint.state) continue;
    const startState = cloneState(checkpoint.state);
    const prefixRoute = Array.isArray(checkpoint.route) ? checkpoint.route.slice() : [];
    startState.route = [];
    if (startState.meta) startState.meta.decisionDepth = 0;
    const result = await searchTopK(simulator, startState, {
      ...searchOptions,
      checkpointRepair: false,
      checkpointSeed: checkpoint.id,
    });
    prependResultRoutePrefix(result, prefixRoute, checkpoint.decisionDepth);
    prependCheckpointPoolRoutePrefix(result.checkpointPool, prefixRoute, checkpoint.decisionDepth);
    refreshResultBestDiagnostics(result);
    attempts.push({
      checkpointId: checkpoint.id,
      edge: checkpoint.edge,
      finalFloorId: (result.goalState || result.bestProgressState || result.bestSeenState || {}).floorId,
      foundGoal: Boolean(result.goalState),
      expansions: result.expansions,
    });
    bestResult = compareSearchResults(simulator, bestResult, result);
    if (result.goalState) break;
  }
  if (!bestResult || !bestResult.goalState) {
    const fallback = await searchTopK(simulator, initialState, {
      ...searchOptions,
      checkpointSeedFallback: true,
    });
    const selected = compareSearchResults(simulator, bestResult, fallback);
    selected.diagnostics = selected.diagnostics || {};
    selected.diagnostics.checkpointReuse = {
      attempted: true,
      used: selected === bestResult,
      attempts,
      fallback: selected === fallback,
    };
    return selected;
  }
  bestResult.diagnostics = bestResult.diagnostics || {};
  bestResult.diagnostics.checkpointReuse = {
    attempted: true,
    used: true,
    attempts,
    fallback: false,
  };
  return bestResult;
}

async function main(providedArgs, context) {
  let args = providedArgs || parseKeyValueArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(args, path.resolve(__dirname, ".."));
  const project = loadProject(projectRoot);
  const resolvedConfig = (context && context.resolvedConfig) || loadSolverConfig(projectRoot, project, args);
  args = applyConfigDefaults(args, resolvedConfig);
  const targetFloor = args["to-floor"] || (resolvedConfig.routeContext && resolvedConfig.routeContext.targetFloor) || "MT11";
  const profileName = args.profile || resolvedConfig.profileName || "default";
  const stagePolicyDefault = profileName.indexOf("stage-mt1-mt11") === 0 ||
    profileName === "linear-main" ||
    profileName === "resource-prep-main" ||
    profileName === "debug-local-resource";
  const resourceMacroDefault = profileName !== "canonical-bfs" && profileName !== "canonical-dp";
  const cacheOptions = buildActionExpansionCacheOptions(args);

  const simulator = new StaticSimulator(project, {
    stopFloorId: targetFloor,
    battleResolver: new FunctionBackedBattleResolver(project, cacheOptions),
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
    enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], stagePolicyDefault),
    enableResourcePocket: shouldEnableResourcePocket(args, resourceMacroDefault),
    enableResourceCluster: shouldEnableResourceCluster(args, resourceMacroDefault),
    enableResourceChain: shouldEnableResourceChain(args, false),
    searchGraphMode: args["search-graph"] || (profileName === "linear-main" ? "macro" : "hybrid"),
    primitiveFallbackMode: args["primitive-fallback"] || "auto",
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
    resourceChainOptions: buildResourceChainOptions(args),
    resourceClusterOptions: buildResourceClusterSearchOptions(args),
    enableActionExpansionCache: cacheOptions.enableActionExpansionCache,
    actionExpansionCacheLimit: cacheOptions.actionExpansionCacheLimit,
  });

  const initialState = simulator.createInitialState({
    rank: args.rank || "chaos",
  });

  console.log(`Loaded project: ${project.data.firstData.title}`);
  console.log(`Initial floor: ${initialState.floorId}`);
  console.log(`Initial hero: hp=${initialState.hero.hp}, atk=${initialState.hero.atk}, def=${initialState.hero.def}, mdef=${initialState.hero.mdef}`);
  console.log(`Auto features: pickup=${initialState.flags.shiqu !== 0 ? "on" : "off"}, battle=${initialState.flags.autoBattle !== 0 ? "on" : "off"}`);

  const initialActions = simulator.enumerateActions(initialState);
  printActionPreview(initialActions);

  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
    perStateLimit: parseOptionalNumber(args["per-state-limit"]),
    targetFloorId: targetFloor,
  });
  const maxActionsPerState = parseOptionalNumber(args["max-actions-per-state"]);
  console.log(`Search profile: ${profileName}`);

  const searchOptions = {
    ...profile,
    ...cacheOptions,
    ...buildConfluenceDominanceOptions(args, profile.enableConfluenceHpDominance, profile.confluenceRoutePolicy),
    topK: Number(args["top-k"] || 3),
    maxExpansions: Number(args["max-expansions"] || 80),
    beamWidth: args["beam-width"] != null ? Number(args["beam-width"]) : undefined,
    perFloorBeamWidth: args["per-floor-beam-width"] != null ? Number(args["per-floor-beam-width"]) : undefined,
    perRegionBeamWidth: args["per-region-beam-width"] != null ? Number(args["per-region-beam-width"]) : undefined,
    maxActionsPerState: maxActionsPerState != null ? maxActionsPerState : profile.maxActionsPerState,
    disableDominance: parseBooleanFlag(args["disable-dominance"], false),
    dominanceMode: args["dominance-mode"],
    safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
    perf: parseBooleanFlag(args.perf, false),
    parallel: parseBooleanFlag(args.parallel, false),
    workers: parseOptionalNumber(args.workers),
    topKBatchSize: parseOptionalNumber(args["topk-batch-size"]),
    workerChunkSize: parseOptionalNumber(args["worker-chunk-size"]),
    projectRoot,
    profileName,
    targetFloorId: targetFloor,
    autoPickupEnabled: parseBooleanFlag(args["auto-pickup"], true),
    autoBattleEnabled: parseBooleanFlag(args["auto-battle"], true),
    enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], stagePolicyDefault),
    enableResourcePocket: shouldEnableResourcePocket(args, resourceMacroDefault),
    enableResourceCluster: shouldEnableResourceCluster(args, resourceMacroDefault),
    enableResourceChain: shouldEnableResourceChain(args, false),
    searchGraphMode: args["search-graph"] || profile.searchGraphMode || (profileName === "linear-main" ? "macro" : "hybrid"),
    primitiveFallbackMode: args["primitive-fallback"] || "auto",
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
    resourceChainOptions: buildResourceChainOptions(args),
    resourceClusterOptions: buildResourceClusterSearchOptions(args),
    dpKeyMode: args["dp-key-mode"] || profile.dpKeyMode,
    dpAgendaMode: args["dp-agenda"] || profile.dpAgendaMode,
    stopOnFirstGoal: parseBooleanFlag(args["stop-on-first-goal"], true),
  };

  if (args["goal-floor"] || args["goal-expr"]) {
    const goalFloor = args["goal-floor"] || null;
    const goalExpr = args["goal-expr"] || null;
    searchOptions.goalPredicate = (state) => {
      if (goalFloor && state.floorId !== goalFloor) return false;
      if (!goalExpr) return true;
      return Boolean(evaluateExpression(goalExpr, project, state, { floorId: state.floorId }));
    };
  }

  const checkpointReuseMode = args["checkpoint-reuse"] || "off";
  const checkpointEnabled = resolvedConfig.checkpointConfig && resolvedConfig.checkpointConfig.enabled !== false;
  const checkpointStorePath = resolvedConfig.checkpointConfig && resolvedConfig.checkpointConfig.path;
  const routeFingerprint = buildRouteFingerprint(project, resolvedConfig.routeContext);
  const loadedCheckpointStore = checkpointEnabled
    ? loadCheckpointStore(checkpointStorePath, {
        project,
        projectId: resolvedConfig.projectId,
        profile: profileName,
        routeContext: resolvedConfig.routeContext,
        routeFingerprint,
      })
    : null;
  let checkpointStoreSanitization = null;
  if (loadedCheckpointStore && loadedCheckpointStore.usable && parseBooleanFlag(args["checkpoint-sanitize"], true)) {
    const sanitized = sanitizeCheckpointStore(loadedCheckpointStore.store, (checkpoint) => validateCheckpointReplay(project, simulator, initialState, checkpoint, {
      projectRoot,
      profileName,
      rank: args.rank || "chaos",
      targetFloorId: targetFloor,
    }), {
      sampleLimit: Number(args["checkpoint-sanitize-sample-limit"] || 8),
    });
    loadedCheckpointStore.store = sanitized.store;
    checkpointStoreSanitization = {
      kept: sanitized.kept,
      removed: sanitized.removed,
      samples: sanitized.samples,
    };
  }
  const checkpointSeeds = checkpointEnabled && checkpointReuseMode !== "off" && loadedCheckpointStore && loadedCheckpointStore.usable
    ? selectCheckpointSeeds(loadedCheckpointStore.store, resolvedConfig.routeContext, targetFloor, {
        maxSeeds: Number(args["checkpoint-seeds"] || 8),
      })
    : [];
  const useDpSearch = searchOptions.searchAlgorithm === "dp" || args["search-algorithm"] === "dp";
  const result = useDpSearch
    ? searchDP(simulator, initialState, searchOptions)
    : await searchWithCheckpointSeeds(simulator, initialState, searchOptions, checkpointSeeds);
  if (loadedCheckpointStore && loadedCheckpointStore.usable && result.checkpointPool) {
    const storedPool = checkpointPoolFromStore(loadedCheckpointStore.store);
    Object.entries(storedPool.edges || {}).forEach(([edge, list]) => {
      if (!result.checkpointPool.edges[edge]) result.checkpointPool.edges[edge] = [];
      result.checkpointPool.edges[edge].push(...list);
    });
  }
  const bestForBlocker = result.bestProgressState || result.bestSeenState;
  const blocker = analyzeProgressBlocker(simulator, bestForBlocker, { targetFloorId: targetFloor });
  let repair = null;
  if (!useDpSearch && !result.goalState && parseBooleanFlag(args["checkpoint-repair"], true)) {
    repair = await repairFromCheckpoints(simulator, {
      checkpointPool: result.checkpointPool,
      bestProgressState: result.bestProgressState,
      bestSeenState: result.bestSeenState,
      profile: searchOptions,
    }, blocker, {
      searchFn: searchTopK,
      analyzeProgressBlocker,
      targetFloorId: targetFloor,
      maxRepairAttempts: Number(args["repair-attempts"] || 6),
      repairExpansionsPerAttempt: Number(args["repair-expansions"] || 30),
      topK: Number(args["top-k"] || 1),
    });
    if (repair && repair.repaired && repair.repairedState) {
      result.bestProgressState = repair.repairedState;
      result.bestSeenState = repair.repairedState;
      if (repair.result && repair.result.goalState) {
        result.goalState = repair.repairedState;
        result.foundGoal = true;
        result.results = [repair.repairedState];
      }
    }
  }
  if (!result.diagnostics) result.diagnostics = {};
  result.diagnostics.blocker = blocker;
  result.diagnostics.checkpointRepair = summarizeRepair(repair);
  refreshResultBestDiagnostics(result);
  result.diagnostics.pruningOverview = summarizePruning(result.diagnostics);
  if (loadedCheckpointStore) {
    result.diagnostics.checkpointStore = {
      path: checkpointStorePath ? path.relative(projectRoot, checkpointStorePath) : null,
      usable: loadedCheckpointStore.usable,
      stale: loadedCheckpointStore.stale,
      loadError: loadedCheckpointStore.loadError,
      sanitization: checkpointStoreSanitization,
      seeds: checkpointSeeds.map((checkpoint) => ({
        id: checkpoint.id,
        edge: checkpoint.edge,
        routeLength: checkpoint.routeLength,
        hero: checkpoint.hero,
      })),
      summary: summarizeStore(loadedCheckpointStore.store),
    };
  }

  console.log(`Search claim: ${JSON.stringify(summarizeSearchClaim(profileName, targetFloor, args, result))}`);
  console.log(`Expansions: ${result.expansions}`);
  console.log(`Frontier remaining: ${result.frontierSize}`);
  if (parseBooleanFlag(args.diagnostics, false)) {
    console.log(`Registered states: ${result.diagnostics.registered}`);
    console.log(`Trimmed states: ${result.diagnostics.trimmed}`);
    console.log(`Skipped states: ${JSON.stringify(result.diagnostics.skipped)}`);
    if (parseBooleanFlag(args["print-action-stats"], false)) {
      console.log(`Action stats: ${JSON.stringify(result.diagnostics.byActionType)}`);
      console.log(`Action role stats: ${JSON.stringify(result.diagnostics.byActionRole)}`);
      console.log(`Floor stats: ${JSON.stringify(result.diagnostics.byFloor)}`);
      console.log(`Stage stats: ${JSON.stringify(result.diagnostics.byStage)}`);
      console.log(`Suspicious stats: ${JSON.stringify(result.diagnostics.suspicious)}`);
      console.log(`Safe dominance stats: ${JSON.stringify(result.diagnostics.safeDominance || {})}`);
      console.log(`Frontier stats: ${JSON.stringify(result.diagnostics.frontier || {})}`);
      console.log(`Dropped progress actions: ${JSON.stringify(result.diagnostics.droppedProgressActions || {})}`);
    }
    if (parseBooleanFlag(args["print-checkpoints"], parseBooleanFlag(args.diagnostics, false))) {
      console.log(`Floor checkpoints: ${JSON.stringify(result.diagnostics.checkpoints || {})}`);
    }
    if (parseBooleanFlag(args["print-blocker"], parseBooleanFlag(args.diagnostics, false))) {
      console.log(`Progress blocker: ${JSON.stringify(result.diagnostics.blocker || null)}`);
      console.log(`Checkpoint repair: ${JSON.stringify(result.diagnostics.checkpointRepair || null)}`);
    }
    printStateSummary("Best seen", simulator, result.bestSeenState, {
      printBestRoute: parseBooleanFlag(args["print-best-route"], false),
    });
    console.log(`Best seen replay confidence: ${JSON.stringify(summarizeReplayConfidence(result.bestSeenState, false))}`);
    console.log(`Best progress replay confidence: ${JSON.stringify(summarizeReplayConfidence(result.bestProgressState, false))}`);
    printDiagnosticsMainView(project, simulator, result);
    printProgressDebug(project, simulator, result, args);
  }

  if (checkpointEnabled && parseBooleanFlag(args["checkpoint-save"], true) && checkpointStorePath) {
    const baseStore = loadedCheckpointStore && loadedCheckpointStore.usable
      ? loadedCheckpointStore.store
      : {
          version: 1,
          projectId: resolvedConfig.projectId,
          profile: profileName,
          routeFingerprint,
          updatedAt: new Date().toISOString(),
          edges: {},
        };
    const nextStore = mergeCheckpointPoolIntoStore(baseStore, result.checkpointPool, {
      projectId: resolvedConfig.projectId,
      profile: profileName,
      routeFingerprint,
    });
    saveCheckpointStore(checkpointStorePath, nextStore);
    if (parseBooleanFlag(args.diagnostics, false)) {
      console.log(`Checkpoint store written: ${path.relative(projectRoot, checkpointStorePath)}`);
    }
  }

  const writeStateRoute = (argName, state, metadata) => {
    if (!args[argName] || !state) return;
    const outPath = path.resolve(projectRoot, args[argName]);
    const record = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState: state,
      options: {
        projectRoot,
        toFloor: targetFloor,
        profile: profileName,
        rank: args.rank || "chaos",
        solver: "topk",
        expanded: result.expansions,
        generated: (result.diagnostics || {}).generated,
        metadata,
      },
    });
    writeRouteFile(outPath, record);
    console.log(`Route written: ${path.relative(projectRoot, outPath)}`);
  };

  writeStateRoute("out-best-progress", result.bestProgressState || result.bestSeenState, {
    kind: "best-progress",
    foundGoal: Boolean(result.goalState),
    targetFloorId: targetFloor,
    finalFloorId: (result.bestProgressState || result.bestSeenState || {}).floorId,
    blocker: result.diagnostics.blocker,
    checkpointRepair: result.diagnostics.checkpointRepair,
    searchClaim: summarizeSearchClaim(profileName, targetFloor, args, result),
  });
  writeStateRoute("out-best-seen", result.bestSeenState, {
    kind: "best-seen",
    foundGoal: Boolean(result.goalState),
    targetFloorId: targetFloor,
    finalFloorId: (result.bestSeenState || {}).floorId,
    blocker: result.diagnostics.blocker,
    checkpointRepair: result.diagnostics.checkpointRepair,
    searchClaim: summarizeSearchClaim(profileName, targetFloor, args, result),
  });

  writeStateRoute("save-best-progress-route", result.bestProgressState || result.bestSeenState, {
    kind: "best-progress",
    foundGoal: Boolean(result.goalState),
    targetFloorId: targetFloor,
    finalFloorId: (result.bestProgressState || result.bestSeenState || {}).floorId,
    blocker: result.diagnostics.blocker,
    checkpointRepair: result.diagnostics.checkpointRepair,
    searchClaim: summarizeSearchClaim(profileName, targetFloor, args, result),
  });

  writeStateRoute("save-first-goal-route", result.firstGoalState, {
    kind: "first-goal",
    foundGoal: Boolean(result.firstGoalState),
    targetFloorId: targetFloor,
    finalFloorId: (result.firstGoalState || {}).floorId,
    goalRouteKind: "first-goal",
    stopOnFirstGoal: searchOptions.stopOnFirstGoal,
    dp: result.diagnostics && result.diagnostics.dp,
    searchClaim: summarizeSearchClaim(profileName, targetFloor, args, result),
  });

  writeStateRoute("save-best-goal-route", result.bestGoalState || result.goalState, {
    kind: "best-goal-under-budget",
    foundGoal: Boolean(result.bestGoalState || result.goalState),
    targetFloorId: targetFloor,
    finalFloorId: (result.bestGoalState || result.goalState || {}).floorId,
    goalRouteKind: "best-goal-under-budget",
    stopOnFirstGoal: searchOptions.stopOnFirstGoal,
    dp: result.diagnostics && result.diagnostics.dp,
    searchClaim: summarizeSearchClaim(profileName, targetFloor, args, result),
  });

  if (result.results.length === 0) {
    console.log(`No terminal ${targetFloor} state found under profile=${profileName}, budget=${Number(args["max-expansions"] || 80)}, pruning=${args["dominance-mode"] || (parseBooleanFlag(args["disable-dominance"], false) ? "off" : "default")}.`);
    console.log("Battle evaluation and ambush/between-attack walking are active; next gains will come from stronger pruning and more rule coverage.");
    return;
  }

  const goalRoutePath = args.out || args["save-route"];
  const selectedGoalState = result.bestGoalState || result.goalState;
  if (goalRoutePath && selectedGoalState) {
    const outPath = path.resolve(projectRoot, goalRoutePath);
    const record = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState: selectedGoalState,
      options: {
        projectRoot,
        toFloor: targetFloor,
        profile: profileName,
        rank: args.rank || "chaos",
        solver: "topk",
        expanded: result.expansions,
        generated: (result.diagnostics || {}).generated,
        metadata: {
          kind: "best-goal-under-budget",
          foundGoal: Boolean(selectedGoalState),
          targetFloorId: targetFloor,
          finalFloorId: selectedGoalState.floorId,
          goalRouteKind: "best-goal-under-budget",
          stopOnFirstGoal: searchOptions.stopOnFirstGoal,
          dp: result.diagnostics && result.diagnostics.dp,
          searchClaim: summarizeSearchClaim(profileName, targetFloor, args, result),
        },
      },
    });
    writeRouteFile(outPath, record);
    console.log(`Route written: ${path.relative(projectRoot, outPath)}`);
  }

  if (useDpSearch && result.diagnostics && result.diagnostics.dp) {
    const dp = result.diagnostics.dp;
    console.log(`DP goal summary: ${JSON.stringify({
      stopOnFirstGoal: dp.stopOnFirstGoal,
      firstGoal: dp.firstGoal,
      bestGoal: dp.bestGoal,
      completeWithinActionSet: dp.completeWithinActionSet,
      maxActionsPerState: dp.maxActionsPerState,
      actionTrimmed: dp.actionTrimmed,
      statesWithActionTrim: dp.statesWithActionTrim,
      routeSelection: "save-route/out writes best-goal-under-budget; use --save-first-goal-route for first-goal",
    })}`);
  }

  result.results.forEach((state, index) => {
    console.log(
      `#${index + 1} found under profile=${profileName} budget=${Number(args["max-expansions"] || 80)} pruning=${args["dominance-mode"] || (parseBooleanFlag(args["disable-dominance"], false) ? "off" : "default")} score=${formatScore(simulator.score(state))} decisions=${getDecisionDepth(state)} routeLen=${state.route.length}`
    );
    console.log(`  replayConfidence=${JSON.stringify(summarizeReplayConfidence(state, false))}`);
    state.route.forEach((step) => console.log(`  ${step}`));
  });
}

if (require.main === module) {
  main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
}

module.exports = {
  main,
};
