"use strict";

const { buildStateKey } = require("./state-key");
const { cloneState } = require("./state");
const { terminalBattleProjection } = require("./strategic-transition");

const BLOCKER_CONNECTOR_SCHEMA = "motapathfinder.strategic-blocker-connector.v1";

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

/**
 * Structured terminal-blocker reading. A blocked terminal battle is not a
 * binary "unbeatable"; it is a named dependency on one or more intermediate
 * properties (attack, survival). `attack-blocked` means the boss is not yet
 * damageable because ATK is below the boss DEF; `lethal` means the battle is
 * damageable but the hero would not survive.
 */
function analyzeTerminalBlocker(simulator, state, terminalGoal) {
  const projection = terminalBattleProjection(simulator, state, terminalGoal);
  if (!projection) {
    return {
      stage: "unsupported",
      attackMargin: null,
      survivalMargin: null,
      progressScore: null,
      supported: false,
    };
  }
  return {
    stage: projection.stage,
    attackMargin: projection.attackMargin,
    survivalMargin: projection.margin,
    progressScore: projection.progressScore,
    supported: projection.supported,
  };
}

function intermediateKind(stage) {
  if (stage === "attack-blocked") return "combat-power";
  if (stage === "lethal") return "survival";
  return "none";
}

function defaultMetric(simulator, state, terminalGoal) {
  const projection = terminalBattleProjection(simulator, state, terminalGoal);
  return projection && projection.progressScore != null ? projection.progressScore : -Infinity;
}

function buildEdge(simulator, action, preKey, postKey) {
  return {
    action,
    fingerprint: typeof simulator.getActionFingerprint === "function"
      ? simulator.getActionFingerprint(action)
      : null,
    preExactStateKey: preKey,
    postExactStateKey: postKey,
  };
}

/**
 * Blocker-derived intermediate connector.
 *
 * Instead of asking "connect me directly to the terminal action", it reads the
 * current terminal blocker, derives an intermediate metric (raise combat power
 * when attack-blocked, raise survival when lethal), and runs a bounded local
 * primitive search that *maximizes* that metric. The returned chain is the best
 * intermediate state reachable within budget, together with the terminal
 * blocker re-evaluated on that state.
 *
 * `config.metric` is injectable for synthetic controls; it defaults to the
 * terminal battle progress score, so the search optimizes the same quantity the
 * strategic agenda already ranks.
 */
function runBlockerDerivedConnector(options) {
  const config = options || {};
  const simulator = config.simulator;
  const sourceState = config.sourceState;
  const terminalGoal = config.terminalGoal;
  if (!simulator || !sourceState || !terminalGoal) {
    throw new Error("runBlockerDerivedConnector requires simulator, sourceState, and terminalGoal");
  }
  const keyState = typeof config.keyState === "function" ? config.keyState : buildStateKey;
  const copyState = typeof config.copyState === "function" ? config.copyState : cloneState;
  const metric = typeof config.metric === "function"
    ? config.metric
    : (state) => defaultMetric(simulator, state, terminalGoal);
  const maxExpansions = Math.max(1, number(config.maxExpansions, 128));
  const maxDepth = Math.max(1, number(config.maxDepth, 8));
  const maxFrontier = config.maxFrontier == null ? 4096 : Math.max(1, number(config.maxFrontier, 4096));

  const startedAt = Date.now();
  const beforeBlocker = analyzeTerminalBlocker(simulator, sourceState, terminalGoal);
  const targetKind = intermediateKind(beforeBlocker.stage);
  const rootState = copyState(sourceState);
  rootState.route = [];
  const rootKey = keyState(rootState);
  const rootScore = metric(rootState);
  const seenExact = new Set([rootKey]);
  const queue = [{ state: rootState, key: rootKey, chain: [], edges: [] }];
  let best = { state: rootState, key: rootKey, chain: [], edges: [], score: rootScore };
  let expansions = 0;
  let generated = 0;
  let applyErrors = 0;
  let frontierTrimmed = 0;

  while (queue.length > 0 && expansions < maxExpansions) {
    const item = queue.shift();
    expansions += 1;
    const score = metric(item.state);
    if (score > best.score) {
      best = { state: item.state, key: item.key, chain: item.chain, edges: item.edges, score };
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
      if (action.kind === "floorFly") continue;
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
      seenExact.add(key);
      generated += 1;
      if (queue.length >= maxFrontier) {
        frontierTrimmed += 1;
        continue;
      }
      queue.push({
        state: nextState,
        key,
        chain: item.chain.concat([action]),
        edges: item.edges.concat([buildEdge(simulator, action, item.key, key)]),
      });
    }
  }

  const afterBlocker = analyzeTerminalBlocker(simulator, best.state, terminalGoal);
  const improved = best.score > rootScore;
  const stoppedReason = queue.length > 0
    ? "budget-exhausted"
    : frontierTrimmed > 0
      ? "frontier-trimmed"
      : "frontier-exhausted";
  return {
    schema: BLOCKER_CONNECTOR_SCHEMA,
    status: improved ? "improved" : "no-improvement",
    stoppedReason,
    frontierExhausted: stoppedReason === "frontier-exhausted",
    targetKind,
    beforeBlocker,
    afterBlocker,
    blockerProgressDelta: afterBlocker.progressScore != null && beforeBlocker.progressScore != null
      ? afterBlocker.progressScore - beforeBlocker.progressScore
      : null,
    bestScore: best.score,
    sourceExactStateKey: rootKey,
    postExactStateKey: best.key,
    chain: best.chain,
    edges: best.edges,
    chainSummary: best.chain.map(compactAction),
    expansions,
    generated,
    applyErrors,
    frontierTrimmed,
    frontierSize: queue.length,
    wallMs: Date.now() - startedAt,
  };
}

module.exports = {
  BLOCKER_CONNECTOR_SCHEMA,
  analyzeTerminalBlocker,
  intermediateKind,
  runBlockerDerivedConnector,
};
