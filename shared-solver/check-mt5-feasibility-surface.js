"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.6b Eval A1 — MT5 near-term admissible feasibility surface contract.
 *
 * The headline result of this round is negative and is locked here so it
 * cannot be quietly forgotten: a per-segment CONSTANT optimisticHeroGain
 * cannot refute any mt5-third-gate candidate, because a sound constant must
 * assume the segment's entire MT4+MT5 resource pool is still untouched, and
 * that pool alone clears every declared threshold.  Stat bounds at this
 * segment buy coverage, not pruning.
 *
 * What IS locked:
 * 1. Clause expressibility: segments carrying removedTiles / presentTiles /
 *    equipmentIncludes / actionSurvivable stay unsupported rather than being
 *    promoted on the strength of the clauses admissible-v1 can see.
 * 2. Gain provenance: every gain is measured by executing the tower's own item
 *    effects, proportional effects are excluded, and the measured MT4+MT5 pool
 *    is pinned.
 * 3. Unsoundness guards: level-up atk/def grants and the I608 exp multiplier
 *    are excluded from the constant with a stated reason, since folding them
 *    in would inflate the bound past any possible threshold.
 * 4. Zero false prune: the tracked MT3 fixture state and the real third-gate
 *    goal thresholds are never refuted by the generated bounds.
 */

const assert = require("node:assert");
const path = require("node:path");

const { compileAdmissibleFeasibilityBounds } = require("./lib/goal-feasibility-bounds");
const { loadProject } = require("./lib/project-loader");
const {
  UNSUPPORTED_GOAL_CLAUSES,
  buildFloorGraph,
  buildGainPool,
  buildSegmentAdmissibleBounds,
  summarizeLevelUpRisk,
} = require("./lib/mt5-feasibility-surface");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_DIR = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const MILESTONE_FILE = path.join(__dirname, "milestones", "onlyup-chaos-mt5-blueking.json");
const HERO_LV_AT_HANDOFF = 4;

const SWEEP_ID = "mt5-first-sweep";
const GATE_ID = "mt5-third-gate";
const SUSTAIN_ID = "mt5-sustain-balance";

function segmentById(milestones, id) {
  const segment = milestones.find((m) => m.id === id);
  assert.ok(segment, `milestone ${id} must exist`);
  return segment;
}

function heroState(floorId, hero) {
  return {
    floorId,
    hero: {
      hp: 0, atk: 0, def: 0, mdef: 0, exp: 0, lv: HERO_LV_AT_HANDOFF,
      money: 0, mana: 0, equipment: [], loc: { x: 0, y: 0 },
      ...hero,
    },
    inventory: {}, flags: {}, visitedFloors: {}, floorStates: {},
    route: [], notes: [], meta: { decisionDepth: 0, rawRouteLength: 0 },
  };
}

/**
 * Segments whose goals carry clauses admissible-v1 has no representation for
 * must be reported unsupported.  The expectation is derived from the segment's
 * own declaration rather than hardcoded per id, so the rule stays correct when
 * milestone files evolve (the milestone JSON is not a fixture frozen by this
 * check).
 */
function checkClauseExpressibility(project, milestones) {
  const results = {};
  for (const id of [SWEEP_ID, GATE_ID, SUSTAIN_ID]) {
    const segment = segmentById(milestones, id);
    const built = buildSegmentAdmissibleBounds(project, segment, { heroLv: HERO_LV_AT_HANDOFF });
    const declaredUnsupported = UNSUPPORTED_GOAL_CLAUSES.filter((clause) => {
      const value = segment.goal[clause];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }).sort();
    if (declaredUnsupported.length > 0) {
      assert.strictEqual(built.supported, false, `${id} must be unsupported`);
      assert.deepStrictEqual(built.unsupportedClauses.sort(), declaredUnsupported);
      results[id] = { verdict: "unsupported", clauses: declaredUnsupported };
    } else {
      assert.strictEqual(built.supported, true, `${id} is pure floor+minHero and must be supported`);
      results[id] = { verdict: "supported" };
    }
  }
  return results;
}

/**
 * The gain pool is the only quantitative input to the stat bound, so its
 * provenance is pinned: which floors, how many tiles, and the measured totals.
 */
function checkGainProvenance(project, milestones) {
  const gate = segmentById(milestones, GATE_ID);
  const pool = buildGainPool(project, gate);

  assert.deepStrictEqual(pool.floors, ["MT4", "MT5"], "third-gate scope is MT4+MT5");
  assert.strictEqual(pool.itemSources.length, 53, "measured item tile count");
  assert.strictEqual(pool.enemySources.length, 45, "measured enemy tile count");
  assert.deepStrictEqual(pool.totals, {
    exp: 1553, hp: 1691200, mdef: 9050, atk: 1430, def: 1480,
  }, "measured MT4+MT5 constant gain pool");

  // Proportional item effects cannot enter a constant pool. None exist in this
  // scope today; if one is ever added it must be excluded, not approximated.
  assert.deepStrictEqual(pool.nonConstant, [], "no proportional effects in scope");
  assert.deepStrictEqual(pool.errors, [], "every item effect executed cleanly");
  assert.strictEqual(pool.addPointEnabled, false, "enableAddPoint=false, so enemy point grants no atk");

  const graph = buildFloorGraph(project, gate);
  assert.strictEqual(graph.complete, true, "declared gateways all resolve");
  assert.deepStrictEqual(graph.adjacency, { MT4: ["MT5"], MT5: ["MT4"] });
  assert.deepStrictEqual(graph.unresolved, []);

  return {
    floors: pool.floors,
    itemTiles: pool.itemSources.length,
    enemyTiles: pool.enemySources.length,
    totals: pool.totals,
    floorGraph: graph.adjacency,
  };
}

/**
 * Level-up grants atk/def cumulatively and grants I608, which multiplies all
 * later battle exp.  Both make a constant bound unsound, so both must be
 * surfaced and handled explicitly rather than silently omitted.
 */
function checkUnsoundnessGuards(project, milestones) {
  const risk = summarizeLevelUpRisk(project, HERO_LV_AT_HANDOFF);
  assert.strictEqual(risk.applicable, true, "hero is lv4 of 35, level-ups remain");
  assert.strictEqual(risk.entriesTotal, 35);
  assert.ok(
    risk.remainingGrants.atk > 1e18,
    "level-up atk grants dwarf any milestone threshold, so no constant is sound",
  );
  assert.strictEqual(risk.remainingGrants.mdef, 0, "level-ups never grant mdef");
  assert.deepStrictEqual(
    risk.expMultiplierGrants.map((g) => g.atLevel),
    [5, 9, 14, 19, 25],
    "I608 is granted at lv5 and doubled at lv9/14/19/25",
  );
  assert.strictEqual(risk.maxExpMultiplier, 32, "worst-case exp multiplier");

  const gate = buildSegmentAdmissibleBounds(project, segmentById(milestones, GATE_ID), {
    heroLv: HERO_LV_AT_HANDOFF,
  });
  assert.deepStrictEqual(
    gate.provenance.omittedForLevelUp.sort(),
    ["atk", "def"],
    "atk/def carry no sound constant while level-ups remain",
  );
  assert.deepStrictEqual(gate.coverage.uncoveredFields, ["atk", "def"]);
  assert.strictEqual(
    gate.coverage.evidenceCompleteForDeclaredGoal,
    false,
    "a goal with uncovered fields is never evidence-complete",
  );
  // exp IS covered, but only because the multiplier is applied to the pool.
  assert.strictEqual(
    gate.admissibleBounds.optimisticHeroGain.exp,
    1553 * 32,
    "exp bound multiplies the measured pool by the worst-case I608 chain",
  );

  return {
    levelUpsRemain: risk.applicable,
    maxExpMultiplier: risk.maxExpMultiplier,
    omitted: gate.provenance.omittedForLevelUp,
    covered: gate.coverage.coveredFields,
    evidenceComplete: gate.coverage.evidenceCompleteForDeclaredGoal,
  };
}

/**
 * The headline negative result: a constant bound cannot refute third-gate on
 * any declared field.  Locking this prevents a future round from reporting
 * "bounds added, feasibility surface live" while the surface is inert.
 */
function checkConstantBoundCannotPrune(project, milestones) {
  const gate = segmentById(milestones, GATE_ID);
  const built = buildSegmentAdmissibleBounds(project, gate, { heroLv: HERO_LV_AT_HANDOFF });
  const goal = gate.goal.minHero;
  const sweepGoal = segmentById(milestones, SWEEP_ID).goal.minHero;

  const compiled = compileAdmissibleFeasibilityBounds(project, {
    ...gate,
    admissibleBounds: built.admissibleBounds,
  });

  // A candidate sitting exactly on the first-sweep thresholds is the weakest
  // state the third-gate segment can legitimately start from.
  const atSweep = heroState("MT5", sweepGoal);
  const verdict = compiled.evaluate(atSweep);
  assert.strictEqual(verdict.feasible, true, "the constant bound cannot refute a real start state");
  assert.notStrictEqual(verdict.unknown, true, "evidence exists, so this is not a vacuous pass");

  // Field by field: pool + current clears every threshold, so no prune is
  // reachable regardless of candidate.
  const perField = {};
  for (const [field, required] of Object.entries(goal)) {
    const gain = built.admissibleBounds.optimisticHeroGain[field];
    if (gain == null) { perField[field] = "uncovered"; continue; }
    const upper = Number(sweepGoal[field] || 0) + gain;
    perField[field] = upper >= Number(required) ? "cannot-prune" : "can-prune";
  }
  assert.deepStrictEqual(
    Object.values(perField).filter((v) => v === "can-prune"),
    [],
    "no covered field can refute third-gate with a constant bound",
  );

  // The exp question this round set out to answer, stated numerically.
  const expNeeded = Number(goal.exp) - Number(sweepGoal.exp);
  const rawEnemyExp = buildGainPool(project, gate).enemySources
    .reduce((sum, e) => sum + e.exp, 0);
  assert.strictEqual(expNeeded, 146, "third-gate needs +146 exp over first-sweep");
  assert.ok(
    rawEnemyExp >= expNeeded,
    "raw enemy exp in scope already covers the deficit even at multiplier 1",
  );

  return {
    perField,
    expNeeded,
    rawEnemyExpInScope: rawEnemyExp,
    conclusion: "constant-bound-cannot-prune-third-gate",
    pruningRequires: "state-dependent-remaining-resource-bound",
  };
}

/**
 * Zero false prune against known-good states. A bound that refutes a state the
 * tracked route actually reaches is a correctness bug, not a strong bound.
 */
function checkZeroFalsePrune(project, milestones) {
  const gate = segmentById(milestones, GATE_ID);
  const built = buildSegmentAdmissibleBounds(project, gate, { heroLv: HERO_LV_AT_HANDOFF });
  const compiled = compileAdmissibleFeasibilityBounds(project, {
    ...gate,
    admissibleBounds: built.admissibleBounds,
  });

  const controls = [
    { name: "at-first-sweep-thresholds", state: heroState("MT5", segmentById(milestones, SWEEP_ID).goal.minHero) },
    { name: "at-third-gate-thresholds", state: heroState("MT5", gate.goal.minHero) },
    { name: "on-MT4-mid-segment", state: heroState("MT4", segmentById(milestones, SWEEP_ID).goal.minHero) },
    { name: "zero-hero-on-MT5", state: heroState("MT5", {}) },
  ];

  const results = {};
  for (const control of controls) {
    const verdict = compiled.evaluate(control.state);
    results[control.name] = verdict.feasible ? "kept" : `PRUNED:${verdict.reason}`;
    assert.strictEqual(
      verdict.feasible,
      true,
      `${control.name} must not be refuted by the generated bounds`,
    );
  }

  // Negative control: the bound must still be capable of refuting something,
  // otherwise "zero false prune" is trivially satisfied by a dead bound.
  const unreachable = compileAdmissibleFeasibilityBounds(project, {
    ...gate,
    admissibleBounds: built.admissibleBounds,
  }).evaluate(heroState("MT1", gate.goal.minHero));
  assert.strictEqual(unreachable.feasible, false, "floor graph must still refute an off-graph floor");
  assert.strictEqual(unreachable.reason, "target-floor-unreachable");
  results["off-graph-floor-MT1"] = `PRUNED:${unreachable.reason}`;

  return results;
}

function main() {
  const project = loadProject(PROJECT_DIR);
  const milestones = require(MILESTONE_FILE).milestones || [];

  process.stdout.write(`${JSON.stringify({
    schema: "motapathfinder.mt5-feasibility-surface-contract.v1",
    status: "passed",
    controls: {
      observationOnly: true,
      productionPruningDefaultsUnchanged: true,
      auditDoesNotWriteMilestoneJson: true,
      boundsAreEvidenceNotConfiguration: true,
    },
    scope: {
      audited: [SWEEP_ID, GATE_ID, SUSTAIN_ID],
      rationale: "near-term chain under active third-gate investigation, not all milestones in the file",
    },
    clauseExpressibility: checkClauseExpressibility(project, milestones),
    gainProvenance: checkGainProvenance(project, milestones),
    unsoundnessGuards: checkUnsoundnessGuards(project, milestones),
    constantBoundLimit: checkConstantBoundCannotPrune(project, milestones),
    zeroFalsePrune: checkZeroFalsePrune(project, milestones),
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
