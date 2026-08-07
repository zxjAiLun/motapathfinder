"use strict";

/**
 * PR-5.4d — Guarded MT1 Candidate Key resolver.
 *
 * Promotes the PR-5.4c `without-start-component` candidate identity from a
 * contract-internal function injection to a formally defined, default-off,
 * MT1-only, fingerprint-bound, fail-closed experimental DP-key profile.
 *
 * dpKeyProfile:
 *   - "production-region" (default) -> buildDpStateKey (byte-for-byte)
 *   - "experimental-mt1-tower-ir-v1" -> TowerIR structural WITHOUT
 *     startComponentId + current resource identity + current event/hazard
 *     label, only for the bound MT1 scope.
 *
 * Scope is fail-closed: an unknown profile or a floor outside the bound scope
 * throws; there is NO silent fallback to the production key.
 */

const { buildDpStateKey } = require("./dp-search");
const { buildSourceFingerprint } = require("./tower-ir");
const { buildCandidateDpKey } = require("./key-dependency-corpus");

const EXPERIMENTAL_PROFILE = "experimental-mt1-tower-ir-v1";
const PRODUCTION_PROFILE = "production-region";
const CANDIDATE_PROFILE_VERSION = "without-start-component-v1";

function computeProjectFingerprint(project) {
  const data = project && (project.data || project.projectData) || {};
  const digest = (require("crypto").createHash("sha256"));
  digest.update(String(data.title || data.name || ""));
  return digest.digest("hex").slice(0, 16);
}

// Creates a resolver(state, searchConfig) plus the bound guard metadata.
// At creation the TowerIR source fingerprint must match the region spec, and
// the scope must be a single MT1 floor.  At runtime the resolver throws for
// unknown profiles or out-of-scope floors.
function createGuardedKeyResolver(input) {
  const { simulator, project, ir, regionSpec } = input;
  const options = input.options || {};
  if (!simulator || !project || !ir || !regionSpec) {
    throw new Error("createGuardedKeyResolver requires simulator, project, ir, regionSpec");
  }
  const allowedFloors = ((regionSpec.scope && regionSpec.scope.floors) || []).slice();
  if (allowedFloors.length !== 1 || allowedFloors[0] !== "MT1") {
    throw new Error(`guarded candidate key requires exactly MT1 scope (got ${allowedFloors.join(",")})`);
  }
  const regionFingerprint = buildSourceFingerprint(project, regionSpec);
  if (ir.sourceFingerprint !== regionFingerprint) {
    throw new Error(
      `guarded candidate key: TowerIR source fingerprint does not match region spec (${ir.sourceFingerprint} vs ${regionFingerprint})`,
    );
  }
  const guard = {
    regionId: regionSpec.id || null,
    floors: allowedFloors.slice(),
    projectFingerprint: computeProjectFingerprint(project),
    regionFingerprint,
    towerIrSourceFingerprint: ir.sourceFingerprint,
    towerIrFingerprint: ir.irFingerprint,
    candidateProfileVersion: CANDIDATE_PROFILE_VERSION,
  };

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
        profile: "without-start-component",
      });
    }
    throw new Error(`guarded candidate key: unknown dpKeyProfile ${profile}`);
  }

  return { resolver, guard, EXPERIMENTAL_PROFILE, PRODUCTION_PROFILE, CANDIDATE_PROFILE_VERSION };
}

module.exports = {
  CANDIDATE_PROFILE_VERSION,
  EXPERIMENTAL_PROFILE,
  PRODUCTION_PROFILE,
  computeProjectFingerprint,
  createGuardedKeyResolver,
};
