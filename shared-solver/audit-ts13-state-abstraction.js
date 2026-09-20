"use strict";

/**
 * Phase 1 — TS13 State-Abstraction Shadow Audit (Corrected)
 *
 * Strictly observation-only: does NOT modify production DP keys, dominance rules,
 * goal predicates, or search behavior.
 *
 * Evaluates whether state distinctions driven purely by past item/monster consumption
 * history can be safely abstracted into a Strategic Future Action & Reachable Region Signature
 * while holding non-HP resources, inventory, flags, and location strictly constant.
 *
 * Audits:
 * 1. Action fingerprint set equivalence (via simulator.getActionFingerprint)
 * 2. Reachable region parity (via simulator.buildReachableRegionSignature)
 * 3. Full projected successor relation equivalence (shadowProjection(S1') === shadowProjection(S2'))
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadProject } = require("./lib/project-loader");
const d = require("./lib/durable-search");
const { searchDP } = require("./lib/dp-search");
const { buildStateKey } = require("./lib/state-key");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    corpusSize: 500,
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
  if (options.stateFile && fs.existsSync(options.stateFile)) {
    const s = d.readJson(options.stateFile);
    if (s && s.floorId === "TS13" && s.hero && s.hero.hp > 0) return s;
  }
  // Try local smoke runs if available
  const localCandidates = [
    path.resolve(__dirname, "routes/generated/cloud-search/local-smoke2/states/2-8742ede5af5bf89efaaf92bb.json"),
    path.resolve(__dirname, "routes/generated/cloud-search/local-smoke2/initial.json"),
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      const s = d.readJson(candidate);
      if (s && s.floorId === "TS13") return s;
    }
  }
  // Baseline TS13 entry state
  return {
    floorId: "TS13",
    hero: { hp: 1353, atk: 6, def: 0, mdef: 0, lv: 2, exp: 18, loc: { x: 1, y: 1, direction: "left" } },
    inventory: { greenKey: 34 },
    flags: { shiqu: 1, autoBattle: 1 },
    visitedFloors: { TS13: true },
    floorStates: { TS13: { removed: {}, replaced: {} } },
  };
}

function runShadowAudit(options = {}) {
  const towerRoot = resolveTowerRoot(options.towerRoot);
  const project = loadProject(towerRoot);
  const config = d.readJson(options.configFile);
  const sim = d.makeSimulator(project, config);
  const targetCorpusSize = Number(options.corpusSize || 500);

  const startState = resolveStartState(options);
  const sourceStateFingerprint = d.sha(buildStateKey(startState)).slice(0, 24);

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
    maxExpansions: targetCorpusSize * 3,
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
  let actionFingerprintMismatches = 0;
  let reachabilityMismatches = 0;
  let projectedSuccessorRelationMismatches = 0;
  let localSuccessorMismatches = 0;
  let crossFloorSuccessorMismatches = 0;
  let totalTransitionsAudited = 0;
  let localTransitionsAudited = 0;
  let crossFloorTransitionsAudited = 0;

  for (const [, group] of shadowGroups.entries()) {
    if (group.length < 2) continue;
    collisionGroupCount += 1;
    const baseActions = getActionFingerprintSet(sim, group[0]);
    const baseRegion = getReachableRegionParity(sim, group[0]);

    for (let i = 1; i < group.length; i += 1) {
      const cmpActions = getActionFingerprintSet(sim, group[i]);
      const cmpRegion = getReachableRegionParity(sim, group[i]);

      // Check 1: Action fingerprint set equivalence
      if (baseActions.join(";") !== cmpActions.join(";")) {
        actionFingerprintMismatches += 1;
      }

      // Check 2: Independent reachable region parity (regionKey & endpoints)
      if (baseRegion.regionKey !== cmpRegion.regionKey ||
          baseRegion.reachableEndpointsKey !== cmpRegion.reachableEndpointsKey) {
        reachabilityMismatches += 1;
      }

      // Check 3: Full projected successor relation equivalence (shadowKey(S1') === shadowKey(S2'))
      const actions0 = sim.enumerateActions(group[0]);
      const actions1 = sim.enumerateActions(group[i]);
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

        const next0 = sim.applyAction(group[0], a0);
        const next1 = sim.applyAction(group[i], a1);

        if (Boolean(next0) !== Boolean(next1)) {
          projectedSuccessorRelationMismatches += 1;
          if (isCrossFloor) crossFloorSuccessorMismatches += 1;
          else localSuccessorMismatches += 1;
        } else if (next0 && next1) {
          const nextShadow0 = computeShadowKey(sim, next0);
          const nextShadow1 = computeShadowKey(sim, next1);
          const dHp0 = next0.hero.hp - group[0].hero.hp;
          const dHp1 = next1.hero.hp - group[i].hero.hp;

          if (nextShadow0 !== nextShadow1 || dHp0 !== dHp1) {
            projectedSuccessorRelationMismatches += 1;
            if (isCrossFloor) crossFloorSuccessorMismatches += 1;
            else localSuccessorMismatches += 1;
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
    schema: "motapathfinder.shadow-audit.v2",
    benchmark: "TS13_STATE_ABSTRACTION_SHADOW_AUDIT_CORRECTED",
    auditedAt: new Date().toISOString(),
    provenance: {
      sourceStateFingerprint,
      towerDigest: treeDigest(path.join(towerRoot, "project")),
      solverDigest: treeDigest(path.resolve(__dirname, "lib")),
      configDigest: d.sha(JSON.stringify(config)),
      corpusSize: productionUniqueKeys,
      stateFile: options.stateFile || "default-ts13-entry",
    },
    constraints: {
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      knownRouteUsed: false,
      ts13ManualMilestone: false,
      inventoryRetained: true,
      flagsRetained: true,
      visitedFloorsRetained: true,
      heroNonHpResourcesRetained: true,
      canonicalActionFingerprintsUsed: true,
      independentReachableRegionAudited: true,
      fullShadowSuccessorProjected: true,
    },
    metrics: {
      productionUniqueKeys,
      shadowUniqueKeys,
      collisionGroups: collisionGroupCount,
      totalTransitionsAudited,
      localTransitionsAudited,
      crossFloorTransitionsAudited,
      actionFingerprintMismatches,
      reachabilityMismatches,
      projectedSuccessorRelationMismatches,
      localSuccessorMismatches,
      crossFloorSuccessorMismatches,
      sampleKeyReductionRatio: Number(estimatedFrontierReduction.toFixed(4)),
      sampleKeyReductionPercentage: `${(estimatedFrontierReduction * 100).toFixed(2)}%`,
    },
    gates: {
      actionFingerprintsMatch: actionFingerprintMismatches === 0,
      reachabilityParityMatch: reachabilityMismatches === 0,
      localSuccessorParityMatch: localSuccessorMismatches === 0,
      crossFloorSuccessorParityMatch: crossFloorSuccessorMismatches === 0,
      correctnessGateAllTransitions: actionFingerprintMismatches === 0 &&
        reachabilityMismatches === 0 &&
        projectedSuccessorRelationMismatches === 0,
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

module.exports = { runShadowAudit, computeShadowKey, getActionFingerprintSet, getReachableRegionParity };
