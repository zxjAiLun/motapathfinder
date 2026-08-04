"use strict";

const assert = require("node:assert");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { buildDpStateKey } = require("./lib/dp-search");
const {
  buildReplayRouteFingerprint,
} = require("./lib/replay-resume-artifact");
const {
  compileObjectiveSpec,
  compareLegacyStates,
} = require("./lib/objective-spec");
const { verifyRouteObjective } = require("./lib/live-replay");
const { readRouteFile } = require("./lib/route-store");
const { buildRegionProofClaim, loadRegionSpec } = require("./lib/region-spec");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const BASE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const GENERATED_ROOT = path.join(__dirname, "routes", "generated", "objective-spec-contract");
const OBJECTIVE_SPEC_FILE = path.join(GENERATED_ROOT, "onlyup-max-final-hp.spec.json");
const OBJECTIVE_ROUTE_FILE = path.join(GENERATED_ROOT, "onlyup-max-final-hp.route.json");

const MODEL = {
  heroFields: {
    hp: "dominance",
    hpmax: "disabled",
    mana: "disabled",
    manamax: "disabled",
    atk: "key",
    def: "key",
    mdef: "key",
    lv: "key",
    exp: "key",
    money: "disabled",
  },
};

function expectCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code, `expected ${code}`);
}

function makeState(hero, inventory, depth, routeLength) {
  return {
    floorId: "MT1",
    hero: { hp: 1, atk: 1, def: 1, mdef: 1, lv: 1, exp: 0, ...hero, loc: { x: 1, y: 1, direction: "down" } },
    inventory: inventory || {},
    flags: {},
    floorStates: {},
    visitedFloors: {},
    triggeredAutoEvents: {},
    meta: { decisionDepth: depth },
    route: Array.from({ length: routeLength == null ? depth : routeLength }, () => null),
  };
}

function runObjectiveRoute() {
  fs.mkdirSync(GENERATED_ROOT, { recursive: true });
  const base = JSON.parse(fs.readFileSync(BASE_SPEC_FILE, "utf8"));
  const spec = {
    ...base,
    id: "onlyup-objective-spec-contract",
    label: "Only Up ObjectiveSpec contract smoke",
    objective: {
      mode: "max-final-hp",
      requireGoal: true,
      tieBreakers: ["min-decision-depth"],
    },
  };
  fs.writeFileSync(OBJECTIVE_SPEC_FILE, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  const result = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, "run-region-dp.js"),
    `--project-root=${PROJECT_ROOT}`,
    `--region-spec=${OBJECTIVE_SPEC_FILE}`,
    `--out=${OBJECTIVE_ROUTE_FILE}`,
    "--max-expansions=1000",
    "--max-runtime-ms=10000",
    "--stop-on-first-goal=0",
    "--print-failures=0",
    "--structured-errors=1",
  ], {
    cwd: __dirname,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, `objective route generation failed: ${result.stderr || result.stdout}`);
  assert.ok(fs.existsSync(OBJECTIVE_ROUTE_FILE), "objective route output must exist");
  return readRouteFile(OBJECTIVE_ROUTE_FILE);
}

function main() {
  const model = compileObjectiveSpec(null, MODEL);
  assert.strictEqual(model.explicit, false, "missing objective must use legacy comparator");
  const legacyLeft = makeState({ hp: 20, atk: 3 }, {}, 4, 4);
  const legacyRight = makeState({ hp: 10, atk: 99 }, {}, 2, 2);
  assert.strictEqual(model.compareCandidates(legacyLeft, legacyRight), compareLegacyStates(legacyLeft, legacyRight));

  const clear = compileObjectiveSpec({ mode: "clear", tieBreakers: ["max-final-hp", "min-decision-depth"] }, MODEL);
  assert.strictEqual(clear.allowsFirstGoalStop, true);
  assert.strictEqual(clear.getStopPolicy(true).forcedEarlyStop, false);

  const maxHp = compileObjectiveSpec({ mode: "max-final-hp" }, MODEL);
  const highHp = makeState({ hp: 80 }, {}, 5, 5);
  const lowHp = makeState({ hp: 40 }, {}, 1, 1);
  assert.ok(maxHp.compareCandidates(highHp, lowHp) < 0, "max-final-hp must prefer higher final HP");
  const sameHpShorter = makeState({ hp: 80 }, {}, 2, 2);
  assert.ok(maxHp.compareCandidates(sameHpShorter, highHp) < 0, "max-final-hp must apply min-decision-depth tie-breaker");
  assert.strictEqual(maxHp.getStopPolicy(true).forcedEarlyStop, true);
  assert.strictEqual(maxHp.getStopPolicy(false).effective, false);
  const forcedMaxClaim = buildRegionProofClaim({
    found: true,
    reachedMilestone: "final",
    segmentResults: [{
      segmentId: "final",
      attempts: [{ diagnostics: { dp: {
        actionTrimmed: 0,
        stoppedReason: null,
        expansionBudgetExhausted: false,
        stopOnFirstGoal: true,
      } } }],
    }],
  }, { id: "objective-control", toMilestoneId: "final" }, maxHp);
  assert.strictEqual(forcedMaxClaim.objective.claim, "candidate-only");

  const lex = compileObjectiveSpec({
    mode: "lexicographic",
    objectives: ["clear", "max-final-hp", "max-final-atk", "min-route-length"],
  }, MODEL);
  assert.ok(lex.compareCandidates(makeState({ hp: 90, atk: 1 }, {}, 4, 4), makeState({ hp: 80, atk: 99 }, {}, 2, 2)) < 0);
  assert.strictEqual(lex.allowsFirstGoalStop, false);
  const clearOnlyLex = compileObjectiveSpec({ mode: "lexicographic", objectives: ["clear"] }, MODEL);
  assert.strictEqual(clearOnlyLex.allowsFirstGoalStop, true);

  const score = compileObjectiveSpec({
    mode: "maximize-score",
    requireGoal: true,
    terminalOnly: true,
    terms: [
      { path: "hero.hp", weight: 1 },
      { path: "hero.atk", weight: 500 },
      { path: "inventory.yellowKey", weight: 100 },
    ],
  }, MODEL);
  const scoreState = makeState({ hp: 50, atk: 2 }, { yellowKey: 3 }, 2, 2);
  assert.strictEqual(score.evaluateState(scoreState).value, 1350);

  expectCode(() => compileObjectiveSpec({ mode: "maximize", field: "hero.hpmax" }, MODEL), "OBJECTIVE_FIELD_NOT_MAINTAINED");
  expectCode(() => compileObjectiveSpec({ mode: "maximize", field: "hero.equipment" }, MODEL), "OBJECTIVE_FIELD_NOT_SUPPORTED");
  expectCode(() => compileObjectiveSpec({ mode: "maximize", field: "hero.unknown" }, MODEL), "OBJECTIVE_FIELD_NOT_SUPPORTED");
  expectCode(() => compileObjectiveSpec({ mode: "maximize-score", terms: [{ path: "hero.hp", weight: "100" }] }, MODEL), "OBJECTIVE_INVALID_WEIGHT");
  expectCode(() => compileObjectiveSpec({ mode: "maximize-score", terms: [{ path: "hero.hp", weight: 0 }] }, MODEL), "OBJECTIVE_INVALID_WEIGHT");
  expectCode(() => compileObjectiveSpec({ mode: "maximize", field: "hero.hp", requireGoal: false }, MODEL), "OBJECTIVE_REQUIRES_GOAL");

  const keySimulator = { solverModel: require("./lib/solver-model").normalizeSolverModel(MODEL) };
  const keyState = makeState({ hp: 70, atk: 4 }, { yellowKey: 1 }, 3, 3);
  const beforeKey = buildDpStateKey(keySimulator, keyState, { dpKeyMode: "location" });
  maxHp.evaluateState(keyState);
  const afterKey = buildDpStateKey(keySimulator, keyState, { dpKeyMode: "location" });
  assert.strictEqual(afterKey, beforeKey, "objective evaluation must not alter DP key");
  assert.ok(compareLegacyStates(highHp, lowHp) < 0, "legacy HP dominance comparator remains unchanged");

  const route = runObjectiveRoute();
  const metadata = route.metadata || {};
  assert.ok(metadata.objectiveSpec, "route metadata must persist objectiveSpec");
  assert.ok(metadata.objectiveFingerprint, "route metadata must persist objectiveFingerprint");
  assert.strictEqual(metadata.finalObjectiveValue, route.final.snapshot.hero.hp, "route metadata must persist final objective value");
  assert.ok(Array.isArray(metadata.objectiveComparisonTrace), "route metadata must persist objective comparison trace");
  assert.strictEqual(verifyRouteObjective(route, route.final.snapshot, route.decisions.length).matches, true);

  const tampered = JSON.parse(JSON.stringify(route));
  tampered.metadata.finalObjectiveValue += 1;
  expectCode(() => verifyRouteObjective(tampered, tampered.final.snapshot, tampered.decisions.length), "REPLAY_OBJECTIVE_VALUE_MISMATCH");

  const alternate = compileObjectiveSpec({ mode: "maximize-score", terms: [{ path: "hero.hp", weight: 1 }] }, MODEL);
  const alternateRoute = JSON.parse(JSON.stringify(route));
  alternateRoute.metadata.objectiveSpec = alternate.toJSON();
  alternateRoute.metadata.objectiveFingerprint = alternate.fingerprint;
  assert.notStrictEqual(
    buildReplayRouteFingerprint(route),
    buildReplayRouteFingerprint(alternateRoute),
    "different objective fingerprints must produce different route fingerprints",
  );

  const legacySpec = loadRegionSpec(BASE_SPEC_FILE);
  assert.strictEqual(legacySpec.objective, undefined, "legacy RegionSpec must remain objective-free");

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3b-objective-contract.v1",
    status: "passed",
    fingerprints: {
      maxFinalHp: maxHp.fingerprint,
      lexicographic: lex.fingerprint,
      score: score.fingerprint,
      route: metadata.objectiveFingerprint,
    },
    route: {
      decisions: route.decisions.length,
      finalHp: route.final.snapshot.hero.hp,
      finalObjectiveValue: metadata.finalObjectiveValue,
      proofClaim: route.metadata.regionDp && route.metadata.regionDp.proofClaim,
    },
    controls: {
      legacyComparator: true,
      objectiveDoesNotChangeDpKey: true,
      disabledFieldRejected: true,
      invalidWeightRejected: true,
      forcedEarlyStopIsCandidateOnly: maxHp.getStopPolicy(true).forcedEarlyStop,
      artifactFingerprintBound: true,
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main, runObjectiveRoute };
