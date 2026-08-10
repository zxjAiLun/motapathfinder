"use strict";

/**
 * TEST GRADE: local-regression
 *
 * Proves that goal-directed agenda ordering reaches the tracked route goals
 * with fewer expansions while leaving key/dominance semantics untouched.
 * The protected-present-tile feasibility gate is explicit, rejects unknown
 * modes at configuration time, and is not enabled by the default profile.
 */

const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { searchDP } = require("./lib/dp-search");
const { cloneState, removeTileAt } = require("./lib/state");
const { resolveSearchIntentOptions, __testHooks } = require("./lib/segment-dp");
const { compileGoalDependencyGraph } = require("./lib/goal-dependency-graph");

const HARNESS = path.join(__dirname, "check-real-route-performance-qualification.js");

function runTracked(caseId, priorityMode, options) {
  const config = options || {};
  const args = [
    HARNESS,
    `--case=${caseId}`,
    "--order=B",
    "--walk-mode=safe-fast",
  ];
  if (config.searchIntent) args.push(`--search-intent=${config.searchIntent}`);
  else args.push(`--priority-mode=${priorityMode}`);
  if (config.maxExpansions != null) args.push(`--max-expansions=${config.maxExpansions}`);
  if (config.stopOnFirstGoal === true) args.push("--stop-on-first-goal=1");
  const child = spawnSync(process.execPath, args, {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(
      `goal-directed ${caseId}/${priorityMode} failed (${child.status}): ${child.stderr || child.stdout}`,
    );
  }
  return JSON.parse(child.stdout).results[0].runs[0];
}

function compact(run) {
  return {
    priorityMode: run.scale.priorityModes[0],
    wallMs: Number(run.performance.wallMs.toFixed(1)),
    firstGoalExpansion: run.scale.firstGoalExpansion,
    firstGoalElapsedMs: run.performance.firstGoalElapsedMs,
    expanded: run.scale.expanded,
    generated: run.scale.generated,
    acceptedStates: run.scale.acceptedStates,
    finalExactStateFingerprint: run.finalExactStateFingerprint,
    routeFingerprint: run.strictReplay.routeFingerprint,
    strictReplayVerified: run.strictReplay.verified,
  };
}

function checkProtectedPresentTileGate() {
  const project = {
    floorsById: {
      F1: { width: 1, height: 1, map: [[1]] },
    },
    mapTilesByNumber: {
      "1": { id: "guard", cls: "enemy", canPass: false },
    },
  };
  const state = {
    floorId: "F1",
    hero: {
      loc: { x: 0, y: 0, direction: "up" },
      hp: 10,
      hpmax: 10,
      atk: 1,
      def: 1,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      equipment: [],
    },
    inventory: {},
    flags: {},
    floorStates: {},
    visitedFloors: { F1: true },
    triggeredAutoEvents: {},
    route: [],
    notes: [],
    meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
  const segment = {
    goal: {
      type: "heroAtLeast",
      floorId: "F1",
      minHero: { hp: 10 },
      presentTiles: [{ floorId: "F1", x: 0, y: 0 }],
    },
  };
  const projector = __testHooks.projectSegmentGoalProgress;
  const predicate = __testHooks.buildSegmentStateFeasibilityPredicate(
    project,
    segment,
    "protected-present-tiles",
  );
  const before = projector(project, state, segment);
  assert.strictEqual(before.feasible, true);
  assert.deepStrictEqual(predicate(state), { feasible: true });
  const simulator = {
    project,
    stopFloorId: "F1",
    isTerminal: () => false,
    getActionFingerprint: (action) => action.summary,
    getActionExpansionCacheStats: () => ({}),
  };
  const search = searchDP(simulator, state, {
    maxExpansions: 2,
    dpStateKeyBuilder: (candidate) => JSON.stringify(candidate.floorStates || {}),
    actionProvider: () => [{ kind: "battle", summary: "battle:guard@F1:0,0" }],
    actionApplier: (candidate) => {
      const next = cloneState(candidate);
      removeTileAt(next, "F1", 0, 0);
      return next;
    },
    goalPredicate: () => false,
    stateFeasibilityPredicate: predicate,
  });
  assert.strictEqual(search.diagnostics.dp.goalFeasibility.pruned, 1);
  assert.deepStrictEqual(search.diagnostics.dp.goalFeasibility.byReason, {
    "protected-present-tile-missing": 1,
  });
  removeTileAt(state, "F1", 0, 0);
  const after = projector(project, state, segment);
  assert.strictEqual(after.feasible, false);
  assert.deepStrictEqual(after.missingProtectedTiles, ["F1:0,0"]);
  assert.deepStrictEqual(predicate(state), {
    feasible: false,
    reason: "protected-present-tile-missing",
    missingProtectedTiles: ["F1:0,0"],
  });
  assert.throws(
    () => __testHooks.buildSegmentStateFeasibilityPredicate(project, segment, "optimistic-guess"),
    /Unknown goal feasibility mode/,
  );
  assert.deepStrictEqual(
    resolveSearchIntentOptions({ searchIntent: "first-feasible" }),
    {
      searchIntent: "first-feasible",
      stopOnFirstGoal: true,
      dpPriorityMode: "goal-directed",
    },
  );
  assert.deepStrictEqual(
    resolveSearchIntentOptions({ searchIntent: "adaptive-feasible", adaptiveBacktrackDepth: 2 }),
    {
      searchIntent: "adaptive-feasible",
      adaptiveBacktrackDepth: 2,
      stopOnFirstGoal: true,
      dpPriorityMode: "goal-directed",
      enableFailureBacktracking: true,
    },
  );
  assert.throws(
    () => resolveSearchIntentOptions({ searchIntent: "fast-ish" }),
    /Unknown search intent/,
  );
  return {
    defaultMode: "off",
    explicitMode: "protected-present-tiles",
    missingReason: "protected-present-tile-missing",
  };
}

function checkGoalDependencyGraph() {
  const project = {
    floorOrder: ["F1", "F2"],
    floorsById: {
      F1: { width: 2, height: 1, map: [[0, 0]], changeFloor: { "1,0": { floorId: "F2" } } },
      F2: { width: 2, height: 1, map: [[1, 0]], changeFloor: {} },
    },
    mapTilesByNumber: { "1": { id: "guard", cls: "enemy", canPass: false } },
  };
  const segments = [
    {
      id: "entry",
      goal: { type: "heroAtLeast", floorId: "F2", minHero: { atk: 10 } },
      actionPolicy: { allowChangeFloors: ["F1:1,0"] },
    },
    {
      id: "guard",
      goal: {
        type: "heroAtLeast",
        floorId: "F2",
        minHero: { atk: 20, def: 8 },
        equipmentIncludes: ["sword"],
        removedTiles: [{ floorId: "F2", x: 0, y: 0 }],
      },
      actionPolicy: { allowChangeFloors: [] },
    },
  ];
  const graph = compileGoalDependencyGraph(project, segments);
  const base = {
    floorId: "F2",
    hero: { atk: 10, def: 4, equipment: [], loc: { x: 1, y: 0 } },
    flags: {},
    floorStates: {},
  };
  const prepared = cloneState(base);
  prepared.hero.atk = 18;
  prepared.hero.def = 8;
  prepared.hero.equipment = ["sword"];
  removeTileAt(prepared, "F2", 0, 0);
  const baseProjection = graph.project(base, "entry");
  const preparedProjection = graph.project(prepared, "entry");
  assert.strictEqual(graph.project(prepared, "entry"), preparedProjection, "same immutable state projection should hit cache");
  assert.ok(graph.getProjectionCacheStats().requirementHits > 0, "duplicate dependency checks should be shared within a projection");
  assert.strictEqual(baseProjection.completion, 1, "both states satisfy the current entry milestone");
  assert.strictEqual(preparedProjection.completion, 1);
  assert.ok(
    preparedProjection.downstreamCompletion > baseProjection.downstreamCompletion,
    "downstream dependency readiness must distinguish equally feasible current goals",
  );
  assert.ok(
    preparedProjection.irreversibleLandmarksMet > baseProjection.irreversibleLandmarksMet,
    "equipment and removed-tile landmarks must be represented",
  );
  assert.strictEqual(graph.stages[0].gateways[0].targetFloorId, "F2", "gateway dependency target");
  return {
    stages: graph.stages.length,
    entryRequirements: graph.stages[0].requirements.length,
    downstreamRequirements: graph.stages[1].requirements.length,
    projectionCache: graph.getProjectionCacheStats(),
  };
}

function main() {
  const mt2Default = runTracked("mt2-to-mt3-i893", "default");
  const mt2Goal = runTracked("mt2-to-mt3-i893", null, { searchIntent: "first-feasible" });
  assert.ok(mt2Default.found && mt2Goal.found, "MT2 -> MT3 must be found in both agenda modes");
  assert.ok(mt2Default.strictReplay.verified && mt2Goal.strictReplay.verified, "MT2 -> MT3 strict replay");
  assert.strictEqual(mt2Goal.finalExactStateFingerprint, mt2Default.finalExactStateFingerprint, "MT2 -> MT3 final state parity");
  assert.strictEqual(mt2Goal.strictReplay.routeFingerprint, mt2Default.strictReplay.routeFingerprint, "MT2 -> MT3 route parity");
  assert.ok(mt2Goal.scale.expanded <= mt2Default.scale.expanded, "goal-directed MT2 -> MT3 must not expand more states");

  const mt4Default = runTracked("mt4-manual-to-mt5-entry", "default", {
    maxExpansions: 100,
    stopOnFirstGoal: true,
  });
  const mt4Goal = runTracked("mt4-manual-to-mt5-entry", null, {
    maxExpansions: 100,
    searchIntent: "first-feasible",
  });
  assert.ok(mt4Default.found && mt4Goal.found, "MT4 -> MT5 must be found in both first-feasible modes");
  assert.ok(mt4Default.strictReplay.verified && mt4Goal.strictReplay.verified, "MT4 -> MT5 strict replay");
  assert.ok(
    mt4Goal.scale.firstGoalExpansion < mt4Default.scale.firstGoalExpansion,
    "goal-directed MT4 -> MT5 must reach the milestone in fewer expansions",
  );
  assert.ok(mt4Goal.scale.generated < mt4Default.scale.generated, "goal-directed MT4 -> MT5 must generate fewer actions");

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.goal-directed-search.v1",
    status: "passed",
    controls: {
      dpKeyUntouched: true,
      dominanceUntouched: true,
      candidateCapacityUntouched: true,
      defaultFeasibilityPruningOff: true,
      timingDirectionalNotPinned: true,
    },
    mt2ToMt3ExactParity: {
      default: compact(mt2Default),
      goalDirected: compact(mt2Goal),
    },
    mt4ToMt5FirstFeasible: {
      default: compact(mt4Default),
      goalDirected: compact(mt4Goal),
      expansionReductionFactor: Number(
        (mt4Goal.scale.firstGoalExpansion / mt4Default.scale.firstGoalExpansion).toFixed(3),
      ),
    },
    feasibilityGate: checkProtectedPresentTileGate(),
    goalDependencyGraph: checkGoalDependencyGraph(),
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
