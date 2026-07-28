"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { searchDP } = require("./lib/dp-search");
const { resolveRecordedAction, writeRouteFile } = require("./lib/route-store");
const { buildSegmentActionProvider } = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");
const { buildDominanceKey, buildStateKey } = require("./lib/state-key");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { getTileDefinitionAt } = require("./lib/state");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_ROUTE_FILE = path.resolve(
  __dirname,
  "routes",
  "fixtures",
  "mt1-mt3-i893-hp8425.route.json",
);
const DEFAULT_PRODUCTION_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-local-best-first-hp4176.route.json",
);
const DEFAULT_PRODUCTION_CHILD_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "full-milestone-best-first-expansions-1400-r1.json",
);
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-hp3834-teacher-fixture-current-exact-divergence-audit.json",
);
const DEFAULT_OUT_ROUTE = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt1-mt3-i893-hp8425.current-exact.route.json",
);

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function boolArg(value, fallback) {
  if (value == null) return fallback;
  return value === "1" || value === "true";
}

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function gitCommit(root) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim() || null;
}

function gitWorktreeClean(root) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 && String(result.stdout || "").trim() === "";
}

function provenance(root, started) {
  const finishedCommit = gitCommit(root);
  return {
    solverCommit: started.commit,
    startedCommit: started.commit,
    finishedCommit,
    commitStable: Boolean(started.commit && finishedCommit && started.commit === finishedCommit),
    nodeVersion: process.version,
    worktreeCleanAtStart: started.clean,
    worktreeCleanAtFinish: gitWorktreeClean(root),
  };
}

function relative(root, file) {
  return path.relative(root, file) || ".";
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function heroSummary(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    exp: Number(hero.exp || 0),
    lv: Number(hero.lv || 0),
    location: state && state.hero && state.hero.loc
      ? {
          floorId: state.floorId,
          x: state.hero.loc.x,
          y: state.hero.loc.y,
        }
      : null,
  };
}

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function missingHardTiles(project, state, hardTiles) {
  return hardTiles
    .filter((tile) => getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) == null)
    .map(tileKey);
}

function compactState(project, state, hardTiles) {
  return {
    floorId: state.floorId,
    hero: heroSummary(state),
    exactStateKey: buildStateKey(state),
    dominanceKey: buildDominanceKey(state),
    decisionDepth: Number((state.meta || {}).decisionDepth || 0),
    missingHardTiles: missingHardTiles(project, state, hardTiles),
  };
}

function meetsMinHero(state, goal) {
  if (!state || (goal.floorId && state.floorId !== goal.floorId)) return false;
  const hero = heroSummary(state);
  return Object.entries(goal.minHero || {}).every(
    ([field, value]) => hero[field] >= Number(value),
  );
}

function findAction(simulator, state, summary) {
  const primitive = simulator.enumeratePrimitiveActions(state).actions || [];
  return primitive.find((action) => action.summary === summary) || null;
}

function replayRecord(simulator, record) {
  let state = simulator.createInitialState({ rank: "chaos" });
  const states = [state];
  const replayErrors = [];
  for (const decision of record.decisions || []) {
    let action = null;
    try {
      action = findAction(simulator, state, decision.summary);
    } catch (error) {
      replayErrors.push({
        index: decision.index,
        summary: decision.summary,
        error: String(error.message || error),
      });
      break;
    }
    if (!action) {
      replayErrors.push({ index: decision.index, summary: decision.summary });
      break;
    }
    try {
      state = simulator.applyAction(state, action, { storeRoute: false });
    } catch (error) {
      replayErrors.push({
        index: decision.index,
        summary: decision.summary,
        error: String(error.message || error),
      });
      break;
    }
    state.meta = { ...(state.meta || {}), decisionDepth: states.length };
    states.push(state);
  }
  return {
    state,
    states,
    replayErrors,
  };
}

function snapshotFloorIds(record, fallback) {
  const fromFinal = record && record.final && record.final.snapshot && record.final.snapshot.floors;
  const ids = Object.keys(fromFinal || {});
  return ids.length > 0 ? ids : fallback;
}

function materializeCurrentExactRoute(project, simulator, record, sourceFile, commit, outFile) {
  const replay = replayRecord(simulator, record);
  if (replay.replayErrors.length > 0 || replay.states.length !== (record.decisions || []).length + 1) {
    throw new Error("Unable to rematerialize all teacher decisions in the current simulator.");
  }
  const snapshotFloors = snapshotFloorIds(record, Object.keys(project.floorsById || {}));
  const initialState = replay.states[0];
  // The current-exact fixture must encode only floors visited at the actual
  // start. Carrying empty future-floor entries forward makes snapshot restore
  // mark those floors visited and changes the progress signature before step 1.
  const startFloors = [initialState.floorId];
  const finalState = replay.states[replay.states.length - 1];
  const decisions = (record.decisions || []).map((sourceDecision, index) => {
    const preState = replay.states[index];
    const postState = replay.states[index + 1];
    return {
      ...sourceDecision,
      preStateKey: buildDominanceKey(preState),
      postStateKey: buildDominanceKey(postState),
      preDominanceKey: buildDominanceKey(preState),
      postDominanceKey: buildDominanceKey(postState),
      preExactStateKey: buildStateKey(preState),
      postExactStateKey: buildStateKey(postState),
      preSnapshot: buildSolverSnapshot(project, preState, { floorIds: snapshotFloors }),
      postSnapshot: buildSolverSnapshot(project, postState, { floorIds: snapshotFloors }),
    };
  });
  const currentRecord = {
    ...record,
    createdAt: new Date().toISOString(),
    source: {
      ...(record.source || {}),
      commit,
      rematerializedFrom: relative(repoRoot(), sourceFile),
      rematerializedCurrentExact: true,
    },
    metadata: {
      ...(record.metadata || {}),
      currentExactRoute: true,
      originalFixtureSha256: sha256(sourceFile),
      originalDecisionCount: decisions.length,
    },
    start: {
      ...(record.start || {}),
      snapshot: buildSolverSnapshot(project, initialState, { floorIds: startFloors.length > 0 ? startFloors : [initialState.floorId] }),
      stateKey: buildDominanceKey(initialState),
      dominanceKey: buildDominanceKey(initialState),
      exactStateKey: buildStateKey(initialState),
    },
    final: {
      ...(record.final || {}),
      snapshot: buildSolverSnapshot(project, finalState, { floorIds: snapshotFloors }),
      stateKey: buildDominanceKey(finalState),
      dominanceKey: buildDominanceKey(finalState),
      exactStateKey: buildStateKey(finalState),
      floorId: finalState.floorId,
    },
    decisions,
  };
  writeRouteFile(outFile, currentRecord);
  return { record: currentRecord, replay };
}

function parseProductionWitness(childReport) {
  const statProgress = childReport && childReport.segmentResults && childReport.segmentResults[0] &&
    childReport.segmentResults[0].attempts && childReport.segmentResults[0].attempts[0] &&
    childReport.segmentResults[0].attempts[0].diagnostics &&
    childReport.segmentResults[0].attempts[0].diagnostics.dp &&
    childReport.segmentResults[0].attempts[0].diagnostics.dp.statProgress;
  const witness = statProgress && statProgress.bestWitnessMeetingAtkDefMdef;
  if (!witness || !witness.exactStateKey) return null;
  return {
    source: childReport.provenance || childReport.source || null,
    routeName: childReport.routeName || null,
    exactStateKey: witness.exactStateKey,
    decisionDepth: witness.decisionDepth == null ? null : witness.decisionDepth,
    routeTail: witness.routeTail || [],
    hero: {
      hp: witness.hp,
      atk: witness.atk,
      def: witness.def,
      mdef: witness.mdef,
      exp: witness.exp,
    },
  };
}

function dominanceKeyFromExactStateKey(exactStateKey) {
  const parsed = JSON.parse(exactStateKey);
  parsed.hero.hp = null;
  parsed.hero.hpmax = null;
  parsed.hero.manamax = null;
  return JSON.stringify(parsed);
}

function keyParts(exactStateKey) {
  const parsed = JSON.parse(exactStateKey);
  return {
    floorId: parsed.floorId,
    progressSig: parsed.progressSig,
    hero: parsed.hero,
    inventory: parsed.inventory,
    flags: parsed.flags,
    visitedFloors: parsed.visitedFloors,
    mutations: parsed.mutations,
  };
}

function compareTeacherProductionWitness(teacherState, productionWitness) {
  if (!teacherState || !productionWitness) return null;
  const teacherExactStateKey = buildStateKey(teacherState);
  const productionExactStateKey = productionWitness.exactStateKey;
  const teacher = keyParts(teacherExactStateKey);
  const production = keyParts(productionExactStateKey);
  const teacherDominanceKey = buildDominanceKey(teacherState);
  const productionDominanceKey = dominanceKeyFromExactStateKey(productionExactStateKey);
  return {
    exactStateKeyEqual: teacherExactStateKey === productionExactStateKey,
    dominanceKeyEqual: teacherDominanceKey === productionDominanceKey,
    sameLocation: teacher.floorId === production.floorId &&
      teacher.hero.x === production.hero.x && teacher.hero.y === production.hero.y,
    sameMutationState: JSON.stringify(teacher.mutations) === JSON.stringify(production.mutations),
    sameFlags: JSON.stringify(teacher.flags) === JSON.stringify(production.flags),
    sameInventory: JSON.stringify(teacher.inventory) === JSON.stringify(production.inventory),
    sameVisitedFloors: JSON.stringify(teacher.visitedFloors) === JSON.stringify(production.visitedFloors),
    hpDeltaTeacherMinusProduction: Number(teacher.hero.hp || 0) - Number(production.hero.hp || 0),
    teacher: {
      hero: teacher.hero,
      floorId: teacher.floorId,
      exactStateKey: teacherExactStateKey,
      dominanceKey: teacherDominanceKey,
    },
    production: {
      hero: production.hero,
      floorId: production.floorId,
      exactStateKey: productionExactStateKey,
      dominanceKey: productionDominanceKey,
    },
  };
}

function replayProductionRoute(simulator, project, record) {
  const replay = replayRecord(simulator, record);
  return {
    ...replay,
    strictReplay: strictReplayRoute(project, simulator, record),
  };
}

function findEarliestGoalState(replay, goal) {
  const index = replay.states.findIndex((state) => meetsMinHero(state, goal));
  return index < 0 ? null : {
    stateIndex: index,
    state: replay.states[index],
  };
}

function compareCommonBoundary(teacherReplay, productionReplay, localGoal) {
  const teacherLocal = findEarliestGoalState(teacherReplay, localGoal);
  const productionFinal = productionReplay.strictReplay.valid
    ? productionReplay.state
    : productionReplay.states[productionReplay.states.length - 1];
  const teacherMatches = [];
  const productionMatches = [];
  if (teacherLocal) {
    const teacherDominance = buildDominanceKey(teacherLocal.state);
    const productionDominance = buildDominanceKey(productionFinal);
    if (teacherDominance === productionDominance) teacherMatches.push(0);
    if (buildStateKey(teacherLocal.state) === buildStateKey(productionFinal)) productionMatches.push(0);
  }
  let exactPrefixLength = 0;
  while (
    exactPrefixLength < teacherReplay.states.length &&
    exactPrefixLength < productionReplay.states.length &&
    buildStateKey(teacherReplay.states[exactPrefixLength]) === buildStateKey(productionReplay.states[exactPrefixLength])
  ) {
    exactPrefixLength += 1;
  }
  let dominancePrefixLength = 0;
  while (
    dominancePrefixLength < teacherReplay.states.length &&
    dominancePrefixLength < productionReplay.states.length &&
    buildDominanceKey(teacherReplay.states[dominancePrefixLength]) === buildDominanceKey(productionReplay.states[dominancePrefixLength])
  ) {
    dominancePrefixLength += 1;
  }
  return {
    status: teacherLocal && teacherMatches.length > 0 ? "matched" : "no-common-dominance-boundary",
    teacherEarliestLocal: teacherLocal
      ? { stateIndex: teacherLocal.stateIndex, state: compactState(null, teacherLocal.state, []) }
      : null,
    productionCheckpoint: {
      stateIndex: productionReplay.states.length - 1,
      state: compactState(null, productionFinal, []),
    },
    exactStateEqual: Boolean(teacherLocal && buildStateKey(teacherLocal.state) === buildStateKey(productionFinal)),
    dominanceKeyEqual: Boolean(teacherLocal && buildDominanceKey(teacherLocal.state) === buildDominanceKey(productionFinal)),
    exactPrefixLength,
    dominancePrefixLength,
    teacherStateIndexForContinuation: teacherLocal ? teacherLocal.stateIndex : null,
    productionStateIndexForContinuation: productionReplay.states.length - 1,
  };
}

function actionFingerprint(simulator, action) {
  if (!action) return null;
  if (action.fingerprint) return action.fingerprint;
  if (typeof simulator.getActionFingerprint !== "function") return null;
  try {
    return simulator.getActionFingerprint(action);
  } catch (error) {
    return null;
  }
}

function eventActionSummary(event) {
  return event && event.action && event.action.summary;
}

function singleStepObserverAudit(simulator, segment, state, nextDecision, timeoutMs) {
  const actionProvider = buildSegmentActionProvider(simulator, segment);
  const expectedSummary = nextDecision && nextDecision.summary;
  let providerActions = [];
  let providerError = null;
  try {
    providerActions = actionProvider(simulator, state) || [];
  } catch (error) {
    providerError = String(error.message || error);
  }
  const providerAction = providerActions.find((action) => action.summary === expectedSummary);
  const events = [];
  let search = null;
  try {
    search = searchDP(simulator, state, {
      maxExpansions: 1,
      maxRuntimeMs: timeoutMs,
      maxActionsPerState: 256,
      dpKeyMode: "mutation",
      dpSkylineMax: 4,
      stopOnFirstGoal: false,
      goalPredicate: () => false,
      actionProvider,
      actionApplier: (currentState, action) => simulator.applyAction(currentState, action, { storeRoute: false }),
      observerIncludeExactStateKey: true,
      observer: {
        includeExactStateKey: true,
        onEvent: (event) => events.push(event),
      },
    });
  } catch (error) {
    search = { error: String(error.message || error) };
  }
  const matchingGenerated = events.filter(
    (event) => event.eventType === "candidateGenerated" && eventActionSummary(event) === expectedSummary,
  );
  const matchingRejected = events.filter(
    (event) => event.eventType === "candidateRejected" && eventActionSummary(event) === expectedSummary,
  );
  const matchingInserted = events.filter(
    (event) => event.eventType === "skylineInserted" && eventActionSummary(event) === expectedSummary,
  );
  const matchingEvicted = events.filter(
    (event) => event.eventType === "skylineEvicted" && eventActionSummary(event) === expectedSummary,
  );
  const insertedNodeIds = new Set(matchingInserted.map((event) => event.nodeId));
  const matchingAgendaPops = events.filter(
    (event) => event.eventType === "agendaPopped" && insertedNodeIds.has(event.nodeId),
  );
  return {
    providerActionCount: providerActions.length,
    providerContainsAction: Boolean(providerAction),
    providerError,
    nextAction: providerAction
      ? {
          summary: providerAction.summary,
          kind: providerAction.kind,
          fingerprint: actionFingerprint(simulator, providerAction),
        }
      : null,
    search: search && search.error
      ? { error: search.error }
      : {
          expansions: search && search.expansions || 0,
          frontierSize: search && search.frontierSize || 0,
          eventCounts: events.reduce((counts, event) => {
            counts[event.eventType] = (counts[event.eventType] || 0) + 1;
            return counts;
          }, {}),
        },
    successorGenerated: matchingGenerated.length > 0,
    candidateRejectedReasons: matchingRejected.map((event) => event.reasonCode),
    dominanceRejected: matchingRejected.some((event) => event.reasonCode === "dominance-rejected"),
    skylineInserted: matchingInserted.length > 0,
    skylineEvicted: matchingEvicted.length > 0,
    agendaPopped: matchingAgendaPops.length > 0,
  };
}

function directContinuationStepAudit(project, simulator, segment, replay, fromIndex, toIndex, options) {
  const audit = [];
  const actionProvider = buildSegmentActionProvider(simulator, segment);
  for (let stateIndex = fromIndex; stateIndex < toIndex; stateIndex += 1) {
    const state = replay.states[stateIndex];
    const decision = replay.record.decisions[stateIndex] || null;
    let providerActions = [];
    let providerError = null;
    try {
      providerActions = actionProvider(simulator, state) || [];
    } catch (error) {
      providerError = String(error.message || error);
    }
    const providerAction = providerActions.find((action) => action.summary === (decision && decision.summary));
    let successorGenerated = false;
    let successorExactStateKey = null;
    let successorError = null;
    if (providerAction) {
      try {
        const applied = simulator.applyAction(state, providerAction, { storeRoute: false });
        const successors = Array.isArray(applied) ? applied : [applied];
        const expected = replay.states[stateIndex + 1];
        const successor = successors.find((candidate) => buildStateKey(candidate) === buildStateKey(expected));
        successorGenerated = Boolean(successor);
        successorExactStateKey = successor ? buildStateKey(successor) : successors[0] ? buildStateKey(successors[0]) : null;
      } catch (error) {
        successorError = String(error.message || error);
      }
    }
    const row = {
      stateIndex,
      decisionIndex: decision && decision.index || stateIndex + 1,
      actionSummary: decision && decision.summary || null,
      pre: compactState(project, state, segment.goal.presentTiles || []),
      providerContainsAction: Boolean(providerAction),
      providerAction: providerAction
        ? { kind: providerAction.kind, summary: providerAction.summary, fingerprint: actionFingerprint(simulator, providerAction) }
        : null,
      successorGenerated,
      successorExactStateKey,
      providerError,
      successorError,
      candidateRejectedReasons: null,
      dominanceRejected: null,
      skylineInserted: null,
      skylineEvicted: null,
      agendaPopped: null,
      searchObserver: null,
    };
    if (options.stepObserver) {
      row.searchObserver = singleStepObserverAudit(
        simulator,
        segment,
        state,
        decision,
        options.stepObserverTimeoutMs,
      );
      row.candidateRejectedReasons = row.searchObserver.candidateRejectedReasons;
      row.dominanceRejected = row.searchObserver.dominanceRejected;
      row.skylineInserted = row.searchObserver.skylineInserted;
      row.skylineEvicted = row.searchObserver.skylineEvicted;
      row.agendaPopped = row.searchObserver.agendaPopped;
    }
    audit.push(row);
  }
  return {
    mode: options.stepObserver ? "single-step-search-observer" : "provider-and-successor-only",
    anchoredToProductionCheckpoint: false,
    anchorReason: "mt2-local-3582 teacher state and production route checkpoint have no common dominance key",
    steps: audit,
    firstProviderDivergence: audit.find((row) => !row.providerContainsAction || !row.successorGenerated)
      ? audit.find((row) => !row.providerContainsAction || !row.successorGenerated).decisionIndex
      : null,
  };
}

function buildMarkdown(report) {
  const route = report.routeMaterialization;
  const compare = report.jointWitnessComparison;
  const boundary = report.commonBoundary;
  const lines = [
    "# PR-4.4d HP3834 teacher fixture current-exact divergence audit",
    "",
    `Status: **${report.status}**`,
    "",
    "## Gate result",
    "",
    `- Current-exact route strict replay: ${route.strictReplay.valid ? `**valid (${route.strictReplay.stepsCompleted}/${route.strictReplay.stepsAttempted})**` : `**invalid (${route.strictReplay.failureReason})**`}`,
    `- Original fixture strict replay: ${report.legacySourceStrictReplay.valid ? `valid (${report.legacySourceStrictReplay.stepsCompleted}/${report.legacySourceStrictReplay.stepsAttempted})` : `invalid at step ${report.legacySourceStrictReplay.failureStep}: ${report.legacySourceStrictReplay.failureReason}`}`,
    `- Current-exact route: ${report.source.currentExactRoute}`,
    `- Production checkpoint strict replay: ${report.productionCheckpoint.strictReplay.valid ? `valid (${report.productionCheckpoint.strictReplay.stepsCompleted}/${report.productionCheckpoint.strictReplay.stepsAttempted})` : `invalid: ${report.productionCheckpoint.strictReplay.failureReason}`}`,
    "",
    "## Joint witness comparison",
    "",
    `- Teacher witness: decision ${compare && compare.teacher && compare.teacher.decisionDepth != null ? compare.teacher.decisionDepth : "?"}; HP ${compare ? compare.teacher.hero.hp : "?"}; ATK/DEF/MDEF ${compare ? `${compare.teacher.hero.atk}/${compare.teacher.hero.def}/${compare.teacher.hero.mdef}` : "?"}.`,
    `- Production witness: depth ${report.productionWitness ? report.productionWitness.decisionDepth : "?"}; HP ${compare ? compare.production.hero.hp : "?"}; ATK/DEF/MDEF ${compare ? `${compare.production.hero.atk}/${compare.production.hero.def}/${compare.production.hero.mdef}` : "?"}.`,
    `- Same dominance key: **${Boolean(compare && compare.dominanceKeyEqual)}**; exact key equal: **${Boolean(compare && compare.exactStateKeyEqual)}**.`,
    `- Same mutation/flags/inventory/location: **${Boolean(compare && compare.sameMutationState && compare.sameFlags && compare.sameInventory && compare.sameLocation)}**.`,
    `- HP delta (teacher minus production): **${compare ? compare.hpDeltaTeacherMinusProduction : "n/a"}**.`,
    "",
    "## Common boundary",
    "",
    `- Status: **${boundary.status}**.`,
    `- Teacher earliest mt2-local-3582: state index ${boundary.teacherEarliestLocal ? boundary.teacherEarliestLocal.stateIndex : "n/a"}.`,
    `- Production checkpoint: route state index ${boundary.productionCheckpoint.stateIndex}.`,
    `- Exact prefix length: ${boundary.exactPrefixLength}; dominance prefix length: ${boundary.dominancePrefixLength}.`,
    "",
    "The local checkpoint is not treated as a common continuation state because its dominance key differs from the teacher's earliest local-goal state.",
    "",
    "## Pre-goal step audit",
    "",
    `Audit mode: ${report.preGoalAudit.mode}; anchored to production checkpoint: **${report.preGoalAudit.anchoredToProductionCheckpoint}**.`,
    "",
    "| Decision | Action | Provider | Successor | Dominance reject | Skyline insert/evict | Agenda pop |",
    "|---:|---|:---:|:---:|:---:|:---:|:---:|",
  ];
  for (const step of report.preGoalAudit.steps) {
    lines.push(`| ${step.decisionIndex} | ${step.actionSummary} | ${step.providerContainsAction} | ${step.successorGenerated} | ${step.dominanceRejected == null ? "n/a" : step.dominanceRejected} | ${step.skylineInserted == null ? "n/a" : `${step.skylineInserted}/${step.skylineEvicted}`} | ${step.agendaPopped == null ? "n/a" : step.agendaPopped} |`);
  }
  lines.push(
    "",
    "Null lifecycle fields mean no production search was claimed at that row; the production local checkpoint was not a dominance-equivalent anchor.",
    "",
    "## Provenance",
    "",
    `- solver commit: ${report.provenance.solverCommit || "unknown"}`,
    `- started/finished stable: **${report.provenance.commitStable}**`,
    `- node: ${report.provenance.nodeVersion}`,
    `- clean worktree at start/finish: **${report.provenance.worktreeCleanAtStart}/${report.provenance.worktreeCleanAtFinish}**`,
    "",
    `Raw JSON: ${report.source.reportFile}`,
    `Current-exact route: ${report.source.currentExactRoute}`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const started = { commit: gitCommit(root), clean: gitWorktreeClean(root) };
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const routeFile = path.resolve(args.route || DEFAULT_ROUTE_FILE);
  const productionRouteFile = path.resolve(args["production-route"] || DEFAULT_PRODUCTION_ROUTE);
  const productionChildReportFile = path.resolve(args["production-child-report"] || DEFAULT_PRODUCTION_CHILD_REPORT);
  const outFile = path.resolve(args.out || DEFAULT_OUT);
  const outRouteFile = path.resolve(args["out-route"] || DEFAULT_OUT_ROUTE);
  const outMarkdown = path.resolve(args["out-md"] || outFile.replace(/\.json$/i, ".md"));
  const requireStrict = boolArg(args["require-strict"], false);
  const stepObserver = boolArg(args["step-observer"], false);
  const stepObserverTimeoutMs = Number(args["step-observer-timeout-ms"] || 60000);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const originalRecord = readJson(routeFile);
  const originalStrictReplay = strictReplayRoute(project, simulator, originalRecord);
  const materialized = materializeCurrentExactRoute(
    project,
    simulator,
    originalRecord,
    routeFile,
    started.commit,
    outRouteFile,
  );
  const currentRecord = materialized.record;
  const currentStrictReplay = strictReplayRoute(project, simulator, currentRecord);
  const teacherReplay = replayRecord(simulator, currentRecord);
  const productionRecord = readJson(productionRouteFile);
  const productionReplay = replayProductionRoute(simulator, project, productionRecord);
  const childReport = fs.existsSync(productionChildReportFile) ? readJson(productionChildReportFile) : null;
  const productionWitness = parseProductionWitness(childReport);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const localSegment = spec.milestones.find((milestone) => milestone.id === "mt2-local-3582");
  const hpSegment = spec.milestones.find((milestone) => milestone.id === "mt2-hp3834");
  const hardTiles = hpSegment.goal.presentTiles || [];
  const witnessIndex = teacherReplay.states.findIndex(
    (state) => meetsMinHero(state, hpSegment.goal) && missingHardTiles(project, state, hardTiles).length === 0,
  );
  const localBoundary = compareCommonBoundary(teacherReplay, productionReplay, localSegment.goal);
  const witnessState = witnessIndex >= 0 ? teacherReplay.states[witnessIndex] : null;
  const jointWitnessComparison = compareTeacherProductionWitness(witnessState, productionWitness);
  const preGoalStart = localBoundary.teacherStateIndexForContinuation == null
    ? 0
    : localBoundary.teacherStateIndexForContinuation;
  const preGoalEnd = witnessIndex >= 0 ? witnessIndex : Math.min(teacherReplay.states.length - 1, 23);
  const preGoalAudit = directContinuationStepAudit(
    project,
    simulator,
    hpSegment,
    { ...teacherReplay, record: currentRecord },
    preGoalStart,
    preGoalEnd,
    { stepObserver, stepObserverTimeoutMs },
  );
  const finishedProvenance = provenance(root, started);
  const report = {
    schema: "motapathfinder.hp3834-teacher-fixture-current-exact-divergence-audit.v2",
    generatedAt: new Date().toISOString(),
    status: currentStrictReplay.valid && teacherReplay.replayErrors.length === 0 && productionWitness
      ? "completed"
      : "completed-with-strict-replay-failure",
    source: {
      fixture: relative(root, routeFile),
      currentExactRoute: relative(root, outRouteFile),
      productionRoute: relative(root, productionRouteFile),
      productionChildReport: relative(root, productionChildReportFile),
      reportFile: relative(root, outFile),
      projectRoot: relative(root, projectRoot),
      originalFixtureSha256: sha256(routeFile),
      fixtureDecisionsInjectedIntoProductionSearch: false,
    },
    provenance: finishedProvenance,
    target: {
      localMilestone: localSegment.id,
      milestone: hpSegment.id,
      minHero: hpSegment.goal.minHero,
      hardPresentTiles: hardTiles.map((tile) => ({
        floorId: tile.floorId,
        x: tile.x,
        y: tile.y,
        reason: tile.reason || null,
        propagatedFromMilestone: tile.propagatedFromMilestone || null,
      })),
    },
    routeMaterialization: {
      currentExactRoute: relative(root, outRouteFile),
      originalDecisionCount: (originalRecord.decisions || []).length,
      currentDecisionCount: (currentRecord.decisions || []).length,
      strictReplay: currentStrictReplay,
      summaryReplay: {
        decisionsAttempted: (currentRecord.decisions || []).length,
        decisionsApplied: teacherReplay.states.length - 1,
        replayErrors: teacherReplay.replayErrors,
        final: compactState(project, teacherReplay.state, hardTiles),
      },
    },
    legacySourceStrictReplay: originalStrictReplay,
    productionCheckpoint: {
      route: relative(root, productionRouteFile),
      strictReplay: productionReplay.strictReplay,
      decisionCount: (productionRecord.decisions || []).length,
      final: compactState(project, productionReplay.state, []),
    },
    productionWitness,
    earliestContinuationCompatibleWitness: witnessState
      ? {
          stateIndex: witnessIndex,
          reachedAfterDecision: witnessIndex,
          nextDecision: currentRecord.decisions[witnessIndex] || null,
          state: compactState(project, witnessState, hardTiles),
        }
      : null,
    jointWitnessComparison,
    commonBoundary: localBoundary,
    preGoalAudit,
    conclusion: currentStrictReplay.valid && jointWitnessComparison && jointWitnessComparison.dominanceKeyEqual
      ? "current-exact route strictly replays; production joint witness matches teacher on dominance state and differs by HP only; local checkpoint is not a common continuation boundary"
      : "audit incomplete; inspect strict replay, production witness, and common-boundary fields",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMarkdown, buildMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (requireStrict && report.status !== "completed") process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  compareTeacherProductionWitness,
  materializeCurrentExactRoute,
  oracleObserverAudit: singleStepObserverAudit,
  replayFixture: replayRecord,
};
