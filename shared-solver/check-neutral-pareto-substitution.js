"use strict";
/**
 * PR-5.26c - Neutral-turn Pareto substitution micros.
 *
 * Locks the scheduler contract for `neutralParetoSubstitution` with a fully
 * controlled stub world, before any capability gate runs.
 *
 * THE CONTRACT (owner-specified)
 *   On a neutral turn, if the live FIFO head is a rank-20 investment variant and
 *   a LIVE SAME-GROUP peer strictly Pareto-dominates it, spend that neutral turn
 *   on the dominator instead. Among the dominators take the current nondominated
 *   frontier, ties by insertion order. Otherwise use the original FIFO head.
 *
 *   Group = semanticIdentity + structuralStateKey. Dominance is recomputed from
 *   live nodes; the cached node.rank20ParetoDominated is never consulted.
 *
 * WHAT IT MUST NOT DO
 *   - change how often a neutral turn happens (neutralEvery untouched)
 *   - move anything into the guided heap
 *   - delete the dominated variant (HARD_PRUNING stays FALSE): the FIFO head is
 *     only deferred, never consumed, and becomes serveable again once its
 *     dominators have been expanded
 *   - compare across different actions or different worlds (that would be a
 *     hidden global resource priority, which has no evidence behind it)
 *   - invent any scalar weight
 *
 * Stub world notes: every action sits at one tile so its semantic identity is
 * identical, and leaves hero.loc untouched so buildStructuralStateKey is
 * identical. The frontier set is EMPTY, so nothing is ever guided and every
 * expansion is a neutral expansion - which makes the expansion ORDER directly
 * observable through the `expanded` lifecycle events.
 */

const fs = require("fs");
const path = require("path");

const { cloneState } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");

const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr526c-neutral-pareto-substitution.json");

const failures = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push({ label, detail: `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` });
  return ok;
};

function stubState() {
  return {
    floorId: "MT1",
    hero: {
      hp: 50, hpmax: 50, mana: 0, manamax: 0, atk: 1, def: 0, mdef: 0, money: 0, exp: 0, lv: 1,
      loc: { x: 0, y: 0, direction: "down" },
      equipment: [], followers: [],
    },
    inventory: {}, flags: {}, floorStates: {}, triggeredAutoEvents: {}, visitedFloors: { MT1: true },
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

function stubAction(summary, x, y, apply) {
  return { kind: "event", summary, x, y, stance: { x: 0, y: 0 }, __apply: apply };
}

/**
 * specs: [{ summary, x, y, hp, atk, moveTo? }]
 * A spec is rank-20 combatProgress when its ATK exceeds the base ATK of 1.
 * moveTo makes the resulting structural state key differ while keeping the
 * semantic identity identical (same tile).
 */
function createSubstitutionSimulator(specs) {
  return {
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId === "MT1" && state.hero.atk === 1 && state.hero.hp === 50) {
        return {
          actions: specs.map((spec) => stubAction(spec.summary, spec.x == null ? 1 : spec.x, spec.y == null ? 1 : spec.y, (s) => {
            s.hero.hp = spec.hp;
            s.hero.atk = spec.atk;
            if (spec.moveTo) s.hero.loc = { x: spec.moveTo.x, y: spec.moveTo.y, direction: "down" };
          })),
        };
      }
      return { actions: [] };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function runScenario(specs, opts) {
  const options = opts || {};
  const simulator = createSubstitutionSimulator(specs);
  const base = stubState();
  const keysBySummary = {};
  const summariesByKey = {};
  for (const action of simulator.enumeratePrimitiveActions(base).actions) {
    const key = buildStateKey(simulator.applyAction(base, action));
    keysBySummary[action.summary] = key;
    summariesByKey[key] = action.summary;
  }
  const events = [];
  const result = createTransportCollapsedSearch(simulator).search(base, {
    isGoalState: () => false,
    frontierSet: new Set(),
    resourceSkylinePriority: true,
    pendingCandidateCap: options.cap == null ? 50 : options.cap,
    maxExpansions: 50,
    maxRuntimeMs: 10000,
    maxClosureStates: 500,
    neutralParetoSubstitution: options.substitution === true,
    onCandidateLifecycle: (event) => { events.push(event); return null; },
  });
  const expansionOrderRaw = events
    .filter((e) => e.type === "expanded")
    .map((e) => (Object.prototype.hasOwnProperty.call(summariesByKey, e.exactKey) ? summariesByKey[e.exactKey] : null));
  const expansionOrder = expansionOrderRaw.filter((s) => s !== null);
  const unknownExpansions = expansionOrderRaw.filter((s) => s === null).length;
  const droppedSummaries = events
    .filter((e) => e.type === "dropped")
    .map((e) => summariesByKey[e.exactKey] || e.exactKey);
  return { result, events, keysBySummary, expansionOrder, unknownExpansions, droppedSummaries };
}

function main() {
  console.log("PR-5.26c neutral-turn Pareto substitution micros");

  // --- A. LATE DOMINATOR SCHEDULING ---------------------------------------
  // Generation order D1 (hp100/atk2), O (unrelated tile, rank 30), L (hp200/atk2).
  // L dominates D1; D1 and L share identity AND structural key; O is unrelated.
  const specsA = [
    { summary: "D1:weak", x: 1, y: 1, hp: 100, atk: 2 },
    { summary: "O:unrelated", x: 3, y: 1, hp: 120, atk: 1 },
    { summary: "L:strong", x: 1, y: 1, hp: 200, atk: 2 },
  ];
  const aOff = runScenario(specsA, { substitution: false });
  const aOn = runScenario(specsA, { substitution: true });
  const orderOff = aOff.expansionOrder;
  const orderOn = aOn.expansionOrder;
  console.log(`  A late dominator OFF: expansion order = ${JSON.stringify(orderOff)}`);
  console.log(`  A late dominator ON : expansion order = ${JSON.stringify(orderOn)}`);
  check("A off: FIFO head D1 is expanded first", orderOff[0], "D1:weak");
  check("A on: the strong dominator L is expanded first", orderOn[0], "L:strong");
  check("A on: the dominated variant D1 is NOT deleted (still expanded)", orderOn.includes("D1:weak"), true);
  check("A on: no candidate dropped at all", aOn.droppedSummaries, []);
  check("A on: substitution actually fired", aOn.events.filter((e) => e.type === "neutralSubstitution").length >= 1, true);
  check("A on: neutral turn count unchanged by the substitution", orderOn.length, orderOff.length);

  // --- A2. MULTI-DOMINATOR CHAIN: take the DOMINATOR FRONTIER, not the first
  // Arrival order D1 (hp100), D2 (hp120), L (hp200), all atk 2, same tile.
  // dominators(D1) = {D2, L}, but L dominates D2 - so D2 is itself dominated and
  // picking it would waste the turn exactly like picking D1 would.
  const specsA2 = [
    { summary: "D1:weakest", x: 1, y: 1, hp: 100, atk: 2 },
    { summary: "D2:middle", x: 1, y: 1, hp: 120, atk: 2 },
    { summary: "L:strongest", x: 1, y: 1, hp: 200, atk: 2 },
  ];
  const a2Off = runScenario(specsA2, { substitution: false });
  const a2On = runScenario(specsA2, { substitution: true });
  console.log(`  A2 chain OFF: ${JSON.stringify(a2Off.expansionOrder)}`);
  console.log(`  A2 chain ON : ${JSON.stringify(a2On.expansionOrder)}`);
  check("A2 off: pure FIFO", a2Off.expansionOrder, ["D1:weakest", "D2:middle", "L:strongest"]);
  check("A2 on: picks the dominator frontier L, not the first dominator D2",
    a2On.expansionOrder[0], "L:strongest");
  check("A2 on: D2 (a dominated dominator) is taken only after L",
    a2On.expansionOrder, ["L:strongest", "D2:middle", "D1:weakest"]);

  // --- B. INCOMPARABLE NEVER REORDERS -------------------------------------
  // A (hp200/atk2) and B (hp100/atk5) are mutually incomparable.
  const specsAB = [
    { summary: "A:bulk", x: 1, y: 1, hp: 200, atk: 2 },
    { summary: "B:power", x: 1, y: 1, hp: 100, atk: 5 },
  ];
  const bForward = runScenario(specsAB, { substitution: true });
  const bReverse = runScenario([specsAB[1], specsAB[0]], { substitution: true });
  const bForwardOrder = bForward.expansionOrder;
  const bReverseOrder = bReverse.expansionOrder;
  console.log(`  B incomparable forward: ${JSON.stringify(bForwardOrder)}  reverse: ${JSON.stringify(bReverseOrder)}`);
  check("B forward: FIFO order preserved", bForwardOrder, ["A:bulk", "B:power"]);
  check("B reverse: FIFO order preserved", bReverseOrder, ["B:power", "A:bulk"]);
  check("B: no substitution event for an incomparable pair",
    bForward.events.filter((e) => e.type === "neutralSubstitution").length, 0);

  // --- C. CROSS-GROUP NEVER SUBSTITUTES -----------------------------------
  // C1: B's resources strictly dominate A's, but the identities differ.
  const specsC1 = [
    { summary: "A:small", x: 1, y: 1, hp: 100, atk: 2 },
    { summary: "B:huge", x: 3, y: 1, hp: 500, atk: 9 },
  ];
  const c1 = runScenario(specsC1, { substitution: true });
  const c1Order = c1.expansionOrder;
  console.log(`  C1 different identity (B dominates A resource-wise): ${JSON.stringify(c1Order)}`);
  check("C1: different semanticIdentity never substitutes", c1Order, ["A:small", "B:huge"]);
  check("C1: no substitution event", c1.events.filter((e) => e.type === "neutralSubstitution").length, 0);

  // C2: same tile (same identity), but B moves hero.loc so the STRUCTURAL KEY
  // differs. Still a different world as far as the contract is concerned.
  const specsC2 = [
    { summary: "A:samespot", x: 1, y: 1, hp: 100, atk: 2 },
    { summary: "B:moved", x: 1, y: 1, hp: 500, atk: 9, moveTo: { x: 5, y: 5 } },
  ];
  const c2 = runScenario(specsC2, { substitution: true });
  const c2Order = c2.expansionOrder;
  console.log(`  C2 same identity, different structural key: ${JSON.stringify(c2Order)}`);
  check("C2: different structuralStateKey never substitutes", c2Order, ["A:samespot", "B:moved"]);
  check("C2: no substitution event", c2.events.filter((e) => e.type === "neutralSubstitution").length, 0);

  // --- CONTROL: the flag is off by default --------------------------------
  const defaultRun = runScenario(specsA, {});
  check("control: substitution is off by default", defaultRun.expansionOrder[0], "D1:weak");
  check("all scenarios: exactly one unknown (root) expansion each",
    [aOff.unknownExpansions, aOn.unknownExpansions, a2Off.unknownExpansions, a2On.unknownExpansions, bForward.unknownExpansions, c1.unknownExpansions, c2.unknownExpansions],
    [1, 1, 1, 1, 1, 1, 1]);

  const artifact = {
    milestone: "PR-5.26c",
    micro: "NEUTRAL_TURN_PARETO_SUBSTITUTION",
    lateDominator: { off: orderOff, on: orderOn, substitutions: aOn.events.filter((e) => e.type === "neutralSubstitution").length },
    multiDominatorChain: { off: a2Off.expansionOrder, on: a2On.expansionOrder },
    incomparable: { forward: bForwardOrder, reverse: bReverseOrder },
    crossGroup: { differentIdentity: c1Order, differentStructuralKey: c2Order },
    failures,
  };
  fs.mkdirSync(path.dirname(DEFAULT_OUT), { recursive: true });
  fs.writeFileSync(DEFAULT_OUT, `${JSON.stringify(artifact, null, 2)}\n`);

  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures) console.log(`    ${f.label}: ${f.detail}`);
  } else {
    console.log("  PASS");
  }
  if (failures.length > 0) process.exitCode = 1;
}

main();
