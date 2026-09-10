"use strict";

// PR-5.25d Step 0: non-overlapping trajectory corpus inventory.
//
// This module is READ-ONLY with respect to production solver behaviour.  It
// answers one bounded question before any training happens:
//
//   Among the existing legal routes, is there a (TRAIN family, HELD-OUT family)
//   split whose held-out decisions do NOT appear in TRAIN?
//
// Decision identity for overlap purposes is the pair
//
//   (buildStateKey(reconstructed state), chosenActionFingerprint)
//
// where the chosen action is the recorded decision matched to an enumerated
// primitive action and disambiguated by the recorded post-state key.
//
// Strict replay note: route records were written by several solver
// generations, so three historical key normalizations coexist.  The correct
// one is detected per route from the recorded `start.stateKey`:
//
//   legacy     hero.hp null (hpmax/manamax kept)
//   dominance  hero.hp/hpmax/manamax null   (current buildDominanceKey shape)
//   canonical  no field nulling             (current buildStateKey shape)
//
// All three additionally emit empty mutation entries for every floor in the
// route snapshot's `floors` map, matching the historical serializer.  A route
// whose start key cannot be reproduced (mid-route start that is not the chaos
// MT1 initial state, or a start-offset record) is reported as not-replayable
// rather than guessed at.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { buildStateKey } = require("./state-key");
const { normalizeAction } = require("./route-store");
const {
  SOLVER_ROOT,
  createSimulator,
  loadGameProject,
} = require("./learned-prior-dataset");

const REPO_ROOT = path.resolve(SOLVER_ROOT, "..");
const KEY_MODES = Object.freeze(["legacy", "dominance", "canonical"]);
const QUALIFICATION_MIN_FLOOR = 4;
const DEFAULT_CRITERION = Object.freeze({
  minDistinctUnseenSignatures: 50,
  minUnseenForAtLeastOneHeldOutRoute: 20,
});

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function floorOrdinalValue(floorId) {
  const match = /^MT(\d+)$/.exec(String(floorId || ""));
  return match ? Number(match[1]) : 0;
}

// Historical route key reproduction with a selectable normalization mode.
function normalizedRouteKey(state, floorSet, mode) {
  const flags = Object.assign({}, state.flags);
  delete flags.__leaveLoc__;
  const hero = Object.assign({}, state.hero);
  if (mode === "legacy" || mode === "dominance") hero.hp = null;
  if (mode === "dominance") {
    hero.hpmax = null;
    hero.manamax = null;
  }
  const comparable = Object.assign({}, state, { hero, flags });
  const key = JSON.parse(buildStateKey(comparable));
  const present = new Set(key.mutations.map((mutation) => mutation.floorId));
  for (const floorId of floorSet) {
    if (!present.has(floorId)) key.mutations.push({ floorId, removed: [], replaced: [] });
  }
  key.mutations.sort((left, right) => left.floorId.localeCompare(right.floorId));
  return JSON.stringify(key);
}

function listRouteFiles() {
  const files = [];
  for (const dir of ["routes/fixtures", "routes/latest"]) {
    const absDir = path.join(SOLVER_ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const name of fs.readdirSync(absDir).sort()) {
      if (!name.endsWith(".route.json")) continue;
      files.push(path.join(absDir, name));
    }
  }
  return files;
}

// Strict replay of one route from the chaos MT1 initial state.  Returns either
// { ok: true, signatures, ... } or { ok: false, reason }.
function replayRouteFile(project, absPath) {
  const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
  const record = JSON.parse(fs.readFileSync(absPath, "utf8"));
  const snapshot = (record.start && record.start.snapshot) || {};
  if (snapshot.floorId !== "MT1") {
    return { relPath, ok: false, reason: `non-mt1-start:${snapshot.floorId}` };
  }
  const floorSet = Object.keys(snapshot.floors || {});
  const simulator = createSimulator(project);
  let state = simulator.createInitialState({ rank: "chaos" });
  const mode = KEY_MODES.find((candidate) => normalizedRouteKey(state, floorSet, candidate) === record.start.stateKey);
  if (!mode) return { relPath, ok: false, reason: "start-key-mismatch" };

  const keyOf = (candidateState) => normalizedRouteKey(candidateState, floorSet, mode);
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  const signatures = [];
  const kinds = {};
  let ambiguousResolved = 0;

  for (const decision of decisions) {
    if (keyOf(state) !== decision.preStateKey) {
      return { relPath, ok: false, reason: `pre-mismatch@${decision.index}`, mode };
    }
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const normalized = actions.map((action) => normalizeAction(action));
    const aliasIndexes = [];
    normalized.forEach((action, index) => {
      if (action.fingerprint === decision.fingerprint) aliasIndexes.push(index);
    });
    if (aliasIndexes.length === 0) {
      return { relPath, ok: false, reason: `no-fingerprint-match@${decision.index}`, mode };
    }
    const reproducing = aliasIndexes.filter((index) => (
      keyOf(simulator.applyAction(state, actions[index], { storeRoute: false })) === decision.postStateKey
    ));
    if (reproducing.length !== 1) {
      return { relPath, ok: false, reason: `ambiguous(${reproducing.length}/${aliasIndexes.length})@${decision.index}`, mode };
    }
    if (aliasIndexes.length > 1) ambiguousResolved += 1;
    signatures.push(`${buildStateKey(state)}|${normalized[reproducing[0]].fingerprint}`);
    kinds[decision.kind] = (kinds[decision.kind] || 0) + 1;
    state = simulator.applyAction(state, actions[reproducing[0]], { storeRoute: false });
    if (keyOf(state) !== decision.postStateKey) {
      return { relPath, ok: false, reason: `post-mismatch@${decision.index}`, mode };
    }
  }

  return {
    relPath,
    ok: true,
    sha256: sha256OfFile(absPath),
    mode,
    decisions: decisions.length,
    finalFloor: (record.final && record.final.floorId) || null,
    goalFloorId: (record.goal && record.goal.floorId) || null,
    profile: (record.source && record.source.profile) || null,
    solver: (record.source && record.source.solver) || null,
    ambiguousResolved,
    kinds,
    signatures,
  };
}

function dedupeBySignatureSequence(routes) {
  const seen = new Map();
  const distinct = [];
  const duplicates = [];
  for (const route of routes) {
    const key = route.signatures.join("\n");
    if (seen.has(key)) {
      duplicates.push({ relPath: route.relPath, duplicateOf: seen.get(key) });
      continue;
    }
    seen.set(key, route.relPath);
    distinct.push(route);
  }
  return { distinct, duplicates };
}

function signatureUniverse(routes) {
  const universe = new Set();
  for (const route of routes) for (const signature of route.signatures) universe.add(signature);
  return universe;
}

// TRAIN = chaos MT1 -> final floor <= MT3 (excludes the MT4/MT5 qualification
// family).  HELD-OUT = final floor >= MT4 qualification family.
function analyzeNonOverlap(distinctRoutes, options) {
  const criterion = Object.assign({}, DEFAULT_CRITERION, options || {});
  const train = distinctRoutes.filter((route) => floorOrdinalValue(route.finalFloor) <= 3);
  const heldOut = distinctRoutes.filter((route) => floorOrdinalValue(route.finalFloor) >= QUALIFICATION_MIN_FLOOR);
  const trainSignatures = signatureUniverse(train);
  const heldOutRows = heldOut.map((route) => {
    const unseen = route.signatures.filter((signature) => !trainSignatures.has(signature));
    return {
      relPath: route.relPath,
      finalFloor: route.finalFloor,
      mode: route.mode,
      decisions: route.decisions,
      unseenDecisions: unseen.length,
      unseenFraction: route.decisions > 0 ? unseen.length / route.decisions : 0,
      unseenSignatures: unseen,
    };
  });
  const distinctUnseen = new Set();
  for (const row of heldOutRows) for (const signature of row.unseenSignatures) distinctUnseen.add(signature);
  const maxUnseen = heldOutRows.reduce((max, row) => Math.max(max, row.unseenDecisions), 0);
  const sufficient = distinctUnseen.size >= criterion.minDistinctUnseenSignatures
    && maxUnseen >= criterion.minUnseenForAtLeastOneHeldOutRoute;
  return {
    criterion,
    trainFamily: {
      routeCount: train.length,
      decisions: train.reduce((sum, route) => sum + route.decisions, 0),
      distinctSignatures: trainSignatures.size,
      routes: train.map((route) => ({
        relPath: route.relPath,
        finalFloor: route.finalFloor,
        mode: route.mode,
        decisions: route.decisions,
        sha256: route.sha256,
      })),
    },
    heldOutFamily: {
      routeCount: heldOut.length,
      decisions: heldOutRows.reduce((sum, row) => sum + row.decisions, 0),
      distinctUnseenSignatures: distinctUnseen.size,
      unseenDecisionSum: heldOutRows.reduce((sum, row) => sum + row.unseenDecisions, 0),
      routes: heldOutRows.map((row) => ({
        relPath: row.relPath,
        finalFloor: row.finalFloor,
        mode: row.mode,
        decisions: row.decisions,
        unseenDecisions: row.unseenDecisions,
        unseenFraction: Number(row.unseenFraction.toFixed(4)),
      })),
    },
    maxUnseenDecisionsOnAnyHeldOutRoute: maxUnseen,
    verdict: sufficient ? "SUFFICIENT_BEHAVIOR_CORPUS" : "INSUFFICIENT_BEHAVIOR_CORPUS",
  };
}

function inventoryCorpus(options) {
  const config = options || {};
  const project = config.project || loadGameProject();
  const files = listRouteFiles();
  const results = files.map((absPath) => replayRouteFile(project, absPath));
  const replayed = results.filter((result) => result.ok);
  const { distinct, duplicates } = dedupeBySignatureSequence(replayed);
  const analysis = analyzeNonOverlap(distinct, config.criterion);
  const failureHistogram = {};
  for (const result of results.filter((entry) => !entry.ok)) {
    const bucket = String(result.reason).split("@")[0].split(":")[0];
    failureHistogram[bucket] = (failureHistogram[bucket] || 0) + 1;
  }
  return {
    scannedFiles: files.length,
    replayedFiles: replayed.length,
    notReplayedFiles: results.length - replayed.length,
    failureHistogram,
    failures: results.filter((result) => !result.ok).map((result) => ({ path: result.relPath, reason: result.reason })),
    modeHistogram: replayed.reduce((map, route) => {
      map[route.mode] = (map[route.mode] || 0) + 1;
      return map;
    }, {}),
    totalDecisionsReplayed: replayed.reduce((sum, route) => sum + route.decisions, 0),
    ambiguousResolved: replayed.reduce((sum, route) => sum + route.ambiguousResolved, 0),
    distinctRoutes: distinct.length,
    duplicateRoutes: duplicates,
    distinctSignatures: signatureUniverse(distinct).size,
    analysis,
  };
}

module.exports = {
  DEFAULT_CRITERION,
  KEY_MODES,
  QUALIFICATION_MIN_FLOOR,
  analyzeNonOverlap,
  dedupeBySignatureSequence,
  floorOrdinalValue,
  inventoryCorpus,
  listRouteFiles,
  normalizedRouteKey,
  replayRouteFile,
  signatureUniverse,
};
