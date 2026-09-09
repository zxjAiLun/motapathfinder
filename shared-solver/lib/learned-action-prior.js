#!/usr/bin/env node
/**
 * learned-action-prior.js
 * Phase 1 implementation entry point for PR-5.25c
 *
 * Small MLP state-action scorer + pairwise ranking
 * Fixed softmax rollout sampling (T=1.0)
 * Strict held-out data filtering
 */

"use strict";

const path = require("path");

const DATA_ROOT = path.join(__dirname, "..", "fixtures", "trajectories");

class LearnedActionPrior {
  constructor(config = {}) {
    this.config = {
      hiddenSize: 64,
      learningRate: 0.001,
      epochs: 50,
      batchSize: 32,
      temperature: 1.0,
      ...config,
    };
    this.model = null; // will be a simple MLP
    this.dataset = null;
  }

  async loadDataset() {
    // TODO: implement strict held-out filtering
    // currently placeholder
    console.log("Loading dataset with strict MT5 blueKing hold-out...");
    this.dataset = await this._loadTrajectories();
  }

  async _loadTrajectories() {
    // Placeholder: in real impl, scan fixtures/trajectories/*.json
    // Filter out any trajectory containing MT5 blueKing witness or derived prefixes
    return [];
  }

  async train() {
    await this.loadDataset();
    // TODO: build dataset with pairwise (positive = chosen, negatives = other legal)
    // Train small MLP on state -> action score
    console.log("Training small MLP with pairwise ranking...");
    // In real: tfjs or simple JS NN
  }

  async scoreAction(state, legalActions) {
    // TODO: compute features, run MLP, softmax
    return legalActions.map((a) => ({ action: a, score: Math.random() }));
  }

  async runRollout(startState, horizon = 96) {
    // TODO: apply learned prior sampling
    console.log("Running learned prior rollout...");
    return [];
  }
}

module.exports = { LearnedActionPrior };
