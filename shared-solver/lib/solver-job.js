"use strict";

const { loadProject } = require("./project-loader");
const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { StaticSimulator } = require("./simulator");
const { getMilestoneSpec } = require("./milestone-spec");
const { buildRegionMilestoneSpec, buildRegionProofClaim } = require("./region-spec");
const { runMilestoneGraph } = require("./segment-dp");
const { buildRouteRecord } = require("./route-store");
const { executeActionList } = require("./events");
const { applyFloorArrival } = require("./events");
const { cloneState } = require("./state");
const { buildStateKey } = require("./state-key");
const { verifyRouteObjective, replayRouteFile } = require("./live-replay");
const { SolverProgressAccumulator } = require("./solver-progress");
const { classifyJobFailure, buildSolverJobResult } = require("./solver-job-result");
const { SOLVE_TASK_SCHEMA } = require("./solve-task");
const { fingerprintJson } = require("./solve-task");

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
    const search = this.task && this.task.normalizedTask && this.task.normalizedTask.search;
    return {
      id: this.id,
      state: this.state,
      taskFingerprint: this.task && this.task.taskFingerprint || null,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      cancelRequested: this.cancelRequested,
      failure: this.failure || null,
      search: search
        ? {
          maxExpansions: search.maxExpansions,
          maxRuntimeMs: search.maxRuntimeMs,
          maxActionsPerState: search.maxActionsPerState,
        }
        : null,
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
  const objectiveEvaluation = objectiveValueOverride == null && task && task.objective && task.objective.explicit
    ? task.objective.evaluateState(objectiveStateFromSnapshot(state, metrics))
    : null;
  const hasExplicitObjective = task && task.objective && task.objective.explicit;
  return {
    kind,
    goalReached: kind === "goal-candidate" || kind === "verified-route" || kind === "route-artifact",
    verified: kind === "verified-route",
    floorId: state.floorId || null,
    decisionDepth: decisionDepth == null ? null : decisionDepth,
    routeLength: routeLength == null ? null : routeLength,
    routeLengthExact: routeLength != null,
    objectiveValue: objectiveValueOverride != null ? objectiveValueOverride : (objectiveEvaluation ? objectiveEvaluation.value : null),
    objectiveFingerprint: hasExplicitObjective ? task.objective.fingerprint : null,
    objectiveValueExact: hasExplicitObjective && (objectiveValueOverride != null || objectiveEvaluation != null),
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
        // runtime and verify every step + final snapshot.  The runtime returns
        // the true route length (auto-steps included).  The artifact's own
        // metadata is not treated as verification.
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
        // The 3-way objective reconciliation only applies when an explicit
        // ObjectiveSpec exists.  Legacy tasks without an objective verify the
        // route runtime replay only; objectiveValue stays null.
        if (objective && objective.explicit) {
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

// Exact state fingerprint for replay boundary proofs.  buildStateKey() is the
// DP identity and may omit direction/auto-event bookkeeping, so the region
// boundary replay must use a full-state hash instead.
function exactStateFingerprint(state) {
  if (!state) return null;
  const copy = cloneState(state);
  delete copy.route;
  delete copy.routeTrace;
  delete copy.meta;
  return fingerprintJson(copy);
}

// Unified region entry transition: "floor" records the SOURCE floor/loc into
// __leaveLoc__ BEFORE switching, switches floorId + loc + direction, and runs
// applyFloorArrival (firstArrive/eachArrive/auto events).  "initial" continues
// with the carried state.  Preflight rejects any other start type.
function applyRegionEntry(state, regionSpec, project, simulator) {
  const start = (regionSpec && regionSpec.start) || {};
  const type = start.type || "initial";
  if (type !== "floor") return state;
  const sourceFloorId = state.floorId;
  const sourceLoc = (state.hero && state.hero.loc) || { x: null, y: null, direction: null };
  if (!state.flags.__leaveLoc__) state.flags.__leaveLoc__ = {};
  state.flags.__leaveLoc__[sourceFloorId] = {
    x: sourceLoc.x,
    y: sourceLoc.y,
    direction: sourceLoc.direction,
  };
  state.floorId = start.floorId;
  state.hero.loc = {
    x: start.x,
    y: start.y,
    direction: start.direction || "down",
  };
  applyFloorArrival(project, state, start.floorId, {
    choiceResolver: simulator && simulator.choiceResolver,
  });
  return state;
}

// Carries the previous region's terminal frontier into the next region.  Full
// solver state (hero, inventory, flags, equipment, followers, floor mutations)
// is preserved.  Each output carries the input provenance + exact boundary
// fingerprint needed by the composite route / strict replay contracts.
function materializeNextRegionFrontier(previousTerminalFrontier, nextRegionSpec, options) {
  const project = options && options.project;
  const simulator = options && options.simulator;
  return (previousTerminalFrontier || []).map((candidate, index) => {
    const state = cloneState(candidate && candidate.state);
    applyRegionEntry(state, nextRegionSpec, project, simulator);
    const route = Array.isArray(candidate && candidate.route)
      ? candidate.route.slice()
      : Array.isArray(state && state.route) ? state.route.slice() : [];
    delete state.routeTrace;
    // Carry the route as ancestry/provenance; the DP state key excludes route,
    // and the region's own route record strips this prefix later.
    state.route = route;
    const inputStateFingerprint = safeStateKey(state);
    // The carried state (before entry transform) is what the previous region
    // produced; record it as the exact boundary input for replay.
    const carried = cloneState(candidate && candidate.state);
    delete carried.route;
    delete carried.routeTrace;
    delete carried.meta;
    return {
      id: (candidate && candidate.id) || `region-input-${index}`,
      state,
      route,
      tags: ["region-transition"],
      regionInputId: candidate && candidate.id || `region-input-${index}`,
      regionInputIndex: index,
      inputStateFingerprint,
      exactBoundaryStateFingerprint: exactStateFingerprint(state),
      inputCarriedExactFingerprint: fingerprintJson(carried),
      ancestry: {},
    };
  });
}

// Multi-region coordinate: region.id/index/current/total is distinct from
// the segment coordinate.  outgoingCandidates is the boundary frontier size.
function safeStateKey(state) {
  try {
    return buildStateKey(state);
  } catch (error) {
    return null;
  }
}

// Finds which input frontier candidate a merged/output candidate descended
// from, by matching the output route's prefix against the input route.
function findInputIndexForCandidate(candidate, inputFrontier) {
  const route = Array.isArray(candidate && candidate.route) ? candidate.route : [];
  for (let index = 0; index < (inputFrontier || []).length; index += 1) {
    const inputRoute = inputFrontier[index].route || [];
    if (inputRoute.length > route.length) continue;
    let match = true;
    for (let step = 0; step < inputRoute.length; step += 1) {
      const left = inputRoute[step];
      const right = route[step];
      const same = left === right || Boolean(left && right && left.summary === right.summary && left.index === right.index);
      if (!same) {
        match = false;
        break;
      }
    }
    if (match) return index;
  }
  return -1;
}

// Strictly sequential multi-region execution.  Each region receives the
// previous region's terminal frontier (materialized), runs the existing
// region/segment solver per input candidate, merges/prunes the terminal
// candidates at the region boundary (regionCandidateLimit), and passes the
// frontier onward.  A region failure stops the sequence.  The task-level
// objective only orders the FINAL region's terminal candidates.
async function executeSolveJobV2(task, {
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
  const rank = normalizedTask.tower.rank || "chaos";
  const regions = task && task.regions && task.regions.length > 0
    ? task.regions
    : [{ spec: normalizedTask.tower.region.spec, effectiveSearch: task.search }];
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
  const regionCandidateLimit = normalizedTask.search && normalizedTask.search.regionCandidateLimit != null
    ? Number(normalizedTask.search.regionCandidateLimit)
    : ((normalizedTask.search && normalizedTask.search.candidateLimit) || 8);

  const regionSummaries = [];
  const regionExecutions = [];
  let previousTerminalFrontier = null;
  let finalResult = null;
  let finalSimulator = null;
  let finalRegionSpec = null;
  let finalInputFrontier = null;

  for (let index = 0; index < regions.length; index += 1) {
    const regionEntry = regions[index];
    const regionSpec = regionEntry.spec || regionEntry;
    const isFinal = index === regions.length - 1;
    progress.setPhase("region-transition");
    const simulator = makeSimulator(project, regionSpec, task);
    const milestoneSpec = buildRegionMilestoneSpec(project, regionSpec);
    const inputFrontier = index === 0
      ? (() => {
        const startState = createStartState(project, simulator, regionSpec, rank);
        applyRegionEntry(startState, regionSpec, project, simulator);
        return [{
          id: "initial#0",
          state: startState,
          route: [],
          tags: ["initial"],
          regionInputIndex: 0,
          inputStateFingerprint: safeStateKey(startState),
          exactBoundaryStateFingerprint: exactStateFingerprint(startState),
          inputCarriedExactFingerprint: exactStateFingerprint(startState),
          ancestry: {},
        }];
      })()
      : materializeNextRegionFrontier(previousTerminalFrontier, regionSpec, {
        rank,
        project,
        simulator,
        solverModel: normalizedTask.model || null,
      });
    const incomingCandidates = inputFrontier.length;
    progress.setRegion({
      id: regionSpec.id,
      index,
      current: index + 1,
      total: regions.length,
      incomingCandidates,
      outgoingCandidates: 0,
    });
    progress.setPhase("segment-search");
    const result = runMilestoneGraph(simulator, inputFrontier[0].state, milestoneSpec, {
      ...(task && task.executeConfig || {}),
      objectiveSpec: isFinal ? objective : null,
      observer: createProgressObserver(progress),
      shouldStop: stopRequested,
      initialFrontier: inputFrontier,
    });
    if (stopRequested() || result.stoppedReason === "cancel-requested" || result.cancelled === true) {
      progress.setPhase("cancelled");
      progress.flush();
      return {
        result,
        proofClaim: null,
        routeRecord: null,
        strictReplayVerified: false,
        cancelled: true,
        regions: regionSummaries,
      };
    }
    let outgoing = Array.isArray(result.finalCandidates) ? result.finalCandidates : [];
    const boundaryTrimmed = outgoing.length > regionCandidateLimit;
    if (boundaryTrimmed) outgoing = outgoing.slice(0, regionCandidateLimit);
    // Attach input provenance to every boundary candidate so the next region's
    // route/replay contracts know which carried state each candidate came from.
    outgoing = outgoing.map((candidate, outIndex) => {
      const inputIndex = findInputIndexForCandidate(candidate, inputFrontier);
      const input = inputIndex >= 0 ? inputFrontier[inputIndex] : null;
      return {
        ...candidate,
        regionInputIndex: inputIndex,
        regionInputId: input ? input.id : null,
        inputStateFingerprint: input ? input.inputStateFingerprint : null,
        ancestry: input ? { ...(input.ancestry || {}) } : {},
      };
    });
    const regionSummary = {
      index,
      id: regionSpec.id,
      status: result.found ? "completed" : "failed",
      incomingCandidates,
      outgoingCandidates: outgoing.length,
      regionCandidateLimit,
      boundaryTrimmed,
      failure: result.found ? null : ({
        failureClass: (result.failedSegment && result.failedSegment.failureClass) || "REGION_NOT_REACHED",
        segmentId: result.failedSegment && result.failedSegment.segmentId || null,
        message: (result.failedSegment && (result.failedSegment.failureReason || result.failedSegment.failureClass)) || "region goal not reached",
        retryable: Boolean(result.failedSegment && result.failedSegment.failurePropagation && result.failedSegment.failurePropagation.retryable),
      }),    };
    regionSummaries.push(regionSummary);
    progress.setRegion({
      ...(progress.region || {}),
      outgoingCandidates: outgoing.length,
      boundaryTrimmed,
    });
    if (!result.found) {
      progress.setPhase("failed");
      progress.flush();
      return {
        result,
        proofClaim: null,
        routeRecord: null,
        strictReplayVerified: false,
        cancelled: false,
        regions: regionSummaries,
      };
    }
    previousTerminalFrontier = outgoing;
    finalResult = result;
    finalSimulator = simulator;
    finalRegionSpec = regionSpec;
    finalInputFrontier = inputFrontier;
    regionExecutions.push({ regionSpec, simulator, inputFrontier, result });
  }

  // Final region: proof claim + per-region route records + composite
  // multi-region-route.v1 + sequential strict replay.  The task-level objective
  // orders the FINAL region's terminal candidates and is the only objective.
  progress.setSegment(null);
  const proofClaim = buildRegionProofClaim(finalResult, finalRegionSpec, objective);
  progress.setProof(proofClaim.objective || null);
  const claimedObjective = (proofClaim && proofClaim.objective && proofClaim.objective.claim) || "candidate-only";

  let routeRecord = null;
  let strictReplayVerified = false;
  let verificationStatus = null;
  let objectiveValue = null;

  const buildRegionRouteRecord = (execution, regionIndex) => {
    const result = execution.result;
    if (!result.found || !result.finalCandidate || !result.finalCandidate.state) return null;
    const candidate = result.finalCandidate;
    // Resolve the WINNING candidate's actual input state (never index 0).
    let input = null;
    const provenIndex = candidate.regionInputIndex;
    if (provenIndex != null && provenIndex >= 0 && execution.inputFrontier[provenIndex]) {
      input = execution.inputFrontier[provenIndex];
    } else {
      const matchedIndex = findInputIndexForCandidate(candidate, execution.inputFrontier);
      if (matchedIndex >= 0) input = execution.inputFrontier[matchedIndex];
    }
    input = input || execution.inputFrontier[0];
    const initialState = input.state;
    const finalState = candidate.state;
    const inputRouteLength = Array.isArray(input.route) ? input.route.length : 0;
    const candidateRoute = Array.isArray(candidate.route) ? candidate.route : [];
    finalState.route = candidateRoute.length > inputRouteLength
      ? candidateRoute.slice(inputRouteLength)
      : [];
    const regionObjective = regionIndex === regions.length - 1 ? objective : null;
    const record = buildRouteRecord({
      project,
      simulator: execution.simulator,
      initialState,
      finalState,
      options: {
        projectRoot,
        solver: "solve-task",
        profile: execution.regionSpec.id,
        rank,
        toFloor: finalState.floorId,
        goalType: "region",
        snapshotFloors: (execution.regionSpec.scope || {}).floors,
        metadata: {
          kind: "region-dp",
          regionDp: {
            regionId: execution.regionSpec.id,
            taskFingerprint: task && task.taskFingerprint || null,
            proofClaim,
            candidateLimit: (task && task.executeConfig && task.executeConfig.candidateLimit) || null,
            search: normalizedTask.search || null,
            regionIndex,
            regionTotal: regions.length,
          },
        },
        objectiveSpec: regionObjective,
      },
    });
    const outputExact = exactStateFingerprint(finalState);
    return { record, input, outputExact, regionObjective };
  };

  // Build per-region route records (all regions, not just the final).
  const regionRecords = [];
  for (let index = 0; index < regionExecutions.length; index += 1) {
    regionRecords.push(buildRegionRouteRecord(regionExecutions[index], index));
  }

  if (finalResult.found && finalResult.finalCandidate && finalResult.finalCandidate.state) {
    progress.setBestKnown(bestKnownFromState(
      task,
      finalResult.finalCandidate.state,
      "goal-candidate",
      claimedObjective,
      {
        decisionDepth: getDecisionDepthSafe(finalResult.finalCandidate.state),
        routeLength: routeLengthOfState(finalResult.finalCandidate.state),
      },
    ));
    progress.setPhase("route-build");

    // Boundary fingerprint contract: the next region's carried exact state must
    // equal the previous region's output exact state.
    let boundaryFingerprintsMatch = true;
    for (let index = 1; index < regionExecutions.length; index += 1) {
      const prevOutput = regionRecords[index - 1] && regionRecords[index - 1].outputExact;
      const nextCarried = regionExecutions[index].inputFrontier[0].inputCarriedExactFingerprint;
      if (prevOutput != null && nextCarried != null && prevOutput !== nextCarried) {
        boundaryFingerprintsMatch = false;
        break;
      }
    }

    const composite = {
      schema: "motapathfinder.multi-region-route.v1",
      createdAt: new Date().toISOString(),
      regions: regionRecords.map((built, index) => ({
        index,
        regionId: regionExecutions[index].regionSpec.id,
        record: built && built.record || null,
        inputStateFingerprint: regionExecutions[index].inputFrontier[0].inputStateFingerprint || null,
        exactBoundaryStateFingerprint: regionExecutions[index].inputFrontier[0].exactBoundaryStateFingerprint || null,
        outputExactBoundaryStateFingerprint: built && built.outputExact || null,
      })),
      boundaryFingerprintsMatch,
      verificationStatus: null,
    };
    routeRecord = composite;

    progress.setPhase("strict-replay");
    if (normalizedTask.verification.strictReplay !== false) {
      // Sequential strict replay: every region's route replays in the real
      // runtime in order, and every region boundary fingerprint must match.
      let allVerified = true;
      try {
        for (let index = 0; index < regionRecords.length; index += 1) {
          const built = regionRecords[index];
          if (!built || !built.record) {
            allVerified = false;
            break;
          }
          await replayRouteFile(built.record, {
            projectRoot,
            headless: "1",
            keepOpen: false,
            timeoutMs: 60000,
            stepDelayMs: 0,
            fastForwardDelayMs: 0,
            runtimeAutoBattle: 1,
          });
        }
      } catch (error) {
        throw makeStrictReplayFailure(error);
      }
      if (allVerified && boundaryFingerprintsMatch) {
        strictReplayVerified = true;
        verificationStatus = "verified";
      } else {
        throw makeStrictReplayFailure(new Error(
          boundaryFingerprintsMatch
            ? "a region route failed runtime replay"
            : "region boundary state fingerprints do not match",
        ));
      }
      // Final-region objective reconciliation (task-level objective).
      const finalBuilt = regionRecords[regionRecords.length - 1];
      objectiveValue = objectiveValueFromRouteRecord(task, finalBuilt && finalBuilt.record);
      if (objective && objective.explicit) {
        const metadataValue = finalBuilt && finalBuilt.record && finalBuilt.record.metadata && finalBuilt.record.metadata.finalObjectiveValue;
        if (objectiveValue == null || stableObjectiveValue(metadataValue) !== stableObjectiveValue(objectiveValue.value)) {
          throw makeStrictReplayFailure(new Error(
            `objective value mismatch: result=${JSON.stringify(objectiveValue.value)} metadata=${JSON.stringify(metadataValue)}`,
          ));
        }
      }
      const finalSnapshot = finalBuilt && finalBuilt.record && finalBuilt.record.final && finalBuilt.record.final.snapshot;
      progress.setBestKnown(bestKnownFromState(
        task,
        finalSnapshot,
        "verified-route",
        claimedObjective,
        {
          decisionDepth: (finalBuilt && finalBuilt.record && finalBuilt.record.decisions || []).length,
          routeLength: (finalBuilt && finalBuilt.record && finalBuilt.record.stats && finalBuilt.record.stats.routeLength) != null
            ? Number(finalBuilt.record.stats.routeLength)
            : null,
        },
        objectiveValue && objectiveValue.value,
      ));
      composite.verificationStatus = "verified";
    } else {
      strictReplayVerified = false;
      verificationStatus = "not-requested";
      composite.verificationStatus = "not-requested";
      const lastBuilt = regionRecords[regionRecords.length - 1];
      const lastSnapshot = lastBuilt && lastBuilt.record && lastBuilt.record.final && lastBuilt.record.final.snapshot;
      const lastObjective = objectiveValueFromRouteRecord(task, lastBuilt && lastBuilt.record);
      progress.setBestKnown(bestKnownFromState(
        task,
        lastSnapshot,
        "route-artifact",
        claimedObjective,
        {
          decisionDepth: (lastBuilt && lastBuilt.record && lastBuilt.record.decisions || []).length,
          routeLength: (lastBuilt && lastBuilt.record && lastBuilt.record.stats && lastBuilt.record.stats.routeLength) != null
            ? Number(lastBuilt.record.stats.routeLength)
            : null,
        },
        lastObjective && lastObjective.value,
      ));
    }
  } else {
    routeRecord = null;
    const progressState = finalResult && finalResult.bestProgressState || (finalResult && finalResult.finalCandidates && finalResult.finalCandidates[0] && finalResult.finalCandidates[0].state);
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
    result: finalResult,
    proofClaim,
    routeRecord,
    strictReplayVerified,
    verificationStatus,
    objectiveValue,
    cancelled: false,
    regions: regionSummaries,
  };
}
function executeInProcessExecutor({ job, task, onProgress, context }) {
  let stopRequested = false;
  const runner = task && task.schema === "motapathfinder.solve-task.v2"
    ? executeSolveJobV2
    : executeSolveJob;
  const promise = runner(task, {
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
      regions: execution.regions || null,
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
    verificationStatus: execution.verificationStatus,
    regions: execution.regions || null,
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
  executeSolveJobV2,
  exactStateFingerprint,
  finalizeJob,
  makeSimulator,
  materializeNextRegionFrontier,
};
