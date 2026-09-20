"use strict";

/**
 * Phase 1 — TS13 State-Abstraction Shadow Audit (Repair 1a)
 *
 * Strictly observation-only: does NOT modify production DP keys, dominance rules,
 * goal predicates, or search behavior.
 *
 * Implements two cleanly decoupled audits:
 *
 * Part A: Candidate Shadow Abstraction Audit
 *   Evaluates whether state distinctions driven purely by past item/monster consumption
 *   history can be safely abstracted into a Strategic Future Action & Reachable Region Signature
 *   while holding non-HP resources, inventory, flags, followers, and location strictly constant.
 *   - Uses production DP admitted/expanded population via captureExpandedStates
 *   - Compares shadowUniqueKeys against productionUniqueDpKeys (using canonical buildDpStateKey)
 *   - Categorizes shadow over-abstraction counterexamples across local and cross-floor actions
 *   - Extracts all-floor mutation attribution witnesses
 *
 * Part B: Production DP Safety Probe (Independent same-exactDpKey evaluation)
 *   Uses candidateKeyShadowRecorder to capture states sharing the same production exactDpKey
 *   - Audits whether same-production-DP-key pairs ever exhibit future divergence
 *   - Distinguishes expected HP-dominance action supersets from unexpected same-HP divergences
 *   - Reports non-vacuous status: not-evaluable (when pairs=0), no-counterexample-observed, or counterexample-observed
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

function getCanonicalActionFingerprint(simulator, action) {
  if (!action) return "";
  const base = simulator.getActionFingerprint(action) || `${action.kind}|${action.summary || ""}`;
  const stance = action.stance ? `@${action.stance.x},${action.stance.y}` : (action.direction ? `@${action.direction}` : "");
  return `${base}${stance}`;
}

function getActionFingerprintSet(simulator, state) {
  const actions = simulator.enumerateActions(state);
  return Array.from(new Set(actions.map((a) => getCanonicalActionFingerprint(simulator, a)).filter(Boolean))).sort();
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

function findDifferingMutationsByFloor(s1, s2) {
  const allFloors = Array.from(new Set([
    ...Object.keys(s1.floorStates || {}),
    ...Object.keys(s2.floorStates || {}),
  ])).sort();

  const diff = {};
  for (const fid of allFloors) {
    const rem1 = new Set(Object.keys(((s1.floorStates || {})[fid] || {}).removed || {}));
    const rem2 = new Set(Object.keys(((s2.floorStates || {})[fid] || {}).removed || {}));
    const onlyIn1 = Array.from(rem1).filter((k) => !rem2.has(k)).sort();
    const onlyIn2 = Array.from(rem2).filter((k) => !rem1.has(k)).sort();
    if (onlyIn1.length > 0 || onlyIn2.length > 0) {
      diff[fid] = { onlyIn1, onlyIn2 };
    }
  }
  return diff;
}

function runShadowAudit(options = {}) {
  const towerRoot = resolveTowerRoot(options.towerRoot);
  const project = loadProject(towerRoot);
  const config = d.readJson(options.configFile);
  const sim = d.makeSimulator(project, config);
  const targetCorpusSize = Number(options.corpusSize || 300);

  const startState = resolveStartState(options);
  const sourceStateFingerprint = d.sha(buildStateKey(startState)).slice(0, 24);

  // Independent container for Part B (Production DP Safety Probe via candidateKeyShadowRecorder)
  const productionRecordedByDpKey = new Map();
  let candidateRecorderCount = 0;

  // Search controls aligned with durable production searchDP
  const result = searchDP(sim, startState, {
    goalPredicate: (candidate) => candidate.floorId === "TS14",
    // Production semantic controls
    maxActionsPerState: 4096,
    stopOnFirstGoal: false,
    captureTrace: false,
    goalSkylineLimit: config.candidateLimit || 16,
    dpSkylineMax: config.candidateLimit || 16,
    preserveSkylineRoles: true,
    actionFilter: (action) => !d.protectedCost(action, config),
    // Audit bounded sampling controls
    maxExpansions: targetCorpusSize * 2,
    maxRuntimeMs: 30000,
    maxRssMb: 4096,
    maxHeapMb: 2048,
    captureExpandedStates: true,
    captureExpandedStateLimit: targetCorpusSize,
    // Independent Production DP Safety Probe hook
    candidateKeyShadowRecorder: (entry) => {
      if (!entry || !entry.state || !entry.exactDpKey) return;
      candidateRecorderCount += 1;
      if (!productionRecordedByDpKey.has(entry.exactDpKey)) {
        productionRecordedByDpKey.set(entry.exactDpKey, []);
      }
      productionRecordedByDpKey.get(entry.exactDpKey).push({
        state: entry.state,
        productionDecision: entry.productionDecision,
      });
    },
  });

  // Part A: Candidate Shadow Abstraction Audit over Production Expanded Population
  const capturedStates = result.diagnostics && Array.isArray(result.diagnostics.capturedExpandedStates)
    ? result.diagnostics.capturedExpandedStates
    : [];

  const capturedStatesByFloor = {};
  for (const s of capturedStates) {
    capturedStatesByFloor[s.floorId] = (capturedStatesByFloor[s.floorId] || 0) + 1;
  }

  const productionDpKeys = new Set(capturedStates.map((s) => buildDpStateKey(sim, s, config)));
  const shadowGroups = new Map();

  for (const s of capturedStates) {
    const sk = computeShadowKey(sim, s);
    if (!shadowGroups.has(sk)) shadowGroups.set(sk, []);
    shadowGroups.get(sk).push(s);
  }

  let shadowCollisionGroupCount = 0;
  let shadowTotalTransitionsAudited = 0;
  let shadowLocalTransitionsAudited = 0;
  let shadowCrossFloorTransitionsAudited = 0;
  let shadowLocalSuccessorMismatches = 0;
  let shadowCrossFloorSuccessorMismatches = 0;

  const shadowWitnessPairs = [];

  for (const [, group] of shadowGroups.entries()) {
    if (group.length < 2) continue;
    shadowCollisionGroupCount += 1;

    for (let i = 1; i < group.length; i += 1) {
      const s1 = group[0];
      const s2 = group[i];

      const actions0 = sim.enumerateActions(s1);
      const actions1 = sim.enumerateActions(s2);
      const actionMap1 = new Map();
      actions1.forEach((a) => {
        const fp = getCanonicalActionFingerprint(sim, a);
        if (fp && !actionMap1.has(fp)) actionMap1.set(fp, a);
      });

      for (const a0 of actions0) {
        const fp0 = getCanonicalActionFingerprint(sim, a0);
        if (!fp0) continue;
        const a1 = actionMap1.get(fp0);
        if (!a1) continue;

        shadowTotalTransitionsAudited += 1;
        const isCrossFloor = a0.kind === "changeFloor" || a0.kind === "floorFly";
        if (isCrossFloor) shadowCrossFloorTransitionsAudited += 1;
        else shadowLocalTransitionsAudited += 1;

        const next0 = sim.applyAction(s1, a0);
        const next1 = sim.applyAction(s2, a1);

        if (Boolean(next0) !== Boolean(next1)) {
          if (isCrossFloor) shadowCrossFloorSuccessorMismatches += 1;
          else shadowLocalSuccessorMismatches += 1;

          if (shadowWitnessPairs.length < 5) {
            shadowWitnessPairs.push({
              actionFingerprint: fp0,
              isCrossFloor,
              sourceFloorId: s1.floorId,
              sourceLoc: s1.hero.loc,
              sourceHp1: s1.hero.hp,
              sourceHp2: s2.hero.hp,
              successorFloorId: next0 ? next0.floorId : (next1 ? next1.floorId : null),
              differingMutationsByFloor: findDifferingMutationsByFloor(s1, s2),
              reason: "feasibility_divergence",
            });
          }
        } else if (next0 && next1) {
          const nextShadow0 = computeShadowKey(sim, next0);
          const nextShadow1 = computeShadowKey(sim, next1);
          const dHp0 = next0.hero.hp - s1.hero.hp;
          const dHp1 = next1.hero.hp - s2.hero.hp;

          if (nextShadow0 !== nextShadow1 || dHp0 !== dHp1) {
            if (isCrossFloor) shadowCrossFloorSuccessorMismatches += 1;
            else shadowLocalSuccessorMismatches += 1;

            if (shadowWitnessPairs.length < 5) {
              shadowWitnessPairs.push({
                actionFingerprint: fp0,
                isCrossFloor,
                sourceFloorId: s1.floorId,
                sourceLoc: s1.hero.loc,
                sourceHp1: s1.hero.hp,
                sourceHp2: s2.hero.hp,
                successorFloorId: next0.floorId,
                dHpDelta: dHp0 - dHp1,
                differingMutationsByFloor: findDifferingMutationsByFloor(s1, s2),
                reason: nextShadow0 !== nextShadow1 ? "successor_shadow_divergence" : "hp_delta_divergence",
              });
            }
          }
        }
      }
    }
  }

  const productionUniqueDpKeys = productionDpKeys.size;
  const shadowUniqueKeys = shadowGroups.size;
  const productionRelativeReduction = productionUniqueDpKeys > 0
    ? (productionUniqueDpKeys - shadowUniqueKeys) / productionUniqueDpKeys
    : 0;

  const totalShadowSuccessorMismatches = shadowLocalSuccessorMismatches + shadowCrossFloorSuccessorMismatches;

  // Part B: Production DP Safety Probe (Independent same-production-DP-key verification)
  let sameProductionDpKeyPairsAudited = 0;
  let sameProductionDpKeySameHpPairs = 0;
  let sameProductionDpKeySameHpDivergences = 0;
  let sameProductionDpKeyActionMismatches = 0;
  let sameProductionDpKeySuccessorDivergences = 0;

  for (const [, entries] of productionRecordedByDpKey.entries()) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        sameProductionDpKeyPairsAudited += 1;
        const e1 = entries[i];
        const e2 = entries[j];
        const s1 = e1.state;
        const s2 = e2.state;

        const isSameHp = s1.hero.hp === s2.hero.hp;
        if (isSameHp) sameProductionDpKeySameHpPairs += 1;

        const acts1 = getActionFingerprintSet(sim, s1);
        const acts2 = getActionFingerprintSet(sim, s2);
        if (acts1.join(";") !== acts2.join(";")) {
          sameProductionDpKeyActionMismatches += 1;
        }

        const actions0 = sim.enumerateActions(s1);
        const actions1 = sim.enumerateActions(s2);
        const actionMap1 = new Map();
        actions1.forEach((a) => {
          const fp = getCanonicalActionFingerprint(sim, a);
          if (fp && !actionMap1.has(fp)) actionMap1.set(fp, a);
        });

        for (const a0 of actions0) {
          const fp0 = getCanonicalActionFingerprint(sim, a0);
          if (!fp0) continue;
          const a1 = actionMap1.get(fp0);
          if (!a1) continue;

          const next0 = sim.applyAction(s1, a0);
          const next1 = sim.applyAction(s2, a1);

          if (Boolean(next0) !== Boolean(next1)) {
            sameProductionDpKeySuccessorDivergences += 1;
            if (isSameHp) sameProductionDpKeySameHpDivergences += 1;
          } else if (next0 && next1) {
            const dpNext0 = buildDpStateKey(sim, next0, config);
            const dpNext1 = buildDpStateKey(sim, next1, config);
            const dHp0 = next0.hero.hp - s1.hero.hp;
            const dHp1 = next1.hero.hp - s2.hero.hp;

            if (dpNext0 !== dpNext1 || dHp0 !== dHp1) {
              sameProductionDpKeySuccessorDivergences += 1;
              if (isSameHp) sameProductionDpKeySameHpDivergences += 1;
            }
          }
        }
      }
    }
  }

  const productionDpSafetyProbeStatus = sameProductionDpKeyPairsAudited === 0
    ? "not-evaluable"
    : sameProductionDpKeySameHpDivergences === 0
      ? "no-counterexample-observed"
      : "counterexample-observed";

  const report = {
    schema: "motapathfinder.shadow-audit.v4",
    benchmark: "TS13_STATE_ABSTRACTION_SHADOW_AUDIT_REPAIR1A",
    auditedAt: new Date().toISOString(),
    provenance: {
      sourceStateFingerprint,
      towerDigest: treeDigest(path.join(towerRoot, "project")),
      solverDigest: treeDigest(path.resolve(__dirname, "lib")),
      configDigest: d.sha(JSON.stringify(config)),
      corpusSize: capturedStates.length,
      stateFile: options.stateFile || "default-ts13-entry",
    },
    controls: {
      productionSemanticControls: {
        maxActionsPerState: 4096,
        stopOnFirstGoal: false,
        captureTrace: false,
        goalSkylineLimit: config.candidateLimit || 16,
        dpSkylineMax: config.candidateLimit || 16,
        preserveSkylineRoles: true,
      },
      auditSamplingLimits: {
        maxExpansions: targetCorpusSize * 2,
        maxRuntimeMs: 30000,
        maxRssMb: 4096,
        maxHeapMb: 2048,
        captureExpandedStateLimit: targetCorpusSize,
      },
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
      productionDpSafetyProbeDecoupled: true,
    },
    partA_shadowAbstraction: {
      productionExpandedStates: capturedStates.length,
      capturedStatesByFloor,
      productionUniqueDpKeys,
      shadowUniqueKeys,
      collisionGroups: shadowCollisionGroupCount,
      transitionsAudited: {
        total: shadowTotalTransitionsAudited,
        local: shadowLocalTransitionsAudited,
        crossFloor: shadowCrossFloorTransitionsAudited,
      },
      counterexamples: {
        totalSuccessorMismatches: totalShadowSuccessorMismatches,
        localSuccessorMismatches: shadowLocalSuccessorMismatches,
        crossFloorSuccessorMismatches: shadowCrossFloorSuccessorMismatches,
      },
      productionRelativeKeyReductionRatio: Number(productionRelativeReduction.toFixed(4)),
      productionRelativeKeyReductionPercentage: `${(productionRelativeReduction * 100).toFixed(2)}%`,
      witnesses: shadowWitnessPairs,
      gateVerdict: {
        correctnessGateAllTransitions: totalShadowSuccessorMismatches === 0,
        utilityGateExceeds20Percent: productionRelativeReduction >= 0.20,
        status: totalShadowSuccessorMismatches === 0 ? "PASSED" : "REJECTED_WITH_COUNTEREXAMPLES",
      },
    },
    partB_productionDpSafetyProbe: {
      candidateRecorderInvocations: candidateRecorderCount,
      uniqueProductionDpKeysRecorded: productionRecordedByDpKey.size,
      sameProductionDpKeyPairsAudited,
      sameProductionDpKeySameHpPairs,
      sameProductionDpKeyActionMismatches,
      sameProductionDpKeySuccessorDivergences,
      sameHpSuccessorDivergences: sameProductionDpKeySameHpDivergences,
      probeVerdict: productionDpSafetyProbeStatus,
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
  if (!report.partA_shadowAbstraction.gateVerdict.correctnessGateAllTransitions) {
    console.error("FAIL: Candidate shadow abstraction correctness gate failed with observed counterexamples");
    process.exitCode = 1;
  }
}

module.exports = { runShadowAudit, computeShadowKey, getActionFingerprintSet, getReachableRegionParity, resolveStartState };
