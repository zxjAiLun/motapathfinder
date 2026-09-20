"use strict";

/**
 * Phase 1 — TS13 State-Abstraction Shadow Audit (Repair 1)
 *
 * Strictly observation-only: does NOT modify production DP keys, dominance rules,
 * goal predicates, or search behavior.
 *
 * Evaluates whether state distinctions driven purely by past item/monster consumption
 * history can be safely abstracted into a Strategic Future Action & Reachable Region Signature
 * while holding non-HP resources, inventory, flags, followers, and location strictly constant.
 *
 * Audits:
 * 1. Production-relative corpus captured directly from DP expanded states (captureExpandedStates)
 * 2. Production DP keys built with canonical buildDpStateKey (denominator does NOT include HP)
 * 3. Candidate-key constituent parity (action fingerprints & independent reachable-region signatures)
 * 4. Successor relation attribution: splits counterexamples into Case A (different production DP keys;
 *    proposed abstraction too coarse) vs Case B (same production DP keys; production DP divergence).
 * 5. Extraction of representative witness pairs with differing mutations and divergent futures.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadProject } = require("./lib/project-loader");
const d = require("./lib/durable-search");
const { searchDP, buildDpStateKey } = require("./lib/dp-search");
const { buildStateKey } = require("./lib/state-key");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    corpusSize: 300,
    towerRoot: null,
    stateFile: null,
    configFile: path.resolve(__dirname, "profiles/neko-zero-key.json"),
    output: path.resolve(__dirname, "routes/generated/shadow-audits/ts13-state-abstraction-audit.json"),
  };
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, val] = match;
    if (key === "corpus-size") options.corpusSize = Number(val);
    else if (key === "tower-root") options.towerRoot = path.resolve(val);
    else if (key === "state-file") options.stateFile = path.resolve(val);
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

function treeDigest(root) {
  const hash = crypto.createHash("sha256");
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith(".js")) {
        hash.update(path.relative(root, file).replace(/\\/g, "/"));
        hash.update(fs.readFileSync(file));
      }
    }
  }
  visit(root);
  return hash.digest("hex");
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value != null && value !== 0) result[key] = value;
      return result;
    }, {});
}

function stableArray(array) {
  return Array.isArray(array) ? array.slice().sort() : [];
}

function getActionFingerprintSet(simulator, state) {
  const actions = simulator.enumerateActions(state);
  return Array.from(new Set(actions.map((a) => simulator.getActionFingerprint(a)).filter(Boolean))).sort();
}

function getReachableRegionParity(simulator, state) {
  const region = simulator.buildReachableRegionSignature(state);
  return {
    regionKey: region.regionKey || "",
    reachableEndpointsKey: region.reachableEndpointsKey || "",
  };
}

function computeShadowKey(simulator, state) {
  const loc = `${state.hero.loc.x},${state.hero.loc.y}`;
  const heroResources = {
    atk: Number(state.hero.atk || 0),
    def: Number(state.hero.def || 0),
    mdef: Number(state.hero.mdef || 0),
    lv: Number(state.hero.lv || 1),
    exp: Number(state.hero.exp || 0),
    money: Number(state.hero.money || 0),
    mana: Number(state.hero.mana || 0),
    equipment: stableArray(state.hero.equipment),
    followers: stableArray(state.hero.followers),
  };
  const inventory = stableObject(state.inventory);
  const flags = stableObject(state.flags);
  const visitedFloors = stableArray(Object.keys(state.visitedFloors || {}));
  const actionFingerprintSet = getActionFingerprintSet(simulator, state);
  const reachableRegion = getReachableRegionParity(simulator, state);

  return JSON.stringify({
    floorId: state.floorId,
    loc,
    hero: heroResources,
    inventory,
    flags,
    visitedFloors,
    actionFingerprintSet,
    reachableRegion,
  });
}

function resolveStartState(options) {
  if (options.stateFile) {
    if (!fs.existsSync(options.stateFile)) {
      throw new Error(`--state-file not found: ${options.stateFile}`);
    }
    let s;
    try {
      s = JSON.parse(fs.readFileSync(options.stateFile, "utf8"));
    } catch (err) {
      throw new Error(`--state-file invalid JSON: ${options.stateFile} (${err.message})`);
    }
    if (!s || s.floorId !== "TS13") {
      throw new Error(`--state-file must be a TS13 state (got floorId=${s && s.floorId})`);
    }
    if (!s.hero || !(Number(s.hero.hp) > 0)) {
      throw new Error(`--state-file must have positive hero HP (got hp=${s && s.hero && s.hero.hp})`);
    }
    return s;
  }

  // Fallback only when --state-file was NOT explicitly provided by operator
  return {
    floorId: "TS13",
    hero: { hp: 1353, atk: 6, def: 0, mdef: 0, lv: 2, exp: 18, loc: { x: 1, y: 1, direction: "left" } },
    inventory: { greenKey: 34 },
    flags: { shiqu: 1, autoBattle: 1 },
    visitedFloors: { TS13: true },
    floorStates: { TS13: { removed: {}, replaced: {} } },
  };
}

function findDifferingMutations(s1, s2) {
  const rem1 = new Set(Object.keys(((s1.floorStates || {}).TS13 || {}).removed || {}));
  const rem2 = new Set(Object.keys(((s2.floorStates || {}).TS13 || {}).removed || {}));
  const onlyIn1 = Array.from(rem1).filter((k) => !rem2.has(k)).sort();
  const onlyIn2 = Array.from(rem2).filter((k) => !rem1.has(k)).sort();
  return { onlyIn1, onlyIn2 };
}

function runShadowAudit(options = {}) {
  const towerRoot = resolveTowerRoot(options.towerRoot);
  const project = loadProject(towerRoot);
  const config = d.readJson(options.configFile);
  const sim = d.makeSimulator(project, config);
  const targetCorpusSize = Number(options.corpusSize || 300);

  const startState = resolveStartState(options);
  const sourceStateFingerprint = d.sha(buildStateKey(startState)).slice(0, 24);

  // Capture actual production DP admitted and expanded states
  const result = searchDP(sim, startState, {
    goalPredicate: (candidate) => candidate.floorId === "TS14",
    maxExpansions: targetCorpusSize * 2,
    maxRuntimeMs: 30000,
    maxRssMb: 4096,
    maxHeapMb: 2048,
    captureExpandedStates: true,
    captureExpandedStateLimit: targetCorpusSize,
    actionFilter: (action) => !d.protectedCost(action, config),
  });

  const capturedStates = result.diagnostics && Array.isArray(result.diagnostics.capturedExpandedStates)
    ? result.diagnostics.capturedExpandedStates
    : [];

  const productionDpKeys = new Set(capturedStates.map((s) => buildDpStateKey(sim, s, config)));
  const shadowGroups = new Map();

  for (const s of capturedStates) {
    const sk = computeShadowKey(sim, s);
    if (!shadowGroups.has(sk)) shadowGroups.set(sk, []);
    shadowGroups.get(sk).push(s);
  }

  let collisionGroupCount = 0;
  let sameProductionDpKeyCollisionPairs = 0;
  let diffProductionDpKeyCollisionPairs = 0;
  let totalTransitionsAudited = 0;
  let localTransitionsAudited = 0;
  let crossFloorTransitionsAudited = 0;

  // Counterexample attribution breakdown
  let localSuccessorMismatchesCaseA = 0;
  let localSuccessorMismatchesCaseB = 0;
  let crossFloorSuccessorMismatchesCaseA = 0;
  let crossFloorSuccessorMismatchesCaseB = 0;

  const witnessPairs = [];

  for (const [, group] of shadowGroups.entries()) {
    if (group.length < 2) continue;
    collisionGroupCount += 1;

    for (let i = 1; i < group.length; i += 1) {
      const s1 = group[0];
      const s2 = group[i];
      const dpKey1 = buildDpStateKey(sim, s1, config);
      const dpKey2 = buildDpStateKey(sim, s2, config);
      const sameDpKey = dpKey1 === dpKey2;

      if (sameDpKey) sameProductionDpKeyCollisionPairs += 1;
      else diffProductionDpKeyCollisionPairs += 1;

      const actions0 = sim.enumerateActions(s1);
      const actions1 = sim.enumerateActions(s2);
      const actionMap1 = new Map();
      actions1.forEach((a) => {
        const fp = sim.getActionFingerprint(a);
        if (fp && !actionMap1.has(fp)) actionMap1.set(fp, a);
      });

      for (const a0 of actions0) {
        const fp0 = sim.getActionFingerprint(a0);
        if (!fp0) continue;
        const a1 = actionMap1.get(fp0);
        if (!a1) continue;

        totalTransitionsAudited += 1;
        const isCrossFloor = a0.kind === "changeFloor" || a0.kind === "floorFly";
        if (isCrossFloor) crossFloorTransitionsAudited += 1;
        else localTransitionsAudited += 1;

        const next0 = sim.applyAction(s1, a0);
        const next1 = sim.applyAction(s2, a1);

        if (Boolean(next0) !== Boolean(next1)) {
          if (sameDpKey) {
            if (isCrossFloor) crossFloorSuccessorMismatchesCaseB += 1;
            else localSuccessorMismatchesCaseB += 1;
          } else {
            if (isCrossFloor) crossFloorSuccessorMismatchesCaseA += 1;
            else localSuccessorMismatchesCaseA += 1;
          }
          if (witnessPairs.length < 5) {
            witnessPairs.push({
              actionFingerprint: fp0,
              isCrossFloor,
              classification: sameDpKey ? "CASE_B_PRODUCTION_DP_DIVERGENCE" : "CASE_A_SHADOW_OVER_ABSTRACTION",
              sourceLoc: s1.hero.loc,
              sourceHp1: s1.hero.hp,
              sourceHp2: s2.hero.hp,
              differingMutations: findDifferingMutations(s1, s2),
              reason: "feasibility_divergence",
            });
          }
        } else if (next0 && next1) {
          const nextShadow0 = computeShadowKey(sim, next0);
          const nextShadow1 = computeShadowKey(sim, next1);
          const dHp0 = next0.hero.hp - s1.hero.hp;
          const dHp1 = next1.hero.hp - s2.hero.hp;

          if (nextShadow0 !== nextShadow1 || dHp0 !== dHp1) {
            if (sameDpKey) {
              if (isCrossFloor) crossFloorSuccessorMismatchesCaseB += 1;
              else localSuccessorMismatchesCaseB += 1;
            } else {
              if (isCrossFloor) crossFloorSuccessorMismatchesCaseA += 1;
              else localSuccessorMismatchesCaseA += 1;
            }
            if (witnessPairs.length < 5) {
              witnessPairs.push({
                actionFingerprint: fp0,
                isCrossFloor,
                classification: sameDpKey ? "CASE_B_PRODUCTION_DP_DIVERGENCE" : "CASE_A_SHADOW_OVER_ABSTRACTION",
                sourceLoc: s1.hero.loc,
                sourceHp1: s1.hero.hp,
                sourceHp2: s2.hero.hp,
                dHpDelta: dHp0 - dHp1,
                differingMutations: findDifferingMutations(s1, s2),
                reason: nextShadow0 !== nextShadow1 ? "successor_shadow_divergence" : "hp_delta_divergence",
              });
            }
          }
        }
      }
    }
  }

  const productionUniqueKeys = productionDpKeys.size;
  const shadowUniqueKeys = shadowGroups.size;
  const productionRelativeReduction = productionUniqueKeys > 0
    ? (productionUniqueKeys - shadowUniqueKeys) / productionUniqueKeys
    : 0;

  const totalSuccessorMismatches =
    localSuccessorMismatchesCaseA +
    localSuccessorMismatchesCaseB +
    crossFloorSuccessorMismatchesCaseA +
    crossFloorSuccessorMismatchesCaseB;

  const report = {
    schema: "motapathfinder.shadow-audit.v3",
    benchmark: "TS13_STATE_ABSTRACTION_SHADOW_AUDIT_REPAIR1",
    auditedAt: new Date().toISOString(),
    provenance: {
      sourceStateFingerprint,
      towerDigest: treeDigest(path.join(towerRoot, "project")),
      solverDigest: treeDigest(path.resolve(__dirname, "lib")),
      configDigest: d.sha(JSON.stringify(config)),
      corpusSize: capturedStates.length,
      stateFile: options.stateFile || "default-ts13-entry",
    },
    contracts: {
      productionRelativeCorpus: true,
      denominatorIsProductionDpKeys: true,
      inventoryRetained: true,
      flagsRetained: true,
      visitedFloorsRetained: true,
      heroNonHpResourcesRetained: true,
      followersRetained: true,
      candidateKeyConstituentParityByConstruction: true,
      independentReachableRegionAudited: true,
      fullShadowSuccessorProjected: true,
    },
    metrics: {
      productionExpandedStates: capturedStates.length,
      productionUniqueDpKeys: productionUniqueKeys,
      shadowUniqueKeys,
      collisionGroups: collisionGroupCount,
      sameProductionDpKeyCollisionPairs,
      diffProductionDpKeyCollisionPairs,
      totalTransitionsAudited,
      localTransitionsAudited,
      crossFloorTransitionsAudited,
      counterexamples: {
        totalSuccessorMismatches,
        caseA_ShadowOverAbstraction: localSuccessorMismatchesCaseA + crossFloorSuccessorMismatchesCaseA,
        caseB_ProductionDpDivergence: localSuccessorMismatchesCaseB + crossFloorSuccessorMismatchesCaseB,
        local: {
          caseA: localSuccessorMismatchesCaseA,
          caseB: localSuccessorMismatchesCaseB,
        },
        crossFloor: {
          caseA: crossFloorSuccessorMismatchesCaseA,
          caseB: crossFloorSuccessorMismatchesCaseB,
        },
      },
      productionRelativeKeyReductionRatio: Number(productionRelativeReduction.toFixed(4)),
      productionRelativeKeyReductionPercentage: `${(productionRelativeReduction * 100).toFixed(2)}%`,
    },
    witnesses: witnessPairs,
    gates: {
      zeroProductionDpDivergenceCaseB: (localSuccessorMismatchesCaseB + crossFloorSuccessorMismatchesCaseB) === 0,
      zeroTotalSuccessorMismatches: totalSuccessorMismatches === 0,
      utilityGate: productionRelativeReduction >= 0.20,
      correctnessGateAllTransitions: totalSuccessorMismatches === 0,
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
  if (!report.gates.correctnessGateAllTransitions) {
    console.error("FAIL: Correctness gate failed with observed counterexamples (as expected for shadow audit)");
    process.exitCode = 1;
  }
}

module.exports = { runShadowAudit, computeShadowKey, getActionFingerprintSet, getReachableRegionParity, resolveStartState };
