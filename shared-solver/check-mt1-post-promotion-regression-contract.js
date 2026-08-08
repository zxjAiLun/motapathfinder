"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4g — Post-Promotion Full-Tower Regression.
 *
 * Verifies the MT1 default promotion is stable across the full execution paths
 * (single Region v1, unapproved scope fallback, and the campaign / multi-Region
 * v2 path) and that it does NOT scope-leak:
 *   S1. single approved MT1 Region, omitted profile -> candidate + pinned correctness.
 *   S2. single approved MT1 Region, explicit production-region -> rollback +
 *       production structural counters.
 *   S3. unapproved Region (different region id / fingerprint), omitted profile ->
 *       production fallback (no candidate builder).
 *   S4. campaign / multi-Region v2 [approved MT1, unapproved] -> the approved
 *       region resolves to candidate and the unapproved region stays production
 *       (per-region isolation, no cross-region leakage).
 *
 * This is NOT a new candidate-key certification (PR-5.4c/e) nor a multi-Region
 * candidate-key generalization; it only pins post-promotion behavior.
 *
 * Verdict: MT1_DEFAULT_PROMOTION_REGIME_STABLE or PROMOTION_REGRESSION.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { makeSimulator, executeSolveJob, executeSolveJobV2 } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const { compileSolveTaskV2 } = require("./lib/solve-task-v2");
const {
  EXPERIMENTAL_PROFILE,
  PRODUCTION_PROFILE,
  resolveDpKeyProfile,
} = require("./lib/guarded-candidate-key");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const SMOKE_SPEC_FILE = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");

const project = loadProject(ONLY_UP_ROOT);
const smokeSpec = JSON.parse(fs.readFileSync(SMOKE_SPEC_FILE, "utf8"));
const simulator = makeSimulator(project, smokeSpec, {});

const EXP9_GOAL = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
const OBJ = { mode: "max-final-hp" };
const REPRESENTATIVE_WINNER = "a2ff379819ac9003";
const REPRESENTATIVE_ROUTE =
  '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}';
const REPRESENTATIVE_OBJ_FP = "b54217a839b77018";
const REPRESENTATIVE_OBJ_VALUE = 1346;
const PRODUCTION_SCALE = {
  expanded: 116,
  generated: 267,
  registered: 156,
  dominanceRejected: 112,
  finalActiveStates: 62,
  finalUniqueKeys: 62,
};

function v1Model() {
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

function buildV1Task(goal, dpKeyProfile, strictReplay) {
  const spec = JSON.parse(JSON.stringify(smokeSpec));
  spec.goal = JSON.parse(JSON.stringify(goal));
  return buildV1TaskFromSpec(spec, dpKeyProfile, strictReplay);
}

function buildV1TaskFromSpec(spec, dpKeyProfile, strictReplay) {
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec: JSON.parse(JSON.stringify(spec)) } },
    objective: JSON.parse(JSON.stringify(OBJ)),
    search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: strictReplay === true },
  });
  if (dpKeyProfile) task.executeConfig.dpKeyProfile = dpKeyProfile;
  return task;
}

async function runV1(task) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await executeSolveJob(task, {
      jobId: "mt1-post-promotion-regression",
      onProgress: () => {},
      shouldStop: () => false,
      context: {},
    });
  } finally {
    console.log = originalLog;
  }
}

function extractScale(execution) {
  const att = (execution.result.segmentResults || [])[0] && (execution.result.segmentResults[0].attempts || [])[0];
  const dp = att && att.diagnostics && att.diagnostics.dp;
  return {
    expanded: dp ? Number(dp.expansions) : null,
    generated: dp && dp.actionsGeneratedByKind
      ? Object.values(dp.actionsGeneratedByKind).reduce((sum, value) => sum + (value || 0), 0)
      : null,
    registered: dp ? Number(dp.acceptedStates) : null,
    dominanceRejected: dp ? Number(dp.rejectedByHigherHp || 0) + Number(dp.sameHpRejected || 0) : null,
    finalActiveStates: dp && dp.registry ? Number(dp.registry.finalActiveStates) : null,
    finalUniqueKeys: dp && dp.registry ? Number(dp.registry.finalUniqueKeys) : null,
  };
}

function extractCorrectness(execution) {
  const winnerState = execution.result.finalCandidate && execution.result.finalCandidate.state;
  const routeFingerprint = execution.routeRecord
    ? (require("./lib/replay-resume-artifact").buildReplayRouteFingerprint(execution.routeRecord))
    : null;
  return {
    found: execution.result.found,
    winnerExactFingerprint: winnerState ? require("./lib/solver-job").exactStateFingerprint(winnerState) : null,
    routeFingerprint: routeFingerprint ? routeFingerprint.hash || JSON.stringify(routeFingerprint) : null,
    objectiveFingerprint: execution.objectiveValue ? execution.objectiveValue.fingerprint : null,
    objectiveValue: execution.objectiveValue ? execution.objectiveValue.value : null,
    strictReplayVerified: execution.strictReplayVerified,
  };
}

// An unapproved Region: same MT1 floor but a different region id + actionPolicy,
// so its structural fingerprint diverges from the approved baseline.
function unapprovedRegion() {
  const base = JSON.parse(JSON.stringify(smokeSpec));
  return {
    ...base,
    id: "onlyup-postpromo-region-b",
    actionPolicy: { actionKinds: ["pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"] },
    goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
  };
}

function v2Model() {
  return v1Model();
}

function buildV2Task(regions) {
  return compileSolveTaskV2({
    schema: "motapathfinder.solve-task.v2",
    // The approved baseline is bound to the "onlyup-smoke" TowerIR namespace
    // (used by every v1 contract).  Use it here so the campaign's approved MT1
    // region actually promotes; real unapproved region specs would not match
    // the approved baseline anyway (correct production fallback).
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, regions },
    model: v2Model(),
    objective: OBJ,
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 10000,
      candidateLimit: 2,
      regionCandidateLimit: 8,
    },
    verification: { strictReplay: false },
  });
}

async function runV2(task) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await executeSolveJobV2(task, {
      jobId: "mt1-post-promotion-campaign",
      onProgress: () => {},
      shouldStop: () => false,
      context: {},
    });
  } finally {
    console.log = originalLog;
  }
}

// The approved-baseline fingerprints correspond to the NORMALIZED region spec,
// so resolver checks must use the normalized spec (as executeSolveJob does).
function normalizedSmokeSpec() {
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec: JSON.parse(JSON.stringify(smokeSpec)) } },
    objective: JSON.parse(JSON.stringify(OBJ)),
    search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: false },
  });
  return (task.normalizedTask || task).tower.region.spec;
}

// S1 — single approved MT1, omitted profile -> candidate + pinned correctness.
async function scenario1() {
  const normalizedSpec = normalizedSmokeSpec();
  const res = resolveDpKeyProfile({ project, regionSpec: normalizedSpec, simulator, dpKeyProfile: null, options: { towerId: "onlyup-smoke" } });
  assert.ok(res.builder, "S1: implicit default on approved MT1 must resolve a candidate builder");
  assert.strictEqual(res.effectiveProfile, EXPERIMENTAL_PROFILE, "S1: effectiveProfile must be experimental");
  const execution = await runV1(buildV1Task(EXP9_GOAL, null, false));
  assert.strictEqual(execution.profileSelection.effectiveProfile, EXPERIMENTAL_PROFILE, "S1: full-path default effectiveProfile must be experimental");
  const c = extractCorrectness(execution);
  assert.strictEqual(c.found, true, "S1: default must find the goal");
  assert.strictEqual(c.winnerExactFingerprint, REPRESENTATIVE_WINNER, "S1: default winner must match pinned baseline");
  assert.strictEqual(c.routeFingerprint, REPRESENTATIVE_ROUTE, "S1: default route must match pinned baseline");
  assert.strictEqual(c.objectiveFingerprint, REPRESENTATIVE_OBJ_FP, "S1: default objective fp must match pinned baseline");
  assert.strictEqual(c.objectiveValue, REPRESENTATIVE_OBJ_VALUE, "S1: default objective value must match pinned baseline");
  return { defaultPromotes: true, defaultMatchesPinned: true };
}

// S2 — single approved MT1, explicit production-region -> rollback + production scale.
async function scenario2() {
  const normalizedSpec = normalizedSmokeSpec();
  const res = resolveDpKeyProfile({ project, regionSpec: normalizedSpec, simulator, dpKeyProfile: PRODUCTION_PROFILE });
  assert.strictEqual(res.builder, null, "S2: explicit production-region must not inject a builder");
  assert.strictEqual(res.effectiveProfile, PRODUCTION_PROFILE, "S2: effectiveProfile must be production");
  const execution = await runV1(buildV1Task(EXP9_GOAL, PRODUCTION_PROFILE, false));
  assert.strictEqual(execution.profileSelection.effectiveProfile, PRODUCTION_PROFILE, "S2: full-path rollback effectiveProfile must be production");
  assert.strictEqual(execution.profileSelection.selectionReason, "explicit-rollback", "S2: full-path rollback selectionReason");
  assert.deepStrictEqual(extractScale(execution), PRODUCTION_SCALE, "S2: rollback must keep production structural counters");
  return { rollbackEffective: true, rollbackScale: extractScale(execution) };
}

// S3 — unapproved Region, omitted profile -> production fallback (no candidate builder).
async function scenario3() {
  const spec = unapprovedRegion();
  const res = resolveDpKeyProfile({ project, regionSpec: spec, simulator, dpKeyProfile: null, options: { towerId: "onlyup-smoke" } });
  assert.strictEqual(res.builder, null, "S3: unapproved scope + omitted must stay production (no candidate builder)");
  assert.strictEqual(res.effectiveProfile, PRODUCTION_PROFILE, "S3: unapproved scope must resolve to production");
  assert.strictEqual(res.selectionReason, "scope-unapproved-fallback", "S3: must carry scope-unapproved-fallback");
  // Full-path: execute a v1 task on the unapproved region -> production fallback observed.
  const execution = await runV1(buildV1TaskFromSpec(spec, null, false));
  assert.strictEqual(execution.profileSelection.effectiveProfile, PRODUCTION_PROFILE, "S3: full-path unapproved default must stay production");
  assert.strictEqual(execution.profileSelection.selectionReason, "scope-unapproved-fallback", "S3: full-path unapproved reason");
  return { implicitFallbackNoCandidateBuilder: true };
}

// S4 — campaign / multi-Region v2 [approved MT1, unapproved] -> per-region
// isolation (approved region candidate, unapproved region production; no leak).
async function scenario4() {
  const smoke = JSON.parse(JSON.stringify(smokeSpec));
  const task = buildV2Task([{ spec: smoke }, { spec: unapprovedRegion() }]);
  const execution = await runV2(task);
  assert.ok(Array.isArray(execution.regions) && execution.regions.length === 2, "S4: campaign must run both regions");
  const r0 = execution.regions[0];
  const r1 = execution.regions[1];
  assert.strictEqual(r0.status, "completed", "S4: approved MT1 region must complete");
  assert.strictEqual(r0.profileSelection.effectiveProfile, EXPERIMENTAL_PROFILE, "S4: approved MT1 region must resolve to candidate");
  assert.strictEqual(r0.profileSelection.selectionReason, "approved-mt1-default", "S4: approved MT1 region selectionReason");
  assert.strictEqual(r1.status, "completed", "S4: unapproved region must complete");
  assert.strictEqual(r1.profileSelection.effectiveProfile, PRODUCTION_PROFILE, "S4: unapproved region must stay production (no leak)");
  assert.strictEqual(r1.profileSelection.selectionReason, "scope-unapproved-fallback", "S4: unapproved region selectionReason");
  // No candidate builder leaked from region 0 into region 1.
  assert.strictEqual(r0.profileSelection.effectiveProfile === EXPERIMENTAL_PROFILE && r1.profileSelection.effectiveProfile === PRODUCTION_PROFILE, true, "S4: per-region isolation");
  return {
    approvedRegionPromoted: r0.profileSelection.effectiveProfile === EXPERIMENTAL_PROFILE,
    unapprovedRegionProduction: r1.profileSelection.effectiveProfile === PRODUCTION_PROFILE,
    perRegionIsolation: true,
  };
}

async function main() {
  const s1 = await scenario1();
  const s2 = await scenario2();
  const s3 = await scenario3();
  const s4 = await scenario4();

  const stable = s1.defaultPromotes
    && s1.defaultMatchesPinned
    && s2.rollbackEffective
    && s2.rollbackScale.registered === PRODUCTION_SCALE.registered
    && s3.implicitFallbackNoCandidateBuilder
    && s4.perRegionIsolation
    && s4.approvedRegionPromoted
    && s4.unapprovedRegionProduction;
  const verdict = stable ? "MT1_DEFAULT_PROMOTION_REGIME_STABLE" : "PROMOTION_REGRESSION";

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4g-post-promotion-regression.v1",
    status: "passed",
    controls: {
      s1_defaultPromotes: s1.defaultPromotes,
      s1_defaultMatchesPinned: s1.defaultMatchesPinned,
      s2_rollbackEffective: s2.rollbackEffective,
      s2_rollbackScale: s2.rollbackScale,
      s3_implicitFallbackNoCandidateBuilder: s3.implicitFallbackNoCandidateBuilder,
      s4_approvedRegionPromoted: s4.approvedRegionPromoted,
      s4_unapprovedRegionProduction: s4.unapprovedRegionProduction,
      s4_perRegionIsolation: s4.perRegionIsolation,
    },
    verdict,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
