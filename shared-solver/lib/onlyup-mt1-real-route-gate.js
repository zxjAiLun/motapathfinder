"use strict";

/**
 * PR-5.20d Real OnlyUp MT1 route Go/No-Go gate.
 *
 * The decisive question for the 5.20 line: starting from the REAL initial state of
 * the real tower, can the existing canonical DP drive the existing trusted H5
 * runtime from MT1 to MT2 on its own, inside a fixed resource budget?
 *
 * This module invents nothing. It re-uses, without reimplementation:
 *
 *   project-loader.loadProject        the real project data
 *   StaticSimulator                   the real movement/pickup/event machinery
 *   FunctionBackedBattleResolver      the real battle semantics from functions.js
 *   simulator.createInitialState()    real firstArrive + auto stabilization
 *   simulator.enumerateActions/applyAction
 *   searchDP + buildStateKey/buildDominanceKey
 *
 * There is deliberately no new search here: special monsters, itemEffect, exp/level
 * ups, afterBattle and auto events are all executed by the existing runtime. The
 * search only decides the ORDER of primitive actions the runtime already offers.
 *
 * A failure is a real answer, not an invitation to another attribution round.
 */

const path = require("node:path");

const { loadProject } = require("./project-loader");
const { StaticSimulator } = require("./simulator");
const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { searchDP } = require("./dp-search");
const { resolveRecordedAction } = require("./route-store");
const { buildDominanceKey, buildStateKey } = require("./state-key");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "..", "Only upV2.1", "Only upV2.1");
const TARGET_FLOOR_ID = "MT2";
const MAX_EXPANDED_STATES = 50000;
const WALL_LIMIT_MS = 30000;
const RSS_LIMIT_BYTES = 256 * 1024 * 1024;

/**
 * Difficulty is part of the problem, not a move. These are the levers the tower
 * uses to switch difficulty; any action that would touch them is refused so the
 * search cannot "win" by turning the game down.
 */
const DIFFICULTY_GUARD_TOKENS = ["I581", "I582", "level0"];

function serializeForGuard(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return "";
  }
}

/**
 * True when applying `action` would read or write a difficulty lever. Checked on
 * the action description itself, so it stays honest even for actions this module
 * has never seen before.
 */
function touchesDifficulty(action) {
  const text = serializeForGuard(action);
  if (!text) return false;
  return DIFFICULTY_GUARD_TOKENS.some((token) => text.includes(token));
}

/**
 * Stateless choice resolver: it accepts exactly one thing -- a choice whose options
 * contain a single branch that changes nothing (an empty action list). That closes
 * the tower's informational dialogs without deciding anything.
 *
 * It never matches on coordinates or on option text, and if a required choice has
 * no unique no-op branch it refuses instead of guessing, which surfaces as
 * UNRESOLVED_REQUIRED_CHOICE rather than a silently invented decision.
 */
function createNoStateChangeChoiceResolver() {
  const unresolved = [];
  const resolver = (action) => {
    const choices = (action && Array.isArray(action.choices)) ? action.choices : [];
    const empty = choices.filter((choice) => {
      if (choice == null) return false;
      const list = choice.action;
      if (list == null) return true;
      return Array.isArray(list) && list.length === 0;
    });
    if (empty.length === 1) return empty[0];
    // Ambiguous or consequential: record and decline.
    unresolved.push({
      choiceCount: choices.length,
      noOpBranchCount: empty.length,
    });
    return null;
  };
  resolver.unresolved = unresolved;
  return resolver;
}

function heroSnapshot(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    exp: Number(hero.exp || 0),
    lv: Number(hero.lv || 0),
  };
}

function inventorySnapshot(state) {
  const items = (state && state.hero && state.hero.items) || {};
  const out = {};
  for (const key of Object.keys(items).sort()) {
    const bucket = items[key];
    if (bucket != null && typeof bucket === "object") {
      const inner = {};
      for (const name of Object.keys(bucket).sort()) {
        const amount = Number(bucket[name] || 0);
        if (amount !== 0) inner[name] = amount;
      }
      if (Object.keys(inner).length > 0) out[key] = inner;
    } else if (Number(bucket || 0) !== 0) {
      out[key] = Number(bucket);
    }
  }
  return out;
}

function flagSnapshot(state) {
  const flags = (state && state.flags) || {};
  const out = {};
  for (const key of Object.keys(flags).sort()) {
    const value = flags[key];
    if (value === 0 || value === false || value == null) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Floor mutations are the part of the state a hero snapshot cannot see: opened
 * doors, taken items, killed enemies. The exact state key already encodes them, so
 * comparing keys compares the mutations too, but the counts make a mismatch
 * readable instead of just "keys differ".
 */
function floorMutationSnapshot(state) {
  const mutations = (state && state.floorMutations) || (state && state.mapChanges) || {};
  const out = {};
  for (const floorId of Object.keys(mutations).sort()) {
    const entry = mutations[floorId];
    if (entry == null) continue;
    if (Array.isArray(entry)) out[floorId] = entry.length;
    else if (typeof entry === "object") out[floorId] = Object.keys(entry).length;
  }
  return out;
}

function fullSnapshot(state) {
  return {
    floorId: state == null ? null : state.floorId,
    hero: heroSnapshot(state),
    inventory: inventorySnapshot(state),
    flags: flagSnapshot(state),
    floorMutations: floorMutationSnapshot(state),
    exactStateKey: state == null ? null : buildStateKey(state),
    dominanceKey: state == null ? null : buildDominanceKey(state),
  };
}

function buildSimulator(project, choiceResolver) {
  return new StaticSimulator(project, {
    stopFloorId: TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project),
    // Primitive graph only: no macro layer decides anything on the search's behalf.
    searchGraphMode: "primitive",
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    choiceResolver,
  });
}

/**
 * A recorded route interleaves two different things:
 *
 *   - decision entries (objects): the moves the search actually chose, recorded in
 *     normalized form with a fingerprint;
 *   - `auto:` entries (strings): bookkeeping for pickups/battles the RUNTIME
 *     performed by itself under autoPickupEnabled/autoBattleEnabled.
 *
 * Only the first kind is replayable, because only the first kind is ever offered by
 * enumerateActions. The auto entries are re-performed by the runtime during replay
 * as a consequence of the same configuration -- and the thing that proves they were
 * re-performed identically is the final exact state key comparison, not a
 * string-by-string march through them.
 */
function isDecisionEntry(entry) {
  return entry != null && typeof entry === "object";
}

function runOnlyUpMt1RealRouteGate(options) {
  const config = options || {};
  const projectRoot = config.projectRoot || DEFAULT_PROJECT_ROOT;
  const maxExpandedStates = Number(config.maxExpandedStates || MAX_EXPANDED_STATES);
  const wallLimitMs = Number(config.wallLimitMs || WALL_LIMIT_MS);
  const startedAt = process.hrtime.bigint();
  let peakRssBytes = process.memoryUsage().rss;
  const sampleRss = () => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRssBytes) peakRssBytes = rss;
    return rss;
  };
  const elapsedMs = () => Number((process.hrtime.bigint() - startedAt) / 1000000n);

  const project = loadProject(projectRoot);
  const firstData = (project.data || {}).firstData || {};
  const source = {
    title: firstData.title ||
      (project.data || {}).title ||
      ((project.data || {}).main || {}).title ||
      null,
    startFloorId: firstData.floorId || null,
    startLoc: firstData.hero && firstData.hero.loc
      ? { x: firstData.hero.loc.x, y: firstData.hero.loc.y }
      : null,
    targetFloorId: TARGET_FLOOR_ID,
  };
  sampleRss();

  const searchChoiceResolver = createNoStateChangeChoiceResolver();
  const simulator = buildSimulator(project, searchChoiceResolver);
  // The real initial state: createInitialState runs firstArrive and the auto
  // stabilization the tower itself would run on entry.
  const initialState = simulator.createInitialState();
  const initialSnapshot = fullSnapshot(initialState);
  sampleRss();

  const baseReport = () => ({
    source,
    initial: initialSnapshot,
    budget: { maxExpandedStates, wallLimitMs, rssLimitBytes: RSS_LIMIT_BYTES },
  });

  if (source.startFloorId !== initialState.floorId) {
    return {
      verdict: "REAL_MT1_GATE_FAILED",
      failureReason: "initial-floor-mismatch",
      ...baseReport(),
      metrics: { wallMs: elapsedMs(), peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10 },
    };
  }

  let difficultyGuardBlocked = 0;
  const goalPredicate = (state) => state != null && state.floorId === TARGET_FLOOR_ID;

  const search = searchDP(simulator, initialState, {
    maxExpansions: maxExpandedStates,
    maxRuntimeMs: wallLimitMs,
    stopOnFirstGoal: true,
    goalPredicate,
    targetFloorId: TARGET_FLOOR_ID,
    // Difficulty levers are filtered out of every expansion, and counted so the
    // report can say plainly whether any were offered.
    actionFilter: (action) => {
      if (touchesDifficulty(action)) {
        difficultyGuardBlocked += 1;
        return false;
      }
      return true;
    },
    shouldStop: () => {
      sampleRss();
      return peakRssBytes >= RSS_LIMIT_BYTES || elapsedMs() >= wallLimitMs;
    },
  });
  sampleRss();

  const metrics = {
    wallMs: elapsedMs(),
    peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10,
    expansions: search.expansions,
    frontierSize: search.frontierSize,
    stoppedReason: search.stoppedReason,
    difficultyGuardBlocked,
    searchChoiceUnresolved: searchChoiceResolver.unresolved.length,
  };
  const overBudget = search.expansions > maxExpandedStates ||
    metrics.wallMs >= wallLimitMs ||
    peakRssBytes >= RSS_LIMIT_BYTES;

  const failed = (failureReason, extra) => ({
    verdict: "REAL_MT1_GATE_FAILED",
    failureReason,
    ...baseReport(),
    metrics,
    ...(extra || {}),
  });

  if (searchChoiceResolver.unresolved.length > 0) {
    return failed("UNRESOLVED_REQUIRED_CHOICE", {
      unresolvedChoices: searchChoiceResolver.unresolved.slice(0, 8),
    });
  }
  if (overBudget) return failed("RESOURCE_LIMIT");
  if (!search.foundGoal || search.goalState == null) {
    return failed("NO_ROUTE_FOUND", {
      bestSeen: search.bestSeenState == null ? null : fullSnapshot(search.bestSeenState),
    });
  }
  const searchFinal = fullSnapshot(search.goalState);
  if (searchFinal.floorId !== TARGET_FLOOR_ID) {
    return failed("goal-floor-mismatch", { searchFinal });
  }
  const route = Array.isArray(search.route) ? search.route : null;
  if (route == null || route.length === 0) {
    return failed("empty-route", { searchFinal });
  }

  // --- strict replay on a FRESH simulator with the same stateless resolver -----
  const replayChoiceResolver = createNoStateChangeChoiceResolver();
  const replaySimulator = buildSimulator(project, replayChoiceResolver);
  let replayState = replaySimulator.createInitialState();
  if (buildStateKey(replayState) !== initialSnapshot.exactStateKey) {
    return failed("replay-initial-state-divergence", { searchFinal });
  }
  let decisionsReplayed = 0;
  let autoEntriesSkipped = 0;
  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    if (!isDecisionEntry(entry)) {
      autoEntriesSkipped += 1;
      continue;
    }
    // Re-derive the move from the LIVE enumeration via the shared recorded-action
    // resolver: it enumerates the candidates available in this very state and
    // matches the recorded decision against them by fingerprint. The action that
    // gets applied is the freshly enumerated object, never the recorded summary.
    const resolved = resolveRecordedAction(replaySimulator, replayState, entry);
    if (resolved == null || resolved.action == null) {
      return failed("replay-action-not-enumerated", {
        searchFinal,
        replayFailureIndex: index,
        replayFailureReason: resolved == null ? "resolver-null" : String(resolved.reason || "unresolved"),
        replayFailureAction: String(entry.summary || entry.fingerprint || "").slice(0, 200),
      });
    }
    if (touchesDifficulty(resolved.action)) {
      return failed("replay-difficulty-action", { searchFinal, replayFailureIndex: index });
    }
    replayState = replaySimulator.applyAction(replayState, resolved.action, { storeRoute: false });
    if (replayState == null) {
      return failed("replay-action-rejected", { searchFinal, replayFailureIndex: index });
    }
    decisionsReplayed += 1;
    sampleRss();
  }
  metrics.decisionsReplayed = decisionsReplayed;
  metrics.autoEntriesSkipped = autoEntriesSkipped;
  if (decisionsReplayed === 0) {
    return failed("replay-had-no-decisions", { searchFinal });
  }
  const replayFinal = fullSnapshot(replayState);
  if (replayChoiceResolver.unresolved.length > 0) {
    return failed("UNRESOLVED_REQUIRED_CHOICE", { searchFinal, replayFinal });
  }

  const mismatches = [];
  if (replayFinal.floorId !== searchFinal.floorId) mismatches.push("floorId");
  for (const key of ["hp", "atk", "def", "mdef", "exp", "lv"]) {
    if (replayFinal.hero[key] !== searchFinal.hero[key]) mismatches.push(`hero.${key}`);
  }
  if (serializeForGuard(replayFinal.inventory) !== serializeForGuard(searchFinal.inventory)) {
    mismatches.push("inventory");
  }
  if (serializeForGuard(replayFinal.flags) !== serializeForGuard(searchFinal.flags)) {
    mismatches.push("flags");
  }
  if (serializeForGuard(replayFinal.floorMutations) !== serializeForGuard(searchFinal.floorMutations)) {
    mismatches.push("floorMutations");
  }
  if (replayFinal.exactStateKey !== searchFinal.exactStateKey) mismatches.push("exactStateKey");

  metrics.wallMs = elapsedMs();
  metrics.peakRssMb = Math.round((sampleRss() / 1048576) * 10) / 10;
  if (metrics.wallMs >= wallLimitMs || peakRssBytes >= RSS_LIMIT_BYTES) {
    return failed("RESOURCE_LIMIT", { searchFinal, replayFinal });
  }
  if (mismatches.length > 0) {
    return failed("STRICT_REPLAY_DIVERGENCE", { searchFinal, replayFinal, mismatches });
  }

  return {
    verdict: "REAL_MT1_GATE_PASSED",
    failureReason: null,
    ...baseReport(),
    metrics,
    routeLength: route.length,
    decisionCount: route.filter(isDecisionEntry).length,
    searchFinal,
    replayFinal,
    mismatches: [],
  };
}

module.exports = {
  DIFFICULTY_GUARD_TOKENS,
  isDecisionEntry,
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  TARGET_FLOOR_ID,
  WALL_LIMIT_MS,
  createNoStateChangeChoiceResolver,
  runOnlyUpMt1RealRouteGate,
  touchesDifficulty,
};
