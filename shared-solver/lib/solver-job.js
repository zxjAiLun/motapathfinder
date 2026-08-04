"use strict";

const { loadProject } = require("./project-loader");
const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { StaticSimulator } = require("./simulator");
const { getMilestoneSpec } = require("./milestone-spec");
const { buildRegionMilestoneSpec, buildRegionProofClaim } = require("./region-spec");
const { runMilestoneGraph } = require("./segment-dp");
const { buildRouteRecord } = require("./route-store");
const { executeActionList } = require("./events");
const { verifyRouteObjective, replayRouteFile } = require("./live-replay");
const { SolverProgressAccumulator } = require("./solver-progress");
const { classifyJobFailure, buildSolverJobResult } = require("./solver-job-result");
const { SOLVE_TASK_SCHEMA } = require("./solve-task");

const JOB_STATES = ["queued", "running", "completed", "failed", "cancelled"];
const VALID_TRANSITIONS = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

class SolverJobError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "SolverJobError";
    this.code = code;
    this.details = details || null;
  }
}

function assertValidTransition(from, to) {
  if (!JOB_STATES.includes(from)) {
    throw new SolverJobError("JOB_INVALID_STATE_TRANSITION", `unknown state: ${from}`, { from });
  }
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new SolverJobError(
      "JOB_INVALID_STATE_TRANSITION",
      `invalid transition ${from} -> ${to}`,
      { from, to },
    );
  }
}

class SolverJob {
  constructor({ id, task }) {
    this.id = id;
    this.task = task;
    this.state = "queued";
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.finishedAt = null;
    this.result = null;
    this.failure = null;
    this.lastProgress = null;
    this.cancelRequested = false;
    this.subscribers = new Set();
  }

  transition(next) {
    assertValidTransition(this.state, next);
    this.state = next;
    if (next === "running" && !this.startedAt) this.startedAt = new Date().toISOString();
    if (next === "completed" || next === "failed" || next === "cancelled") {
      this.finishedAt = new Date().toISOString();
    }
    return this;
  }

  requestPause() {
    throw new SolverJobError(
      "JOB_PAUSE_UNSUPPORTED",
      "pause is not supported yet; the search frontier is not serializable in this version",
      { jobId: this.id },
    );
  }

  publishProgress(snapshot) {
    snapshot.jobId = this.id;
    snapshot.taskFingerprint = this.task && this.task.taskFingerprint || snapshot.taskFingerprint || null;
    this.lastProgress = snapshot;
    this.subscribers.forEach((subscriber) => {
      try {
        subscriber(snapshot);
      } catch (error) {
        // subscriber errors must not break job execution
      }
    });
  }

  subscribe(callback) {
    if (typeof callback !== "function") {
      throw new SolverJobError("JOB_INVALID_SUBSCRIBER", "subscriber must be a function", { jobId: this.id });
    }
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  toJSON() {
    return {
      id: this.id,
      state: this.state,
      taskFingerprint: this.task && this.task.taskFingerprint || null,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      cancelRequested: this.cancelRequested,
      lastProgress: this.lastProgress || null,
    };
  }
}

function makeSimulator(project, regionSpec, task) {
  const simulatorConfig = regionSpec.simulator || {};
  const solverModel = (task && task.normalizedTask && task.normalizedTask.model) ||
    regionSpec.model ||
    null;
  return new StaticSimulator(project, {
    solverModel,
    stopFloorId: simulatorConfig.stopFloorId || null,
    battleResolver: new FunctionBackedBattleResolver(project, {
      autoLevelUp: simulatorConfig.autoLevelUp !== false,
    }),
    autoPickupEnabled: simulatorConfig.autoPickupEnabled !== false,
    autoBattleEnabled: simulatorConfig.autoBattleEnabled !== false,
    enableFightToLevelUp: Boolean(simulatorConfig.enableFightToLevelUp),
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: simulatorConfig.searchGraphMode || "primitive",
  });
}

function createWhiteislandTrialState(project, simulator, rank) {
  const state = simulator.createInitialState({ rank });
  const choices = (((project.floorsById.Start || {}).events || {})["3,3"] || [])[0] || {};
  const trialChoice = (choices.choices || []).find((choice) => choice.text === "试炼间");
  if (!trialChoice) {
    throw new Error("whiteislandTrial start requested but Start 3,3 does not contain 试炼间 choice");
  }
  executeActionList(project, state, trialChoice.action || [], { floorId: "Start" }, { choiceResolver: simulator.choiceResolver });
  return simulator.stabilizeState(state);
}

function createStartState(project, simulator, regionSpec, rank) {
  const start = regionSpec.start || {};
  if (start.type === "whiteislandTrial") {
    return createWhiteislandTrialState(project, simulator, rank);
  }
  return simulator.createInitialState({ rank });
}

function createProgressObserver(progress) {
  return {
    eventTypes: [
      "agendaPopped",
      "candidateGenerated",
      "skylineInserted",
      "goalAccepted",
      "goalCandidateImproved",
      "actionSetGenerated",
      "segmentStarted",
      "attemptStarted",
      "segmentCompleted",
      "budgetStopped",
    ],
    onEvent(event) {
      progress.handleDpEvent(event);
    },
  };
}

function objectiveStateFromSnapshot(snapshot, metrics) {
  const decisionDepth = typeof metrics === "object"
    ? Math.max(0, Number(metrics.decisionDepth || 0))
    : Math.max(0, Number(metrics || 0));
  const routeLength = typeof metrics === "object"
    ? Math.max(0, Number(metrics.routeLength == null ? metrics.decisionDepth : metrics.routeLength))
    : decisionDepth;
  return {
    hero: (snapshot && snapshot.hero) || {},
    inventory: (snapshot && snapshot.inventory) || {},
    route: Array.from({ length: routeLength }, () => null),
    meta: { decisionDepth },
  };
}

function routeLengthOfState(state) {
  if (state && Array.isArray(state.route)) return state.route.length;
  return getDecisionDepthSafe(state);
}

// The authoritative final objective value is the one buildRouteRecord computed
// from the simulator-replayed final state, persisted as metadata.finalObjectiveValue.
// Runtime snapshots cannot reconstruct route.length/decisionDepth for arbitrary
// auto-step counts, so the job result must project the artifact metadata value.
function objectiveValueFromRouteRecord(task, routeRecord) {
  if (!task || !task.objective || !task.objective.explicit || !routeRecord || !routeRecord.metadata) return null;
  return {
    fingerprint: task.objective.fingerprint,
    value: routeRecord.metadata.finalObjectiveValue,
    comparisonTrace: routeRecord.metadata.objectiveComparisonTrace || [],
  };
}

function stableObjectiveValue(value) {
  return JSON.stringify(value == null ? null : (typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value));
}

function bestKnownFromState(task, state, kind, claim, metrics, objectiveValueOverride) {
  if (!state) return null;
  const hero = (state.hero || {});
  const decisionDepth = typeof metrics === "object" ? metrics.decisionDepth : metrics;
  const routeLength = typeof metrics === "object" ? metrics.routeLength : metrics;
  const evaluation = objectiveValueOverride == null && task && task.objective && task.objective.explicit
    ? task.objective.evaluateState(objectiveStateFromSnapshot(state, metrics))
    : null;
  return {
    kind,
    goalReached: kind === "goal-candidate" || kind === "verified-route" || kind === "route-artifact",
    verified: kind === "verified-route",
    floorId: state.floorId || null,
    objectiveValue: objectiveValueOverride != null ? objectiveValueOverride : (evaluation ? evaluation.value : null),
    objectiveFingerprint: task && task.objective && task.objective.explicit
      ? task.objective.fingerprint
      : null,
    routeLength: routeLength == null ? null : routeLength,
    decisionDepth: decisionDepth == null ? null : decisionDepth,
    hero: {
      hp: hero.hp == null ? null : hero.hp,
      atk: hero.atk == null ? null : hero.atk,
      def: hero.def == null ? null : hero.def,
    },
    proofClaim: claim || "candidate-only",
  };
}

function makeStrictReplayFailure(error) {
  const failure = new Error(`Strict runtime replay failed: ${error && error.message || String(error)}`);
  failure.code = "STRICT_REPLAY_FAILED";
  failure.cause = error;
  return failure;
}

function buildDiagnosticsSummary(result, proofClaim) {
  return {
    found: Boolean(result && result.found),
    reachedMilestone: result && result.reachedMilestone || null,
    failedSegmentId: result && result.failedSegment && result.failedSegment.segmentId || null,
    failureClass: result && result.failedSegment && result.failedSegment.failureClass || null,
    segmentCount: (result && result.segmentResults || []).length,
    proofClaim,
  };
}

// Core job execution.  Runs the existing solver pipeline (region spec -> DP ->
// route build -> strict replay verification) and emits honest progress
// snapshots.  It does NOT reimplement search: it only drives runMilestoneGraph
// and aggregates its observer events.
async function executeSolveJob(task, {
  jobId,
  onProgress,
  shouldStop,
  context,
} = {}) {
  const normalizedTask = task && task.normalizedTask ? task.normalizedTask : task;
  const projectRoot = normalizedTask && normalizedTask.tower && normalizedTask.tower.projectRoot;
  if (!projectRoot) {
    throw new Error("SolveTask is missing tower.projectRoot");
  }
  const stopRequested = typeof shouldStop === "function"
    ? shouldStop
    : () => false;
  const objective = task && task.objective ? task.objective : null;
  const progress = new SolverProgressAccumulator({
    jobId: jobId || "job-unknown",
    taskFingerprint: task && task.taskFingerprint || null,
    onPublish: (snapshot) => {
      if (typeof onProgress === "function") onProgress(snapshot);
    },
    maxExpansions: normalizedTask.search && normalizedTask.search.maxExpansions || 0,
    maxRuntimeMs: normalizedTask.search && normalizedTask.search.maxRuntimeMs || 0,
    objective,
  });
  progress.setStatus("running");
  progress.setStartedAt(new Date().toISOString());

  progress.setPhase("preflight");
  const project = loadProject(projectRoot);
  if (stopRequested()) {
    progress.setPhase("cancelled");
    throw new Error("cancel-requested");
  }
  const regionSpec = normalizedTask.tower.region.spec;
  const rank = normalizedTask.tower.rank || regionSpec.rank || "chaos";
  const simulator = makeSimulator(project, regionSpec, task);
  const initialState = createStartState(project, simulator, regionSpec, rank);

  progress.setPhase("planning");
  const milestoneSpec = buildRegionMilestoneSpec(project, regionSpec);
  const segments = Array.isArray(milestoneSpec.milestones) ? milestoneSpec.milestones : [];
  if (stopRequested()) {
    progress.setPhase("cancelled");
    throw new Error("cancel-requested");
  }

  progress.setPhase("segment-search");
  progress.setSegment({
    id: segments.length > 0 ? segments[0].id : null,
    index: 0,
    total: segments.length,
    attempt: 1,
  });
  const result = runMilestoneGraph(simulator, initialState, milestoneSpec, {
    ...(task && task.executeConfig || {}),
    objectiveSpec: objective,
    observer: createProgressObserver(progress),
    shouldStop: stopRequested,
  });
  progress.setSegment(null);
  if (stopRequested() || result.stoppedReason === "cancel-requested" || result.cancelled === true) {
    progress.setPhase("cancelled");
    progress.flush();
    return { result, proofClaim: null, routeRecord: null, strictReplayVerified: false, cancelled: true };
  }

  const proofClaim = buildRegionProofClaim(result, regionSpec, objective);
  progress.setProof(proofClaim.objective || null);
  const claimedObjective = (proofClaim && proofClaim.objective && proofClaim.objective.claim) || "candidate-only";

  let routeRecord = null;
  let strictReplayVerified = false;
  let verificationStatus = null;
  let objectiveValue = null;
  if (result.found && result.finalCandidate && result.finalCandidate.state) {
    const candidateState = result.finalCandidate.state;
    progress.setBestKnown(bestKnownFromState(
      task,
      candidateState,
      "goal-candidate",
      claimedObjective,
      {
        decisionDepth: getDecisionDepthSafe(candidateState),
        routeLength: routeLengthOfState(candidateState),
      },
    ));
    progress.setPhase("route-build");
    const finalState = result.finalCandidate.state;
    finalState.route = Array.isArray(result.finalCandidate.route)
      ? result.finalCandidate.route.slice()
      : finalState.route;
    routeRecord = buildRouteRecord({
      project,
      simulator,
      initialState,
      finalState,
      options: {
        projectRoot,
        solver: "solve-task",
        profile: regionSpec.id,
        rank,
        toFloor: finalState.floorId,
        goalType: "region",
        snapshotFloors: (regionSpec.scope || {}).floors,
        metadata: {
          kind: "region-dp",
          regionDp: {
            regionId: regionSpec.id,
            taskFingerprint: task && task.taskFingerprint || null,
            proofClaim,
            candidateLimit: (task && task.executeConfig && task.executeConfig.candidateLimit) || null,
            search: normalizedTask.search || null,
          },
        },
        objectiveSpec: objective,
      },
    });
    const decisionDepth = (routeRecord && routeRecord.decisions || []).length;
    const artifactRouteLength = (routeRecord && routeRecord.stats && routeRecord.stats.routeLength) != null
      ? Number(routeRecord.stats.routeLength)
      : decisionDepth;
    progress.setPhase("strict-replay");
    if (routeRecord && routeRecord.final && routeRecord.final.snapshot) {
      // The authoritative objective value is the one buildRouteRecord computed
      // from the simulator-replayed final state and persisted in metadata.
      objectiveValue = objectiveValueFromRouteRecord(task, routeRecord);
      let verifiedMetrics;
      let bestKnownKind;
      if (normalizedTask.verification.strictReplay !== false) {
        // Real runtime strict replay: actually execute the route in the
        // runtime and verify every step + final snapshot + objective.  The
        // runtime returns the true route length (auto-steps included) and the
        // objective verification; the artifact's own metadata is not treated as
        // verification.
        let replayResult;
        try {
          replayResult = await replayRouteFile(routeRecord, {
            projectRoot,
            headless: "1",
            keepOpen: false,
            timeoutMs: 60000,
            stepDelayMs: 0,
            fastForwardDelayMs: 0,
            runtimeAutoBattle: 1,
          });
          strictReplayVerified = true;
          verificationStatus = "verified";
        } catch (error) {
          throw makeStrictReplayFailure(error);
        }
        const runtimeValue = replayResult &&
          replayResult.objectiveVerification &&
          replayResult.objectiveVerification.value;
        const metadataValue = routeRecord.metadata && routeRecord.metadata.finalObjectiveValue;
        if (
          runtimeValue == null ||
          stableObjectiveValue(runtimeValue) !== stableObjectiveValue(objectiveValue.value) ||
          stableObjectiveValue(metadataValue) !== stableObjectiveValue(objectiveValue.value)
        ) {
          throw makeStrictReplayFailure(new Error(
            `objective value mismatch: result=${JSON.stringify(objectiveValue.value)} metadata=${JSON.stringify(metadataValue)} runtime=${JSON.stringify(runtimeValue)}`,
          ));
        }
        verifiedMetrics = {
          decisionDepth,
          routeLength: replayResult && replayResult.runtimeRouteLength != null
            ? Number(replayResult.runtimeRouteLength)
            : artifactRouteLength,
        };
        bestKnownKind = "verified-route";
      } else {
        strictReplayVerified = false;
        verificationStatus = "not-requested";
        verifiedMetrics = { decisionDepth, routeLength: artifactRouteLength };
        bestKnownKind = "route-artifact";
      }
      progress.setBestKnown(bestKnownFromState(
        task,
        routeRecord.final.snapshot,
        bestKnownKind,
        claimedObjective,
        verifiedMetrics,
        objectiveValue && objectiveValue.value,
      ));
    }
  } else {
    routeRecord = null;
    const progressState = result && result.bestProgressState || (result && result.finalCandidates && result.finalCandidates[0] && result.finalCandidates[0].state);
    if (progressState) {
      progress.setBestKnown(bestKnownFromState(
        task,
        progressState,
        "progress-state",
        claimedObjective,
        {
          decisionDepth: getDecisionDepthSafe(progressState),
          routeLength: routeLengthOfState(progressState),
        },
      ));
    }
  }

  progress.setPhase("finalizing");
  progress.flush();
  return {
    result,
    proofClaim,
    routeRecord,
    strictReplayVerified,
    verificationStatus,
    objectiveValue,
    cancelled: false,
  };
}

function getDecisionDepthSafe(state) {
  const depth = state && state.meta && state.meta.decisionDepth;
  return Number.isFinite(Number(depth)) ? Number(depth) : null;
}

function executeInProcessExecutor({ job, task, onProgress, context }) {
  let stopRequested = false;
  const promise = executeSolveJob(task, {
    jobId: job.id,
    onProgress,
    shouldStop: () => stopRequested,
    context,
  });
  return {
    execute: () => promise,
    cancel: () => {
      stopRequested = true;
    },
    dispose: () => {},
  };
}

function finalizeJob(job, execution) {
  if (job.cancelRequested || execution.cancelled) {
    const failure = {
      failureClass: "CANCELLED",
      message: "The job was cancelled by request.",
      retryable: false,
      details: {},
    };
    job.failure = failure;
    job.result = buildSolverJobResult({
      jobId: job.id,
      task: job.task,
      status: "cancelled",
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: new Date().toISOString(),
      found: false,
      failure,
      proofClaim: null,
      objective: null,
      routeRecord: null,
      strictReplayVerified: false,
      diagnostics: { cancelled: true },
    });
    job.transition("cancelled");
    return;
  }
  const failure = classifyJobFailure({
    result: execution.result,
    proofClaim: execution.proofClaim,
  });
  if (failure) {
    job.failure = failure;
    job.result = buildSolverJobResult({
      jobId: job.id,
      task: job.task,
      status: "failed",
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: new Date().toISOString(),
      found: false,
      failure,
      proofClaim: execution.proofClaim || null,
      objective: null,
      routeRecord: execution.routeRecord || null,
      strictReplayVerified: false,
      diagnostics: buildDiagnosticsSummary(execution.result, execution.proofClaim),
    });
    job.transition("failed");
    return;
  }
  job.result = buildSolverJobResult({
    jobId: job.id,
    task: job.task,
    status: "completed",
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: new Date().toISOString(),
    found: true,
    failure: null,
    proofClaim: execution.proofClaim,
    objective: execution.objectiveValue,
    routeRecord: execution.routeRecord,
    strictReplayVerified: execution.strictReplayVerified,
    diagnostics: buildDiagnosticsSummary(execution.result, execution.proofClaim),
  });
  job.transition("completed");
}

module.exports = {
  JOB_STATES,
  SolverJob,
  SolverJobError,
  assertValidTransition,
  bestKnownFromState,
  buildDiagnosticsSummary,
  createStartState,
  executeInProcessExecutor,
  executeSolveJob,
  finalizeJob,
  makeSimulator,
};
