"use strict";

/**
 * PR-4.5b — Bounded Abstraction Counterexample Search
 *
 * This runner is deliberately shadow-only. It reads a manifest-driven corpus,
 * performs bounded paired expansion from projection collisions, and records a
 * shortest action-labelled mismatch witness when one is found. It does not
 * change the production DP key, dominance, agenda, capacity, or strategy.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  actionSignature,
  applyActionSuccessors,
  displayAction,
  enumeratePrimitiveActions,
  makeSimulator,
  replayDecisionWindow,
  safeStateKey,
  shadowProjectionKey,
} = require("./audit-state-abstraction");
const { loadProject } = require("./lib/project-loader");
const { buildStateKey } = require("./lib/state-key");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST = path.resolve(__dirname, "profiles", "state-abstraction-corpus.json");
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5b-bounded-abstraction-counterexample-search.json",
);
const DEFAULT_OUT_MD = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5b-bounded-abstraction-counterexample-search.md",
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
  return path.resolve(ROOT, file);
}

function makeRealAdapter(simulator) {
  return {
    enumerate(state) {
      return enumeratePrimitiveActions(simulator, state);
    },
    apply(state, action) {
      return applyActionSuccessors(simulator, state, action);
    },
    actionId(action) {
      return actionSignature(simulator, action);
    },
    displayAction,
    exactKey: safeStateKey,
    projectionKey: shadowProjectionKey,
  };
}

function buildActionTable(adapter, state) {
  const enumeration = adapter.enumerate(state) || { actions: [], errors: [] };
  const byId = new Map();
  const actionErrors = [];
  for (const action of (enumeration.actions || []).filter(Boolean)) {
    const id = adapter.actionId(action);
    if (byId.has(id)) continue;
    const applied = adapter.apply(state, action) || { successors: [], errors: [] };
    const successors = (applied.successors || []).filter(Boolean).map((successor) => ({
      state: successor,
      exactKey: adapter.exactKey(successor),
      projectedKey: adapter.projectionKey(successor),
    }));
    if ((applied.errors || []).length > 0) {
      actionErrors.push({
        id,
        action: adapter.displayAction(action),
        errors: applied.errors,
      });
    }
    byId.set(id, {
      id,
      action: adapter.displayAction(action),
      exactSuccessors: successors.map((entry) => entry.exactKey).filter(Boolean).sort(),
      projectedSuccessors: successors.map((entry) => entry.projectedKey).sort(),
      successors,
    });
  }
  const actions = Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
  return {
    actions,
    enumerationErrors: enumeration.errors || [],
    actionErrors,
    noEnumerationErrors: (enumeration.errors || []).length === 0,
    noActionApplicationErrors: actionErrors.length === 0,
  };
}

function comparePairedActionTables(left, right) {
  const leftMap = new Map(left.actions.map((entry) => [entry.id, entry]));
  const rightMap = new Map(right.actions.map((entry) => [entry.id, entry]));
  const leftOnly = Array.from(leftMap.keys()).filter((id) => !rightMap.has(id)).sort();
  const rightOnly = Array.from(rightMap.keys()).filter((id) => !leftMap.has(id)).sort();
  const common = Array.from(leftMap.keys()).filter((id) => rightMap.has(id)).sort();
  const successorMismatches = [];
  common.forEach((id) => {
    const leftAction = leftMap.get(id);
    const rightAction = rightMap.get(id);
    const exactEqual = canonicalJson(leftAction.exactSuccessors) === canonicalJson(rightAction.exactSuccessors);
    const projectedEqual = canonicalJson(leftAction.projectedSuccessors) === canonicalJson(rightAction.projectedSuccessors);
    if (!exactEqual || !projectedEqual) {
      successorMismatches.push({
        id,
        exactEqual,
        projectedEqual,
        leftExactSuccessors: leftAction.exactSuccessors,
        rightExactSuccessors: rightAction.exactSuccessors,
        leftProjectedSuccessors: leftAction.projectedSuccessors,
        rightProjectedSuccessors: rightAction.projectedSuccessors,
      });
    }
  });
  const actionSetEquivalent = leftOnly.length === 0 && rightOnly.length === 0;
  const noEnumerationErrors = left.noEnumerationErrors && right.noEnumerationErrors;
  const noActionApplicationErrors = left.noActionApplicationErrors && right.noActionApplicationErrors;
  return {
    actionSetEquivalent,
    leftOnlyActions: leftOnly,
    rightOnlyActions: rightOnly,
    commonActionCount: common.length,
    successorMismatches,
    successorMismatchCount: successorMismatches.length,
    noEnumerationErrors,
    noActionApplicationErrors,
    projectedSuccessorRelationEquivalent: actionSetEquivalent &&
      successorMismatches.every((entry) => entry.projectedEqual) &&
      noEnumerationErrors &&
      noActionApplicationErrors,
    exactSuccessorRelationEquivalent: actionSetEquivalent &&
      successorMismatches.every((entry) => entry.exactEqual) &&
      noEnumerationErrors &&
      noActionApplicationErrors,
  };
}

function sortSuccessors(entries) {
  return entries.slice().sort((left, right) => {
    const leftKey = `${left.projectedKey}|${left.exactKey}`;
    const rightKey = `${right.projectedKey}|${right.exactKey}`;
    return leftKey.localeCompare(rightKey);
  });
}

function pairSuccessors(leftAction, rightAction) {
  const rightByProjection = new Map();
  sortSuccessors(rightAction.successors).forEach((entry) => {
    if (!rightByProjection.has(entry.projectedKey)) rightByProjection.set(entry.projectedKey, []);
    rightByProjection.get(entry.projectedKey).push(entry);
  });
  const pairs = [];
  for (const leftEntry of sortSuccessors(leftAction.successors)) {
    const matches = rightByProjection.get(leftEntry.projectedKey) || [];
    const rightEntry = matches.shift();
    if (!rightEntry) continue;
    pairs.push({ left: leftEntry.state, right: rightEntry.state });
  }
  return pairs;
}

function initialPairEvidence(adapter, left, right) {
  const leftExactKey = adapter.exactKey(left);
  const rightExactKey = adapter.exactKey(right);
  const leftProjectionKey = adapter.projectionKey(left);
  const rightProjectionKey = adapter.projectionKey(right);
  return {
    exactKeyHashes: {
      left: hash(leftExactKey),
      right: hash(rightExactKey),
    },
    projectionKeyHashes: {
      left: hash(leftProjectionKey),
      right: hash(rightProjectionKey),
    },
    projectionEqual: leftProjectionKey === rightProjectionKey,
  };
}

function buildMismatchWitness(root, node, comparison) {
  const actionSetMismatch = !comparison.actionSetEquivalent;
  const firstSuccessorMismatch = comparison.successorMismatches[0] || null;
  return {
    rootId: root.id || null,
    rootDecision: root.decision == null ? null : root.decision,
    initialPair: root.initialPair,
    sharedActionSequence: node.sequence,
    firstUnmatched: {
      depth: node.depth,
      kind: actionSetMismatch ? "action-set-mismatch" : "projected-successor-relation-mismatch",
      actionId: actionSetMismatch
        ? (comparison.leftOnlyActions[0] || comparison.rightOnlyActions[0] || null)
        : firstSuccessorMismatch && firstSuccessorMismatch.id,
      leftOnlyActions: comparison.leftOnlyActions.slice(0, 20),
      rightOnlyActions: comparison.rightOnlyActions.slice(0, 20),
      successorMismatch: firstSuccessorMismatch,
    },
  };
}

function runPairedExpansion(root, adapter, options) {
  const config = {
    depth: Math.max(0, Number(options && options.depth || 2)),
    branchCap: Math.max(1, Number(options && options.branchCap || 32)),
    stateCap: Math.max(1, Number(options && options.stateCap || 256)),
  };
  const initialPair = root.initialPair || initialPairEvidence(adapter, root.left, root.right);
  if (!initialPair.projectionEqual) {
    return {
      outcome: "mismatch-witness",
      depth: 0,
      depthReached: 0,
      expandedPairCount: 0,
      generatedPairCount: 1,
      budgetExhausted: false,
      branchCap: config.branchCap,
      stateCap: config.stateCap,
      witness: {
        initialPair,
        sharedActionSequence: [],
        firstUnmatched: {
          depth: 0,
          kind: "initial-projection-mismatch",
          actionId: null,
          leftOnlyActions: [],
          rightOnlyActions: [],
          successorMismatch: null,
        },
      },
    };
  }

  const queue = [{ left: root.left, right: root.right, depth: 0, sequence: [] }];
  const levels = [];
  let expandedPairCount = 0;
  let generatedPairCount = 1;
  let depthReached = 0;
  let budgetExhausted = false;
  while (queue.length > 0) {
    const node = queue.shift();
    depthReached = Math.max(depthReached, node.depth);
    if (node.depth >= config.depth) continue;
    if (expandedPairCount >= config.stateCap) {
      budgetExhausted = true;
      break;
    }
    const leftTable = buildActionTable(adapter, node.left);
    const rightTable = buildActionTable(adapter, node.right);
    if (leftTable.actions.length > config.branchCap || rightTable.actions.length > config.branchCap) {
      budgetExhausted = true;
      break;
    }
    const comparison = comparePairedActionTables(leftTable, rightTable);
    expandedPairCount += 1;
    const level = levels.find((entry) => entry.depth === node.depth);
    if (level) level.expandedPairCount += 1;
    else levels.push({ depth: node.depth, expandedPairCount: 1 });
    if (!comparison.projectedSuccessorRelationEquivalent) {
      return {
        outcome: "mismatch-witness",
        depth: config.depth,
        depthReached,
        expandedPairCount,
        generatedPairCount,
        budgetExhausted: false,
        branchCap: config.branchCap,
        stateCap: config.stateCap,
        levels,
        witness: buildMismatchWitness(root, node, comparison),
      };
    }
    const leftMap = new Map(leftTable.actions.map((entry) => [entry.id, entry]));
    const rightMap = new Map(rightTable.actions.map((entry) => [entry.id, entry]));
    const commonIds = Array.from(leftMap.keys()).filter((id) => rightMap.has(id)).sort();
    for (const id of commonIds) {
      const pairs = pairSuccessors(leftMap.get(id), rightMap.get(id));
      for (const pair of pairs) {
        if (generatedPairCount >= config.stateCap) {
          budgetExhausted = true;
          break;
        }
        queue.push({
          left: pair.left,
          right: pair.right,
          depth: node.depth + 1,
          sequence: node.sequence.concat({
            id,
            action: leftMap.get(id).action,
          }),
        });
        generatedPairCount += 1;
      }
      if (budgetExhausted) break;
    }
    if (budgetExhausted) break;
  }
  if (budgetExhausted || queue.length > 0) {
    return {
      outcome: "incomplete",
      depth: config.depth,
      depthReached,
      expandedPairCount,
      generatedPairCount,
      budgetExhausted: true,
      branchCap: config.branchCap,
      stateCap: config.stateCap,
      levels,
      witness: null,
    };
  }
  return {
    outcome: "equivalent",
    depth: config.depth,
    depthReached,
    expandedPairCount,
    generatedPairCount,
    budgetExhausted: false,
    branchCap: config.branchCap,
    stateCap: config.stateCap,
    levels,
    witness: null,
  };
}

function getCheckpoint(report, segmentId) {
  return report && report.candidate2NaturalRun && report.candidate2NaturalRun.search &&
    (report.candidate2NaturalRun.search.checkpointResults || []).find((entry) => entry.segmentId === segmentId) || null;
}

function getCandidateFromCheckpoint(checkpoint, candidateId) {
  return checkpoint && (checkpoint.candidates || []).find((candidate) => candidate.id === candidateId) || null;
}

function buildPositiveRoots(spec, simulator) {
  const sourceReportPath = resolveWorkspacePath(spec.sourceReport);
  const ancestryReportPath = resolveWorkspacePath(spec.ancestryReport);
  const sourceReport = readJson(sourceReportPath);
  const ancestryReport = readJson(ancestryReportPath);
  const candidateCheckpoint = getCheckpoint(sourceReport, spec.candidateCheckpoint);
  const routeCheckpoint = getCheckpoint(sourceReport, spec.routeCheckpoint);
  const leftCandidate = getCandidateFromCheckpoint(candidateCheckpoint, spec.leftCandidateId);
  const rightCandidate = getCandidateFromCheckpoint(candidateCheckpoint, spec.rightCandidateId);
  const routeCandidate = routeCheckpoint && routeCheckpoint.candidates && routeCheckpoint.candidates[0];
  if (!leftCandidate || !rightCandidate || !routeCandidate) {
    throw new Error(`PR-4.5b manifest entry ${spec.id} could not resolve both candidates and route candidate`);
  }
  const sequences = {
    left: replayDecisionWindow(simulator, leftCandidate, routeCandidate.route || [], spec.startDecision, spec.endDecision, spec.routeDecisionOffset),
    right: replayDecisionWindow(simulator, rightCandidate, routeCandidate.route || [], spec.startDecision, spec.endDecision, spec.routeDecisionOffset),
  };
  const replayErrors = sequences.left.errors.concat(sequences.right.errors);
  const roots = [];
  for (let decision = spec.startDecision; decision <= spec.endDecision; decision += 1) {
    const left = sequences.left.states.get(decision);
    const right = sequences.right.states.get(decision);
    if (!left || !right) continue;
    const initialPair = initialPairEvidence(makeRealAdapter(simulator), left, right);
    if (!initialPair.projectionEqual) continue;
    roots.push({
      id: `${spec.id}@decision-${decision}`,
      decision,
      left,
      right,
      initialPair,
    });
  }
  const ancestryComparison = ancestryReport.ancestryComparison || {};
  const candidateExactKeysMatchArtifact = Boolean(
    ancestryComparison.winningBranch &&
    ancestryComparison.teacherLocalBranch &&
    safeStateKey(leftCandidate.state) === ancestryComparison.winningBranch.winningLocalExactStateKey &&
    safeStateKey(rightCandidate.state) === ancestryComparison.teacherLocalBranch.teacherLocalExactStateKey,
  );
  return {
    sourceReportPath,
    ancestryReportPath,
    replayErrors,
    candidateExactKeysMatchArtifact,
    leftActionCount: sequences.left.actions.length,
    rightActionCount: sequences.right.actions.length,
    expectedDecisionCount: spec.endDecision - spec.startDecision + 1,
    roots,
  };
}

function makeSyntheticNegativeControl() {
  const left = {
    floorId: "MT2",
    hero: { x: 6, y: 0 },
    mutations: [{ floorId: "MT1", removed: ["historical-gate"] }],
  };
  const right = {
    floorId: "MT2",
    hero: { x: 6, y: 0 },
    mutations: [{ floorId: "MT1", removed: [] }],
  };
  const adapter = {
    enumerate(state) {
      if (state.floorId === "MT2") return { actions: [{ id: "reenter-MT1" }], errors: [] };
      const actions = [{ id: "leave-MT2" }];
      const mutation = (state.mutations || []).find((entry) => entry.floorId === "MT1");
      if (!(mutation && mutation.removed || []).includes("historical-gate")) {
        actions.push({ id: "historical-tile@MT1" });
      }
      return { actions, errors: [] };
    },
    apply(state, action) {
      if (action.id === "reenter-MT1") return { successors: [{ ...state, floorId: "MT1" }], errors: [] };
      if (action.id === "leave-MT2") return { successors: [{ ...state, floorId: "MT2" }], errors: [] };
      return { successors: [{ ...state }], errors: [] };
    },
    actionId(action) {
      return action.id;
    },
    displayAction(action) {
      return { id: action.id };
    },
    exactKey(state) {
      return canonicalJson(state);
    },
    projectionKey(state) {
      // Deliberately unsafe negative-control projection: all mutation history
      // is omitted, including after the pair re-enters MT1.
      return canonicalJson({ floorId: state.floorId, hero: state.hero });
    },
  };
  return {
    adapter,
    root: {
      id: "synthetic-reentry-hidden-mutation-v1",
      decision: 0,
      left,
      right,
      initialPair: initialPairEvidence(adapter, left, right),
    },
  };
}

function outcomeOf(results) {
  if (results.some((result) => result.outcome === "incomplete")) return "incomplete";
  if (results.some((result) => result.outcome === "mismatch-witness")) return "mismatch-witness";
  return "equivalent";
}

function buildMarkdown(report) {
  const lines = [
    "# PR-4.5b Bounded Abstraction Counterexample Search",
    "",
    `Status: **${report.status}**`,
    `Positive corpus outcome: **${report.positiveCorpus.outcome}**`,
    `Negative control outcome: **${report.negativeControls.outcome}**`,
    "",
    "## Scope",
    "",
    "This artifact is shadow-only. It does not modify the production DP key, dominance, agenda, capacity, or default strategy.",
    "",
    `- manifest: **${report.provenance.manifest}**`,
    `- bounded depth: **${report.search.depth}**`,
    `- branch cap: **${report.search.branchCap}**`,
    `- state cap: **${report.search.stateCap}**`,
    "",
    "## Positive corpus",
    "",
    "| Corpus | Fixed positive | Roots | Outcome | Incomplete roots |",
    "|---|---:|---:|---|---:|",
    ...report.positiveCorpus.entries.map((entry) => `| ${entry.id} | ${entry.fixedPositive} | ${entry.rootCount} | ${entry.outcome} | ${entry.incompleteRootCount} |`),
    "",
  ];
  report.positiveCorpus.entries.forEach((entry) => {
    lines.push(`### ${entry.id}`, "", `- replay errors: **${entry.replayErrors.length}**`, `- candidate keys match ancestry artifact: **${entry.candidateExactKeysMatchArtifact}**`);
    entry.roots.forEach((root) => {
      lines.push(`- ${root.id}: **${root.outcome}**, expanded pairs **${root.expandedPairCount}**, generated pairs **${root.generatedPairCount}**`);
    });
    lines.push("");
  });
  lines.push(
    "## Negative controls",
    "",
    "| Control | Outcome | Depth | Witness sequence | First unmatched |",
    "|---|---|---:|---|---|",
    ...report.negativeControls.entries.map((entry) => {
      const witness = entry.witness;
      const sequence = witness ? witness.sharedActionSequence.map((action) => action.id).join(" → ") : "n/a";
      const unmatched = witness && witness.firstUnmatched ? witness.firstUnmatched.actionId : "n/a";
      return `| ${entry.id} | ${entry.outcome} | ${entry.depthReached} | ${sequence} | ${unmatched} |`;
    }),
    "",
    "The negative control intentionally omits all mutation history from its projection. The witness confirms that a shared re-entry action can expose a hidden-history action-set mismatch.",
    "",
    "## Verdict",
    "",
    `- positive candidate-6/7 corpus: **${report.positiveCorpus.outcome}**`,
    `- negative control: **${report.negativeControls.outcome}**`,
    `- any budget-incomplete run: **${report.summary.anyIncomplete}**`,
    `- production semantic change: **${report.scope.productionSemanticChange}**`,
    "",
    "A bounded equivalent result is evidence for this manifest, depth, and budget only; it is not a proof that the projection is safe globally.",
    "",
    "## Provenance",
    "",
    "- generation commit: `" + report.provenance.generationCommit + "`",
    "- production state-key SHA256: `" + report.provenance.productionStateKeySha256 + "`",
  );
  return lines.join("\n") + "\n";
}

function buildReport(options) {
  const config = options || {};
  const manifestPath = path.resolve(config.manifest || DEFAULT_MANIFEST);
  const projectRoot = path.resolve(config.projectRoot || path.resolve(ROOT, "Only upV2.1", "Only upV2.1"));
  const manifest = readJson(manifestPath);
  if (manifest.schema !== "motapathfinder.pr-4.5b-state-abstraction-corpus.v1") {
    throw new Error(`Unsupported PR-4.5b corpus manifest schema: ${manifest.schema}`);
  }
  const search = {
    depth: Number(manifest.search && manifest.search.depth || 2),
    branchCap: Number(manifest.search && manifest.search.branchCap || 32),
    stateCap: Number(manifest.search && manifest.search.stateCap || 256),
  };
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const realAdapter = makeRealAdapter(simulator);
  const positiveEntries = [];
  for (const spec of manifest.positiveCorpus || []) {
    const roots = buildPositiveRoots(spec, simulator);
    const rootResults = roots.roots.map((root) => ({
      ...root,
      ...runPairedExpansion(root, realAdapter, search),
    }));
    positiveEntries.push({
      id: spec.id,
      fixedPositive: spec.fixedPositive === true,
      sourceReport: relative(roots.sourceReportPath),
      ancestryReport: relative(roots.ancestryReportPath),
      sourceReportSha256: sha256(roots.sourceReportPath),
      ancestryReportSha256: sha256(roots.ancestryReportPath),
      startDecision: spec.startDecision,
      endDecision: spec.endDecision,
      replayErrors: roots.replayErrors,
      candidateExactKeysMatchArtifact: roots.candidateExactKeysMatchArtifact,
      expectedDecisionCount: roots.expectedDecisionCount,
      rootCount: rootResults.length,
      incompleteRootCount: rootResults.filter((root) => root.outcome === "incomplete").length,
      outcome: outcomeOf(rootResults),
      roots: rootResults.map((root) => ({
        id: root.id,
        decision: root.decision,
        initialPair: root.initialPair,
        outcome: root.outcome,
        depth: root.depth,
        depthReached: root.depthReached,
        expandedPairCount: root.expandedPairCount,
        generatedPairCount: root.generatedPairCount,
        budgetExhausted: root.budgetExhausted,
        branchCap: root.branchCap,
        stateCap: root.stateCap,
        levels: root.levels,
        witness: root.witness,
      })),
    });
  }
  const negativeEntries = [];
  for (const spec of manifest.negativeControls || []) {
    if (spec.type !== "synthetic-reentry-hidden-mutation") {
      negativeEntries.push({ id: spec.id, outcome: "incomplete", reason: `unsupported control type: ${spec.type}` });
      continue;
    }
    const control = makeSyntheticNegativeControl();
    const result = runPairedExpansion(control.root, control.adapter, search);
    negativeEntries.push({
      id: spec.id,
      type: spec.type,
      expectedOutcome: spec.expectedOutcome,
      description: spec.description,
      ...result,
    });
  }
  const positiveOutcome = outcomeOf(positiveEntries);
  const negativeOutcome = outcomeOf(negativeEntries);
  const allComplete = positiveOutcome !== "incomplete" && negativeOutcome !== "incomplete";
  return {
    schema: "motapathfinder.pr-4.5b-bounded-abstraction-counterexample-search.v1",
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
    positiveCorpus: {
      outcome: positiveOutcome,
      expectedOutcome: "equivalent",
      entries: positiveEntries,
    },
    negativeControls: {
      outcome: negativeOutcome,
      expectedOutcome: "mismatch-witness",
      entries: negativeEntries,
    },
    summary: {
      positiveCorpusEquivalent: positiveOutcome === "equivalent",
      negativeControlFoundWitness: negativeEntries.some((entry) => entry.outcome === "mismatch-witness"),
      anyIncomplete: !allComplete,
    },
    provenance: {
      manifest: relative(manifestPath),
      manifestSha256: sha256(manifestPath),
      projectRoot: relative(projectRoot),
      generationCommit: gitCommit(),
      productionStateKeyModule: "shared-solver/lib/state-key.js",
      productionStateKeySha256: sha256(path.resolve(__dirname, "lib", "state-key.js")),
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
    positiveCorpus: report.positiveCorpus.outcome,
    negativeControls: report.negativeControls.outcome,
    anyIncomplete: report.summary.anyIncomplete,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildMarkdown,
  buildReport,
  buildActionTable,
  comparePairedActionTables,
  makeSyntheticNegativeControl,
  runPairedExpansion,
};
