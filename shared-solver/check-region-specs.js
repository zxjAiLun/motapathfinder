"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { buildRegionMilestoneSpec, buildRegionProofClaim, loadRegionSpec } = require("./lib/region-spec");

const ROOT = path.resolve(__dirname, "..");
const SPEC_ROOTS = [
  path.join(ROOT, "towers", "onlyup", "region-specs"),
  path.join(ROOT, "towers", "whiteisland", "trial-specs"),
];

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function resolveProjectRoot(spec) {
  return path.resolve(ROOT, spec.projectRoot);
}

function checkSpec(filePath) {
  const spec = loadRegionSpec(filePath);
  assert.equal(spec.search.algorithm, "segment-dp", `${spec.id}: algorithm should be segment-dp`);
  assert.equal(typeof spec.tower, "string", `${spec.id}: tower should be string`);
  assert.ok(Array.isArray(spec.scope.floors) && spec.scope.floors.length > 0, `${spec.id}: scope floors required`);
  assert.ok(spec.search.candidateLimit >= 1, `${spec.id}: candidateLimit must be positive`);
  assert.ok(["region", "location", "mutation"].includes(spec.search.dpKeyMode), `${spec.id}: invalid dpKeyMode`);
  assert.ok(spec.resourceTimingPolicy && spec.resourceTimingPolicy.hpPickupPolicy, `${spec.id}: hpPickupPolicy is required`);
  assert.ok(spec.expectedRegressionTraps.length > 0, `${spec.id}: expectedRegressionTraps required`);

  const projectRoot = resolveProjectRoot(spec);
  assert.ok(fs.existsSync(projectRoot), `${spec.id}: missing projectRoot ${projectRoot}`);
  const project = loadProject(projectRoot);
  const milestoneSpec = buildRegionMilestoneSpec(project, spec);
  assert.ok(Array.isArray(milestoneSpec.milestones) && milestoneSpec.milestones.length > 0, `${spec.id}: normalized milestone graph required`);

  const claim = buildRegionProofClaim({ found: false, segmentResults: [] }, spec);
  assert.equal(claim.proofLevel, "not-found", `${spec.id}: proof claim should classify failed empty result`);
  return {
    id: spec.id,
    tower: spec.tower,
    floors: spec.scope.floors,
    milestones: milestoneSpec.milestones.length,
  };
}

function main() {
  const files = SPEC_ROOTS.flatMap(listJsonFiles);
  assert.ok(files.length > 0, "expected at least one RegionSpec");
  const results = files.map(checkSpec);
  const sampleSpec = loadRegionSpec(files[0]);
  const completeClaim = buildRegionProofClaim({
    found: true,
    reachedMilestone: "final",
    segmentResults: [{
      segmentId: "final",
      attempts: [{
        diagnostics: {
          dp: {
            actionTrimmed: 0,
            stoppedReason: null,
            expansionBudgetExhausted: false,
            stopOnFirstGoal: false,
          },
        },
      }],
    }],
  }, { ...sampleSpec, toMilestoneId: "final" });
  assert.equal(completeClaim.proofLevel, "bounded-complete", "clean DP result should be bounded-complete");
  const candidateClaim = buildRegionProofClaim({
    found: true,
    reachedMilestone: "final",
    segmentResults: [{
      segmentId: "middle",
      attempts: [{
        diagnostics: {
          dp: {
            actionTrimmed: 0,
            stoppedReason: null,
            expansionBudgetExhausted: false,
            stopOnFirstGoal: true,
          },
        },
      }],
    }],
  }, { ...sampleSpec, toMilestoneId: "final" });
  assert.equal(candidateClaim.proofLevel, "candidate", "non-final stopOnFirstGoal should downgrade proof level");
  console.log(JSON.stringify({
    ok: true,
    count: results.length,
    specs: results,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
