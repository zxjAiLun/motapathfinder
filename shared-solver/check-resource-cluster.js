"use strict";

const assert = require("node:assert");

const { detectLocalActionClusters, enumerateResourceClusterActions } = require("./lib/resource-cluster");
const { StaticSimulator, __testing: simulatorTesting } = require("./lib/simulator");

const ACTIONS = {
  A: {
    gain: { atk: 1 },
    damage: (hero) => 220 - Number(hero.def || 0) * 70 - Number(hero.mdef || 0) * 30,
  },
  B: {
    gain: { def: 1 },
    damage: (hero) => 210 - Number(hero.atk || 0) * 80,
  },
  C: {
    gain: { mdef: 1 },
    damage: (hero) => 200 - Number(hero.def || 0) * 60,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeInitialState() {
  return {
    floorId: "MT1",
    hero: {
      loc: { x: 6, y: 6 },
      hp: 1000,
      hpmax: 1000,
      mana: 0,
      manamax: 0,
      atk: 0,
      def: 0,
      mdef: 0,
      money: 0,
      exp: 0,
      lv: 1,
      equipment: [],
      followers: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: { MT1: true },
    floorStates: { MT1: { removed: {}, replaced: {} } },
    route: [],
    done: [],
  };
}

function makeSimulator() {
  return {
    enumeratePrimitiveActions(state) {
      const done = new Set(state.done || []);
      return {
        actions: Object.keys(ACTIONS)
          .filter((label) => !done.has(label))
          .map((label) => ({
            kind: "battle",
            floorId: "MT1",
            clusterLabel: label,
            resourceId: label,
            summary: label,
            estimate: {
              damage: Math.max(1, ACTIONS[label].damage(state.hero)),
              exp: 1,
            },
          })),
      };
    },
    applyAction(state, action) {
      const next = clone(state);
      const spec = ACTIONS[action.clusterLabel];
      assert.ok(spec, `unknown action ${action.clusterLabel}`);
      next.hero.hp -= Math.max(1, spec.damage(next.hero));
      Object.entries(spec.gain).forEach(([field, amount]) => {
        next.hero[field] = Number(next.hero[field] || 0) + amount;
      });
      next.done = (next.done || []).concat([action.clusterLabel]);
      next.floorStates.MT1.removed[action.clusterLabel] = true;
      next.route = (next.route || []).concat([action.summary]);
      return next;
    },
    getActionFingerprint(action) {
      return action.clusterLabel;
    },
    normalizePocketStep(action) {
      return {
        kind: action.kind,
        summary: action.summary,
        fingerprint: action.clusterLabel,
        floorId: action.floorId,
        clusterLabel: action.clusterLabel,
        resourceId: action.resourceId,
      };
    },
    buildSearchConfluenceKey(state) {
      return JSON.stringify({
        floorId: state.floorId,
        atk: state.hero.atk,
        def: state.hero.def,
        mdef: state.hero.mdef,
        exp: state.hero.exp,
        lv: state.hero.lv,
        done: (state.done || []).slice().sort(),
      });
    },
  };
}

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => {
    const rest = items.slice(0, index).concat(items.slice(index + 1));
    return permutations(rest).map((suffix) => [item].concat(suffix));
  });
}

function replayLabels(simulator, labels) {
  return labels.reduce((state, label) => {
    const action = simulator.enumeratePrimitiveActions(state).actions.find((candidate) => candidate.clusterLabel === label);
    return simulator.applyAction(state, action);
  }, makeInitialState());
}

function checkAbcDominance() {
  const simulator = makeSimulator();
  const initialState = makeInitialState();
  const primitiveActions = simulator.enumeratePrimitiveActions(initialState).actions;
  const diagnostics = {
    enabled: true,
    clustersEnumerated: 0,
    dpStates: 0,
    skylineRejected: 0,
    skylineReplaced: 0,
    foundationCompositionsEnumerated: 0,
    foundationDpStates: 0,
    foundationReplayFailures: 0,
    foundationPlansAlreadyCovered: 0,
    foundationPlanStepsAlreadyCovered: 0,
    foundationPlansSelected: 0,
    foundationActionsOutput: 0,
    actionsOutput: 0,
    examples: [],
  };
  const actions = enumerateResourceClusterActions(simulator, initialState, primitiveActions, {
    maxDepth: 3,
    minPlanLength: 3,
    branchLimit: 3,
    frontierLimit: 12,
    resultLimit: 10,
    diagnostics,
  });

  const best = permutations(["A", "B", "C"])
    .map((labels) => ({ labels, state: replayLabels(simulator, labels) }))
    .sort((left, right) => right.state.hero.hp - left.state.hero.hp)[0];

  assert.equal(actions.length, 1, "ABC confluence skyline should output one final representative");
  const action = actions[0];
  const labels = action.planEntries.map((entry) => entry.clusterLabel);
  assert.deepEqual(labels, best.labels, "resourceCluster should keep the highest-HP ABC order");
  assert.equal(action.estimate.hpAfter, best.state.hero.hp);
  assert.equal(action.estimate.atk, 1);
  assert.equal(action.estimate.def, 1);
  assert.equal(action.estimate.mdef, 1);
  assert.ok(diagnostics.dpStates > 0, "resourceCluster should run DP states");
  assert.ok(diagnostics.skylineRejected > 0, "lower-HP isomorphic ABC orders should be rejected during DP skyline insertion");
  assert.ok(action.estimate.dominatedPlans > 0, "selected representative should carry dominated plan count");
  assert.equal(action.estimate.rejectedByClusterDominance, diagnostics.skylineRejected, "action estimate should surface DP skyline rejects");
  assert.equal(action.summary, `resourceCluster:MT1:${best.labels.join("")}:bestHp`);
  action.planEntries.forEach((entry) => {
    assert.ok(entry.clusterActionId && entry.clusterActionId.startsWith("battle@MT1:"), "cluster mask should use stable battle resource ids");
  });

  console.log(JSON.stringify({
    selected: action.summary,
    hpAfter: action.estimate.hpAfter,
    dominatedPlans: action.estimate.dominatedPlans,
    skylineSize: action.estimate.skylineSize,
    dpStates: diagnostics.dpStates,
    skylineRejected: diagnostics.skylineRejected,
  }, null, 2));
}

function makeDoorClusterSimulator() {
  return {
    enumeratePrimitiveActions(state) {
      if (!state.doorOpen) {
        return {
          actions: [{
            kind: "openDoor",
            floorId: "MT1",
            target: { x: 2, y: 2 },
            doorId: "yellowDoor",
            summary: "open yellow door",
          }],
        };
      }
      if (!state.gemTaken) {
        return {
          actions: [{
            kind: "pickup",
            floorId: "MT1",
            x: 3,
            y: 2,
            itemId: "redJewel",
            summary: "pick red jewel",
          }],
        };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = clone(state);
      if (action.kind === "openDoor") {
        next.doorOpen = true;
        next.floorStates.MT1.removed.yellowDoor = true;
        return next;
      }
      if (action.kind === "pickup") {
        next.gemTaken = true;
        next.hero.atk += 1;
        next.floorStates.MT1.removed.redJewel = true;
        return next;
      }
      throw new Error(`unsupported action ${action.kind}`);
    },
    buildSearchConfluenceKey(state) {
      return JSON.stringify({
        floorId: state.floorId,
        atk: state.hero.atk,
        doorOpen: Boolean(state.doorOpen),
        gemTaken: Boolean(state.gemTaken),
      });
    },
  };
}

function checkUnlockActions() {
  const simulator = makeDoorClusterSimulator();
  const initialState = makeInitialState();
  const primitiveActions = simulator.enumeratePrimitiveActions(initialState).actions;
  const diagnostics = {
    enabled: true,
    clustersEnumerated: 0,
    dpStates: 0,
    skylineRejected: 0,
    skylineReplaced: 0,
    actionsOutput: 0,
    examples: [],
  };
  const actions = enumerateResourceClusterActions(simulator, initialState, primitiveActions, {
    maxDepth: 2,
    minPlanLength: 2,
    branchLimit: 2,
    frontierLimit: 4,
    resultLimit: 4,
    diagnostics,
  });
  assert.equal(actions.length, 1, "openDoor that unlocks a local resource should enter resourceCluster");
  const action = actions[0];
  assert.deepEqual(action.planEntries.map((entry) => entry.kind), ["openDoor", "pickup"]);
  assert.deepEqual(action.planEntries.map((entry) => entry.clusterActionId), [
    "openDoor@MT1:2,2:yellowDoor",
    "pickup@MT1:3,2:redJewel",
  ]);
  assert.equal(action.estimate.atk, 1);
}

function checkDetectorFindsGuardedResourceLookahead() {
  const state = makeInitialState();
  const battle = {
    kind: "battle",
    floorId: "MT1",
    target: { x: 4, y: 4 },
    enemyId: "guard",
    summary: "defeat guard",
    estimate: { damage: 50, exp: 1 },
  };
  const pickup = {
    kind: "pickup",
    floorId: "MT1",
    target: { x: 4, y: 5 },
    itemId: "blueJewel",
    summary: "pick blue jewel",
  };
  const clusters = simulatorTesting.detectResourceCandidateClusters([battle, pickup]);
  assert.equal(clusters.length, 1, "adjacent guard and resource should form a detector cluster");
  assert.equal(clusters[0].hasGuard, true);
  assert.equal(clusters[0].hasResource, true);

  const detectorContext = {
    resourceClusterOptions: { minCandidateActions: 2, minResourceSignals: 2 },
    resourceClusterStats: {
      candidateStates: 0,
      skippedNoCandidate: 0,
      skippedTooFewCandidates: 0,
      skippedTooFewSignals: 0,
      detectorCandidateCount: 0,
      detectorResourceSignals: 0,
      detectorUnlockSignals: 0,
      detectorLookaheadResourceSignals: 0,
      detectorClusters: 0,
      detectorGuardedResourceClusters: 0,
      detectorMaxClusterSize: 0,
      detectorByKind: {},
    },
    isResourceClusterCandidateAction: StaticSimulator.prototype.isResourceClusterCandidateAction,
    getResourceClusterCandidateSummary: StaticSimulator.prototype.getResourceClusterCandidateSummary,
    shouldEnumerateResourceCluster: StaticSimulator.prototype.shouldEnumerateResourceCluster,
    getActionFingerprint(action) {
      return action.itemId || action.enemyId || action.summary;
    },
    applyAction(currentState, action) {
      const next = clone(currentState);
      if (action.kind === "battle") next.guardCleared = true;
      return next;
    },
    enumeratePrimitiveActions(currentState) {
      return { actions: currentState.guardCleared ? [pickup] : [battle] };
    },
  };
  assert.equal(
    detectorContext.shouldEnumerateResourceCluster(state, [battle]),
    true,
    "single guard action should enter resourceCluster when lookahead reveals a local resource"
  );
  assert.equal(detectorContext.resourceClusterStats.candidateStates, 1);
  assert.equal(detectorContext.resourceClusterStats.detectorLookaheadResourceSignals, 1);
}

function makeSplitClusterSimulator() {
  const specs = {
    A: { x: 1, y: 1, gain: { atk: 1 }, damage: 20 },
    B: { x: 1, y: 2, gain: { def: 1 }, damage: 15 },
    X: { x: 10, y: 10, gain: { mdef: 1 }, damage: 10 },
    Y: { x: 10, y: 11, gain: { exp: 1 }, damage: 5 },
  };
  return {
    enumeratePrimitiveActions(state) {
      const done = new Set(state.done || []);
      return {
        actions: Object.entries(specs)
          .filter(([label]) => !done.has(label))
          .map(([label, spec]) => ({
            kind: "battle",
            floorId: "MT1",
            clusterLabel: label,
            enemyId: label,
            target: { x: spec.x, y: spec.y },
            summary: label,
            estimate: { damage: spec.damage, exp: 1 },
          })),
      };
    },
    applyAction(state, action) {
      const next = clone(state);
      const spec = specs[action.clusterLabel];
      next.hero.hp -= spec.damage;
      Object.entries(spec.gain).forEach(([field, amount]) => {
        next.hero[field] = Number(next.hero[field] || 0) + amount;
      });
      next.done = (next.done || []).concat([action.clusterLabel]);
      next.floorStates.MT1.removed[action.clusterLabel] = true;
      return next;
    },
    normalizePocketStep(action) {
      return {
        kind: action.kind,
        summary: action.summary,
        floorId: action.floorId,
        clusterLabel: action.clusterLabel,
        fingerprint: `${action.clusterLabel}`,
      };
    },
    buildSearchConfluenceKey(state) {
      return JSON.stringify({
        floorId: state.floorId,
        done: (state.done || []).slice().sort(),
        atk: state.hero.atk,
        def: state.hero.def,
        mdef: state.hero.mdef,
        exp: state.hero.exp,
      });
    },
  };
}

function checkLocalClusterSplitting() {
  const simulator = makeSplitClusterSimulator();
  const initialState = makeInitialState();
  const primitiveActions = simulator.enumeratePrimitiveActions(initialState).actions;
  const localClusters = detectLocalActionClusters(simulator, initialState, primitiveActions, {
    clusterLinkDistance: 2,
  });
  assert.equal(localClusters.length, 2, "far-apart resources should produce two local clusters");

  const diagnostics = {
    enabled: true,
    clustersEnumerated: 0,
    localClustersDetected: 0,
    localClusterMaxSize: 0,
    dpStates: 0,
    skylineRejected: 0,
    skylineReplaced: 0,
    actionsOutput: 0,
    examples: [],
  };
  const actions = enumerateResourceClusterActions(simulator, initialState, primitiveActions, {
    maxDepth: 2,
    minPlanLength: 2,
    branchLimit: 2,
    frontierLimit: 4,
    resultLimit: 2,
    composeLocalClusters: false,
    diagnostics,
  });
  assert.equal(diagnostics.clustersEnumerated, 2, "resourceCluster DP should run per local cluster");
  assert.equal(diagnostics.localClustersDetected, 2);
  assert.equal(actions.length, 2, "each local cluster should output its own foundation action");
  actions.forEach((action) => {
    const labels = action.planEntries.map((entry) => entry.clusterLabel).sort().join("");
    assert.ok(labels === "AB" || labels === "XY", `local cluster action should not mix far clusters: ${labels}`);
  });
}

function checkLocalClusterFoundationComposition() {
  const simulator = makeSplitClusterSimulator();
  const initialState = makeInitialState();
  const primitiveActions = simulator.enumeratePrimitiveActions(initialState).actions;
  const diagnostics = {
    enabled: true,
    clustersEnumerated: 0,
    localClustersDetected: 0,
    localClusterMaxSize: 0,
    foundationCompositionsEnumerated: 0,
    foundationDpStates: 0,
    foundationReplayFailures: 0,
    foundationPlansAlreadyCovered: 0,
    foundationPlanStepsAlreadyCovered: 0,
    foundationPlansSelected: 0,
    foundationActionsOutput: 0,
    dpStates: 0,
    skylineRejected: 0,
    skylineReplaced: 0,
    actionsOutput: 0,
    examples: [],
  };
  const actions = enumerateResourceClusterActions(simulator, initialState, primitiveActions, {
    maxDepth: 2,
    minPlanLength: 2,
    branchLimit: 2,
    frontierLimit: 4,
    resultLimit: 2,
    maxOutputActions: 4,
    foundationMaxClusters: 2,
    foundationRepresentatives: 1,
    foundationLimit: 2,
    diagnostics,
  });
  assert.ok(diagnostics.foundationCompositionsEnumerated > 0, "split local clusters should be composed into floor foundations");
  assert.ok(diagnostics.foundationDpStates > 0, "foundation composition should run bounded DP");
  assert.ok(diagnostics.foundationActionsOutput > 0, "composed foundation actions should be surfaced");
  assert.ok(
    actions.some((action) => {
      const labels = action.planEntries.map((entry) => entry.clusterLabel).sort().join("");
      return labels === "ABXY" && (action.estimate || {}).foundationClusters === 2;
    }),
    "resourceCluster should output a composed action covering both local clusters"
  );
}

function main() {
  checkAbcDominance();
  checkUnlockActions();
  checkDetectorFindsGuardedResourceLookahead();
  checkLocalClusterSplitting();
  checkLocalClusterFoundationComposition();
}

main();
