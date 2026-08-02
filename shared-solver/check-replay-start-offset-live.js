"use strict";

const assert = require("node:assert");
const path = require("node:path");

const {
  FIXED_INPUTS,
  buildCheckpointRoute,
  ensureFixedRoute,
} = require("./audit-replay-start-offset-contract");
const { buildCrossFloorControl } = require("./audit-replay-flag-identity-contract");
const { ReplaySession } = require("./lib/replay-session");
const { findBrowserExecutable } = require("./lib/live-replay");

function displayOf(status) {
  const displayed = status.display || {};
  const hero = displayed.hero || {};
  return {
    floorId: displayed.floorId || null,
    x: hero.x,
    y: hero.y,
    direction: hero.direction,
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
  };
}

function snapshotDisplay(snapshot) {
  const hero = (snapshot && snapshot.hero) || {};
  const loc = hero.loc || {};
  return {
    floorId: (snapshot && snapshot.floorId) || null,
    x: loc.x,
    y: loc.y,
    direction: loc.direction,
    hp: hero.hp,
    atk: hero.atk,
    def: hero.def,
    mdef: hero.mdef,
  };
}

function liveOptions(input) {
  return {
    headless: "1",
    keepOpen: false,
    stepDelayMs: 0,
    fastForwardDelayMs: 0,
    timeoutMs: 30000,
    runtimeAutoBattle: input.tower === "onlyup" ? 1 : 0,
  };
}

async function runValidControl(input, routeRecord, requestedFromStep, expectedPauseSnapshot, id) {
  const session = new ReplaySession({
    routeRecord,
    projectRoot: input.projectRoot,
    liveOptions: liveOptions(input),
  });
  try {
    await session.start({ fromStep: requestedFromStep });
    const paused = await session.getStatusAsync();
    const effectiveFromStep = requestedFromStep === 0 ? 1 : requestedFromStep;
    assert.strictEqual(paused.state, "paused", `${id}: paused state`);
    assert.strictEqual(paused.currentStep, effectiveFromStep, `${id}: current step`);
    assert.strictEqual(paused.lastCompletedStep, effectiveFromStep - 1, `${id}: last completed step`);
    assert.deepStrictEqual(displayOf(paused), snapshotDisplay(expectedPauseSnapshot), `${id}: displayed pause floor/hero`);
    assert.strictEqual(paused.nextDecision.index, effectiveFromStep, `${id}: next decision index`);
    assert.ok(paused.expectedRuntimeSnapshotIdentity, `${id}: expected runtime snapshot identity`);
    assert.strictEqual(paused.runtimeSnapshotIdentityMatches, true, `${id}: runtime snapshot identity at pause`);
    assert.strictEqual(paused.runtimeSnapshotIdentity, paused.expectedRuntimeSnapshotIdentity, `${id}: runtime identity hash at pause`);
    assert.strictEqual(paused.runtimeSolverExactStateMatches, true, `${id}: reconstructed runtime solver exact state at pause`);
    const expectedStartLeaveLoc = (((session.routeRecord.start || {}).snapshot || {}).flags || {}).__leaveLoc__ || null;
    if (expectedStartLeaveLoc) {
      assert.deepStrictEqual(
        (((session.lastRuntimeSnapshot || {}).flags || {}).__leaveLoc__) || null,
        expectedStartLeaveLoc,
        `${id}: runtime __leaveLoc__ at pause`,
      );
    }

    await session.play({ stepDelayMs: 0 });
    const final = await session.getStatusAsync();
    assert.strictEqual(final.state, "completed", `${id}: completed state`);
    assert.strictEqual(final.lastCompletedStep, routeRecord.decisions.length, `${id}: final last completed step`);
    assert.strictEqual(final.lastMismatch, null, `${id}: final mismatch`);
    assert.deepStrictEqual(displayOf(final), snapshotDisplay(routeRecord.final.snapshot), `${id}: displayed final floor/hero`);
    assert.strictEqual(final.expectedExactStateKey, routeRecord.final.exactStateKey, `${id}: final exact state`);
    assert.strictEqual(final.runtimeSnapshotIdentityMatches, true, `${id}: final runtime snapshot identity`);
    assert.strictEqual(final.runtimeSnapshotIdentity, final.expectedRuntimeSnapshotIdentity, `${id}: final runtime identity hash`);
    assert.strictEqual(final.runtimeSolverExactStateMatches, true, `${id}: reconstructed runtime solver exact state`);
    const expectedFinalLeaveLoc = (((finalExpectedSnapshot(routeRecord) || {}).flags || {}).__leaveLoc__) || expectedStartLeaveLoc;
    if (expectedFinalLeaveLoc) {
      assert.deepStrictEqual(
        (((session.lastRuntimeSnapshot || {}).flags || {}).__leaveLoc__) || null,
        expectedFinalLeaveLoc,
        `${id}: final runtime __leaveLoc__`,
      );
    }
    assert.deepStrictEqual(
      Object.keys(final.stepStatuses).filter((step) => final.stepStatuses[step] === "ok").map(Number),
      routeRecord.decisions.map((decision) => decision.index),
      `${id}: all decisions verified`,
    );
    return {
      id,
      requestedFromStep,
      paused: {
        currentStep: paused.currentStep,
        lastCompletedStep: paused.lastCompletedStep,
        displayed: displayOf(paused),
      },
      final: {
        state: final.state,
        lastCompletedStep: final.lastCompletedStep,
        displayed: displayOf(final),
        exactStateKeyMatches: final.expectedExactStateKey === routeRecord.final.exactStateKey,
        runtimeSnapshotIdentityMatches: final.runtimeSnapshotIdentityMatches,
        runtimeSnapshotIdentity: final.runtimeSnapshotIdentity,
        expectedRuntimeSnapshotIdentity: final.expectedRuntimeSnapshotIdentity,
        runtimeSolverExactStateMatches: final.runtimeSolverExactStateMatches,
        verifiedSteps: Object.keys(final.stepStatuses).filter((step) => final.stepStatuses[step] === "ok").length,
      },
    };
  } finally {
    await session.close();
  }
}

function finalExpectedSnapshot(routeRecord) {
  return (routeRecord.final || {}).snapshot || null;
}

async function runOutOfRangeControl(input, routeRecord, requestedFromStep, id) {
  const session = new ReplaySession({
    routeRecord,
    projectRoot: input.projectRoot,
    liveOptions: liveOptions(input),
  });
  try {
    await assert.rejects(
      () => session.start({ fromStep: requestedFromStep }),
      (error) => error && error.code === "REPLAY_STEP_OUT_OF_RANGE" && error.statusCode === 400,
      `${id}: out-of-range request must be rejected before browser launch`,
    );
    assert.strictEqual(session.runtime, null, `${id}: runtime not launched`);
    assert.strictEqual(session.state, "idle", `${id}: session remains idle`);
    return {
      id,
      requestedFromStep,
      code: "REPLAY_STEP_OUT_OF_RANGE",
      statusCode: 400,
      runtimeLaunched: false,
      sessionState: session.state,
    };
  } finally {
    await session.close();
  }
}

async function main() {
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for live replay smoke");
  const inputs = FIXED_INPUTS.map(ensureFixedRoute);
  const results = [];
  for (const input of inputs) {
    const routeRecord = input.routeRecord;
    for (const requestedFromStep of [0, 1, routeRecord.decisions.length]) {
      const effectiveFromStep = requestedFromStep === 0 ? 1 : requestedFromStep;
      const expectedPauseSnapshot = effectiveFromStep === 1
        ? routeRecord.start.snapshot
        : routeRecord.decisions[effectiveFromStep - 2].postSnapshot;
      results.push(await runValidControl(
        input,
        routeRecord,
        requestedFromStep,
        expectedPauseSnapshot,
        `${input.id}-from-step-${requestedFromStep}`,
      ));
    }

    const checkpointRoute = buildCheckpointRoute(routeRecord, 1, { projectRoot: input.projectRoot });
    results.push(await runValidControl(
      input,
      checkpointRoute,
      1,
      routeRecord.decisions[0].postSnapshot,
      `${input.id}-checkpoint-plus-from-step-1`,
    ));
    results.push(await runOutOfRangeControl(
      input,
      routeRecord,
      routeRecord.decisions.length + 1,
      `${input.id}-from-step-too-large`,
    ));
    results.push(await runOutOfRangeControl(
      input,
      routeRecord,
      -1,
      `${input.id}-from-step-negative`,
    ));
    results.push(await runOutOfRangeControl(
      input,
      routeRecord,
      1.5,
      `${input.id}-from-step-non-integer`,
    ));
    results.push(await runOutOfRangeControl(
      input,
      routeRecord,
      "abc",
      `${input.id}-from-step-nonnumeric-cli-value`,
    ));
  }
  const crossFloor = buildCrossFloorControl();
  const crossFloorResult = await runValidControl(
    {
      id: "onlyup-pr-5.1a1-cross-floor",
      projectRoot: crossFloor.projectRoot,
      tower: "onlyup",
    },
    crossFloor.routeRecord,
    0,
    crossFloor.routeRecord.start.snapshot,
    "onlyup-pr-5.1a1-cross-floor-changeFloor-floorFly",
  );
  assert.deepStrictEqual(
    crossFloorResult.final.displayed,
    {
      floorId: "MT1",
      x: 6,
      y: 0,
      direction: "up",
      hp: crossFloor.routeRecord.final.snapshot.hero.hp,
      atk: crossFloor.routeRecord.final.snapshot.hero.atk,
      def: crossFloor.routeRecord.final.snapshot.hero.def,
      mdef: crossFloor.routeRecord.final.snapshot.hero.mdef,
    },
    "cross-floor live final landing",
  );
  results.push({
    id: "onlyup-pr-5.1a1-cross-floor-changeFloor-floorFly",
    kind: "cross-floor-identity",
    actions: {
      changeFloor: crossFloor.routeRecord.decisions[0].summary,
      floorFly: crossFloor.routeRecord.decisions[1].summary,
    },
    expectedFinalLeaveLoc: crossFloor.routeRecord.final.snapshot.flags.__leaveLoc__,
    ...crossFloorResult,
  });
  process.stdout.write(`${JSON.stringify({ schema: "motapathfinder.pr-5.1a-replay-start-offset-live.v1", status: "passed", results }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
