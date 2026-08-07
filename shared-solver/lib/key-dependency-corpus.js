"use strict";

/**
 * PR-5.4c Commit 1 Repair 2 — Key Dependency Corpus (observation only).
 *
 * Normalizes the equivalence evidence:
 *   - action CHOICE identity (what the player chose) is separated from the
 *     travel VARIANT (path / derived arrival state / HP).  Action-set
 *     equivalence uses actionChoiceFingerprint only; travelState and HP never
 *     pollute the choice identity.
 *   - successor failures (enumeration / applyAction / projection errors) are
 *     fail-visible and classified as analysis-error, never silently skipped
 *     into safe.
 *   - terminal projection (alive / dead / goalReached / terminalClass) uses the
 *     real workload goal predicate and participates in classification.
 *   - witnesses use explicit lowHpState / highHpState direction.
 *   - metadata label covers rawRouteLength / materializedRouteLength /
 *     decisionDepth / auto counters (recorded, not in the candidate key).
 *
 * Production is untouched.
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

// Behavior-relevant flag audit (smoke/MT1 scope): autoBattle, shiqu, hatred all
// affect combat/event behavior; no UI/diagnostic-only flags were found.
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

function buildTerminalProjection(state, goalPredicate) {
  const hp = Number(state.hero && state.hero.hp || 0);
  const alive = hp > 0;
  const dead = hp <= 0;
  let goalReached = null;
  if (typeof goalPredicate === "function") {
    try { goalReached = goalPredicate(state) === true; } catch (error) { goalReached = null; }
  }
  let terminalClass = "active";
  if (dead) terminalClass = "dead";
  else if (goalReached === true) terminalClass = "goal";
  return { alive, dead, goalReached, terminalClass };
}

// Candidate identity profiles for the promotion gate.  Each profile selects
// which fields feed the candidate key.  Ablation is driven by observed split
// causes, never by dropping behavior-relevant fields blindly.
const CANDIDATE_PROFILES = {
  "current-full": { normalizeResource: false, includeEventLabel: true, includeFollowers: false },
  "normalized-resource": { normalizeResource: true, includeEventLabel: true, includeFollowers: false },
  "without-event-label": { normalizeResource: false, includeEventLabel: false, includeFollowers: false },
  // Negative control: dropping atk (a behavior-relevant field) must surface
  // unsafe witnesses, proving the classifier catches missing fields.
  "missing-atk": { normalizeResource: false, includeEventLabel: true, includeFollowers: false, dropAtk: true },
};

// Structured candidate projection (fields only, for partition audit diffing).
function buildCandidateProjection(simulator, project, ir, state, options) {
  const config = options || {};
  const profile = CANDIDATE_PROFILES[config.profile] || CANDIDATE_PROFILES["current-full"];
  const structuralCandidate = buildTowerIrProjection(ir, project, state);
  const hero = state.hero || {};
  const heroNumbersForProfile = heroNumbers(state);
  if (profile.dropAtk) delete heroNumbersForProfile.atk;
  const resourceIdentity = {
    ...heroNumbersForProfile,
    equipment: Array.isArray(hero.equipment) ? hero.equipment.slice().sort() : [],
  };
  if (profile.includeFollowers) {
    resourceIdentity.followers = Array.isArray(hero.followers) ? hero.followers.slice().sort() : [];
  }
  const normalizeResource = (object) => {
    if (!profile.normalizeResource) return stableValue(object || {});
    // Match production stableObject semantics: drop null and zero values.
    return Object.keys(object || {}).sort().reduce((acc, key) => {
      const value = object[key];
      if (value == null || value === 0) return acc;
      acc[key] = value;
      return acc;
    }, {});
  };
  resourceIdentity.inventory = normalizeResource(state.inventory);
  resourceIdentity.flags = normalizeResource(state.flags);
  resourceIdentity.visitedFloors = Object.keys(state.visitedFloors || {}).sort();
  const eventHazardLabel = profile.includeEventLabel ? stableValue(state.triggeredAutoEvents || {}) : null;
  return { structuralCandidate, resourceIdentity, eventHazardLabel };
}

// TowerIR StructuralKey + ResourceIdentity + EventHazardLabel candidate DP key.
// HP is intentionally NOT part of the identity (dominance label only).
function buildCandidateDpKey(simulator, project, ir, state, options) {
  return fingerprintJson(buildCandidateProjection(simulator, project, ir, state, options));
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
    materializedRouteLength: Number(meta.materializedRouteLength || 0),
    decisionDepth: Number(meta.decisionDepth || 0),
  };

  const eventHazardLabel = stableValue(state.triggeredAutoEvents || {});

  const metadataLabel = {
    rawRouteLength: Number(meta.rawRouteLength || 0),
    materializedRouteLength: Number(meta.materializedRouteLength || 0),
    decisionDepth: Number(meta.decisionDepth || 0),
    autoStepCount: Number(meta.autoStepCount || 0),
    autoPickupCount: Number(meta.autoPickupCount || 0),
    autoBattleCount: Number(meta.autoBattleCount || 0),
  };

  const candidateStructuralResourceKey = fingerprintJson({ structural: structuralCandidate, resource: resourceIdentity });
  const candidateFullBehaviorKey = buildCandidateDpKey(simulator, project, ir, state, options);
  const legacyDecompositionKey = fingerprintJson({ legacy: legacyReference, resource: resourceIdentity, event: eventHazardLabel });

  return {
    stateFingerprint: exactStateFingerprint(state),
    legacyReference,
    structuralCandidate,
    resourceIdentity,
    dominanceLabel,
    eventHazardLabel,
    metadataLabel,
    terminalProjection: buildTerminalProjection(state, config.goalPredicate),
    candidateStructuralResourceKey,
    candidateFullBehaviorKey,
    legacyDecompositionKey,
  };
}

// Action CHOICE identity: what the player chose.  Excludes travelState, HP,
// path, stance, and route/depth/meta so that dominance comparisons are not
// polluted by arrival-state differences.
function buildActionChoiceIdentity(action) {
  if (!action) return null;
  const target = action.target && typeof action.target === "object" ? action.target : null;
  const x = action.x != null ? action.x : (target && target.x != null ? target.x : null);
  const y = action.y != null ? action.y : (target && target.y != null ? target.y : null);
  let eventChoicePath = null;
  if (Array.isArray(action.choicePath)) eventChoicePath = action.choicePath.slice();
  else if (typeof action.choicePath === "string") eventChoicePath = action.choicePath;
  const payload = {
    kind: action.kind || null,
    floorId: action.floorId || null,
    x,
    y,
    targetId: action.enemyId || action.targetId || action.itemId || action.doorId || action.toolId || (action.target && typeof action.target === "string" ? action.target : null) || null,
    eventChoicePath,
    changeFloorTarget: action.changeFloorTarget || action.targetFloorId || (action.changeFloor && (action.changeFloor.floorId || action.changeFloor.stair)) || null,
  };
  return {
    actionSummary: typeof action.summary === "string" && action.summary.length > 0
      ? action.summary
      : `${action.kind || "unknown"}:${payload.floorId || ""}:${x != null ? x + "," + y : ""}`,
    actionChoiceFingerprint: fingerprintJson(payload),
    actionPayload: payload,
  };
}

// Action TRAVEL VARIANT identity: how the hero arrives at the interaction point
// (path, stance, derived travel state).  Recorded separately; never part of the
// choice identity.
function buildActionTravelVariant(action, simulator, project, ir, options) {
  if (!action) return null;
  const config = options || {};
  const variant = {
    stance: action.stance || null,
    direction: action.direction || null,
    pathLength: Array.isArray(action.path) ? action.path.length : null,
    pathEndpoint: Array.isArray(action.path) && action.path.length > 0 ? action.path[action.path.length - 1] : null,
  };
  if (action.travelState && action.travelState.hero) {
    const projection = buildStateProjection(simulator, project, ir, action.travelState, config);
    variant.travelStructural = projection.structuralCandidate;
    variant.travelResource = projection.resourceIdentity;
    variant.travelEvent = projection.eventHazardLabel;
    variant.travelDominance = projection.dominanceLabel;
  }
  return { travelVariantFingerprint: fingerprintJson(variant), variant };
}

function buildStateBehavior(simulator, project, ir, state, options) {
  const config = options || {};
  const projection = buildStateProjection(simulator, project, ir, state, config);
  const choiceSet = [];
  const actions = [];
  let enumerationError = null;
  try {
    const enumerated = simulator.enumeratePrimitiveActions(state);
    const rawActions = (enumerated && enumerated.actions) || [];
    for (const action of rawActions) {
      const choice = buildActionChoiceIdentity(action);
      if (!choice) continue;
      let travelVariant = null;
      let successor = null;
      let successorError = null;
      let projectionError = null;
      try {
        travelVariant = buildActionTravelVariant(action, simulator, project, ir, config);
      } catch (error) {
        projectionError = `travelProjection:${String(error && error.message || error)}`;
      }
      try {
        const nextState = simulator.applyAction(cloneState(state), action, { storeRoute: false });
        try {
          const successorProjection = buildStateProjection(simulator, project, ir, nextState, config);
          successor = {
            exactStateFingerprint: exactStateFingerprint(nextState),
            currentDpKey: successorProjection.legacyReference.exactDpKey,
            candidateStructuralResourceKey: successorProjection.candidateStructuralResourceKey,
            candidateFullBehaviorKey: successorProjection.candidateFullBehaviorKey,
            structuralCandidate: successorProjection.structuralCandidate,
            resourceIdentity: successorProjection.resourceIdentity,
            eventHazardLabel: successorProjection.eventHazardLabel,
            dominanceLabel: successorProjection.dominanceLabel,
            terminalProjection: successorProjection.terminalProjection,
            metadataLabel: successorProjection.metadataLabel,
          };
        } catch (error) {
          projectionError = `successorProjection:${String(error && error.message || error)}`;
        }
      } catch (error) {
        successorError = String(error && error.message || error);
      }
      choiceSet.push(choice.actionChoiceFingerprint);
      actions.push({
        choice,
        travelVariant,
        successor,
        successorError,
        projectionError,
      });
    }
  } catch (error) {
    enumerationError = String(error && error.message || error);
    actions.push({
      choice: { actionSummary: "__enumerateError__", actionChoiceFingerprint: "__enumerateError__", actionPayload: null },
      travelVariant: null,
      successor: null,
      successorError: enumerationError,
      projectionError: null,
    });
  }
  return { projection, choiceSet: Array.from(new Set(choiceSet)).sort(), actions, enumerationError };
}

function successorBehaviorKey(successor) {
  if (!successor) return null;
  return fingerprintJson({
    structural: successor.structuralCandidate,
    resource: successor.resourceIdentity,
    event: successor.eventHazardLabel,
  });
}

// All action records for a choice (a choice may have multiple travel variants
// in production).  NEVER fall back to first-record-only.
function findChoiceRecords(behavior, choiceFingerprint) {
  return behavior.actions.filter((record) => record.choice && record.choice.actionChoiceFingerprint === choiceFingerprint);
}

function summarizeChoices(fingerprints, behaviors) {
  return fingerprints.map((fingerprint) => {
    for (const entry of behaviors) {
      const records = findChoiceRecords(entry, fingerprint);
      if (records.length > 0 && records[0].choice) return { fingerprint, summary: records[0].choice.actionSummary };
    }
    return { fingerprint, summary: null };
  });
}

// A low variant is covered by a high variant when the successor behavior
// projections are equal, terminal semantics are compatible, and the high
// successor HP is at least the low successor HP.
function isCoveringVariant(lowRecord, highRecord) {
  const low = lowRecord.successor;
  const high = highRecord.successor;
  if (!low || !high) return false;
  if (successorBehaviorKey(low) !== successorBehaviorKey(high)) return false;
  if (high.dominanceLabel.hp < low.dominanceLabel.hp) return false;
  const lowTerminal = low.terminalProjection || {};
  const highTerminal = high.terminalProjection || {};
  if (highTerminal.dead === true && lowTerminal.alive === true) return false;
  if (lowTerminal.goalReached === true && highTerminal.goalReached === false) return false;
  return true;
}

// Coverage of low variants by high variants for the shared choices.  Returns
// unmatched low variants (empty when every low variant has a covering high
// variant).  Travel variant fingerprints are diagnostic only; safety uses
// successor behavior equality + terminal compatibility + successor HP.
function computeVariantCoverage(low, high, sharedChoices, diagnostics) {
  const unmatchedLowVariants = [];
  const travelVariantDiffs = [];
  const travelDiffs = [];
  let lowVariantsCovered = 0;
  let highOnlyVariantCount = 0;
  let variantPairsChecked = 0;
  sharedChoices.forEach((choice) => {
    const lowRecords = findChoiceRecords(low, choice);
    const highRecords = findChoiceRecords(high, choice);
    const usedCovering = new Set();
    lowRecords.forEach((lowRecord) => {
      let covering = null;
      for (const highRecord of highRecords) {
        variantPairsChecked += 1;
        if (isCoveringVariant(lowRecord, highRecord)) { covering = highRecord; break; }
      }
      if (covering) {
        lowVariantsCovered += 1;
        usedCovering.add(covering);
        if (lowRecord.travelVariant && covering.travelVariant && lowRecord.travelVariant.travelVariantFingerprint !== covering.travelVariant.travelVariantFingerprint) {
          travelVariantDiffs.push({ choice, lowVariant: lowRecord.travelVariant.travelVariantFingerprint, highVariant: covering.travelVariant.travelVariantFingerprint });
        }
        const lowTravel = lowRecord.travelVariant ? fingerprintJson({ structural: lowRecord.travelVariant.variant.travelStructural, resource: lowRecord.travelVariant.variant.travelResource, event: lowRecord.travelVariant.variant.travelEvent }) : null;
        const highTravel = covering.travelVariant ? fingerprintJson({ structural: covering.travelVariant.variant.travelStructural, resource: covering.travelVariant.variant.travelResource, event: covering.travelVariant.variant.travelEvent }) : null;
        if (lowTravel && highTravel && lowTravel !== highTravel) {
          travelDiffs.push({ choice, lowTravel, highTravel });
        }
      } else {
        unmatchedLowVariants.push({
          choice,
          travelVariantFingerprint: lowRecord.travelVariant ? lowRecord.travelVariant.travelVariantFingerprint : null,
          successorBehavior: successorBehaviorKey(lowRecord.successor),
          successorHp: lowRecord.successor ? lowRecord.successor.dominanceLabel.hp : null,
          terminalProjection: lowRecord.successor ? lowRecord.successor.terminalProjection : null,
        });
      }
    });
    highRecords.forEach((highRecord) => {
      if (!usedCovering.has(highRecord)) highOnlyVariantCount += 1;
    });
  });
  if (diagnostics) {
    diagnostics.lowVariantsCovered += lowVariantsCovered;
    diagnostics.highOnlyVariantCount += highOnlyVariantCount;
    diagnostics.variantPairsChecked += variantPairsChecked;
  }
  return { unmatchedLowVariants, travelVariantDiffs, travelDiffs, lowVariantsCovered, highOnlyVariantCount, variantPairsChecked };
}

// Dominance-aware pair classification over COMPLETE variant sets.  left/right
// are behavior entries.
function classifyPair(left, right) {
  const leftHp = left.projection.dominanceLabel.hp;
  const rightHp = right.projection.dominanceLabel.hp;
  const low = leftHp <= rightHp ? left : right;
  const high = leftHp <= rightHp ? right : left;

  const lowSet = new Set(low.choiceSet);
  const highSet = new Set(high.choiceSet);
  const actionOnlyLow = low.choiceSet.filter((choice) => !highSet.has(choice));
  const actionOnlyHigh = high.choiceSet.filter((choice) => !lowSet.has(choice));
  const sharedChoices = low.choiceSet.filter((choice) => highSet.has(choice));

  // Fail-visible: EVERY variant (shared, low-only, high-only) must have a
  // successor without enumeration/apply/projection errors.
  const analysisErrors = [];
  const allRecords = (behavior) => behavior.actions.filter((record) => record.choice && record.choice.actionChoiceFingerprint !== "__enumerateError__");
  [low, high].forEach((behavior) => {
    allRecords(behavior).forEach((record) => {
      if (record.successorError) {
        analysisErrors.push({ choice: record.choice.actionSummary, side: behavior === low ? "low" : "high", reason: `applyAction error: ${record.successorError}` });
      }
      if (record.projectionError) {
        analysisErrors.push({ choice: record.choice.actionSummary, side: behavior === low ? "low" : "high", reason: `projection error: ${record.projectionError}` });
      }
    });
  });
  if (analysisErrors.length > 0) {
    return { classification: "analysis-error", reason: "a travel variant has missing/failed successor evidence", analysisErrors: analysisErrors.slice(0, 8) };
  }

  // Terminal equivalence at the state level.
  const terminalDiffs = [];
  const lowTerminal = low.projection.terminalProjection;
  const highTerminal = high.projection.terminalProjection;
  if (lowTerminal.goalReached === true && highTerminal.goalReached === false) {
    terminalDiffs.push({ kind: "goal", reason: "low-HP state reached goal but high-HP state did not" });
  }
  if (lowTerminal.alive === true && highTerminal.dead === true) {
    terminalDiffs.push({ kind: "dead", reason: "low-HP state alive but high-HP state dead" });
  }
  if (terminalDiffs.length > 0) {
    return { classification: "unsafe", reason: "terminal/goal equivalence violated", terminalDiffs: terminalDiffs.slice(0, 8), actionOnlyLow: summarizeChoices(actionOnlyLow, [low, high]), actionOnlyHigh: summarizeChoices(actionOnlyHigh, [low, high]) };
  }

  // Choice-set equivalence: the low-HP choice set must be a subset of high-HP.
  // Equal-HP pairs are symmetric: BOTH choice sets must be equal.
  const hpEqual = leftHp === rightHp;
  if (actionOnlyLow.length > 0 || (hpEqual && actionOnlyHigh.length > 0)) {
    return { classification: "unsafe", reason: hpEqual
      ? "equal-HP states must share identical choice sets"
      : "low-HP state has choices the high-HP state lacks", actionOnlyLow: summarizeChoices(actionOnlyLow, [low, high]), actionOnlyHigh: summarizeChoices(actionOnlyHigh, [low, high]) };
  }

  // Variant-set dominance coverage: every low variant needs a covering high
  // variant.  Equal-HP pairs are symmetric: BOTH directions must cover.
  const coverageLowToHigh = computeVariantCoverage(low, high, sharedChoices);
  let coverageHighToLow = null;
  if (hpEqual) coverageHighToLow = computeVariantCoverage(high, low, sharedChoices);
  const allUnmatched = coverageLowToHigh.unmatchedLowVariants.concat(coverageHighToLow ? coverageHighToLow.unmatchedLowVariants : []);
  const travelVariantDiffs = coverageLowToHigh.travelVariantDiffs.concat(coverageHighToLow ? coverageHighToLow.travelVariantDiffs : []);
  const travelDiffs = coverageLowToHigh.travelDiffs.concat(coverageHighToLow ? coverageHighToLow.travelDiffs : []);
  if (allUnmatched.length > 0) {
    return {
      classification: "unsafe",
      reason: hpEqual ? "an equal-HP travel variant has no symmetric covering variant" : "a low-HP travel variant has no dominance-covering high-HP variant",
      unmatchedLowVariants: allUnmatched.slice(0, 8),
      travelVariantDiffs: travelVariantDiffs.slice(0, 8),
      actionOnlyLow: [],
      actionOnlyHigh: [],
    };
  }

  // Metadata / equivalent / dominance-safe.
  const metadataDiffFields = [];
  const metaFields = ["rawRouteLength", "materializedRouteLength", "decisionDepth", "autoStepCount", "autoPickupCount", "autoBattleCount"];
  metaFields.forEach((field) => {
    if (left.projection.metadataLabel[field] !== right.projection.metadataLabel[field]) {
      metadataDiffFields.push(field);
    }
  });
  const coverageStats = {
    lowVariantsCovered: coverageLowToHigh.lowVariantsCovered + (coverageHighToLow ? coverageHighToLow.lowVariantsCovered : 0),
    highOnlyVariantCount: coverageLowToHigh.highOnlyVariantCount + (coverageHighToLow ? coverageHighToLow.highOnlyVariantCount : 0),
    variantPairsChecked: coverageLowToHigh.variantPairsChecked + (coverageHighToLow ? coverageHighToLow.variantPairsChecked : 0),
  };
  if (hpEqual && metadataDiffFields.length > 0) {
    return { classification: "metadata-only", reason: `identical HP/behavior; only metadata differs (${metadataDiffFields.join(",")})`, metadataDiffs: metadataDiffFields, travelDiffs: travelDiffs.slice(0, 8), travelVariantDiffs: travelVariantDiffs.slice(0, 8), ...coverageStats };
  }
  if (hpEqual) {
    return { classification: "equivalent", reason: "identical HP, choice sets, and behavior; no metadata difference", travelDiffs: travelDiffs.slice(0, 8), travelVariantDiffs: travelVariantDiffs.slice(0, 8), ...coverageStats };
  }
  return { classification: "dominance-safe", reason: "identical choice sets and successor behavior; HP differs monotonically", travelDiffs: travelDiffs.slice(0, 8), travelVariantDiffs: travelVariantDiffs.slice(0, 8), ...coverageStats, actionOnlyLow: [], actionOnlyHigh: [] };
}

function analyzeCandidateKeyCollisions(entries, keyField) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = entry.projection[keyField];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const collisionGroups = Array.from(groups.values()).filter((group) => group.length >= 2);
  return {
    candidate: keyField,
    uniqueKeyCount: groups.size,
    collisionGroupCount: collisionGroups.length,
    statesInCollisionGroups: collisionGroups.reduce((sum, group) => sum + group.length, 0),
    maxCollisionGroupSize: collisionGroups.reduce((max, group) => Math.max(max, group.length), 0),
    evidenceStatus: collisionGroups.length > 0 ? "collisions-present" : "insufficient-collisions",
  };
}

// entries: [{ state, projection }]; buildBehavior(state) -> behavior entry.
function analyzeKeyDependencyCorpus(entries, buildBehavior, options) {
  const config = options || {};

  const behaviorKeyCollisions = analyzeCandidateKeyCollisions(entries, "candidateFullBehaviorKey");
  const structuralResourceCollisions = analyzeCandidateKeyCollisions(entries, "candidateStructuralResourceKey");
  const legacyCollisions = analyzeCandidateKeyCollisions(entries, "legacyDecompositionKey");

  const groups = new Map();
  entries.forEach((entry) => {
    const key = entry.projection.candidateFullBehaviorKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const collisionStates = new Set();
  let behaviorBuilt = 0;
  Array.from(groups.values()).forEach((group) => {
    if (group.length < 2) return;
    group.forEach((entry) => {
      collisionStates.add(entry.projection.stateFingerprint);
      entry.behavior = buildBehavior(entry.state);
      behaviorBuilt += 1;
    });
  });

  const classifications = [];
  const witnesses = [];
  const analysisErrorWitnesses = [];
  // Duplicate-choice diagnostics computed ONCE per unique state (not per pair).
  const uniqueDuplicateStateFingerprints = new Set();
  let duplicateChoiceUniqueCount = 0;
  let maxVariantsPerChoice = 0;
  entries.forEach((entry) => {
    const behavior = entry.behavior;
    if (!behavior) return;
    const countsByChoice = new Map();
    behavior.actions.forEach((record) => {
      if (!record.choice || record.choice.actionChoiceFingerprint === "__enumerateError__") return;
      const key = record.choice.actionChoiceFingerprint;
      countsByChoice.set(key, (countsByChoice.get(key) || 0) + 1);
    });
    let hasDuplicate = false;
    countsByChoice.forEach((count) => {
      if (count > 1) {
        hasDuplicate = true;
        duplicateChoiceUniqueCount += 1;
        maxVariantsPerChoice = Math.max(maxVariantsPerChoice, count);
      }
    });
    if (hasDuplicate) uniqueDuplicateStateFingerprints.add(entry.projection.stateFingerprint);
  });
  const variantDiagnostics = {
    statesWithDuplicateChoices: uniqueDuplicateStateFingerprints.size,
    duplicateChoiceCount: duplicateChoiceUniqueCount,
    maxVariantsPerChoice,
    variantPairsChecked: 0,
    lowVariantsCovered: 0,
    unmatchedLowVariantCount: 0,
    highOnlyVariantCount: 0,
    variantCoverageUnsafeCount: 0,
    variantAnalysisErrorCount: 0,
  };
  const counts = {
    dominanceSafe: 0,
    equivalent: 0,
    metadataOnly: 0,
    unsafe: 0,
    analysisError: 0,
    unclassified: 0,
    actionChoiceOnlyMismatch: 0,
    travelVariantMismatch: 0,
    successorMismatch: 0,
    terminalMismatch: 0,
  };
  Array.from(groups.values()).forEach((group) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        if (!left.behavior || !right.behavior) continue;
        const result = classifyPair(left.behavior, right.behavior);
        const lowHp = left.projection.dominanceLabel.hp <= right.projection.dominanceLabel.hp ? left : right;
        const highHp = left.projection.dominanceLabel.hp <= right.projection.dominanceLabel.hp ? right : left;
        const witness = {
          classification: result.classification,
          candidateKey: left.projection.candidateFullBehaviorKey,
          lowHpState: {
            stateFingerprint: lowHp.projection.stateFingerprint,
            hp: lowHp.projection.dominanceLabel.hp,
            decisionDepth: lowHp.projection.dominanceLabel.decisionDepth,
            metadata: lowHp.projection.metadataLabel,
            eventHazardLabel: lowHp.projection.eventHazardLabel,
          },
          highHpState: {
            stateFingerprint: highHp.projection.stateFingerprint,
            hp: highHp.projection.dominanceLabel.hp,
            decisionDepth: highHp.projection.dominanceLabel.decisionDepth,
            metadata: highHp.projection.metadataLabel,
            eventHazardLabel: highHp.projection.eventHazardLabel,
          },
          actionOnlyLow: result.actionOnlyLow || [],
          actionOnlyHigh: result.actionOnlyHigh || [],
          sharedChoiceTravelDiffs: result.travelDiffs || [],
          sharedChoiceTravelVariantDiffs: (result.travelVariantDiffs || []).slice(0, 6),
          unmatchedLowVariants: (result.unmatchedLowVariants || []).slice(0, 6),
          terminalDiffs: result.terminalDiffs || [],
          lowVariantsCovered: result.lowVariantsCovered || 0,
          highOnlyVariantCount: result.highOnlyVariantCount || 0,
          reason: result.reason,
        };
        classifications.push(result.classification);
        if (result.classification === "analysis-error") {
          counts.analysisError += 1;
          variantDiagnostics.variantAnalysisErrorCount += 1;
          if (analysisErrorWitnesses.length < (config.maxWitnesses || 20)) analysisErrorWitnesses.push(witness);
        } else if (result.classification === "unsafe") {
          counts.unsafe += 1;
          if (witness.actionOnlyLow.length > 0 || witness.actionOnlyHigh.length > 0) counts.actionChoiceOnlyMismatch += 1;
          if (witness.sharedChoiceTravelVariantDiffs.length > 0) counts.travelVariantMismatch += 1;
          if (witness.unmatchedLowVariants.length > 0) {
            variantDiagnostics.variantCoverageUnsafeCount += 1;
            variantDiagnostics.unmatchedLowVariantCount += witness.unmatchedLowVariants.length;
          }
          if (witness.terminalDiffs.length > 0) counts.terminalMismatch += 1;
          if (witnesses.length < (config.maxWitnesses || 20)) witnesses.push(witness);
        } else if (result.classification === "dominance-safe") {
          counts.dominanceSafe += 1;
          if ((result.travelVariantDiffs || []).length > 0) counts.travelVariantMismatch += 1;
        } else if (result.classification === "equivalent") {
          counts.equivalent += 1;
        } else if (result.classification === "metadata-only") {
          counts.metadataOnly += 1;
        } else {
          counts.unclassified += 1;
        }
        variantDiagnostics.variantPairsChecked += result.variantPairsChecked || 0;
        variantDiagnostics.lowVariantsCovered += result.lowVariantsCovered || 0;
        variantDiagnostics.highOnlyVariantCount += result.highOnlyVariantCount || 0;
      }
    }
  });

  return {
    schema: "motapathfinder.key-dependency-corpus.v1",
    capturedStateCount: entries.length,
    behaviorKeyCollisions,
    structuralResourceCollisions,
    legacyCollisions,
    candidateGroupsAnalyzed: Array.from(groups.values()).filter((group) => group.length >= 2).length,
    statesInCandidateCollisionGroups: collisionStates.size,
    behaviorBuilt,
    classificationCounts: { ...counts },
    dominanceSafeCount: counts.dominanceSafe,
    equivalentCount: counts.equivalent,
    metadataOnlyCount: counts.metadataOnly,
    unsafeCount: counts.unsafe,
    analysisErrorCount: counts.analysisError,
    unclassifiedCount: counts.unclassified,
    mismatchBreakdown: {
      actionChoiceOnly: counts.actionChoiceOnlyMismatch,
      travelVariant: counts.travelVariantMismatch,
      successor: counts.successorMismatch,
      terminal: counts.terminalMismatch,
    },
    variantDiagnostics: {
      ...variantDiagnostics,
    },
    unsafeWitnesses: witnesses,
    analysisErrorWitnesses,
  };
}

module.exports = {
  CANDIDATE_PROFILES,
  analyzeCandidateKeyCollisions,
  analyzeKeyDependencyCorpus,
  behaviorRelevantFlags,
  buildActionChoiceIdentity,
  buildActionTravelVariant,
  buildCandidateDpKey,
  buildCandidateProjection,
  buildStateBehavior,
  buildStateProjection,
  buildTerminalProjection,
  classifyPair,
  computeVariantCoverage,
  findChoiceRecords,
  heroNumbers,
  isCoveringVariant,
  stableValue,
  successorBehaviorKey,
};
