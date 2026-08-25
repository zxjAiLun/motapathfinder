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
const {
  getDecisionDepth,
  getRawRouteLength,
  listFloorMutationSummary,
} = require("./state");
const { buildDominanceKey, buildStateKey } = require("./state-key");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "..", "Only upV2.1", "Only upV2.1");
const TARGET_FLOOR_ID = "MT2";
const FIRST_REGION_TARGET_FLOOR_ID = "MT6";
const EVIDENCE_SCHEMA = "motapathfinder.onlyup-real-route-gate-evidence.v2";

/**
 * Match grades the replay accepts as decision IDENTITY. `summary` and `kind` are
 * deliberately excluded: matching on a summary string is exactly the weak check
 * this gate exists to rule out.
 *
 * Note on `fingerprint`: the recorded route and route-store's `normalizeAction`
 * currently build fingerprints in DIFFERENT formats for the same action
 * (`battle|MT1|8|7|blackSlime` vs `battle|MT1|8,7|blackSlime`;
 * `changeFloor|changeFloor@MT1:6,0` vs `changeFloor|MT1|6,0|:next|,`), so
 * `resolveRecordedAction().fingerprintMatches` is structurally unreachable for real
 * routes. Reconciling the two producers would mean editing route-store/simulator,
 * which this round may not touch, so `fingerprintMatchedDecisionCount` is reported
 * as the real number rather than asserted, and identity is enforced through the
 * grades below plus the end-to-end sequence/accounting/exact-key equalities.
 */
const IDENTITY_GRADE_MATCH_TYPES = [
  "postExactState",
  "postDominanceKey",
  "fingerprint",
  "path",
  "target-stance-direction",
];
const MAX_EXPANDED_STATES = 50000;
const WALL_LIMIT_MS = 30000;
const RSS_LIMIT_BYTES = 256 * 1024 * 1024;

/**
 * Difficulty is part of the problem, not a move. These are the levers the tower
 * uses to switch difficulty; any action that would touch them is refused so the
 * search cannot "win" by turning the game down.
 */
const DIFFICULTY_GUARD_TOKENS = ["I581", "I582", "level0"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

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

/**
 * Canonical inventory. `state.inventory` is the flattened item map the runtime
 * actually maintains; reading `state.hero.items` instead (as evidence schema v1
 * did) reports the SEED inventory shape and silently misses every pickup, which
 * made the inventory comparison vacuous.
 */
function inventorySnapshot(state) {
  const inventory = (state && state.inventory) || {};
  const out = {};
  for (const itemId of Object.keys(inventory).sort()) {
    const amount = Number(inventory[itemId] || 0);
    if (amount !== 0) out[itemId] = amount;
  }
  return out;
}

/**
 * Difficulty evidence. Only Up encodes difficulty as inventory markers I581 (easy)
 * and I582 (hard) plus the `level0` flag; Chaos is the absence of all three. The
 * gate freezes this triple at search start, search end and replay end, so a route
 * cannot quietly have been produced under a different difficulty than it is
 * reported under.
 */
function difficultySnapshot(state) {
  const inventory = (state && state.inventory) || {};
  const flags = (state && state.flags) || {};
  const normalize = (value) => {
    if (value == null || value === false) return 0;
    if (value === true) return 1;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };
  return {
    I581: normalize(inventory.I581),
    I582: normalize(inventory.I582),
    "flag:level0": normalize(flags.level0),
  };
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
 * doors, taken items, killed enemies. The canonical home is `state.floorStates`,
 * summarised by state.js's own `listFloorMutationSummary`, so this reports exactly
 * what the runtime tracks. Evidence schema v1 looked for `state.floorMutations` /
 * `state.mapChanges`, which do not exist -- the snapshot was always `{}` and the
 * comparison always trivially passed.
 */
function floorMutationSnapshot(state) {
  const floorStates = (state && state.floorStates) || {};
  return listFloorMutationSummary(floorStates);
}

function routeAccounting(state) {
  const meta = (state && state.meta) || {};
  return {
    decisionDepth: getDecisionDepth(state),
    rawRouteLength: getRawRouteLength(state),
    autoStepCount: Number(meta.autoStepCount || 0),
    autoPickupCount: Number(meta.autoPickupCount || 0),
    autoBattleCount: Number(meta.autoBattleCount || 0),
  };
}

function fullSnapshot(state) {
  return {
    floorId: state == null ? null : state.floorId,
    hero: heroSnapshot(state),
    inventory: inventorySnapshot(state),
    flags: flagSnapshot(state),
    floorMutations: floorMutationSnapshot(state),
    difficulty: difficultySnapshot(state),
    accounting: routeAccounting(state),
    exactStateKey: state == null ? null : buildStateKey(state),
    dominanceKey: state == null ? null : buildDominanceKey(state),
  };
}

function decisionSummary(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  return entry.summary || entry.fingerprint || null;
}

function isAutoEntry(entry) {
  return typeof entry === "string" && entry.startsWith("auto:");
}

function buildSimulator(project, choiceResolver, targetFloorId, options) {
  const config = options || {};
  return new StaticSimulator(project, {
    stopFloorId: targetFloorId,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    // Primitive graph only: no macro layer decides anything on the search's behalf.
    searchGraphMode: "primitive",
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    autoBattleFastRejectEnabled: config.autoBattleFastRejectEnabled === true,
    enableCompiledEffectCache: config.enableCompiledEffectCache === true,
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

/**
 * Generic real-tower gate. `targetFloorId` drives the simulator stop floor, the goal
 * predicate and searchDP's target ordering together, so there is exactly one place
 * the destination is stated.
 */
function runOnlyUpRealRouteGate(options) {
  const config = options || {};
  const targetFloorId = config.targetFloorId || TARGET_FLOOR_ID;
  const gateName = config.gateName || "REAL_MT1_GATE";
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
    targetFloorId,
  };
  sampleRss();

  const searchChoiceResolver = createNoStateChangeChoiceResolver();
  const simulator = buildSimulator(project, searchChoiceResolver, targetFloorId, config);
  // The real initial state: createInitialState runs firstArrive and the auto
  // stabilization the tower itself would run on entry.
  const initialState = simulator.createInitialState();
  const initialSnapshot = fullSnapshot(initialState);
  sampleRss();

  const baseReport = () => ({
    evidenceSchema: EVIDENCE_SCHEMA,
    targetFloorId,
    source,
    initial: initialSnapshot,
    budget: { maxExpandedStates, wallLimitMs, rssLimitBytes: RSS_LIMIT_BYTES },
  });

  if (source.startFloorId !== initialState.floorId) {
    return {
      verdict: `${gateName}_FAILED`,
      failureReason: "initial-floor-mismatch",
      ...baseReport(),
      metrics: { wallMs: elapsedMs(), peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10 },
    };
  }

  let difficultyGuardBlocked = 0;
  const goalPredicate = (state) => state != null && state.floorId === targetFloorId;

  const search = searchDP(simulator, initialState, {
    maxExpansions: maxExpandedStates,
    maxRuntimeMs: wallLimitMs,
    stopOnFirstGoal: true,
    goalPredicate,
    targetFloorId,
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
    verdict: `${gateName}_FAILED`,
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
  if (overBudget) {
    return failed("RESOURCE_LIMIT", {
      bindingConstraint: peakRssBytes >= RSS_LIMIT_BYTES
        ? "rss"
        : (metrics.wallMs >= wallLimitMs ? "wall" : "expansions"),
      bestSeen: search.bestSeenState == null ? null : fullSnapshot(search.bestSeenState),
      bestProgress: search.bestProgressState == null ? null : fullSnapshot(search.bestProgressState),
    });
  }
  if (!search.foundGoal || search.goalState == null) {
    return failed("NO_ROUTE_FOUND", {
      bestSeen: search.bestSeenState == null ? null : fullSnapshot(search.bestSeenState),
    });
  }
  const searchFinal = fullSnapshot(search.goalState);
  if (searchFinal.floorId !== targetFloorId) {
    return failed("goal-floor-mismatch", { searchFinal });
  }
  // Difficulty must be identical at start and end of the search: a route that
  // changed difficulty on the way is not a route through this problem.
  if (serializeForGuard(searchFinal.difficulty) !== serializeForGuard(initialSnapshot.difficulty)) {
    return failed("DIFFICULTY_DRIFT", { searchFinal });
  }
  const route = Array.isArray(search.route) ? search.route : null;
  if (route == null || route.length === 0) {
    return failed("empty-route", { searchFinal });
  }

  // --- strict replay on a FRESH simulator with the same stateless resolver -----
  const replayChoiceResolver = createNoStateChangeChoiceResolver();
  const replaySimulator = buildSimulator(project, replayChoiceResolver, targetFloorId, config);
  let replayState = replaySimulator.createInitialState();
  if (buildStateKey(replayState) !== initialSnapshot.exactStateKey) {
    return failed("replay-initial-state-divergence", { searchFinal });
  }
  // Two distinct accounting views, kept apart on purpose:
  //
  //   recorded artifact  = what the search stored on the goal state. Under the
  //                        canonical route-free search this is a COMPACT record:
  //                        an initial auto prefix plus one entry per decision.
  //   runtime transcript = what the runtime actually performs when the route is
  //                        replayed with storeRoute:true, i.e. every decision AND
  //                        every auto pickup/battle it triggers along the way.
  //
  // Evidence schema v1 reported the recorded artifact length as if it were the
  // executed step count. They are different numbers and both are now reported.
  const recordedDecisions = route.filter(isDecisionEntry);
  let initialAutoPrefixCount = 0;
  while (initialAutoPrefixCount < route.length && !isDecisionEntry(route[initialAutoPrefixCount])) {
    initialAutoPrefixCount += 1;
  }
  metrics.recordedArtifactEntryCount = route.length;
  metrics.recordedDecisionCount = recordedDecisions.length;
  metrics.initialAutoPrefixCount = initialAutoPrefixCount;

  let decisionsReplayed = 0;
  let fingerprintMatchedDecisionCount = 0;
  const decisionMatchTypeCounts = {};
  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    if (!isDecisionEntry(entry)) continue;
    if (!isNonEmptyString(entry.fingerprint)) {
      return failed("recorded-decision-missing-fingerprint", {
        searchFinal,
        replayFailureIndex: index,
      });
    }
    // Re-derive the move from the LIVE enumeration via the shared recorded-action
    // resolver: it enumerates the candidates available in this very state and
    // matches the recorded decision against them by fingerprint. The action that
    // gets applied is the freshly enumerated object, never the recorded summary.
    const resolved = resolveRecordedAction(replaySimulator, replayState, entry, {
      requireFingerprintMatch: true,
    });
    if (resolved == null || resolved.action == null) {
      return failed("replay-action-not-enumerated", {
        searchFinal,
        replayFailureIndex: index,
        replayFailureReason: resolved == null ? "resolver-null" : String(resolved.reason || "unresolved"),
        replayFailureAction: String(entry.summary || entry.fingerprint || "").slice(0, 200),
      });
    }
    // Identity grade, not a summary string.
    if (!IDENTITY_GRADE_MATCH_TYPES.includes(resolved.matchType)) {
      return failed("replay-weak-action-identity", {
        searchFinal,
        replayFailureIndex: index,
        replayFailureMatchType: String(resolved.matchType || "none"),
      });
    }
    decisionMatchTypeCounts[resolved.matchType] =
      (decisionMatchTypeCounts[resolved.matchType] || 0) + 1;
    if (resolved.fingerprintMatches === true) fingerprintMatchedDecisionCount += 1;
    if (touchesDifficulty(resolved.action)) {
      return failed("replay-difficulty-action", { searchFinal, replayFailureIndex: index });
    }
    // storeRoute:true so the replay produces the full runtime transcript exactly
    // once, for the final candidate only.
    replayState = replaySimulator.applyAction(replayState, resolved.action, { storeRoute: true });
    if (replayState == null) {
      return failed("replay-action-rejected", { searchFinal, replayFailureIndex: index });
    }
    decisionsReplayed += 1;
    sampleRss();
  }
  metrics.decisionsReplayed = decisionsReplayed;
  metrics.fingerprintMatchedDecisionCount = fingerprintMatchedDecisionCount;
  metrics.identityGradedDecisionCount = Object.values(decisionMatchTypeCounts)
    .reduce((total, count) => total + count, 0);
  metrics.decisionMatchTypeCounts = decisionMatchTypeCounts;
  // Reported, not asserted: see IDENTITY_GRADE_MATCH_TYPES for why the two
  // fingerprint producers cannot agree without touching route-store/simulator.
  metrics.fingerprintFormatReconciled = fingerprintMatchedDecisionCount === decisionsReplayed;
  if (decisionsReplayed === 0) {
    return failed("replay-had-no-decisions", { searchFinal });
  }
  if (metrics.identityGradedDecisionCount !== decisionsReplayed) {
    return failed("identity-grade-count-mismatch", { searchFinal });
  }

  const replayRoute = Array.isArray(replayState.route) ? replayState.route : [];
  metrics.runtimeReplayEntryCount = replayRoute.length;
  metrics.runtimeReplayAutoCount = replayRoute.filter(isAutoEntry).length;
  const searchAccounting = searchFinal.accounting;
  metrics.searchRawRouteLength = searchAccounting.rawRouteLength;
  metrics.searchAutoStepCount = searchAccounting.autoStepCount;
  const replayFinal = fullSnapshot(replayState);
  if (replayChoiceResolver.unresolved.length > 0) {
    return failed("UNRESOLVED_REQUIRED_CHOICE", { searchFinal, replayFinal });
  }

  metrics.replayRawRouteLength = replayFinal.accounting.rawRouteLength;
  metrics.replayAutoStepCount = replayFinal.accounting.autoStepCount;

  // The runtime transcript must be the same length under both the search's own
  // accounting and the replay's, and must equal the materialized array we just
  // built. This is what ties the compact recorded artifact to real execution.
  if (metrics.searchRawRouteLength !== metrics.replayRawRouteLength ||
      metrics.replayRawRouteLength !== replayRoute.length) {
    return failed("RAW_ROUTE_LENGTH_MISMATCH", {
      searchFinal,
      replayFinal,
      rawRouteLengths: {
        search: metrics.searchRawRouteLength,
        replay: metrics.replayRawRouteLength,
        materialized: replayRoute.length,
      },
    });
  }
  for (const key of ["decisionDepth", "autoStepCount", "autoPickupCount", "autoBattleCount"]) {
    if (searchFinal.accounting[key] !== replayFinal.accounting[key]) {
      return failed("ACCOUNTING_MISMATCH", {
        searchFinal,
        replayFinal,
        accountingMismatchField: key,
      });
    }
  }
  // Decision identity, in order: the recorded artifact's decision summaries must be
  // exactly the decision summaries of the executed transcript.
  const recordedDecisionSummaries = recordedDecisions.map(decisionSummary);
  const replayDecisionSummaries = replayRoute.filter((entry) => !isAutoEntry(entry)).map(decisionSummary);
  if (serializeForGuard(recordedDecisionSummaries) !== serializeForGuard(replayDecisionSummaries)) {
    return failed("DECISION_SEQUENCE_MISMATCH", {
      searchFinal,
      replayFinal,
      recordedDecisionSummaries: recordedDecisionSummaries.slice(0, 24),
      replayDecisionSummaries: replayDecisionSummaries.slice(0, 24),
    });
  }
  // The recorded artifact's leading auto entries must be the transcript's leading
  // auto entries, so the prefix is real history rather than a label.
  const recordedAutoPrefix = route.slice(0, initialAutoPrefixCount).map(decisionSummary);
  const replayAutoPrefix = replayRoute.slice(0, initialAutoPrefixCount).map(decisionSummary);
  if (serializeForGuard(recordedAutoPrefix) !== serializeForGuard(replayAutoPrefix)) {
    return failed("AUTO_PREFIX_MISMATCH", {
      searchFinal,
      replayFinal,
      recordedAutoPrefix: recordedAutoPrefix.slice(0, 24),
      replayAutoPrefix: replayAutoPrefix.slice(0, 24),
    });
  }
  // Difficulty must still read identically after the replay.
  if (serializeForGuard(replayFinal.difficulty) !== serializeForGuard(initialSnapshot.difficulty)) {
    return failed("DIFFICULTY_DRIFT", { searchFinal, replayFinal });
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
  if (serializeForGuard(replayFinal.difficulty) !== serializeForGuard(searchFinal.difficulty)) {
    mismatches.push("difficulty");
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
    verdict: `${gateName}_PASSED`,
    failureReason: null,
    ...baseReport(),
    metrics,
    recordedArtifactEntryCount: route.length,
    recordedDecisionCount: recordedDecisions.length,
    initialAutoPrefixCount,
    runtimeReplayEntryCount: replayRoute.length,
    runtimeReplayAutoCount: metrics.runtimeReplayAutoCount,
    searchFinal,
    replayFinal,
    mismatches: [],
  };
}

/** PR-5.20d compatibility wrapper: the original gate, fixed to MT2. */
function runOnlyUpMt1RealRouteGate(options) {
  return runOnlyUpRealRouteGate({
    ...(options || {}),
    targetFloorId: TARGET_FLOOR_ID,
    gateName: "REAL_MT1_GATE",
  });
}

/**
 * PR-5.21a first-region gate: MT1 all the way to MT6 in ONE direct search. It does
 * not solve MT2..MT5 first and it does not stitch intermediate results -- the whole
 * point is whether the existing DP reaches MT6 unaided from the real start state.
 */
function runOnlyUpFirstRegionRealRouteGate(options) {
  return runOnlyUpRealRouteGate({
    ...(options || {}),
    targetFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    gateName: "REAL_FIRST_REGION_GATE",
  });
}

module.exports = {
  DIFFICULTY_GUARD_TOKENS,
  EVIDENCE_SCHEMA,
  FIRST_REGION_TARGET_FLOOR_ID,
  MAX_EXPANDED_STATES,
  RSS_LIMIT_BYTES,
  TARGET_FLOOR_ID,
  WALL_LIMIT_MS,
  createNoStateChangeChoiceResolver,
  difficultySnapshot,
  isAutoEntry,
  isDecisionEntry,
  runOnlyUpFirstRegionRealRouteGate,
  runOnlyUpMt1RealRouteGate,
  runOnlyUpRealRouteGate,
  touchesDifficulty,
};
