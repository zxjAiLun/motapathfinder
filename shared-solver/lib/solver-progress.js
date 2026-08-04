"use strict";

const SOLVER_PROGRESS_SCHEMA = "motapathfinder.solver-progress.v1";

const PROGRESS_PHASES = [
  "queued",
  "preflight",
  "planning",
  "segment-search",
  "route-build",
  "strict-replay",
  "finalizing",
  "completed",
  "failed",
  "cancelled",
];

const BEST_KNOWN_KINDS = [
  "progress-state",
  "goal-candidate",
  "verified-route",
];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// Aggregates low-level DP observer events into throttled, honest progress
// snapshots.  Never emits a fake completion percentage: the search space size
// is unknown, so only the budget-consumed ratio is provided.
class SolverProgressAccumulator {
  constructor({
    jobId,
    taskFingerprint,
    onPublish,
    throttleMs = 150,
    expansionEvery = 200,
    maxExpansions = 0,
    maxRuntimeMs = 0,
  }) {
    this.jobId = jobId || null;
    this.taskFingerprint = taskFingerprint || null;
    this.onPublish = typeof onPublish === "function" ? onPublish : () => {};
    this.throttleMs = Math.max(0, Number(throttleMs) || 0);
    this.expansionEvery = Math.max(1, Number(expansionEvery) || 1);
    this.maxExpansions = Number(maxExpansions) || 0;
    this.maxRuntimeMs = Number(maxRuntimeMs) || 0;
    this.sequence = 0;
    this.status = "queued";
    this.phase = "queued";
    this.segment = null;
    this.bestKnown = null;
    this.proof = null;
    this.startedAt = null;
    this.counters = {
      expansions: 0,
      generated: 0,
      accepted: 0,
      goalCandidates: 0,
      actionTrimmed: 0,
    };
    this.lastPublishAt = 0;
    this.lastPublishExpansion = 0;
  }

  setStatus(status) {
    this.status = status;
  }

  setPhase(phase) {
    if (!PROGRESS_PHASES.includes(phase)) {
      throw new Error(`Unknown progress phase: ${phase}`);
    }
    this.phase = phase;
    this.publish(true);
  }

  setStartedAt(timestamp) {
    this.startedAt = timestamp || new Date().toISOString();
  }

  setSegment(segment) {
    this.segment = segment ? cloneJson(segment) : null;
  }

  setBestKnown(bestKnown) {
    if (bestKnown && !BEST_KNOWN_KINDS.includes(bestKnown.kind)) {
      throw new Error(`Unknown bestKnown kind: ${bestKnown.kind}`);
    }
    this.bestKnown = bestKnown ? cloneJson(bestKnown) : null;
    this.publish(true);
  }

  setProof(proof) {
    this.proof = proof ? cloneJson(proof) : null;
    this.publish(true);
  }

  handleDpEvent(event) {
    if (!event || !event.eventType) return;
    switch (event.eventType) {
      case "agendaPopped":
        this.counters.expansions += 1;
        break;
      case "candidateGenerated":
        this.counters.generated += 1;
        break;
      case "skylineInserted":
        this.counters.accepted += 1;
        break;
      case "goalAccepted":
        this.counters.goalCandidates += 1;
        break;
      case "actionTrimmed":
        this.counters.actionTrimmed += 1;
        break;
      default:
        return;
    }
    if (this.counters.expansions - this.lastPublishExpansion >= this.expansionEvery) {
      this.publish(false);
    }
  }

  snapshot() {
    this.sequence += 1;
    const expansions = this.counters.expansions;
    const budget = {
      maxExpansions: this.maxExpansions,
      maxRuntimeMs: this.maxRuntimeMs,
      expansionBudgetUsedRatio: this.maxExpansions > 0
        ? Number((expansions / this.maxExpansions).toFixed(4))
        : null,
      runtimeBudgetUsedRatio: this.maxRuntimeMs > 0 && this.startedAt
        ? Number((Math.max(0, Date.now() - Date.parse(this.startedAt)) / this.maxRuntimeMs).toFixed(4))
        : null,
      expansionBudgetExhausted: this.maxExpansions > 0 && expansions >= this.maxExpansions,
      actionTrimmed: this.counters.actionTrimmed,
    };
    return {
      schema: SOLVER_PROGRESS_SCHEMA,
      jobId: this.jobId,
      taskFingerprint: this.taskFingerprint,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      status: this.status,
      phase: this.phase,
      segment: this.segment ? cloneJson(this.segment) : null,
      search: cloneJson(this.counters),
      budget,
      bestKnown: this.bestKnown ? cloneJson(this.bestKnown) : null,
      proof: this.proof ? cloneJson(this.proof) : null,
    };
  }

  publish(force) {
    const now = Date.now();
    const throttled = !force && now - this.lastPublishAt < this.throttleMs;
    const expansionBound = this.counters.expansions - this.lastPublishExpansion < this.expansionEvery;
    if (!force && throttled && expansionBound) return;
    this.lastPublishAt = now;
    this.lastPublishExpansion = this.counters.expansions;
    this.onPublish(this.snapshot());
  }

  flush() {
    this.publish(true);
  }
}

function bestKnownProgressState({ foundGoal, floorId, objectiveValue, routeLength, hero }) {
  return {
    kind: "progress-state",
    goalReached: Boolean(foundGoal),
    verified: false,
    floorId: floorId || null,
    objectiveValue: objectiveValue == null ? null : objectiveValue,
    routeLength: routeLength == null ? null : routeLength,
    hero: hero ? cloneJson(hero) : null,
  };
}

function bestKnownGoalCandidate({ floorId, objectiveValue, objectiveFingerprint, routeLength, hero, claim }) {
  return {
    kind: "goal-candidate",
    goalReached: true,
    verified: false,
    floorId: floorId || null,
    objectiveValue: objectiveValue == null ? null : objectiveValue,
    objectiveFingerprint: objectiveFingerprint || null,
    routeLength: routeLength == null ? null : routeLength,
    hero: hero ? cloneJson(hero) : null,
    proofClaim: claim || "candidate-only",
  };
}

function bestKnownVerifiedRoute({ floorId, objectiveValue, objectiveFingerprint, routeLength, hero, claim }) {
  return {
    kind: "verified-route",
    goalReached: true,
    verified: true,
    floorId: floorId || null,
    objectiveValue: objectiveValue == null ? null : objectiveValue,
    objectiveFingerprint: objectiveFingerprint || null,
    routeLength: routeLength == null ? null : routeLength,
    hero: hero ? cloneJson(hero) : null,
    proofClaim: claim || "candidate-only",
  };
}

module.exports = {
  BEST_KNOWN_KINDS,
  PROGRESS_PHASES,
  SOLVER_PROGRESS_SCHEMA,
  SolverProgressAccumulator,
  bestKnownGoalCandidate,
  bestKnownProgressState,
  bestKnownVerifiedRoute,
};
