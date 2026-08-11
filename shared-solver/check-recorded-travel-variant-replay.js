"use strict";

/**
 * TEST GRADE: replay-resolution-contract
 *
 * PR-5.8e keeps choice identity separate from travel-variant identity. These
 * synthetic controls pin unique exact-post selection, fail-closed behavior
 * when no exact post exists, and deterministic resolution when multiple
 * travel variants produce the same exact post.
 */

const assert = require("node:assert");

const {
  applyResolvedAction,
  enumerateRecordedActionCandidates,
  normalizeAction,
  recordedActionVariantIdentity,
  resolveRecordedAction,
} = require("./lib/route-store");

const SUMMARY = "changeFloor@SYNTHETIC:6,0";

function makeTravelState(hp, pathTag) {
  return {
    floorId: "SYNTHETIC",
    hero: {
      hp,
      hpmax: 1000,
      mana: 0,
      manamax: 0,
      atk: 10,
      def: 10,
      mdef: 0,
      money: 0,
      exp: 0,
      lv: 1,
      equipment: [],
      followers: [],
      loc: { x: 6, y: 1, direction: "up" },
    },
    inventory: {},
    flags: { pathTag },
    visitedFloors: { SYNTHETIC: true },
    floorStates: {},
    route: [],
  };
}

function makeVariant(id, pathLength, postExactStateKey) {
  const path = Array.from({ length: pathLength }, (_, index) => `${id}-${index}`);
  return {
    kind: "changeFloor",
    summary: SUMMARY,
    floorId: "SYNTHETIC",
    target: { floorId: "SYNTHETIC", x: 6, y: 0 },
    stance: { floorId: "SYNTHETIC", x: 6, y: 1 },
    changeFloor: { floorId: "NEXT", x: 6, y: 12 },
    path,
    travelState: makeTravelState(100 + pathLength, id),
    __variantId: id,
    __postState: { exact: postExactStateKey, variantId: id },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSimulator(variants) {
  const stats = { applyActionCalls: 0 };
  return {
    stats,
    enumerateActions: () => variants.map(cloneJson),
    enumeratePrimitiveActions: () => ({ actions: variants.map(cloneJson) }),
    enumerateInteractPickupActions: () => [],
    enumerateFloorFlyActions: () => [],
    applyAction: (state, action) => {
      stats.applyActionCalls += 1;
      return cloneJson(action.__postState);
    },
  };
}

function decisionFrom(variant, postExactStateKey, includePath) {
  const normalized = normalizeAction(variant);
  return {
    kind: normalized.kind,
    summary: normalized.summary,
    floorId: normalized.floorId,
    target: normalized.target,
    stance: normalized.stance,
    changeFloor: normalized.changeFloor,
    fingerprint: normalized.fingerprint,
    path: includePath ? normalized.path : [],
    postExactStateKey,
  };
}

function resolve(simulator, decision, candidates, options) {
  return resolveRecordedAction(
    simulator,
    makeTravelState(100, "root"),
    decision,
    {
      candidates,
      postExactStateKeyBuilder: (state) => state.exact,
      postStateKeyBuilder: (state) => state.exact,
      ...(options || {}),
    },
  );
}

function main() {
  const uniqueA = makeVariant("A", 7, "post-A");
  const uniqueB = makeVariant("B", 9, "post-B");
  const uniqueC = makeVariant("C", 17, "post-C");
  const uniqueSimulator = makeSimulator([uniqueA, uniqueB, uniqueC]);
  const enumerated = enumerateRecordedActionCandidates(
    uniqueSimulator,
    makeTravelState(100, "root"),
  );
  assert.strictEqual(enumerated.errors.length, 0);
  assert.strictEqual(
    enumerated.actions.length,
    3,
    "duplicate providers must collapse only identical travel variants",
  );

  const uniqueExact = resolve(
    uniqueSimulator,
    decisionFrom(uniqueC, "post-C", true),
    enumerated.actions,
  );
  assert.strictEqual(uniqueExact.action.__variantId, "C");
  assert.strictEqual(uniqueExact.matchType, "postExactState");
  assert.strictEqual(uniqueExact.choiceAliasCount, 3);
  assert.strictEqual(uniqueExact.exactPostAliasCount, 1);
  assert.strictEqual(uniqueExact.exactPostTieBroken, false);
  assert.strictEqual(uniqueExact.candidateApplyCount, 3);
  const callsBeforeReuse = uniqueSimulator.stats.applyActionCalls;
  const reused = applyResolvedAction(
    uniqueSimulator,
    makeTravelState(100, "root"),
    uniqueExact,
  );
  assert.strictEqual(reused.state.variantId, "C");
  assert.strictEqual(reused.reusedResolvedPostState, true);
  assert.strictEqual(
    uniqueSimulator.stats.applyActionCalls,
    callsBeforeReuse,
    "selected post-state reuse must not apply the winner twice",
  );
  const reapplied = applyResolvedAction(
    uniqueSimulator,
    makeTravelState(100, "root"),
    uniqueExact,
    { reuseResolvedPostState: false },
  );
  assert.strictEqual(reapplied.state.variantId, "C");
  assert.strictEqual(reapplied.reusedResolvedPostState, false);
  assert.strictEqual(uniqueSimulator.stats.applyActionCalls, callsBeforeReuse + 1);

  const structurallyUnrelated = makeVariant("UNRELATED", 5, "post-C");
  structurallyUnrelated.target.x = 5;
  const hardFilterSimulator = makeSimulator([
    structurallyUnrelated,
    uniqueA,
    uniqueB,
    uniqueC,
  ]);
  const hardFiltered = resolve(
    hardFilterSimulator,
    decisionFrom(uniqueC, "post-C", true),
    [structurallyUnrelated, uniqueA, uniqueB, uniqueC],
  );
  assert.strictEqual(hardFiltered.action.__variantId, "C");
  assert.strictEqual(hardFiltered.hardFilteredBeforeApply, 1);
  assert.strictEqual(hardFiltered.candidateApplyCount, 3);
  assert.strictEqual(
    hardFilterSimulator.stats.applyActionCalls,
    3,
    "a structural hard reject must not be applied before rejection",
  );
  const legacyHardFilterSimulator = makeSimulator([
    structurallyUnrelated,
    uniqueA,
    uniqueB,
    uniqueC,
  ]);
  const legacyHardFiltered = resolve(
    legacyHardFilterSimulator,
    decisionFrom(uniqueC, "post-C", true),
    [structurallyUnrelated, uniqueA, uniqueB, uniqueC],
    { deferStructuralFilterUntilAfterApply: true },
  );
  assert.strictEqual(legacyHardFiltered.action.__variantId, "C");
  assert.strictEqual(legacyHardFiltered.hardFilteredBeforeApply, 0);
  assert.strictEqual(legacyHardFiltered.hardFilteredAfterApply, 1);
  assert.strictEqual(legacyHardFilterSimulator.stats.applyActionCalls, 4);

  const noExactDecision = decisionFrom(uniqueA, "post-missing", false);
  const noExactForward = resolve(
    uniqueSimulator,
    noExactDecision,
    [uniqueA, uniqueB, uniqueC],
  );
  const noExactReverse = resolve(
    uniqueSimulator,
    noExactDecision,
    [uniqueC, uniqueB, uniqueA],
  );
  [noExactForward, noExactReverse].forEach((result) => {
    assert.strictEqual(result.action, null);
    assert.strictEqual(result.reason, "ambiguous-recorded-action");
    assert.strictEqual(result.exactPostAliasCount, 0);
  });
  assert.deepStrictEqual(
    noExactForward.matches.map((match) => match.variantIdentity),
    noExactReverse.matches.map((match) => match.variantIdentity),
    "no-exact ambiguity evidence must not depend on enumeration order",
  );

  const aliasA = makeVariant("A", 7, "post-shared");
  const aliasB = makeVariant("B", 17, "post-shared");
  const aliasC = makeVariant("C", 9, "post-other");
  const aliasSimulator = makeSimulator([aliasA, aliasB, aliasC]);
  const recordedPath = resolve(
    aliasSimulator,
    decisionFrom(aliasB, "post-shared", true),
    [aliasA, aliasB, aliasC],
  );
  assert.strictEqual(recordedPath.action.__variantId, "B");
  assert.strictEqual(recordedPath.exactPostAliasCount, 2);
  assert.strictEqual(recordedPath.selectedByRecordedTravelEvidence, true);
  assert.strictEqual(recordedPath.exactPostTieBroken, false);

  const noPathDecision = decisionFrom(aliasA, "post-shared", false);
  const deterministicForward = resolve(
    aliasSimulator,
    noPathDecision,
    [aliasA, aliasB, aliasC],
  );
  const deterministicReverse = resolve(
    aliasSimulator,
    noPathDecision,
    [aliasC, aliasB, aliasA],
  );
  const expectedVariantIdentity = [aliasA, aliasB]
    .map(recordedActionVariantIdentity)
    .sort()[0];
  [deterministicForward, deterministicReverse].forEach((result) => {
    assert.ok(result.action, "multiple exact-post aliases must resolve");
    assert.strictEqual(result.exactPostAliasCount, 2);
    assert.strictEqual(result.exactPostTieBroken, true);
    assert.strictEqual(result.selectedVariantIdentity, expectedVariantIdentity);
  });

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.recorded-travel-variant-replay.v1",
    status: "passed",
    controls: {
      choiceFingerprintStable: normalizeAction(uniqueA).fingerprint ===
        normalizeAction(uniqueB).fingerprint,
      retainedUniqueTravelVariants: enumerated.actions.length,
      uniqueExactPostSelected: uniqueExact.action.__variantId,
      selectedPostStateReuseAvoidsSecondApply: true,
      structuralHardRejectApplied: false,
      noExactPostFailsClosed: noExactForward.reason,
      noExactOrderIndependent: true,
      multipleExactUsesRecordedPath: recordedPath.action.__variantId,
      multipleExactAliasCount: recordedPath.exactPostAliasCount,
      noPathTieBreakDeterministic: true,
    },
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
