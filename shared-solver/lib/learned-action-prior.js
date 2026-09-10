"use strict";

// PR-5.25c Phase 1 learned action prior: a small deterministic state-action MLP
// trained with a pairwise ranking objective, plus a held-out sanity gate and
// matched control/treatment rollouts.
//
// Frozen contract (docs/260908/5-25c.md, DESIGN_REPAIR_1):
//   MODEL              = small MLP state-action scorer (deterministic JS)
//   OBJECTIVE          = pairwise logistic ranking loss softplus(-(chosen-neg))
//   INFERENCE          = fixed-temperature softmax, TEMPERATURE = 1.0 only
//   OFFLINE_SANITY     = held-out chosen-action rank vs uniform baseline
//   PHASE_1_PRIMARY    = terminalRollouts > 0
//   MT4_MT5_REACH      = secondary behavioral signal only
// Prohibited and not implemented: behavior cloning / CE, temperature sweep,
// hard-negative mining, value head, PPO, self-play, MCGS integration, authored
// route rules, milestone/subgoal logic, solver/segment-DP changes.
//
// Every random draw uses a local seeded RNG.  `Math.random` is never called.

const { normalizeAction } = require("./route-store");

const FEATURE_SCHEMA = Object.freeze({
  version: "learned-action-prior.features.v1",
  note: "Fixed-order, decision-time-only features. No route ids, no future information, no authored policy rules.",
  actionKinds: Object.freeze([
    "battle",
    "pickup",
    "interactPickup",
    "openDoor",
    "useTool",
    "floorFly",
    "equip",
    "changeFloor",
    "event",
    "other",
  ]),
  directions: Object.freeze(["up", "down", "left", "right", "none"]),
  stateFeatures: Object.freeze([
    "hpRatio",
    "manaRatio",
    "atkNorm",
    "defNorm",
    "mdefNorm",
    "moneyNorm",
    "expNorm",
    "lvNorm",
    "inventoryDistinctNorm",
    "inventoryTotalNorm",
    "floorOrdinalNorm",
    "visitedFloorsNorm",
    "autoBattleFlag",
    "bias",
  ]),
  actionFeatures: Object.freeze([
    "kind.battle",
    "kind.pickup",
    "kind.interactPickup",
    "kind.openDoor",
    "kind.useTool",
    "kind.floorFly",
    "kind.equip",
    "kind.changeFloor",
    "kind.event",
    "kind.other",
    "pathLengthNorm",
    "direction.up",
    "direction.down",
    "direction.left",
    "direction.right",
    "direction.none",
    "targetDxNorm",
    "targetDyNorm",
    "estimate.damageNorm",
    "estimate.turnNorm",
    "estimate.moneyNorm",
    "estimate.expNorm",
    "hasEnemy",
    "hasItem",
    "hasDoor",
    "hasTarget",
  ]),
});

const STATE_FEATURE_COUNT = FEATURE_SCHEMA.stateFeatures.length;
const ACTION_FEATURE_COUNT = FEATURE_SCHEMA.actionFeatures.length;
const FEATURE_DIM = STATE_FEATURE_COUNT + ACTION_FEATURE_COUNT;

const DEFAULT_CONFIG = Object.freeze({
  hiddenDim: 16,
  epochs: 300,
  learningRate: 0.05,
  weightDecay: 0.0001,
  gradientClip: 5,
  temperature: 1.0,
  seed: 52501,
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function ratio(numerator, denominator) {
  const d = Number(denominator);
  if (!Number.isFinite(d) || d === 0) return 0;
  return clamp(Number(numerator) / d, 0, 1);
}

function floorOrdinal(floorId) {
  const match = /^MT(\d+)$/.exec(String(floorId || ""));
  return match ? Number(match[1]) : 0;
}

const MT4_ORDINAL = floorOrdinal("MT4");
const MT5_ORDINAL = floorOrdinal("MT5");

function actionKindIndex(kind) {
  const index = FEATURE_SCHEMA.actionKinds.indexOf(kind);
  return index === -1 ? FEATURE_SCHEMA.actionKinds.length - 1 : index;
}

function directionIndex(direction) {
  const index = FEATURE_SCHEMA.directions.indexOf(direction);
  return index === -1 ? FEATURE_SCHEMA.directions.length - 1 : index;
}

// Encode one decision-time (state, action) pair.  `state` is the live simulator
// state; `action` is a normalized route action (from normalizeAction).
function encodeFeatures(state, action) {
  const hero = state.hero || {};
  const inventory = state.inventory || {};
  const flags = state.flags || {};
  const normalized = action && action.fingerprint ? action : normalizeAction(action);
  const estimate = normalized.estimate || {};
  const target = normalized.target || null;
  const loc = hero.loc || {};

  const inventoryValues = Object.values(inventory);
  const inventoryTotal = inventoryValues.reduce((sum, value) => sum + (Number(value) || 0), 0);

  const stateFeatures = [
    ratio(hero.hp, hero.hpmax),
    ratio(hero.mana, hero.manamax),
    clamp(Number(hero.atk || 0) / 100, 0, 2),
    clamp(Number(hero.def || 0) / 100, 0, 2),
    clamp(Number(hero.mdef || 0) / 1000, 0, 2),
    clamp(Number(hero.money || 0) / 1000, 0, 2),
    clamp(Number(hero.exp || 0) / 100, 0, 2),
    clamp(Number(hero.lv || 0) / 50, 0, 2),
    clamp(inventoryValues.length / 20, 0, 2),
    clamp(inventoryTotal / 50, 0, 2),
    clamp(floorOrdinal(state.floorId) / 40, 0, 1),
    clamp(Object.keys(state.visitedFloors || {}).length / 10, 0, 2),
    flags.autoBattle ? 1 : 0,
    1,
  ];

  const kindIndex = actionKindIndex(normalized.kind);
  const kindOneHot = FEATURE_SCHEMA.actionKinds.map((unused, index) => (index === kindIndex ? 1 : 0));
  const dirIndex = directionIndex(normalized.direction);
  const dirOneHot = FEATURE_SCHEMA.directions.map((unused, index) => (index === dirIndex ? 1 : 0));
  const pathLength = Array.isArray(normalized.path) ? normalized.path.length : 0;

  const actionFeatures = [
    ...kindOneHot,
    clamp(pathLength / 20, 0, 1),
    ...dirOneHot,
    target ? clamp((Number(target.x) - Number(loc.x || 0)) / 20, -1, 1) : 0,
    target ? clamp((Number(target.y) - Number(loc.y || 0)) / 20, -1, 1) : 0,
    clamp(Number(estimate.damage || 0) / 2000, 0, 1),
    clamp(Number(estimate.turn || 0) / 100, 0, 1),
    clamp(Number(estimate.money || 0) / 500, 0, 1),
    clamp(Number(estimate.exp || 0) / 50, 0, 1),
    normalized.enemyId ? 1 : 0,
    normalized.itemId || normalized.equipId || normalized.tool ? 1 : 0,
    normalized.doorId ? 1 : 0,
    target ? 1 : 0,
  ];

  const vector = stateFeatures.concat(actionFeatures);
  if (vector.length !== FEATURE_DIM) {
    throw new Error(`feature vector length ${vector.length} !== FEATURE_DIM ${FEATURE_DIM}`);
  }
  return vector;
}

class DeterministicMlp {
  constructor(inputDim, hiddenDim, seed) {
    this.inputDim = inputDim;
    this.hiddenDim = hiddenDim;
    this.seed = seed;
    const rng = mulberry32(seed);
    const scale1 = 1 / Math.sqrt(inputDim);
    const scale2 = 1 / Math.sqrt(hiddenDim);
    this.w1 = Array.from({ length: hiddenDim }, () => (
      Array.from({ length: inputDim }, () => (rng() * 2 - 1) * scale1)
    ));
    this.b1 = new Array(hiddenDim).fill(0);
    this.w2 = Array.from({ length: hiddenDim }, () => (rng() * 2 - 1) * scale2);
    this.b2 = 0;
    this.resetGradients();
  }

  resetGradients() {
    this.gw1 = Array.from({ length: this.hiddenDim }, () => new Array(this.inputDim).fill(0));
    this.gb1 = new Array(this.hiddenDim).fill(0);
    this.gw2 = new Array(this.hiddenDim).fill(0);
    this.gb2 = 0;
  }

  forward(x) {
    const hidden = new Array(this.hiddenDim);
    for (let h = 0; h < this.hiddenDim; h += 1) {
      const row = this.w1[h];
      let z = this.b1[h];
      for (let i = 0; i < this.inputDim; i += 1) z += row[i] * x[i];
      hidden[h] = Math.tanh(z);
    }
    let score = this.b2;
    for (let h = 0; h < this.hiddenDim; h += 1) score += this.w2[h] * hidden[h];
    return { hidden, score };
  }

  score(x) {
    return this.forward(x).score;
  }

  // Accumulate gradients for the pairwise loss softplus(-(scorePos - scoreNeg)).
  accumulatePair(xPos, xNeg, weight) {
    const pos = this.forward(xPos);
    const neg = this.forward(xNeg);
    const diff = pos.score - neg.score;
    const sigmoidNeg = 1 / (1 + Math.exp(clamp(diff, -60, 60)));
    const gradPos = -sigmoidNeg;
    this.accumulateGrad(pos.hidden, xPos, gradPos * weight);
    this.accumulateGrad(neg.hidden, xNeg, -gradPos * weight);
    return softplus(-diff);
  }

  accumulateGrad(hidden, x, dScore) {
    for (let h = 0; h < this.hiddenDim; h += 1) {
      this.gw2[h] += dScore * hidden[h];
      const dz = dScore * this.w2[h] * (1 - hidden[h] * hidden[h]);
      this.gb1[h] += dz;
      const row = this.gw1[h];
      for (let i = 0; i < this.inputDim; i += 1) row[i] += dz * x[i];
    }
    this.gb2 += dScore;
  }

  applyGradients(learningRate, weightDecay, gradientClip) {
    let normSq = 0;
    for (let h = 0; h < this.hiddenDim; h += 1) {
      normSq += this.gw2[h] * this.gw2[h];
      normSq += this.gb1[h] * this.gb1[h];
      const row = this.gw1[h];
      for (let i = 0; i < this.inputDim; i += 1) normSq += row[i] * row[i];
    }
    normSq += this.gb2 * this.gb2;
    const norm = Math.sqrt(normSq);
    const clipScale = norm > gradientClip && norm > 0 ? gradientClip / norm : 1;
    const lr = learningRate * clipScale;
    for (let h = 0; h < this.hiddenDim; h += 1) {
      this.w2[h] -= lr * (this.gw2[h] + weightDecay * this.w2[h]);
      this.b1[h] -= lr * this.gb1[h];
      const row = this.w1[h];
      const gradRow = this.gw1[h];
      for (let i = 0; i < this.inputDim; i += 1) {
        row[i] -= lr * (gradRow[i] + weightDecay * row[i]);
      }
    }
    this.b2 -= lr * this.gb2;
  }
}

function softplus(value) {
  if (value > 0) return value + Math.log1p(Math.exp(-value));
  return Math.log1p(Math.exp(value));
}

function shuffledOrder(length, rng) {
  const order = Array.from({ length }, (unused, index) => index);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

// Cache one feature vector per (example, action) so training folds and rank
// evaluation never encode twice.
function buildFeatureCache(examples) {
  return examples.map((example) => ({
    example,
    vectors: example.legalActions.map((action) => encodeFeatures(example.state, normalizeAction(action))),
  }));
}

function trainModel(examples, config) {
  const settings = Object.assign({}, DEFAULT_CONFIG, config || {});
  const cache = buildFeatureCache(examples);
  const model = new DeterministicMlp(FEATURE_DIM, settings.hiddenDim, settings.seed);
  const rng = mulberry32((settings.seed ^ 0x9e3779b9) >>> 0);
  let lastLoss = null;
  for (let epoch = 0; epoch < settings.epochs; epoch += 1) {
    const order = shuffledOrder(cache.length, rng);
    let epochLoss = 0;
    let pairCount = 0;
    for (const cacheIndex of order) {
      const entry = cache[cacheIndex];
      const negatives = [];
      for (let index = 0; index < entry.vectors.length; index += 1) {
        if (index !== entry.example.chosenIndex) negatives.push(index);
      }
      if (negatives.length === 0) continue;
      model.resetGradients();
      const weight = 1 / negatives.length;
      const chosenVector = entry.vectors[entry.example.chosenIndex];
      for (const negativeIndex of negatives) {
        epochLoss += model.accumulatePair(chosenVector, entry.vectors[negativeIndex], weight);
        pairCount += 1;
      }
      model.applyGradients(settings.learningRate, settings.weightDecay, settings.gradientClip);
    }
    lastLoss = pairCount > 0 ? epochLoss / pairCount : null;
  }
  return { model, settings, finalLoss: lastLoss, examples: examples.length };
}

// Expected rank of the recorded chosen action among the legal set.  Ties are
// resolved as half-credit (expected rank under uniform random tie-breaking), so
// the uniform baseline has expected normalized rank exactly 0.5.
function evaluateChosenRank(model, examples) {
  const cache = buildFeatureCache(examples);
  let normalizedSum = 0;
  let top1 = 0;
  let count = 0;
  const perExample = [];
  for (const entry of cache) {
    const scores = entry.vectors.map((vector) => model.score(vector));
    const chosenScore = scores[entry.example.chosenIndex];
    let strictlyBetter = 0;
    let ties = 0;
    for (let index = 0; index < scores.length; index += 1) {
      if (index === entry.example.chosenIndex) continue;
      if (scores[index] > chosenScore) strictlyBetter += 1;
      else if (scores[index] === chosenScore) ties += 1;
    }
    const rank = 1 + strictlyBetter + ties * 0.5;
    const size = scores.length;
    const normalizedRank = size > 1 ? (rank - 1) / (size - 1) : 0;
    normalizedSum += normalizedRank;
    if (rank === 1) top1 += 1;
    count += 1;
    perExample.push({
      routeId: entry.example.routeId,
      decisionIndex: entry.example.decisionIndex,
      kind: entry.example.kind,
      legalActionCount: size,
      rank,
      normalizedRank,
    });
  }
  return {
    count,
    meanNormalizedRank: count > 0 ? normalizedSum / count : null,
    top1Rate: count > 0 ? top1 / count : null,
    uniformBaselineMeanNormalizedRank: 0.5,
    beatsUniform: count > 0 ? normalizedSum / count < 0.5 : false,
    perExample,
  };
}

function uniqueRouteIds(examples) {
  return Array.from(new Set(examples.map((example) => example.routeId))).sort();
}

// Two-fold leave-one-route-out sanity gate.  Fails closed when there are fewer
// than two routes.
function runSanityGate(examples, config) {
  const routes = uniqueRouteIds(examples);
  if (routes.length < 2) {
    return {
      status: "blocked",
      reason: "insufficient-routes-for-leave-one-route-out",
      routeCount: routes.length,
      folds: [],
      aggregate: null,
    };
  }
  const settings = Object.assign({}, DEFAULT_CONFIG, config || {});
  const folds = routes.map((heldOutRoute) => {
    const train = examples.filter((example) => example.routeId !== heldOutRoute);
    const test = examples.filter((example) => example.routeId === heldOutRoute);
    const trained = trainModel(train, settings);
    const metric = evaluateChosenRank(trained.model, test);
    return {
      heldOutRoute,
      trainExamples: train.length,
      testExamples: test.length,
      finalLoss: trained.finalLoss,
      metric,
    };
  });
  const totalTest = folds.reduce((sum, fold) => sum + fold.metric.count, 0);
  const weighted = folds.reduce((sum, fold) => sum + fold.metric.meanNormalizedRank * fold.metric.count, 0);
  const aggregateMeanNormalizedRank = totalTest > 0 ? weighted / totalTest : null;
  const aggregate = {
    testExamples: totalTest,
    meanNormalizedRank: aggregateMeanNormalizedRank,
    uniformBaselineMeanNormalizedRank: 0.5,
    beatsUniform: aggregateMeanNormalizedRank != null && aggregateMeanNormalizedRank < 0.5,
    folds: folds.map((fold) => ({
      heldOutRoute: fold.heldOutRoute,
      trainExamples: fold.trainExamples,
      testExamples: fold.testExamples,
      meanNormalizedRank: fold.metric.meanNormalizedRank,
      top1Rate: fold.metric.top1Rate,
    })),
  };
  return {
    status: aggregate.beatsUniform ? "pass" : "blocked",
    reason: aggregate.beatsUniform ? null : "held-out-chosen-action-rank-does-not-beat-uniform",
    routeCount: routes.length,
    folds,
    aggregate,
  };
}

function sharedPrefixSize(examplesByRoute) {
  const routeIds = Object.keys(examplesByRoute);
  if (routeIds.length < 2) return 0;
  const signatures = routeIds.map((routeId) => examplesByRoute[routeId].map((example) => (
    `${example.kind}|${example.fingerprint}|${example.state.floorId}`
  )));
  let prefix = 0;
  const shortest = Math.min(...signatures.map((list) => list.length));
  for (let index = 0; index < shortest; index += 1) {
    const first = signatures[0][index];
    if (signatures.every((list) => list[index] === first)) prefix += 1;
    else break;
  }
  return prefix;
}

function sampleSoftmaxIndex(scores, temperature, rng) {
  const scale = temperature > 0 ? temperature : 1;
  let max = -Infinity;
  for (const score of scores) if (score > max) max = score;
  const exps = scores.map((score) => Math.exp((score - max) / scale));
  const sum = exps.reduce((total, value) => total + value, 0);
  const target = rng() * sum;
  let acc = 0;
  for (let index = 0; index < exps.length; index += 1) {
    acc += exps[index];
    if (target < acc) return index;
  }
  return exps.length - 1;
}

// One matched rollout.  CONTROL samples uniformly; TREATMENT samples
// softmax(score / temperature) with the frozen temperature.  The same seed
// schedule is used for both arms by the caller.
function runRollout(simulator, model, options) {
  const config = options || {};
  const mode = config.mode === "treatment" ? "treatment" : "control";
  const horizon = config.horizon == null ? 96 : config.horizon;
  const temperature = config.temperature == null ? DEFAULT_CONFIG.temperature : config.temperature;
  const rng = mulberry32((config.seed == null ? 1 : config.seed) >>> 0);
  let state = simulator.createInitialState({ rank: "chaos" });
  const fingerprints = [];
  let steps = 0;
  let terminal = false;
  let errorClass = null;
  let maxFloorId = state.floorId;
  let maxFloorOrdinal = floorOrdinal(state.floorId);
  let reachedMt4 = maxFloorOrdinal >= MT4_ORDINAL;
  let reachedMt5 = maxFloorOrdinal >= MT5_ORDINAL;

  for (let step = 0; step < horizon; step += 1) {
    if (simulator.isTerminal(state)) {
      terminal = true;
      break;
    }
    let actions = [];
    try {
      actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    } catch (error) {
      errorClass = "enumerate-error";
      break;
    }
    if (actions.length === 0) {
      errorClass = "no-legal-actions";
      break;
    }
    let index;
    if (mode === "control") {
      index = Math.floor(rng() * actions.length);
    } else {
      const scores = actions.map((action) => model.score(encodeFeatures(state, action)));
      index = sampleSoftmaxIndex(scores, temperature, rng);
    }
    const action = actions[index];
    try {
      fingerprints.push(normalizeAction(action).fingerprint);
      state = simulator.applyAction(state, action, { storeRoute: false });
    } catch (error) {
      errorClass = "apply-error";
      break;
    }
    steps += 1;
    const ordinal = floorOrdinal(state.floorId);
    if (ordinal > maxFloorOrdinal) {
      maxFloorOrdinal = ordinal;
      maxFloorId = state.floorId;
    }
    if (ordinal >= MT4_ORDINAL) reachedMt4 = true;
    if (ordinal >= MT5_ORDINAL) reachedMt5 = true;
  }
  if (!terminal) terminal = simulator.isTerminal(state);
  return {
    seed: config.seed,
    mode,
    steps,
    terminal,
    maxFloorId,
    maxFloorOrdinal,
    reachedMt4,
    reachedMt5,
    errorClass,
    fingerprints,
  };
}

function aggregateArm(results) {
  const total = results.length;
  const terminalRollouts = results.filter((result) => result.terminal).length;
  const mt4 = results.filter((result) => result.reachedMt4).length;
  const mt5 = results.filter((result) => result.reachedMt5).length;
  const errors = results.filter((result) => result.errorClass).length;
  const meanSteps = total > 0 ? results.reduce((sum, result) => sum + result.steps, 0) / total : 0;
  const maxOrdinal = total > 0 ? Math.max(...results.map((result) => result.maxFloorOrdinal)) : 0;
  return {
    rollouts: total,
    terminalRollouts,
    terminalRate: total > 0 ? terminalRollouts / total : 0,
    mt4Reach: mt4,
    mt4ReachRate: total > 0 ? mt4 / total : 0,
    mt5Reach: mt5,
    mt5ReachRate: total > 0 ? mt5 / total : 0,
    errorRollouts: errors,
    meanSteps,
    maxFloorOrdinal: maxOrdinal,
  };
}

// Run the matched CONTROL/TREATMENT rollout comparison with the frozen seed
// schedule.  Only launched after the offline sanity gate passes.
function runRollouts(simulator, model, options) {
  const config = options || {};
  const rollouts = config.rollouts == null ? 32 : config.rollouts;
  const horizon = config.horizon == null ? 96 : config.horizon;
  const baseSeed = config.baseSeed == null ? 52501 : config.baseSeed;
  const temperature = config.temperature == null ? DEFAULT_CONFIG.temperature : config.temperature;
  const seeds = Array.from({ length: rollouts }, (unused, index) => (baseSeed + index * 7919) >>> 0);
  const control = [];
  const treatment = [];
  for (const seed of seeds) {
    control.push(runRollout(simulator, model, { mode: "control", seed, horizon, temperature }));
    treatment.push(runRollout(simulator, model, { mode: "treatment", seed, horizon, temperature }));
  }
  return {
    horizon,
    temperature,
    seeds,
    control,
    treatment,
    controlAggregate: aggregateArm(control),
    treatmentAggregate: aggregateArm(treatment),
  };
}

module.exports = {
  ACTION_FEATURE_COUNT,
  DEFAULT_CONFIG,
  DeterministicMlp,
  FEATURE_DIM,
  FEATURE_SCHEMA,
  MT4_ORDINAL,
  MT5_ORDINAL,
  STATE_FEATURE_COUNT,
  aggregateArm,
  buildFeatureCache,
  encodeFeatures,
  evaluateChosenRank,
  floorOrdinal,
  mulberry32,
  runRollouts,
  runSanityGate,
  sharedPrefixSize,
  trainModel,
};
