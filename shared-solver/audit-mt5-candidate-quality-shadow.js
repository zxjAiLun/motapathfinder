"use strict";

/**
 * PR-5.7a research-only MT5 first-sweep candidate quality shadow.
 *
 * The audit replays the tracked MT3 fixture, captures every observable raw
 * goal/archive and milestone-frontier candidate at mt5-first-sweep, simulates
 * retention capacities 1/2/4/8 with the unchanged selector, and gives every
 * candidate the same bounded mt5-third-gate probe.  A miss remains
 * INCOMPLETE_WITHIN_BUDGET and never proves that no route exists.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const {
  buildRetentionMatrix,
  candidateIdentity,
  classifyQualityEvidence,
  cloneCandidate,
  createCandidateQualityCollector,
  summarizeCandidate,
} = require("./lib/candidate-quality-shadow");
const { compileGoalDependencyGraph } = require("./lib/goal-dependency-graph");
const { buildCandidateDpKey } = require("./lib/key-dependency-corpus");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const {
  runMilestoneGraph,
  searchSegmentDP,
  __testHooks,
} = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");
const { compileTowerIR } = require("./lib/tower-ir");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const ROUTE_NAME = "onlyup-chaos-mt5-blueking";
const FIXTURE_FILE = path.join(
  __dirname,
  "routes",
  "fixtures",
  "mt1-mt3-i893-hp8425.route.json",
);
const SOURCE_SEGMENT_ID = "mt5-first-sweep";
const DOWNSTREAM_SEGMENT_ID = "mt5-third-gate";
const RESEARCH_PROFILE = "without-start-component";

function parseArgs(argv) {
  const result = {};
  for (const arg of argv || []) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function optionalNumber(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`expected finite number, got ${value}`);
  return parsed;
}

function makeSimulator(project, walkReachabilityMode) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
    walkReachabilityMode,
  });
}

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || [])
    .find((action) => action.summary === summary) ||
    simulator.enumerateActions(state).find((action) => action.summary === summary) ||
    null;
}

function replayFixture(simulator) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of readRouteFile(FIXTURE_FILE).decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    assert.ok(action, `fixture replay missing action ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function createResearchKeyBuilder(project, simulator) {
  const regionSpec = {
    id: "research-candidate-quality-mt5",
    scope: { floors: ["MT3", "MT4", "MT5"] },
    start: { type: "checkpoint-fixture" },
    goal: { type: "milestone", id: DOWNSTREAM_SEGMENT_ID },
    actionPolicy: { mode: "milestone-spec-authoritative" },
  };
  const ir = compileTowerIR(project, regionSpec, {
    towerId: "candidate-quality-mt5",
  });
  return (state) => buildCandidateDpKey(simulator, project, ir, state, {
    profile: RESEARCH_PROFILE,
  });
}

function auditRecordCandidate(record, id, reason) {
  if (!record || !record.state) return null;
  return {
    id,
    state: record.state,
    route: Array.isArray(record.state.route) ? record.state.route.slice() : [],
    trace: [],
    tags: Array.isArray(record.skylineRoles) ? record.skylineRoles.slice() : [],
    rawArchiveReason: reason,
  };
}

function rawArchiveCandidates(audits) {
  const candidates = [];
  for (const [auditIndex, audit] of (audits || []).entries()) {
    const decisionByExactKey = new Map((audit.targetRecords || []).map((record) => [
      record.exactStateKey,
      record.archiveDecision,
    ]));
    for (const [index, record] of (audit.acceptedCandidates || []).entries()) {
      const candidate = auditRecordCandidate(
        record,
        `raw-a${auditIndex}-accepted-${index}`,
        decisionByExactKey.get(record.exactStateKey) || "accepted",
      );
      if (candidate) candidates.push(candidate);
    }
    for (const [index, event] of (audit.events || []).entries()) {
      if (event.eventType !== "goal-candidate-rejected" || !event.candidate) continue;
      const candidate = auditRecordCandidate(
        event.candidate,
        `raw-a${auditIndex}-rejected-${index}`,
        event.reasonCode || "raw-goal-rejected",
      );
      if (candidate) candidates.push(candidate);
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const identity = candidateIdentity(candidate);
    if (!unique.has(identity)) unique.set(identity, candidate);
  }
  return Array.from(unique.values());
}

function statDeficits(state, goal) {
  const hero = (state && state.hero) || {};
  const flags = (state && state.flags) || {};
  const effective = (field) => Math.floor(
    Number(hero[field] || 0) * Number(flags[`__${field}_buff__`] || 1),
  );
  const result = {};
  for (const [field, target] of Object.entries((goal || {}).minHero || {})) {
    result[field] = Math.max(0, Number(target) - Number(hero[field] || 0));
  }
  for (const [field, target] of Object.entries((goal || {}).minEffectiveHero || {})) {
    result[`effective.${field}`] = Math.max(0, Number(target) - effective(field));
  }
  return result;
}

function runDownstreamProbe(project, milestoneSegments, candidate, options) {
  const config = options || {};
  const simulator = makeSimulator(project, config.walkReachabilityMode);
  const downstreamSegment = milestoneSegments.find((segment) => segment.id === DOWNSTREAM_SEGMENT_ID);
  const dpStateKeyBuilder = config.keySide === "B"
    ? createResearchKeyBuilder(project, simulator)
    : null;
  const result = searchSegmentDP(simulator, candidate.state, downstreamSegment, {
    candidateId: candidate.id,
    prefixRoute: candidate.route,
    candidateLimit: 8,
    preserveSkylineRoles: true,
    goalDependencySegments: milestoneSegments,
    dpStateKeyBuilder,
    dpOverrides: {
      maxExpansions: config.maxExpansions,
      maxRuntimeMs: 0,
      stopOnFirstGoal: true,
      priorityMode: "goal-directed",
      goalSkylineLimit: 8,
    },
  });
  const dp = result.diagnostics && result.diagnostics.dp || {};
  const failure = result.diagnostics && result.diagnostics.failure || null;
  const bestState = result.bestProgress || result.bestSeen || candidate.state;
  return {
    candidateId: candidate.id,
    reached: result.found === true,
    budgetExhausted: dp.expansionBudgetExhausted === true ||
      dp.stoppedReason === "time-limit" ||
      dp.stoppedReason === "heap-limit" ||
      dp.stoppedReason === "rss-limit",
    bestProgress: {
      floorId: bestState && bestState.floorId || null,
      hero: bestState && bestState.hero ? {
        hp: Number(bestState.hero.hp || 0),
        atk: Number(bestState.hero.atk || 0),
        def: Number(bestState.hero.def || 0),
        mdef: Number(bestState.hero.mdef || 0),
        exp: Number(bestState.hero.exp || 0),
      } : null,
      statDeficits: statDeficits(bestState, downstreamSegment.goal),
    },
    failureClass: result.found ? null : failure && failure.failureClass || "incomplete",
    stoppedReason: dp.stoppedReason || null,
    expansions: Number(dp.expansions || 0),
    frontierSize: Number(dp.frontierSize || 0),
    actionTrimmed: Number(result.diagnostics && result.diagnostics.actionTrimmed || 0),
    strictReplayRequiredIfPromotedToWitness: result.found === true,
  };
}

function mergeCandidateCorpora(frontierCandidates, rawCandidates) {
  const result = [];
  const seen = new Set();
  for (const candidate of (frontierCandidates || []).concat(rawCandidates || [])) {
    const identity = candidateIdentity(candidate);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(cloneCandidate(candidate, `candidate-${result.length}`));
  }
  return result;
}

function runAudit(args) {
  const project = loadProject(PROJECT_ROOT);
  const milestoneSpec = getMilestoneSpec(project, ROUTE_NAME);
  const sourceSegment = milestoneSpec.milestones.find((segment) => segment.id === SOURCE_SEGMENT_ID);
  const downstreamSegment = milestoneSpec.milestones.find((segment) => segment.id === DOWNSTREAM_SEGMENT_ID);
  assert.ok(sourceSegment && downstreamSegment, "candidate quality source/downstream milestones must exist");
  const sourceIndex = milestoneSpec.milestones.findIndex((segment) => segment.id === SOURCE_SEGMENT_ID);
  const dependencySegments = milestoneSpec.milestones.slice(sourceIndex);
  const goalDependencyGraph = compileGoalDependencyGraph(project, dependencySegments);
  const keySide = String(args["key-side"] || "B").toUpperCase();
  assert.ok(keySide === "A" || keySide === "B", "--key-side must be A or B");
  const sourceMaxExpansions = optionalNumber(args["source-max-expansions"], 500);
  const probeMaxExpansions = optionalNumber(args["probe-max-expansions"], 100);
  const candidateLimit = optionalNumber(args["candidate-limit"], 8);
  const walkReachabilityMode = args["walk-mode"] || "safe-fast";

  const simulator = makeSimulator(project, walkReachabilityMode);
  const initialState = replayFixture(simulator);
  const collector = createCandidateQualityCollector({
    sourceSegmentId: SOURCE_SEGMENT_ID,
  });
  const sourceResult = runMilestoneGraph(simulator, initialState, milestoneSpec, {
    fromMilestoneId: "mt3-i893-hp8425",
    toMilestoneId: SOURCE_SEGMENT_ID,
    candidateLimit,
    goalSkylineLimit: candidateLimit,
    maxExpansions: sourceMaxExpansions,
    maxRuntimeMs: 0,
    stopOnFirstGoal: false,
    preserveSkylineRoles: true,
    dpPriorityMode: "goal-directed",
    dpStateKeyBuilder: keySide === "B"
      ? createResearchKeyBuilder(project, simulator)
      : null,
    goalArchiveAudit: {
      captureAllGoalCandidates: true,
      maxCandidates: 256,
      maxEvents: 512,
      role: "mt5-first-sweep-candidate-quality-shadow",
    },
    pipelineObserver: collector.pipelineObserver,
  });
  const captured = collector.snapshot();
  const merge = captured.merges[captured.merges.length - 1] || null;
  const frontierCandidates = merge ? merge.nextCandidates : [];
  const rawCandidates = rawArchiveCandidates(captured.rawGoalArchiveAudits);
  const allCandidates = mergeCandidateCorpora(frontierCandidates, rawCandidates);
  const retentionMatrix = buildRetentionMatrix(simulator, frontierCandidates, sourceSegment, {
    capacities: [1, 2, 4, 8],
    preserveSkylineRoles: true,
    selectCandidateSkyline: __testHooks.selectCandidateSkyline,
  });
  const probes = allCandidates.map((candidate) => runDownstreamProbe(
    project,
    dependencySegments,
    candidate,
    {
      keySide,
      maxExpansions: probeMaxExpansions,
      walkReachabilityMode,
    },
  ));
  const classification = classifyQualityEvidence(retentionMatrix, probes);
  const summaries = allCandidates.map((candidate) => summarizeCandidate(project, candidate, {
    goalDependencyGraph,
    currentSegmentId: SOURCE_SEGMENT_ID,
    downstreamSegment,
  }));
  const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));
  const probeById = new Map(probes.map((probe) => [probe.candidateId, probe]));
  return {
    schema: "motapathfinder.mt5-candidate-quality-shadow.v1",
    status: "passed",
    controls: {
      productionSelectionUntouched: true,
      productionDpKeyUntouched: true,
      productionDominanceUntouched: true,
      objectiveSpecExcludedFromIntermediateRanking: true,
      onlyupSpecificHeuristicAdded: false,
      candidateLimitUsedAsObservationMatrixOnly: true,
      capacities: [1, 2, 4, 8],
      fixedProbeExpansionBudget: probeMaxExpansions,
      fixedProbeRuntimeBudgetMs: 0,
      missIsNotImpossibilityProof: true,
      keySide: keySide === "B"
        ? "existing-without-start-component-research-injection"
        : "production-region",
      wallTimingPinned: false,
    },
    source: {
      fixture: path.relative(__dirname, FIXTURE_FILE).replace(/\\/g, "/"),
      fromMilestoneId: "mt3-i893-hp8425",
      sourceSegmentId: SOURCE_SEGMENT_ID,
      downstreamSegmentId: DOWNSTREAM_SEGMENT_ID,
      foundSource: sourceResult.reachedMilestone === SOURCE_SEGMENT_ID,
      reachedMilestone: sourceResult.reachedMilestone || null,
      failedSegmentId: sourceResult.failedSegment && sourceResult.failedSegment.segmentId || null,
      sourceMaxExpansions,
      candidateLimit,
    },
    corpus: {
      rawGoalArchiveAudits: captured.rawGoalArchiveAudits.length,
      rawGoalCandidates: rawCandidates.length,
      milestoneFrontierCandidates: frontierCandidates.length,
      uniqueCandidatesProbed: allCandidates.length,
      rawArchiveCaptureTruncated: captured.rawGoalArchiveAudits.some((audit) => audit.captureTruncated),
    },
    retentionMatrix,
    candidates: allCandidates.map((candidate) => ({
      ...summaryById.get(candidate.id),
      rawArchiveReason: candidate.rawArchiveReason || null,
      thirdGateProbe: probeById.get(candidate.id) || null,
    })),
    classification,
    conclusion: classification.verdict === "EVICTED_SUCCESS_WITNESS"
      ? "STOP_A_REFINE_MINIMAL_RETENTION_ROLE"
      : classification.verdict === "EVICTED_CANDIDATES_ALSO_FAIL"
        ? "STOP_B_RETENTION_NOT_PRIMARY"
        : classification.verdict === "BUDGET_INCONCLUSIVE"
          ? "STOP_C_SEPARATE_QUALITY_FROM_BUDGET"
          : "EXPAND_CANDIDATE_CORPUS_WITHOUT_CHANGING_PRODUCTION_SELECTION",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runAudit(args);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) {
    const outputPath = path.isAbsolute(args.output)
      ? args.output
      : path.resolve(__dirname, args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, "utf8");
    process.stdout.write(`${JSON.stringify({
      schema: report.schema,
      status: report.status,
      output: outputPath,
      source: report.source,
      corpus: report.corpus,
      retention: report.retentionMatrix.map((row) => ({
        capacity: row.capacity,
        uniqueDpKeyCount: row.uniqueDpKeyCount,
        selectedCount: row.selectedCount,
        deduplicated: row.decisions.filter((decision) =>
          decision.reason === "milestone-frontier-dp-key-deduplication"
        ).length,
        capacityRejected: row.decisions.filter((decision) =>
          decision.reason === "milestone-frontier-capacity"
        ).length,
      })),
      classification: report.classification,
      conclusion: report.conclusion,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(serialized);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  runAudit,
};
