"use strict";

/** TEST GRADE: unit-plus-micro */

/**
 * PR-5.20a/5.20b static combat-economy core checker.
 *
 * Single process, no worker pool, no real tower JS. Pre-frozen acceptance:
 *
 *   H1  >=3 fixed cases are solved and the optimal final hp equals the unpruned
 *       exhaustive oracle.
 *   H2  the invest-before-conserve case is NOT solved by a conserve-only
 *       schedule at maxExpandedStates=32, while the adaptive schedule switches
 *       CONSERVE_HP -> BREAK_BOTTLENECK at least once and does reach the goal.
 *   H3  over 32 fixed seeds of generated maps with at most 7 interactions, the
 *       solver and the oracle agree on `found` and on the optimal final hp.
 *   H4  wall time < 10s, observed peak RSS < 256MB, compact stdout < 5KB.
 *   H5  the goal Pareto archive keeps at least two mutually non-dominated
 *       finishes on the trade-off case, and each of them strictly replays.
 *   H6  SCALE GATE: both 24-32 interaction mid-size cases reach SOLVED inside
 *       maxExpandedStates=50000 with peakFrontier<=10000, and every goal-archive
 *       route strictly replays.
 *
 * Only bounds and semantic results are frozen. Exact expanded/switch/RSS numbers
 * are reported, never asserted, because they legitimately move with the
 * environment and with any future scheduling change.
 *
 * Every successful route is strictly replayed, and one genuinely unsolvable case
 * is included so a false success cannot pass.
 */

const assert = require("node:assert");
const path = require("node:path");

const {
  BinaryHeap,
  applyStaticMacroAction,
  buildStaticStructuralKey,
  computeStaticBattleOutcome,
  computeStaticReachableRegion,
  describeStaticBlockerDeficit,
  enumerateStaticMacroActions,
  insertStaticGoalParetoState,
  insertStaticParetoState,
  replayStaticCombatEconomyRoute,
  solveStaticCombatEconomy,
  solveStaticCombatEconomyExhaustive,
  validateStaticCombatEconomyProblem,
} = require("./lib/static-combat-economy-core");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "static-combat-economy-core.json");
const SCALE_FIXTURE_PATH = path.join(__dirname, "fixtures", "static-combat-economy-scale.json");
const SCALE_BUDGET = 50000;
const SCALE_PEAK_FRONTIER_LIMIT = 10000;
const SCALE_MIN_INTERACTIONS = 24;
const SCALE_MAX_INTERACTIONS = 32;
const HARD_LIMIT_MS = 10000;
const HARD_LIMIT_RSS_BYTES = 256 * 1024 * 1024;
const COMPACT_STDOUT_LIMIT = 5120;
const H2_BUDGET = 32;
const H3_SEED_COUNT = 32;
const H3_MAX_INTERACTIONS = 7;

let peakRssBytes = 0;
function sampleRss() {
  const rss = process.memoryUsage().rss;
  if (rss > peakRssBytes) peakRssBytes = rss;
  return rss;
}

// Deterministic PRNG: the seeds are fixed so H3 is reproducible run to run.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const startedAt = process.hrtime.bigint();
  sampleRss();

  // --- pure-unit contract checks -------------------------------------------
  // Battle contract: no first strike, counterattacks = hits - 1, mdef applied
  // once to the accumulated damage, floored at zero.
  const blocked = computeStaticBattleOutcome(
    { hp: 100, atk: 10, def: 0, mdef: 0 },
    { hp: 30, atk: 5, def: 10 },
  );
  assert.strictEqual(blocked.attackBlocked, true);
  assert.strictEqual(blocked.canFight, false);
  assert.strictEqual(blocked.damage, null);
  assert.strictEqual(blocked.attackDeficit, 1);
  const plain = computeStaticBattleOutcome(
    { hp: 100, atk: 20, def: 3, mdef: 0 },
    { hp: 30, atk: 13, def: 10 },
  );
  assert.strictEqual(plain.hits, 3);
  assert.strictEqual(plain.counterRounds, 2);
  assert.strictEqual(plain.damage, 20);
  assert.strictEqual(plain.canFight, true);
  const mdefOnce = computeStaticBattleOutcome(
    { hp: 100, atk: 20, def: 3, mdef: 6 },
    { hp: 30, atk: 13, def: 10 },
  );
  assert.strictEqual(mdefOnce.damage, 14, "mdef must be deducted once from the total");
  const mdefFloor = computeStaticBattleOutcome(
    { hp: 100, atk: 20, def: 3, mdef: 999 },
    { hp: 30, atk: 13, def: 10 },
  );
  assert.strictEqual(mdefFloor.damage, 0, "total damage must floor at zero");
  const lethal = computeStaticBattleOutcome(
    { hp: 10, atk: 20, def: 0, mdef: 0 },
    { hp: 30, atk: 13, def: 10 },
  );
  assert.strictEqual(lethal.canFight, false);
  assert.strictEqual(lethal.survivalDeficit, lethal.damage - 10 + 1);
  const exactlyLethal = computeStaticBattleOutcome(
    { hp: 20, atk: 20, def: 3, mdef: 0 },
    { hp: 30, atk: 13, def: 10 },
  );
  assert.strictEqual(exactlyLethal.damage, 20);
  assert.strictEqual(exactlyLethal.canFight, false, "damage == hp must not be fightable");

  // Schema rejection: every non-static concept must be refused, not ignored.
  const baseProblem = {
    id: "reject-probe",
    grid: ["#####", "#...#", "#####"],
    start: { x: 1, y: 1 },
    goal: { x: 3, y: 1 },
    hero: { hp: 100, atk: 10, def: 0, mdef: 0 },
    interactions: [],
  };
  assert.strictEqual(validateStaticCombatEconomyProblem(baseProblem).valid, true);
  const forbiddenProblemFields = [
    "events", "flags", "equipment", "keys", "money", "exp", "skills", "items", "shops",
  ];
  forbiddenProblemFields.forEach((field) => {
    const probe = { ...baseProblem, [field]: [] };
    const result = validateStaticCombatEconomyProblem(probe);
    assert.strictEqual(result.valid, false, `${field} must be rejected`);
    assert.ok(result.errors.some((error) => error === `forbidden-problem-field:${field}`));
  });
  const forbiddenMonsterFields = ["special", "firstAttack", "magic", "n", "money", "exp", "skill"];
  forbiddenMonsterFields.forEach((field) => {
    const probe = {
      ...baseProblem,
      grid: ["#######", "#.....#", "#######"],
      goal: { x: 5, y: 1 },
      interactions: [
        { kind: "monster", id: "m", x: 3, y: 1, hp: 10, atk: 5, def: 1, [field]: 1 },
      ],
    };
    const result = validateStaticCombatEconomyProblem(probe);
    assert.strictEqual(result.valid, false, `monster.${field} must be rejected`);
  });
  const forbiddenResourceProbe = validateStaticCombatEconomyProblem({
    ...baseProblem,
    grid: ["#######", "#.....#", "#######"],
    goal: { x: 5, y: 1 },
    interactions: [{ kind: "resource", id: "r", x: 3, y: 1, money: 100 }],
  });
  assert.strictEqual(forbiddenResourceProbe.valid, false);
  assert.ok(forbiddenResourceProbe.errors.some((error) => /forbidden-resource-field/.test(error)));
  const heroFieldProbe = validateStaticCombatEconomyProblem({
    ...baseProblem,
    hero: { hp: 100, atk: 10, def: 0, mdef: 0, exp: 5 },
  });
  assert.strictEqual(heroFieldProbe.valid, false);
  const raggedProbe = validateStaticCombatEconomyProblem({
    ...baseProblem,
    grid: ["#####", "#...##", "#####"],
  });
  assert.strictEqual(raggedProbe.valid, false, "non-rectangular grid must be rejected");
  const wallStartProbe = validateStaticCombatEconomyProblem({
    ...baseProblem,
    start: { x: 0, y: 0 },
  });
  assert.strictEqual(wallStartProbe.valid, false, "start on a wall must be rejected");

  // --- 5.20b review finding 1: unknown fields and illegal grid characters ----
  // An ignored field is how a non-static tower would quietly look static, so the
  // allowlist has to reject anything it does not recognise, not just the names it
  // knows are dangerous.
  ["difficulty", "startFloor", "meta", "notes", "hero2"].forEach((field) => {
    const probe = validateStaticCombatEconomyProblem({ ...baseProblem, [field]: 1 });
    assert.strictEqual(probe.valid, false, `unknown problem field ${field} must be rejected`);
    assert.ok(probe.errors.includes(`unknown-problem-field:${field}`));
  });
  ["z", "floor", "label"].forEach((field) => {
    const probe = validateStaticCombatEconomyProblem({
      ...baseProblem,
      start: { x: 1, y: 1, [field]: 0 },
    });
    assert.strictEqual(probe.valid, false, `unknown start field ${field} must be rejected`);
    assert.ok(probe.errors.includes(`forbidden-start-field:${field}`));
    const goalProbe = validateStaticCombatEconomyProblem({
      ...baseProblem,
      goal: { x: 3, y: 1, [field]: 0 },
    });
    assert.strictEqual(goalProbe.valid, false, `unknown goal field ${field} must be rejected`);
    assert.ok(goalProbe.errors.includes(`forbidden-goal-field:${field}`));
  });
  // Decorative markers must not be silently read as floor.
  ["S", "G", "M", "P", "K", " ", "0"].forEach((character) => {
    const probe = validateStaticCombatEconomyProblem({
      ...baseProblem,
      grid: ["#####", `#${character}.G#`.slice(0, 5), "#####"],
    });
    assert.strictEqual(probe.valid, false, `grid character ${character} must be rejected`);
    assert.ok(probe.errors.some((error) => error.startsWith("grid-illegal-character:")));
  });
  // Interaction ids are mandatory and globally unique: route identity depends on
  // them, so a defaulted or duplicated id is a real ambiguity.
  const idProblem = {
    ...baseProblem,
    grid: ["#########", "#.......#", "#########"],
    goal: { x: 7, y: 1 },
  };
  const missingIdProbe = validateStaticCombatEconomyProblem({
    ...idProblem,
    interactions: [{ kind: "resource", x: 3, y: 1, hp: 10 }],
  });
  assert.strictEqual(missingIdProbe.valid, false, "a missing interaction id must be rejected");
  const blankIdProbe = validateStaticCombatEconomyProblem({
    ...idProblem,
    interactions: [{ kind: "resource", id: "", x: 3, y: 1, hp: 10 }],
  });
  assert.strictEqual(blankIdProbe.valid, false, "a blank interaction id must be rejected");
  const duplicateIdProbe = validateStaticCombatEconomyProblem({
    ...idProblem,
    interactions: [
      { kind: "resource", id: "dup", x: 3, y: 1, hp: 10 },
      { kind: "resource", id: "dup", x: 5, y: 1, hp: 10 },
    ],
  });
  assert.strictEqual(duplicateIdProbe.valid, false, "a duplicate interaction id must be rejected");
  assert.ok(duplicateIdProbe.errors.some((error) => error === "interactions[1].id-duplicates:dup"));

  // Structural key and Pareto rule.
  const keyProblem = validateStaticCombatEconomyProblem({
    ...baseProblem,
    grid: ["#######", "#.....#", "#######"],
    goal: { x: 5, y: 1 },
    interactions: [{ kind: "resource", id: "r", x: 3, y: 1, atk: 5 }],
  }).problem;
  const keyReach = computeStaticReachableRegion(keyProblem, 1 * keyProblem.width + 1, new Set());
  assert.strictEqual(keyReach.goalReachable, false, "goal must be blocked by the resource cell");
  assert.deepStrictEqual(keyReach.frontierInteractions, [0]);
  assert.strictEqual(
    buildStaticStructuralKey(new Set([1, 0]), keyReach.region),
    buildStaticStructuralKey(new Set([0, 1]), keyReach.region),
    "structural key must not depend on consumption order",
  );
  const bucket = [];
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 50, atk: 10, def: 1, mdef: 1 }, 101),
    { inserted: true, dominated: 0, evictedNodeIds: [] },
  );
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 40, atk: 10, def: 1, mdef: 1 }, 102),
    { inserted: false, dominated: 0, evictedNodeIds: [] },
    "a strictly worse state must be rejected",
  );
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 50, atk: 10, def: 1, mdef: 1 }, 103),
    { inserted: false, dominated: 0, evictedNodeIds: [] },
    "an equal state must be rejected",
  );
  // The evicted node id must come back so the agenda entry can be retired.
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 60, atk: 11, def: 2, mdef: 2 }, 104),
    { inserted: true, dominated: 1, evictedNodeIds: [101] },
    "a dominating state must evict and report the evicted node id",
  );
  assert.strictEqual(bucket.length, 1);
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 70, atk: 1, def: 2, mdef: 2 }, 105),
    { inserted: true, dominated: 0, evictedNodeIds: [] },
    "a trade-off state must coexist",
  );
  assert.strictEqual(bucket.length, 2);

  // --- goal archive rule ----------------------------------------------------
  const archiveProbe = [];
  assert.deepStrictEqual(
    insertStaticGoalParetoState(archiveProbe, { hero: { hp: 100, atk: 10, def: 0, mdef: 0 }, nodeId: 1 }),
    { inserted: true, removed: 0 },
  );
  assert.deepStrictEqual(
    insertStaticGoalParetoState(archiveProbe, { hero: { hp: 40, atk: 30, def: 0, mdef: 0 }, nodeId: 2 }),
    { inserted: true, removed: 0 },
    "a low-hp/high-atk finish must not be dropped by an hp-only comparison",
  );
  assert.strictEqual(archiveProbe.length, 2);
  assert.deepStrictEqual(
    insertStaticGoalParetoState(archiveProbe, { hero: { hp: 30, atk: 20, def: 0, mdef: 0 }, nodeId: 3 }),
    { inserted: false, removed: 0 },
    "a dominated finish must be rejected",
  );
  assert.deepStrictEqual(
    insertStaticGoalParetoState(archiveProbe, { hero: { hp: 120, atk: 35, def: 1, mdef: 1 }, nodeId: 4 }),
    { inserted: true, removed: 2 },
    "a finish dominating both must collapse the archive",
  );
  assert.strictEqual(archiveProbe.length, 1);

  // --- binary heap ----------------------------------------------------------
  const heap = new BinaryHeap((left, right) => left.key - right.key);
  assert.strictEqual(heap.pop(), null, "an empty heap must pop null");
  const heapInput = [7, 2, 9, 1, 8, 3, 3, 5, 0, 6, 4];
  heapInput.forEach((key) => heap.push({ key }));
  assert.strictEqual(heap.size, heapInput.length);
  const heapOrder = [];
  for (;;) {
    const item = heap.pop();
    if (item == null) break;
    heapOrder.push(item.key);
  }
  assert.deepStrictEqual(heapOrder, heapInput.slice().sort((a, b) => a - b), "heap must pop in order");
  sampleRss();

  // --- fixture cases: H1, H2 and the negative control ----------------------
  const fixture = require(FIXTURE_PATH);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 4);
  const caseReports = [];
  let oracleMatchedCases = 0;
  let replayedRoutes = 0;
  let goalTradeoffArchive = null;

  for (const testCase of fixture.cases) {
    const validation = validateStaticCombatEconomyProblem(testCase.problem);
    assert.strictEqual(
      validation.valid,
      true,
      `fixture case ${testCase.id} failed validation: ${validation.errors.join(",")}`,
    );
    const problem = validation.problem;
    const solved = solveStaticCombatEconomy(problem, { maxExpandedStates: 200000 });
    assert.notStrictEqual(
      solved.status,
      "RESOURCE_LIMIT",
      `fixture case ${testCase.id} hit the state limit`,
    );
    if (testCase.expectSolvable) {
      assert.strictEqual(solved.status, "SOLVED", `fixture case ${testCase.id} must be solved`);
      assert.ok(Array.isArray(solved.route) && solved.route.length > 0);
      assert.ok(solved.finalHero && solved.finalHero.hp > 0);
      const replay = replayStaticCombatEconomyRoute(problem, solved.route);
      assert.strictEqual(replay.valid, true, `route replay failed for ${testCase.id}: ${replay.reason}`);
      assert.strictEqual(replay.goalReachable, true);
      assert.strictEqual(
        replay.finalHero.hp,
        solved.finalHero.hp,
        `replayed hp differs for ${testCase.id}`,
      );
      replayedRoutes += 1;
      // The compatible route/finalHero must be exactly the max-hp archive entry,
      // and every archive entry must independently replay.
      assert.ok(solved.goalArchive.length >= 1, `${testCase.id} must archive its finish`);
      assert.strictEqual(solved.goalArchive[0].hero.hp, solved.finalHero.hp);
      assert.deepStrictEqual(solved.goalArchive[0].route, solved.route);
      solved.goalArchive.forEach((entry, entryIndex) => {
        const entryReplay = replayStaticCombatEconomyRoute(problem, entry.route);
        assert.strictEqual(
          entryReplay.valid,
          true,
          `archive entry ${entryIndex} of ${testCase.id} failed replay: ${entryReplay.reason}`,
        );
        assert.strictEqual(entryReplay.finalHero.hp, entry.hero.hp);
        if (entryIndex > 0) replayedRoutes += 1;
      });
      // Archive entries must be mutually non-dominated by construction.
      for (let a = 0; a < solved.goalArchive.length; a += 1) {
        for (let b = 0; b < solved.goalArchive.length; b += 1) {
          if (a === b) continue;
          const left = solved.goalArchive[a].hero;
          const right = solved.goalArchive[b].hero;
          const dominates = left.hp >= right.hp && left.atk >= right.atk &&
            left.def >= right.def && left.mdef >= right.mdef;
          assert.strictEqual(
            dominates,
            false,
            `${testCase.id} archive entry ${a} dominates ${b}`,
          );
        }
      }
      if (testCase.minGoalArchive != null) {
        assert.ok(
          solved.goalArchive.length >= testCase.minGoalArchive,
          `${testCase.id} archive kept ${solved.goalArchive.length}, expected >= ${testCase.minGoalArchive}`,
        );
        goalTradeoffArchive = solved.goalArchive.map((entry) => ({ ...entry.hero }));
      }
    } else {
      assert.strictEqual(
        solved.status,
        "UNSOLVABLE",
        `negative control ${testCase.id} must be unsolvable`,
      );
      assert.strictEqual(solved.route, null);
      assert.strictEqual(solved.finalHero, null);
    }
    let oracle = null;
    if (testCase.oracle) {
      oracle = solveStaticCombatEconomyExhaustive(problem, { maxSequences: 2000000 });
      assert.strictEqual(oracle.exhausted, true, `oracle did not exhaust ${testCase.id}`);
      assert.strictEqual(
        oracle.found,
        solved.route != null,
        `oracle/solver disagree on found for ${testCase.id}`,
      );
      if (oracle.found) {
        assert.strictEqual(
          solved.finalHero.hp,
          oracle.finalHero.hp,
          `optimal final hp differs for ${testCase.id}`,
        );
        // The pruned archive must equal the unpruned archive as a set.
        const vector = (hero) => `${hero.hp}/${hero.atk}/${hero.def}/${hero.mdef}`;
        assert.deepStrictEqual(
          solved.goalArchive.map((entry) => vector(entry.hero)).sort(),
          oracle.goalArchive.map((entry) => vector(entry.hero)).sort(),
          `goal archive differs from the oracle for ${testCase.id}`,
        );
      }
      oracleMatchedCases += 1;
    }
    caseReports.push({
      id: testCase.id,
      status: solved.status,
      finalHp: solved.finalHero == null ? null : solved.finalHero.hp,
      routeLength: solved.route == null ? 0 : solved.route.length,
      expanded: solved.expanded,
      generated: solved.generated,
      dominated: solved.dominated,
      peakFrontier: solved.peakFrontier,
      modeSwitches: solved.modeSwitches,
      oracleFinalHp: oracle == null || oracle.finalHero == null ? null : oracle.finalHero.hp,
      oracleSequences: oracle == null ? null : oracle.sequences,
    });
    sampleRss();
  }
  // H1 needs at least three oracle-matched fixed cases.
  assert.ok(oracleMatchedCases >= 3, `H1 needs >=3 oracle-checked cases, got ${oracleMatchedCases}`);
  const h1Cases = caseReports.filter((entry) => entry.oracleFinalHp != null);
  assert.ok(h1Cases.length >= 3);
  // H5: the trade-off case must really keep two incomparable finishes.
  assert.ok(
    goalTradeoffArchive != null && goalTradeoffArchive.length >= 2,
    "H5 requires a goal trade-off case keeping >=2 non-dominated finishes",
  );

  // H2: same budget, only the schedule differs.
  const investCase = fixture.cases.find((entry) => entry.id === "invest-before-conserve");
  assert.ok(investCase, "invest-before-conserve case missing");
  const investProblem = validateStaticCombatEconomyProblem(investCase.problem).problem;
  const conserveOnly = solveStaticCombatEconomy(investProblem, {
    maxExpandedStates: H2_BUDGET,
    adaptive: false,
  });
  const adaptiveRun = solveStaticCombatEconomy(investProblem, {
    maxExpandedStates: H2_BUDGET,
    adaptive: true,
  });
  assert.strictEqual(conserveOnly.modeSwitches, 0, "conserve-only must never switch mode");
  assert.strictEqual(
    conserveOnly.route,
    null,
    "H2 requires conserve-only to miss the goal at the shared budget",
  );
  assert.strictEqual(conserveOnly.status, "RESOURCE_LIMIT");
  assert.ok(
    adaptiveRun.modeSwitches >= 1,
    "H2 requires at least one CONSERVE_HP -> BREAK_BOTTLENECK switch",
  );
  assert.ok(adaptiveRun.route != null, "H2 requires the adaptive schedule to reach the goal");
  assert.strictEqual(conserveOnly.expanded, adaptiveRun.expanded, "both runs must share the budget");
  const adaptiveReplay = replayStaticCombatEconomyRoute(investProblem, adaptiveRun.route);
  assert.strictEqual(adaptiveReplay.valid, true, `H2 adaptive route replay failed: ${adaptiveReplay.reason}`);
  replayedRoutes += 1;
  // The schedule must not invent legality: the same problem under a generous
  // budget is solvable either way.
  const conserveGenerous = solveStaticCombatEconomy(investProblem, {
    maxExpandedStates: 200000,
    adaptive: false,
  });
  assert.strictEqual(conserveGenerous.status, "SOLVED");
  const adaptiveGenerous = solveStaticCombatEconomy(investProblem, { maxExpandedStates: 200000 });
  assert.strictEqual(adaptiveGenerous.status, "SOLVED");
  assert.strictEqual(
    conserveGenerous.finalHero.hp,
    adaptiveGenerous.finalHero.hp,
    "mode must not change the optimum",
  );
  // Scheduling must not change the proven result set either.
  const generousVector = (hero) => `${hero.hp}/${hero.atk}/${hero.def}/${hero.mdef}`;
  assert.deepStrictEqual(
    conserveGenerous.goalArchive.map((entry) => generousVector(entry.hero)).sort(),
    adaptiveGenerous.goalArchive.map((entry) => generousVector(entry.hero)).sort(),
    "mode must not change the goal archive",
  );
  sampleRss();

  // --- H3: generated maps vs the unpruned oracle ---------------------------
  const buildGeneratedProblem = (seed) => {
    const random = mulberry32(seed * 2654435761);
    const pick = (min, max) => min + Math.floor(random() * (max - min + 1));
    const width = pick(5, 7);
    const height = pick(4, 5);
    const grid = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        if (border) row += "#";
        else row += random() < 0.12 ? "#" : ".";
      }
      grid.push(row);
    }
    const openCells = [];
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        if (grid[y][x] === ".") openCells.push({ x, y });
      }
    }
    if (openCells.length < 4) return null;
    const start = openCells[0];
    const goal = openCells[openCells.length - 1];
    if (start.x === goal.x && start.y === goal.y) return null;
    const interactionCells = openCells.slice(1, openCells.length - 1);
    const interactionCount = Math.min(H3_MAX_INTERACTIONS, interactionCells.length, pick(2, 7));
    const interactions = [];
    for (let index = 0; index < interactionCount; index += 1) {
      const cell = interactionCells[index];
      if (random() < 0.55) {
        interactions.push({
          kind: "monster",
          id: `m${index}`,
          x: cell.x,
          y: cell.y,
          hp: pick(5, 45),
          atk: pick(4, 32),
          def: pick(0, 18),
        });
      } else {
        const attribute = ["hp", "atk", "def", "mdef"][pick(0, 3)];
        const gains = { hp: pick(10, 45), atk: pick(2, 9), def: pick(1, 6), mdef: pick(1, 8) };
        interactions.push({
          kind: "resource",
          id: `r${index}`,
          x: cell.x,
          y: cell.y,
          [attribute]: gains[attribute],
        });
      }
    }
    return {
      id: `generated-${seed}`,
      grid,
      start,
      goal,
      hero: { hp: pick(40, 120), atk: pick(8, 20), def: pick(0, 5), mdef: pick(0, 6) },
      interactions,
    };
  };

  let generatedChecked = 0;
  let generatedSolvable = 0;
  let generatedSkipped = 0;
  let generatedMaxInteractions = 0;
  for (let seed = 1; seed <= H3_SEED_COUNT; seed += 1) {
    const candidate = buildGeneratedProblem(seed);
    if (candidate == null) {
      generatedSkipped += 1;
      continue;
    }
    const validation = validateStaticCombatEconomyProblem(candidate);
    assert.strictEqual(
      validation.valid,
      true,
      `generated seed ${seed} failed validation: ${validation.errors.join(",")}`,
    );
    const problem = validation.problem;
    assert.ok(
      problem.interactions.length <= H3_MAX_INTERACTIONS,
      `generated seed ${seed} exceeded the interaction cap`,
    );
    if (problem.interactions.length > generatedMaxInteractions) {
      generatedMaxInteractions = problem.interactions.length;
    }
    const solved = solveStaticCombatEconomy(problem, { maxExpandedStates: 200000 });
    assert.notStrictEqual(solved.status, "RESOURCE_LIMIT", `generated seed ${seed} hit the state limit`);
    const oracle = solveStaticCombatEconomyExhaustive(problem, { maxSequences: 2000000 });
    assert.strictEqual(oracle.exhausted, true, `oracle did not exhaust generated seed ${seed}`);
    assert.strictEqual(
      solved.route != null,
      oracle.found,
      `generated seed ${seed}: solver/oracle disagree on found`,
    );
    if (oracle.found) {
      assert.strictEqual(
        solved.finalHero.hp,
        oracle.finalHero.hp,
        `generated seed ${seed}: optimal final hp differs`,
      );
      const replay = replayStaticCombatEconomyRoute(problem, solved.route);
      assert.strictEqual(replay.valid, true, `generated seed ${seed} replay failed: ${replay.reason}`);
      assert.strictEqual(replay.finalHero.hp, solved.finalHero.hp);
      replayedRoutes += 1;
      generatedSolvable += 1;
    } else {
      assert.strictEqual(solved.status, "UNSOLVABLE");
    }
    generatedChecked += 1;
    sampleRss();
  }
  assert.ok(generatedChecked >= 24, `H3 needs a healthy seed yield, got ${generatedChecked}`);
  assert.ok(generatedSolvable >= 1, "H3 must include at least one solvable generated map");
  assert.ok(
    generatedChecked - generatedSolvable >= 1,
    "H3 must include at least one unsolvable generated map",
  );

  // --- reachability / action / deficit helper spot checks -------------------
  const deficitProblem = validateStaticCombatEconomyProblem({
    id: "deficit-probe",
    grid: ["#######", "#.....#", "#######"],
    start: { x: 1, y: 1 },
    goal: { x: 5, y: 1 },
    hero: { hp: 100, atk: 10, def: 0, mdef: 0 },
    interactions: [{ kind: "monster", id: "w", x: 3, y: 1, hp: 50, atk: 1, def: 50 }],
  }).problem;
  const deficitStart = {
    hero: { ...deficitProblem.hero },
    consumed: new Set(),
    ...computeStaticReachableRegion(deficitProblem, 1 * deficitProblem.width + 1, new Set()),
  };
  assert.deepStrictEqual(enumerateStaticMacroActions(deficitProblem, deficitStart), []);
  const deficit = describeStaticBlockerDeficit(deficitProblem, deficitStart);
  assert.strictEqual(deficit.attackDeficit, 41);
  assert.strictEqual(deficit.survivalDeficit, 0);
  assert.strictEqual(deficit.blockers.length, 1);
  assert.strictEqual(deficit.blockers[0].kind, "attack-blocked");
  assert.strictEqual(applyStaticMacroAction(deficitProblem, deficitStart, {
    interactionIndex: 0,
    kind: "monster",
    id: "w",
  }), null, "an unwinnable fight must not be applicable");
  const badReplay = replayStaticCombatEconomyRoute(deficitProblem, [
    { interactionIndex: 0, kind: "monster", id: "w" },
  ]);
  assert.strictEqual(badReplay.valid, false);
  assert.strictEqual(badReplay.reason, "illegal-step:0");
  const emptyReplay = replayStaticCombatEconomyRoute(deficitProblem, []);
  assert.strictEqual(emptyReplay.valid, false);
  assert.strictEqual(emptyReplay.reason, "goal-not-reachable-after-route");

  // --- 5.20b review finding 2: nothing unreachable may be consumed -----------
  // A caller holding a stale action must not be able to reach past the frontier,
  // even though the solver itself only ever passes enumerated actions.
  const unreachableProblem = validateStaticCombatEconomyProblem({
    id: "unreachable-probe",
    grid: ["#########", "#.......#", "#########"],
    start: { x: 1, y: 1 },
    goal: { x: 7, y: 1 },
    hero: { hp: 100, atk: 30, def: 0, mdef: 0 },
    interactions: [
      { kind: "monster", id: "near", x: 3, y: 1, hp: 10, atk: 1, def: 1 },
      { kind: "resource", id: "far", x: 5, y: 1, hp: 10 },
    ],
  }).problem;
  const unreachableByCell = new Map();
  unreachableProblem.interactions.forEach((interaction, index) => {
    unreachableByCell.set(interaction.y * unreachableProblem.width + interaction.x, index);
  });
  const unreachableStart = {
    hero: { ...unreachableProblem.hero },
    consumed: new Set(),
    ...computeStaticReachableRegion(unreachableProblem, 1 * unreachableProblem.width + 1, new Set()),
  };
  assert.deepStrictEqual(
    unreachableStart.frontierInteractions,
    [0],
    "only the near interaction is on the initial frontier",
  );
  assert.strictEqual(
    applyStaticMacroAction(unreachableProblem, unreachableStart, {
      interactionIndex: 1,
      kind: "resource",
      id: "far",
    }, unreachableByCell),
    null,
    "consuming an interaction behind an unconsumed blocker must be refused",
  );
  const farReplay = replayStaticCombatEconomyRoute(unreachableProblem, [
    { interactionIndex: 1, kind: "resource", id: "far" },
  ]);
  assert.strictEqual(farReplay.valid, false);
  assert.strictEqual(farReplay.reason, "illegal-step:0");
  // Out-of-range and malformed indexes are refused rather than throwing.
  [-1, 99, null, undefined, "0", 1.5].forEach((interactionIndex) => {
    assert.strictEqual(
      applyStaticMacroAction(unreachableProblem, unreachableStart, {
        interactionIndex,
        kind: "resource",
        id: "far",
      }, unreachableByCell),
      null,
      `interactionIndex ${String(interactionIndex)} must be refused`,
    );
  });

  // --- 5.20b review finding 3: a step must name what it points at ------------
  // Index-only checking would accept a route that claims one interaction and
  // actually consumes another.
  const forgedKind = applyStaticMacroAction(unreachableProblem, unreachableStart, {
    interactionIndex: 0,
    kind: "resource",
    id: "near",
  }, unreachableByCell);
  assert.strictEqual(forgedKind, null, "a forged kind must be refused");
  const forgedId = applyStaticMacroAction(unreachableProblem, unreachableStart, {
    interactionIndex: 0,
    kind: "monster",
    id: "not-near",
  }, unreachableByCell);
  assert.strictEqual(forgedId, null, "a forged id must be refused");
  const honestApply = applyStaticMacroAction(unreachableProblem, unreachableStart, {
    interactionIndex: 0,
    kind: "monster",
    id: "near",
  }, unreachableByCell);
  assert.ok(honestApply, "the honest action must still apply");
  [
    [{ interactionIndex: 0, kind: "resource", id: "near" }, "step-identity-mismatch:0"],
    [{ interactionIndex: 0, kind: "monster", id: "wrong" }, "step-identity-mismatch:0"],
    [{ interactionIndex: 0 }, "step-identity-mismatch:0"],
    [{ kind: "monster", id: "near" }, "malformed-step:0"],
    [{ interactionIndex: 42, kind: "monster", id: "near" }, "unknown-interaction:0"],
    [null, "malformed-step:0"],
  ].forEach(([step, expectedReason]) => {
    const result = replayStaticCombatEconomyRoute(unreachableProblem, [step]);
    assert.strictEqual(result.valid, false, `step ${JSON.stringify(step)} must be rejected`);
    assert.strictEqual(result.reason, expectedReason, `wrong reason for ${JSON.stringify(step)}`);
  });
  sampleRss();

  // --- H6: SCALE GATE -------------------------------------------------------
  // The gate that decides whether this direction continues. If a 24-32 interaction
  // static case cannot finish inside the budget, that is a FAILED_SCALE_GATE and no
  // amount of extra attribution changes it.
  const scaleFixture = require(SCALE_FIXTURE_PATH);
  assert.ok(Array.isArray(scaleFixture.cases) && scaleFixture.cases.length >= 2);
  assert.strictEqual(scaleFixture.budget.maxExpandedStates, SCALE_BUDGET);
  assert.strictEqual(scaleFixture.budget.maxPeakFrontier, SCALE_PEAK_FRONTIER_LIMIT);
  const scaleReports = [];
  for (const scaleCase of scaleFixture.cases) {
    const validation = validateStaticCombatEconomyProblem(scaleCase.problem);
    assert.strictEqual(
      validation.valid,
      true,
      `scale case ${scaleCase.id} failed validation: ${validation.errors.join(",")}`,
    );
    const problem = validation.problem;
    assert.ok(
      problem.interactions.length >= SCALE_MIN_INTERACTIONS &&
        problem.interactions.length <= SCALE_MAX_INTERACTIONS,
      `scale case ${scaleCase.id} has ${problem.interactions.length} interactions, need ` +
        `${SCALE_MIN_INTERACTIONS}-${SCALE_MAX_INTERACTIONS}`,
    );
    // All four attribute kinds must actually appear as resources.
    const resourceAttributes = new Set();
    let monsterCount = 0;
    for (const interaction of problem.interactions) {
      if (interaction.kind === "monster") {
        monsterCount += 1;
        continue;
      }
      for (const attribute of Object.keys(interaction.gain)) resourceAttributes.add(attribute);
    }
    assert.deepStrictEqual(
      Array.from(resourceAttributes).sort(),
      ["atk", "def", "hp", "mdef"],
      `scale case ${scaleCase.id} must exercise all four attributes`,
    );
    assert.ok(monsterCount >= 1, `scale case ${scaleCase.id} must contain plain monsters`);
    // >=6 parallel optional actions, initially or mid-run.
    const interactionByCell = new Map();
    problem.interactions.forEach((interaction, index) => {
      interactionByCell.set(interaction.y * problem.width + interaction.x, index);
    });
    const startState = {
      hero: { ...problem.hero },
      consumed: new Set(),
      ...computeStaticReachableRegion(
        problem,
        problem.start.y * problem.width + problem.start.x,
        new Set(),
      ),
    };
    let maxParallelActions = 0;
    const seenConsumed = new Set();
    const walkParallel = (state) => {
      const key = Array.from(state.consumed).sort((left, right) => left - right).join(",");
      if (seenConsumed.has(key)) return;
      seenConsumed.add(key);
      if (seenConsumed.size > 20000) return;
      const actions = enumerateStaticMacroActions(problem, state);
      if (actions.length > maxParallelActions) maxParallelActions = actions.length;
      if (maxParallelActions >= 6) return;
      for (const action of actions) {
        const next = applyStaticMacroAction(problem, state, action, interactionByCell);
        if (next) walkParallel(next);
      }
    };
    walkParallel(startState);
    assert.ok(
      maxParallelActions >= 6,
      `scale case ${scaleCase.id} only ever offers ${maxParallelActions} parallel actions, need >=6`,
    );

    const solved = solveStaticCombatEconomy(problem, { maxExpandedStates: SCALE_BUDGET });
    assert.strictEqual(
      solved.status,
      "SOLVED",
      `FAILED_SCALE_GATE: scale case ${scaleCase.id} returned ${solved.status} at ` +
        `maxExpandedStates=${SCALE_BUDGET} (expanded=${solved.expanded})`,
    );
    assert.ok(
      solved.expanded < SCALE_BUDGET,
      `FAILED_SCALE_GATE: scale case ${scaleCase.id} used the whole ${SCALE_BUDGET} budget`,
    );
    assert.ok(
      solved.peakFrontier <= SCALE_PEAK_FRONTIER_LIMIT,
      `FAILED_SCALE_GATE: scale case ${scaleCase.id} peakFrontier ${solved.peakFrontier} ` +
        `exceeded ${SCALE_PEAK_FRONTIER_LIMIT}`,
    );
    assert.ok(solved.goalArchive.length >= 1);
    // Pruning must be doing real work, otherwise the case is not a scale probe.
    assert.ok(solved.dominated > 0, `scale case ${scaleCase.id} produced no dominance`);
    solved.goalArchive.forEach((entry, entryIndex) => {
      const replay = replayStaticCombatEconomyRoute(problem, entry.route);
      assert.strictEqual(
        replay.valid,
        true,
        `scale case ${scaleCase.id} archive entry ${entryIndex} failed replay: ${replay.reason}`,
      );
      assert.strictEqual(replay.finalHero.hp, entry.hero.hp);
      replayedRoutes += 1;
    });
    scaleReports.push({
      id: scaleCase.id,
      interactions: problem.interactions.length,
      maxParallelActions,
      status: solved.status,
      finalHp: solved.finalHero.hp,
      archive: solved.goalArchive.length,
      routeLength: solved.route.length,
      expanded: solved.expanded,
      dominated: solved.dominated,
      retiredStates: solved.retiredStates,
      peakFrontier: solved.peakFrontier,
      modeSwitches: solved.modeSwitches,
    });
    sampleRss();
  }

  // --- H4 budgets -----------------------------------------------------------
  const wallMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  const peakRssMb = Math.round((sampleRss() / (1024 * 1024)) * 10) / 10;
  assert.ok(wallMs < HARD_LIMIT_MS, `H4 wall time ${wallMs}ms exceeded ${HARD_LIMIT_MS}ms`);
  assert.ok(
    peakRssBytes < HARD_LIMIT_RSS_BYTES,
    `H4 peak RSS ${peakRssMb}MB exceeded ${HARD_LIMIT_RSS_BYTES / (1024 * 1024)}MB`,
  );

  const compact = {
    status: "passed",
    schema: "motapathfinder.static-combat-economy-core-check.v1",
    h1: {
      oracleCheckedCases: oracleMatchedCases,
      cases: caseReports.map((entry) => ({
        id: entry.id,
        status: entry.status,
        finalHp: entry.finalHp,
        oracleFinalHp: entry.oracleFinalHp,
        routeLength: entry.routeLength,
        expanded: entry.expanded,
        dominated: entry.dominated,
        peakFrontier: entry.peakFrontier,
        modeSwitches: entry.modeSwitches,
      })),
    },
    h2: {
      budget: H2_BUDGET,
      conserveOnly: {
        status: conserveOnly.status,
        foundGoal: conserveOnly.route != null,
        expanded: conserveOnly.expanded,
        modeSwitches: conserveOnly.modeSwitches,
        peakFrontier: conserveOnly.peakFrontier,
      },
      adaptive: {
        status: adaptiveRun.status,
        foundGoal: adaptiveRun.route != null,
        finalHp: adaptiveRun.finalHero.hp,
        routeLength: adaptiveRun.route.length,
        expanded: adaptiveRun.expanded,
        modeSwitches: adaptiveRun.modeSwitches,
        peakFrontier: adaptiveRun.peakFrontier,
      },
    },
    h5: {
      tradeoffCase: "goal-tradeoff-archive",
      archiveSize: goalTradeoffArchive.length,
      archive: goalTradeoffArchive.map((hero) =>
        `${hero.hp}/${hero.atk}/${hero.def}/${hero.mdef}`),
    },
    h6: {
      gate: "static-core-scale-gate",
      budget: SCALE_BUDGET,
      peakFrontierLimit: SCALE_PEAK_FRONTIER_LIMIT,
      cases: scaleReports,
    },
    h3: {
      seeds: H3_SEED_COUNT,
      checked: generatedChecked,
      skipped: generatedSkipped,
      solvable: generatedSolvable,
      unsolvable: generatedChecked - generatedSolvable,
      maxInteractions: generatedMaxInteractions,
      oracleAgreement: "found-and-optimal-final-hp-identical",
    },
    h4: {
      wallMs,
      peakRssMb,
      singleProcess: true,
      workerPool: false,
    },
    replayedRoutes,
  };
  const serialized = `${JSON.stringify(compact, null, 2)}\n`;
  assert.ok(
    serialized.length < COMPACT_STDOUT_LIMIT,
    `H4 compact stdout ${serialized.length}B exceeded ${COMPACT_STDOUT_LIMIT}B`,
  );
  process.stdout.write(serialized);
}

main();
