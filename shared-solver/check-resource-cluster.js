"use strict";

const assert = require("node:assert");

const { enumerateResourceClusterActions } = require("./lib/resource-cluster");

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

function main() {
  const simulator = makeSimulator();
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

  console.log(JSON.stringify({
    selected: action.summary,
    hpAfter: action.estimate.hpAfter,
    dominatedPlans: action.estimate.dominatedPlans,
    skylineSize: action.estimate.skylineSize,
    dpStates: diagnostics.dpStates,
    skylineRejected: diagnostics.skylineRejected,
  }, null, 2));
}

main();
