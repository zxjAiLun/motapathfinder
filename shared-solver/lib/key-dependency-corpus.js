"use strict";

/**
 * PR-5.4c Commit 1 — Key Dependency Corpus (observation only).
 *
 * For real DP states captured from a representative search, records:
 *   - current exact DP key (region mode)
 *   - structural projection (legacy region signature + TowerIR reachability)
 *   - resource projection (hero numeric fields, inventory, flags)
 *   - event / hazard projection (triggered auto events, auto counters, depth)
 *   - legal action set + per-action successor exact fingerprints
 *
 * The analysis groups states by the candidate decomposition and reports
 * "merge hazard" candidates: states with an identical decomposition whose legal
 * action SETS or per-action SUCCESSORS differ — the exact signals Commit 2's
 * Dual-Key shadow will exploit.  Nothing here touches production.
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

function actionFingerprint(action) {
  if (!action) return null;
  if (typeof action.summary === "string" && action.summary.length > 0) return action.summary;
  if (action.kind) return `${action.kind}:${(action.floorId || "")}:${action.x != null ? action.x + "," + action.y : ""}`;
  return JSON.stringify(stableValue(action));
}

function buildStateDecomposition(simulator, project, ir, state, options) {
  const config = options || {};
  const exactKey = buildDpStateKey(simulator, state, {
    dpKeyMode: config.dpKeyMode || "region",
    solverModel: config.solverModel,
    model: config.model,
  });

  const regionSignature = simulator.buildReachableRegionSignature(state);
  const structural = {
    floorId: state.floorId,
    loc: [Number(state.hero.loc.x), Number(state.hero.loc.y)],
    regionKey: regionSignature.regionKey,
    reachableEndpointsKey: regionSignature.reachableEndpointsKey,
    mutations: listFloorMutationSummary(state.floorStates || {}),
  };

  let towerIr = null;
  if (ir) {
    try {
      const irResult = evaluateTowerIRReachability(ir, project, state);
      towerIr = {
        startComponentId: irResult.startComponentId,
        reachableComponentIds: irResult.reachableComponentIds,
        reachablePoiIds: irResult.reachablePoiIds,
        reachableEndpoints: (irResult.reachableEndpointDescriptors || []).map((endpoint) => ({
          kind: endpoint.kind,
          floorId: endpoint.floorId,
          x: endpoint.x,
          y: endpoint.y,
          tileId: endpoint.tileId || null,
          targetId: endpoint.targetId || null,
        })),
      };
    } catch (error) {
      towerIr = { error: String(error && error.message || error) };
    }
  }

  const hero = state.hero || {};
  const resource = {
    hero: {
      hp: Number(hero.hp || 0),
      atk: Number(hero.atk || 0),
      def: Number(hero.def || 0),
      mdef: Number(hero.mdef || 0),
      lv: Number(hero.lv || 0),
      exp: Number(hero.exp || 0),
      money: Number(hero.money || 0),
      mana: Number(hero.mana || 0),
    },
    inventory: stableValue(state.inventory || {}),
    flags: stableValue(state.flags || {}),
    visitedFloors: Object.keys(state.visitedFloors || {}).sort(),
  };

  const meta = state.meta || {};
  const event = {
    triggeredAutoEvents: stableValue(state.triggeredAutoEvents || {}),
    autoStepCount: Number(meta.autoStepCount || 0),
    autoPickupCount: Number(meta.autoPickupCount || 0),
    autoBattleCount: Number(meta.autoBattleCount || 0),
    decisionDepth: Number(meta.decisionDepth || 0),
  };

  // Legal action set + successor fingerprints (observation only).
  const actionRecords = [];
  const actionSummaries = [];
  try {
    const enumerated = simulator.enumeratePrimitiveActions(state);
    const actions = (enumerated && enumerated.actions) || [];
    for (const action of actions) {
      const summary = actionFingerprint(action);
      actionSummaries.push(summary);
      let successorFingerprint = null;
      let successorError = null;
      try {
        const successor = simulator.applyAction(cloneState(state), action, { storeRoute: false });
        successorFingerprint = exactStateFingerprint(successor);
      } catch (error) {
        successorError = String(error && error.message || error);
      }
      actionRecords.push({ action: summary, successorFingerprint, successorError });
    }
  } catch (error) {
    actionRecords.push({ action: "__enumerateError__", successorFingerprint: null, successorError: String(error && error.message || error) });
  }
  actionSummaries.sort();

  return {
    exactKey,
    structural,
    towerIr,
    resource,
    event,
    actionSet: Array.from(new Set(actionSummaries)).sort(),
    actions: actionRecords,
    decompositionKey: fingerprintJson({ structural, resource, event }),
    decompositionKeyWithTowerIr: fingerprintJson({ structural, towerIr, resource, event }),
  };
}

// Which candidate field groups actually vary in the corpus, and which
// correlate with action-set differences.
function analyzeKeyDependencyCorpus(entries) {
  const exactKeySet = new Set();
  const structuralSet = new Set();
  const resourceSet = new Set();
  const eventSet = new Set();
  const decompositionSet = new Set();
  const actionSetByDecomposition = new Map();

  entries.forEach((entry) => {
    exactKeySet.add(entry.decomposition.exactKey);
    structuralSet.add(fingerprintJson(entry.decomposition.structural));
    resourceSet.add(fingerprintJson(entry.decomposition.resource));
    eventSet.add(fingerprintJson(entry.decomposition.event));
    decompositionSet.add(entry.decomposition.decompositionKey);
    const actionSignature = fingerprintJson(entry.decomposition.actionSet);
    const existing = actionSetByDecomposition.get(entry.decomposition.decompositionKey);
    if (existing && existing !== actionSignature) existing.conflict = true;
    actionSetByDecomposition.set(entry.decomposition.decompositionKey, {
      signature: actionSignature,
      conflict: Boolean(existing && existing.conflict),
    });
  });

  // Hero field variance across the corpus.
  const heroVariance = {};
  const inventoryVariance = {};
  const flagsVariance = {};
  entries.forEach((entry) => {
    const hero = entry.decomposition.resource.hero;
    Object.keys(hero).forEach((field) => {
      const value = hero[field];
      if (!(field in heroVariance)) heroVariance[field] = new Set();
      heroVariance[field].add(value);
    });
    Object.keys(entry.decomposition.resource.inventory || {}).forEach((item) => {
      if (!(item in inventoryVariance)) inventoryVariance[item] = new Set();
      inventoryVariance[item].add(entry.decomposition.resource.inventory[item]);
    });
    Object.keys(entry.decomposition.resource.flags || {}).forEach((flag) => {
      if (!(flag in flagsVariance)) flagsVariance[flag] = new Set();
      flagsVariance[flag].add(entry.decomposition.resource.flags[flag]);
    });
  });
  const summarize = (variation) => Object.fromEntries(
    Object.entries(variation).map(([key, values]) => [key, values.size]),
  );

  // Merge hazard candidates: states sharing a decomposition whose action SETS
  // or per-action SUCCESSORS differ.
  const groups = new Map();
  entries.forEach((entry, index) => {
    const key = entry.decomposition.decompositionKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, entry });
  });
  const hazards = [];
  const collectGroupHazards = (group, label) => {
    if (group.length < 2) return;
    const actionSets = new Map();
    group.forEach(({ entry }) => {
      const signature = fingerprintJson(entry.decomposition.actionSet);
      if (!actionSets.has(signature)) actionSets.set(signature, []);
      actionSets.get(signature).push(entry.decomposition.exactKey);
    });
    if (actionSets.size > 1) {
      hazards.push({
        kind: "actionSet",
        group: label,
        decompositionKey: group[0].entry.decomposition.decompositionKey,
        exactKeys: group.map(({ entry }) => entry.decomposition.exactKey),
        distinctActionSetCount: actionSets.size,
        actionSets: Array.from(actionSets.entries()).map(([signature, keys]) => ({ actionSetSignature: signature, exactKeys: keys })),
      });
    }
    const byAction = new Map();
    group.forEach(({ entry }) => {
      entry.decomposition.actions.forEach((record) => {
        if (!byAction.has(record.action)) byAction.set(record.action, []);
        byAction.get(record.action).push({ successorFingerprint: record.successorFingerprint, exactKey: entry.decomposition.exactKey });
      });
    });
    byAction.forEach((records, action) => {
      const fingerprints = new Set(records.map((record) => record.successorFingerprint));
      if (fingerprints.size > 1) {
        hazards.push({
          kind: "successor",
          group: label,
          decompositionKey: group[0].entry.decomposition.decompositionKey,
          action,
          distinctSuccessorCount: fingerprints.size,
          records: records.slice(0, 8),
        });
      }
    });
  };
  groups.forEach((group) => collectGroupHazards(group, "decomposition"));

  // Same-EXACT-KEY grouping: the DP key merges states that may still differ in
  // the candidate decomposition fields (decisionDepth, auto counters, triggered
  // events).  If such merged states behave differently, the merge is a hazard
  // candidate for Commit 2's dual-key shadow.
  const keyGroups = new Map();
  entries.forEach((entry, index) => {
    if (!keyGroups.has(entry.decomposition.exactKey)) keyGroups.set(entry.decomposition.exactKey, []);
    keyGroups.get(entry.decomposition.exactKey).push({ index, entry });
  });
  const exactKeyMergeHazards = [];
  keyGroups.forEach((group) => {
    if (group.length < 2) return;
    const actionSets = new Set(group.map(({ entry }) => fingerprintJson(entry.decomposition.actionSet)));
    const distinctDecompositions = new Set(group.map(({ entry }) => entry.decomposition.decompositionKey));
    if (actionSets.size > 1) {
      exactKeyMergeHazards.push({
        kind: "exactKeyActionSet",
        exactKey: group[0].entry.decomposition.exactKey,
        stateCount: group.length,
        distinctDecompositionCount: distinctDecompositions.size,
        distinctActionSetCount: actionSets.size,
        exactKeys: group.map(({ entry }) => entry.decomposition.exactKey),
      });
    }
    const byAction = new Map();
    group.forEach(({ entry }) => {
      entry.decomposition.actions.forEach((record) => {
        if (!byAction.has(record.action)) byAction.set(record.action, []);
        byAction.get(record.action).push({ successorFingerprint: record.successorFingerprint, exactKey: entry.decomposition.exactKey });
      });
    });
    byAction.forEach((records, action) => {
      const fingerprints = new Set(records.map((record) => record.successorFingerprint));
      if (fingerprints.size > 1) {
        exactKeyMergeHazards.push({
          kind: "exactKeySuccessor",
          exactKey: group[0].entry.decomposition.exactKey,
          action,
          distinctSuccessorCount: fingerprints.size,
        });
      }
    });
  });

  return {
    schema: "motapathfinder.key-dependency-corpus.v1",
    stateCount: entries.length,
    uniqueExactKeys: exactKeySet.size,
    uniqueStructuralSignatures: structuralSet.size,
    uniqueResourceLabels: resourceSet.size,
    uniqueEventLabels: eventSet.size,
    uniqueDecompositions: decompositionSet.size,
    heroFieldVariance: summarize(heroVariance),
    inventoryVariance: summarize(inventoryVariance),
    flagsVariance: summarize(flagsVariance),
    actionSetConflictCount: Array.from(actionSetByDecomposition.values()).filter((value) => value.conflict).length,
    mergeHazardCandidates: hazards.slice(0, 40),
    mergeHazardCount: hazards.length,
    byHazardKind: hazards.reduce((acc, hazard) => { acc[hazard.kind] = (acc[hazard.kind] || 0) + 1; return acc; }, {}),
    exactKeyMergeHazardCandidates: exactKeyMergeHazards.slice(0, 40),
    exactKeyMergeHazardCount: exactKeyMergeHazards.length,
    exactKeyGroupsWithMultipleStates: Array.from(keyGroups.values()).filter((group) => group.length >= 2).length,
  };
}

module.exports = {
  actionFingerprint,
  analyzeKeyDependencyCorpus,
  buildStateDecomposition,
  stableValue,
};
