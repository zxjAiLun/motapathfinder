"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadProject } = require("./project-loader");
const { StaticSimulator } = require("./simulator");
const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { GenericDoorResolver } = require("./door-resolver");
const { createInitialState } = require("./state");
const { buildStateKey } = require("./state-key");
const {
  searchDP,
  normalizeContinuationSliceLocalPriorityMode,
  normalizeContinuationSliceExactConfluenceHandoff,
} = require("./dp-search");
const { buildRouteRecord } = require("./route-store");

const SCHEMA = "durable-search-v1";
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value)}\n`);
  fs.renameSync(temp, file);
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
function problemFingerprint(config, towerRoot) {
  return sha(JSON.stringify({
    schema: SCHEMA,
    initial: config.initial,
    stages: config.stages,
    protectedItems: config.protectedItems,
    allowedFloors: config.allowedFloors,
    tower: treeDigest(path.join(towerRoot, "project")),
  }));
}
// Canonical set of EFFECTIVE search-behavior options.  Every field here can
// change DP search RESULTS, so all of them must enter resumeSearchFingerprint
// and must be what runAttempt actually forwards to searchDP (fingerprint ==
// executed semantics).  Defaults are exactly the current production behavior
// (best-first / lazy fairness / 4096 action cap), so this is behavior-
// preserving for the current neko config.  Diagnostic/output-only fields
// (title, scoreLabel, log/report paths) MUST NOT be added here.
function searchSemantics(config) {
  const cfg = config || {};
  const slice = cfg.continuationSlice && typeof cfg.continuationSlice === "object" ? cfg.continuationSlice : {};
  return {
    version: 1,
    dpPriorityMode: cfg.dpPriorityMode || "default",
    dpAgendaMode: cfg.dpAgendaMode || "best-first",
    fairnessEvery: Math.max(1, Math.floor(Number(cfg.fairnessEvery) || 32)),
    fairOrderMode: cfg.fairOrderMode || "fifo",
    maxActionsPerState: Math.max(1, Math.floor(Number(cfg.maxActionsPerState) || 4096)),
    // Reserved for PR-5.32a; fingerprinted now so enabling it later invalidates
    // resume of runs made without it.
    continuationSlice: {
      enabled: slice.enabled === true,
      mode: slice.enabled === true ? (slice.mode || null) : null,
      budget: slice.enabled === true && Number.isFinite(Number(slice.budget)) ? Number(slice.budget) : null,
      localPriorityMode: slice.enabled === true
        ? normalizeContinuationSliceLocalPriorityMode(slice.localPriorityMode)
        : null,
      // Preserve the legacy OFF serialization; only opt-in adds semantics.
      ...(slice.enabled === true && normalizeContinuationSliceExactConfluenceHandoff(slice.exactConfluenceHandoff)
        ? { exactConfluenceHandoff: true }
        : {}),
    },
  };
}
function resumeSearchFingerprint(config, towerRoot) {
  return sha(JSON.stringify({
    schema: SCHEMA,
    problem: problemFingerprint(config, towerRoot),
    solver: treeDigest(__dirname),
    budgets: config.budgets,
    candidateLimit: config.candidateLimit,
    limits: { heapMb: config.heapMb, maxRssMb: config.maxRssMb },
    scoreFlag: config.scoreFlag || null,
    scoreScale: config.scoreScale || null,
    searchSemantics: searchSemantics(config),
  }));
}
// Execution provenance: what code + effective semantics actually ran.  Records
// only; never enters a state key, DP decision or pruning.  Lets a reviewer see
// the executed solver digest and search semantics without trusting a release
// directory name.
function executionProvenance(config, towerRoot) {
  return {
    schema: SCHEMA,
    solverDigest: treeDigest(__dirname),
    problemFingerprint: problemFingerprint(config, towerRoot),
    resumeSearchFingerprint: resumeSearchFingerprint(config, towerRoot),
    executionIdentity: identityOf(config, towerRoot),
    searchSemantics: searchSemantics(config),
  };
}
function identityOf(config, towerRoot) {
  return sha(JSON.stringify({
    schema: SCHEMA,
    resumeSearch: resumeSearchFingerprint(config, towerRoot),
    runner: fs.readFileSync(path.join(__dirname, "../run-durable-search.js"), "utf8"),
  }));
}
function validateConfig(config) {
  if (!config.initial || !config.initial.floorId || !Array.isArray(config.stages) || !config.stages.length) throw new Error("initial and stages required");
  if (!Array.isArray(config.budgets) || !config.budgets.length) throw new Error("budgets required");
  for (const budget of config.budgets) {
    if (!(budget.expansions > 0) || !(budget.runtimeMs > 0)) throw new Error("finite positive task budgets required");
  }
  if (!(config.maxRssMb > 0) || !(config.heapMb > 0)) throw new Error("run memory limits required");
  if (config.maxRuntimeMs != null && config.maxRuntimeMs < 0) throw new Error("maxRuntimeMs must be non-negative");
  if (!Array.isArray(config.allowedFloors) || !config.allowedFloors.includes(config.initial.floorId)) throw new Error("allowedFloors must include start");
}
function protectedCost(action, config) {
  return (config.protectedItems || []).some((id) => Number((action.requirements || {})[id] || 0) > 0);
}
function assertProtected(before, after, config) {
  for (const id of config.protectedItems || []) {
    if (Number(after.inventory[id] || 0) < Number(before.inventory[id] || 0)) throw new Error(`protected item decreased: ${id}`);
  }
}
function makeSimulator(project, config) {
  const doors = new GenericDoorResolver();
  const canOpen = doors.canOpenDoor.bind(doors);
  doors.canOpenDoor = (ctx) => canOpen(ctx) && !protectedCost({ requirements: ctx.tile.doorInfo && ctx.tile.doorInfo.keys }, config);
  const sim = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    doorResolver: doors, autoPickupEnabled: true, autoBattleEnabled: true,
    walkReachabilityMode: "safe-fast", searchGraphMode: "primitive",
  });
  const apply = sim.applyAction.bind(sim);
  sim.applyAction = (state, action, options) => {
    if (protectedCost(action, config)) throw new Error("protected door cost");
    const next = apply(state, action, options);
    if (!next) return next;
    assertProtected(state, next, config);
    return config.allowedFloors.includes(next.floorId) ? next : null;
  };
  return sim;
}
function initialState(project, sim, config) {
  const state = createInitialState(project);
  state.floorId = config.initial.floorId;
  Object.assign(state.hero, config.initial.hero);
  state.hero.loc = { ...config.initial.hero.loc };
  state.inventory = { ...config.initial.inventory };
  state.flags = { ...config.initial.flags };
  state.visitedFloors = { [state.floorId]: true };
  sim.autoResolver.initializeFlags(state);
  // This is an explicit trial-entry state, not a Start save import. The profile
  // is required to describe any arrival effects already applied to this state.
  return sim.stabilizeState(state);
}
function matchesGoal(state, goal) {
  if (state.floorId !== goal.floorId || !(state.hero.hp > 0)) return false;
  if (goal.removed) {
    const floor = state.floorStates[goal.removed.floorId];
    if (!floor || !floor.removed[`${goal.removed.x},${goal.removed.y}`]) return false;
  }
  return true;
}
function summary(state) {
  return { floorId: state.floorId, hp: state.hero.hp, atk: state.hero.atk, def: state.hero.def,
    lv: state.hero.lv, exp: state.hero.exp, inventory: state.inventory, loc: state.hero.loc };
}
function checkpointId(stage, state) {
  return `${stage}-${sha(buildStateKey(state)).slice(0, 24)}`;
}
function newJournal(identity, config, state, towerRoot = null) {
  const id = checkpointId(0, state);
  const problem = towerRoot ? problemFingerprint(config, towerRoot) : null;
  const resume = towerRoot ? resumeSearchFingerprint(config, towerRoot) : null;
  return { schema: SCHEMA, identity, problemFingerprint: problem, resumeSearchFingerprint: resume,
    executionProvenance: towerRoot ? executionProvenance(config, towerRoot) : null, createdAt: new Date().toISOString(), state: "ready", elapsedMs: 0,
    totalExpansions: 0, completedAttempts: 0, initial: summary(state), initialFlags: state.flags,
    nodes: [{ id, stage: 0, tier: 0, status: "pending", summary: summary(state) }], history: [], best: null };
}
function recoverJournal(journal, identity, options = {}) {
  if (journal.schema !== SCHEMA) throw new Error("journal schema mismatch");
  const { config, towerRoot } = options;
  if (!config || !towerRoot) {
    if (journal.identity !== identity) {
      throw new Error("journal identity mismatch: missing config/towerRoot context to verify resume contract");
    }
  } else {
    const expectedProblem = problemFingerprint(config, towerRoot);
    const expectedResume = resumeSearchFingerprint(config, towerRoot);

    // Legacy journal check (missing problemFingerprint or resumeSearchFingerprint on identity mismatch):
    // Owner ruling: journal.problemFingerprint missing AND identity mismatch => REFUSE_AUTOMATIC_ADOPTION
    if ((!journal.problemFingerprint || !journal.resumeSearchFingerprint) && journal.identity !== identity) {
      if (!options.allowLegacyMigration) {
        throw new Error("LEGACY_JOURNAL_IDENTITY_MISMATCH: journal is missing problem/resume fingerprint; refuse automatic adoption across code/identity changes without explicit operator migration");
      }
      journal.problemFingerprint = expectedProblem;
      journal.resumeSearchFingerprint = expectedResume;
      journal.identity = identity;
      journal.legacyMigratedAt = new Date().toISOString();
    } else {
      // Both fingerprints exist: verify strictly
      if (journal.problemFingerprint && journal.problemFingerprint !== expectedProblem) {
        throw new Error("PROBLEM_CONTRACT_MISMATCH: tower project, initial state, stages, or protected items changed; cannot resume in existing run directory");
      }
      if (journal.resumeSearchFingerprint && journal.resumeSearchFingerprint !== expectedResume) {
        throw new Error("SEARCH_SEMANTICS_DRIFT: solver code, search budgets, candidate limits, or memory limits changed; cannot resume previous searched/bounded nodes without explicit re-evaluation");
      }
      // If resumeSearchFingerprint matches, identity can safely update for runner/UI shell changes
      if (journal.identity !== identity) {
        journal.identity = identity;
      }
    }
  }

  for (const node of journal.nodes) if (node.status === "running") node.status = "pending";
  if (["running", "stopping", "run_budget_reached"].includes(journal.state)) journal.state = "paused";
  return journal;
}
function pickTask(journal) {
  return journal.nodes.filter((node) => node.status === "pending").sort((a, b) =>
    a.tier - b.tier || b.stage - a.stage || b.summary.hp - a.summary.hp || a.id.localeCompare(b.id))[0];
}
const SEARCH_PREVIEW_SCHEMA = "motapathfinder.search-preview.v1";

function buildSearchPreview({ task, stageGoal, state, stoppedReason, progressProjection = null }) {
  if (!state) return null;
  const loc = state.hero && state.hero.loc ? { ...state.hero.loc } : { x: 0, y: 0, direction: "down" };
  const currentFloorId = state.floorId;
  const floorState = (state.floorStates && state.floorStates[currentFloorId]) || {};
  return {
    schema: SEARCH_PREVIEW_SCHEMA,
    kind: "progress-preview",
    taskId: task.id,
    stage: task.stage,
    tier: task.tier,
    capturedAt: new Date().toISOString(),
    stoppedReason: stoppedReason || null,
    entryCheckpointId: task.id,
    previewStateFingerprint: typeof sha === "function" ? sha(buildStateKey(state)).slice(0, 24) : null,
    entryStateKey: task.id,
    previewStateKey: typeof sha === "function" ? sha(buildStateKey(state)).slice(0, 24) : null,
    progressProjection: progressProjection || null,
    renderState: {
      floorId: currentFloorId,
      hero: {
        name: (state.hero && state.hero.name) || "纳可",
        image: (state.hero && state.hero.image) || "hero.png",
        lv: Number((state.hero && state.hero.lv) || 1),
        hp: Number((state.hero && state.hero.hp) || 0),
        atk: Number((state.hero && state.hero.atk) || 0),
        def: Number((state.hero && state.hero.def) || 0),
        mdef: Number((state.hero && state.hero.mdef) || 0),
        exp: Number((state.hero && state.hero.exp) || 0),
        loc,
      },
      inventory: { ...(state.inventory || {}) },
      flags: { ...(state.flags || {}) },
      floorStates: {
        [currentFloorId]: {
          removed: { ...(floorState.removed || {}) },
          replaced: { ...(floorState.replaced || {}) },
        },
      },
    },
  };
}

function integrate(journal, task, result, config, dir) {
  const existing = new Set(journal.nodes.map((node) => node.id));
  for (const candidate of result.candidates) {
    const stage = task.stage + 1;
    const id = checkpointId(stage, candidate);
    if (!existing.has(id)) {
      atomicJson(path.join(dir, "states", `${id}.json`), candidate);
      journal.nodes.push({ id, parent: task.id, stage, tier: 0, status: stage === config.stages.length ? "goal" : "pending", summary: summary(candidate) });
      existing.add(id);
    }
  }
  journal.completedAttempts += 1;
  journal.totalExpansions += result.stats.expansions;
  journal.history.push({ id: task.id, stage: task.stage, tier: task.tier, ...result.stats, time: new Date().toISOString() });

  // Persist render-only progress preview (Contract: dedicated snapshot, not a resume checkpoint)
  if (result.bestProgressPreview) {
    const previewsDir = path.join(dir, "previews");
    fs.mkdirSync(previewsDir, { recursive: true });
    atomicJson(path.join(previewsDir, `${task.id}.preview.json`), result.bestProgressPreview);
    atomicJson(path.join(dir, "preview.json"), result.bestProgressPreview);
    journal.latestPreview = {
      taskId: task.id,
      stage: task.stage,
      stoppedReason: result.stats.stoppedReason,
      capturedAt: result.bestProgressPreview.capturedAt,
      previewStateFingerprint: result.bestProgressPreview.previewStateFingerprint || result.bestProgressPreview.previewStateKey,
      previewStateKey: result.bestProgressPreview.previewStateFingerprint || result.bestProgressPreview.previewStateKey,
    };
  }

  // A capped archive or skyline is not an exhaustive proof even when the
  // agenda drained. Retry at the next predeclared budget, never delete parents.
  const incomplete = !result.stats.searchComplete || result.stats.archiveTrimmed;
  if (incomplete && task.tier + 1 < config.budgets.length) {
    task.tier += 1;
    task.status = "pending";
  } else task.status = incomplete ? "bounded" : "searched";
  if (result.verified) {
    journal.best = result.verified;
    journal.state = "verified_route";
  }
}
function runAttempt(config, towerRoot, dir, task, report = () => {}) {
  const project = loadProject(towerRoot);
  const sim = makeSimulator(project, config);
  const start = readJson(path.join(dir, "initial.json"));
  const state = readJson(path.join(dir, "states", `${task.id}.json`));
  const budget = config.budgets[task.tier];
  let lastReport = 0;
  const providerErrors = [];
  let telemetry = { expansions: 0, frontierSize: 0, floorId: state.floorId };
  const notify = (force = false) => {
    if (force || Date.now() - lastReport > 2000) {
      lastReport = Date.now();
      report({ ...telemetry, rssMb: process.memoryUsage().rss / 1048576, time: new Date().toISOString() });
    }
  };
  const stageGoal = config.stages[task.stage];
  // Pull every effective search option from the SAME canonical extractor that
  // feeds resumeSearchFingerprint, so the fingerprinted semantics are exactly
  // what executes here.  Defaults preserve current production behavior.
  const semantics = searchSemantics(config);
  const result = searchDP(sim, state, {
    goalPredicate: (candidate) => matchesGoal(candidate, stageGoal),
    dpPriorityMode: semantics.dpPriorityMode,
    dpAgendaMode: semantics.dpAgendaMode,
    fairnessEvery: semantics.fairnessEvery,
    fairOrderMode: semantics.fairOrderMode,
    // PR-5.32a: pass the continuation slice through from the SAME canonical
    // extractor that feeds resumeSearchFingerprint — fingerprint == execution.
    continuationSlice: semantics.continuationSlice.enabled
      ? { ...semantics.continuationSlice }
      : undefined,
    stageGoal,
    maxExpansions: budget.expansions, maxRuntimeMs: budget.runtimeMs,
    maxRssMb: config.maxRssMb, maxHeapMb: Math.floor(config.heapMb * 0.85),
    maxActionsPerState: semantics.maxActionsPerState, stopOnFirstGoal: false, captureTrace: false,
    goalSkylineLimit: config.candidateLimit, dpSkylineMax: config.candidateLimit,
    preserveSkylineRoles: true,
    actionFilter: (action) => !protectedCost(action, config),
    shouldStop: () => {
      notify();
      return fs.existsSync(path.join(dir, "STOP"));
    },
    observer: { eventTypes: ["actionSetGenerated", "actionProviderError"], onEvent(event) {
      if (event.eventType === "actionProviderError") { providerErrors.push(event); return; }
      telemetry = { expansions: event.expansions, frontierSize: event.frontierSize, floorId: event.floorId || state.floorId };
      notify();
    } },
  });
  notify(true);
  if (providerErrors.length) throw new Error(`action provider failed: ${JSON.stringify(providerErrors[0])}`);
  const candidates = result.goalSkylineStates || [];
  const outcome = result.searchOutcome || {};
  const stats = { expansions: result.expansions, frontierSize: result.frontierSize,
    stoppedReason: result.stoppedReason || (result.frontierSize ? "expansion-limit" : "frontier-drained"),
    searchComplete: outcome.searchComplete === true, foundGoal: result.foundGoal,
    candidateCount: candidates.length, actionTrimmed: result.diagnostics.trimmed,
    archiveTrimmed: Boolean(result.diagnostics.dp.goalArchiveTrimmed), diagnostics: result.diagnostics };

  // Render-only search preview: capture at most one preview in child before raw state release
  let bestProgressPreview = null;
  const rawProgressState = (!candidates.length && (result.bestProgressState || result.bestSeenState)) || null;
  if (rawProgressState) {
    let progressProjection = null;
    try {
      const { compactProgressProjection } = require("./segment-progress");
      const { projectSegmentGoalProgress } = require("./segment-dp");
      progressProjection = compactProgressProjection(
        projectSegmentGoalProgress(project, rawProgressState, config.stages[task.stage])
      );
    } catch (e) {}
    bestProgressPreview = buildSearchPreview({
      task,
      stageGoal: config.stages[task.stage],
      state: rawProgressState,
      stoppedReason: stats.stoppedReason,
      progressProjection,
    });
    stats.hasPreview = true;
  }
  let verified = null;
  if (task.stage === config.stages.length - 1 && candidates.length) {
    let best = null;
    for (const candidate of candidates) {
      if (!matchesGoal(candidate, config.stages[task.stage])) throw new Error("terminal goal mismatch");
      const record = buildRouteRecord({ project, simulator: sim, initialState: start, finalState: candidate,
        // Materialized primitive entries include travel/auto route patches;
        // the node trace alone may omit those additional primitive decisions.
        actionEntries: [],
        options: { solver: "durable-canonical-dp", projectRoot: towerRoot, rank: null,
          metadata: { initialContract: config.initial, zeroSpendItems: config.protectedItems, optimalityProven: false } } });
      const terminalValue = config.scoreFlag
        ? (Number(candidate.flags[config.scoreFlag] || 0) - Number(start.flags[config.scoreFlag] || 0)) / config.scoreScale
        : candidate.hero.hp;
      if (!best || terminalValue > best.value) best = { record, candidate, value: terminalValue };
    }
    atomicJson(path.join(dir, "verified.route.json"), best.record);
    verified = { file: "verified.route.json", strictReplay: true, value: best.value,
      valueLabel: config.scoreLabel || "终点生命", decisions: best.record.decisions.length,
      final: summary(best.candidate), optimalityProven: false, time: new Date().toISOString() };
  }
  return { candidates, stats, verified, bestProgressPreview };
}
module.exports = { SCHEMA, SEARCH_PREVIEW_SCHEMA, sha, readJson, atomicJson, problemFingerprint, resumeSearchFingerprint, searchSemantics, executionProvenance, identityOf, validateConfig, protectedCost,
  assertProtected, makeSimulator, initialState, matchesGoal, summary, checkpointId,
  newJournal, recoverJournal, pickTask, integrate, runAttempt, buildSearchPreview };
