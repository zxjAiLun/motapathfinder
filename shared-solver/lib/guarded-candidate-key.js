"use strict";

/**
 * PR-5.4d Repair — Self-Contained Guarded MT1 Candidate Key + Pinned Baseline.
 * PR-5.4f — MT1 Default Promotion + Explicit Rollback.
 *
 * dpKeyProfile is a REAL selection interface with three distinct semantics:
 *   - "production-region" (EXPLICIT) -> old key path, builder=null (rollback).
 *     NEVER auto-promoted, even on an approved MT1 scope.
 *   - omitted (implicit default) -> SCOPE-AWARE FALLBACK: the approved MT1
 *     scope resolves to the guarded TowerIR candidate builder; any other
 *     scope stays production-region (never throws, never expands the promo).
 *   - "experimental-mt1-tower-ir-v1" (EXPLICIT) -> the guarded candidate
 *     builder, fail-closed on any baseline fingerprint / scope drift.
 *   - any other explicit profile -> throw before DP starts (fail-closed).
 *
 * The candidate profile is PINNED to the approved MT1 baseline via expected
 * fingerprints (project / region spec / TowerIR source / TowerIR).  Runtime
 * project or region semantic drift (enemy stats, items, map, events, stale IR)
 * fails closed for EXPLICIT experimental selection: the actual compiled
 * fingerprints are compared to the pinned approved-baseline values and any
 * mismatch throws.
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

  // The resolver is installed ONLY as the candidate builder (production uses
  // builder=null and the built-in buildDpStateKey).  Therefore an ABSENT
  // searchConfig.dpKeyProfile (implicit default) means the promoted candidate
  // path, not production.  An EXPLICIT production-region inside the resolver is
  // reachable only if a caller injects it directly (rollback installs builder=null,
  // so this is not hit by the real execution path).
  function resolver(state, searchConfig) {
    const profile = searchConfig && searchConfig.dpKeyProfile
      ? searchConfig.dpKeyProfile
      : EXPERIMENTAL_PROFILE;
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

// Non-throwing: does the given ACTUAL baseline guard match the approved MT1
// baseline?  Used by the implicit default path to decide whether the approved
// MT1 scope applies (fall back to production instead of throwing on drift).
function guardMatchesApprovedBaseline(actual) {
  return Object.keys(EXPECTED_FIELD_OF).every((expectedKey) => {
    const actualField = EXPECTED_FIELD_OF[expectedKey];
    return actual[actualField] === APPROVED_MT1_BASELINE[expectedKey];
  });
}

// Builds the guarded candidate resolution for an approved MT1 scope.  Assumes
// the caller has already confirmed (or will assert) the baseline match; it
// reuses the already-compiled TowerIR rather than recompiling.
function buildApprovedCandidateResolution(project, regionSpec, ir, simulator, options, reason, requestedProfile) {
  const guard = computeBaselineGuard(project, regionSpec, ir);
  const { resolver } = createGuardedResolver({
    simulator,
    project,
    ir,
    regionSpec,
    options: { ...options, pinned: APPROVED_MT1_BASELINE },
  });
  return {
    profile: EXPERIMENTAL_PROFILE,
    builder: resolver,
    guard,
    requestedProfile,
    effectiveProfile: EXPERIMENTAL_PROFILE,
    selectionReason: reason,
  };
}

// Execution-boundary profile resolution.  dpKeyProfile selects the builder.
//   - explicit "production-region" -> rollback (builder=null), never promoted.
//   - omitted -> scope-aware fallback: approved MT1 -> candidate, else production.
//   - explicit "experimental-mt1-tower-ir-v1" -> guarded candidate, fail-closed.
//   - unknown -> throw before DP starts.
function resolveDpKeyProfile(input) {
  const { project, regionSpec, simulator, dpKeyProfile } = input;
  const options = input.options || {};
  const requested = dpKeyProfile == null ? null : String(dpKeyProfile);

  // 1) Explicit rollback. production-region ALWAYS selects the old key path,
  //    even on an approved MT1 scope; it must never auto-promote back.
  if (requested === PRODUCTION_PROFILE) {
    return {
      profile: PRODUCTION_PROFILE,
      builder: null,
      guard: null,
      requestedProfile: PRODUCTION_PROFILE,
      effectiveProfile: PRODUCTION_PROFILE,
      selectionReason: "explicit-rollback",
    };
  }

  // 2) Implicit default (profile omitted): SCOPE-AWARE FALLBACK.  Only the
  //    approved MT1 scope resolves to the promoted candidate; every other scope
  //    stays production-region (never throws, never expands the promotion).
  if (requested == null) {
    const towerId = options.towerId || (regionSpec && regionSpec.id) || "region";
    const ir = compileTowerIR(project, regionSpec, { towerId });
    const guard = computeBaselineGuard(project, regionSpec, ir);
    if (guardMatchesApprovedBaseline(guard)) {
      return buildApprovedCandidateResolution(project, regionSpec, ir, simulator, options, "approved-mt1-default", null);
    }
    return {
      profile: PRODUCTION_PROFILE,
      builder: null,
      guard: null,
      requestedProfile: null,
      effectiveProfile: PRODUCTION_PROFILE,
      selectionReason: "scope-unapproved-fallback",
    };
  }

  // 3) Explicit experimental: preserve the existing fail-closed guard.
  if (requested === EXPERIMENTAL_PROFILE) {
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
    return buildApprovedCandidateResolution(project, regionSpec, ir, simulator, options, "explicit-experimental", EXPERIMENTAL_PROFILE);
  }

  // 4) Unknown explicit profile: fail closed before DP starts.
  throw new Error(`unknown dpKeyProfile: ${requested}`);
}

module.exports = {
  APPROVED_MT1_BASELINE,
  CANDIDATE_PROFILE_VERSION,
  EXPERIMENTAL_PROFILE,
  PRODUCTION_PROFILE,
  assertMatchesApprovedBaseline,
  createGuardedResolver,
  guardMatchesApprovedBaseline,
  resolveDpKeyProfile,
};
