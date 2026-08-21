"use strict";

/** TEST GRADE: unit-plus-micro */

/**
 * PR-5.20a static combat-economy core checker.
 *
 * Single process, no worker pool, no real tower JS. Four pre-frozen hypotheses:
 *
 *   H1  >=3 fixed cases are solved and the optimal final hp equals the unpruned
 *       exhaustive oracle.
 *   H2  the invest-before-conserve case is NOT solved by a conserve-only
 *       schedule at maxExpandedStates=32, while the adaptive schedule switches
 *       CONSERVE_HP -> BREAK_BOTTLENECK at least once and does reach the goal.
 *   H3  over 32 fixed seeds of generated maps with at most 7 interactions, the
 *       solver and the oracle agree on `found` and on the optimal final hp.
 *   H4  wall time < 10s, observed peak RSS < 256MB, compact stdout < 5KB.
 *
 * Every successful route is strictly replayed, and one genuinely unsolvable
 * case is included so a false success cannot pass.
 */

const assert = require("node:assert");
const path = require("node:path");

const {
  applyStaticMacroAction,
  buildStaticStructuralKey,
  computeStaticBattleOutcome,
  computeStaticReachableRegion,
  describeStaticBlockerDeficit,
  enumerateStaticMacroActions,
  insertStaticParetoState,
  replayStaticCombatEconomyRoute,
  solveStaticCombatEconomy,
  solveStaticCombatEconomyExhaustive,
  validateStaticCombatEconomyProblem,
} = require("./lib/static-combat-economy-core");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "static-combat-economy-core.json");
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
    grid: ["#####", "#S.G#", "#####"],
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
      grid: ["#######", "#S.M.G#", "#######"],
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
    grid: ["#######", "#S.R.G#", "#######"],
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
    grid: ["#####", "#S.G##", "#####"],
  });
  assert.strictEqual(raggedProbe.valid, false, "non-rectangular grid must be rejected");
  const wallStartProbe = validateStaticCombatEconomyProblem({
    ...baseProblem,
    start: { x: 0, y: 0 },
  });
  assert.strictEqual(wallStartProbe.valid, false, "start on a wall must be rejected");

  // Structural key and Pareto rule.
  const keyProblem = validateStaticCombatEconomyProblem({
    ...baseProblem,
    grid: ["#######", "#S.R.G#", "#######"],
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
    insertStaticParetoState(bucket, { hp: 50, atk: 10, def: 1, mdef: 1 }),
    { inserted: true, dominated: 0 },
  );
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 40, atk: 10, def: 1, mdef: 1 }),
    { inserted: false, dominated: 0 },
    "a strictly worse state must be rejected",
  );
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 50, atk: 10, def: 1, mdef: 1 }),
    { inserted: false, dominated: 0 },
    "an equal state must be rejected",
  );
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 60, atk: 11, def: 2, mdef: 2 }),
    { inserted: true, dominated: 1 },
    "a dominating state must evict",
  );
  assert.strictEqual(bucket.length, 1);
  assert.deepStrictEqual(
    insertStaticParetoState(bucket, { hp: 70, atk: 1, def: 2, mdef: 2 }),
    { inserted: true, dominated: 0 },
    "a trade-off state must coexist",
  );
  assert.strictEqual(bucket.length, 2);
  sampleRss();

  // --- fixture cases: H1, H2 and the negative control ----------------------
  const fixture = require(FIXTURE_PATH);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 4);
  const caseReports = [];
  let oracleMatchedCases = 0;
  let replayedRoutes = 0;

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
  assert.strictEqual(
    conserveGenerous.finalHero.hp,
    adaptiveGenerous.finalHero.hp,
    "mode must not change the optimum",
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
    grid: ["#######", "#S.W.G#", "#######"],
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
  sampleRss();

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
