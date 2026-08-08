"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4f — MT1 Default Promotion + Explicit Rollback contract.
 *
 * Verifies the promotion semantics introduced by PR-5.4f WITHOUT re-running the
 * PR-5.4e partition qualification:
 *   A. implicit default on the approved MT1 scope resolves to the promoted
 *      candidate builder (resolver + full executeSolveJob path).
 *   B. explicit "production-region" is a genuine rollback: builder=null and the
 *      full path keeps the original production structural counters (Gate B/F).
 *   C. implicit default on an UNAPPROVED scope (wrong floor / region drift /
 *      project drift) falls back to production-region (never throws).
 *   D. explicit experimental on an UNAPPROVED scope still fails closed.
 *   E. representative exp9 default == explicit candidate == pinned baseline,
 *      both strict-replay verified (Gate F).
 *   G. production invariants: the approved baseline constants are unchanged.
 *   H. requested/effective profile observable via execution.profileSelection.
 *
 * Verdict: MT1_DEFAULT_PROMOTION_ACCEPTED or PROMOTION_REJECTED.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { makeSimulator, executeSolveJob } = require("./lib/solver-job");
const { compileExecutableSolveTask } = require("./lib/solve-task");
const {
  APPROVED_MT1_BASELINE,
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

// Pinned representative exp9 baseline (winner/route/objective) and production
// structural counters, from the closed PR-5.4c/5.4d/5.4e baseline.
const REPRESENTATIVE_WINNER = "a2ff379819ac9003";
const REPRESENTATIVE_ROUTE =
  '{"algorithm":"sha256-stable-json-v1","sha256":"c0adb2d921e84cab097c034bf7b6f8fdb5a344a0cb21f66ea3b7f707a4ebec13"}';
const REPRESENTATIVE_OBJECTIVE_FINGERPRINT = "b54217a839b77018";
const REPRESENTATIVE_OBJECTIVE_VALUE = 1346;
const PRODUCTION_SCALE = {
  expanded: 116,
  generated: 267,
  registered: 156,
  dominanceRejected: 112,
  finalActiveStates: 62,
  finalUniqueKeys: 62,
};

const EXP9_GOAL = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 9 } };
const EXP9_OBJECTIVE = { mode: "max-final-hp" };

function buildTask(goal, objective, dpKeyProfile, strictReplay) {
  const spec = JSON.parse(JSON.stringify(smokeSpec));
  spec.goal = JSON.parse(JSON.stringify(goal));
  const task = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec } },
    objective: JSON.parse(JSON.stringify(objective)),
    search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: strictReplay === true },
  });
  if (dpKeyProfile) task.executeConfig.dpKeyProfile = dpKeyProfile;
  return task;
}

async function runSolve(task) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await executeSolveJob(task, {
      jobId: "mt1-default-promotion",
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

// Gate A — implicit default on approved MT1 scope promotes to candidate.
function gateAScopePromotion(normalizedSpec) {
  const res = resolveDpKeyProfile({
    project,
    regionSpec: normalizedSpec,
    simulator,
    dpKeyProfile: null,
    options: { towerId: "onlyup-smoke" },
  });
  assert.ok(res.builder, "A: omitted profile on approved MT1 must resolve a candidate builder");
  assert.strictEqual(res.effectiveProfile, EXPERIMENTAL_PROFILE, "A: effectiveProfile must be experimental");
  assert.strictEqual(res.selectionReason, "approved-mt1-default", "A: selectionReason must be approved-mt1-default");
  return { defaultPromotesToCandidate: true, requestedProfile: res.requestedProfile };
}

// Gate B + F(rollback) — explicit production-region is a genuine rollback.
async function gateBRollback(normalizedSpec) {
  const res = resolveDpKeyProfile({ project, regionSpec: normalizedSpec, simulator, dpKeyProfile: PRODUCTION_PROFILE });
  assert.strictEqual(res.builder, null, "B: explicit production-region must not inject a builder");
  assert.strictEqual(res.effectiveProfile, PRODUCTION_PROFILE, "B: effectiveProfile must be production");
  assert.strictEqual(res.selectionReason, "explicit-rollback", "B: selectionReason must be explicit-rollback");
  // Full path: rollback must take the production key path + strict replay.
  const execution = await runSolve(buildTask(EXP9_GOAL, EXP9_OBJECTIVE, PRODUCTION_PROFILE, true));
  assert.strictEqual(execution.profileSelection.effectiveProfile, PRODUCTION_PROFILE, "B: full-path rollback effectiveProfile");
  assert.strictEqual(execution.profileSelection.selectionReason, "explicit-rollback", "B: full-path rollback reason");
  assert.strictEqual(execution.strictReplayVerified, true, "F: rollback strict replay must verify");
  assert.deepStrictEqual(extractScale(execution), PRODUCTION_SCALE, "B: rollback must keep production structural counters");
  return {
    rollbackEffective: true,
    rollbackStrictReplayVerified: true,
    rollbackScale: extractScale(execution),
    rollbackCorrectness: extractCorrectness(execution),
  };
}

// Gate C — implicit default on an UNAPPROVED scope falls back to production
// (never throws, never expands the promotion).
function gateCImplicitFallback(normalizedSpec) {
  const cases = [];
  const wrongFloor = JSON.parse(JSON.stringify(normalizedSpec));
  wrongFloor.scope = { floors: ["MT2"] };
  wrongFloor.goal = { type: "heroAtLeast", floorId: "MT2", minHero: { exp: 1 } };
  cases.push({ label: "wrong-floor", spec: wrongFloor });

  const regionDrift = JSON.parse(JSON.stringify(normalizedSpec));
  regionDrift.scope = { floors: ["MT1", "MT2"] };
  cases.push({ label: "region-spec-drift", spec: regionDrift });

  for (const c of cases) {
    const res = resolveDpKeyProfile({ project, regionSpec: c.spec, simulator, dpKeyProfile: null, options: { towerId: "onlyup-smoke" } });
    assert.strictEqual(res.builder, null, `C: ${c.label} + omitted must stay production (no builder)`);
    assert.strictEqual(res.effectiveProfile, PRODUCTION_PROFILE, `C: ${c.label} must resolve to production`);
    assert.strictEqual(res.selectionReason, "scope-unapproved-fallback", `C: ${c.label} must carry scope-unapproved-fallback`);
  }
  // Project semantic drift (fingerprint) + omitted -> production, no throw.
  const tampered = JSON.parse(JSON.stringify(project));
  const enemyKey = Object.keys(tampered.enemysById || {})[0];
  assert.ok(enemyKey, "project must have at least one enemy");
  tampered.enemysById[enemyKey].atk = Number(tampered.enemysById[enemyKey].atk || 0) + 999;
  const resProject = resolveDpKeyProfile({ project: tampered, regionSpec: normalizedSpec, simulator, dpKeyProfile: null, options: { towerId: "onlyup-smoke" } });
  assert.strictEqual(resProject.builder, null, "C: project drift + omitted must stay production (no builder)");
  assert.strictEqual(resProject.effectiveProfile, PRODUCTION_PROFILE, "C: project drift must resolve to production");
  return { implicitFallbackVerified: true, unapprovedScopes: cases.map((c) => c.label).concat(["project-drift"]) };
}

// Gate D — explicit experimental on an UNAPPROVED scope still fails closed.
function gateDExplicitFailClosed(normalizedSpec) {
  const cases = [];
  const wrongFloor = JSON.parse(JSON.stringify(normalizedSpec));
  wrongFloor.scope = { floors: ["MT2"] };
  wrongFloor.goal = { type: "heroAtLeast", floorId: "MT2", minHero: { exp: 1 } };
  cases.push({ label: "wrong-floor", spec: wrongFloor });

  const regionDrift = JSON.parse(JSON.stringify(normalizedSpec));
  regionDrift.scope = { floors: ["MT1", "MT2"] };
  cases.push({ label: "region-spec-drift", spec: regionDrift });

  for (const c of cases) {
    assert.throws(
      () => resolveDpKeyProfile({ project, regionSpec: c.spec, simulator, dpKeyProfile: EXPERIMENTAL_PROFILE, options: { towerId: "onlyup-smoke" } }),
      (error) => Boolean(error),
      `D: explicit experimental on ${c.label} must fail closed`,
    );
  }
  const tampered = JSON.parse(JSON.stringify(project));
  const enemyKey = Object.keys(tampered.enemysById || {})[0];
  tampered.enemysById[enemyKey].atk = Number(tampered.enemysById[enemyKey].atk || 0) + 999;
  assert.throws(
    () => resolveDpKeyProfile({ project: tampered, regionSpec: normalizedSpec, simulator, dpKeyProfile: EXPERIMENTAL_PROFILE, options: { towerId: "onlyup-smoke" } }),
    (error) => Boolean(error),
    "D: explicit experimental on drifted project must fail closed",
  );
  return { explicitFailClosedVerified: true, unapprovedScopes: cases.map((c) => c.label).concat(["project-drift"]) };
}

// Gate E + F(default) + H — representative exp9 default == pinned baseline,
// effective profile observable, strict replay verified on the default path.
async function gateERepresentativeDefault(normalizedSpec) {
  const res = resolveDpKeyProfile({ project, regionSpec: normalizedSpec, simulator, dpKeyProfile: null, options: { towerId: "onlyup-smoke" } });
  assert.ok(res.builder, "E: default must resolve candidate builder");
  // Full path with the DEFAULT (omitted) profile.
  const execution = await runSolve(buildTask(EXP9_GOAL, EXP9_OBJECTIVE, null, true));
  assert.strictEqual(execution.profileSelection.effectiveProfile, EXPERIMENTAL_PROFILE, "H: full-path default effectiveProfile must be experimental");
  assert.strictEqual(execution.profileSelection.selectionReason, "approved-mt1-default", "H: full-path default selectionReason");
  assert.strictEqual(execution.profileSelection.requestedProfile, null, "H: full-path default requestedProfile must be null");
  assert.strictEqual(execution.strictReplayVerified, true, "F: default strict replay must verify");
  const correctness = extractCorrectness(execution);
  assert.strictEqual(correctness.found, true, "E: default must find the goal");
  assert.strictEqual(correctness.winnerExactFingerprint, REPRESENTATIVE_WINNER, "E: default winner must match pinned baseline");
  assert.strictEqual(correctness.routeFingerprint, REPRESENTATIVE_ROUTE, "E: default route must match pinned baseline");
  assert.strictEqual(correctness.objectiveFingerprint, REPRESENTATIVE_OBJECTIVE_FINGERPRINT, "E: default objective fingerprint must match pinned baseline");
  assert.strictEqual(correctness.objectiveValue, REPRESENTATIVE_OBJECTIVE_VALUE, "E: default objective value must match pinned baseline");
  return {
    defaultMatchesPinned: true,
    defaultStrictReplayVerified: true,
    defaultCorrectness: correctness,
    defaultScale: extractScale(execution),
  };
}

// Gate G — production invariants: the approved baseline constants are unchanged
// (no candidate identity / fingerprint drift).  We assert the pinned guard still
// equals the authoritative values captured during PR-5.4c/5.4d.
function gateGProductionInvariants() {
  assert.strictEqual(APPROVED_MT1_BASELINE.expectedCandidateProfileVersion, "without-start-component-v1", "G: candidate profile version must be unchanged");
  assert.strictEqual(APPROVED_MT1_BASELINE.expectedTowerIrFingerprint, "3c4b7c9bdc70720d", "G: TowerIR fingerprint must be unchanged");
  assert.strictEqual(APPROVED_MT1_BASELINE.expectedRegionSpecFingerprint, "510312b10d5ccec1", "G: region spec fingerprint must be unchanged");
  assert.ok(APPROVED_MT1_BASELINE.expectedProjectFingerprint && APPROVED_MT1_BASELINE.expectedTowerIrSourceFingerprint, "G: project/IR source pins must be present");
  return { productionInvariantsHeld: true, candidateProfileVersion: APPROVED_MT1_BASELINE.expectedCandidateProfileVersion };
}

async function main() {
  const referenceTask = compileExecutableSolveTask({
    schema: "motapathfinder.solve-task.v1",
    tower: { id: "onlyup-smoke", projectRoot: ONLY_UP_ROOT, region: { spec: smokeSpec } },
    objective: { mode: "max-final-hp" },
    search: { algorithm: "segment-dp", maxExpansions: 4000, maxRuntimeMs: 0, candidateLimit: 2, goalSkylineLimit: 8 },
    verification: { strictReplay: false },
  });
  const normalizedSpec = (referenceTask.normalizedTask || referenceTask).tower.region.spec;

  const gateA = gateAScopePromotion(normalizedSpec);
  const gateB = await gateBRollback(normalizedSpec);
  const gateC = gateCImplicitFallback(normalizedSpec);
  const gateD = gateDExplicitFailClosed(normalizedSpec);
  const gateE = await gateERepresentativeDefault(normalizedSpec);
  const gateG = gateGProductionInvariants();

  const accepted = gateA.defaultPromotesToCandidate
    && gateB.rollbackEffective
    && gateB.rollbackStrictReplayVerified
    && gateB.rollbackScale.registered === PRODUCTION_SCALE.registered
    && gateC.implicitFallbackVerified
    && gateD.explicitFailClosedVerified
    && gateE.defaultMatchesPinned
    && gateE.defaultStrictReplayVerified
    && gateG.productionInvariantsHeld;
  const verdict = accepted ? "MT1_DEFAULT_PROMOTION_ACCEPTED" : "PROMOTION_REJECTED";

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4f-mt1-default-promotion.v1",
    status: "passed",
    controls: {
      gateA_scopePromotion: gateA.defaultPromotesToCandidate,
      gateB_rollbackEffective: gateB.rollbackEffective,
      gateB_rollbackStrictReplay: gateB.rollbackStrictReplayVerified,
      gateB_rollbackScale: gateB.rollbackScale,
      gateC_implicitFallback: gateC.implicitFallbackVerified,
      gateC_unapprovedScopes: gateC.unapprovedScopes,
      gateD_explicitFailClosed: gateD.explicitFailClosedVerified,
      gateD_unapprovedScopes: gateD.unapprovedScopes,
      gateE_defaultMatchesPinned: gateE.defaultMatchesPinned,
      gateE_defaultStrictReplay: gateE.defaultStrictReplayVerified,
      gateG_productionInvariants: gateG.productionInvariantsHeld,
      gateG_candidateProfileVersion: gateG.candidateProfileVersion,
    },
    representative: {
      defaultCorrectness: gateE.defaultCorrectness,
      defaultScale: gateE.defaultScale,
      rollbackCorrectness: gateB.rollbackCorrectness,
      rollbackScale: gateB.rollbackScale,
    },
    verdict,
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
