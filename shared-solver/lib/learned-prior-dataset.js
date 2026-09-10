"use strict";

// PR-5.25c Phase 1 dataset builder: strict, fail-closed replay of an explicit
// two-route fixture allowlist into (state, legal primitive actions, chosen
// index) training examples for the learned action prior.
//
// Repository policy (see docs/260908/5-25c.md) freezes the Phase 1 corpus to
// exactly two files.  Everything else in the repository - including every
// MT4/MT5 route reachable from the same chaos MT1 start and every
// MT5/blueKing witness and its derived prefixes - is excluded from training.
// The builder never guesses inclusion from file names or from `goal.floorId`;
// inclusion is decided only by exact allowlist membership.
//
// Route records predate several runtime serialization changes, so the stored
// `preStateKey` / `postStateKey` / `start.stateKey` / `final.stateKey` fields
// do not equal the current `buildStateKey(state)`.  The differences are
// deterministic and fully specified by `legacyRouteStateKey()` below:
//
//   1. The historic dominance key ignored hero HP (hero.hp === null) while
//      keeping hpmax/manamax.
//   2. The historic key predates the transient `flags.__leaveLoc__` runtime
//      field, so it is dropped for key comparison only (the live state used
//      for transitions keeps it).
//   3. The historic serializer emitted an (empty) mutation entry for every
//      floor present in the route snapshot's `floors` map, while the current
//      serializer filters empty floors.
//
// `legacyRouteStateKey()` reproduces the stored keys byte-for-byte.  Replay
// asserts that equality for every decision pre-state and post-state and for
// the final state; any mismatch aborts the dataset build (fail closed).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { loadProject } = require("./project-loader");
const { StaticSimulator } = require("./simulator");
const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { buildStateKey } = require("./state-key");
const { normalizeAction } = require("./route-store");

const SOLVER_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SOLVER_ROOT, "..");
const PROJECT_ROOT = path.resolve(REPO_ROOT, "Only upV2.1", "Only upV2.1");

const ROUTE_SCHEMA = "motapathfinder.route.v1";

// Frozen Phase 1 training allowlist: exactly these two route files, by
// repository-relative path.  No globbing, no prefix matching, no name heuristics.
const TRAIN_ALLOWLIST = Object.freeze([
  "shared-solver/routes/fixtures/mt1-mt2-hp3834.route.json",
  "shared-solver/routes/fixtures/mt1-mt3-i893-hp8425.route.json",
]);

const EXCLUSION = Object.freeze({
  NOT_IN_ALLOWLIST: "not-in-exact-allowlist",
  MT4_REACH: "excluded: valid route from the same chaos MT1 start reaching MT4",
  MT5_REACH: "excluded: valid route from the same chaos MT1 start reaching MT5",
  BLUEKING_WITNESS: "excluded: target MT5 blueKing witness (and all prefixes derived from it)",
  GENERATED_ARTIFACT: "excluded: generated artifact directory; not in exact allowlist and never parsed for training",
});

class LearnedPriorDatasetError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "LearnedPriorDatasetError";
    this.details = details || null;
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256OfString(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

// Deterministic reproduction of the historic route state key contract.  See the
// module header for the three documented normalizations.  This is used only for
// comparing reconstructed live states against stored route-record keys.
function legacyRouteStateKey(state, floorSet) {
  const flags = Object.assign({}, state.flags);
  delete flags.__leaveLoc__;
  const comparable = Object.assign({}, state, {
    hero: Object.assign({}, state.hero, { hp: null }),
    flags,
  });
  const key = JSON.parse(buildStateKey(comparable));
  const present = new Set(key.mutations.map((mutation) => mutation.floorId));
  for (const floorId of floorSet) {
    if (!present.has(floorId)) {
      key.mutations.push({ floorId, removed: [], replaced: [] });
    }
  }
  key.mutations.sort((left, right) => left.floorId.localeCompare(right.floorId));
  return JSON.stringify(key);
}

function loadGameProject() {
  return loadProject(PROJECT_ROOT);
}

function createSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

function validateRouteRecord(record, relPath) {
  const problems = [];
  if (!record || typeof record !== "object") problems.push("record is not an object");
  if (!record || record.schema !== ROUTE_SCHEMA) {
    problems.push(`schema must be ${ROUTE_SCHEMA} (got ${record && record.schema})`);
  }
  const start = record && record.start;
  if (!start || typeof start !== "object") problems.push("missing start");
  if (start && typeof start.stateKey !== "string") problems.push("start.stateKey must be a string");
  if (start && (!start.snapshot || typeof start.snapshot !== "object")) problems.push("start.snapshot must be an object");
  if (start && start.snapshot && (!start.snapshot.floors || typeof start.snapshot.floors !== "object")) {
    problems.push("start.snapshot.floors must be an object");
  }
  const final = record && record.final;
  if (!final || typeof final !== "object") problems.push("missing final");
  if (final && typeof final.floorId !== "string") problems.push("final.floorId must be a string");
  if (final && typeof final.stateKey !== "string") problems.push("final.stateKey must be a string");
  const decisions = record && record.decisions;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    problems.push("decisions must be a non-empty array");
  } else {
    decisions.forEach((decision, index) => {
      const label = `decisions[${index}]`;
      if (typeof decision.fingerprint !== "string" || decision.fingerprint.length === 0) {
        problems.push(`${label}.fingerprint must be a non-empty string`);
      }
      if (typeof decision.preStateKey !== "string" || decision.preStateKey.length === 0) {
        problems.push(`${label}.preStateKey must be a non-empty string`);
      }
      if (typeof decision.postStateKey !== "string" || decision.postStateKey.length === 0) {
        problems.push(`${label}.postStateKey must be a non-empty string`);
      }
      if (typeof decision.kind !== "string" || decision.kind.length === 0) {
        problems.push(`${label}.kind must be a non-empty string`);
      }
    });
  }
  if (problems.length > 0) {
    throw new LearnedPriorDatasetError(`route schema validation failed for ${relPath}`, { relPath, problems });
  }
  return true;
}

function readRouteRecord(relPath) {
  const absPath = path.resolve(REPO_ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    throw new LearnedPriorDatasetError(`allowlisted route file is missing: ${relPath}`, { relPath, absPath });
  }
  const record = JSON.parse(fs.readFileSync(absPath, "utf8"));
  validateRouteRecord(record, relPath);
  return {
    relPath,
    absPath,
    record,
    sha256: sha256OfFile(absPath),
  };
}

function provenanceRow(entry) {
  const record = entry.record;
  const start = (record && record.start) || {};
  const startSnapshot = start.snapshot || {};
  const source = (record && record.source) || {};
  return {
    path: entry.relPath,
    sha256: entry.sha256,
    schema: record && record.schema,
    schemaStatus: record && record.schema === ROUTE_SCHEMA ? "valid" : "invalid",
    source: {
      solver: source.solver || null,
      profile: source.profile || null,
      rank: source.rank || null,
      commit: source.commit || null,
    },
    start: {
      floorId: startSnapshot.floorId || null,
      stateKeySha256: start.stateKey ? sha256OfString(start.stateKey) : null,
      snapshotFloors: Object.keys(startSnapshot.floors || {}),
    },
    finalFloor: record && record.final && record.final.floorId,
    goalFloorId: record && record.goal && record.goal.floorId,
    decisionCount: Array.isArray(record && record.decisions) ? record.decisions.length : 0,
    status: entry.status,
    reason: entry.reason,
  };
}

// Classify a lightweight file listing row without parsing potentially huge
// generated artifacts.  Only the exact allowlist is ever included.
function classifyInventoryRow(row) {
  if (TRAIN_ALLOWLIST.includes(row.relPath)) {
    return { status: "included", reason: "exact allowlist member (Phase 1 training corpus)" };
  }
  const name = row.relPath.toLowerCase();
  if (/blueking/.test(name)) {
    return { status: "excluded", reason: EXCLUSION.BLUEKING_WITNESS };
  }
  if (/mt5/.test(name)) {
    return { status: "excluded", reason: EXCLUSION.MT5_REACH };
  }
  if (/mt4/.test(name)) {
    return { status: "excluded", reason: EXCLUSION.MT4_REACH };
  }
  if (row.parsedFloor) {
    if (row.parsedFloor === "MT5") return { status: "excluded", reason: EXCLUSION.MT5_REACH };
    if (row.parsedFloor === "MT4") return { status: "excluded", reason: EXCLUSION.MT4_REACH };
  }
  return { status: "excluded", reason: EXCLUSION.NOT_IN_ALLOWLIST };
}

function listRouteFiles(dir, options) {
  const config = options || {};
  const rows = [];
  if (!fs.existsSync(dir)) return rows;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".route.json")) continue;
    const absPath = path.join(dir, name);
    const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
    const row = { relPath, absPath, size: fs.statSync(absPath).size };
    if (config.parseContents) {
      try {
        const record = JSON.parse(fs.readFileSync(absPath, "utf8"));
        row.parsedFloor = (record.final && record.final.floorId) || null;
        row.parsedGoal = (record.goal && record.goal.floorId) || null;
        row.sha256 = sha256OfFile(absPath);
        row.schema = record.schema || null;
        row.source = record.source || null;
        row.decisionCount = Array.isArray(record.decisions) ? record.decisions.length : null;
      } catch (error) {
        row.parseError = error.message;
      }
    }
    rows.push(row);
  }
  return rows;
}

// Build a bounded witness inventory.  routes/fixtures and routes/latest are
// parsed in full; the very large routes/generated tree (1.6 GB) is
// name-inventoried only because the exact allowlist already excludes it.
function buildWitnessInventory() {
  const parsed = [];
  for (const row of listRouteFiles(path.join(SOLVER_ROOT, "routes", "fixtures"), { parseContents: true })) {
    parsed.push(Object.assign({ tier: "fixtures" }, row));
  }
  for (const row of listRouteFiles(path.join(SOLVER_ROOT, "routes", "latest"), { parseContents: true })) {
    parsed.push(Object.assign({ tier: "latest" }, row));
  }
  const inventory = parsed.map((row) => {
    const classification = classifyInventoryRow(row);
    return {
      path: row.relPath,
      tier: row.tier,
      sizeBytes: row.size,
      sha256: row.sha256 || null,
      schema: row.schema || null,
      source: row.source || null,
      finalFloor: row.parsedFloor || null,
      decisionCount: row.decisionCount == null ? null : row.decisionCount,
      parsed: !row.parseError,
      parseError: row.parseError || null,
      status: classification.status,
      reason: classification.reason,
    };
  });

  const generatedDir = path.join(SOLVER_ROOT, "routes", "generated");
  const generatedRows = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const absPath = path.join(dir, name);
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!name.endsWith(".route.json")) continue;
      const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
      const classification = classifyInventoryRow({ relPath });
      generatedRows.push({
        path: relPath,
        tier: "generated",
        sizeBytes: stat.size,
        status: "excluded",
        reason: classification.reason === EXCLUSION.NOT_IN_ALLOWLIST
          ? EXCLUSION.GENERATED_ARTIFACT
          : classification.reason,
      });
    }
  };
  if (fs.existsSync(generatedDir)) walk(generatedDir);

  const included = inventory.filter((row) => row.status === "included");
  const witnesses = inventory.filter((row) => row.reason === EXCLUSION.BLUEKING_WITNESS
    || row.reason === EXCLUSION.MT5_REACH
    || row.reason === EXCLUSION.MT4_REACH);

  return {
    generatedDirectoryPolicy: "name-inventoried only; contents never read or used for training",
    includedCount: included.length,
    witnessCount: witnesses.length,
    generatedCount: generatedRows.length,
    included,
    witnesses,
    generated: generatedRows,
  };
}

function buildExample(routeId, decision, state, normalizedActions, chosenIndex, ambiguousAliasCount) {
  return {
    routeId,
    decisionIndex: decision.index,
    kind: decision.kind,
    floorId: decision.floorId || null,
    fingerprint: decision.fingerprint,
    state: deepClone(state),
    legalActions: deepClone(normalizedActions),
    chosenIndex,
    ambiguousAliasCount,
  };
}

// Strict replay: reconstruct the recorded state path from the chaos MT1 start,
// match every recorded decision to exactly one enumerated primitive action, and
// verify the recorded pre-state, post-state and final state keys byte-for-byte.
function replayRoute(entry, project) {
  const { record, relPath } = entry;
  const floorSet = Object.keys((record.start.snapshot || {}).floors || {});
  const simulator = createSimulator(project);
  let state = simulator.createInitialState({ rank: "chaos" });

  const startKey = legacyRouteStateKey(state, floorSet);
  if (startKey !== record.start.stateKey) {
    throw new LearnedPriorDatasetError(`replay start state key mismatch for ${relPath}`, {
      relPath, expected: record.start.stateKey, actual: startKey,
    });
  }

  const examples = [];
  let ambiguousDecisions = 0;
  let totalAliasCandidates = 0;

  for (const decision of record.decisions) {
    const preKey = legacyRouteStateKey(state, floorSet);
    if (preKey !== decision.preStateKey) {
      throw new LearnedPriorDatasetError(`replay pre-state key mismatch at ${relPath} decision ${decision.index}`, {
        relPath, decisionIndex: decision.index, expected: decision.preStateKey, actual: preKey,
      });
    }

    let rawActions = [];
    try {
      rawActions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    } catch (error) {
      throw new LearnedPriorDatasetError(`primitive action enumeration failed at ${relPath} decision ${decision.index}`, {
        relPath, decisionIndex: decision.index, message: error.message,
      });
    }
    if (rawActions.length === 0) {
      throw new LearnedPriorDatasetError(`no legal primitive actions at ${relPath} decision ${decision.index}`, {
        relPath, decisionIndex: decision.index,
      });
    }

    const normalizedActions = rawActions.map((action) => normalizeAction(action));
    const aliasIndexes = [];
    normalizedActions.forEach((action, index) => {
      if (action.fingerprint === decision.fingerprint) aliasIndexes.push(index);
    });
    if (aliasIndexes.length === 0) {
      throw new LearnedPriorDatasetError(`no enumerated primitive action matches recorded fingerprint at ${relPath} decision ${decision.index}`, {
        relPath,
        decisionIndex: decision.index,
        fingerprint: decision.fingerprint,
        available: normalizedActions.map((action) => action.fingerprint),
      });
    }

    // Recorded choice identity is the fingerprint; the recorded POST-state is
    // the strict tie-breaker when several primitive travel variants share one
    // fingerprint.  Exactly one candidate must reproduce the recorded post-state.
    const reproducing = aliasIndexes.filter((index) => {
      const next = simulator.applyAction(state, rawActions[index], { storeRoute: false });
      return legacyRouteStateKey(next, floorSet) === decision.postStateKey;
    });
    if (reproducing.length !== 1) {
      throw new LearnedPriorDatasetError(`recorded decision is not uniquely reproducible at ${relPath} decision ${decision.index}`, {
        relPath,
        decisionIndex: decision.index,
        fingerprint: decision.fingerprint,
        aliasCandidates: aliasIndexes.length,
        postStateReproducingCandidates: reproducing.length,
      });
    }
    const chosenIndex = reproducing[0];
    if (aliasIndexes.length > 1) {
      ambiguousDecisions += 1;
      totalAliasCandidates += aliasIndexes.length;
    }

    examples.push(buildExample(relPath, decision, state, normalizedActions, chosenIndex, aliasIndexes.length));

    state = simulator.applyAction(state, rawActions[chosenIndex], { storeRoute: false });
    const postKey = legacyRouteStateKey(state, floorSet);
    if (postKey !== decision.postStateKey) {
      throw new LearnedPriorDatasetError(`replay post-state key mismatch at ${relPath} decision ${decision.index}`, {
        relPath, decisionIndex: decision.index, expected: decision.postStateKey, actual: postKey,
      });
    }
  }

  if (state.floorId !== record.final.floorId) {
    throw new LearnedPriorDatasetError(`replay final floor mismatch for ${relPath}`, {
      relPath, expected: record.final.floorId, actual: state.floorId,
    });
  }
  const finalKey = legacyRouteStateKey(state, floorSet);
  if (finalKey !== record.final.stateKey) {
    throw new LearnedPriorDatasetError(`replay final state key mismatch for ${relPath}`, {
      relPath, expected: record.final.stateKey, actual: finalKey,
    });
  }

  return {
    entry,
    examples,
    stats: {
      decisionsReplayed: record.decisions.length,
      examplesExtracted: examples.length,
      ambiguousDecisions,
      totalAliasCandidates,
      finalFloor: state.floorId,
      floorSet,
    },
  };
}

function buildDataset(options) {
  const config = options || {};
  const project = config.project || loadProject(PROJECT_ROOT);
  const entries = TRAIN_ALLOWLIST.map((relPath) => readRouteRecord(relPath));
  const replayResults = entries.map((entry) => replayRoute(entry, project));
  const examples = [].concat(...replayResults.map((result) => result.examples));
  if (examples.length === 0) {
    throw new LearnedPriorDatasetError("strict replay produced zero training examples");
  }
  const inventory = buildWitnessInventory();
  const replayRecords = replayResults.map((result) => ({
    path: result.entry.relPath,
    sha256: result.entry.sha256,
    finalFloor: result.entry.record.final.floorId,
    goalFloorId: (result.entry.record.goal || {}).floorId || null,
    ...result.stats,
  }));
  return {
    allowlist: TRAIN_ALLOWLIST.slice(),
    projectRoot: PROJECT_ROOT,
    legacyKeyNormalization: [
      "hero.hp set to null (historic dominance key ignored HP)",
      "flags.__leaveLoc__ dropped for key comparison only (predates the runtime field)",
      "empty mutation entries emitted for every floor in the route snapshot floors map",
    ],
    examples,
    routeStats: replayRecords,
    provenance: entries.map((entry) => provenanceRow(Object.assign({}, entry, {
      status: "included",
      reason: "exact allowlist member (Phase 1 training corpus)",
    }))),
    inventory,
    totals: {
      routes: entries.length,
      examples: examples.length,
      included: inventory.includedCount,
      witnessesExcluded: inventory.witnessCount,
      generatedExcluded: inventory.generatedCount,
    },
  };
}

module.exports = {
  EXCLUSION,
  LearnedPriorDatasetError,
  PROJECT_ROOT,
  ROUTE_SCHEMA,
  TRAIN_ALLOWLIST,
  buildDataset,
  buildWitnessInventory,
  classifyInventoryRow,
  createSimulator,
  legacyRouteStateKey,
  loadGameProject,
  readRouteRecord,
  replayRoute,
  sha256OfFile,
  sha256OfString,
  validateRouteRecord,
};
