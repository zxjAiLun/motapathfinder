"use strict";

/**
 * TEST GRADE: unit (clean-checkout, no tower project loaded)
 *
 * Contract (PR-5.33a): the solver must never silently certify a route that
 * depends on a game effect it cannot reproduce, and a search that dropped real
 * transitions because they could not be modeled must never read as a complete
 * "no route" search.
 *
 * Two layers are covered:
 *   1. events.executeActionList throws UnsupportedEventError on unknown
 *      state-changing action types (e.g. unloadEquip / insert / unfollow) that
 *      were previously appended to state.notes and skipped. Presentation
 *      no-ops (function / setText / showStatusBar) still pass, and supported
 *      state-changing actions (setValue / hide) still apply.
 *   2. searchDP counts provider/apply errors as modelErrors and buildSearchOutcome
 *      forces searchComplete=false with a *-model-errors outcome class, so an
 *      exhausted frontier with dropped transitions is not mislabeled complete.
 */

const assert = require("node:assert");

const {
  executeActionList,
  UnsupportedEventError,
  isSupportedEventType,
} = require("./lib/events");
const { searchDP } = require("./lib/dp-search");
const { buildResultSearchOutcome } = require("./lib/search-outcome");
const { buildSolverDoctorReport } = require("./lib/solver-doctor");

function makeEventProject() {
  return {
    floorsById: {
      SYN: { floorId: "SYN", width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], changeFloor: {} },
    },
    mapNumbersById: {},
    mapTilesByNumber: {},
  };
}

function makeEventState() {
  return {
    floorId: "SYN",
    hero: { hp: 100, atk: 10, def: 10, mdef: 0, lv: 1, exp: 0, money: 0, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    visitedFloors: { SYN: true },
    floorStates: { SYN: { removed: {}, replaced: {} } },
    route: [],
    notes: [],
  };
}

function assertThrowsUnsupported(actions, expectedType) {
  const project = makeEventProject();
  const state = makeEventState();
  let thrown = null;
  try {
    executeActionList(project, state, actions, { eventLoc: { x: 1, y: 1 } }, {});
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `unsupported action list should throw: ${JSON.stringify(actions)}`);
  assert(thrown instanceof UnsupportedEventError, `should throw UnsupportedEventError, got ${thrown && thrown.name}`);
  assert.strictEqual(thrown.code, "UNSUPPORTED_EVENT_ACTION");
  if (expectedType != null) assert.strictEqual(thrown.eventType, expectedType);
  // The route/state must NOT have silently absorbed the unsupported effect as a note.
  assert.deepStrictEqual(
    state.notes.filter((note) => /Unsupported/i.test(note)),
    [],
    "unsupported effects must throw, never degrade into a silent note",
  );
}

function checkUnsupportedStateEffectsThrow() {
  // The concrete counterexample: the Neko Boss afterBattle uses unloadEquip and
  // insert("清空状态"). Both were previously silent notes; both must now throw.
  assertThrowsUnsupported([{ type: "unloadEquip" }], "unloadEquip");
  assertThrowsUnsupported([{ type: "insert", name: "清空状态" }], "insert");
  assertThrowsUnsupported([{ type: "unfollow" }], "unfollow");
  // Nested inside a supported control-flow branch it must still surface.
  assertThrowsUnsupported(
    [{ type: "if", condition: "1", true: [{ type: "setValue", name: "status:hp", operator: "+=", value: "10" }, { type: "unloadEquip" }], false: [] }],
    "unloadEquip",
  );
  // Unknown setBlock number is an unrepresentable map mutation, not a note.
  assertThrowsUnsupported([{ type: "setBlock", loc: [1, 1], number: "DOES_NOT_EXIST" }], "setBlock");
}

function checkPresentationNoopsAndSupportedStillWork() {
  assert.strictEqual(isSupportedEventType("function"), true, "presentation script stays a supported no-op");
  assert.strictEqual(isSupportedEventType("setText"), true);
  assert.strictEqual(isSupportedEventType("unloadEquip"), false);

  const project = makeEventProject();
  const state = makeEventState();
  // Presentation no-ops (including arbitrary function bodies) must not throw and
  // must not mutate representable state.
  executeActionList(project, state, [
    { type: "showStatusBar" },
    { type: "setText", text: "hello" },
    { type: "function", function: "function(){ core.doSomethingUnmodeled(); }" },
    { type: "comment", text: "x" },
  ], { eventLoc: { x: 1, y: 1 } }, {});
  assert.strictEqual(state.hero.hp, 100, "presentation no-ops must not change hp");
  assert.deepStrictEqual(state.notes.filter((n) => /Unsupported/i.test(n)), []);

  // Supported state-changing actions still apply.
  executeActionList(project, state, [
    { type: "setValue", name: "status:atk", operator: "+=", value: "5" },
  ], { eventLoc: { x: 1, y: 1 } }, {});
  assert.strictEqual(state.hero.atk, 15, "supported setValue must still apply");
}

// --- searchDP model-error classification (F4 counterexample) -----------------

function makeState(hp, route) {
  return {
    floorId: "SYN",
    hero: { hp, hpmax: 100, atk: 1, def: 1, mdef: 0, lv: 1, exp: 0, money: 0, loc: { x: 1, y: 1, direction: "down" } },
    inventory: {},
    flags: {},
    visitedFloors: { SYN: true },
    floorStates: { SYN: { removed: {}, replaced: {} } },
    route: Array.isArray(route) ? route.slice() : [],
    notes: [],
    meta: { decisionDepth: Array.isArray(route) ? route.length : 0 },
  };
}

function makeErrorSimulator() {
  return {
    project: { floorsById: { SYN: { floorId: "SYN", width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], changeFloor: {} } } },
    createInitialState: () => makeState(50, []),
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => state.route.length > 0
      ? { actions: [] }
      : {
          actions: [
            // A dead-end that applies cleanly (keeps the frontier finite).
            { kind: "walk", summary: "walk:deadend@SYN:2,1" },
            // A transition whose apply hits an unsupported event effect.
            { kind: "event", summary: "event:unmodeled@SYN:1,2" },
          ],
        },
    applyAction: (state, action) => {
      if (action.summary.startsWith("event:unmodeled")) {
        throw new UnsupportedEventError({ type: "unloadEquip" });
      }
      return makeState(40, state.route.concat(action.summary));
    },
  };
}

function checkSearchDpModelErrorClassification() {
  const result = searchDP(makeErrorSimulator(), makeState(50, []), {
    maxExpansions: 50,
    maxActionsPerState: 10,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    // Unreachable goal: the only "improving" transition is the unmodeled one.
    goalPredicate: (state) => state.hero.hp >= 100,
  });

  assert.strictEqual(result.bestGoalState, null, "goal is unreachable in the synthetic tower");
  assert.strictEqual(result.applyErrors, 1, "the unmodeled apply must be counted as an apply error");
  assert.strictEqual(result.modelErrors, 1, "modelErrors must include the apply error");
  assert.strictEqual(result.diagnostics.modelErrors.applyErrors, 1);

  const outcome = result.searchOutcome;
  assert.strictEqual(outcome.goalFound, false);
  assert.strictEqual(outcome.frontierExhausted, true, "frontier should empty (finite synthetic tower)");
  assert.strictEqual(outcome.modelErrorsEncountered, true, "outcome must flag model errors");
  assert.strictEqual(
    outcome.searchComplete,
    false,
    "a search that dropped an unrepresentable transition must NOT read as complete",
  );
  assert.strictEqual(outcome.outcomeClass, "goal-not-found-search-incomplete-model-errors");

  // Aggregation across a segment result must preserve the reason.
  const aggregated = buildResultSearchOutcome({
    found: false,
    segmentResults: [{ segmentId: "syn", attempts: [{ found: false, diagnostics: { dp: result.diagnostics } }] }],
  });
  assert.strictEqual(aggregated.searchComplete, false, "aggregated outcome must stay incomplete");
  assert.strictEqual(aggregated.modelErrorsEncountered, true);
  assert.strictEqual(aggregated.outcomeClass, "goal-not-found-search-incomplete-model-errors");

  // The doctor must warn instead of implying exhaustive no-route.
  const doctor = buildSolverDoctorReport({
    found: false,
    failedSegment: { segmentId: "syn", attempts: [{ found: false, diagnostics: { dp: result.diagnostics } }] },
    segmentResults: [{ segmentId: "syn", attempts: [{ found: false, diagnostics: { dp: result.diagnostics } }] }],
  });
  assert.strictEqual(doctor.evidence.modelErrors, 1, "doctor evidence must record model errors");
  assert.ok(/NOT exhaustive no-route/i.test(doctor.line), `doctor line must warn: ${doctor.line}`);
}

function checkCleanSearchStaysComplete() {
  // Control: with no model errors, an exhausted frontier stays complete. This
  // guards against the fix over-flagging ordinary not-found searches.
  const simulator = {
    project: { floorsById: { SYN: { floorId: "SYN", width: 3, height: 3, map: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], changeFloor: {} } } },
    createInitialState: () => makeState(50, []),
    getActionFingerprint: (action) => `fp:${action.summary}`,
    enumeratePrimitiveActions: (state) => state.route.length > 0
      ? { actions: [] }
      : { actions: [{ kind: "walk", summary: "walk:deadend@SYN:2,1" }] },
    applyAction: (state, action) => makeState(40, state.route.concat(action.summary)),
  };
  const result = searchDP(simulator, makeState(50, []), {
    maxExpansions: 50,
    dpSkylineMax: 1,
    stopOnFirstGoal: false,
    goalPredicate: (state) => state.hero.hp >= 100,
  });
  assert.strictEqual(result.modelErrors, 0);
  assert.strictEqual(result.searchOutcome.searchComplete, true, "clean exhausted frontier stays complete");
  assert.strictEqual(result.searchOutcome.outcomeClass, "goal-not-found-search-complete");
}

function main() {
  checkUnsupportedStateEffectsThrow();
  checkPresentationNoopsAndSupportedStillWork();
  checkSearchDpModelErrorClassification();
  checkCleanSearchStaysComplete();
  console.log("check-unsupported-event-fidelity: ok (events throw on unmodeled effects; model errors block false completeness)");
}

if (require.main === module) main();

module.exports = { main };
