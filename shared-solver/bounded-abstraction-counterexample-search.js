"use strict";

/**
 * PR-4.5b3 — True Off-Diagonal Regression Control
 *
 * This runner is deliberately shadow-only. It reads a manifest-driven corpus,
 * performs bounded paired expansion from projection collisions, and records a
 * shortest action-labelled mismatch witness when one is found. It does not
 * change the production DP key, dominance, agenda, capacity, or strategy.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  actionSignature,
  applyActionSuccessors,
  displayAction,
  enumeratePrimitiveActions,
  makeSimulator,
  replayDecisionWindow,
  safeStateKey,
  shadowProjectionKey,
} = require("./audit-state-abstraction");
const { loadProject } = require("./lib/project-loader");
const { buildStateKey } = require("./lib/state-key");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST = path.resolve(__dirname, "profiles", "state-abstraction-corpus.json");
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5b-bounded-abstraction-counterexample-search.json",
);
const DEFAULT_OUT_MD = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5b-bounded-abstraction-counterexample-search.md",
);

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function gitCommit() {
  try {
    return require("node:child_process")
      .execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" })
      .trim();
  } catch (error) {
    return null;
  }
}

function resolveWorkspacePath(file) {
  return path.resolve(ROOT, file);
}

function makeRealAdapter(simulator) {
  return {
    enumerate(state) {
      return enumeratePrimitiveActions(simulator, state);
    },
    apply(state, action) {
      return applyActionSuccessors(simulator, state, action);
    },
    actionId(action) {
      return actionSignature(simulator, action);
    },
    displayAction,
    exactKey: safeStateKey,
    projectionKey: shadowProjectionKey,
  };
}

function buildActionTable(adapter, state) {
  const enumeration = adapter.enumerate(state) || { actions: [], errors: [] };
  const byId = new Map();
  const actionErrors = [];
  const duplicateActionIds = [];
  for (const action of (enumeration.actions || []).filter(Boolean)) {
    const id = adapter.actionId(action);
    if (byId.has(id)) {
      if (!duplicateActionIds.includes(id)) duplicateActionIds.push(id);
      continue;
    }
    const applied = adapter.apply(state, action) || { successors: [], errors: [] };
    const successors = (applied.successors || []).filter(Boolean).map((successor) => ({
      state: successor,
      exactKey: adapter.exactKey(successor),
      projectedKey: adapter.projectionKey(successor),
    }));
    if ((applied.errors || []).length > 0) {
      actionErrors.push({
        id,
        action: adapter.displayAction(action),
        errors: applied.errors,
      });
    }
    byId.set(id, {
      id,
      action: adapter.displayAction(action),
      exactSuccessors: successors.map((entry) => entry.exactKey).filter(Boolean).sort(),
      projectedSuccessors: successors.map((entry) => entry.projectedKey).sort(),
      successors,
    });
  }
  const actions = Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
  return {
    actions,
    enumerationErrors: enumeration.errors || [],
    actionErrors,
    duplicateActionIds,
    noEnumerationErrors: (enumeration.errors || []).length === 0,
    noActionApplicationErrors: actionErrors.length === 0,
    noDuplicateActionIds: duplicateActionIds.length === 0,
  };
}

function comparePairedActionTables(left, right) {
  const leftMap = new Map(left.actions.map((entry) => [entry.id, entry]));
  const rightMap = new Map(right.actions.map((entry) => [entry.id, entry]));
  const leftOnly = Array.from(leftMap.keys()).filter((id) => !rightMap.has(id)).sort();
  const rightOnly = Array.from(rightMap.keys()).filter((id) => !leftMap.has(id)).sort();
  const common = Array.from(leftMap.keys()).filter((id) => rightMap.has(id)).sort();
  const successorMismatches = [];
  common.forEach((id) => {
    const leftAction = leftMap.get(id);
    const rightAction = rightMap.get(id);
    const exactEqual = canonicalJson(leftAction.exactSuccessors) === canonicalJson(rightAction.exactSuccessors);
    const projectedEqual = canonicalJson(leftAction.projectedSuccessors) === canonicalJson(rightAction.projectedSuccessors);
    if (!exactEqual || !projectedEqual) {
      successorMismatches.push({
        id,
        exactEqual,
        projectedEqual,
        leftExactSuccessors: leftAction.exactSuccessors,
        rightExactSuccessors: rightAction.exactSuccessors,
        leftProjectedSuccessors: leftAction.projectedSuccessors,
        rightProjectedSuccessors: rightAction.projectedSuccessors,
      });
    }
  });
  const actionSetEquivalent = leftOnly.length === 0 && rightOnly.length === 0;
  const noEnumerationErrors = left.noEnumerationErrors && right.noEnumerationErrors;
  const noActionApplicationErrors = left.noActionApplicationErrors && right.noActionApplicationErrors;
  const noDuplicateActionIds = left.noDuplicateActionIds && right.noDuplicateActionIds;
  return {
    actionSetEquivalent,
    leftOnlyActions: leftOnly,
    rightOnlyActions: rightOnly,
    commonActionCount: common.length,
    successorMismatches,
    successorMismatchCount: successorMismatches.length,
    noEnumerationErrors,
    noActionApplicationErrors,
    noDuplicateActionIds,
    duplicateActionIds: {
      left: left.duplicateActionIds,
      right: right.duplicateActionIds,
    },
    projectedSuccessorRelationEquivalent: actionSetEquivalent &&
      successorMismatches.every((entry) => entry.projectedEqual) &&
      noEnumerationErrors &&
      noActionApplicationErrors &&
      noDuplicateActionIds,
    exactSuccessorRelationEquivalent: actionSetEquivalent &&
      successorMismatches.every((entry) => entry.exactEqual) &&
      noEnumerationErrors &&
      noActionApplicationErrors &&
      noDuplicateActionIds,
  };
}

function sortSuccessors(entries) {
  return entries.slice().sort((left, right) => {
    const leftKey = `${left.projectedKey}|${left.exactKey}`;
    const rightKey = `${right.projectedKey}|${right.exactKey}`;
    return leftKey.localeCompare(rightKey);
  });
}

function pairSuccessors(leftAction, rightAction) {
  const leftByProjection = new Map();
  const rightByProjection = new Map();
  sortSuccessors(leftAction.successors).forEach((entry) => {
    if (!leftByProjection.has(entry.projectedKey)) leftByProjection.set(entry.projectedKey, []);
    leftByProjection.get(entry.projectedKey).push(entry);
  });
  sortSuccessors(rightAction.successors).forEach((entry) => {
    if (!rightByProjection.has(entry.projectedKey)) rightByProjection.set(entry.projectedKey, []);
    rightByProjection.get(entry.projectedKey).push(entry);
  });
  const pairs = [];
  let generatedCrossProductPairCount = 0;
  const projectionKeys = Array.from(leftByProjection.keys())
    .filter((key) => rightByProjection.has(key))
    .sort();
  for (const projectionKey of projectionKeys) {
    const leftEntries = leftByProjection.get(projectionKey);
    const rightEntries = rightByProjection.get(projectionKey);
    for (const leftEntry of leftEntries) {
      for (const rightEntry of rightEntries) {
        pairs.push({ left: leftEntry.state, right: rightEntry.state });
        generatedCrossProductPairCount += 1;
      }
    }
  }
  return { pairs, generatedCrossProductPairCount };
}

function initialPairEvidence(adapter, left, right) {
  const leftExactKey = adapter.exactKey(left);
  const rightExactKey = adapter.exactKey(right);
  const leftProjectionKey = adapter.projectionKey(left);
  const rightProjectionKey = adapter.projectionKey(right);
  return {
    exactKeyHashes: {
      left: hash(leftExactKey),
      right: hash(rightExactKey),
    },
    projectionKeyHashes: {
      left: hash(leftProjectionKey),
      right: hash(rightProjectionKey),
    },
    projectionEqual: leftProjectionKey === rightProjectionKey,
  };
}

function buildMismatchWitness(root, node, comparison, adapter) {
  const actionSetMismatch = !comparison.actionSetEquivalent;
  const firstProjectedMismatch = comparison.successorMismatches.find((entry) => entry.projectedEqual === false) || null;
  if (!actionSetMismatch && !firstProjectedMismatch) {
    throw new Error("Projected relation mismatch must include a projected successor mismatch");
  }
  return {
    rootId: root.id || null,
    rootDecision: root.decision == null ? null : root.decision,
    initialPair: root.initialPair,
    currentPair: initialPairEvidence(adapter, node.left, node.right),
    sharedActionSequence: node.sequence,
    firstUnmatched: {
      depth: node.depth,
      kind: actionSetMismatch ? "action-set-mismatch" : "projected-successor-relation-mismatch",
      actionId: actionSetMismatch
        ? (comparison.rightOnlyActions[0] || comparison.leftOnlyActions[0] || null)
        : firstProjectedMismatch.id,
      leftOnlyActions: comparison.leftOnlyActions.slice(0, 20),
      rightOnlyActions: comparison.rightOnlyActions.slice(0, 20),
      successorMismatch: actionSetMismatch ? null : firstProjectedMismatch,
    },
  };
}

function emptyExpansionTelemetry() {
  return {
    multiSuccessorActionCount: 0,
    maxSuccessorsPerAction: 0,
    generatedCrossProductPairCount: 0,
    exactRejoinObserved: false,
  };
}

function observeActionMultiplicity(telemetry, leftTable, rightTable) {
  const rightById = new Map(rightTable.actions.map((entry) => [entry.id, entry]));
  leftTable.actions.forEach((leftAction) => {
    const rightAction = rightById.get(leftAction.id);
    if (!rightAction) return;
    const maxSuccessors = Math.max(leftAction.successors.length, rightAction.successors.length);
    telemetry.maxSuccessorsPerAction = Math.max(telemetry.maxSuccessorsPerAction, maxSuccessors);
    if (maxSuccessors > 1) telemetry.multiSuccessorActionCount += 1;
  });
}

function executionErrorEvidence(leftTable, rightTable) {
  return {
    leftEnumerationErrors: leftTable.enumerationErrors,
    rightEnumerationErrors: rightTable.enumerationErrors,
    leftActionErrors: leftTable.actionErrors,
    rightActionErrors: rightTable.actionErrors,
    leftDuplicateActionIds: leftTable.duplicateActionIds,
    rightDuplicateActionIds: rightTable.duplicateActionIds,
  };
}

function makeIncompleteResult(config, node, depthReached, expandedPairCount, generatedPairCount, levels, telemetry, reason, leftTable, rightTable) {
  const budgetReason = reason === "state-cap" || reason === "branch-cap";
  return {
    outcome: "incomplete",
    depth: config.depth,
    depthReached,
    expandedPairCount,
    generatedPairCount,
    budgetExhausted: budgetReason,
    exhaustedReason: budgetReason ? reason : null,
    incompleteReason: reason,
    branchCap: config.branchCap,
    stateCap: config.stateCap,
    levels,
    ...telemetry,
    executionErrors: leftTable && rightTable ? executionErrorEvidence(leftTable, rightTable) : null,
    witness: null,
    uncheckedNodeDepth: node ? node.depth : null,
  };
}

function runPairedExpansion(root, adapter, options) {
  const suppliedOptions = options || {};
  const config = {
    depth: Math.max(0, Number(suppliedOptions.depth ?? 2)),
    branchCap: Math.max(1, Number(suppliedOptions.branchCap ?? 32)),
    stateCap: Math.max(1, Number(suppliedOptions.stateCap ?? 256)),
  };
  const initialPair = root.initialPair || initialPairEvidence(adapter, root.left, root.right);
  if (!initialPair.projectionEqual) {
    return {
      outcome: "mismatch-witness",
      depth: 0,
      depthReached: 0,
      expandedPairCount: 0,
      generatedPairCount: 1,
      budgetExhausted: false,
      exhaustedReason: null,
      incompleteReason: null,
      branchCap: config.branchCap,
      stateCap: config.stateCap,
      ...emptyExpansionTelemetry(),
      executionErrors: null,
      uncheckedNodeDepth: null,
      witness: {
        initialPair,
        sharedActionSequence: [],
        firstUnmatched: {
          depth: 0,
          kind: "initial-projection-mismatch",
          actionId: null,
          leftOnlyActions: [],
          rightOnlyActions: [],
          successorMismatch: null,
        },
      },
    };
  }

  const queue = [{ left: root.left, right: root.right, depth: 0, sequence: [] }];
  const levels = [];
  let expandedPairCount = 0;
  let generatedPairCount = 1;
  let depthReached = 0;
  let budgetExhausted = false;
  let exhaustedReason = null;
  const telemetry = emptyExpansionTelemetry();
  while (queue.length > 0) {
    const node = queue.shift();
    depthReached = Math.max(depthReached, node.depth);
    if (expandedPairCount >= config.stateCap) {
      budgetExhausted = true;
      exhaustedReason = "state-cap";
      break;
    }
    if (node.depth > 0 && adapter.exactKey(node.left) === adapter.exactKey(node.right)) {
      telemetry.exactRejoinObserved = true;
    }
    const leftTable = buildActionTable(adapter, node.left);
    const rightTable = buildActionTable(adapter, node.right);
    const comparison = comparePairedActionTables(leftTable, rightTable);
    observeActionMultiplicity(telemetry, leftTable, rightTable);
    if (!comparison.noEnumerationErrors) {
      return makeIncompleteResult(config, node, depthReached, expandedPairCount, generatedPairCount, levels, telemetry, "enumeration-error", leftTable, rightTable);
    }
    if (!comparison.noActionApplicationErrors) {
      return makeIncompleteResult(config, node, depthReached, expandedPairCount, generatedPairCount, levels, telemetry, "action-application-error", leftTable, rightTable);
    }
    if (!comparison.noDuplicateActionIds) {
      return makeIncompleteResult(config, node, depthReached, expandedPairCount, generatedPairCount, levels, telemetry, "duplicate-action-id", leftTable, rightTable);
    }
    if (leftTable.actions.length > config.branchCap || rightTable.actions.length > config.branchCap) {
      budgetExhausted = true;
      exhaustedReason = "branch-cap";
      break;
    }
    expandedPairCount += 1;
    const level = levels.find((entry) => entry.depth === node.depth);
    if (level) level.expandedPairCount += 1;
    else levels.push({ depth: node.depth, expandedPairCount: 1 });
    if (!comparison.projectedSuccessorRelationEquivalent) {
      return {
        outcome: "mismatch-witness",
        depth: config.depth,
        depthReached,
        expandedPairCount,
        generatedPairCount,
        budgetExhausted: false,
        exhaustedReason: null,
        incompleteReason: null,
        branchCap: config.branchCap,
        stateCap: config.stateCap,
        levels,
        ...telemetry,
        executionErrors: null,
        uncheckedNodeDepth: null,
        witness: buildMismatchWitness(root, node, comparison, adapter),
      };
    }
    if (node.depth >= config.depth) continue;
    const leftMap = new Map(leftTable.actions.map((entry) => [entry.id, entry]));
    const rightMap = new Map(rightTable.actions.map((entry) => [entry.id, entry]));
    const commonIds = Array.from(leftMap.keys()).filter((id) => rightMap.has(id)).sort();
    for (const id of commonIds) {
      const paired = pairSuccessors(leftMap.get(id), rightMap.get(id));
      for (const pair of paired.pairs) {
        if (generatedPairCount >= config.stateCap) {
          budgetExhausted = true;
          exhaustedReason = "state-cap";
          break;
        }
        queue.push({
          left: pair.left,
          right: pair.right,
          depth: node.depth + 1,
          sequence: node.sequence.concat({
            id,
            action: leftMap.get(id).action,
          }),
        });
        generatedPairCount += 1;
        telemetry.generatedCrossProductPairCount += 1;
      }
      if (budgetExhausted) break;
    }
    if (budgetExhausted) break;
  }
  if (budgetExhausted || queue.length > 0) {
    return makeIncompleteResult(
      config,
      queue[0] || null,
      depthReached,
      expandedPairCount,
      generatedPairCount,
      levels,
      telemetry,
      exhaustedReason || "state-cap",
      null,
      null,
    );
  }
  return {
    outcome: "equivalent",
    depth: config.depth,
    depthReached,
    expandedPairCount,
    generatedPairCount,
    budgetExhausted: false,
    exhaustedReason: null,
    incompleteReason: null,
    branchCap: config.branchCap,
    stateCap: config.stateCap,
    levels,
    ...telemetry,
    executionErrors: null,
    uncheckedNodeDepth: null,
    witness: null,
  };
}

function getCheckpoint(report, segmentId) {
  return report && report.candidate2NaturalRun && report.candidate2NaturalRun.search &&
    (report.candidate2NaturalRun.search.checkpointResults || []).find((entry) => entry.segmentId === segmentId) || null;
}

function getCandidateFromCheckpoint(checkpoint, candidateId) {
  return checkpoint && (checkpoint.candidates || []).find((candidate) => candidate.id === candidateId) || null;
}

function buildPositiveRoots(spec, simulator) {
  const sourceReportPath = resolveWorkspacePath(spec.sourceReport);
  const ancestryReportPath = resolveWorkspacePath(spec.ancestryReport);
  const sourceReport = readJson(sourceReportPath);
  const ancestryReport = readJson(ancestryReportPath);
  const candidateCheckpoint = getCheckpoint(sourceReport, spec.candidateCheckpoint);
  const routeCheckpoint = getCheckpoint(sourceReport, spec.routeCheckpoint);
  const leftCandidate = getCandidateFromCheckpoint(candidateCheckpoint, spec.leftCandidateId);
  const rightCandidate = getCandidateFromCheckpoint(candidateCheckpoint, spec.rightCandidateId);
  const routeCandidate = routeCheckpoint && routeCheckpoint.candidates && routeCheckpoint.candidates[0];
  if (!leftCandidate || !rightCandidate || !routeCandidate) {
    throw new Error(`PR-4.5b manifest entry ${spec.id} could not resolve both candidates and route candidate`);
  }
  const sequences = {
    left: replayDecisionWindow(simulator, leftCandidate, routeCandidate.route || [], spec.startDecision, spec.endDecision, spec.routeDecisionOffset),
    right: replayDecisionWindow(simulator, rightCandidate, routeCandidate.route || [], spec.startDecision, spec.endDecision, spec.routeDecisionOffset),
  };
  const replayErrors = sequences.left.errors.concat(sequences.right.errors);
  const roots = [];
  for (let decision = spec.startDecision; decision <= spec.endDecision; decision += 1) {
    const left = sequences.left.states.get(decision);
    const right = sequences.right.states.get(decision);
    if (!left || !right) continue;
    const initialPair = initialPairEvidence(makeRealAdapter(simulator), left, right);
    if (!initialPair.projectionEqual) continue;
    roots.push({
      id: `${spec.id}@decision-${decision}`,
      decision,
      left,
      right,
      initialPair,
    });
  }
  const ancestryComparison = ancestryReport.ancestryComparison || {};
  const candidateExactKeysMatchArtifact = Boolean(
    ancestryComparison.winningBranch &&
    ancestryComparison.teacherLocalBranch &&
    safeStateKey(leftCandidate.state) === ancestryComparison.winningBranch.winningLocalExactStateKey &&
    safeStateKey(rightCandidate.state) === ancestryComparison.teacherLocalBranch.teacherLocalExactStateKey,
  );
  return {
    sourceReportPath,
    ancestryReportPath,
    replayErrors,
    candidateExactKeysMatchArtifact,
    leftActionCount: sequences.left.actions.length,
    rightActionCount: sequences.right.actions.length,
    expectedDecisionCount: spec.endDecision - spec.startDecision + 1,
    roots,
  };
}

function makeSyntheticNegativeControl() {
  const left = {
    floorId: "MT2",
    hero: { x: 6, y: 0 },
    mutations: [{ floorId: "MT1", removed: ["historical-gate"] }],
  };
  const right = {
    floorId: "MT2",
    hero: { x: 6, y: 0 },
    mutations: [{ floorId: "MT1", removed: [] }],
  };
  const adapter = {
    enumerate(state) {
      if (state.floorId === "MT2") return { actions: [{ id: "reenter-MT1" }], errors: [] };
      const actions = [{ id: "leave-MT2" }];
      const mutation = (state.mutations || []).find((entry) => entry.floorId === "MT1");
      if (!(mutation && mutation.removed || []).includes("historical-gate")) {
        actions.push({ id: "historical-tile@MT1" });
      }
      return { actions, errors: [] };
    },
    apply(state, action) {
      if (action.id === "reenter-MT1") return { successors: [{ ...state, floorId: "MT1" }], errors: [] };
      if (action.id === "leave-MT2") return { successors: [{ ...state, floorId: "MT2" }], errors: [] };
      return { successors: [{ ...state }], errors: [] };
    },
    actionId(action) {
      return action.id;
    },
    displayAction(action) {
      return { id: action.id };
    },
    exactKey(state) {
      return canonicalJson(state);
    },
    projectionKey(state) {
      // Deliberately unsafe negative-control projection: all mutation history
      // is omitted, including after the pair re-enters MT1.
      return canonicalJson({ floorId: state.floorId, hero: state.hero });
    },
  };
  return {
    adapter,
    root: {
      id: "synthetic-reentry-hidden-mutation-v1",
      decision: 0,
      left,
      right,
      initialPair: initialPairEvidence(adapter, left, right),
    },
  };
}

function makeSyntheticDepthBoundaryControl() {
  const left = {
    floorId: "MT2",
    hero: { x: 6, y: 0 },
    historyZone: false,
    mutations: [{ floorId: "MT1", removed: ["historical-gate"] }],
  };
  const right = {
    floorId: "MT2",
    hero: { x: 6, y: 0 },
    historyZone: false,
    mutations: [{ floorId: "MT1", removed: [] }],
  };
  const adapter = {
    enumerate(state) {
      if (state.floorId === "MT2") return { actions: [{ id: "reenter-MT1" }], errors: [] };
      if (!state.historyZone) return { actions: [{ id: "enter-history-zone" }], errors: [] };
      const actions = [{ id: "leave-MT2" }];
      const mutation = (state.mutations || []).find((entry) => entry.floorId === "MT1");
      if (!(mutation && mutation.removed || []).includes("historical-gate")) {
        actions.push({ id: "historical-tile@MT1" });
      }
      return { actions, errors: [] };
    },
    apply(state, action) {
      if (action.id === "reenter-MT1") return { successors: [{ ...state, floorId: "MT1" }], errors: [] };
      if (action.id === "enter-history-zone") return { successors: [{ ...state, historyZone: true }], errors: [] };
      if (action.id === "leave-MT2") return { successors: [{ ...state, floorId: "MT2" }], errors: [] };
      return { successors: [{ ...state }], errors: [] };
    },
    actionId(action) {
      return action.id;
    },
    displayAction(action) {
      return { id: action.id };
    },
    exactKey(state) {
      return canonicalJson(state);
    },
    projectionKey(state) {
      // Keep the re-entry and history-zone sequence visible, but omit the
      // hidden mutation that is supposed to be caught at depth two.
      return canonicalJson({ floorId: state.floorId, hero: state.hero, historyZone: state.historyZone });
    },
  };
  return {
    adapter,
    root: {
      id: "synthetic-reentry-depth-boundary-v1",
      decision: 0,
      left,
      right,
      initialPair: initialPairEvidence(adapter, left, right),
    },
  };
}

function makeSyntheticOffDiagonalControl() {
  const left = { floorId: "MT2", side: "left", variant: "root" };
  const right = { floorId: "MT2", side: "right", variant: "root" };
  const adapter = {
    enumerate(state) {
      if (state.variant === "root") return { actions: [{ id: "branch" }], errors: [] };
      const lane = state.variant.endsWith("1") ? "lane-1" : "lane-2";
      return {
        actions: [{ id: lane }],
        errors: [],
      };
    },
    apply(state, action) {
      if (action.id === "branch") {
        const variants = state.side === "left" ? ["L1", "L2"] : ["R1", "R2"];
        return {
          successors: variants.map((variant) => ({ ...state, variant })),
          errors: [],
        };
      }
      return { successors: [], errors: [] };
    },
    actionId(action) {
      return action.id;
    },
    displayAction(action) {
      return { id: action.id };
    },
    exactKey(state) {
      return canonicalJson(state);
    },
    projectionKey(state) {
      return canonicalJson({ floorId: state.floorId });
    },
  };
  return {
    adapter,
    root: {
      id: "synthetic-off-diagonal-successor-v1",
      decision: 0,
      left,
      right,
      initialPair: initialPairEvidence(adapter, left, right),
    },
  };
}

function makeSyntheticExecutionErrorControl(kind) {
  const control = makeSyntheticNegativeControl();
  const baseAdapter = control.adapter;
  const adapter = {
    ...baseAdapter,
    enumerate(state) {
      if (kind === "enumeration-error") {
        return { actions: [], errors: [{ message: "synthetic enumeration failure" }] };
      }
      const result = baseAdapter.enumerate(state);
      if (kind === "duplicate-action-id") {
        return { actions: result.actions.concat(result.actions), errors: result.errors };
      }
      return result;
    },
    apply(state, action) {
      if (kind === "action-application-error") {
        return { successors: [], errors: [{ message: "synthetic action application failure" }] };
      }
      return baseAdapter.apply(state, action);
    },
  };
  return {
    adapter,
    root: {
      ...control.root,
      id: `synthetic-${kind}-v1`,
      initialPair: initialPairEvidence(adapter, control.root.left, control.root.right),
    },
  };
}

function outcomeOf(results) {
  if (results.some((result) => result.outcome === "incomplete")) return "incomplete";
  if (results.some((result) => result.outcome === "mismatch-witness")) return "mismatch-witness";
  return "equivalent";
}

function buildMarkdown(report) {
  const lines = [
    "# PR-4.5b3 Bounded Abstraction Counterexample Search",
    "",
    `Status: **${report.status}**`,
    `Positive corpus outcome: **${report.positiveCorpus.outcome}**`,
    `Negative control outcome: **${report.negativeControls.outcome}**`,
    "",
    "## Scope",
    "",
    "This artifact is shadow-only. It does not modify the production DP key, dominance, agenda, capacity, or default strategy.",
    "",
    `- manifest: **${report.provenance.manifest}**`,
    `- bounded depth: **${report.search.depth}**`,
    `- relation checks: **shared-prefix depths 0 through ${report.search.depth}, inclusive**`,
    `- branch cap: **${report.search.branchCap}**`,
    `- state cap: **${report.search.stateCap}**`,
    "",
    "## Positive corpus",
    "",
    "| Corpus | Fixed positive | Roots | Outcome | Incomplete roots |",
    "|---|---:|---:|---|---:|",
    ...report.positiveCorpus.entries.map((entry) => `| ${entry.id} | ${entry.fixedPositive} | ${entry.rootCount} | ${entry.outcome} | ${entry.incompleteRootCount} |`),
    "",
  ];
  report.positiveCorpus.entries.forEach((entry) => {
    lines.push(`### ${entry.id}`, "", `- replay errors: **${entry.replayErrors.length}**`, `- candidate keys match ancestry artifact: **${entry.candidateExactKeysMatchArtifact}**`);
    entry.roots.forEach((root) => {
      lines.push(`- ${root.id}: **${root.outcome}**, expanded pairs **${root.expandedPairCount}**, generated pairs **${root.generatedPairCount}**, multi-successor actions **${root.multiSuccessorActionCount}**, cross-product pairs **${root.generatedCrossProductPairCount}**`);
    });
    lines.push("");
  });
  lines.push(
    "## Negative controls",
    "",
    "| Control | Outcome | Depth | Witness sequence | First unmatched |",
    "|---|---|---:|---|---|",
    ...report.negativeControls.entries.map((entry) => {
      const witness = entry.witness;
      const sequence = witness ? witness.sharedActionSequence.map((action) => action.id).join(" → ") : "n/a";
      const unmatched = witness && witness.firstUnmatched ? witness.firstUnmatched.actionId : "n/a";
      return `| ${entry.id} | ${entry.outcome} | ${entry.depthReached} | ${sequence} | ${unmatched} |`;
    }),
    "",
    "The negative controls intentionally omit hidden mutation history from their projections. The witnesses confirm both an immediate re-entry mismatch and a mismatch first exposed at the configured depth boundary.",
    "",
    "## Verdict",
    "",
    `- positive candidate-6/7 corpus: **${report.positiveCorpus.outcome}**`,
    `- negative control: **${report.negativeControls.outcome}**`,
    `- depth-boundary control witness: **${report.summary.depthBoundaryControlFoundWitness}**`,
    `- any budget-incomplete run: **${report.summary.anyIncomplete}**`,
    `- production semantic change: **${report.scope.productionSemanticChange}**`,
    "",
    "A bounded equivalent result is evidence for this manifest, depth, and budget only; it is not a proof that the projection is safe globally.",
    "",
    "## Provenance",
    "",
    "- generation commit: `" + report.provenance.generationCommit + "`",
    "- production state-key SHA256: `" + report.provenance.productionStateKeySha256 + "`",
  );
  return lines.join("\n") + "\n";
}

function buildReport(options) {
  const config = options || {};
  const manifestPath = path.resolve(config.manifest || DEFAULT_MANIFEST);
  const projectRoot = path.resolve(config.projectRoot || path.resolve(ROOT, "Only upV2.1", "Only upV2.1"));
  const manifest = readJson(manifestPath);
  if (manifest.schema !== "motapathfinder.pr-4.5b3-state-abstraction-corpus.v1") {
    throw new Error(`Unsupported PR-4.5b3 corpus manifest schema: ${manifest.schema}`);
  }
  const manifestSearch = manifest.search || {};
  const search = {
    depth: Number(manifestSearch.depth ?? 2),
    branchCap: Number(manifestSearch.branchCap ?? 32),
    stateCap: Number(manifestSearch.stateCap ?? 256),
  };
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const realAdapter = makeRealAdapter(simulator);
  const positiveEntries = [];
  for (const spec of manifest.positiveCorpus || []) {
    const roots = buildPositiveRoots(spec, simulator);
    const rootResults = roots.roots.map((root) => ({
      ...root,
      ...runPairedExpansion(root, realAdapter, search),
    }));
    positiveEntries.push({
      id: spec.id,
      fixedPositive: spec.fixedPositive === true,
      sourceReport: relative(roots.sourceReportPath),
      ancestryReport: relative(roots.ancestryReportPath),
      sourceReportSha256: sha256(roots.sourceReportPath),
      ancestryReportSha256: sha256(roots.ancestryReportPath),
      startDecision: spec.startDecision,
      endDecision: spec.endDecision,
      replayErrors: roots.replayErrors,
      candidateExactKeysMatchArtifact: roots.candidateExactKeysMatchArtifact,
      expectedDecisionCount: roots.expectedDecisionCount,
      rootCount: rootResults.length,
      incompleteRootCount: rootResults.filter((root) => root.outcome === "incomplete").length,
      outcome: outcomeOf(rootResults),
      roots: rootResults.map((root) => ({
        id: root.id,
        decision: root.decision,
        initialPair: root.initialPair,
        outcome: root.outcome,
        depth: root.depth,
        depthReached: root.depthReached,
        expandedPairCount: root.expandedPairCount,
        generatedPairCount: root.generatedPairCount,
        budgetExhausted: root.budgetExhausted,
        exhaustedReason: root.exhaustedReason,
        incompleteReason: root.incompleteReason,
        branchCap: root.branchCap,
        stateCap: root.stateCap,
        multiSuccessorActionCount: root.multiSuccessorActionCount,
        maxSuccessorsPerAction: root.maxSuccessorsPerAction,
        generatedCrossProductPairCount: root.generatedCrossProductPairCount,
        executionErrors: root.executionErrors,
        levels: root.levels,
        witness: root.witness,
      })),
    });
  }
  const negativeEntries = [];
  for (const spec of manifest.negativeControls || []) {
    let control;
    if (spec.type === "synthetic-reentry-hidden-mutation") {
      control = makeSyntheticNegativeControl();
    } else if (spec.type === "synthetic-reentry-depth-boundary") {
      control = makeSyntheticDepthBoundaryControl();
    } else if (spec.type === "synthetic-off-diagonal-successor") {
      control = makeSyntheticOffDiagonalControl();
    } else {
      negativeEntries.push({ id: spec.id, outcome: "incomplete", reason: `unsupported control type: ${spec.type}` });
      continue;
    }
    const result = runPairedExpansion(control.root, control.adapter, search);
    negativeEntries.push({
      id: spec.id,
      type: spec.type,
      expectedOutcome: spec.expectedOutcome,
      description: spec.description,
      ...result,
    });
  }
  const positiveOutcome = outcomeOf(positiveEntries);
  const negativeOutcome = outcomeOf(negativeEntries);
  const allComplete = positiveOutcome !== "incomplete" && negativeOutcome !== "incomplete";
  return {
    schema: "motapathfinder.pr-4.5b3-true-off-diagonal-regression-control.v1",
    generatedAt: new Date().toISOString(),
    status: allComplete ? "completed" : "completed-with-evidence-gaps",
    scope: {
      shadowOnly: true,
      productionSemanticChange: false,
      productionChanges: [],
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultStrategyChanged: false,
    },
    search,
    positiveCorpus: {
      outcome: positiveOutcome,
      expectedOutcome: "equivalent",
      entries: positiveEntries,
    },
    negativeControls: {
      outcome: negativeOutcome,
      expectedOutcome: "mismatch-witness",
      entries: negativeEntries,
    },
    summary: {
      positiveCorpusEquivalent: positiveOutcome === "equivalent",
      negativeControlFoundWitness: negativeEntries.some((entry) => entry.outcome === "mismatch-witness"),
      depthBoundaryControlFoundWitness: negativeEntries.some((entry) =>
        entry.id === "synthetic-reentry-depth-boundary-v1" && entry.outcome === "mismatch-witness",
      ),
      offDiagonalControlFoundWitness: negativeEntries.some((entry) =>
        entry.id === "synthetic-off-diagonal-successor-v1" && entry.outcome === "mismatch-witness",
      ),
      anyIncomplete: !allComplete,
    },
    provenance: {
      manifest: relative(manifestPath),
      manifestSha256: sha256(manifestPath),
      projectRoot: relative(projectRoot),
      generationCommit: gitCommit(),
      productionStateKeyModule: "shared-solver/lib/state-key.js",
      productionStateKeySha256: sha256(path.resolve(__dirname, "lib", "state-key.js")),
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport({
    manifest: args.manifest,
    projectRoot: args["project-root"],
  });
  const out = path.resolve(args.out || DEFAULT_OUT);
  const outMd = path.resolve(args["out-md"] || DEFAULT_OUT_MD);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(outMd, buildMarkdown(report));
  console.log(JSON.stringify({
    status: report.status,
    out: relative(out),
    outMd: relative(outMd),
    positiveCorpus: report.positiveCorpus.outcome,
    negativeControls: report.negativeControls.outcome,
    anyIncomplete: report.summary.anyIncomplete,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildMarkdown,
  buildReport,
  buildActionTable,
  comparePairedActionTables,
  initialPairEvidence,
  makeRealAdapter,
  makeSyntheticDepthBoundaryControl,
  makeSyntheticExecutionErrorControl,
  makeSyntheticNegativeControl,
  makeSyntheticOffDiagonalControl,
  runPairedExpansion,
};
