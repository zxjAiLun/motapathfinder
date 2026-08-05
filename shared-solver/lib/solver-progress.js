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
  "route-artifact",
  "verified-route",
];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function summarizeDpHero(hero) {
  const source = hero || {};
  return {
    hp: source.hp == null ? null : source.hp,
    atk: source.atk == null ? null : source.atk,
    def: source.def == null ? null : source.def,
  };
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
    budgetSource = "task-search",
    objective = null,
  }) {
    this.jobId = jobId || null;
    this.taskFingerprint = taskFingerprint || null;
    this.onPublish = typeof onPublish === "function" ? onPublish : () => {};
    this.throttleMs = Math.max(0, Number(throttleMs) || 0);
    this.expansionEvery = Math.max(1, Number(expansionEvery) || 1);
    this.maxExpansions = Number(maxExpansions) || 0;
    this.maxRuntimeMs = Number(maxRuntimeMs) || 0;
    this.budgetSource = budgetSource || "task-search";
    this.objective = objective || null;
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
    // The task-level budget applies per segment/attempt (each DP run gets the
    // full manual budget), not as one global run budget.  `attempt` tracks the
    // active attempt's own counters so ratios never mix attempt expansion
    // counts with a budget cap that is per-attempt.
    this.attempt = {
      segmentId: null,
      index: 0,
      total: 0,
      attempt: 0,
      expansions: 0,
      startedAt: null,
    };
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
    this.publish(true);
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

  _bestKnownGoalCandidate(event) {
    if (!event) return;
    // The search already confirmed this candidate improves the current best
    // using the objective comparator; the accumulator must not re-derive
    // improvement with >= (wrong for min / lexicographic / non-scalar values).
    // It projects the search's own objective fingerprint/value/trace/exactness.
    const exact = event.objectiveValueExact === true;
    // At goal-enqueue time the full route has not been reconstructed yet, so
    // decisionDepth is known but routeLength is not.  Never fill the
    // routeLength field with the decision depth.
    this.bestKnown = {
      kind: "goal-candidate",
      goalReached: true,
      verified: false,
      floorId: event.floorId || null,
      decisionDepth: event.decisionDepth == null ? null : Number(event.decisionDepth),
      routeLength: null,
      routeLengthExact: false,
      objectiveValue: exact ? event.objectiveValue : null,
      objectiveFingerprint: event.objectiveFingerprint || null,
      objectiveComparisonTrace: exact && Array.isArray(event.objectiveComparisonTrace)
        ? event.objectiveComparisonTrace
        : [],
      objectiveValueExact: exact,
      hero: summarizeDpHero((event && event.hero) || {}),
      proofClaim: "candidate-only",
    };
    this.publish(true);
  }

  handleDpEvent(event) {
    if (!event || !event.eventType) return;
    switch (event.eventType) {
      case "agendaPopped":
        this.counters.expansions += 1;
        if (this.attempt.startedAt != null) this.attempt.expansions += 1;
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
      case "goalCandidateImproved":
        this._bestKnownGoalCandidate(event);
        break;
      case "actionSetGenerated":
        this.counters.actionTrimmed += Math.max(0, Number(event.trimmedCount) || 0);
        this.publish(false);
        break;
      case "segmentStarted":
        this.attempt = {
          segmentId: event.segmentId || null,
          index: Number(event.segmentIndex) || 0,
          total: Number(event.segmentTotal) || 0,
          attempt: 0,
          expansions: 0,
          startedAt: null,
        };
        this.setSegment({
          id: event.segmentId || null,
          index: Number(event.segmentIndex) || 0,
          total: Number(event.segmentTotal) || 0,
          attempt: 0,
        });
        this.setPhase("segment-search");
        break;
      case "attemptStarted":
        this.attempt = {
          segmentId: event.segmentId || null,
          index: Number(event.segmentIndex) || 0,
          total: Number(event.segmentTotal) || 0,
          attempt: Number(event.attempt) || 1,
          expansions: 0,
          startedAt: Date.now(),
        };
        this.setSegment({
          id: event.segmentId || null,
          index: Number(event.segmentIndex) || 0,
          total: Number(event.segmentTotal) || 0,
          attempt: Number(event.attempt) || 1,
        });
        break;
      case "segmentCompleted":
        this.attempt = {
          segmentId: null,
          index: 0,
          total: 0,
          attempt: 0,
          expansions: 0,
          startedAt: null,
        };
        this.setSegment(null);
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
    const elapsedMs = this.startedAt
      ? Math.max(0, Date.now() - Date.parse(this.startedAt))
      : 0;
    const attemptActive = this.attempt && this.attempt.startedAt != null;
    const attemptElapsedMs = attemptActive
      ? Math.max(0, Date.now() - this.attempt.startedAt)
      : 0;
    const attemptExpansions = attemptActive ? this.attempt.expansions : 0;
    const clampRatio = (value) => (value == null ? null : Math.min(1, value));
    const current = attemptActive ? {
      segmentId: this.attempt.segmentId,
      attempt: this.attempt.attempt,
      expansions: attemptExpansions,
      elapsedMs: attemptElapsedMs,
      maxExpansions: this.maxExpansions,
      maxRuntimeMs: this.maxRuntimeMs,
      expansionBudgetUsedRatio: this.maxExpansions > 0
        ? clampRatio(Number((attemptExpansions / this.maxExpansions).toFixed(4)))
        : null,
      runtimeBudgetUsedRatio: this.maxRuntimeMs > 0
        ? clampRatio(Number((attemptElapsedMs / this.maxRuntimeMs).toFixed(4)))
        : null,
      expansionBudgetExhausted: this.maxExpansions > 0 && attemptExpansions >= this.maxExpansions,
    } : null;
    const budget = {
      // The task budget applies per attempt (each DP run gets the full manual
      // budget), so only the current attempt's ratio is meaningful; total
      // counters are reported separately and never divided by a per-attempt cap.
      source: this.budgetSource,
      scope: "per-attempt",
      current,
      total: { expansions, elapsedMs },
      maxExpansions: this.maxExpansions,
      maxRuntimeMs: this.maxRuntimeMs,
      actionTrimmed: this.counters.actionTrimmed,
      // Deprecated flat aliases of `current` (kept for pre-d2 consumers);
      // they reflect the active attempt only and are never total/per-attempt.
      expansions: current ? current.expansions : null,
      elapsedMs: current ? current.elapsedMs : null,
      expansionBudgetUsedRatio: current ? current.expansionBudgetUsedRatio : null,
      runtimeBudgetUsedRatio: current ? current.runtimeBudgetUsedRatio : null,
      expansionBudgetExhausted: current ? current.expansionBudgetExhausted : false,
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
  // progress-state is a reached-but-not-goal state: goalReached must stay false
  // even when a state object exists, so the GUI cannot confuse the farthest
  // progress state with an actual goal candidate.
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
