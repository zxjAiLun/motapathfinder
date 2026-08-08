"use strict";

/**
 * PR-5.4d Repair — Self-Contained Guarded MT1 Candidate Key + Pinned Baseline.
 *
 * dpKeyProfile is now a REAL selection interface:
 *   - "production-region" (default) / absent -> buildDpStateKey (byte-for-byte)
 *   - "experimental-mt1-tower-ir-v1" -> the guarded TowerIR candidate builder,
 *     selected by the profile ALONE (no dpStateKeyBuilder injection required).
 *   - any other explicit profile -> throw before DP starts (fail-closed).
 *
 * The experimental profile is PINNED to the approved MT1 baseline via expected
 * fingerprints (project / region spec / TowerIR source / TowerIR).  Runtime
 * project or region semantic drift (enemy stats, items, map, events, stale IR)
 * fails closed: the actual compiled fingerprints are compared to the pinned
 * approved-baseline values and any mismatch throws.
 */

const { buildDpStateKey } = require("./dp-search");
const { buildSourceFingerprint, compileTowerIR } = require("./tower-ir");
const { buildProjectFingerprint } = require("./region-entry-validator");
const { fingerprintJson } = require("./solve-task");
const { stableValue } = require("./key-dependency-corpus");
const { buildCandidateDpKey } = require("./key-dependency-corpus");

const EXPERIMENTAL_PROFILE = "experimental-mt1-tower-ir-v1";
const PRODUCTION_PROFILE = "production-region";
const CANDIDATE_PROFILE = "without-start-component";
const CANDIDATE_PROFILE_VERSION = `${CANDIDATE_PROFILE}-v1`;

// Independent profile-version derivation: changing the candidate identity
// profile (or the version scheme) produces a different version string, which
// the pinned baseline assertion rejects until re-certified.
function deriveCandidateProfileVersion(profileName) {
  return `${profileName}-v1`;
}

// Pinned approved-baseline manifest for experimental-mt1-tower-ir-v1.
// Values captured from the closed PR-5.4c/5.4d baseline (region-output-contract
// -smoke, MT1, exp>=9).  Any drift of these inputs rejects the profile.
const APPROVED_MT1_BASELINE = {
  profile: EXPERIMENTAL_PROFILE,
  regionId: "onlyup-region-output-contract-smoke",
  floors: ["MT1"],
  expectedProjectFingerprint: "d50cdaaff91c21f61611d323814de88fc1117b70a8247a4e64b23eb10b3d12c6",
  expectedProjectStructuralFingerprint: "954efc84bf7cf9f19d19ed2e70e9e05b1459d1c0d69a9db9c532dd67d9e6dfc6",
  expectedRegionSpecFingerprint: "510312b10d5ccec1",
  expectedTowerIrSourceFingerprint: "96a0bb0f421e6138263fa0e4cbd35ed8a54b6c6c25faa56f13926a3eba5c1de4",
  expectedTowerIrFingerprint: "3c4b7c9bdc70720d",
  // Literal pinned version: an independent profile-version pin.  If the
  // candidate identity profile ever changes, the derived actual version stops
  // matching this literal and the profile is rejected until re-certified.
  expectedCandidateProfileVersion: "without-start-component-v1",
  candidateProfileVersion: CANDIDATE_PROFILE_VERSION,
};

const EXPECTED_FIELD_OF = {
  expectedProjectFingerprint: "projectFingerprint",
  expectedProjectStructuralFingerprint: "projectStructuralFingerprint",
  expectedRegionSpecFingerprint: "regionSpecFingerprint",
  expectedTowerIrSourceFingerprint: "towerIrSourceFingerprint",
  expectedTowerIrFingerprint: "towerIrFingerprint",
  expectedCandidateProfileVersion: "candidateProfileVersion",
};

// Region spec STRUCTURAL fingerprint: the normalized RegionSpec minus the goal
// (the goal is task/search config, not region structure).  Binds floors, scope,
// events, changeFloor, auto events, etc.  Any structural tamper changes it.
function computeRegionSpecFingerprint(regionSpec) {
  const { goal, ...structural } = regionSpec || {};
  return fingerprintJson(stableValue(structural));
}

function computeBaselineGuard(project, regionSpec, ir) {
  const pf = buildProjectFingerprint(project);
  return {
    regionId: regionSpec.id || null,
    floors: ((regionSpec.scope && regionSpec.scope.floors) || []).slice(),
    projectFingerprint: pf.fingerprintSha256,
    projectStructuralFingerprint: pf.structuralFingerprintSha256,
    regionSpecFingerprint: computeRegionSpecFingerprint(regionSpec),
    towerIrSourceFingerprint: ir.sourceFingerprint,
    towerIrFingerprint: ir.irFingerprint,
    candidateProfileVersion: deriveCandidateProfileVersion(CANDIDATE_PROFILE),
  };
}

// Validates actual fingerprints against the pinned approved baseline.
// Throws on any mismatch (fail-closed, no silent fallback).
function assertMatchesApprovedBaseline(actual, pinned) {
  const mismatches = [];
  Object.keys(EXPECTED_FIELD_OF).forEach((expectedKey) => {
    const actualField = EXPECTED_FIELD_OF[expectedKey];
    if (actual[actualField] !== pinned[expectedKey]) {
      mismatches.push({ key: expectedKey, expected: pinned[expectedKey], actual: actual[actualField] });
    }
  });
  if (mismatches.length > 0) {
    throw new Error(`guarded candidate key: approved baseline mismatch ${JSON.stringify(mismatches)}`);
  }
}

function createGuardedResolver(input) {
  const { simulator, project, ir, regionSpec } = input;
  const options = input.options || {};
  const pinned = options.pinned || APPROVED_MT1_BASELINE;
  const guard = computeBaselineGuard(project, regionSpec, ir);
  const allowedFloors = guard.floors.slice();

  function resolver(state, searchConfig) {
    const profile = searchConfig && searchConfig.dpKeyProfile
      ? searchConfig.dpKeyProfile
      : PRODUCTION_PROFILE;
    if (profile === PRODUCTION_PROFILE) {
      return buildDpStateKey(simulator, state, searchConfig);
    }
    if (profile === EXPERIMENTAL_PROFILE) {
      if (!state || !allowedFloors.includes(state.floorId)) {
        throw new Error(
          `guarded candidate key: floor ${state && state.floorId} outside bound scope ${allowedFloors.join(",")}`,
        );
      }
      return buildCandidateDpKey(simulator, project, ir, state, {
        goalPredicate: options.goalPredicate || null,
        profile: CANDIDATE_PROFILE,
      });
    }
    throw new Error(`guarded candidate key: unknown dpKeyProfile ${profile}`);
  }

  return { resolver, guard, pinned };
}

// Execution-boundary profile resolution.  dpKeyProfile ALONE selects the
// builder; unknown profiles throw.  Experimental compiles the TowerIR and
// validates against the pinned approved baseline.
function resolveDpKeyProfile(input) {
  const { project, regionSpec, simulator, dpKeyProfile } = input;
  const options = input.options || {};
  const profile = dpKeyProfile || PRODUCTION_PROFILE;
  if (profile === PRODUCTION_PROFILE) {
    return { profile: PRODUCTION_PROFILE, builder: null, guard: null };
  }
  if (profile !== EXPERIMENTAL_PROFILE) {
    throw new Error(`unknown dpKeyProfile: ${profile}`);
  }
  const towerId = options.towerId || (regionSpec && regionSpec.id) || "region";
  const ir = compileTowerIR(project, regionSpec, { towerId });
  const pf = buildProjectFingerprint(project);
  const actual = {
    projectFingerprint: pf.fingerprintSha256,
    projectStructuralFingerprint: pf.structuralFingerprintSha256,
    regionSpecFingerprint: computeRegionSpecFingerprint(regionSpec),
    towerIrSourceFingerprint: ir.sourceFingerprint,
    towerIrFingerprint: ir.irFingerprint,
    candidateProfileVersion: deriveCandidateProfileVersion(CANDIDATE_PROFILE),
  };
  assertMatchesApprovedBaseline(actual, APPROVED_MT1_BASELINE);
  const { resolver, guard } = createGuardedResolver({
    simulator,
    project,
    ir,
    regionSpec,
    options: { ...options, pinned: APPROVED_MT1_BASELINE },
  });
  return { profile: EXPERIMENTAL_PROFILE, builder: resolver, guard };
}

module.exports = {
  APPROVED_MT1_BASELINE,
  CANDIDATE_PROFILE_VERSION,
  EXPERIMENTAL_PROFILE,
  PRODUCTION_PROFILE,
  assertMatchesApprovedBaseline,
  createGuardedResolver,
  resolveDpKeyProfile,
};
