"use strict";

const { buildDominanceKey, buildStateKey } = require("./state-key");
const { computeFrontierFeatures } = require("./frontier-features");

const stateKeyCache = new WeakMap();
const dominanceKeyCache = new WeakMap();
const scoreCache = new WeakMap();
const searchRankCache = new WeakMap();
const frontierFeatureCache = new WeakMap();

function getStateKey(state) {
  let value = stateKeyCache.get(state);
  if (value == null) {
    value = buildStateKey(state);
    stateKeyCache.set(state, value);
  }
  return value;
}

function getDominanceKey(state) {
  let value = dominanceKeyCache.get(state);
  if (value == null) {
    value = buildDominanceKey(state);
    dominanceKeyCache.set(state, value);
  }
  return value;
}

function getScore(simulator, state) {
  let bySimulator = scoreCache.get(state);
  if (!bySimulator) {
    bySimulator = new WeakMap();
    scoreCache.set(state, bySimulator);
  }
  let value = bySimulator.get(simulator);
  if (value == null) {
    value = simulator.score(state);
    bySimulator.set(simulator, value);
  }
  return value;
}

function getSearchRank(simulator, state, score, context) {
  let bySimulator = searchRankCache.get(state);
  if (!bySimulator) {
    bySimulator = new WeakMap();
    searchRankCache.set(state, bySimulator);
  }
  let value = bySimulator.get(simulator);
  if (value == null) {
    const resolvedScore = score == null ? getScore(simulator, state) : score;
    value = simulator.searchRankFn(state, resolvedScore, context || { project: simulator.project, battleResolver: simulator.battleResolver });
    bySimulator.set(simulator, value);
  }
  return value;
}

function getFrontierFeatures(project, state, options) {
  let byProject = frontierFeatureCache.get(state);
  if (!byProject) {
    byProject = new WeakMap();
    frontierFeatureCache.set(state, byProject);
  }
  let value = byProject.get(project);
  if (value == null) {
    value = computeFrontierFeatures(project, state, options || {});
    byProject.set(project, value);
  }
  return value;
}

module.exports = {
  getDominanceKey,
  getFrontierFeatures,
  getScore,
  getSearchRank,
  getStateKey,
};
