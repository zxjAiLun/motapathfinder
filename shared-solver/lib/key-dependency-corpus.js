"use strict";

/**
 * PR-5.4c Commit 1 Repair — Key Dependency Corpus (observation only).
 *
 * For real DP states captured from a representative search, records:
 *   - legacy reference (current exact DP key + legacy region signature)
 *   - TowerIR StructuralKey candidate (startComponentId + reachable
 *     components/POIs/endpoints + mutation fingerprint; NO exact loc, NO legacy
 *     regionKey)
 *   - resource identity label (atk/def/mdef/lv/exp/money/mana/equipment/
 *     inventory/behavior flags/visited floors; NO hp)
 *   - dominance label (hp, route/depth — recorded, not automatically a key)
 *   - event/hazard label (triggered auto events)
 *   - canonical action identity (summary + stable full-action fingerprint)
 *   - multi-layer successor fingerprints (exact, dp key, candidate keys,
 *     behavior projections, terminal)
 *
 * The analysis computes real candidate-key collision groups and classifies
 * pair differences as dominance-safe / metadata-only / unsafe using
 * dominance-aware rules (action-superset, shared-action successor behavior
 * equality, successor HP monotonicity).  Zero collisions yield
 * "insufficient-collisions", never "safe".  Production is untouched.
 */

const { buildDpStateKey } = require("./dp-search");
const { cloneState, listFloorMutationSummary } = require("./state");
const { fingerprintJson } = require("./solve-task");
const { exactStateFingerprint } = require("./solver-job");
const { evaluateTowerIRReachability } = require("./tower-ir-shadow");

function stableValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
}

// Behavior-relevant flag audit (smoke/MT1 scope): autoBattle (auto-battle
// gate), shiqu (千夜 event state), hatred (battle-modifying counter).  All
// three affect combat/event behavior; no UI/diagnostic-only flags were found
// in the scope.  The full flags object is treated as behavior identity; a
// future CEGAR pass may exclude proven-UI flags.
function behaviorRelevantFlags(state) {
  return stableValue(state.flags || {});
}

function heroNumbers(state) {
  const hero = state.hero || {};
  return {
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    lv: Number(hero.lv || 0),
    exp: Number(hero.exp || 0),
    money: Number(hero.money || 0),
    mana: Number(hero.mana || 0),
  };
}

function buildTowerIrProjection(ir, project, state) {
  const result = evaluateTowerIRReachability(ir, project, state);
  return {
    floorId: state.floorId,
    startComponentId: result.startComponentId,
    reachableComponentIds: (result.reachableComponentIds || []).slice().sort(),
    reachablePoiIds: (result.reachablePoiIds || []).slice().sort(),
    reachableEndpoints: (result.reachableEndpointDescriptors || []).map((endpoint) =>
      `${endpoint.kind}:${endpoint.tileId || ""}@${endpoint.x},${endpoint.y}${endpoint.targetId ? "->" + endpoint.targetId : ""}`,
    ).sort(),
    mutationFingerprint: fingerprintJson(listFloorMutationSummary(state.floorStates || {})),
  };
}

// Per-state projection (cheap; no actions/successors).
function buildStateProjection(simulator, project, ir, state, options) {
  const config = options || {};
  const exactDpKey = buildDpStateKey(simulator, state, {
    dpKeyMode: config.dpKeyMode || "region",
    solverModel: config.solverModel,
    model: config.model,
  });
  const regionSignature = simulator.buildReachableRegionSignature(state);

  const legacyReference = {
    exactDpKey,
    regionKey: regionSignature.regionKey,
    reachableEndpointsKey: regionSignature.reachableEndpointsKey,
    mutationSummary: listFloorMutationSummary(state.floorStates || {}),
  };

  const structuralCandidate = buildTowerIrProjection(ir, project, state);

  const hero = state.hero || {};
  const resourceIdentity = {
    ...heroNumbers(state),
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice().sort() : [],
    inventory: stableValue(state.inventory || {}),
    flags: behaviorRelevantFlags(state),
    visitedFloors: Object.keys(state.visitedFloors || {}).sort(),
  };

  const meta = state.meta || {};
  const dominanceLabel = {
    hp: Number(hero.hp || 0),
    rawRouteLength: Number(meta.rawRouteLength || 0),
    decisionDepth: Number(meta.decisionDepth || 0),
  };

  const eventHazardLabel = stableValue(state.triggeredAutoEvents || {});

  const candidateStructuralResourceKey = fingerprintJson({ structural: structuralCandidate, resource: resourceIdentity });
  const candidateFullBehaviorKey = fingerprintJson({ structural: structuralCandidate, resource: resourceIdentity, event: eventHazardLabel });
  const legacyDecompositionKey = fingerprintJson({ legacy: legacyReference, resource: resourceIdentity, event: eventHazardLabel });

  return {
    stateFingerprint: exactStateFingerprint(state),
    legacyReference,
    structuralCandidate,
    resourceIdentity,
    dominanceLabel,
    eventHazardLabel,
    candidateStructuralResourceKey,
    candidateFullBehaviorKey,
    legacyDecompositionKey,
  };
}

// Canonical action identity: summary for display, stable full-action
// fingerprint for behavior comparison (distinguishes same-summary-different-
// payload actions via the travel-state fingerprint).
function buildActionIdentity(action) {
  if (!action) return null;
  const travelStateFingerprint = action.travelState ? exactStateFingerprint(action.travelState) : null;
  const payload = {
    kind: action.kind || null,
    summary: action.summary || null,
    floorId: action.floorId || null,
    x: action.x != null ? action.x : null,
    y: action.y != null ? action.y : null,
    target: action.target || null,
    direction: action.direction || null,
    path: Array.isArray(action.path) ? action.path.slice() : [],
    travelStateFingerprint,
  };
  return {
    actionSummary: typeof action.summary === "string" && action.summary.length > 0
      ? action.summary
      : `${action.kind || "unknown"}:${payload.floorId || ""}:${payload.x != null ? payload.x + "," + payload.y : ""}`,
    actionFingerprint: fingerprintJson(payload),
    actionPayload: payload,
  };
}

function buildStateBehavior(simulator, project, ir, state, options) {
  const config = options || {};
  const projection = buildStateProjection(simulator, project, ir, state, config);
  const actionSet = [];
  const actions = [];
  try {
    const enumerated = simulator.enumeratePrimitiveActions(state);
    const rawActions = (enumerated && enumerated.actions) || [];
    for (const action of rawActions) {
      const identity = buildActionIdentity(action);
      if (!identity) continue;
      let successor = null;
      let successorError = null;
      try {
        const nextState = simulator.applyAction(cloneState(state), action, { storeRoute: false });
        const successorProjection = buildStateProjection(simulator, project, ir, nextState, config);
        successor = {
          exactStateFingerprint: exactStateFingerprint(nextState),
          currentDpKey: successorProjection.legacyReference.exactDpKey,
          candidateStructuralResourceKey: successorProjection.candidateStructuralResourceKey,
          candidateFullBehaviorKey: successorProjection.candidateFullBehaviorKey,
          structuralCandidate: successorProjection.structuralCandidate,
          resourceIdentity: successorProjection.resourceIdentity,
          dominanceLabel: successorProjection.dominanceLabel,
          eventHazardLabel: successorProjection.eventHazardLabel,
          terminal: Boolean(nextState.hero && nextState.hero.hp <= 0) ? false : null,
        };
      } catch (error) {
        successorError = String(error && error.message || error);
      }
      actionSet.push(identity.actionFingerprint);
      actions.push({ identity, successor, successorError });
    }
  } catch (error) {
    actions.push({ identity: { actionSummary: "__enumerateError__", actionFingerprint: "__enumerateError__" }, successor: null, successorError: String(error && error.message || error) });
  }
  return { projection, actionSet: Array.from(new Set(actionSet)).sort(), actions };
}

// Behavior projection of a successor used for equivalence comparison: the
// candidate key fields (structural + resource + event), excluding dominance.
function successorBehaviorKey(successor) {
  if (!successor) return null;
  return fingerprintJson({
    structural: successor.structuralCandidate,
    resource: successor.resourceIdentity,
    event: successor.eventHazardLabel,
  });
}

// Dominance-aware pair classification.
// left/right are behavior entries { projection, actionSet, actions }.
function classifyPair(left, right) {
  const leftHp = left.projection.dominanceLabel.hp;
  const rightHp = right.projection.dominanceLabel.hp;
  const low = leftHp <= rightHp ? left : right;
  const high = leftHp <= rightHp ? right : left;

  const lowSet = new Set(low.actionSet);
  const highSet = new Set(high.actionSet);
  const actionOnlyLeft = low.actionSet.filter((action) => !highSet.has(action));
  const actionOnlyRight = high.actionSet.filter((action) => !lowSet.has(action));
  const sharedActions = low.actionSet.filter((action) => highSet.has(action));
  const summarizeActions = (fingerprints) => {
    const all = [low, high];
    return fingerprints.map((fingerprint) => {
      for (const entry of all) {
        const record = entry.actions.find((item) => item.identity && item.identity.actionFingerprint === fingerprint);
        if (record && record.identity) return { fingerprint, summary: record.identity.actionSummary };
      }
      return { fingerprint, summary: null };
    });
  };

  const lowActionsByFingerprint = new Map(low.actions.map((record) => [record.identity && record.identity.actionFingerprint, record]));
  const highActionsByFingerprint = new Map(high.actions.map((record) => [record.identity && record.identity.actionFingerprint, record]));

  const successorBehaviorDiffs = [];
  const hpMonotonicityViolations = [];
  sharedActions.forEach((action) => {
    const lowRecord = lowActionsByFingerprint.get(action);
    const highRecord = highActionsByFingerprint.get(action);
    if (!lowRecord || !highRecord || !lowRecord.successor || !highRecord.successor) return;
    const lowBehavior = successorBehaviorKey(lowRecord.successor);
    const highBehavior = successorBehaviorKey(highRecord.successor);
    if (lowBehavior !== highBehavior) {
      successorBehaviorDiffs.push({ action, lowBehavior, highBehavior });
    }
    if (highRecord.successor.dominanceLabel.hp < lowRecord.successor.dominanceLabel.hp) {
      hpMonotonicityViolations.push({ action, lowHp: lowRecord.successor.dominanceLabel.hp, highHp: highRecord.successor.dominanceLabel.hp });
    }
  });

  // Metadata-only: no behavior differences, identical HP, only
  // decisionDepth/route/counter fields differ.
  const metadataDiffs = [];
  const metaFields = ["rawRouteLength", "decisionDepth"];
  metaFields.forEach((field) => {
    if (left.projection.dominanceLabel[field] !== right.projection.dominanceLabel[field]) {
      metadataDiffs.push(field);
    }
  });
  const hpEqual = leftHp === rightHp;
  const actionSetEqual = actionOnlyLeft.length === 0 && actionOnlyRight.length === 0;
  const noSuccessorDiffs = successorBehaviorDiffs.length === 0;
  const noHpViolations = hpMonotonicityViolations.length === 0;

  if (!noSuccessorDiffs) {
    return { classification: "unsafe", reason: "shared action produced different successor behavior", successorBehaviorDiffs: successorBehaviorDiffs.slice(0, 4), hpMonotonicityViolations: hpMonotonicityViolations.slice(0, 4) };
  }
  if (!noHpViolations) {
    return { classification: "unsafe", reason: "successor HP not monotonic for high-HP state", hpMonotonicityViolations: hpMonotonicityViolations.slice(0, 4), actionOnlyLeft: summarizeActions(actionOnlyLeft), actionOnlyRight: summarizeActions(actionOnlyRight) };
  }
  if (!actionSetEqual) {
    if (actionOnlyLeft.length === 0) {
      return { classification: "dominance-safe", sub: "action-superset", reason: "high-HP action set is a superset of low-HP action set", actionOnlyRight: summarizeActions(actionOnlyRight).slice(0, 8) };
    }
    return { classification: "unsafe", reason: "low-HP state has actions the high-HP state lacks", actionOnlyLeft: summarizeActions(actionOnlyLeft).slice(0, 8), actionOnlyRight: summarizeActions(actionOnlyRight).slice(0, 8) };
  }
  if (hpEqual && metadataDiffs.length > 0 && noSuccessorDiffs && noHpViolations) {
    return { classification: "metadata-only", reason: `identical HP/behavior; only metadata differs (${metadataDiffs.join(",")})`, metadataDiffs };
  }
  if (hpEqual) {
    return { classification: "unclassified", reason: "identical HP and action sets but unclassified difference" };
  }
  return { classification: "dominance-safe", reason: "identical action sets and successor behavior; HP differs monotonically", actionOnlyRight: [], actionOnlyLeft: [] };
}

// Collision analysis for a candidate key field.
function analyzeCandidateKeyCollisions(entries, keyField) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = entry.projection[keyField];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const collisionGroups = Array.from(groups.values()).filter((group) => group.length >= 2);
  const uniqueKeyCount = groups.size;
  const collisionGroupCount = collisionGroups.length;
  const statesInCollisionGroups = collisionGroups.reduce((sum, group) => sum + group.length, 0);
  const maxCollisionGroupSize = collisionGroups.reduce((max, group) => Math.max(max, group.length), 0);
  return {
    candidate: keyField,
    uniqueKeyCount,
    collisionGroupCount,
    statesInCollisionGroups,
    maxCollisionGroupSize,
    evidenceStatus: collisionGroupCount > 0 ? "collisions-present" : "insufficient-collisions",
  };
}

// Full analysis: projections for all states, behavior only for states in
// candidate-key collision groups, then pair classification.
// entries: [{ state, projection }]; buildBehavior(state) -> behavior entry.
function analyzeKeyDependencyCorpus(entries, buildBehavior, options) {
  const config = options || {};

  const behaviorKeyCollisions = analyzeCandidateKeyCollisions(entries, "candidateFullBehaviorKey");
  const structuralResourceCollisions = analyzeCandidateKeyCollisions(entries, "candidateStructuralResourceKey");
  const legacyCollisions = analyzeCandidateKeyCollisions(entries, "legacyDecompositionKey");

  // Phase 2: behavior only for states inside full-behavior-key collision groups.
  const collisionStates = new Set();
  const groups = new Map();
  entries.forEach((entry) => {
    const key = entry.projection.candidateFullBehaviorKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  let behaviorBuilt = 0;
  Array.from(groups.values()).forEach((group) => {
    if (group.length < 2) return;
    group.forEach((entry) => {
      collisionStates.add(entry.projection.stateFingerprint);
      entry.behavior = buildBehavior(entry.state);
      behaviorBuilt += 1;
    });
  });

  // Classify pairs within each collision group (all pairs).
  const classifications = [];
  const unsafeWitnesses = [];
  Array.from(groups.values()).forEach((group) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        if (!left.behavior || !right.behavior) continue;
        const result = classifyPair(left.behavior, right.behavior);
        const witness = {
          classification: result.classification,
          candidateKey: left.projection.candidateFullBehaviorKey,
          left: {
            stateFingerprint: left.projection.stateFingerprint,
            hp: left.projection.dominanceLabel.hp,
            decisionDepth: left.projection.dominanceLabel.decisionDepth,
            eventHazardLabel: left.projection.eventHazardLabel,
          },
          right: {
            stateFingerprint: right.projection.stateFingerprint,
            hp: right.projection.dominanceLabel.hp,
            decisionDepth: right.projection.dominanceLabel.decisionDepth,
            eventHazardLabel: right.projection.eventHazardLabel,
          },
          actionOnlyLeft: result.actionOnlyLeft || [],
          actionOnlyRight: result.actionOnlyRight || [],
          sharedActionSuccessorDiffs: result.successorBehaviorDiffs || [],
          reason: result.reason,
        };
        classifications.push(witness);
        if (result.classification === "unsafe") unsafeWitnesses.push(witness);
      }
    }
  });

  const summarize = (items) => items.reduce((acc, item) => { acc[item.classification] = (acc[item.classification] || 0) + 1; return acc; }, {});
  const classificationCounts = summarize(classifications);
  const unsafeCount = classificationCounts.unsafe || 0;
  const dominanceSafeCount = classificationCounts["dominance-safe"] || 0;
  const metadataOnlyCount = classificationCounts["metadata-only"] || 0;
  const unclassifiedCount = classificationCounts.unclassified || 0;

  return {
    schema: "motapathfinder.key-dependency-corpus.v1",
    capturedStateCount: entries.length,
    behaviorKeyCollisions,
    structuralResourceCollisions,
    legacyCollisions,
    candidateGroupsAnalyzed: Array.from(groups.values()).filter((group) => group.length >= 2).length,
    statesInCandidateCollisionGroups: collisionStates.size,
    behaviorBuilt,
    classificationCounts,
    dominanceSafeCount,
    metadataOnlyCount,
    unsafeCount,
    unclassifiedCount,
    unsafeWitnesses: unsafeWitnesses.slice(0, (config.maxWitnesses || 20)),
  };
}

module.exports = {
  analyzeCandidateKeyCollisions,
  analyzeKeyDependencyCorpus,
  behaviorRelevantFlags,
  buildActionIdentity,
  buildStateBehavior,
  buildStateProjection,
  classifyPair,
  heroNumbers,
  stableValue,
  successorBehaviorKey,
};
