"use strict";

const crypto = require("node:crypto");

const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");
const { recordedActionVariantIdentity } = require("./route-store");
const { tileDefinitionAt } = require("./strategic-option-map");
const { analyzeTerminalBlocker, intermediateKind } = require("./strategic-blocker");

const DEPENDENCY_SCHEMA = "motapathfinder.strategic-dependency.v1";
const DEPENDENCY_CONNECTOR_SCHEMA = "motapathfinder.strategic-dependency-connector.v1";

const DEPENDENCY_KINDS = new Set([
  "equipment-acquisition",
  "resource/power-opportunity-acquisition",
]);

const EVIDENCE_ACTION_KINDS = new Set(["pickup", "interactPickup", "equip", "battle"]);

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function compactAction(action) {
  if (!action) return null;
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    floorId: action.floorId || (action.travelState && action.travelState.floorId) || null,
    x: action.x != null ? action.x : ((action.target || {}).x != null ? action.target.x : null),
    y: action.y != null ? action.y : ((action.target || {}).y != null ? action.target.y : null),
    itemId: action.itemId || action.equipId || null,
  };
}

function projectionImproves(before, after) {
  if (!before || !after) return false;
  const beforeScore = before.progressScore;
  const afterScore = after.progressScore;
  return beforeScore != null && afterScore != null && afterScore > beforeScore;
}

function projectionDelta(before, after) {
  if (!before || !after) return null;
  return {
    stage: {
      before: before.stage || null,
      after: after.stage || null,
    },
    attackMargin: before.attackMargin != null && after.attackMargin != null
      ? number(after.attackMargin, 0) - number(before.attackMargin, 0)
      : null,
    survivalMargin: before.survivalMargin != null && after.survivalMargin != null
      ? number(after.survivalMargin, 0) - number(before.survivalMargin, 0)
      : null,
    progressScore: before.progressScore != null && after.progressScore != null
      ? number(after.progressScore, 0) - number(before.progressScore, 0)
      : null,
  };
}

function actionLocation(action) {
  if (!action) return { floorId: null, x: null, y: null };
  return {
    floorId: action.floorId || (action.travelState && action.travelState.floorId) || null,
    x: action.x != null ? action.x : ((action.target || {}).x != null ? action.target.x : null),
    y: action.y != null ? action.y : ((action.target || {}).y != null ? action.target.y : null),
  };
}

function tileConsumedByAction(project, state, action) {
  const location = actionLocation(action);
  if (!location.floorId || location.x == null || location.y == null) return false;
  const tile = tileDefinitionAt(project, state, location.floorId, location.x, location.y);
  const expectedId = action.itemId || action.enemyId || action.equipId || null;
  if (expectedId) return !tile || tile.id !== expectedId;
  return !tile;
}

function buildCompletionPredicate(options) {
  const { project, simulator, terminalGoal, beforeBlocker } = options;
  const target = options.target;
  const kind = options.kind;

  return function dependencyCompletionPredicate(state) {
    const afterBlocker = analyzeTerminalBlocker(simulator, state, terminalGoal);
    if (!projectionImproves(beforeBlocker, afterBlocker)) return false;

    if (kind === "equipment-acquisition") {
      const slot = target.equipType;
      const equipment = Array.isArray((state.hero || {}).equipment) ? state.hero.equipment : [];
      return slot != null && equipment[slot] === target.equipId;
    }

    if (!target.floorId || target.x == null || target.y == null) return false;
    const tile = tileDefinitionAt(project, state, target.floorId, target.x, target.y);
    if (target.itemId) return !tile || tile.id !== target.itemId;
    if (target.enemyId) return !tile || tile.id !== target.enemyId;
    return !tile;
  };
}

function targetSignature(target) {
  return [
    target.type || "target",
    target.mechanism || "direct",
    target.equipId || target.itemId || target.enemyId || "",
    target.floorId || "",
    target.x == null ? "" : target.x,
    target.y == null ? "" : target.y,
  ].join("|");
}

function dependencyId(kind, capability, target) {
  return hash(`${kind}|${capability}|${targetSignature(target)}`);
}

function buildDependencyCandidate(options) {
  const {
    project,
    simulator,
    terminalGoal,
    beforeBlocker,
    afterBlocker,
    action,
    sourceState,
  } = options;
  const kind = action.kind;
  if (!EVIDENCE_ACTION_KINDS.has(kind) || !projectionImproves(beforeBlocker, afterBlocker)) return null;

  const location = actionLocation(action);
  const capability = intermediateKind(beforeBlocker.stage);
  let dependencyKind;
  let target;
  if (kind === "equip") {
    dependencyKind = "equipment-acquisition";
    target = {
      type: "equip-item",
      mechanism: "inventory-equip-action",
      equipId: action.equipId || action.itemId || null,
      equipType: action.equipType != null ? action.equipType : null,
    };
  } else if (kind === "pickup" || kind === "interactPickup") {
    dependencyKind = "resource/power-opportunity-acquisition";
    target = {
      type: "acquire-option",
      mechanism: kind,
      floorId: location.floorId,
      x: location.x,
      y: location.y,
      itemId: action.itemId || null,
    };
  } else {
    dependencyKind = "resource/power-opportunity-acquisition";
    target = {
      type: "acquire-option",
      mechanism: "battle",
      floorId: location.floorId,
      x: location.x,
      y: location.y,
      enemyId: action.enemyId || (action.target && action.target.enemyId) || null,
    };
  }

  const id = dependencyId(dependencyKind, capability, target);
  return {
    schema: DEPENDENCY_SCHEMA,
    id,
    kind: dependencyKind,
    capability,
    blockerStage: beforeBlocker.stage || null,
    target,
    completion: {
      type: dependencyKind === "equipment-acquisition" ? "equipped" : "target-option-consumed",
      recheckTerminalBlocker: true,
    },
    provenance: {
      source: options.reachableAtCompileTime === false
        ? "option-map-unreachable-counterfactual"
        : "simulator-enumerated-action-counterfactual",
      expectedCapabilityDelta: projectionDelta(beforeBlocker, afterBlocker),
      sourceAction: compactAction(action),
      sourceExactStateFingerprint: sourceState
        ? (() => {
            try {
              return hash(buildStateKey(sourceState));
            } catch (_error) {
              return hash(JSON.stringify(sourceState));
            }
          })()
        : null,
      reachableAtCompileTime: options.reachableAtCompileTime !== false,
      knownRouteUsed: false,
      authoredIdUsed: false,
    },
    beforeBlocker,
    afterBlocker,
    completionPredicate: buildCompletionPredicate({
      project,
      simulator,
      terminalGoal,
      beforeBlocker,
      target,
      kind: dependencyKind,
    }),
  };
}

function enumerateEvidenceActions(simulator, state) {
  const primitive = simulator && simulator.enumeratePrimitiveActions
    ? (simulator.enumeratePrimitiveActions(state).actions || [])
    : [];
  const interact = simulator && simulator.enumerateInteractPickupActions
    ? (simulator.enumerateInteractPickupActions(state) || [])
    : [];
  const byVariant = new Map();
  primitive.concat(interact).forEach((action) => {
    if (!action || !EVIDENCE_ACTION_KINDS.has(action.kind)) return;
    const key = recordedActionVariantIdentity(action);
    if (!byVariant.has(key)) byVariant.set(key, action);
  });
  return Array.from(byVariant.values());
}

/**
 * Standalone terminal-dependency compiler. It does not use an item dictionary
 * or a known route: every candidate is derived by applying a real
 * simulator-enumerated action to a counterfactual clone and re-evaluating the
 * terminal battle blocker on the resulting exact state.
 */
function compileTerminalDependencies(options) {
  const config = options || {};
  const { project, simulator, state, terminalGoal } = config;
  if (!project || !simulator || !state || !terminalGoal) {
    throw new Error("compileTerminalDependencies requires project, simulator, state, and terminalGoal");
  }
  const beforeBlocker = analyzeTerminalBlocker(simulator, state, terminalGoal);
  if (!["attack-blocked", "lethal"].includes(beforeBlocker.stage)) return [];

  const actions = enumerateEvidenceActions(simulator, state);
  const candidatesByTarget = new Map();
  let applyErrors = 0;
  for (const action of actions) {
    let afterState;
    try {
      afterState = simulator.applyAction(state, action, { storeRoute: false });
    } catch (_error) {
      applyErrors += 1;
      continue;
    }
    afterState.route = [];
    const afterBlocker = analyzeTerminalBlocker(simulator, afterState, terminalGoal);
    if (!projectionImproves(beforeBlocker, afterBlocker)) continue;
    const candidate = buildDependencyCandidate({
      project,
      simulator,
      terminalGoal,
      beforeBlocker,
      afterBlocker,
      action,
      sourceState: state,
    });
    if (!candidate) continue;
    const signature = targetSignature(candidate.target);
    const existing = candidatesByTarget.get(signature);
    const score = candidate.provenance.expectedCapabilityDelta &&
      candidate.provenance.expectedCapabilityDelta.progressScore != null
      ? candidate.provenance.expectedCapabilityDelta.progressScore
      : 0;
    if (!existing || score > existing.provenance.expectedCapabilityDelta.progressScore) {
      candidatesByTarget.set(signature, candidate);
    }
  }
  return Array.from(candidatesByTarget.values())
    .sort((left, right) => {
      const leftScore = left.provenance.expectedCapabilityDelta.progressScore || 0;
      const rightScore = right.provenance.expectedCapabilityDelta.progressScore || 0;
      return rightScore - leftScore || left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(1, number(config.maxCandidates, 6)))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      applyErrors,
      actionsProbed: actions.length,
    }));
}

function counterfactualActionForOption(entry) {
  const location = {
    floorId: entry.floorId,
    x: Number(entry.x),
    y: Number(entry.y),
  };
  if (entry.kind === "item") {
    return {
      kind: "pickup",
      floorId: location.floorId,
      x: location.x,
      y: location.y,
      itemId: entry.tileId || null,
      target: { x: location.x, y: location.y, itemId: entry.tileId || null },
      stance: { x: location.x, y: location.y },
      direction: null,
      path: [],
      summary: `counterfactual-pickup:${entry.tileId || "item"}@${location.floorId}:${location.x},${location.y}`,
    };
  }
  return {
    kind: "battle",
    floorId: location.floorId,
    x: location.x,
    y: location.y,
    enemyId: entry.tileId || null,
    target: { x: location.x, y: location.y, enemyId: entry.tileId || null },
    stance: { x: location.x, y: location.y },
    direction: null,
    path: [],
    summary: `counterfactual-battle:${entry.tileId || "enemy"}@${location.floorId}:${location.x},${location.y}`,
  };
}

/**
 * Compiler for option-map entries that are currently not reachable. The
 * one-step projection evidence is counterfactual (the clone is placed on the
 * target tile), so the expected delta is explicitly marked
 * `reachableAtCompileTime:false`; the dependency connector must still find a
 * legal primitive chain and strict-replay it before anything is counted.
 */
function compileUnreachableTerminalDependencies(options) {
  const config = options || {};
  const { project, simulator, state, terminalGoal, reachablePoi, optionMap } = config;
  if (!project || !simulator || !state || !terminalGoal || !optionMap) return [];
  const beforeBlocker = analyzeTerminalBlocker(simulator, state, terminalGoal);
  if (!["attack-blocked", "lethal"].includes(beforeBlocker.stage)) return [];

  const reachableKeys = new Set((reachablePoi && reachablePoi.entries || [])
    .map((entry) => entry.key));
  const candidatesByTarget = new Map();
  let applyErrors = 0;
  for (const entry of optionMap.entries || []) {
    if (!["item", "enemy"].includes(entry.kind)) continue;
    if (reachableKeys.has(entry.key)) continue;
    let afterState;
    try {
      afterState = cloneState(state);
      afterState.route = [];
      afterState.floorId = entry.floorId;
      afterState.hero.loc = {
        ...(afterState.hero.loc || {}),
        x: Number(entry.x),
        y: Number(entry.y),
      };
      if (!afterState.visitedFloors) afterState.visitedFloors = {};
      afterState.visitedFloors[entry.floorId] = true;
      const action = counterfactualActionForOption(entry);
      afterState = simulator.applyAction(afterState, action, { storeRoute: false });
    } catch (_error) {
      applyErrors += 1;
      continue;
    }
    afterState.route = [];
    const afterBlocker = analyzeTerminalBlocker(simulator, afterState, terminalGoal);
    if (!projectionImproves(beforeBlocker, afterBlocker)) continue;
    const candidate = buildDependencyCandidate({
      project,
      simulator,
      terminalGoal,
      beforeBlocker,
      afterBlocker,
      action: counterfactualActionForOption(entry),
      sourceState: state,
      reachableAtCompileTime: false,
    });
    if (!candidate) continue;
    const signature = targetSignature(candidate.target);
    const existing = candidatesByTarget.get(signature);
    const score = candidate.provenance.expectedCapabilityDelta &&
      candidate.provenance.expectedCapabilityDelta.progressScore != null
      ? candidate.provenance.expectedCapabilityDelta.progressScore
      : 0;
    if (!existing || score > (existing.provenance.expectedCapabilityDelta.progressScore || 0)) {
      candidatesByTarget.set(signature, candidate);
    }
  }
  return Array.from(candidatesByTarget.values())
    .sort((left, right) => {
      const leftScore = left.provenance.expectedCapabilityDelta.progressScore || 0;
      const rightScore = right.provenance.expectedCapabilityDelta.progressScore || 0;
      return rightScore - leftScore || left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(1, number(config.maxCandidates, 4)))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      applyErrors,
      optionsProbed: (optionMap.entries || []).length,
    }));
}

/**
 * Transition-based compiler used inside the strategic frontier. The strategic
 * aggregation layer has already applied every action and computed the
 * terminal-blocker delta; this function only re-packages real improved post
 * states into named dependencies, so the dependency compiler does not pay a
 * second apply+battle projection pass.
 */
function compileDependenciesFromTransitions(options) {
  const config = options || {};
  const { project, simulator, terminalGoal, state, transitions } = options;
  if (!project || !simulator || !terminalGoal || !state || !transitions) return [];
  const beforeBlocker = analyzeTerminalBlocker(simulator, state, terminalGoal);
  if (!["attack-blocked", "lethal"].includes(beforeBlocker.stage)) return [];

  const candidatesByTarget = new Map();
  for (const transition of transitions) {
    for (const post of transition.postStates || []) {
      const delta = post.terminalBlockerDelta;
      if (!delta || !delta.improved || !delta.after || !post.appliedBy) continue;
      const candidate = buildDependencyCandidate({
        project,
        simulator,
        terminalGoal,
        beforeBlocker: delta.before || beforeBlocker,
        afterBlocker: delta.after,
        action: post.appliedBy,
        sourceState: state,
      });
      if (!candidate) continue;
      const signature = targetSignature(candidate.target);
      const existing = candidatesByTarget.get(signature);
      const score = candidate.provenance.expectedCapabilityDelta &&
        candidate.provenance.expectedCapabilityDelta.progressScore != null
        ? candidate.provenance.expectedCapabilityDelta.progressScore
        : 0;
      if (!existing || score > (existing.provenance.expectedCapabilityDelta.progressScore || 0)) {
        candidatesByTarget.set(signature, candidate);
      }
    }
  }
  return Array.from(candidatesByTarget.values())
    .sort((left, right) => {
      const leftScore = left.provenance.expectedCapabilityDelta.progressScore || 0;
      const rightScore = right.provenance.expectedCapabilityDelta.progressScore || 0;
      return rightScore - leftScore || left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(1, number(config.maxCandidates, 6)))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      provenance: {
        ...candidate.provenance,
        source: "strategic-transition-applied-post-state",
      },
    }));
}

function buildEdge(simulator, action, preExactStateKey, postExactStateKey) {
  return {
    action,
    fingerprint: typeof simulator.getActionFingerprint === "function"
      ? simulator.getActionFingerprint(action)
      : null,
    preExactStateKey,
    postExactStateKey,
  };
}

/**
 * Bounded dependency connector. It is deliberately not a scalar optimizer:
 * the only success condition is the dependency completionPredicate becoming
 * true on an exact search state, after which the chain is returned for strict
 * re-resolution by the caller.
 */
function runDependencyConnector(options) {
  const config = options || {};
  const { simulator, sourceState, dependency } = config;
  if (!simulator || !sourceState || !dependency) {
    throw new Error("runDependencyConnector requires simulator, sourceState, and dependency");
  }
  const keyState = typeof config.keyState === "function" ? config.keyState : buildStateKey;
  const copyState = typeof config.copyState === "function" ? config.copyState : cloneState;
  const maxExpansions = Math.max(1, number(config.maxExpansions, 64));
  const maxDepth = Math.max(1, number(config.maxDepth, 8));
  const maxFrontier = config.maxFrontier == null ? 4096 : Math.max(1, number(config.maxFrontier, 4096));
  const predicate = typeof dependency.completionPredicate === "function"
    ? dependency.completionPredicate
    : null;
  if (!predicate) throw new Error("dependency.completionPredicate must be a function");

  const startedAt = Date.now();
  const rootState = copyState(sourceState);
  rootState.route = [];
  const rootKey = keyState(rootState);
  const seenExact = new Set([rootKey]);
  const queue = [{ state: rootState, key: rootKey, chain: [], edges: [] }];
  let expansions = 0;
  let generated = 0;
  let applyErrors = 0;
  let frontierTrimmed = 0;

  const finish = (status, stoppedReason, extra) => ({
    schema: DEPENDENCY_CONNECTOR_SCHEMA,
    status,
    stoppedReason,
    dependencyId: dependency.id || null,
    sourceExactStateKey: rootKey,
    postExactStateKey: null,
    chain: [],
    edges: [],
    chainSummary: [],
    expansions,
    generated,
    applyErrors,
    frontierTrimmed,
    frontierSize: queue.length,
    wallMs: Date.now() - startedAt,
    ...extra,
  });

  while (queue.length > 0 && expansions < maxExpansions) {
    const item = queue.shift();
    expansions += 1;

    let satisfied = false;
    try {
      satisfied = predicate(item.state);
    } catch (_error) {
      applyErrors += 1;
    }
    if (satisfied) {
      return finish("satisfied", "satisfied", {
        postExactStateKey: item.key,
        chain: item.chain,
        edges: item.edges,
        chainSummary: item.chain.map(compactAction),
      });
    }

    if (item.chain.length >= maxDepth) continue;
    let actions;
    try {
      actions = simulator.enumeratePrimitiveActions(item.state).actions || [];
    } catch (_error) {
      applyErrors += 1;
      continue;
    }
    for (const action of actions) {
      if (action && action.kind === "floorFly") continue;
      let nextState;
      try {
        nextState = simulator.applyAction(item.state, action, { storeRoute: false });
      } catch (_error) {
        applyErrors += 1;
        continue;
      }
      nextState.route = [];
      const key = keyState(nextState);
      if (seenExact.has(key)) continue;
      generated += 1;
      if (queue.length >= maxFrontier) {
        frontierTrimmed += 1;
        continue;
      }
      seenExact.add(key);
      queue.push({
        state: nextState,
        key,
        chain: item.chain.concat([action]),
        edges: item.edges.concat([buildEdge(simulator, action, item.key, key)]),
      });
    }
  }

  const stoppedReason = queue.length > 0
    ? "budget-exhausted"
    : frontierTrimmed > 0
      ? "frontier-trimmed"
      : "frontier-exhausted";
  return finish("not-satisfied", stoppedReason, {});
}

module.exports = {
  DEPENDENCY_CONNECTOR_SCHEMA,
  DEPENDENCY_KINDS,
  DEPENDENCY_SCHEMA,
  EVIDENCE_ACTION_KINDS,
  buildCompletionPredicate,
  compileDependenciesFromTransitions,
  compileTerminalDependencies,
  compileUnreachableTerminalDependencies,
  projectionDelta,
  projectionImproves,
  runDependencyConnector,
  targetSignature,
};
