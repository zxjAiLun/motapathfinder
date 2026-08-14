"use strict";

const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");
const { recordedActionVariantIdentity, resolveRecordedAction } = require("./route-store");

const CONNECTOR_SCHEMA = "motapathfinder.strategic-connector.v1";

const RESOLVED = "resolved";
const BUDGET_EXHAUSTED = "budget-exhausted";
const FRONTIER_EXHAUSTED = "frontier-exhausted";
const FRONTIER_TRIMMED = "frontier-trimmed";

const FAILURE_CODES = {
  [BUDGET_EXHAUSTED]: "expansion-budget-exhausted",
  [FRONTIER_EXHAUSTED]: "no-legal-chain-within-depth",
  [FRONTIER_TRIMMED]: "frontier-cap-trimmed",
};

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactAction(action) {
  if (!action) return null;
  return {
    kind: action.kind || null,
    summary: action.summary || null,
    floorId: action.floorId || (action.travelState && action.travelState.floorId) || null,
    x: action.x != null ? action.x : ((action.target || {}).x != null ? action.target.x : null),
    y: action.y != null ? action.y : ((action.target || {}).y != null ? action.target.y : null),
  };
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
 * Build a `choice` connector target for a POI (item/enemy/door/portal).
 * `matches` returns true for a primitive action that executes this POI.
 */
function buildPoiChoiceTarget(choiceKey, poi) {
  const floorId = poi && poi.floorId;
  const x = poi && poi.x != null ? poi.x : null;
  const y = poi && poi.y != null ? poi.y : null;
  return {
    type: "choice",
    choiceKey,
    matches: (action) => {
      if (!action) return false;
      const actionFloor = action.floorId || (action.travelState && action.travelState.floorId);
      const actionX = action.x != null ? action.x : ((action.target || {}).x);
      const actionY = action.y != null ? action.y : ((action.target || {}).y);
      return actionFloor === floorId && Number(actionX) === Number(x) && Number(actionY) === Number(y);
    },
  };
}

/**
 * Build a `choice` connector target for a boss-defeat terminal goal.
 */
function buildTerminalChoiceTarget(terminalGoal) {
  return {
    type: "choice",
    choiceKey: `terminal-boss:${terminalGoal.floorId}:${terminalGoal.x},${terminalGoal.y}`,
    matches: (action) => {
      if (!action || action.kind !== "battle") return false;
      const floorId = action.floorId || (action.travelState && action.travelState.floorId);
      const x = action.x != null ? action.x : ((action.target || {}).x);
      const y = action.y != null ? action.y : ((action.target || {}).y);
      return floorId === terminalGoal.floorId &&
        Number(x) === Number(terminalGoal.x) &&
        Number(y) === Number(terminalGoal.y);
    },
  };
}

function buildGoalPredicateTarget(choiceKey, predicate) {
  return { type: "goalPredicate", choiceKey, predicate };
}

/**
 * Bounded local connector. From an exact source state, search primitive
 * actions (reusing the simulator's own enumeration/application, i.e. the same
 * reachability layer the strategic frontier already trusts) until either:
 *
 *   - `target.matches(action)` is directly enumerable, and applying it is
 *     legal (choice target), or
 *   - `target.predicate(state)` becomes true (goalPredicate target).
 *
 * The returned chain is fully replayable and the exact post state is bound to
 * `postExactStateKey`. Failure is classified, never thrown as a crash.
 */
function runLocalConnector(options) {
  const config = options || {};
  const simulator = config.simulator;
  const sourceState = config.sourceState;
  const target = config.target;
  if (!simulator || !sourceState || !target) {
    throw new Error("runLocalConnector requires simulator, sourceState, and target");
  }
  const keyState = typeof config.keyState === "function" ? config.keyState : buildStateKey;
  const copyState = typeof config.copyState === "function" ? config.copyState : cloneState;
  const maxExpansions = Math.max(1, number(config.maxExpansions, 256));
  const maxDepth = Math.max(1, number(config.maxDepth, 12));
  const maxFrontier = config.maxFrontier == null ? 4096 : Math.max(1, number(config.maxFrontier, 4096));
  const includeFloorFly = config.includeFloorFly === true;

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

  const finish = (status, extra) => ({
    schema: CONNECTOR_SCHEMA,
    status,
    failure: status === RESOLVED ? null : {
      code: FAILURE_CODES[status] || "unknown",
      reason: status === FRONTIER_EXHAUSTED
        ? "no-legal-chain-within-depth"
        : status === FRONTIER_TRIMMED
          ? "frontier-cap-trimmed"
          : "expansion-budget-exhausted",
    },
    choiceKey: target.choiceKey || null,
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

    if (target.type === "goalPredicate" && typeof target.predicate === "function") {
      if (target.predicate(item.state)) {
        return finish(RESOLVED, {
          postExactStateKey: item.key,
          chain: item.chain,
          edges: item.edges,
          chainSummary: item.chain.map(compactAction),
          reachedViaMatchingAction: false,
        });
      }
    }

    let actions;
    try {
      actions = simulator.enumeratePrimitiveActions(item.state).actions || [];
    } catch (_error) {
      applyErrors += 1;
      continue;
    }

    if (item.chain.length < maxDepth && target.type === "choice" && typeof target.matches === "function") {
      const matchingActions = actions
        .filter((action) => target.matches(action))
        .sort((left, right) =>
          recordedActionVariantIdentity(left).localeCompare(recordedActionVariantIdentity(right)));
      for (const matching of matchingActions) {
        let postState;
        try {
          postState = simulator.applyAction(item.state, matching, { storeRoute: false });
        } catch (_error) {
          applyErrors += 1;
          // The choice is enumerable but not actually executable from this
          // exact state; keep searching for a state where it is legal.
        }
        if (postState) {
          postState.route = [];
          const postKey = keyState(postState);
          const chain = item.chain.concat([matching]);
          const edges = item.edges.concat([
            buildEdge(simulator, matching, item.key, postKey),
          ]);
          return finish(RESOLVED, {
            postExactStateKey: postKey,
            chain,
            edges,
            chainSummary: chain.map(compactAction),
            reachedViaMatchingAction: true,
            matchingAction: compactAction(matching),
          });
        }
      }
    }

    if (item.chain.length >= maxDepth) continue;
    for (const action of actions) {
      if (!includeFloorFly && action.kind === "floorFly") continue;
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

  const status = queue.length > 0
    ? BUDGET_EXHAUSTED
    : frontierTrimmed > 0
      ? FRONTIER_TRIMMED
      : FRONTIER_EXHAUSTED;
  return finish(status, {
    frontierSize: queue.length,
  });
}

/**
 * Exact-replay legality check. Each edge is re-resolved from the current
 * replay state; stored travelState objects are evidence, never replay input.
 */
function verifyConnectorChain(simulator, sourceState, connectorOrEdges, options) {
  const config = options || {};
  const keyState = typeof config.keyState === "function" ? config.keyState : buildStateKey;
  const copyState = typeof config.copyState === "function" ? config.copyState : cloneState;
  const edges = Array.isArray(connectorOrEdges)
    ? connectorOrEdges
    : ((connectorOrEdges && connectorOrEdges.edges) || []);
  const expectedFinalKey = config.expectedPostExactStateKey ||
    (connectorOrEdges && connectorOrEdges.postExactStateKey) || null;
  let state = copyState(sourceState);
  state.route = [];
  const applied = [];
  const replaySteps = [];
  for (const edge of edges) {
    const currentKey = keyState(state);
    if (!edge || !edge.action || currentKey !== edge.preExactStateKey) {
      return {
        valid: false,
        postExactStateKey: null,
        appliedSummaries: applied.map(compactAction),
        failureReason: !edge || !edge.action
          ? "missing-edge-contract"
          : "pre-exact-state-mismatch",
      };
    }
    const decision = {
      ...edge.action,
      fingerprint: edge.fingerprint ||
        (typeof simulator.getActionFingerprint === "function"
          ? simulator.getActionFingerprint(edge.action)
          : null),
      postExactStateKey: edge.postExactStateKey,
    };
    const resolved = resolveRecordedAction(simulator, state, decision, {
      deferStructuralFilterUntilAfterApply: true,
      postExactStateKeyBuilder: keyState,
    });
    if (!resolved.action || !resolved.resolvedPostState ||
        resolved.postExactStateKey !== edge.postExactStateKey) {
      return {
        valid: false,
        postExactStateKey: null,
        appliedSummaries: applied.map(compactAction),
        failureReason: resolved.reason || "recorded-edge-not-resolved",
      };
    }
    state = resolved.resolvedPostState;
    state.route = [];
    applied.push(resolved.action);
    replaySteps.push({
      action: resolved.action,
      state,
      preExactStateKey: edge.preExactStateKey,
      postExactStateKey: edge.postExactStateKey,
    });
  }
  const postExactStateKey = keyState(state);
  const result = {
    valid: !expectedFinalKey || postExactStateKey === expectedFinalKey,
    postExactStateKey,
    appliedSummaries: applied.map(compactAction),
    failureReason: expectedFinalKey && postExactStateKey !== expectedFinalKey
      ? "final-exact-state-mismatch"
      : null,
  };
  Object.defineProperty(result, "replaySteps", { value: replaySteps, enumerable: false });
  Object.defineProperty(result, "finalState", { value: state, enumerable: false });
  return result;
}

module.exports = {
  CONNECTOR_SCHEMA,
  BUDGET_EXHAUSTED,
  FRONTIER_EXHAUSTED,
  FRONTIER_TRIMMED,
  RESOLVED,
  buildGoalPredicateTarget,
  buildPoiChoiceTarget,
  buildTerminalChoiceTarget,
  compactAction,
  runLocalConnector,
  verifyConnectorChain,
};
