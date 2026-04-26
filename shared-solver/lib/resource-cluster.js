"use strict";

const { buildClusterConfluenceKey, dominatesAtConfluence, effectiveRouteLength } = require("./confluence-key");
const { cloneState } = require("./state");

const DEFAULT_OPTIONS = {
  maxDepth: 3,
  maxNodes: 36,
  branchLimit: 4,
  frontierLimit: 24,
  resultLimit: 4,
  minPlanLength: 2,
  maxClusterActions: 12,
  maxOutputActions: 12,
  clusterRepresentatives: 3,
  groupLocalClusters: true,
  clusterLinkDistance: 2,
  clusterExpansionDistance: 2,
  composeLocalClusters: true,
  foundationCandidateClusters: 6,
  foundationMaxClusters: 4,
  foundationRepresentatives: 2,
  foundationFrontierLimit: 16,
  foundationLimit: 4,
};

const CLUSTER_ACTION_KINDS = new Set(["battle", "pickup", "equip", "event", "openDoor", "useTool"]);

function hero(state) {
  return (state && state.hero) || {};
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeDelta(before, after) {
  const beforeHero = hero(before);
  const afterHero = hero(after);
  const inventoryDelta = Object.keys({ ...((before || {}).inventory || {}), ...((after || {}).inventory || {}) })
    .sort()
    .reduce((result, itemId) => {
      const delta = number(((after || {}).inventory || {})[itemId]) - number(((before || {}).inventory || {})[itemId]);
      if (delta !== 0) result[itemId] = delta;
      return result;
    }, {});
  return {
    hp: number(afterHero.hp) - number(beforeHero.hp),
    atk: number(afterHero.atk) - number(beforeHero.atk),
    def: number(afterHero.def) - number(beforeHero.def),
    mdef: number(afterHero.mdef) - number(beforeHero.mdef),
    exp: number(afterHero.exp) - number(beforeHero.exp),
    lv: number(afterHero.lv) - number(beforeHero.lv),
    money: number(afterHero.money) - number(beforeHero.money),
    inventory: inventoryDelta,
  };
}

function scoreDelta(delta) {
  const inventoryGain = Object.values((delta || {}).inventory || {}).reduce((sum, value) => sum + Math.max(0, number(value)), 0);
  return (
    number((delta || {}).atk) * 120000 +
    number((delta || {}).def) * 100000 +
    number((delta || {}).mdef) * 12000 +
    number((delta || {}).lv) * 300000 +
    number((delta || {}).exp) * 5000 +
    number((delta || {}).money) * 200 +
    inventoryGain * 20000 +
    number((delta || {}).hp)
  );
}

function inventoryGain(delta) {
  return Object.values((delta || {}).inventory || {}).reduce((sum, value) => sum + Math.max(0, number(value)), 0);
}

function stopReasonsForDelta(delta) {
  const reasons = [];
  if (number((delta || {}).lv) > 0) reasons.push("levelUp");
  if (
    number((delta || {}).atk) > 0 ||
    number((delta || {}).def) > 0 ||
    number((delta || {}).mdef) > 0 ||
    inventoryGain(delta) > 0
  ) {
    reasons.push("keyItem");
  }
  return reasons;
}

function actionPoint(action) {
  const target = (action && action.target) || (action && action.loc) || action || {};
  const x = target.x != null ? target.x : "";
  const y = target.y != null ? target.y : "";
  if (x === "" && y === "" && action && action.resourceId) return String(action.resourceId);
  return `${x},${y}`;
}

function actionCoordinates(action) {
  const target = (action && action.target) || (action && action.loc) || action || {};
  const x = target.x != null ? Number(target.x) : null;
  const y = target.y != null ? Number(target.y) : null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function manhattan(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function choicePathKey(action) {
  const path = (action && (action.choicePath || action.eventChoicePath || action.choice_path)) || "";
  if (Array.isArray(path)) return path.join(".");
  return String(path || "");
}

function clusterActionId(action) {
  if (!action) return "";
  const floorId = action.floorId || "";
  if (action.kind === "battle") {
    const enemyId = action.enemyId || action.monsterId || action.id || action.resourceId || action.clusterLabel || "";
    return `battle@${floorId}:${actionPoint(action)}:${enemyId}`;
  }
  if (action.kind === "pickup") {
    const itemId = action.itemId || action.item || action.id || action.resourceId || "";
    return `pickup@${floorId}:${actionPoint(action)}:${itemId}`;
  }
  if (action.kind === "equip") {
    const equipId = action.equipId || action.itemId || action.item || action.id || action.resourceId || "";
    return `equip@${equipId}`;
  }
  if (action.kind === "event") {
    return `event@${floorId}:${actionPoint(action)}:${choicePathKey(action)}`;
  }
  if (action.kind === "openDoor") {
    const doorId = action.doorId || action.door || action.id || action.resourceId || "";
    return `openDoor@${floorId}:${actionPoint(action)}:${doorId}`;
  }
  if (action.kind === "useTool") {
    const toolId = action.tool || action.toolId || action.itemId || action.item || action.resourceId || "";
    return `useTool@${floorId}:${actionPoint(action)}:${toolId}`;
  }
  return action.resourceId ? `${action.kind || "resource"}@${floorId}:${action.resourceId}` : "";
}

function actionFingerprint(simulator, action) {
  const stableId = clusterActionId(action);
  if (stableId) return stableId;
  if (typeof simulator.getActionFingerprint === "function") return simulator.getActionFingerprint(action);
  return action.fingerprint || action.summary || `${action.kind}:${action.floorId || ""}`;
}

function normalizeStep(simulator, action) {
  const entry = typeof simulator.normalizePocketStep === "function"
    ? simulator.normalizePocketStep(action)
    : {
        kind: action.kind,
        summary: action.summary,
        fingerprint: actionFingerprint(simulator, action),
        floorId: action.floorId,
      };
  const stableId = actionFingerprint(simulator, action);
  if (!entry.clusterActionId) entry.clusterActionId = stableId;
  if (action.clusterLabel && !entry.clusterLabel) entry.clusterLabel = action.clusterLabel;
  if (action.resourceId && !entry.resourceId) entry.resourceId = action.resourceId;
  return entry;
}

function buildConfluenceKey(simulator, state, mask) {
  return buildClusterConfluenceKey(simulator, state, mask || 0);
}

function isAllowedClusterAction(baseState, currentState, action) {
  if (!action || !CLUSTER_ACTION_KINDS.has(action.kind)) return false;
  if (action.unsupported) return false;
  if (action.floorId && action.floorId !== currentState.floorId) return false;
  if (currentState.floorId !== baseState.floorId) return false;
  if (action.kind === "event" && action.hasStateChange !== true) return false;
  return true;
}

function countReachableClusterResourceSignals(simulator, state) {
  let actions = [];
  try {
    actions = (((simulator.enumeratePrimitiveActions(state) || {}).actions) || []);
  } catch (error) {
    return 0;
  }
  return actions.reduce((count, action) => {
    if (!action || action.unsupported) return count;
    if (action.kind === "pickup" || action.kind === "equip") return count + 1;
    if (action.kind === "event" && action.hasStateChange === true) return count + 1;
    if (action.kind !== "battle") return count;
    const estimate = action.estimate || {};
    return number(estimate.exp) > 0 || number(estimate.money) > 0 || number(estimate.guards) > 0 ? count + 1 : count;
  }, 0);
}

function isUsefulClusterCandidate(simulator, baseState, currentState, action, nextState) {
  const stepScore = scoreDelta(summarizeDelta(currentState, nextState));
  const totalScore = scoreDelta(summarizeDelta(baseState, nextState));
  if (stepScore > 0 || totalScore > 0) return true;
  if (action.kind === "openDoor" || action.kind === "useTool") {
    return countReachableClusterResourceSignals(simulator, nextState) > countReachableClusterResourceSignals(simulator, currentState);
  }
  if (action.kind === "battle") {
    const estimate = action.estimate || {};
    return number(estimate.exp) > 0 || number(estimate.guards) > 0;
  }
  return action.kind === "pickup" || action.kind === "equip" || action.kind === "event";
}

function compareNodes(baseState, left, right) {
  const leftDelta = summarizeDelta(baseState, left.state);
  const rightDelta = summarizeDelta(baseState, right.state);
  const scoreDiff = (right.score == null ? scoreDelta(rightDelta) : right.score) - (left.score == null ? scoreDelta(leftDelta) : left.score);
  if (scoreDiff !== 0) return scoreDiff;
  const hpDiff = number(hero(right.state).hp) - number(hero(left.state).hp);
  if (hpDiff !== 0) return hpDiff;
  return Number((left.planEntries || []).length || 0) - Number((right.planEntries || []).length || 0);
}

function maskSize(mask) {
  let value = Number(mask || 0);
  let count = 0;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

function createActionIndex(simulator, baseState, initialActions, options) {
  const maxClusterActions = Number(options.maxClusterActions || DEFAULT_OPTIONS.maxClusterActions);
  const bitIndexByActionId = new Map();
  const add = (action) => {
    if (!isAllowedClusterAction(baseState, baseState, action)) return;
    const id = actionFingerprint(simulator, action);
    if (!id || bitIndexByActionId.has(id)) return;
    if (bitIndexByActionId.size >= maxClusterActions) return;
    bitIndexByActionId.set(id, bitIndexByActionId.size);
  };
  (initialActions || []).forEach(add);
  return {
    bitIndexByActionId,
    getBit(action) {
      const id = actionFingerprint(simulator, action);
      if (!id) return null;
      if (!bitIndexByActionId.has(id)) {
        if (bitIndexByActionId.size >= maxClusterActions) return null;
        bitIndexByActionId.set(id, bitIndexByActionId.size);
      }
      return bitIndexByActionId.get(id);
    },
  };
}

function buildClusterRegion(simulator, actions, options) {
  const points = (actions || []).map(actionCoordinates).filter(Boolean);
  const seedActionIds = new Set((actions || []).map((action) => actionFingerprint(simulator, action)).filter(Boolean));
  if (points.length === 0 && seedActionIds.size === 0) return null;
  return {
    points,
    seedActionIds,
    expansionDistance: Number(options.clusterExpansionDistance || DEFAULT_OPTIONS.clusterExpansionDistance),
  };
}

function isActionInClusterRegion(simulator, action, region) {
  if (!region) return true;
  const id = actionFingerprint(simulator, action);
  if (id && region.seedActionIds && region.seedActionIds.has(id)) return true;
  const point = actionCoordinates(action);
  if (!point || !Array.isArray(region.points) || region.points.length === 0) return false;
  const distance = Number(region.expansionDistance || DEFAULT_OPTIONS.clusterExpansionDistance);
  return region.points.some((candidate) => manhattan(point, candidate) <= distance);
}

function detectLocalActionClusters(simulator, baseState, initialActions, providedOptions) {
  const options = { ...DEFAULT_OPTIONS, ...(providedOptions || {}) };
  const actions = (initialActions || []).filter((action) => isAllowedClusterAction(baseState, baseState, action));
  if (actions.length === 0) return [];
  if (options.groupLocalClusters === false) {
    return [{ actions, region: buildClusterRegion(simulator, actions, options) }];
  }

  const linkDistance = Number(options.clusterLinkDistance || DEFAULT_OPTIONS.clusterLinkDistance);
  const nodes = actions
    .map((action, index) => ({ action, index, point: actionCoordinates(action) }))
    .filter((node) => node.point);
  const unplaced = actions.filter((action) => !actionCoordinates(action));
  if (nodes.length === 0) return [{ actions, region: null }];

  const visited = new Set();
  const groups = [];
  nodes.forEach((root) => {
    if (visited.has(root.index)) return;
    const queue = [root];
    const members = [];
    visited.add(root.index);
    while (queue.length > 0) {
      const node = queue.shift();
      members.push(node.action);
      nodes.forEach((candidate) => {
        if (visited.has(candidate.index)) return;
        if (manhattan(node.point, candidate.point) > linkDistance) return;
        visited.add(candidate.index);
        queue.push(candidate);
      });
    }
    groups.push({ actions: members, region: buildClusterRegion(simulator, members, options) });
  });
  if (unplaced.length > 0) groups.push({ actions: unplaced, region: null });
  return groups;
}

function buildBucketKey(mask, confluenceKey) {
  return JSON.stringify({ mask: Number(mask || 0), confluenceKey });
}

function planEntryKey(entry) {
  if (!entry) return "";
  return entry.fingerprint || entry.clusterActionId || entry.summary || "";
}

function planKey(planEntries) {
  return (planEntries || []).map(planEntryKey).filter(Boolean).join("|");
}

function planEntryPoint(entry) {
  if (!entry) return null;
  const target = entry.target || entry.loc || {};
  const x = target.x != null ? target.x : entry.x;
  const y = target.y != null ? target.y : entry.y;
  if (x == null || y == null) return null;
  return { floorId: entry.floorId, x: Number(x), y: Number(y) };
}

function isPlanEntryAlreadyCovered(state, entry) {
  const point = planEntryPoint(entry);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const floorId = point.floorId || (state && state.floorId);
  const removed = (((state || {}).floorStates || {})[floorId] || {}).removed || {};
  return Boolean(removed[`${point.x},${point.y}`]);
}

function findPrimitiveByPlanEntry(simulator, state, entry) {
  let actions = [];
  try {
    actions = (((simulator.enumeratePrimitiveActions(state) || {}).actions) || []);
  } catch (error) {
    return null;
  }
  if (typeof simulator.findPrimitiveByPlanEntry === "function") {
    try {
      const matched = simulator.findPrimitiveByPlanEntry(actions, entry);
      if (matched) return matched;
    } catch (error) {
      // Fall through to the local matcher for lightweight test simulators.
    }
  }
  const keys = new Set([
    entry && entry.fingerprint,
    entry && entry.clusterActionId,
    entry && entry.summary,
  ].filter(Boolean));
  if (keys.size === 0) return null;
  return actions.find((action) => (
    keys.has(actionFingerprint(simulator, action)) ||
    keys.has(clusterActionId(action)) ||
    keys.has(action.summary)
  )) || null;
}

function replayPlanEntries(simulator, state, planEntries) {
  let nextState = cloneState(state);
  const replayed = [];
  let covered = 0;
  for (const entry of planEntries || []) {
    const action = findPrimitiveByPlanEntry(simulator, nextState, entry);
    if (!action) {
      if (isPlanEntryAlreadyCovered(nextState, entry)) {
        covered += 1;
        continue;
      }
      return null;
    }
    try {
      nextState = simulator.applyAction(nextState, action, { storeRoute: false });
    } catch (error) {
      return null;
    }
    replayed.push(normalizeStep(simulator, action));
  }
  return { state: nextState, planEntries: replayed, covered };
}

function pushExample(diagnostics, sample) {
  if (!diagnostics || !Array.isArray(diagnostics.examples)) return;
  if (diagnostics.examples.length < 12) diagnostics.examples.push(sample);
}

function insertClusterSkyline(bucket, candidate, options, diagnostics, behavior) {
  const config = behavior || {};
  const countDominance = config.countDominance !== false;
  const limit = Math.max(1, Number(options.clusterRepresentatives || DEFAULT_OPTIONS.clusterRepresentatives));
  for (const existing of bucket) {
    if (dominatesAtConfluence(null, existing.state, candidate.state, {
      leftKey: existing.confluenceKey,
      rightKey: candidate.confluenceKey,
    })) {
      if (countDominance) {
        existing.dominatedPlans = number(existing.dominatedPlans) + 1 + number(candidate.dominatedPlans);
        if (diagnostics) diagnostics.skylineRejected += 1;
        pushExample(diagnostics, {
          reason: "cluster-skyline-rejected",
          kept: existing.planEntries.map((entry) => entry.summary),
          rejected: candidate.planEntries.map((entry) => entry.summary),
        });
      }
      return false;
    }
  }

  let replaced = 0;
  const kept = bucket.filter((existing) => {
    if (!dominatesAtConfluence(null, candidate.state, existing.state, {
      leftKey: candidate.confluenceKey,
      rightKey: existing.confluenceKey,
    })) {
      return true;
    }
    replaced += 1;
    if (countDominance) candidate.dominatedPlans = number(candidate.dominatedPlans) + 1 + number(existing.dominatedPlans);
    return false;
  });
  if (countDominance && replaced > 0 && diagnostics) {
    diagnostics.skylineReplaced += replaced;
    pushExample(diagnostics, {
      reason: "cluster-skyline-replaced",
      kept: candidate.planEntries.map((entry) => entry.summary),
      replaced,
    });
  }
  kept.push(candidate);
  const selected = selectBucketRepresentatives(kept, limit);
  if (countDominance && selected.length < kept.length && diagnostics) diagnostics.skylineRejected += kept.length - selected.length;
  bucket.length = 0;
  bucket.push(...selected);
  return selected.includes(candidate);
}

function selectBucketRepresentatives(nodes, limit) {
  const selected = [];
  const add = (node, role) => {
    if (!node || selected.includes(node)) return;
    if (!node.representativeRole) node.representativeRole = role;
    selected.push(node);
  };
  const byHp = nodes.slice().sort((left, right) => number(hero(right.state).hp) - number(hero(left.state).hp) || effectiveRouteLength(left.state) - effectiveRouteLength(right.state));
  const byRoute = nodes.slice().sort((left, right) => effectiveRouteLength(left.state) - effectiveRouteLength(right.state) || number(hero(right.state).hp) - number(hero(left.state).hp));
  const byExp = nodes.slice().sort((left, right) => number(hero(right.state).exp) - number(hero(left.state).exp) || number(hero(right.state).hp) - number(hero(left.state).hp));
  const byKeys = nodes.slice().sort((left, right) => Object.values((right.state || {}).inventory || {}).reduce((sum, value) => sum + number(value), 0) - Object.values((left.state || {}).inventory || {}).reduce((sum, value) => sum + number(value), 0));
  const byScore = nodes.slice().sort((left, right) => number(right.score) - number(left.score));
  add(byHp[0], "highestHp");
  add(byRoute[0], "shortestPlan");
  add(byExp[0], "nearLevel");
  add(byKeys[0], "mostKeys");
  add(byScore[0], "bestScore");
  return selected.slice(0, limit);
}

function enumerateCandidates(simulator, baseState, node, initialActions, actionIndex, options) {
  const rawActions = node.depth === 0 && Array.isArray(initialActions)
    ? initialActions
    : simulator.enumeratePrimitiveActions(node.state).actions;
  return (rawActions || [])
    .filter((action) => isAllowedClusterAction(baseState, node.state, action))
    .filter((action) => isActionInClusterRegion(simulator, action, options.clusterRegion))
    .filter((action) => !node.planKeys.has(actionFingerprint(simulator, action)))
    .map((action) => {
      const bit = actionIndex.getBit(action);
      if (bit == null) return null;
      let nextState;
      try {
        nextState = simulator.applyAction(node.state, action, { storeRoute: false });
      } catch (error) {
        return null;
      }
      if (!isUsefulClusterCandidate(simulator, baseState, node.state, action, nextState)) return null;
      const stepDelta = summarizeDelta(node.state, nextState);
      const totalDelta = summarizeDelta(baseState, nextState);
      return {
        action,
        bit,
        nextMask: Number(node.mask || 0) | (1 << bit),
        nextState,
        score: scoreDelta(totalDelta) + scoreDelta(stepDelta) * 0.25,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDamage = number((left.action.estimate || {}).damage);
      const rightDamage = number((right.action.estimate || {}).damage);
      return leftDamage - rightDamage;
    })
    .slice(0, Number(options.branchLimit || DEFAULT_OPTIONS.branchLimit));
}

function isUsefulResult(baseState, node, options) {
  if (!node || node.depth < Number(options.minPlanLength || DEFAULT_OPTIONS.minPlanLength)) return false;
  return scoreDelta(summarizeDelta(baseState, node.state)) > 0;
}

function pruneFrontier(baseState, nodes, options) {
  return (nodes || [])
    .slice()
    .sort((left, right) => compareNodes(baseState, left, right))
    .slice(0, Number(options.frontierLimit || DEFAULT_OPTIONS.frontierLimit));
}

function flattenBuckets(buckets) {
  const nodes = [];
  buckets.forEach((bucket) => nodes.push(...bucket));
  return nodes;
}

function insertNode(buckets, node, options, diagnostics, behavior) {
  const key = buildBucketKey(node.mask, node.confluenceKey);
  const bucket = buckets.get(key) || [];
  const accepted = insertClusterSkyline(bucket, node, options, diagnostics, behavior);
  buckets.set(key, bucket);
  return accepted;
}

function selectFinalPlans(baseState, resultBuckets, options) {
  const nodes = flattenBuckets(resultBuckets);
  const maxCompletion = nodes.reduce((best, node) => Math.max(best, maskSize(node.mask)), 0);
  const completed = nodes.filter((node) => maskSize(node.mask) === maxCompletion);
  const selected = completed
    .slice()
    .sort((left, right) => compareNodes(baseState, left, right))
    .slice(0, Number(options.resultLimit || DEFAULT_OPTIONS.resultLimit));
  selected.forEach((node) => {
    node.skylineSize = completed.length;
  });
  return selected;
}

function selectClusterPlanRepresentatives(baseState, plans, limit) {
  const seen = new Set();
  return (plans || [])
    .slice()
    .sort((left, right) => compareNodes(baseState, left, right))
    .filter((plan) => {
      const key = planKey(plan.planEntries);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(limit || DEFAULT_OPTIONS.foundationRepresentatives)));
}

function buildFoundationNode(baseState, state, mask, planEntries, localClusterIndexes, score) {
  return {
    state,
    mask,
    confluenceKey: null,
    planEntries,
    planKeys: new Set(planEntries.map(planEntryKey).filter(Boolean)),
    depth: localClusterIndexes.length,
    score,
    dominatedPlans: 0,
    foundation: true,
    foundationRole: "foundation",
    localClusterIndexes,
  };
}

function composeLocalClusterFoundationPlans(simulator, baseState, perClusterPlans, providedOptions) {
  const options = { ...DEFAULT_OPTIONS, ...(providedOptions || {}) };
  const diagnostics = options.diagnostics || null;
  const candidateClusterLimit = Math.max(2, Number(options.foundationCandidateClusters || DEFAULT_OPTIONS.foundationCandidateClusters));
  const representatives = Math.max(1, Number(options.foundationRepresentatives || DEFAULT_OPTIONS.foundationRepresentatives));
  const clusters = (perClusterPlans || [])
    .map((cluster) => ({
      clusterIndex: cluster.clusterIndex,
      plans: selectClusterPlanRepresentatives(baseState, cluster.plans, representatives),
    }))
    .filter((cluster) => cluster.plans.length > 0)
    .sort((left, right) => {
      const leftBest = left.plans[0];
      const rightBest = right.plans[0];
      return compareNodes(baseState, leftBest, rightBest);
    })
    .slice(0, candidateClusterLimit);
  if (clusters.length < 2) return [];
  if (diagnostics) diagnostics.foundationCompositionsEnumerated = Number(diagnostics.foundationCompositionsEnumerated || 0) + 1;

  const root = buildFoundationNode(baseState, cloneState(baseState), 0, [], [], 0);
  root.confluenceKey = buildConfluenceKey(simulator, root.state, 0);
  let frontier = [root];
  const resultBuckets = new Map();
  const maxDepth = Math.min(
    clusters.length,
    Math.max(2, Number(options.foundationMaxClusters || DEFAULT_OPTIONS.foundationMaxClusters))
  );

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const nextBuckets = new Map();
    for (const node of frontier) {
      clusters.forEach((cluster, clusterOffset) => {
        const clusterBit = 1 << clusterOffset;
        if ((Number(node.mask || 0) & clusterBit) !== 0) return;
        cluster.plans.forEach((plan) => {
          const replayed = replayPlanEntries(simulator, node.state, plan.planEntries);
          if (!replayed) {
            if (diagnostics) diagnostics.foundationReplayFailures = Number(diagnostics.foundationReplayFailures || 0) + 1;
            return;
          }
          if (replayed.planEntries.length === 0) {
            if (diagnostics) diagnostics.foundationPlansAlreadyCovered = Number(diagnostics.foundationPlansAlreadyCovered || 0) + 1;
            return;
          }
          if (diagnostics && Number(replayed.covered || 0) > 0) {
            diagnostics.foundationPlanStepsAlreadyCovered = Number(diagnostics.foundationPlanStepsAlreadyCovered || 0) + Number(replayed.covered || 0);
          }
          const existingKeys = node.planKeys || new Set();
          const replayKeys = replayed.planEntries.map(planEntryKey).filter(Boolean);
          if (replayKeys.some((key) => existingKeys.has(key))) {
            if (diagnostics) diagnostics.foundationReplayFailures = Number(diagnostics.foundationReplayFailures || 0) + 1;
            return;
          }
          const planEntries = node.planEntries.concat(replayed.planEntries);
          const localClusterIndexes = node.localClusterIndexes.concat([cluster.clusterIndex]);
          const mask = Number(node.mask || 0) | clusterBit;
          const score = scoreDelta(summarizeDelta(baseState, replayed.state)) + number(hero(replayed.state).hp) * 0.1 - planEntries.length * 100;
          const nextNode = buildFoundationNode(baseState, replayed.state, mask, planEntries, localClusterIndexes, score);
          nextNode.confluenceKey = buildConfluenceKey(simulator, replayed.state, mask);
          if (diagnostics) diagnostics.foundationDpStates = Number(diagnostics.foundationDpStates || 0) + 1;
          const accepted = insertNode(nextBuckets, nextNode, options, diagnostics, { countDominance: true });
          if (!accepted) return;
          if (localClusterIndexes.length >= 2) {
            insertNode(resultBuckets, nextNode, options, null, { countDominance: false });
          }
        });
      });
    }
    frontier = pruneFrontier(
      baseState,
      flattenBuckets(nextBuckets),
      { ...options, frontierLimit: Number(options.foundationFrontierLimit || DEFAULT_OPTIONS.foundationFrontierLimit) }
    );
  }

  const selected = selectFinalPlans(baseState, resultBuckets, {
    ...options,
    resultLimit: Number(options.foundationLimit || DEFAULT_OPTIONS.foundationLimit),
  });
  selected.forEach((plan) => {
    plan.foundation = true;
    plan.foundationRole = "foundation";
  });
  if (diagnostics) diagnostics.foundationPlansSelected = Number(diagnostics.foundationPlansSelected || 0) + selected.length;
  return selected;
}

function searchResourceClusterPlans(simulator, baseState, initialActions, providedOptions) {
  const options = { ...DEFAULT_OPTIONS, ...(providedOptions || {}) };
  const diagnostics = options.diagnostics || null;
  if (diagnostics) diagnostics.clustersEnumerated += 1;
  const actionIndex = createActionIndex(simulator, baseState, initialActions, options);
  const root = {
    state: cloneState(baseState),
    mask: 0,
    confluenceKey: buildConfluenceKey(simulator, baseState, 0),
    planEntries: [],
    planKeys: new Set(),
    depth: 0,
    score: 0,
    dominatedPlans: 0,
  };
  let frontier = [root];
  const resultBuckets = new Map();
  let expanded = 0;

  for (let depth = 0; depth < Number(options.maxDepth || DEFAULT_OPTIONS.maxDepth) && frontier.length > 0; depth += 1) {
    const nextBuckets = new Map();
    for (const node of frontier) {
      if (expanded >= Number(options.maxNodes || DEFAULT_OPTIONS.maxNodes)) break;
      expanded += 1;
      const candidates = enumerateCandidates(simulator, baseState, node, initialActions, actionIndex, options);
      candidates.forEach((candidate) => {
        const fingerprint = actionFingerprint(simulator, candidate.action);
        const planKeys = new Set(node.planKeys);
        planKeys.add(fingerprint);
        const nextNode = {
          state: candidate.nextState,
          mask: candidate.nextMask,
          confluenceKey: buildConfluenceKey(simulator, candidate.nextState, candidate.nextMask),
          planEntries: node.planEntries.concat([normalizeStep(simulator, candidate.action)]),
          planKeys,
          depth: node.depth + 1,
          dominatedPlans: 0,
        };
        nextNode.score = scoreDelta(summarizeDelta(baseState, nextNode.state)) + number(hero(nextNode.state).hp) * 0.1 - nextNode.depth * 100;
        if (diagnostics) diagnostics.dpStates += 1;
        const accepted = insertNode(nextBuckets, nextNode, options, diagnostics, { countDominance: true });
        if (!accepted) return;
        if (isUsefulResult(baseState, nextNode, options)) {
          insertNode(resultBuckets, nextNode, options, null, { countDominance: false });
        }
      });
    }
    frontier = pruneFrontier(baseState, flattenBuckets(nextBuckets), options);
  }

  const plans = selectFinalPlans(baseState, resultBuckets, options);
  plans.expanded = expanded;
  plans.diagnostics = diagnostics;
  return plans;
}

function clusterLabel(planEntries) {
  const labels = (planEntries || []).map((entry) => entry.clusterLabel).filter(Boolean);
  if (labels.length === planEntries.length && labels.every((label) => String(label).length <= 3)) return labels.join("");
  const source = (planEntries || []).map((entry) => entry.clusterActionId || entry.fingerprint || entry.summary || entry.kind || "").join("|");
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) >>> 0;
  }
  return `${(planEntries || []).length}steps:${hash.toString(36)}`;
}

function buildResourceClusterActions(baseState, plans) {
  const actions = (plans || []).map((planNode) => {
    const delta = summarizeDelta(baseState, planNode.state);
    const stateHero = hero(planNode.state);
    const planEntries = planNode.planEntries || [];
    const confluenceKey = planNode.confluenceKey;
    const label = clusterLabel(planEntries);
    const role = planNode.foundationRole || "bestHp";
    return {
      kind: "resourceCluster",
      floorId: baseState.floorId,
      path: [],
      plan: planEntries.map((entry) => entry.summary),
      planEntries,
      estimate: {
        ...delta,
        damage: Math.max(0, number(hero(baseState).hp) - number(stateHero.hp)),
        hpAfter: number(stateHero.hp),
        confluenceKey,
        mask: Number(planNode.mask || 0),
        representativeRole: planNode.representativeRole || "highestHp",
        dominatedPlans: number(planNode.dominatedPlans),
        skylineSize: number(planNode.skylineSize),
        foundationClusters: Array.isArray(planNode.localClusterIndexes) ? planNode.localClusterIndexes.length : null,
        localClusterIndexes: planNode.localClusterIndexes,
        rejectedByClusterDominance: number((plans.diagnostics || {}).skylineRejected),
        replacedByClusterDominance: number((plans.diagnostics || {}).skylineReplaced),
        score: number(planNode.score),
        stopReasons: stopReasonsForDelta(delta),
      },
      summary: `resourceCluster:${baseState.floorId}:${label}:${role}`,
    };
  });
  if (plans && plans.diagnostics) {
    plans.diagnostics.actionsOutput += actions.length;
    plans.diagnostics.foundationActionsOutput = Number(plans.diagnostics.foundationActionsOutput || 0) +
      (plans || []).filter((planNode) => planNode && planNode.foundation).length;
  }
  return actions;
}

function enumerateResourceClusterActions(simulator, state, initialActions, providedOptions) {
  const options = { ...DEFAULT_OPTIONS, ...(providedOptions || {}) };
  const diagnostics = options.diagnostics || null;
  const localClusters = detectLocalActionClusters(simulator, state, initialActions, options);
  if (diagnostics) {
    diagnostics.localClustersDetected = Number(diagnostics.localClustersDetected || 0) + localClusters.length;
    diagnostics.localClusterMaxSize = Math.max(
      Number(diagnostics.localClusterMaxSize || 0),
      ...localClusters.map((cluster) => (cluster.actions || []).length)
    );
  }
  const allPlans = [];
  const perClusterPlans = [];
  localClusters.forEach((cluster) => {
    const plans = searchResourceClusterPlans(simulator, state, cluster.actions, {
      ...options,
      clusterRegion: cluster.region,
    });
    plans.forEach((plan) => {
      plan.localClusterIndexes = [perClusterPlans.length];
    });
    perClusterPlans.push({ clusterIndex: perClusterPlans.length, plans });
    allPlans.push(...plans);
  });
  if (options.composeLocalClusters !== false) {
    const foundationPlans = composeLocalClusterFoundationPlans(simulator, state, perClusterPlans, options);
    allPlans.push(...foundationPlans);
  }
  allPlans.sort((left, right) => compareNodes(state, left, right));
  const selectedPlans = allPlans.slice(0, Number(options.maxOutputActions || DEFAULT_OPTIONS.maxOutputActions));
  selectedPlans.diagnostics = diagnostics;
  return buildResourceClusterActions(state, selectedPlans);
}

module.exports = {
  actionCoordinates,
  clusterActionId,
  detectLocalActionClusters,
  buildConfluenceKey,
  buildResourceClusterActions,
  enumerateResourceClusterActions,
  insertClusterSkyline,
  searchResourceClusterPlans,
};
