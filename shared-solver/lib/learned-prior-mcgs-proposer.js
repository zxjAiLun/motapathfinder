"use strict";

// PR-5.25j — MCGS untried-edge proposer backed by the EXISTING hierarchical policy.
//
// This is an adapter only; it defines no new policy.  It reuses the frozen
// dd5e597 hierarchical policy (fixed train kind prior for cross-kind +
// within-kind residual, explicit two-stage sampler at T = 1.0) and restricts
// sampling to the current UNTRIED subset.
//
// Contract:
//   - mcgs.js never requires this module; the caller injects the returned
//     function through options.untriedActionProposer.
//   - sampling happens ONLY over `untriedActions`, renormalising the
//     available-kind prior over the kinds present in that subset.  We do NOT
//     "sample over all legal actions and retry when already tried" — that would
//     make the effective distribution depend on the tried set in the wrong way.
//   - NO top-k / threshold pruning: the policy only decides which untried
//     action is expanded FIRST; every legal action is still expandable, so the
//     learned prior can never become a correctness authority.
//
// Effect on the graph: if the policy prefers walking back through a reverse
// stair, that edge gets expanded once and becomes "tried"; on the next visit to
// the same exact state the proposer must choose among the remaining untried
// actions, so the graph implicitly performs policy-guided weighted sampling
// WITHOUT replacement.

const prior = require("./learned-action-prior");
const hierarchical = require("./learned-prior-hierarchical-residual-experiment");

// Accepts either a function or a { next() } RNG object, so the injected stream
// from mcgs.js (createSeededRng) is used directly.
function asRandom(rng) {
  if (typeof rng === "function") return rng;
  if (rng && typeof rng.next === "function") return () => rng.next();
  throw new Error("untried proposer requires an RNG function or { next() } object");
}

function createHierarchicalUntriedProposer(options) {
  const config = options || {};
  const residualModel = config.residualModel || null;
  const kindProbability = config.kindProbability;
  const floorOrder = config.floorOrder || null;
  const temperature = config.temperature == null ? prior.DEFAULT_CONFIG.temperature : config.temperature;
  if (!kindProbability) throw new Error("createHierarchicalUntriedProposer requires kindProbability");

  const proposer = ({ untriedActions, state, rng }) => {
    if (!Array.isArray(untriedActions) || untriedActions.length === 0) return null;
    const random = asRandom(rng);
    const vectors = untriedActions.map((action) => prior.encodeFeaturesV2(state, action, { floorOrder }));
    const residualScores = residualModel
      ? vectors.map((vector) => residualModel.score(vector))
      : vectors.map(() => 0);
    const picked = hierarchical.sampleKindThenAction(
      vectors,
      residualScores,
      kindProbability,
      random,
      temperature,
      Boolean(residualModel),
    );
    return untriedActions[picked.index] || null;
  };
  proposer.policyKind = residualModel ? "HIERARCHICAL_KIND_PRIOR_PLUS_WITHIN_KIND_RESIDUAL" : "KIND_PRIOR_ONLY";
  proposer.temperature = temperature;
  return proposer;
}

module.exports = {
  asRandom,
  createHierarchicalUntriedProposer,
};
