"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.3c SolveTask contract: schema normalization, stable task identity,
 * input trust boundary (external compiled:true), budget validation, and
 * legacy region spec compatibility.  Uses a real Only Up region spec only for
 * the micro compile path; fingerprint controls are fully synthetic.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  SOLVE_TASK_SCHEMA,
  compileSolveTask,
  validateSolveTask,
  SolveTaskError,
} = require("./lib/solve-task");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function baseRegionSpec(overrides) {
  return {
    id: "synthetic-region",
    tower: "onlyup",
    rank: "chaos",
    scope: { floors: ["MT1"] },
    goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
    start: { type: "initial", floorId: "MT1" },
    search: { algorithm: "segment-dp", dpKeyMode: "region", candidateLimit: 2 },
    expectedRegressionTraps: ["synthetic-control"],
    resourceTimingPolicy: { mode: "unspecified" },
    actionPolicy: {
      actionKinds: ["battle", "pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"],
    },
    ...(overrides || {}),
  };
}

function baseTask(overrides) {
  const { tower: towerOverride, ...rest } = overrides || {};
  return {
    schema: SOLVE_TASK_SCHEMA,
    tower: {
      id: "onlyup-synthetic",
      projectRoot: "/absolute/path/to/onlyup",
      region: { spec: baseRegionSpec() },
      ...(towerOverride || {}),
    },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 0,
      candidateLimit: 8,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: true },
    ...rest,
  };
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code, `expected ${code}`);
}

function checkFingerprintStability() {
  // Same semantics, different JSON key order and local paths -> same fingerprint.
  const taskA = baseTask();
  const taskB = baseTask({
    tower: {
      region: { spec: baseRegionSpec({ id: "synthetic-region", rank: "chaos" }) },
      id: "onlyup-synthetic",
      projectRoot: "/another/absolute/path",
    },
    search: { goalSkylineLimit: 8, candidateLimit: 8, maxRuntimeMs: 0, maxExpansions: 1000, algorithm: "segment-dp" },
    verification: { strictReplay: true },
  });
  const compiledA = compileSolveTask(taskA);
  const compiledB = compileSolveTask(taskB);
  assert.strictEqual(compiledA.taskFingerprint, compiledB.taskFingerprint, "reordered keys / different absolute roots must not change the task fingerprint");

  // Different SolverModel -> different fingerprint.
  const withModel = compileSolveTask(baseTask({
    model: { heroFields: { hp: "dominance", atk: "key", def: "key", mdef: "key", lv: "key", exp: "key", money: "disabled" } },
  }));
  assert.notStrictEqual(withModel.taskFingerprint, compiledA.taskFingerprint, "different SolverModel must change the fingerprint");

  // Different ObjectiveSpec -> different fingerprint.
  const withScore = compileSolveTask(baseTask({
    objective: { mode: "maximize-score", terms: [{ path: "hero.hp", weight: 1 }] },
  }));
  assert.notStrictEqual(withScore.taskFingerprint, compiledA.taskFingerprint, "different ObjectiveSpec must change the fingerprint");

  // Different search budget -> different fingerprint.
  const withBudget = compileSolveTask(baseTask({
    search: { algorithm: "segment-dp", maxExpansions: 2000, maxRuntimeMs: 0, candidateLimit: 8, goalSkylineLimit: 8 },
  }));
  assert.notStrictEqual(withBudget.taskFingerprint, compiledA.taskFingerprint, "different search budget must change the fingerprint");

  // Recompiling a normalized task yields the same fingerprint (round-trip).
  const roundTripped = compileSolveTask(compiledA.toJSON(), { projectRoot: "/absolute/path/to/onlyup" });
  assert.strictEqual(roundTripped.taskFingerprint, compiledA.taskFingerprint, "normalized round-trip must preserve the fingerprint");
}

function checkInputTrustBoundary() {
  // External compiled:true must not bypass Objective-Search compatibility.
  expectCode(
    () => compileSolveTask(baseTask({
      objective: { compiled: true, mode: "maximize", field: "hero.hpmax" },
    })),
    "OBJECTIVE_FIELD_NOT_SEARCH_PRESERVED",
  );
  // A bare `{"compiled": true}` objective must be treated as an empty/unknown spec, not trusted.
  expectCode(
    () => compileSolveTask(baseTask({ objective: { compiled: true } })),
    "OBJECTIVE_UNSUPPORTED_MODE",
  );
  // External compiled marker on the task itself is stripped, not trusted.
  const task = compileSolveTask({ ...baseTask(), compiled: true });
  assert.strictEqual(task.compiled, true, "the compiled task returned by the solver may carry the internal marker");
  assert.strictEqual(typeof task.taskFingerprint, "string");
  // Region spec sourceFile injection must not change the task fingerprint.
  const withSourceFile = compileSolveTask(baseTask({
    tower: { region: { spec: baseRegionSpec({ sourceFile: "/injected/region.json" }) }, id: "onlyup-synthetic" },
  }));
  const plain = compileSolveTask(baseTask());
  assert.strictEqual(withSourceFile.taskFingerprint, plain.taskFingerprint, "region spec sourceFile injection must not affect identity");
}

function checkBudgetValidation() {
  expectCode(
    () => compileSolveTask(baseTask({ search: { maxExpansions: "NaN" } })),
    "INVALID_TASK",
  );
  expectCode(
    () => compileSolveTask(baseTask({ search: { maxExpansions: -5 } })),
    "INVALID_TASK",
  );
  expectCode(
    () => compileSolveTask(baseTask({ search: { maxExpansions: 0 } })),
    "INVALID_TASK",
    "maxExpansions=0 is rejected because searchDP would execute it as 1000",
  );
  expectCode(
    () => compileSolveTask(baseTask({ search: { maxRuntimeMs: -1 } })),
    "INVALID_TASK",
  );
  expectCode(
    () => compileSolveTask(baseTask({ search: { candidateLimit: 0 } })),
    "INVALID_TASK",
  );
  expectCode(
    () => compileSolveTask(baseTask({ schema: "motapathfinder.some-other.v1" })),
    "INVALID_TASK",
  );
  expectCode(
    () => compileSolveTask(baseTask({ search: { algorithm: "linear-main" } })),
    "INVALID_TASK",
  );
  expectCode(
    () => compileSolveTask(baseTask({ search: { dpKeyMode: "banana" } })),
    "INVALID_TASK",
  );
  const ok = compileSolveTask(baseTask());
  assert.strictEqual(ok.taskFingerprint.length, 16);
  assert.ok(Number.isFinite(ok.executeConfig.maxExpansions));
}

function checkEffectiveSearchSemantics() {
  // Nested regionSpec.search.dpBudget is inherited when no task budget is set.
  const nestedBudgetSpec = baseRegionSpec({
    search: {
      algorithm: "segment-dp",
      dpKeyMode: "region",
      candidateLimit: 2,
      dpBudget: { maxExpansions: 1234, maxRuntimeMs: 5678 },
    },
  });
  const inherited = compileSolveTask(baseTask({
    tower: { id: "onlyup-synthetic", region: { spec: nestedBudgetSpec } },
    search: undefined,
  }));
  assert.strictEqual(inherited.normalizedTask.search.maxExpansions, 1234, "regionSpec.search.dpBudget.maxExpansions must be inherited");
  assert.strictEqual(inherited.normalizedTask.search.maxRuntimeMs, 5678);
  assert.strictEqual(inherited.executeConfig.maxExpansions, 1234, "executeConfig must come from the same effective search");

  // Task-level search overrides the nested dpBudget.
  const overridden = compileSolveTask(baseTask({
    tower: { id: "onlyup-synthetic", region: { spec: nestedBudgetSpec } },
    search: { maxExpansions: 999 },
  }));
  assert.strictEqual(overridden.normalizedTask.search.maxExpansions, 999, "task search must override nested dpBudget");
  assert.strictEqual(overridden.executeConfig.maxExpansions, 999);
  assert.notStrictEqual(overridden.taskFingerprint, inherited.taskFingerprint);

  // Effective rank enters the fingerprint.
  const rankEasy = compileSolveTask(baseTask({ tower: { id: "onlyup-synthetic", rank: "easy" } }));
  const rankHard = compileSolveTask(baseTask({ tower: { id: "onlyup-synthetic", rank: "hard" } }));
  assert.notStrictEqual(rankEasy.taskFingerprint, rankHard.taskFingerprint, "rank must change the task fingerprint");
  assert.strictEqual(rankEasy.normalizedTask.tower.rank, "easy");
}

function checkProjectFingerprintBinding() {
  // A provided fingerprint is verified against the project at projectRoot.
  const realRoot = path.join(ROOT, "Only upV2.1", "Only upV2.1");
  const computed = compileSolveTask(baseTask({
    tower: { id: "onlyup-synthetic", projectRoot: realRoot, region: { spec: baseRegionSpec() } },
  }));
  assert.ok(computed.towerFingerprint, "the project fingerprint must be computed from real project content");
  assert.strictEqual(typeof computed.towerFingerprint, "string");
  // Same content, same fingerprint; a wrong provided fingerprint is rejected.
  const withCorrect = compileSolveTask(baseTask({
    tower: {
      id: "onlyup-synthetic",
      projectRoot: realRoot,
      projectFingerprint: computed.towerFingerprint,
      region: { spec: baseRegionSpec() },
    },
  }));
  assert.strictEqual(withCorrect.taskFingerprint, computed.taskFingerprint);
  expectCode(
    () => compileSolveTask(baseTask({
      tower: {
        id: "onlyup-synthetic",
        projectRoot: realRoot,
        projectFingerprint: "deadbeefdeadbeef",
        region: { spec: baseRegionSpec() },
      },
    })),
    "INVALID_TASK",
    "a projectFingerprint that does not match the project content must be rejected",
  );
}

function checkLegacyRegionWithoutModelObjective() {
  const legacySpec = baseRegionSpec();
  delete legacySpec.model;
  delete legacySpec.objective;
  const task = compileSolveTask(baseTask({
    objective: undefined,
    tower: { region: { spec: legacySpec }, id: "onlyup-synthetic" },
  }));
  assert.strictEqual(task.solverModelFingerprint, null);
  assert.strictEqual(task.objectiveFingerprint, null);
  assert.strictEqual(compileSolveTask(baseTask()).objectiveFingerprint != null, true);
  assert.strictEqual(validateSolveTask(baseTask()), true);
}

function checkRealRegionSpecCompile() {
  const spec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
  const task = compileSolveTask({
    schema: SOLVE_TASK_SCHEMA,
    tower: {
      id: "onlyup-smoke",
      projectRoot: ONLY_UP_ROOT,
      region: { spec },
    },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2 },
  });
  assert.strictEqual(task.schema, SOLVE_TASK_SCHEMA);
  assert.strictEqual(task.normalizedTask.tower.projectRoot, ONLY_UP_ROOT);
  assert.strictEqual(task.objective.mode, "max-final-hp");
  assert.ok(task.taskFingerprint.length === 16);
}

function main() {
  checkFingerprintStability();
  checkInputTrustBoundary();
  checkBudgetValidation();
  checkEffectiveSearchSemantics();
  checkProjectFingerprintBinding();
  checkLegacyRegionWithoutModelObjective();
  checkRealRegionSpecCompile();
  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.3c1-solve-task-contract.v1",
    status: "passed",
    controls: {
      fingerprintStableAcrossKeyOrderAndPaths: true,
      fingerprintChangesWithModelObjectiveBudget: true,
      rankChangesFingerprint: true,
      projectContentBindsFingerprint: true,
      wrongProjectFingerprintRejected: true,
      nestedDpBudgetInherited: true,
      taskSearchOverridesDpBudget: true,
      maxExpansionsZeroRejected: true,
      normalizedRoundTripPreservesFingerprint: true,
      externalCompiledRejected: true,
      sourceFileInjectionIgnored: true,
      nonFiniteAndNegativeBudgetsRejected: true,
      legacyRegionWithoutModelObjectiveAccepted: true,
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

module.exports = { main };
