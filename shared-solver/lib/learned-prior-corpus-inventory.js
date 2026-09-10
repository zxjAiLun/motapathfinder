"use strict";

// PR-5.25d Step 0/1 corpus layer: non-overlapping trajectory inventory.
//
// READ-ONLY with respect to production solver behaviour.  It answers:
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
// QUALIFICATION-FAMILY MEMBERSHIP IS BY MAX REACHED FLOOR, NOT FINAL FLOOR.
// The solver supports cross-floor return / floorFly, so a route may go
// MT1 -> MT2 -> MT3 -> MT4 -> back to MT3 and still end with finalFloor = MT3
// while its decisions already contain MT4+ behaviour.  Classification therefore
// uses the maximum floor ordinal observed on any reconstructed state along the
// route:
//
//   TRAIN_ELIGIBLE     = chaos MT1 start AND maxReachedFloorOrdinal <= 3
//   HELD_OUT_ELIGIBLE  = chaos MT1 start AND maxReachedFloorOrdinal >= 4
//                        (near layer: == 4, deep layer: >= 5)
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
const { encodeFeatures, encodeFeaturesV2 } = require("./learned-action-prior");
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

// Raw (un-encoded) battle estimate keys for the PR-5.25f estimate-only baseline.
// Missing or non-finite values are recorded as null so the baseline can declare
// a decision non-evaluable instead of guessing.
function normalizeEstimateForProbe(estimate) {
  if (!estimate) return { damage: null, turn: null };
  const damage = estimate.damage == null ? null : Number(estimate.damage);
  const turn = estimate.turn == null ? null : Number(estimate.turn);
  return {
    damage: Number.isFinite(damage) ? damage : null,
    turn: Number.isFinite(turn) ? turn : null,
  };
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
// { ok: true, signatures, maxReachedFloorOrdinal, ... } or { ok: false, reason }.
// When `captureDecisions` is true each replayed decision also carries the
// encoded feature vectors for its full legal action set plus the chosen index,
// so downstream training never needs to re-store or re-encode raw states.
function replayRouteFile(project, absPath, options) {
  const config = options || {};
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
  const decisionRecords = [];
  const kinds = {};
  let ambiguousResolved = 0;
  let maxReachedFloorOrdinal = floorOrdinalValue(state.floorId);

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

    const signature = `${buildStateKey(state)}|${normalized[reproducing[0]].fingerprint}`;
    signatures.push(signature);
    kinds[decision.kind] = (kinds[decision.kind] || 0) + 1;
    if (config.captureDecisions) {
      // Fail closed on an unresolvable changeFloor destination: exclude the whole
      // route (with a recorded reason) rather than silently encoding delta 0.
      let vectorsV2;
      try {
        vectorsV2 = normalized.map((action) => encodeFeaturesV2(state, action, { floorOrder: project.floorOrder }));
      } catch (error) {
        return { relPath, ok: false, reason: `changefloor-destination-unresolved@${decision.index}`, mode, detail: error.message };
      }
      decisionRecords.push({
        signature,
        decisionIndex: decision.index,
        floorId: state.floorId,
        floorOrdinal: floorOrdinalValue(state.floorId),
        kind: decision.kind,
        chosenIndex: reproducing[0],
        legalActionCount: normalized.length,
        vectors: normalized.map((action) => encodeFeatures(state, action)),
        vectorsV2,
        actionEstimates: normalized.map((action) => normalizeEstimateForProbe(action.estimate)),
      });
    }

    state = simulator.applyAction(state, actions[reproducing[0]], { storeRoute: false });
    if (keyOf(state) !== decision.postStateKey) {
      return { relPath, ok: false, reason: `post-mismatch@${decision.index}`, mode };
    }
    maxReachedFloorOrdinal = Math.max(maxReachedFloorOrdinal, floorOrdinalValue(state.floorId));
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
    decisionRecords,
    maxReachedFloorOrdinal,
    reachedMt4Plus: maxReachedFloorOrdinal >= QUALIFICATION_MIN_FLOOR,
    layer: maxReachedFloorOrdinal >= QUALIFICATION_MIN_FLOOR
      ? (maxReachedFloorOrdinal === QUALIFICATION_MIN_FLOOR ? "near" : "deep")
      : null,
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

// TRAIN = chaos MT1 routes whose maximum reached floor is <= MT3.
// HELD-OUT = chaos MT1 routes that reach MT4+ (near == MT4, deep >= MT5).
function splitByMaxReachedFloor(distinctRoutes) {
  const train = distinctRoutes.filter((route) => !route.reachedMt4Plus);
  const heldOut = distinctRoutes.filter((route) => route.reachedMt4Plus);
  return { train, heldOut };
}

function analyzeNonOverlap(distinctRoutes, options) {
  const criterion = Object.assign({}, DEFAULT_CRITERION, options || {});
  const { train, heldOut } = splitByMaxReachedFloor(distinctRoutes);
  const trainSignatures = signatureUniverse(train);
  const heldOutRows = heldOut.map((route) => {
    const unseen = route.signatures.filter((signature) => !trainSignatures.has(signature));
    return {
      relPath: route.relPath,
      finalFloor: route.finalFloor,
      maxReachedFloorOrdinal: route.maxReachedFloorOrdinal,
      layer: route.layer,
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
  const nearCount = heldOutRows.filter((row) => row.layer === "near").length;
  const deepCount = heldOutRows.filter((row) => row.layer === "deep").length;
  const sufficient = distinctUnseen.size >= criterion.minDistinctUnseenSignatures
    && maxUnseen >= criterion.minUnseenForAtLeastOneHeldOutRoute;
  return {
    criterion,
    splitRule: {
      train: "chaos MT1 start AND maxReachedFloorOrdinal <= 3",
      heldOut: "chaos MT1 start AND maxReachedFloorOrdinal >= 4",
      note: "membership uses the maximum floor reached during replay, not the final floor (cross-floor return / floorFly safe)",
    },
    trainFamily: {
      routeCount: train.length,
      decisions: train.reduce((sum, route) => sum + route.decisions, 0),
      distinctSignatures: trainSignatures.size,
      routes: train.map((route) => ({
        relPath: route.relPath,
        finalFloor: route.finalFloor,
        maxReachedFloorOrdinal: route.maxReachedFloorOrdinal,
        mode: route.mode,
        decisions: route.decisions,
        sha256: route.sha256,
      })),
    },
    heldOutFamily: {
      routeCount: heldOut.length,
      nearRouteCount: nearCount,
      deepRouteCount: deepCount,
      decisions: heldOutRows.reduce((sum, row) => sum + row.decisions, 0),
      distinctUnseenSignatures: distinctUnseen.size,
      unseenDecisionSum: heldOutRows.reduce((sum, row) => sum + row.unseenDecisions, 0),
      routes: heldOutRows.map((row) => ({
        relPath: row.relPath,
        finalFloor: row.finalFloor,
        maxReachedFloorOrdinal: row.maxReachedFloorOrdinal,
        layer: row.layer,
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
  const results = files.map((absPath) => replayRouteFile(project, absPath, {
    captureDecisions: Boolean(config.captureDecisions),
  }));
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
    distinctRouteRecords: distinct,
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
  normalizeEstimateForProbe,
  replayRouteFile,
  signatureUniverse,
  splitByMaxReachedFloor,
};
