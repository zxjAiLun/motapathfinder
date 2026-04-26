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
  clusterRepresentatives: 3,
};

const CLUSTER_ACTION_KINDS = new Set(["battle", "pickup", "equip", "event"]);

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

function actionFingerprint(simulator, action) {
  if (!action) return "";
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

function isUsefulClusterCandidate(baseState, currentState, action, nextState) {
  const stepScore = scoreDelta(summarizeDelta(currentState, nextState));
  const totalScore = scoreDelta(summarizeDelta(baseState, nextState));
  if (stepScore > 0 || totalScore > 0) return true;
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

function buildBucketKey(mask, confluenceKey) {
  return JSON.stringify({ mask: Number(mask || 0), confluenceKey });
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
      if (!isUsefulClusterCandidate(baseState, node.state, action, nextState)) return null;
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
  const source = (planEntries || []).map((entry) => entry.fingerprint || entry.summary || entry.kind || "").join("|");
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
        rejectedByClusterDominance: number((plans.diagnostics || {}).skylineRejected),
        replacedByClusterDominance: number((plans.diagnostics || {}).skylineReplaced),
        score: number(planNode.score),
      },
      summary: `resourceCluster:${baseState.floorId}:${label}:bestHp`,
    };
  });
  if (plans && plans.diagnostics) plans.diagnostics.actionsOutput += actions.length;
  return actions;
}

function enumerateResourceClusterActions(simulator, state, initialActions, providedOptions) {
  const plans = searchResourceClusterPlans(simulator, state, initialActions, providedOptions);
  return buildResourceClusterActions(state, plans);
}

module.exports = {
  buildConfluenceKey,
  buildResourceClusterActions,
  enumerateResourceClusterActions,
  insertClusterSkyline,
  searchResourceClusterPlans,
};
