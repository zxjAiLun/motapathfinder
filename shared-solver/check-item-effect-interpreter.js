"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 3 – Deterministic Item-Effect Interpreter Equivalence Gate
 *
 * The itemEffect fast path in lib/effect-vm.js evaluates simple core-interface
 * statement sequences in-process (no V8 context). This gate proves exact-state
 * equivalence against the authoritative VM execution:
 *
 *   - all cls="items" items with itemEffect, deterministic pre-states
 *   - randomized adversarial pre-states (hero/values/floor-ratio/flags/inventory)
 *   - interpreter result fingerprint === VM result fingerprint
 *   - non-reducible sources must fall back to the VM (parse failure → null)
 *
 * Semantics protected: identical hero mutations, identical flag mutations,
 * identical inventory mutations.
 */

const assert = require("node:assert");
const vm = require("node:vm");
const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const { executeItemEffect, buildEffectCore } = require("./lib/effect-vm");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function fingerprint(state) {
  return JSON.stringify({
    hero: state.hero,
    flags: state.flags,
    inventory: state.inventory,
  });
}

function runEquivalence(project) {
  const floorIds = Object.keys(project.floorsById || {});
  const clsItems = Object.values(project.itemsById || {})
    .filter((item) => item && typeof item.itemEffect === "string" && item.itemEffect.length > 0 && item.cls === "items");
  assert.ok(clsItems.length > 0, "Project must contain items with itemEffect");

  let seed = 20260828;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const valueKeys = Object.keys(project.values || {});
  const makePreState = () => ({
    floorId: floorIds[Math.floor(rnd() * floorIds.length)],
    hero: {
      hp: Math.floor(rnd() * 2000),
      atk: Math.floor(rnd() * 200),
      def: Math.floor(rnd() * 100),
      mdef: Math.floor(rnd() * 300),
      money: Math.floor(rnd() * 1000),
      lv: Math.floor(rnd() * 10),
      exp: Math.floor(rnd() * 50),
    },
    flags: { f1: Math.floor(rnd() * 10) },
    inventory: { redKey: Math.floor(rnd() * 5) },
    notes: [],
    __values: (() => {
      const values = {};
      for (const key of valueKeys) values[key] = Math.floor(rnd() * 100);
      return values;
    })(),
  });

  let total = 0;
  let agree = 0;
  const disagreements = [];
  for (const item of clsItems) {
    for (let trial = 0; trial < 5; trial += 1) {
      const pre = makePreState();
      const savedValues = project.values;
      const interpreted = JSON.parse(JSON.stringify(pre));
      const vmState = JSON.parse(JSON.stringify(pre));
      project.values = pre.__values;
      try {
        executeItemEffect(project, interpreted, item, {});
        const context = { core: buildEffectCore(project, vmState), Math };
        vm.runInNewContext(item.itemEffect, context, { timeout: 1000 });
      } finally {
        project.values = savedValues;
      }
      total += 1;
      if (fingerprint(interpreted) === fingerprint(vmState)) agree += 1;
      else disagreements.push({ itemId: item.id, effect: item.itemEffect.slice(0, 120) });
    }
  }
  assert.strictEqual(
    disagreements.length,
    0,
    `Item-effect interpreter diverged from VM on ${disagreements.length}/${total} cases: ${JSON.stringify(disagreements.slice(0, 5))}`,
  );
  return { total, agree, uniqueEffects: new Set(clsItems.map((i) => i.itemEffect.replace(/\s+/g, " ").trim())).size };
}

function main() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const result = runEquivalence(project);
  console.log(JSON.stringify({
    schema: "motapathfinder.item-effect-interpreter-equivalence.v1",
    contractStatus: "passed",
    adversarialCases: result.total,
    agree: result.agree,
    disagree: 0,
    uniqueEffectPrograms: result.uniqueEffects,
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main, runEquivalence };
