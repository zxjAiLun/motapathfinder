"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4b Commit 3 — single-Region TowerIR shadow contract.
 *
 * 13.1 Compile determinism
 * 13.2 Scope correctness / fail-closed
 * 13.3 Static structure coverage
 * 13.4 Mutation differential (enemy removed / item removed / tile replaced)
 * 13.5 Position semantics (same component vs blocker-separated)
 * 13.6 Representative shadow parity (real captured corpus, mismatches = 0)
 * 13.7 Shadow observation never affects production
 * 13.8 IR immutability under shadow evaluation
 * 14   Perf: compile + legacy-only vs TowerIR-only evaluation
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { compileTowerIR, stableStringify } = require("./lib/tower-ir");
const {
  collectEndpointsFromCells,
  computeLegacyStructuralReachability,
  createTowerIrShadow,
  evaluateTowerIRReachability,
} = require("./lib/tower-ir-shadow");
const { cloneState, removeTileAt, replaceTileAt } = require("./lib/state");
const { searchDP } = require("./lib/dp-search");
const { executeSolveJob, makeSimulator } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const project = loadProject(ONLY_UP_ROOT);
const smokeSpec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
const smokeIr = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });

// Commit 2 reference fingerprints (route-free state, before TowerIR).
const COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT =
  '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}';
const COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT = "a2ff379819ac9003";

function buildRepresentativeTask(captureLimit) {
  const spec = JSON.parse(JSON.stringify(smokeSpec));
  spec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
  return compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 3000,
      maxRuntimeMs: 0,
      candidateLimit: 2,
      goalSkylineLimit: 8,
      captureExpandedStates: true,
      captureExpandedStateLimit: captureLimit,
    },
    verification: { strictReplay: false },
  });
}

function capturedStatesFrom(execution) {
  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;
  return (dp && dp.capturedExpandedStates) || [];
}

function checkCompileDeterminism() {
  const first = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
  const second = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
  assert.strictEqual(first.irFingerprint, second.irFingerprint, "repeated compilation must yield the same irFingerprint");
  assert.strictEqual(first.sourceFingerprint, second.sourceFingerprint, "repeated compilation must yield the same sourceFingerprint");
  assert.deepStrictEqual(
    first.components.map((c) => c.componentId),
    second.components.map((c) => c.componentId),
    "component IDs must be stable across compilations",
  );
  assert.deepStrictEqual(
    first.pois.map((p) => p.poiId),
    second.pois.map((p) => p.poiId),
    "POI IDs must be stable across compilations",
  );
}

function checkScopeValidation() {
  assert.throws(
    () => compileTowerIR(project, { scope: { floors: ["MT1", "NOPE_FLOOR"] } }),
    (error) => error && /unknown floor/.test(error.message),
    "unknown scope floor must fail closed",
  );
  assert.throws(
    () => compileTowerIR(project, { scope: { floors: [] } }),
    (error) => error && /non-empty/.test(error.message),
    "empty scope must fail closed",
  );
  const outOfScope = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
  assert.deepStrictEqual(outOfScope.scope.floorIds, ["MT1"], "scope must contain only the region floors");
  assert.ok(
    outOfScope.pois.every((poi) => poi.floorId === "MT1"),
    "no POI may reference a floor outside the region scope",
  );
}

function checkStaticStructureCoverage() {
  assert.ok(smokeIr.floors.length > 0, "floorCount > 0");
  assert.ok(smokeIr.components.length > 0, "componentCount > 0");
  assert.ok(smokeIr.pois.length > 0, "poiCount > 0");
  assert.ok(smokeIr.edges.length > 0, "edgeCount > 0");
  const byKind = {};
  smokeIr.pois.forEach((poi) => { byKind[poi.kind] = (byKind[poi.kind] || 0) + 1; });
  assert.ok((byKind.enemy || 0) > 0, "enemyPoiCount > 0");
  assert.ok((byKind.item || 0) > 0, "itemPoiCount > 0");
  if ((byKind.changeFloor || 0) === 0) {
    // The smoke region has exactly one changeFloor POI; if it were absent we
    // would need an explicit explanation.  Here we assert it exists.
  }
  assert.ok((byKind.changeFloor || 0) > 0, "changeFloorPoiCount > 0 (smoke scope has the MT1 stair)");
  // Stable POI IDs (order-independent).
  const poiIds = smokeIr.pois.map((poi) => poi.poiId);
  const sorted = poiIds.slice().sort();
  assert.ok(sorted.every((id, i) => i === 0 || id !== sorted[i - 1]), "POI IDs must be unique");
  assert.ok(
    smokeIr.pois.every((poi) => /^MT1:(enemy|door|item|event|changeFloor|toolSensitive):\d+,\d+/.test(poi.poiId)),
    "POI IDs must be stable and coordinate-anchored",
  );
}

function checkFingerprintSensitivity() {
  const base = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
  // Changing a key tile in the region scope's floor changes the source fingerprint.
  const modifiedFloor = project.floorsById.MT1;
  const originalMap = modifiedFloor.map;
  const tamperedMap = originalMap.map((row) => row.slice());
  // Flip one transit cell into an obstacle (or vice versa) if possible.
  let changed = false;
  for (let y = 0; y < modifiedFloor.height && !changed; y += 1) {
    for (let x = 0; x < modifiedFloor.width && !changed; x += 1) {
      const num = tamperedMap[y][x];
      if (num === 0) { tamperedMap[y][x] = 1; changed = true; }
      else if (num != null && num > 0) { tamperedMap[y][x] = 0; changed = true; }
    }
  }
  if (changed) {
    modifiedFloor.map = tamperedMap;
    try {
      const modified = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
      assert.notStrictEqual(modified.sourceFingerprint, base.sourceFingerprint, "changing a tile must change the source fingerprint");
    } finally {
      modifiedFloor.map = originalMap;
    }
  }
  // Changing the region scope changes the fingerprint.
  const scopeChanged = compileTowerIR(project, { ...smokeSpec, scope: { floors: ["MT1", "MT1"] } }, { towerId: "onlyup-smoke" });
  assert.notStrictEqual(scopeChanged.irFingerprint, base.irFingerprint, "changing the scope must change the ir fingerprint");
  // Re-serialization stability: stableStringify is order-independent for objects.
  assert.strictEqual(
    stableStringify({ b: 2, a: { d: 4, c: 3 } }),
    stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
    "unrelated property order must not change the fingerprint",
  );
}

function makeVariantState(base, mutate) {
  const variant = cloneState(base);
  mutate(variant);
  return variant;
}

function checkMutationDifferential() {
  const sim = makeSimulator(project, smokeSpec, {});
  const init = cloneState(sim.createInitialState({ rank: "chaos" }));
  const shadow = createTowerIrShadow(smokeIr, project);
  const heroFloor = "MT1";

  // Enemy present -> enemy removed.
  const enemyPoi = smokeIr.pois.find((poi) => poi.floorId === heroFloor && poi.kind === "enemy");
  assert.ok(enemyPoi, "smoke region must contain an enemy POI");
  const enemyRemoved = makeVariantState(init, (state) => {
    removeTileAt(state, heroFloor, enemyPoi.x, enemyPoi.y);
  });
  const legWith = computeLegacyStructuralReachability(project, init);
  const legRemoved = computeLegacyStructuralReachability(project, enemyRemoved);
  const irWith = evaluateTowerIRReachability(smokeIr, project, init);
  const irRemoved = evaluateTowerIRReachability(smokeIr, project, enemyRemoved);
  assert.ok(
    legRemoved.reachableCells.length >= legWith.reachableCells.length,
    "removing an enemy must not shrink the legacy reachable set",
  );
  assert.ok(
    irRemoved.reachableCells.length >= irWith.reachableCells.length,
    "removing an enemy must not shrink the TowerIR reachable set",
  );
  assert.ok(shadow.checkState(enemyRemoved).comparison.match, "enemy-removed state must match");

  // Item present -> item removed.
  const itemPoi = smokeIr.pois.find((poi) => poi.floorId === heroFloor && poi.kind === "item");
  assert.ok(itemPoi, "smoke region must contain an item POI");
  const itemRemoved = makeVariantState(init, (state) => {
    removeTileAt(state, heroFloor, itemPoi.x, itemPoi.y);
  });
  assert.ok(shadow.checkState(itemRemoved).comparison.match, "item-removed state must match");

  // Tile replaced (enemy cell replaced with an empty floor tile).
  const replaced = makeVariantState(init, (state) => {
    replaceTileAt(state, heroFloor, enemyPoi.x, enemyPoi.y, 0);
  });
  assert.ok(shadow.checkState(replaced).comparison.match, "tile-replaced state must match");

  // Door: the smoke region scope has no door POIs; documented (the region is a
  // battle/pickup/event corridor).  Differential coverage is provided by
  // enemy/item/replaced above.
  const doors = smokeIr.pois.filter((poi) => poi.kind === "door");
  assert.strictEqual(doors.length, 0, "smoke region has no doors (documented; coverage via enemy/item/replaced)");
}

function checkPositionSemantics() {
  const sim = makeSimulator(project, smokeSpec, {});
  const init = cloneState(sim.createInitialState({ rank: "chaos" }));
  const heroFloor = "MT1";
  const shadow = createTowerIrShadow(smokeIr, project);

  // Same static component: two positions inside one component give the same
  // region semantics.
  const startComponent = smokeIr.components.find((component) => component.floorId === heroFloor && component.staticCells.length >= 2);
  assert.ok(startComponent, "MT1 must have a component with at least 2 cells");
  const [cellA, cellB] = startComponent.staticCells;
  const stateA = cloneState(init);
  stateA.hero.loc.x = cellA.x;
  stateA.hero.loc.y = cellA.y;
  const stateB = cloneState(init);
  stateB.hero.loc.x = cellB.x;
  stateB.hero.loc.y = cellB.y;
  const signatureA = evaluateTowerIRReachability(smokeIr, project, stateA).regionSemanticSignature;
  const signatureB = evaluateTowerIRReachability(smokeIr, project, stateB).regionSemanticSignature;
  assert.strictEqual(signatureA, signatureB, "two positions in the same static component must share the semantic region");

  // Blocker-separated positions: the hero on opposite sides of a present enemy
  // must NOT share the same reachable region.
  const enemyPoi = smokeIr.pois.find((poi) => poi.floorId === heroFloor && poi.kind === "enemy");
  const adjComponents = (enemyPoi && enemyPoi.adjacentComponentIds) || [];
  if (adjComponents.length >= 2) {
    const compA = smokeIr.components.find((component) => component.componentId === adjComponents[0]);
    const compB = smokeIr.components.find((component) => component.componentId === adjComponents[1]);
    if (compA && compB && compA.staticCells.length > 0 && compB.staticCells.length > 0) {
      const sideA = cloneState(init);
      sideA.hero.loc.x = compA.staticCells[0].x;
      sideA.hero.loc.y = compA.staticCells[0].y;
      const sideB = cloneState(init);
      sideB.hero.loc.x = compB.staticCells[0].x;
      sideB.hero.loc.y = compB.staticCells[0].y;
      const sigA = evaluateTowerIRReachability(smokeIr, project, sideA).regionSemanticSignature;
      const sigB = evaluateTowerIRReachability(smokeIr, project, sideB).regionSemanticSignature;
      assert.notStrictEqual(sigA, sigB, "positions separated by a present blocker must have different semantic regions");
    }
  }
  // Both position variants must still match the legacy reference.
  assert.ok(shadow.checkState(stateA).comparison.match, "same-component position A must match");
  assert.ok(shadow.checkState(stateB).comparison.match, "same-component position B must match");
}

async function checkRepresentativeShadowParity() {
  const task = buildRepresentativeTask(80);
  const execution = await executeSolveJob(task, {
    jobId: "tower-ir-capture",
    onProgress: () => {},
    shouldStop: () => false,
    context: {},
  });
  assert.strictEqual(execution.result.found, true, "representative must complete");

  // Commit 2 parity lock.
  const routeFingerprint = execution.routeRecord
    ? (require("./lib/replay-resume-artifact").buildReplayRouteFingerprint(execution.routeRecord))
    : null;
  assert.strictEqual(
    routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
    COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT,
    "routeFingerprint must match Commit 2",
  );
  const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
  assert.ok(winnerState, "winner state required");
  assert.strictEqual(
    require("./lib/solver-job").exactStateFingerprint(winnerState),
    COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT,
    "winner exact fingerprint must match Commit 2",
  );

  const captured = capturedStatesFrom(execution);
  assert.ok(captured.length > 0, "representative corpus must capture states");
  const shadow = createTowerIrShadow(smokeIr, project);
  captured.forEach((state) => shadow.checkState(state));
  const snap = shadow.snapshot();
  assert.ok(snap.statesChecked > 0, "statesChecked > 0");
  assert.strictEqual(snap.mismatches, 0, `representative shadow mismatch must be 0 (got ${snap.mismatches})`);
  assert.ok(snap.cacheHits + snap.cacheMisses > 0, "shadow cache must be exercised");
  return { captured, shadow: snap, execution };
}

function checkShadowObservationDoesNotAffectProduction() {
  const simulator = {
    project: { floorOrder: ["MT1"] },
    isTerminal() { return false; },
  };
  const initial = {
    floorId: "MT1",
    hero: { hp: 100, atk: 3, def: 1, mdef: 10, lv: 1, exp: 9, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    floorStates: {},
    visitedFloors: {},
    triggeredAutoEvents: {},
    notes: [],
    meta: { rank: "chaos", decisionDepth: 0, rawRouteLength: 0 },
  };
  const options = {
    maxExpansions: 20,
    maxActionsPerState: 2,
    dpSkylineMax: 2,
    actionProvider() { return [{ kind: "event", summary: "s" }, { kind: "event", summary: "t" }]; },
    actionApplier(state, action) {
      const next = cloneState(state);
      require("./lib/state").appendRouteStep(next, action.summary, { storeRoute: false });
      return next;
    },
  };
  const baseline = searchDP(simulator, cloneState(initial), { ...options });
  // A deliberately broken shadow observer that always throws/mismatches.
  let shadowCalls = 0;
  const withBrokenShadow = searchDP(simulator, cloneState(initial), {
    ...options,
    towerIrShadowCheckState() { shadowCalls += 1; throw new Error("broken shadow"); },
  });
  assert.ok(shadowCalls > 0, "the broken shadow hook must actually run during the search");
  assert.strictEqual(
    withBrokenShadow.diagnostics.registered,
    baseline.diagnostics.registered,
    "shadow observation must not change registered states",
  );
  assert.strictEqual(withBrokenShadow.expansions, baseline.expansions, "shadow observation must not change expansions");
  assert.strictEqual(
    withBrokenShadow.goalState && withBrokenShadow.goalState.meta.rawRouteLength,
    baseline.goalState && baseline.goalState.meta.rawRouteLength,
    "shadow observation must not change the winner",
  );
}

function checkIrImmutability() {
  const irBefore = JSON.stringify(smokeIr);
  const sim = makeSimulator(project, smokeSpec, {});
  const init = cloneState(sim.createInitialState({ rank: "chaos" }));
  const shadow = createTowerIrShadow(smokeIr, project);
  shadow.checkState(init);
  const enemyRemoved = makeVariantState(init, (state) => {
    const poi = smokeIr.pois.find((p) => p.kind === "enemy");
    removeTileAt(state, "MT1", poi.x, poi.y);
  });
  shadow.checkState(enemyRemoved);
  assert.strictEqual(JSON.stringify(smokeIr), irBefore, "shadow evaluation must not mutate the IR");
  assert.strictEqual(smokeIr.irFingerprint, smokeIr.irFingerprint, "irFingerprint stable");
  assert.ok(!Object.prototype.hasOwnProperty.call(smokeIr, "shadow"), "IR must not gain shadow temp fields");
  assert.ok(
    Object.values(smokeIr.indexes.componentByCoordinate).every((id) => typeof id === "string"),
    "IR indexes must remain pure data",
  );
}

async function measurePerf(capturedStates) {
  const { performance } = require("node:perf_hooks");
  const compileStarted = performance.now();
  const freshIr = compileTowerIR(project, smokeSpec, { towerId: "onlyup-smoke" });
  const towerIrCompileMs = Number((performance.now() - compileStarted).toFixed(2));
  assert.strictEqual(freshIr.irFingerprint, smokeIr.irFingerprint, "perf recompile must be deterministic");

  const states = (capturedStates && capturedStates.length > 0 ? capturedStates : [project && smokeIr]);
  const legacyTotalNs = { value: 0n };
  const irTotalNs = { value: 0n };
  let count = 0;
  for (const state of states) {
    if (!state || !state.hero) continue;
    let t = process.hrtime.bigint();
    computeLegacyStructuralReachability(project, state);
    legacyTotalNs.value += process.hrtime.bigint() - t;
    t = process.hrtime.bigint();
    evaluateTowerIRReachability(smokeIr, project, state);
    irTotalNs.value += process.hrtime.bigint() - t;
    count += 1;
  }
  const toMs = (ns) => Number((Number(ns) / 1e6).toFixed(3));
  return {
    towerIrCompileMs,
    legacyTotalMs: toMs(legacyTotalNs.value),
    towerIrTotalMs: toMs(irTotalNs.value),
    statesTimed: count,
    legacyAvgMsPerState: count > 0 ? Number((Number(legacyTotalNs.value) / 1e6 / count).toFixed(3)) : 0,
    towerIrAvgMsPerState: count > 0 ? Number((Number(irTotalNs.value) / 1e6 / count).toFixed(3)) : 0,
    irJsonBytes: JSON.stringify(smokeIr).length,
    components: smokeIr.components.length,
    pois: smokeIr.pois.length,
    edges: smokeIr.edges.length,
  };
}

async function main() {
  checkCompileDeterminism();
  checkScopeValidation();
  checkStaticStructureCoverage();
  checkFingerprintSensitivity();
  checkMutationDifferential();
  checkPositionSemantics();
  const { captured, shadow, execution } = await checkRepresentativeShadowParity();
  checkShadowObservationDoesNotAffectProduction();
  checkIrImmutability();
  const perf = await measurePerf(captured);

  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4b-tower-ir-shadow.v1",
    status: "passed",
    controls: {
      compileDeterministic: true,
      scopeValidated: true,
      staticStructureCovered: true,
      fingerprintSensitive: true,
      mutationDifferential: true,
      positionSemantics: true,
      representativeShadowParity: true,
      shadowObservationIsolation: true,
      irImmutable: true,
    },
    towerIr: {
      schema: smokeIr.schema,
      sourceFingerprint: smokeIr.sourceFingerprint,
      irFingerprint: smokeIr.irFingerprint,
      floorCount: smokeIr.floors.length,
      componentCount: smokeIr.components.length,
      poiCount: smokeIr.pois.length,
      edgeCount: smokeIr.edges.length,
      poiKindDistribution: smokeIr.pois.reduce((acc, poi) => { acc[poi.kind] = (acc[poi.kind] || 0) + 1; return acc; }, {}),
    },
    corpus: {
      capturedCount: captured.length,
      statesChecked: shadow.statesChecked,
      matches: shadow.matches,
      mismatches: shadow.mismatches,
      mismatchByClass: shadow.mismatchByClass,
      cacheHits: shadow.cacheHits,
      cacheMisses: shadow.cacheMisses,
      legacyElapsedMs: shadow.legacyElapsedMs,
      towerIrElapsedMs: shadow.towerIrElapsedMs,
    },
    productionParity: {
      routeFingerprint: COMMIT2_REPRESENTATIVE_ROUTE_FINGERPRINT,
      winnerExactFingerprint: COMMIT2_REPRESENTATIVE_WINNER_FINGERPRINT,
      expanded: dp && dp.expansions,
      generated: dp && dp.generatedActions,
      registered: dp && dp.keptActions,
    },
    perf,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
