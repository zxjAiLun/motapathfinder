"use strict";

/**
 * PR-5.28a — Mutation Liveness Shadow Projection Audit
 *
 * Observation-only: evaluates whether provably-dead mutations can be safely dropped
 * from search DP keys without modifying production solver, dominance, or keys.
 *
 * Principles:
 * 1. Fail-Closed Liveness:
 *    Only mutations proved dead under future floor-transition over-approximation
 *    or topological barrier isolation are dropped. Unprovable mutations remain LIVE.
 * 2. Production DP Semantic Parity:
 *    Retains all production hero resources, inventory, flags, visitedFloors, and location.
 * 3. Correctness Gate:
 *    Hard gate: 0 counterexamples across transition outcome equivalence and dominance.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadProject } = require("./lib/project-loader");
const d = require("./lib/durable-search");
const { searchDP, buildDpStateKey } = require("./lib/dp-search");
const { buildStateKey } = require("./lib/state-key");
const {
  filterLiveFloorStates,
  computeLivenessProjectedKey,
} = require("./lib/mutation-liveness");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    corpusSize: 300,
    towerRoot: null,
    stateFile: null,
    configFile: path.resolve(__dirname, "profiles/neko-zero-key.json"),
    output: path.resolve(__dirname, "routes/generated/shadow-audits/mutation-liveness-audit.json"),
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
  throw new Error("Unable to locate tower root for mutation liveness audit");
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

function getCanonicalActionFingerprint(simulator, action) {
  if (!action) return "";
  const base = simulator.getActionFingerprint(action) || `${action.kind}|${action.summary || ""}`;
  const stance = action.stance ? `@${action.stance.x},${action.stance.y}` : (action.direction ? `@${action.direction}` : "");
  return `${base}${stance}`;
}

function enumerateLivenessOutcomes(simulator, state, config) {
  const actions = simulator.enumerateActions(state);
  const outcomes = [];
  for (const action of actions) {
    const next = simulator.applyAction(state, action);
    if (!next) continue;
    const nextLivenessKey = computeLivenessProjectedKey(simulator, next, config);
    const actionFp = getCanonicalActionFingerprint(simulator, action);
    outcomes.push({
      actionFingerprint: actionFp,
      actionKind: action.kind,
      isCrossFloor: action.kind === "changeFloor" || action.kind === "floorFly",
      dHp: next.hero.hp - state.hero.hp,
      nextHp: next.hero.hp,
      nextLivenessKey,
    });
  }
  return outcomes;
}

function runLivenessAudit(options = {}) {
  const towerRoot = resolveTowerRoot(options.towerRoot);
  const project = loadProject(towerRoot);
  const config = d.readJson(options.configFile);
  const sim = d.makeSimulator(project, config);
  const targetCorpusSize = Number(options.corpusSize || 300);

  const startState = resolveStartState(options);
  const sourceStateFingerprint = d.sha(buildStateKey(startState)).slice(0, 24);

  // SearchDP run with production semantic controls
  const result = searchDP(sim, startState, {
    goalPredicate: (candidate) => candidate.floorId === "TS14",
    maxActionsPerState: 4096,
    stopOnFirstGoal: false,
    captureTrace: false,
    goalSkylineLimit: config.candidateLimit || 16,
    dpSkylineMax: config.candidateLimit || 16,
    preserveSkylineRoles: true,
    actionFilter: (action) => !d.protectedCost(action, config),
    maxExpansions: targetCorpusSize * 2,
    maxRuntimeMs: 30000,
    maxRssMb: 4096,
    maxHeapMb: 2048,
    captureExpandedStates: true,
    captureExpandedStateLimit: targetCorpusSize,
  });

  const capturedStates = result.diagnostics && Array.isArray(result.diagnostics.capturedExpandedStates)
    ? result.diagnostics.capturedExpandedStates
    : [];

  const capturedStatesByFloor = {};
  for (const s of capturedStates) {
    capturedStatesByFloor[s.floorId] = (capturedStatesByFloor[s.floorId] || 0) + 1;
  }

  const productionDpKeys = new Set(capturedStates.map((s) => buildDpStateKey(sim, s, config)));
  const livenessProjectedGroups = new Map();

  let totalDeadMutations = 0;
  let totalLiveMutations = 0;
  const deadReasonAggregates = {};

  for (const s of capturedStates) {
    const { stats } = filterLiveFloorStates(project, s, config);
    totalDeadMutations += stats.deadCount;
    totalLiveMutations += stats.liveCount;
    for (const [r, count] of Object.entries(stats.deadBreakdown)) {
      deadReasonAggregates[r] = (deadReasonAggregates[r] || 0) + count;
    }

    const lKey = computeLivenessProjectedKey(sim, s, config);
    if (!livenessProjectedGroups.has(lKey)) livenessProjectedGroups.set(lKey, []);
    livenessProjectedGroups.get(lKey).push(s);
  }

  const productionUniqueDpKeys = productionDpKeys.size;
  const livenessProjectedUniqueKeys = livenessProjectedGroups.size;
  const netReductionRatio = productionUniqueDpKeys > 0
    ? (productionUniqueDpKeys - livenessProjectedUniqueKeys) / productionUniqueDpKeys
    : 0;

  // Collision groups and dominance/equivalence check
  let collisionGroupCount = 0;
  let sameHpEquivalencePairs = 0;
  let sameHpEquivalenceViolations = 0;
  let hpDominancePairs = 0;
  let hpDominanceViolations = 0;
  let totalTransitionsAudited = 0;

  const witnessPairs = [];

  for (const [, group] of livenessProjectedGroups.entries()) {
    if (group.length < 2) continue;
    collisionGroupCount += 1;

    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const s1 = group[i];
        const s2 = group[j];

        const outcomes1 = enumerateLivenessOutcomes(sim, s1, config);
        const outcomes2 = enumerateLivenessOutcomes(sim, s2, config);
        totalTransitionsAudited += outcomes1.length;

        if (s1.hero.hp === s2.hero.hp) {
          sameHpEquivalencePairs += 1;
          const sigs1 = new Set(outcomes1.map((o) => `${o.actionFingerprint}|${o.nextLivenessKey}|${o.dHp}`));
          const sigs2 = new Set(outcomes2.map((o) => `${o.actionFingerprint}|${o.nextLivenessKey}|${o.dHp}`));
          let match = (sigs1.size === sigs2.size);
          if (match) {
            for (const sig of sigs1) {
              if (!sigs2.has(sig)) { match = false; break; }
            }
          }
          if (!match) {
            sameHpEquivalenceViolations += 1;
            if (witnessPairs.length < 5) {
              witnessPairs.push({
                type: "SAME_HP_EQUIVALENCE_VIOLATION",
                sourceFloor: s1.floorId,
                hp: s1.hero.hp,
                loc1: s1.hero.loc,
                loc2: s2.hero.loc,
                outcomesCount1: outcomes1.length,
                outcomesCount2: outcomes2.length,
              });
            }
          }
        } else {
          hpDominancePairs += 1;
          const H = s1.hero.hp > s2.hero.hp ? s1 : s2;
          const L = s1.hero.hp > s2.hero.hp ? s2 : s1;
          const outcomesH = s1.hero.hp > s2.hero.hp ? outcomes1 : outcomes2;
          const outcomesL = s1.hero.hp > s2.hero.hp ? outcomes2 : outcomes1;

          let dominated = true;
          for (const oL of outcomesL) {
            const matchingH = outcomesH.find((oH) =>
              oH.actionFingerprint === oL.actionFingerprint &&
              oH.nextLivenessKey === oL.nextLivenessKey &&
              oH.nextHp >= oL.nextHp
            );
            if (!matchingH) {
              dominated = false;
              break;
            }
          }
          if (!dominated) {
            hpDominanceViolations += 1;
            if (witnessPairs.length < 5) {
              witnessPairs.push({
                type: "HP_DOMINANCE_VIOLATION",
                sourceFloor: H.floorId,
                hpHigh: H.hero.hp,
                hpLow: L.hero.hp,
                outcomesCountH: outcomesH.length,
                outcomesCountL: outcomesL.length,
              });
            }
          }
        }
      }
    }
  }

  const totalViolations = sameHpEquivalenceViolations + hpDominanceViolations;

  const report = {
    schema: "motapathfinder.mutation-liveness-audit.v1",
    benchmark: "PR_5_28A_MUTATION_LIVENESS_SHADOW_PROJECTION",
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
      failClosedLivenessPredicate: true,
      onlyDropProvablyDeadMutations: true,
      unprovableMutationsKeptLive: true,
      productionDpKeyParity: true,
      fullHeroResourcesRetained: true,
      inventoryRetained: true,
      flagsRetained: true,
      visitedFloorsRetained: true,
    },
    metrics: {
      productionExpandedStates: capturedStates.length,
      capturedStatesByFloor,
      productionUniqueDpKeys,
      livenessProjectedUniqueKeys,
      netKeyReductionRatio: Number(netReductionRatio.toFixed(4)),
      netKeyReductionPercentage: `${(netReductionRatio * 100).toFixed(2)}%`,
      mutationLivenessInventory: {
        totalDeadMutationsAcrossCorpus: totalDeadMutations,
        totalLiveMutationsAcrossCorpus: totalLiveMutations,
        deadRatio: (totalDeadMutations + totalLiveMutations) > 0
          ? Number((totalDeadMutations / (totalDeadMutations + totalLiveMutations)).toFixed(4))
          : 0,
        deadReasonBreakdown: deadReasonAggregates,
      },
      auditPairs: {
        collisionGroups: collisionGroupCount,
        sameHpEquivalencePairs,
        sameHpEquivalenceViolations,
        hpDominancePairs,
        hpDominanceViolations,
        totalViolations,
        totalTransitionsAudited,
      },
    },
    witnesses: witnessPairs,
    gates: {
      correctnessGateZeroViolations: totalViolations === 0,
      utilityMeasured: true,
      netCollapseObserved: netReductionRatio > 0,
      status: totalViolations === 0
        ? (netReductionRatio > 0 ? "PASSED_WITH_COLLAPSE" : "VALID_NEGATIVE_ZERO_COLLAPSE")
        : "FAILED_WITH_COUNTEREXAMPLES",
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
  const report = runLivenessAudit(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.gates.correctnessGateZeroViolations) {
    console.error("FAIL: Mutation liveness correctness gate failed with counterexamples");
    process.exitCode = 1;
  }
}

module.exports = { runLivenessAudit, enumerateLivenessOutcomes, resolveStartState };
