"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4a Commit 1: solve-task.v2 ordered-region contract.  Locks the public
 * JSON shape, the v1 compatibility gate, the region-sequence fingerprint, the
 * explicit-model requirement, regionCandidateLimit inheritance, and the
 * non-goals (per-region objective/model/search rejected) BEFORE any executor
 * or Launcher work.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { SOLVE_TASK_SCHEMA, compileSolveTask } = require("./lib/solve-task");
const {
  SOLVE_TASK_V2_SCHEMA,
  compileExecutableSolveTaskV2,
  compileSolveTaskV2,
  validateSolveTaskV2,
} = require("./lib/solve-task-v2");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const REGION_1_SPEC = path.join(ROOT, "towers", "onlyup", "region-specs", "region-1.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function readSpec(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function model() {
  return {
    heroFields: {
      hp: "dominance",
      atk: "key",
      def: "key",
      mdef: "key",
      lv: "key",
      exp: "key",
      money: "disabled",
      equipment: "key",
      followers: "disabled",
      hpmax: "disabled",
      mana: "disabled",
      manamax: "disabled",
    },
  };
}

function v2Task(overrides) {
  return {
    schema: SOLVE_TASK_V2_SCHEMA,
    tower: {
      id: "onlyup-v2.1",
      projectRoot: ONLY_UP_ROOT,
      regions: [
        { spec: readSpec(SMOKE_SPEC) },
        { spec: readSpec(REGION_1_SPEC) },
      ],
    },
    model: model(),
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 4 },
    verification: { strictReplay: false },
    ...(overrides || {}),
  };
}

function v1Task() {
  return {
    schema: SOLVE_TASK_SCHEMA,
    tower: {
      id: "onlyup-v2.1",
      projectRoot: ONLY_UP_ROOT,
      region: { spec: readSpec(SMOKE_SPEC) },
    },
    model: model(),
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 4 },
    verification: { strictReplay: false },
  };
}

function expectInvalid(code, task) {
  assert.throws(
    () => compileSolveTaskV2(task),
    (error) => error && error.code === code,
    `expected INVALID_TASK (${code})`,
  );
}

function main() {
  // 1. v1 compatibility gate: the v1 single-region path is untouched and its
  //    normalized shape / fingerprint are stable (compile-only gate).
  const v1 = compileSolveTask(v1Task());
  assert.strictEqual(v1.schema, SOLVE_TASK_SCHEMA);
  assert.ok(v1.taskFingerprint, "v1 fingerprint must be produced");
  assert.ok(v1.normalizedTask.tower.region.spec.id, "v1 normalized task keeps single region spec");
  const v1Again = compileSolveTask(v1Task());
  assert.strictEqual(v1.taskFingerprint, v1Again.taskFingerprint, "v1 fingerprint must be deterministic");

  // 2. v2 compiles with an ordered region sequence; schema and fingerprints exist.
  const task = compileSolveTaskV2(v2Task());
  assert.strictEqual(task.schema, SOLVE_TASK_V2_SCHEMA);
  assert.strictEqual(task.normalizedTask.tower.regions.length, 2);
  assert.ok(task.taskFingerprint, "v2 task fingerprint must be produced");
  assert.strictEqual(task.regionFingerprints.length, 2);
  assert.strictEqual(task.solverModelFingerprint, compileSolveTaskV2(v2Task()).solverModelFingerprint);

  // 3. The region ORDER participates in the fingerprint.
  const reversed = compileSolveTaskV2(v2Task({
    tower: {
      id: "onlyup-v2.1",
      projectRoot: ONLY_UP_ROOT,
      regions: [
        { spec: readSpec(REGION_1_SPEC) },
        { spec: readSpec(SMOKE_SPEC) },
      ],
    },
  }));
  assert.notStrictEqual(reversed.taskFingerprint, task.taskFingerprint, "region order must change the task fingerprint");

  // 4. v2 requires an explicit task.model.
  expectInvalid("INVALID_TASK", v2Task({ model: undefined }));

  // 5. tower.regions must be non-empty and ordered.
  expectInvalid("INVALID_TASK", v2Task({ tower: { id: "t", projectRoot: ONLY_UP_ROOT, regions: [] } }));

  // 6. Per-region objective/model/search overrides are rejected (non-goals).
  expectInvalid("INVALID_TASK", v2Task({ tower: {
    id: "t", projectRoot: ONLY_UP_ROOT,
    regions: [{ spec: readSpec(SMOKE_SPEC) }, { spec: readSpec(REGION_1_SPEC), objective: { mode: "clear" } }],
  } }));
  expectInvalid("INVALID_TASK", v2Task({ tower: {
    id: "t", projectRoot: ONLY_UP_ROOT,
    regions: [{ spec: readSpec(SMOKE_SPEC), search: { maxExpansions: 1 } }, { spec: readSpec(REGION_1_SPEC) }],
  } }));

  // 7. regionCandidateLimit: default inherits candidateLimit, explicit value is
  //    normalized and participates in the fingerprint.
  assert.strictEqual(task.search.regionCandidateLimit, 4, "default regionCandidateLimit inherits candidateLimit");
  assert.strictEqual(task.search.regionCandidateLimitSource, "candidateLimit");
  const explicit = compileSolveTaskV2(v2Task({ search: { algorithm: "segment-dp", maxExpansions: 1000, candidateLimit: 4, regionCandidateLimit: 8 } }));
  assert.strictEqual(explicit.search.regionCandidateLimit, 8);
  assert.strictEqual(explicit.search.regionCandidateLimitSource, "explicit");
  assert.notStrictEqual(explicit.taskFingerprint, task.taskFingerprint, "regionCandidateLimit must participate in the fingerprint");
  expectInvalid("INVALID_TASK", v2Task({ search: { algorithm: "segment-dp", maxExpansions: 1000, candidateLimit: 4, regionCandidateLimit: 0 } }));

  // 8. validateSolveTaskV2 accepts the valid task.
  assert.strictEqual(validateSolveTaskV2(v2Task()), true);

  // 9. The v2 normalized task keeps search explicit and objective only as the
  //    task-level objective (no per-region objective leaks into the spec).
  const normalized = task.toJSON();
  assert.strictEqual(normalized.schema, SOLVE_TASK_V2_SCHEMA);
  assert.ok(normalized.objective && normalized.objective.mode === "max-final-hp");
  assert.ok(!("objective" in normalized.tower.regions[0]), "region entries must not carry objectives");

  // 10. Same-project verification at executable preflight: a region referencing
  //     a floor that does not exist in the task project must be rejected.
  const foreign = v2Task();
  foreign.tower.regions[0].spec = {
    ...JSON.parse(JSON.stringify(readSpec(SMOKE_SPEC))),
    scope: { floors: ["FLOOR_DOES_NOT_EXIST"] },
  };
  assert.throws(
    () => compileExecutableSolveTaskV2(foreign),
    (error) => error && error.code === "INVALID_TASK",
    "a foreign-floor region must be rejected at executable preflight",
  );
  // An unsupported region start.type is also rejected at executable preflight.
  const badStart = v2Task();
  badStart.tower.regions[1].spec = { ...JSON.parse(JSON.stringify(readSpec(REGION_1_SPEC))), start: { type: "bogus" } };
  assert.throws(
    () => compileExecutableSolveTaskV2(badStart),
    (error) => error && error.code === "INVALID_TASK",
    "an unsupported region start.type must be rejected at executable preflight",
  );

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4a-solve-task-v2-contract.v1",
    status: "passed",
    controls: {
      v1CompatibilityGate: true,
      v2RegionSequenceCompiles: true,
      regionOrderInFingerprint: true,
      explicitModelRequired: true,
      regionsNonEmpty: true,
      perRegionOverridesRejected: true,
      regionCandidateLimitInheritance: true,
      regionCandidateLimitInFingerprint: true,
      validationAcceptsValidV2: true,
      taskLevelObjectiveOnly: true,
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
