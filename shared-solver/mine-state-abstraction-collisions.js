"use strict";

/**
 * PR-4.5c1 — Witness Integrity & Collision Identity
 *
 * This miner is intentionally shadow-only. It reads existing JSON artifacts,
 * groups exact-state-distinct records by the shadow projection, and reuses the
 * bounded paired-expansion runner for a deterministic, capped sample.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  makeRealAdapter,
  runPairedExpansion,
} = require("./bounded-abstraction-counterexample-search");
const {
  safeStateKey,
  shadowProjectionKey,
} = require("./audit-state-abstraction");
const { loadProject } = require("./lib/project-loader");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST = path.resolve(__dirname, "profiles", "state-abstraction-mining-sources.json");
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5c-state-abstraction-collision-inventory.json",
);
const DEFAULT_OUT_MD = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5c-state-abstraction-collision-inventory.md",
);

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function gitCommit() {
  try {
    return require("node:child_process")
      .execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" })
      .trim();
  } catch (error) {
    return null;
  }
}

function resolveWorkspacePath(file) {
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

function getPath(value, dottedPath) {
  return String(dottedPath || "").split(".").filter(Boolean).reduce((current, part) => (
    current == null ? undefined : current[part]
  ), value);
}

function compareKnown(left, right) {
  if (left === undefined || right === undefined || left === null || right === null) return "unknown";
  return canonicalJson(left) === canonicalJson(right) ? "false" : "true";
}

function parseExactKey(key) {
  try {
    return JSON.parse(key);
  } catch (error) {
    return null;
  }
}

function mutationAtFloor(mutations, floorId) {
  return (mutations || []).filter((entry) => entry && entry.floorId === floorId);
}

function hasCrossFloorAction(action) {
  if (!action || typeof action !== "object") return false;
  const text = [action.kind, action.summary, action.fingerprint]
    .filter((value) => value != null)
    .join(" ");
  return action.targetFloorId != null || action.changeFloor != null ||
    /change.?floor|floor.?fly|fly.?floor|teleport/i.test(text);
}

function crossFloorActionAvailable(adapter, state) {
  try {
    const enumeration = adapter.enumerate(state) || { actions: [], errors: [] };
    if ((enumeration.errors || []).length > 0) return "unknown";
    return (enumeration.actions || []).some(hasCrossFloorAction) ? "true" : "false";
  } catch (error) {
    return "unknown";
  }
}

function buildRiskLabels(leftRecord, rightRecord, adapter, runResult) {
  const leftExact = parseExactKey(leftRecord.exactKey);
  const rightExact = parseExactKey(rightRecord.exactKey);
  const leftMutations = leftExact && Array.isArray(leftExact.mutations) ? leftExact.mutations : null;
  const rightMutations = rightExact && Array.isArray(rightExact.mutations) ? rightExact.mutations : null;
  const sameFloor = leftExact && rightExact && leftExact.floorId === rightExact.floorId;
  const currentFloor = sameFloor ? leftExact.floorId : null;
  const triggeredPresent = (state) => {
    if (!state || !Object.prototype.hasOwnProperty.call(state, "triggeredAutoEvents")) return null;
    return state.triggeredAutoEvents && typeof state.triggeredAutoEvents === "object" &&
      Object.keys(state.triggeredAutoEvents).length > 0;
  };
  const leftTriggered = triggeredPresent(leftRecord.state);
  const rightTriggered = triggeredPresent(rightRecord.state);
  const leftCrossFloor = crossFloorActionAvailable(adapter, leftRecord.state);
  const rightCrossFloor = crossFloorActionAvailable(adapter, rightRecord.state);
  let triggeredAutoEventsPresent = "unknown";
  if (leftTriggered !== null && rightTriggered !== null) {
    triggeredAutoEventsPresent = leftTriggered || rightTriggered ? "true" : "false";
  }
  let multiSuccessorObserved = "unknown";
  if (runResult && runResult.multiSuccessorActionCount > 0) multiSuccessorObserved = "true";
  else if (runResult && runResult.executionErrors === null && runResult.outcome !== "incomplete") multiSuccessorObserved = "false";
  let exactRejoinObserved = "unknown";
  if (runResult && runResult.outcome !== "incomplete") {
    exactRejoinObserved = runResult.exactRejoinObserved ? "true" : "false";
  }
  return {
    nonCurrentFloorMutationDiff: sameFloor && leftMutations && rightMutations
      ? compareKnown(leftMutations.filter((entry) => entry.floorId !== currentFloor), rightMutations.filter((entry) => entry.floorId !== currentFloor))
      : "unknown",
    currentFloorMutationDiff: sameFloor && leftMutations && rightMutations
      ? compareKnown(mutationAtFloor(leftMutations, currentFloor), mutationAtFloor(rightMutations, currentFloor))
      : "unknown",
    leaveLocOrDirectionDiff: leftExact && rightExact
      ? compareKnown({ leaveLoc: leftExact.flags && leftExact.flags.__leaveLoc__, direction: leftExact.hero && leftExact.hero.direction }, {
        leaveLoc: rightExact.flags && rightExact.flags.__leaveLoc__, direction: rightExact.hero && rightExact.hero.direction,
      })
      : "unknown",
    triggeredAutoEventsPresent,
    crossFloorActionAvailable: [leftCrossFloor, rightCrossFloor].includes("true") ? "true" : (
      [leftCrossFloor, rightCrossFloor].includes("unknown") ? "unknown" : "false"
    ),
    multiSuccessorObserved,
    exactRejoinObserved,
  };
}

function extractSourceRecords(source, artifact) {
  const records = [];
  const errors = [];
  for (const collection of source.collections || []) {
    const checkpoints = getPath(artifact, collection.path);
    if (!Array.isArray(checkpoints)) {
      errors.push({ collectionId: collection.id, reason: "collection-path-not-array", path: collection.path });
      continue;
    }
    const wanted = new Set(collection.checkpointIds || []);
    const selectedCheckpoints = checkpoints
      .filter((checkpoint) => wanted.size === 0 || wanted.has(checkpoint.segmentId) || wanted.has(checkpoint.id))
      .sort((left, right) => String(left.segmentId || left.id || "").localeCompare(String(right.segmentId || right.id || "")));
    if (wanted.size > 0) {
      const found = new Set(selectedCheckpoints.flatMap((checkpoint) => [checkpoint.segmentId, checkpoint.id]
        .filter((value) => value != null)
        .map(String)));
      for (const checkpointId of wanted) {
        if (!found.has(String(checkpointId))) {
          errors.push({ collectionId: collection.id, checkpointId: String(checkpointId), reason: "checkpoint-id-not-found", path: collection.path });
        }
      }
    }
    for (const checkpoint of selectedCheckpoints) {
      const checkpointId = String(checkpoint.segmentId || checkpoint.id || "unknown-checkpoint");
      const candidates = Array.isArray(checkpoint.candidates) ? checkpoint.candidates.slice() : [];
      candidates.sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
      for (const [candidateIndex, candidate] of candidates.slice(0, Number(collection.candidateLimit ?? candidates.length)).entries()) {
        const state = getPath(candidate, collection.statePath || "state");
        const exactKey = safeStateKey(state);
        const projectionKey = shadowProjectionKey(state);
        if (!state || !exactKey || !projectionKey) {
          errors.push({ collectionId: collection.id, checkpointId, candidateId: candidate.id || null, reason: "state-key-extraction-failed" });
          continue;
        }
        const candidateId = candidate.id || `candidate-${candidateIndex}`;
        records.push({
          state,
          exactKey,
          projectionKey,
          sourceId: source.id,
          collectionId: collection.id,
          checkpointId,
          candidateId,
          stateId: `${source.id}::${collection.id}::${checkpointId}::${candidateId}`,
        });
      }
    }
  }
  records.sort((left, right) => left.stateId.localeCompare(right.stateId));
  return { records, errors };
}

function buildCollisionGroups(records, sourceId) {
  const byProjection = new Map();
  for (const record of records) {
    if (!byProjection.has(record.projectionKey)) byProjection.set(record.projectionKey, []);
    byProjection.get(record.projectionKey).push(record);
  }
  const groups = [];
  for (const [projectionKey, members] of byProjection.entries()) {
    const exactKeys = Array.from(new Set(members.map((record) => record.exactKey))).sort();
    if (exactKeys.length <= 1) continue;
    const exactKeyHashes = exactKeys.map(hash).sort();
    const signatureId = `signature-${hash(`${projectionKey}|${exactKeyHashes.join("|")}`)}`;
    const scopeKey = Array.from(new Set(members.map((record) => `${record.collectionId}::${record.checkpointId}`))).sort().join("|");
    const occurrenceId = `occurrence-${hash(`${sourceId || members[0].sourceId}|${scopeKey}|${signatureId}`)}`;
    const sortedMembers = members.slice().sort((left, right) => (
      `${hash(left.exactKey)}|${left.stateId}`.localeCompare(`${hash(right.exactKey)}|${right.stateId}`)
    ));
    const pairs = [];
    for (let leftIndex = 0; leftIndex < sortedMembers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sortedMembers.length; rightIndex += 1) {
        if (sortedMembers[leftIndex].exactKey === sortedMembers[rightIndex].exactKey) continue;
        const left = sortedMembers[leftIndex];
        const right = sortedMembers[rightIndex];
        const ordered = left.stateId.localeCompare(right.stateId) <= 0 ? [left, right] : [right, left];
        pairs.push({ left: ordered[0], right: ordered[1] });
      }
    }
    pairs.sort((left, right) => `${left.left.stateId}|${left.right.stateId}`.localeCompare(`${right.left.stateId}|${right.right.stateId}`));
    groups.push({
      id: occurrenceId,
      signatureId,
      sourceId: sourceId || members[0].sourceId,
      scopeKey,
      projectionKey,
      projectionKeyHash: hash(projectionKey),
      exactKeyHashes,
      exactKeyCount: exactKeys.length,
      stateIds: sortedMembers.map((record) => record.stateId),
      pairCount: pairs.length,
      pairs,
    });
  }
  groups.sort((left, right) => `${left.signatureId}|${left.id}`.localeCompare(`${right.signatureId}|${right.id}`));
  return groups;
}

function pairId(groupId, left, right) {
  return `pair-${hash(`${groupId}|${left.stateId}|${right.stateId}`)}`;
}

function publicRecord(record) {
  return {
    stateId: record.stateId,
    sourceId: record.sourceId,
    collectionId: record.collectionId,
    checkpointId: record.checkpointId,
    candidateId: record.candidateId,
    exactKeyHash: hash(record.exactKey),
    projectionKeyHash: hash(record.projectionKey),
  };
}

function runPair(group, pair, adapter, search) {
  const id = pairId(group.id, pair.left, pair.right);
  const initialPair = {
    exactKeyHashes: {
      left: hash(pair.left.exactKey),
      right: hash(pair.right.exactKey),
    },
    projectionKeyHashes: {
      left: hash(pair.left.projectionKey),
      right: hash(pair.right.projectionKey),
    },
    projectionEqual: pair.left.projectionKey === pair.right.projectionKey,
  };
  const root = {
    id,
    decision: null,
    left: pair.left.state,
    right: pair.right.state,
    initialPair,
  };
  const result = runPairedExpansion(root, adapter, search);
  return {
    id,
    groupId: group.id,
    signatureId: group.signatureId || null,
    initialPair: result.witness && result.witness.initialPair || initialPair,
    left: publicRecord(pair.left),
    right: publicRecord(pair.right),
    riskLabels: buildRiskLabels(pair.left, pair.right, adapter, result),
    outcome: result.outcome,
    depth: result.depth,
    depthReached: result.depthReached,
    expandedPairCount: result.expandedPairCount,
    generatedPairCount: result.generatedPairCount,
    budgetExhausted: result.budgetExhausted,
    exhaustedReason: result.exhaustedReason,
    incompleteReason: result.incompleteReason,
    branchCap: result.branchCap,
    stateCap: result.stateCap,
    multiSuccessorActionCount: result.multiSuccessorActionCount,
    maxSuccessorsPerAction: result.maxSuccessorsPerAction,
    generatedCrossProductPairCount: result.generatedCrossProductPairCount,
    exactRejoinObserved: result.exactRejoinObserved,
    executionErrors: result.executionErrors,
    levels: result.levels,
    witness: result.witness,
  };
}

function buildRiskStrata(pairs) {
  const labels = [
    "nonCurrentFloorMutationDiff",
    "currentFloorMutationDiff",
    "leaveLocOrDirectionDiff",
    "triggeredAutoEventsPresent",
    "crossFloorActionAvailable",
    "multiSuccessorObserved",
    "exactRejoinObserved",
  ];
  return labels.reduce((result, label) => {
    result[label] = { true: 0, false: 0, unknown: 0 };
    pairs.forEach((pair) => {
      const value = pair.riskLabels[label];
      if (Object.prototype.hasOwnProperty.call(result[label], value)) result[label][value] += 1;
      else result[label].unknown += 1;
    });
    return result;
  }, {});
}

function outcomeCounts(pairs) {
  return ["equivalent", "mismatch-witness", "incomplete"].reduce((result, outcome) => {
    result[outcome] = pairs.filter((pair) => pair.outcome === outcome).length;
    return result;
  }, {});
}

function buildMarkdown(report) {
  const lines = [
    "# PR-4.5c1 State Abstraction Collision Inventory",
    "",
    `Status: **${report.status}**`,
    "",
    "This is a shadow-only inventory. It reads existing MT1/MT2 JSON artifacts and reuses the PR-4.5b3 bounded runner; it does not modify production DP state keys, dominance, agenda, capacity, or default policy.",
    "",
    `- source artifacts: **${report.summary.sourceArtifactCount}**`,
    `- states scanned: **${report.summary.statesScanned}**`,
    `- collision occurrences: **${report.summary.collisionOccurrenceCount}**`,
    `- unique collision signatures: **${report.summary.uniqueCollisionSignatureCount}**`,
    `- duplicate signature occurrences: **${report.summary.duplicateSignatureOccurrenceCount}**`,
    `- exact-distinct pairs: **${report.summary.exactDistinctPairCount}**`,
    `- selected pair occurrences: **${report.summary.selectedPairOccurrenceCount}**`,
    `- selected unique signatures: **${report.summary.selectedUniqueSignatureCount}**`,
    `- repeated selected signatures: **${report.summary.repeatedSignatureSelectionCount}**`,
    `- pairs skipped by cap: **${report.summary.pairsSkippedByCap}**`,
    `- signature IDs with skipped occurrences: **${report.summary.signatureIdsWithSkippedOccurrences}**`,
    `- unselected unique signatures: **${report.summary.unselectedUniqueSignatureCount}**`,
    `- search: depth **${report.search.depth}**, branch cap **${report.search.branchCap}**, state cap **${report.search.stateCap}**`,
    "",
    "## Sources",
    "",
    "| Source | SHA256 matches manifest | States | Occurrences | Unique signatures | Pair cap |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.sources.map((source) => `| ${source.id} | ${source.sourceSha256MatchesManifest} | ${source.statesScanned} | ${source.collisionOccurrenceCount} | ${source.uniqueCollisionSignatureCount} | ${source.pairCap} |`),
    "",
    "## Selected pair outcomes",
    "",
    "| Pair | Group | Outcome | Risks (true) |",
    "|---|---|---|---|",
    ...report.pairs.map((pair) => {
      const trueRisks = Object.keys(pair.riskLabels).filter((label) => pair.riskLabels[label] === "true").join(", ") || "none";
      return `| ${pair.id} | ${pair.groupId} | ${pair.outcome} | ${trueRisks} |`;
    }),
    "",
    "## Fixed candidate-6/7 control",
    "",
    ...report.fixedControls.map((control) => `- ${control.id}: **${control.outcome}**, expected **${control.expectedOutcome}**, pair **${control.pairId}**`),
    "",
    "## Verdict",
    "",
    `- selected outcome counts: **${JSON.stringify(report.summary.outcomeCounts)}**`,
    `- selected risk-strata denominator: **${report.summary.selectedPairOccurrenceCount}**`,
    `- fixed-control risk-strata denominator: **${report.fixedControls.length}**`,
    `- fixed candidate-6/7 control equivalent: **${report.summary.fixedCandidate67Equivalent}**`,
    `- any incomplete selected pair: **${report.summary.anyIncomplete}**`,
    `- production semantic change: **${report.scope.productionSemanticChange}**`,
    "",
    "An equivalent bounded result is evidence for the selected real-corpus pairs and configured budget only; it is not a global proof of projection safety.",
    "",
    "## Provenance",
    "",
    `- manifest: **${report.provenance.manifest}**`,
    `- generation commit: **${report.provenance.generationCommit}**`,
    `- relation evaluator: **${report.provenance.relationEvaluator}**`,
  ];
  return lines.join("\n") + "\n";
}

function buildReport(options) {
  const config = options || {};
  const manifestPath = path.resolve(config.manifest || DEFAULT_MANIFEST);
  const projectRoot = path.resolve(config.projectRoot || path.resolve(ROOT, "Only upV2.1", "Only upV2.1"));
  const manifest = readJson(manifestPath);
  if (manifest.schema !== "motapathfinder.pr-4.5c-state-abstraction-mining-sources.v1") {
    throw new Error(`Unsupported PR-4.5c source manifest schema: ${manifest.schema}`);
  }
  const search = {
    depth: Number((manifest.search && manifest.search.depth) ?? 2),
    branchCap: Number((manifest.search && manifest.search.branchCap) ?? 32),
    stateCap: Number((manifest.search && manifest.search.stateCap) ?? 256),
  };
  const project = loadProject(projectRoot);
  const adapter = makeRealAdapter(require("./audit-state-abstraction").makeSimulator(project));
  const sourceResults = [];
  const allGroups = [];
  const allPairs = [];
  const recordsByStateId = new Map();
  let exactDistinctPairCount = 0;
  let pairsSkippedByCap = 0;
  const skippedSignatureIds = new Set();
  for (const source of manifest.sources || []) {
    const artifactPath = resolveWorkspacePath(source.artifact);
    const artifact = readJson(artifactPath);
    const actualSha256 = sha256(artifactPath);
    const extracted = extractSourceRecords(source, artifact);
    extracted.records.forEach((record) => recordsByStateId.set(record.stateId, record));
    const groups = buildCollisionGroups(extracted.records, source.id);
    const sourcePairs = [];
    let sourceSkippedByCap = 0;
    const sourceSkippedSignatureIds = new Set();
    for (const group of groups) {
      allGroups.push({
        id: group.id,
        signatureId: group.signatureId,
        sourceId: source.id,
        scopeKey: group.scopeKey,
        projectionKeyHash: group.projectionKeyHash,
        exactKeyHashes: group.exactKeyHashes,
        exactKeyCount: group.exactKeyCount,
        stateIds: group.stateIds,
        pairCount: group.pairCount,
      });
      exactDistinctPairCount += group.pairCount;
      for (const pair of group.pairs) {
        if (sourcePairs.length >= Number(source.pairCap ?? 0)) {
          sourceSkippedByCap += 1;
          sourceSkippedSignatureIds.add(group.signatureId);
          continue;
        }
        sourcePairs.push(runPair(group, pair, adapter, search));
      }
    }
    pairsSkippedByCap += sourceSkippedByCap;
    sourceSkippedSignatureIds.forEach((signatureId) => skippedSignatureIds.add(signatureId));
    allPairs.push(...sourcePairs);
    sourceResults.push({
      id: source.id,
      artifact: relative(artifactPath),
      sourceSha256: actualSha256,
      declaredSourceSha256: source.sourceSha256 || null,
      sourceSha256MatchesManifest: actualSha256 === source.sourceSha256,
      pairCap: Number(source.pairCap ?? 0),
      collections: (source.collections || []).map((collection) => ({
        id: collection.id,
        path: collection.path,
        checkpointIds: collection.checkpointIds || [],
        stateExtractionMode: `${collection.path}.${collection.statePath || "state"}`,
      })),
      statesScanned: extracted.records.length,
      extractionErrors: extracted.errors,
      collisionOccurrenceCount: groups.length,
      uniqueCollisionSignatureCount: new Set(groups.map((group) => group.signatureId)).size,
      exactDistinctPairCount: groups.reduce((sum, group) => sum + group.pairCount, 0),
      pairsSelected: sourcePairs.length,
      pairsSkippedByCap: sourceSkippedByCap,
    });
  }
  allGroups.sort((left, right) => left.id.localeCompare(right.id));
  allPairs.sort((left, right) => left.id.localeCompare(right.id));
  const fixedControls = [];
  for (const source of manifest.sources || []) {
    const sourceRecords = Array.from(recordsByStateId.values()).filter((record) => record.sourceId === source.id);
    for (const control of source.fixedControls || []) {
      const left = sourceRecords.find((record) => record.collectionId === control.collectionId && record.checkpointId === control.checkpointId && record.candidateId === control.leftCandidateId);
      const right = sourceRecords.find((record) => record.collectionId === control.collectionId && record.checkpointId === control.checkpointId && record.candidateId === control.rightCandidateId);
      if (!left || !right) {
        fixedControls.push({
          id: control.id,
          sourceId: source.id,
          collectionId: control.collectionId,
          checkpointId: control.checkpointId,
          leftCandidateId: control.leftCandidateId,
          rightCandidateId: control.rightCandidateId,
          groupId: null,
          signatureId: null,
          expectedOutcome: control.expectedOutcome,
          outcome: "incomplete",
          incompleteReason: "fixed-control-state-not-found",
          pairId: null,
        });
        continue;
      }
      const group = buildCollisionGroups([left, right], source.id)[0] || {
        id: `occurrence-fixed-${hash(`${source.id}|${left.stateId}|${right.stateId}`)}`,
        signatureId: `signature-fixed-${hash(`${left.projectionKey}|${left.exactKey}|${right.exactKey}`)}`,
      };
      const result = runPair(group, { left, right }, adapter, search);
      fixedControls.push({
        id: control.id,
        sourceId: source.id,
        collectionId: control.collectionId,
        checkpointId: control.checkpointId,
        leftCandidateId: left.candidateId,
        rightCandidateId: right.candidateId,
        groupId: result.groupId,
        signatureId: result.signatureId,
        expectedOutcome: control.expectedOutcome,
        pairId: result.id,
        outcome: result.outcome,
        initialPair: result.initialPair,
        left: result.left,
        right: result.right,
        riskLabels: result.riskLabels,
        depthReached: result.depthReached,
        expandedPairCount: result.expandedPairCount,
        generatedPairCount: result.generatedPairCount,
        budgetExhausted: result.budgetExhausted,
        exhaustedReason: result.exhaustedReason,
        branchCap: result.branchCap,
        stateCap: result.stateCap,
        multiSuccessorActionCount: result.multiSuccessorActionCount,
        maxSuccessorsPerAction: result.maxSuccessorsPerAction,
        generatedCrossProductPairCount: result.generatedCrossProductPairCount,
        exactRejoinObserved: result.exactRejoinObserved,
        executionErrors: result.executionErrors,
        incompleteReason: result.incompleteReason,
        witness: result.witness,
      });
    }
  }
  const outcomeSummary = outcomeCounts(allPairs);
  const selectedPairRiskStrata = buildRiskStrata(allPairs);
  const fixedControlRiskStrata = buildRiskStrata(fixedControls.filter((control) => control.riskLabels));
  const allEvaluatedRiskStrata = buildRiskStrata(allPairs.concat(fixedControls.filter((control) => control.riskLabels)));
  const uniqueCollisionSignatureIds = new Set(allGroups.map((group) => group.signatureId));
  const selectedSignatureIds = new Set(allPairs.map((pair) => pair.signatureId));
  const allComplete = allPairs.every((pair) => pair.outcome !== "incomplete") &&
    fixedControls.every((control) => control.outcome !== "incomplete") &&
    sourceResults.every((source) => source.sourceSha256MatchesManifest && source.extractionErrors.length === 0);
  return {
    schema: "motapathfinder.pr-4.5c1-state-abstraction-collision-inventory.v1",
    generatedAt: new Date().toISOString(),
    status: allComplete ? "completed" : "completed-with-evidence-gaps",
    scope: {
      shadowOnly: true,
      productionSemanticChange: false,
      productionChanges: [],
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultStrategyChanged: false,
    },
    search,
    sources: sourceResults,
    collisionGroups: allGroups,
    pairs: allPairs,
    fixedControls,
    selectedPairRiskStrata,
    fixedControlRiskStrata,
    allEvaluatedRiskStrata,
    summary: {
      sourceArtifactCount: sourceResults.length,
      statesScanned: sourceResults.reduce((sum, source) => sum + source.statesScanned, 0),
      collisionOccurrenceCount: allGroups.length,
      uniqueCollisionSignatureCount: uniqueCollisionSignatureIds.size,
      duplicateSignatureOccurrenceCount: allGroups.length - uniqueCollisionSignatureIds.size,
      exactDistinctPairCount,
      selectedPairOccurrenceCount: allPairs.length,
      selectedUniqueSignatureCount: selectedSignatureIds.size,
      repeatedSignatureSelectionCount: allPairs.length - selectedSignatureIds.size,
      signatureIdsWithSkippedOccurrences: skippedSignatureIds.size,
      unselectedUniqueSignatureCount: uniqueCollisionSignatureIds.size - selectedSignatureIds.size,
      uniqueSignaturesSkippedByCap: skippedSignatureIds.size,
      pairsSelected: allPairs.length,
      pairsSkippedByCap,
      outcomeCounts: outcomeSummary,
      equivalentCount: outcomeSummary.equivalent,
      mismatchWitnessCount: outcomeSummary["mismatch-witness"],
      incompleteCount: outcomeSummary.incomplete,
      fixedCandidate67Equivalent: fixedControls.some((control) => control.id === "candidate-6-7-local-control" && control.outcome === "equivalent"),
      anyIncomplete: !allComplete,
    },
    provenance: {
      manifest: relative(manifestPath),
      manifestSha256: sha256(manifestPath),
      projectRoot: relative(projectRoot),
      generationCommit: gitCommit(),
      relationEvaluator: "bounded-abstraction-counterexample-search.runPairedExpansion",
      productionStateKeyModule: "shared-solver/lib/state-key.js",
      productionStateKeySha256: sha256(path.resolve(__dirname, "lib", "state-key.js")),
      stateExtractionModes: sourceResults.flatMap((source) => source.collections),
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport({
    manifest: args.manifest,
    projectRoot: args["project-root"],
  });
  const out = path.resolve(args.out || DEFAULT_OUT);
  const outMd = path.resolve(args["out-md"] || DEFAULT_OUT_MD);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(outMd, buildMarkdown(report));
  console.log(JSON.stringify({
    status: report.status,
    out: relative(out),
    outMd: relative(outMd),
    statesScanned: report.summary.statesScanned,
    collisionOccurrenceCount: report.summary.collisionOccurrenceCount,
    pairsSelected: report.summary.pairsSelected,
    pairsSkippedByCap: report.summary.pairsSkippedByCap,
    outcomeCounts: report.summary.outcomeCounts,
    fixedCandidate67Equivalent: report.summary.fixedCandidate67Equivalent,
    anyIncomplete: report.summary.anyIncomplete,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildMarkdown,
  buildReport,
  buildCollisionGroups,
  buildRiskLabels,
  extractSourceRecords,
};
