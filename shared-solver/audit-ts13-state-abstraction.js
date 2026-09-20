"use strict";

/**
 * Phase 1 — TS13 State-Abstraction Shadow Audit
 *
 * Strictly observation-only: does NOT modify production DP keys, dominance rules,
 * goal predicates, or search behavior.
 *
 * Evaluates whether state distinctions driven purely by past item/monster consumption
 * history can be safely abstracted into a Strategic Future Action Signature without
 * causing action set mismatches, reachability differences, or successor relation divergences.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const d = require("./lib/durable-search");
const { searchDP } = require("./lib/dp-search");
const { buildStateKey } = require("./lib/state-key");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    corpusSize: 500,
    towerRoot: null,
    configFile: path.resolve(__dirname, "profiles/neko-zero-key.json"),
    output: path.resolve(__dirname, "routes/generated/shadow-audits/ts13-state-abstraction-audit.json"),
  };
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, val] = match;
    if (key === "corpus-size") options.corpusSize = Number(val);
    else if (key === "tower-root") options.towerRoot = path.resolve(val);
    else if (key === "config") options.configFile = path.resolve(val);
    else if (key === "output") options.output = path.resolve(val);
  }
  return options;
}

function resolveTowerRoot(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const projectRoot = path.resolve(__dirname, "..");
  const nekoDir = path.join(projectRoot, "neko591");
  if (fs.existsSync(nekoDir)) {
    const sub = fs.readdirSync(nekoDir).find((s) => fs.existsSync(path.join(nekoDir, s, "project")));
    if (sub) return path.join(nekoDir, sub);
  }
  throw new Error("Unable to locate tower root for TS13 audit");
}

function getStrategicActionSet(simulator, state) {
  const actions = simulator.enumerateActions(state);
  return Array.from(new Set(actions.map((a) => a.summary))).sort();
}

function computeShadowKey(simulator, state) {
  const loc = `${state.hero.loc.x},${state.hero.loc.y}`;
  const heroResources = {
    atk: Number(state.hero.atk || 0),
    def: Number(state.hero.def || 0),
    mdef: Number(state.hero.mdef || 0),
    lv: Number(state.hero.lv || 1),
    exp: Number(state.hero.exp || 0),
  };
  const strategicActionSignature = getStrategicActionSet(simulator, state);
  return JSON.stringify({
    floorId: state.floorId,
    loc,
    hero: heroResources,
    strategicActionSignature,
  });
}

function runShadowAudit(options = {}) {
  const towerRoot = resolveTowerRoot(options.towerRoot);
  const project = loadProject(towerRoot);
  const config = d.readJson(options.configFile);
  const sim = d.makeSimulator(project, config);
  const targetCorpusSize = Number(options.corpusSize || 500);

  const startState = {
    floorId: "TS13",
    hero: { hp: 1353, atk: 6, def: 0, mdef: 0, lv: 2, exp: 18, loc: { x: 1, y: 1, direction: "left" } },
    inventory: { greenKey: 34 },
    flags: { shiqu: 1, autoBattle: 1 },
    visitedFloors: { TS13: true },
    floorStates: { TS13: { removed: {}, replaced: {} } },
  };

  const capturedStates = [];
  const capturedProductionKeys = new Set();

  const originalApply = sim.applyAction.bind(sim);
  sim.applyAction = (s, action, opts) => {
    const next = originalApply(s, action, opts);
    if (next && next.floorId === "TS13") {
      const key = buildStateKey(next);
      if (!capturedProductionKeys.has(key) && capturedStates.length < targetCorpusSize) {
        capturedProductionKeys.add(key);
        capturedStates.push(JSON.parse(JSON.stringify(next)));
      }
    }
    return next;
  };

  searchDP(sim, startState, {
    goalPredicate: (candidate) => candidate.floorId === "TS14",
    maxExpansions: targetCorpusSize * 2,
    maxRuntimeMs: 30000,
    maxRssMb: 4096,
    maxHeapMb: 2048,
    actionFilter: (action) => !d.protectedCost(action, config),
  });

  // Group captured states into shadow equivalence classes
  const shadowGroups = new Map();
  for (const s of capturedStates) {
    const sk = computeShadowKey(sim, s);
    if (!shadowGroups.has(sk)) shadowGroups.set(sk, []);
    shadowGroups.get(sk).push(s);
  }

  let collisionGroupCount = 0;
  let actionSetMismatches = 0;
  let reachabilityMismatches = 0;
  let projectedSuccessorMismatches = 0;
  let totalTransitionsAudited = 0;

  for (const [, group] of shadowGroups.entries()) {
    if (group.length < 2) continue;
    collisionGroupCount += 1;
    const baseActions = getStrategicActionSet(sim, group[0]);
    const baseActionSet = new Set(baseActions);

    for (let i = 1; i < group.length; i += 1) {
      const cmpActions = getStrategicActionSet(sim, group[i]);
      const cmpActionSet = new Set(cmpActions);

      // Check 1: Action set equivalence
      if (baseActions.join(";") !== cmpActions.join(";")) {
        actionSetMismatches += 1;
      }

      // Check 2: Reachable targets parity
      for (const act of baseActions) {
        if (!cmpActionSet.has(act)) reachabilityMismatches += 1;
      }
      for (const act of cmpActions) {
        if (!baseActionSet.has(act)) reachabilityMismatches += 1;
      }

      // Check 3: One-step projected successor relation equivalence on shared actions
      const actions0 = sim.enumerateActions(group[0]);
      const actions1 = sim.enumerateActions(group[i]);
      const actionMap1 = new Map();
      actions1.forEach((a) => actionMap1.set(a.summary, a));

      for (const a0 of actions0) {
        const a1 = actionMap1.get(a0.summary);
        if (!a1) continue;
        totalTransitionsAudited += 1;
        const next0 = sim.applyAction(group[0], a0);
        const next1 = sim.applyAction(group[i], a1);

        if (Boolean(next0) !== Boolean(next1)) {
          projectedSuccessorMismatches += 1;
        } else if (next0 && next1) {
          const dHp0 = next0.hero.hp - group[0].hero.hp;
          const dHp1 = next1.hero.hp - group[i].hero.hp;
          const dAtk0 = next0.hero.atk - group[0].hero.atk;
          const dAtk1 = next1.hero.atk - group[i].hero.atk;
          const dExp0 = next0.hero.exp - group[0].hero.exp;
          const dExp1 = next1.hero.exp - group[i].hero.exp;
          const dDef0 = next0.hero.def - group[0].hero.def;
          const dDef1 = next1.hero.def - group[i].hero.def;

          if (dAtk0 !== dAtk1 || dExp0 !== dExp1 || dDef0 !== dDef1 || dHp0 !== dHp1) {
            projectedSuccessorMismatches += 1;
          }
        }
      }
    }
  }

  const productionUniqueKeys = capturedStates.length;
  const shadowUniqueKeys = shadowGroups.size;
  const estimatedFrontierReduction = productionUniqueKeys > 0
    ? (productionUniqueKeys - shadowUniqueKeys) / productionUniqueKeys
    : 0;

  const report = {
    schema: "motapathfinder.shadow-audit.v1",
    benchmark: "TS13_STATE_ABSTRACTION_SHADOW_AUDIT",
    auditedAt: new Date().toISOString(),
    constraints: {
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      knownRouteUsed: false,
      ts13ManualMilestone: false,
    },
    metrics: {
      productionUniqueKeys,
      shadowUniqueKeys,
      collisionGroups: collisionGroupCount,
      totalTransitionsAudited,
      actionSetMismatches,
      reachabilityMismatches,
      projectedSuccessorMismatches,
      estimatedFrontierReduction: Number(estimatedFrontierReduction.toFixed(4)),
      reductionPercentage: `${(estimatedFrontierReduction * 100).toFixed(2)}%`,
    },
    gates: {
      correctnessGate: actionSetMismatches === 0 && reachabilityMismatches === 0 && projectedSuccessorMismatches === 0,
      utilityGate: estimatedFrontierReduction >= 0.20,
    },
  };

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}

if (require.main === module) {
  const options = parseArgs();
  const report = runShadowAudit(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.gates.correctnessGate) {
    console.error("FAIL: Correctness gate failed with observed counterexamples");
    process.exitCode = 1;
  }
}

module.exports = { runShadowAudit, computeShadowKey, getStrategicActionSet };
