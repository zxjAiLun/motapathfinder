"use strict";
/**
 * PR-5.26k - Guided head retention micros.
 *
 * THE COUPLING BEING REMOVED
 *   `guidedAdmitted` currently means two things at once: "the guided scheduler
 *   should serve this candidate earlier" AND "this candidate keeps a permanent
 *   rank-10 storage entitlement". PR-5.26h saw the extreme form (a pool that is
 *   1024/1024 rank 10), and PR-5.26j saw the same coupling at long horizon on
 *   the legacy policy: the first real prefix loss was a guided candidate that was
 *   not even pure-fill-kept (`pureFillKept = false`), i.e. it never even reached
 *   the service queue's reach.
 *
 * THE CONTRACT LOCKED HERE (guidedHeadRetention, opt-in, default off)
 *   1. the guided scheduler's NEXT LIVE HEAD survives the cap trim
 *   2. a guided candidate that is NOT that head gets no global rank-10 storage
 *      class - its retention class is its own value class
 *   3. a guided candidate with combat progress is retained as RANK 20, so it
 *      keeps the already-validated dynamic Pareto retention
 *   4. the pre-existing neutral FIFO head protection still works
 *   5. guided head and neutral head can both survive the same trim
 *   6. with the flag OFF nothing about retention changes at all
 *
 * Stub notes: children are guided by putting their identity `event:MT1:<x>,<y>`
 * in the frontier set, and the guided score comes from `config.priorityMap`
 * (absent == uniform 100, which is what every capability run has used). A child
 * is `combatProgress` exactly when a generic stat increases (atk 1 -> 2); it is
 * ordinary when only hp moves, because hp is not part of that predicate.
 * Children set `flags.__leaf`, so they enumerate no further actions and the
 * worlds stay tiny and deterministic.
 */

const fs = require("fs");
const path = require("path");

const { cloneState } = require("./lib/state");
const { buildStateKey } = require("./lib/state-key");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");

const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr526k-guided-head-retention.json");

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

function stubAction(spec) {
  return {
    kind: "event",
    summary: spec.label,
    x: spec.x,
    y: 5,
    stance: { x: 0, y: 0 },
    __apply: (s) => {
      s.hero.hp = spec.hp;
      s.hero.atk = spec.atk;
      s.flags.__leaf = true;
    },
  };
}

function createStubSimulator(specs) {
  return {
    project: {},
    enumeratePrimitiveActions(state) {
      if (state.floorId !== "MT1") return { actions: [] };
      if (state.flags && state.flags.__leaf) return { actions: [] };
      return { actions: specs.map(stubAction) };
    },
    applyAction(state, action) {
      const next = cloneState(state);
      if (typeof action.__apply === "function") action.__apply(next);
      return next;
    },
  };
}

function runWorld(specs, options) {
  const opts = options || {};
  const simulator = createStubSimulator(specs);
  const base = stubState();
  const labelByKey = {};
  for (const action of simulator.enumeratePrimitiveActions(base).actions) {
    labelByKey[buildStateKey(simulator.applyAction(base, action))] = action.summary;
  }
  labelByKey[buildStateKey(base)] = "ROOT";
  const events = [];
  let result = null;
  let runError = null;
  try {
    result = createTransportCollapsedSearch(simulator).search(base, {
      isGoalState: () => false,
      frontierSet: new Set(specs.filter((s) => s.guided).map((s) => `event:MT1:${s.x},5`)),
      priorityMap: new Map(specs.filter((s) => s.score != null).map((s) => [`event:MT1:${s.x},5`, s.score])),
      resourceSkylinePriority: false,
      pendingCandidateCap: opts.cap,
      maxExpansions: 40,
      maxRuntimeMs: 10000,
      maxClosureStates: 500,
      guidedHeadRetention: opts.guidedHead === true,
      onCandidateLifecycle: (event) => { events.push(event); return null; },
    });
  } catch (error) {
    runError = `${error.name}: ${error.message}`;
  }
  const label = (key) => labelByKey[key] || key;
  const dropped = events.filter((e) => e.type === "dropped").map((e) => ({
    node: label(e.exactKey),
    rankClass: e.rankClass,
    pureFillKept: e.pureFillKept,
    displacedByFifoHeadProtection: e.displacedByFifoHeadProtection === true,
    displacedByGuidedHeadProtection: e.displacedByGuidedHeadProtection === true,
    pendingRankCounts: e.trim ? e.trim.pendingRankCounts : null,
    keptRankCounts: e.trim ? e.trim.keptRankCounts : null,
  }));
  const expanded = events.filter((e) => e.type === "expanded").map((e) => label(e.exactKey));
  return { result, runError, events, dropped, expanded, droppedNodes: dropped.map((d) => d.node) };
}

// --- worlds ------------------------------------------------------------------
// W1: ordinary children only, so retention class is 30 for everyone and the
// lineup is decided purely by insertion order + the head protections.
const W1 = [
  { label: "ORD", x: 5, hp: 40, atk: 1 },
  { label: "NH", x: 6, hp: 39, atk: 1, guided: true },
  { label: "HEAD", x: 7, hp: 38, atk: 1, guided: true, score: 300 },
];
// W2: FIFO head and guided head both rank-worthy of survival, cap holds two.
const W2 = [
  { label: "F", x: 1, hp: 40, atk: 2 },
  { label: "P", x: 2, hp: 39, atk: 2 },
  { label: "G", x: 3, hp: 38, atk: 1, guided: true, score: 300 },
];
// W3: no guided work at all - the pre-existing FIFO head protection must be
// unaffected by the new flag.
const W3 = [
  { label: "F", x: 1, hp: 40, atk: 1 },
  { label: "P", x: 2, hp: 39, atk: 2 },
];
// W4: a guided candidate that also has combat progress, plus ordinary work.
const W4 = [
  { label: "GCP", x: 1, hp: 40, atk: 2, guided: true },
  { label: "O", x: 2, hp: 39, atk: 1 },
  { label: "O2", x: 3, hp: 38, atk: 1 },
];

function main() {
  console.log("PR-5.26k guided head retention micros");

  const w1On = runWorld(W1, { cap: 2, guidedHead: true });
  const w1Off = runWorld(W1, { cap: 2, guidedHead: false });
  const w2On = runWorld(W2, { cap: 2, guidedHead: true });
  const w3On = runWorld(W3, { cap: 1, guidedHead: true });
  const w4On = runWorld(W4, { cap: 2, guidedHead: true });
  const w4Off = runWorld(W4, { cap: 2, guidedHead: false });
  const worlds = { w1On, w1Off, w2On, w3On, w4On, w4Off };

  check("every world ran without throwing", Object.values(worlds).map((w) => w.runError),
    [null, null, null, null, null, null]);

  // --- 1. GUIDED_HEAD_SURVIVES_CAP -----------------------------------------
  check("1 GUIDED_HEAD_SURVIVES_CAP (head is not dropped)", w1On.droppedNodes.includes("HEAD"), false);
  check("1 the head existed and needed protection (it was not pure-fill-kept)",
    w1On.result.guidedHeadWouldHaveDroppedWithoutProtection, 1);
  check("1 counter: head protected", w1On.result.guidedHeadProtected, 1);
  check("1 the protection displaced a pure-fill-kept non-goal (NH)",
    w1On.dropped.filter((d) => d.node === "NH").map((d) => ({
      rankClass: d.rankClass, pureFillKept: d.pureFillKept, displacedByGuidedHeadProtection: d.displacedByGuidedHeadProtection,
    })), [{ rankClass: 30, pureFillKept: true, displacedByGuidedHeadProtection: true }]);

  // --- 2. NON_HEAD_GUIDED_DOES_NOT_GAIN_GLOBAL_RANK10 ----------------------
  check("2 the non-head guided candidate is NOT rank 10 in the ON arm",
    w1On.dropped.filter((d) => d.node === "NH").map((d) => d.rankClass), [30]);
  check("2 ON keeps the guided head that OFF drops", w1On.droppedNodes.includes("HEAD"), false);
  check("2 OFF drops the very guided head (its only protection is the neutral one)", w1Off.droppedNodes, ["HEAD"]);
  check("2 OFF keeps the non-head guided member that ON drops", w1Off.droppedNodes.includes("NH"), false);
  check("2 ON drops a guided member that OFF keeps (retention really changed)",
    JSON.stringify(w1On.droppedNodes) === JSON.stringify(w1Off.droppedNodes), false);

  // --- 3. GUIDED_COMBAT_PROGRESS_FALLS_BACK_TO_RANK20 ----------------------
  const w4OnTrim = w4On.dropped.length > 0 ? w4On.dropped[0] : null;
  const w4OffTrim = w4Off.dropped.length > 0 ? w4Off.dropped[0] : null;
  check("3 ON: the guided+combatProgress candidate is retained as rank 20",
    w4OnTrim && w4OnTrim.keptRankCounts, { 0: 0, 10: 0, 20: 1, 30: 1 });
  check("3 ON: no rank-10 slot exists at all", w4OnTrim && w4OnTrim.pendingRankCounts, { 0: 0, 10: 0, 20: 1, 30: 2 });
  check("3 OFF: the same candidate occupies a rank-10 slot", w4OffTrim && w4OffTrim.keptRankCounts,
    { 0: 0, 10: 1, 20: 0, 30: 1 });

  // --- 4. NEUTRAL_HEAD_PROTECTION_STILL_WORKS ------------------------------
  check("4 neutral FIFO head is protected", w3On.result.fifoHeadProtected, 1);
  check("4 the FIFO head survived and the rank-20 candidate was dropped",
    w3On.droppedNodes, ["P"]);
  check("4 no guided head existed in this world",
    w3On.result.guidedHeadProtectionOpportunities, 0);

  // --- 5. GUIDED_AND_NEUTRAL_HEAD_CAN_COEXIST ------------------------------
  check("5 the FIFO head survives", w2On.droppedNodes.includes("F"), false);
  check("5 the guided head survives", w2On.droppedNodes.includes("G"), false);
  check("5 the ordinary peer is the one dropped", w2On.droppedNodes, ["P"]);
  check("5 the guided head was saved by the new protection", w2On.result.guidedHeadProtected, 1);
  check("5 it was not displaced back afterwards",
    w2On.result.guidedHeadDisplacedAfterProtection, 0);

  // --- 6. FLAG_OFF = LEGACY RETENTION --------------------------------------
  check("6 OFF: no guided head protection ran at all",
    [w1Off.result.guidedHeadProtectionOpportunities, w1Off.result.guidedHeadProtected,
      w1Off.result.guidedHeadStaleTopPops, w1Off.result.guidedHeadNotPendingAtTrim,
      w1Off.result.guidedHeadWouldHaveDroppedWithoutProtection,
      w1Off.result.guidedHeadDisplacedAfterProtection], [0, 0, 0, 0, 0, 0]);
  check("6 OFF: guided membership still means rank 10",
    w1Off.result.rank10PendingAtEnd + w1Off.dropped.filter((d) => d.rankClass === 10).length > 0, true);
  check("6 the flag is reported per run", [w1Off.result.guidedHeadRetention, w1On.result.guidedHeadRetention],
    [false, true]);

  // --- 7. scheduler side is untouched in both arms ------------------------
  check("scheduler: the same number of candidates is guided-admitted",
    [w1Off.result.guidedAdmittedGenerated, w1On.result.guidedAdmittedGenerated], [2, 2]);
  check("scheduler: the same number of candidates is frontier-guided",
    [w1Off.result.frontierGuidedGenerated, w1On.result.frontierGuidedGenerated], [2, 2]);

  for (const [name, w] of Object.entries(worlds)) {
    console.log(`  ${name.padEnd(6)} dropped=${JSON.stringify(w.droppedNodes)} expanded=${JSON.stringify(w.expanded)} ` +
      `guidedHead(opp/prot/wouldDrop/displacedBack)=${w.result.guidedHeadProtectionOpportunities}/` +
      `${w.result.guidedHeadProtected}/${w.result.guidedHeadWouldHaveDroppedWithoutProtection}/` +
      `${w.result.guidedHeadDisplacedAfterProtection} fifoProtected=${w.result.fifoHeadProtected}`);
  }

  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures) console.log(`    ${f.label}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("  PASS");
  }

  const outArg = process.argv.slice(2).find((t) => t.startsWith("--out="));
  const outPath = outArg ? path.resolve(outArg.slice("--out=".length)) : DEFAULT_OUT;
  const summary = {
    milestone: "PR-5.26k",
    audit: "GUIDED_HEAD_RETENTION_MICROS",
    properties: {
      GUIDED_HEAD_SURVIVES_CAP: true,
      NON_HEAD_GUIDED_DOES_NOT_GAIN_GLOBAL_RANK10: true,
      GUIDED_COMBAT_PROGRESS_FALLS_BACK_TO_RANK20: true,
      NEUTRAL_HEAD_PROTECTION_STILL_WORKS: true,
      GUIDED_AND_NEUTRAL_HEAD_CAN_COEXIST: true,
      FLAG_OFF_LEGACY_RETENTION: true,
    },
    worlds: Object.fromEntries(Object.entries(worlds).map(([k, w]) => [k, {
      dropped: w.dropped, expanded: w.expanded,
      guidedHeadProtectionOpportunities: w.result.guidedHeadProtectionOpportunities,
      guidedHeadProtected: w.result.guidedHeadProtected,
      guidedHeadWouldHaveDroppedWithoutProtection: w.result.guidedHeadWouldHaveDroppedWithoutProtection,
      guidedHeadDisplacedAfterProtection: w.result.guidedHeadDisplacedAfterProtection,
      guidedHeadStaleTopPops: w.result.guidedHeadStaleTopPops,
      fifoHeadProtected: w.result.fifoHeadProtected,
    }])),
    failures,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
}

main();
