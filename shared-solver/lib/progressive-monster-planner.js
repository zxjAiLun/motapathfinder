"use strict";

const { buildDpStateKey } = require("./dp-search");
const { getFloorOrder } = require("./floor-id");
const { getDecisionDepth } = require("./state");
const {
  buildMonsterOnlyActionProvider,
  tryReachAndBattleBatch,
} = require("./reach-and-battle-oracle");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function summarizeHero(state) {
  const hero = (state || {}).hero || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    lv: number(hero.lv, 0),
    exp: number(hero.exp, 0),
    money: number(hero.money, 0),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice() : [],
  };
}

function effectiveHeroValue(state, field) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
}

function summarizeEffectiveHero(state) {
  const hero = summarizeHero(state);
  return {
    hp: hero.hp,
    atk: effectiveHeroValue(state, "atk"),
    def: effectiveHeroValue(state, "def"),
    mdef: effectiveHeroValue(state, "mdef"),
    lv: hero.lv,
    exp: hero.exp,
  };
}

function routeLength(candidateOrState) {
  if (Array.isArray(candidateOrState && candidateOrState.route))
    return candidateOrState.route.length;
  return getDecisionDepth(candidateOrState || {});
}

function normalizeFloors(value, targetFloorId) {
  const floors = Array.isArray(value)
    ? value.slice()
    : String(value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  if (targetFloorId && !floors.includes(targetFloorId))
    floors.push(targetFloorId);
  return floors;
}

function normalizeOptions(options) {
  const config = options || {};
  return {
    maxRounds: Math.max(1, number(config.maxRounds, 100)),
    beamWidth: Math.max(1, number(config.beamWidth || config.beam, 32)),
    maxTargetsPerState: Math.max(
      1,
      number(config.maxTargetsPerState || config.maxTargets, 24),
    ),
    maxSuccessorsPerTarget: Math.max(
      1,
      number(config.maxSuccessorsPerTarget || config.maxSuccessors, 3),
    ),
    maxRuntimeMs: Math.max(0, number(config.maxRuntimeMs, 180000)),
    maxHeapMb: Math.max(0, number(config.maxHeapMb, 3072)),
    allowedFloors: normalizeFloors(config.allowedFloors, config.targetFloorId),
    targetFloorId: config.targetFloorId || null,
    noProgressRounds: Math.max(1, number(config.noProgressRounds, 5)),
    maxOracleFloorEntries: Math.max(1, number(config.maxOracleFloorEntries, 4)),
    maxPortalDepth: Math.max(1, number(config.maxPortalDepth, 10)),
    checkpointScoreDelta: Math.max(
      1,
      number(config.checkpointScoreDelta, 1000000),
    ),
    specialTargets: Array.isArray(config.specialTargets)
      ? config.specialTargets.slice()
      : [],
  };
}

function effectiveCombatScore(effective) {
  return effective.atk * 20000 + effective.def * 25000 + effective.mdef * 3000;
}

function floorProgressScore(state) {
  const visited = Object.keys((state || {}).visitedFloors || {}).length;
  return getFloorOrder((state || {}).floorId) * 1000000 + visited * 250000;
}

function evaluateProgressState(simulator, state, context) {
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  const routePenalty = routeLength(state) * 100;
  const newFloorBonus = context && context.enteredNewFloor ? 1000000 : 0;
  const targetFloorBonus = context && context.targetFloorReached ? 10000000 : 0;
  return (
    hero.hp * 0.01 +
    effectiveCombatScore(effective) +
    hero.lv * 500000 +
    hero.exp * 1000 +
    floorProgressScore(state) +
    newFloorBonus +
    targetFloorBonus -
    routePenalty
  );
}

function candidateOutcomeScore(candidate) {
  const state = candidate && candidate.state;
  const hero = summarizeHero(state);
  const effective = summarizeEffectiveHero(state);
  return (
    number(candidate && candidate.score, 0) +
    hero.hp * 0.05 +
    effectiveCombatScore(effective) +
    hero.lv * 1000000 +
    hero.exp * 2000 -
    routeLength(candidate) * 25
  );
}

function progressKey(simulator, state) {
  return buildDpStateKey(simulator, state, { keyMode: "region" });
}

function dominates(left, right) {
  if (!left || !right) return false;
  const leftHero = summarizeHero(left.state);
  const rightHero = summarizeHero(right.state);
  const leftEffective = summarizeEffectiveHero(left.state);
  const rightEffective = summarizeEffectiveHero(right.state);
  return (
    leftHero.hp >= rightHero.hp &&
    leftEffective.atk >= rightEffective.atk &&
    leftEffective.def >= rightEffective.def &&
    leftEffective.mdef >= rightEffective.mdef &&
    routeLength(left) <= routeLength(right)
  );
}

function selectRepresentatives(candidates, limit) {
  const selected = [];
  const add = (candidate) => {
    if (!candidate || selected.includes(candidate) || selected.length >= limit)
      return;
    selected.push(candidate);
  };
  const by = (compare) => candidates.slice().sort(compare)[0];
  add(by((left, right) => right.score - left.score));
  add(
    by(
      (left, right) =>
        summarizeHero(right.state).hp - summarizeHero(left.state).hp,
    ),
  );
  add(
    by(
      (left, right) =>
        effectiveCombatScore(summarizeEffectiveHero(right.state)) -
        effectiveCombatScore(summarizeEffectiveHero(left.state)),
    ),
  );
  add(by((left, right) => routeLength(left) - routeLength(right)));
  candidates
    .slice()
    .sort(
      (left, right) =>
        candidateOutcomeScore(right) - candidateOutcomeScore(left),
    )
    .forEach(add);
  return selected;
}

class StateArchive {
  constructor(simulator, options) {
    this.simulator = simulator;
    this.bucketLimit = Math.max(1, number((options || {}).bucketLimit, 4));
    this.byKey = new Map();
    this.accepted = 0;
    this.rejectedDominated = 0;
  }

  accept(candidate) {
    const key = progressKey(this.simulator, candidate.state);
    const bucket = this.byKey.get(key) || [];
    if (bucket.some((existing) => dominates(existing, candidate))) {
      this.rejectedDominated += 1;
      return false;
    }
    const filtered = bucket.filter(
      (existing) => !dominates(candidate, existing),
    );
    filtered.push(candidate);
    this.byKey.set(key, selectRepresentatives(filtered, this.bucketLimit));
    this.accepted += 1;
    return true;
  }
}

function makeRootCandidate(simulator, state) {
  const route = Array.isArray(state.route) ? state.route.slice() : [];
  return {
    id: "root#0",
    state,
    route,
    score: evaluateProgressState(simulator, state, {}),
    round: 0,
    action: null,
    parentId: null,
    tags: ["root"],
  };
}

function routePatchSummaries(routePatch) {
  return (routePatch || [])
    .map((entry) =>
      typeof entry === "string" ? entry : entry && entry.summary,
    )
    .filter(Boolean);
}

function makeSegment(options) {
  return {
    id: "progressive-monster-planner",
    goal: {},
    actionPolicy: {
      allowedFloors:
        options.allowedFloors.length > 0 ? options.allowedFloors : undefined,
      actionKinds: ["battle"],
      allowChangeFloors: [],
    },
    dp: {
      maxMonsterTargets: options.maxTargetsPerState,
      maxSuccessorsPerTarget: options.maxSuccessorsPerTarget,
      maxOracleFloorEntries: options.maxOracleFloorEntries,
      maxPortalDepth: options.maxPortalDepth,
    },
  };
}

function createOracleStats() {
  return {
    targetsGenerated: 0,
    targetsAfterCap: 0,
    reachableTargetsGenerated: 0,
    reachableTargetsAfterCap: 0,
    targetCapDrops: 0,
    statesWithTargetCap: 0,
    maxTargetsGeneratedForState: 0,
    maxTargetsAfterCapForState: 0,
    floorSearches: 0,
    floorCacheHits: 0,
    oracleCacheHitRate: 0,
    oracleFloorSearchMs: 0,
    floorEntriesReturned: 0,
    maxFloorEntriesReturned: 0,
    oracleBattleReachabilityMs: 0,
    reachabilityNodes: 0,
    maxReachabilityNodes: 0,
    battleCandidates: 0,
    successorCandidatesBeforeCap: 0,
    successorCandidatesAfterCap: 0,
    successorCapDrops: 0,
    successorSelectedByRole: {},
    successorsReturned: 0,
    routePatchTotalLength: 0,
    routePatchAvgLength: 0,
    routePatchMaxLength: 0,
    rejectedByReason: {},
    specialTargetVisible: 0,
    specialTargetAfterCap: 0,
    specialTargetCapDrops: 0,
  };
}

function memoryMb() {
  const memory = process.memoryUsage();
  return {
    heapUsedMb: memory.heapUsed / 1024 / 1024,
    rssMb: memory.rss / 1024 / 1024,
  };
}

function addCandidate(selected, candidate, seen, limit) {
  if (!candidate || selected.length >= limit || seen.has(candidate.id)) return;
  seen.add(candidate.id);
  selected.push(candidate);
}

function selectFrontier(candidates, limit) {
  const selected = [];
  const seen = new Set();
  const sorted = (compare) => candidates.slice().sort(compare);
  [
    sorted((left, right) => right.score - left.score),
    sorted(
      (left, right) =>
        summarizeHero(right.state).hp - summarizeHero(left.state).hp,
    ),
    sorted(
      (left, right) =>
        effectiveCombatScore(summarizeEffectiveHero(right.state)) -
        effectiveCombatScore(summarizeEffectiveHero(left.state)),
    ),
    sorted((left, right) => routeLength(left) - routeLength(right)),
    sorted(
      (left, right) =>
        getFloorOrder(right.state.floorId) - getFloorOrder(left.state.floorId),
    ),
    sorted(
      (left, right) =>
        candidateOutcomeScore(right) - candidateOutcomeScore(left),
    ),
  ].forEach((group) =>
    group.forEach((candidate) =>
      addCandidate(selected, candidate, seen, limit),
    ),
  );
  return selected;
}

function findMatchingPattern(summary, specialTargets) {
  if (!summary || !Array.isArray(specialTargets) || specialTargets.length === 0)
    return null;
  for (const pattern of specialTargets) {
    if (pattern === summary) return pattern;
    // Wildcard pattern: "battle:*@floor:x,y" matches "battle:enemyId@floor:x,y"
    if (pattern.includes("*@")) {
      const prefix = pattern.slice(0, pattern.indexOf("*@"));
      const suffix = pattern.slice(pattern.indexOf("*@") + 1);
      if (summary.startsWith(prefix) && summary.endsWith(suffix)) {
        const middle = summary.slice(
          prefix.length,
          summary.length - suffix.length,
        );
        if (middle.length > 0) return pattern;
      }
    }
  }
  return null;
}

function matchesSpecialTarget(summary, specialTargets) {
  return findMatchingPattern(summary, specialTargets) !== null;
}

class SpecialTargetTracker {
  constructor(patterns) {
    this.patterns = [...(patterns || [])];
    this.defeated = new Map();
  }

  record(summary) {
    const pattern = findMatchingPattern(summary, this.patterns);
    if (!pattern) return false;
    if (!this.defeated.has(pattern)) {
      this.defeated.set(pattern, summary);
      return true;
    }
    return false;
  }

  allDefeated() {
    if (this.patterns.length === 0) return false;
    return this.patterns.every((p) => this.defeated.has(p));
  }

  summary() {
    return {
      required: this.patterns,
      defeated: [...this.defeated.entries()].map(([pattern, summary]) => ({
        pattern,
        summary,
      })),
      missing: this.patterns.filter((p) => !this.defeated.has(p)),
    };
  }
}

function maybeRecordCheckpoint(
  checkpoints,
  candidate,
  previous,
  bestScore,
  options,
) {
  if (previous && previous.state.floorId !== candidate.state.floorId) {
    checkpoints.push({
      type: "entered-floor",
      floorId: candidate.state.floorId,
      candidateId: candidate.id,
      hero: summarizeHero(candidate.state),
      effectiveHero: summarizeEffectiveHero(candidate.state),
      routeLength: candidate.route.length,
    });
  }
  if (candidate.score >= bestScore + options.checkpointScoreDelta) {
    checkpoints.push({
      type: "best-score",
      floorId: candidate.state.floorId,
      candidateId: candidate.id,
      score: candidate.score,
      hero: summarizeHero(candidate.state),
      effectiveHero: summarizeEffectiveHero(candidate.state),
      routeLength: candidate.route.length,
    });
  }
  if (
    candidate.action &&
    matchesSpecialTarget(candidate.action.summary, options.specialTargets)
  ) {
    checkpoints.push({
      type: "special-target-defeated",
      floorId: candidate.state.floorId,
      target: candidate.action.summary,
      candidateId: candidate.id,
      hero: summarizeHero(candidate.state),
      effectiveHero: summarizeEffectiveHero(candidate.state),
      routeLength: candidate.route.length,
    });
  }
}

function shouldStop(found, round, noProgress, options, startedAt, peakHeapMb) {
  if (found) return "target-floor";
  if (
    options.maxRuntimeMs > 0 &&
    Date.now() - startedAt >= options.maxRuntimeMs
  )
    return "time-limit";
  if (options.maxHeapMb > 0 && peakHeapMb >= options.maxHeapMb)
    return "memory-limit";
  if (round >= options.maxRounds) return "round-limit";
  if (noProgress >= options.noProgressRounds) return "no-progress";
  return null;
}

function runProgressiveMonsterPlanner(simulator, initialState, options) {
  const config = normalizeOptions(options);
  const startedAt = Date.now();
  const root = makeRootCandidate(simulator, initialState);
  const archive = new StateArchive(simulator, config);
  archive.accept(root);
  let frontier = [root];
  let bestCandidate = root;
  let bestScore = root.score;
  let noProgress = 0;
  let stoppedReason = null;
  let peakHeapMb = 0;
  let peakRssMb = 0;
  const specialTracker = new SpecialTargetTracker(config.specialTargets || []);
  const checkpoints = [];
  const oracleStats = createOracleStats();
  const diagnostics = {
    rounds: 0,
    statesExpanded: 0,
    targetsConsidered: 0,
    successorsAccepted: 0,
    successorsRejected: 0,
    stoppedReason: null,
    maxHeapMb: config.maxHeapMb,
    heapUsedMb: 0,
    rssMb: 0,
    archiveKeys: 0,
    rejectedByReason: oracleStats.rejectedByReason,
    oracle: oracleStats,
  };
  const segment = makeSegment(config);
  const targetProvider = buildMonsterOnlyActionProvider(
    simulator,
    segment,
    {
      maxMonsterTargets: config.maxTargetsPerState,
      specialTargets: config.specialTargets || [],
    },
    oracleStats,
  );

  let specialTargetGenerated = 0;
  let specialTargetAccepted = 0;
  let specialTargetRejectedByArchive = 0;

  for (let round = 1; round <= config.maxRounds; round += 1) {
    diagnostics.rounds = round;
    const recentMemory = memoryMb();
    peakHeapMb = Math.max(peakHeapMb, recentMemory.heapUsedMb);
    peakRssMb = Math.max(peakRssMb, recentMemory.rssMb);
    stoppedReason = shouldStop(
      false,
      round - 1,
      noProgress,
      config,
      startedAt,
      peakHeapMb,
    );
    if (stoppedReason) break;

    const next = [];
    for (const candidate of frontier) {
      diagnostics.statesExpanded += 1;
      const targets = targetProvider(simulator, candidate.state);
      diagnostics.targetsConsidered += targets.length;

      // Batch: one floor traversal + one walk BFS per floor entry for all targets
      const batchResult = tryReachAndBattleBatch(
        simulator,
        candidate.state,
        targets,
        segment,
        {
          maxSuccessorsPerTarget: config.maxSuccessorsPerTarget,
          maxOracleFloorEntries: config.maxOracleFloorEntries,
          maxPortalDepth: config.maxPortalDepth,
        },
        oracleStats,
      );

      // Collect batch perf diagnostics (batch returns them, planner accumulates)
      if (batchResult.diagnostics) {
        oracleStats.currentFloorFastPaths =
          Number(oracleStats.currentFloorFastPaths || 0) +
          (batchResult.diagnostics.currentFloorFastPaths || 0);
        oracleStats.portalFloorSearches =
          Number(oracleStats.portalFloorSearches || 0) +
          (batchResult.diagnostics.portalFloorSearches || 0);
        oracleStats.reachabilityCalls =
          Number(oracleStats.reachabilityCalls || 0) +
          (batchResult.diagnostics.reachabilityCalls || 0);
        oracleStats.totalFloorMs =
          Number(oracleStats.totalFloorMs || 0) +
          (batchResult.diagnostics.totalFloorMs || 0);
        oracleStats.totalReachMs =
          Number(oracleStats.totalReachMs || 0) +
          (batchResult.diagnostics.totalReachMs || 0);
        oracleStats.totalBattleMs =
          Number(oracleStats.totalBattleMs || 0) +
          (batchResult.diagnostics.totalBattleMs || 0);
        oracleStats.oracleFloorSearchMs =
          Number(oracleStats.oracleFloorSearchMs || 0) +
          (batchResult.diagnostics.totalFloorMs || 0);
        oracleStats.oracleBattleReachabilityMs =
          Number(oracleStats.oracleBattleReachabilityMs || 0) +
          (batchResult.diagnostics.totalReachMs || 0);
      }

      if (!batchResult.ok) {
        oracleStats.rejectedByReason[batchResult.reason] =
          Number(oracleStats.rejectedByReason[batchResult.reason] || 0) + 1;
        continue;
      }

      oracleStats.battleCandidates += batchResult.results.length;
      oracleStats.successorsReturned += batchResult.results.length;

      for (const successor of batchResult.results) {
        const patch = routePatchSummaries(successor.routePatch);
        oracleStats.routePatchTotalLength += patch.length;
        oracleStats.routePatchMaxLength = Math.max(
          oracleStats.routePatchMaxLength,
          patch.length,
        );
        const state = successor.postState;
        const matchedTarget = successor.target || {};
        state.route = candidate.route.concat(patch);
        state._routePatch = patch;
        const enteredNewFloor = candidate.state.floorId !== state.floorId;
        const targetFloorReached = Boolean(
          config.targetFloorId && state.floorId === config.targetFloorId,
        );
        const nextCandidate = {
          id: `r${round}:${next.length}:${patch[patch.length - 1] || matchedTarget.summary}`,
          state,
          route: state.route.slice(),
          score: evaluateProgressState(simulator, state, {
            enteredNewFloor,
            targetFloorReached,
          }),
          round,
          action: matchedTarget,
          parentId: candidate.id,
          tags: [],
        };
        const isSpecial = matchesSpecialTarget(
          matchedTarget.summary,
          config.specialTargets || [],
        );
        if (isSpecial) specialTargetGenerated += 1;

        if (archive.accept(nextCandidate)) {
          diagnostics.successorsAccepted += 1;
          if (isSpecial) specialTargetAccepted += 1;
          next.push(nextCandidate);
          maybeRecordCheckpoint(
            checkpoints,
            nextCandidate,
            candidate,
            bestScore,
            config,
          );
          specialTracker.record(
            (nextCandidate.action && nextCandidate.action.summary) || "",
          );
          if (
            candidateOutcomeScore(nextCandidate) >
            candidateOutcomeScore(bestCandidate)
          ) {
            bestCandidate = nextCandidate;
            bestScore = Math.max(bestScore, nextCandidate.score);
          }
        } else {
          diagnostics.successorsRejected += 1;
          if (isSpecial) specialTargetRejectedByArchive += 1;
        }
      }
    }

    if (next.length === 0) {
      noProgress += 1;
    } else {
      noProgress = 0;
      frontier = selectFrontier(next, config.beamWidth);
    }
    if (
      frontier.some(
        (candidate) =>
          config.targetFloorId &&
          candidate.state.floorId === config.targetFloorId,
      )
    ) {
      bestCandidate =
        selectFrontier(
          frontier.filter(
            (candidate) => candidate.state.floorId === config.targetFloorId,
          ),
          1,
        )[0] || bestCandidate;
      stoppedReason = "target-floor";
      break;
    }
    if (specialTracker.allDefeated()) {
      stoppedReason = "special-targets-defeated";
      break;
    }
  }

  const finalMemory = memoryMb();
  peakHeapMb = Math.max(peakHeapMb, finalMemory.heapUsedMb);
  peakRssMb = Math.max(peakRssMb, finalMemory.rssMb);
  stoppedReason =
    stoppedReason ||
    shouldStop(
      Boolean(
        config.targetFloorId &&
        bestCandidate.state.floorId === config.targetFloorId,
      ),
      diagnostics.rounds,
      noProgress,
      config,
      startedAt,
      peakHeapMb,
    ) ||
    "complete";
  diagnostics.stoppedReason = stoppedReason;
  diagnostics.heapUsedMb = Number(peakHeapMb.toFixed(1));
  diagnostics.rssMb = Number(peakRssMb.toFixed(1));
  diagnostics.archiveKeys = archive.byKey.size;
  diagnostics.archiveAccepted = archive.accepted;
  diagnostics.archiveRejectedDominated = archive.rejectedDominated;
  diagnostics.specialTargets = specialTracker.summary();
  diagnostics.specialTargetGenerated = specialTargetGenerated;
  diagnostics.specialTargetAccepted = specialTargetAccepted;
  diagnostics.specialTargetRejectedByArchive = specialTargetRejectedByArchive;
  diagnostics.perf = {
    currentFloorFastPaths: Number(oracleStats.currentFloorFastPaths || 0),
    portalFloorSearches: Number(oracleStats.portalFloorSearches || 0),
    totalReachabilityCalls: Number(oracleStats.reachabilityCalls || 0),
    totalFloorMs: Number(oracleStats.totalFloorMs || 0),
    totalReachMs: Number(oracleStats.totalReachMs || 0),
    totalBattleMs: Number(oracleStats.totalBattleMs || 0),
  };
  const floorLookups =
    Number(oracleStats.floorSearches || 0) +
    Number(oracleStats.floorCacheHits || 0);
  oracleStats.oracleCacheHitRate =
    floorLookups > 0 ? oracleStats.floorCacheHits / floorLookups : 0;
  oracleStats.routePatchAvgLength =
    oracleStats.successorsReturned > 0
      ? oracleStats.routePatchTotalLength / oracleStats.successorsReturned
      : 0;

  return {
    found: Boolean(
      config.targetFloorId &&
      bestCandidate.state.floorId === config.targetFloorId,
    ),
    bestCandidate,
    bestState: bestCandidate.state,
    bestRoute: bestCandidate.route,
    frontier,
    checkpoints,
    diagnostics,
  };
}

module.exports = {
  runProgressiveMonsterPlanner,
  __testHooks: {
    StateArchive,
    dominates,
    evaluateProgressState,
    selectFrontier,
    summarizeEffectiveHero,
    summarizeHero,
    SpecialTargetTracker,
    findMatchingPattern,
  },
};
