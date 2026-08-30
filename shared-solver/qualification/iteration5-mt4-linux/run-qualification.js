"use strict";

/**
 * PR-5.24b Iteration 5 Final Authority Qualification — CI runner.
 *
 * This is a THIN wrapper: it copies the byte-frozen harness (tracked in this
 * qualification branch under qualification/iteration5-mt4-linux/) back to the
 * original shared-solver/.tmp-* paths and executes it, so the executed code is
 * byte-identical to the locally frozen Iteration-5 harness.
 *
 * Stage 1 (smoke): one fresh OFF run; environment PASS iff
 *   no rss-limit AND no heap-limit AND processTreePeakMb < 250
 *   AND unknownCompletion == 0.
 *   FAIL -> exit 0 with qualificationStatus=ENVIRONMENT_INVALID (terminate).
 * Stage 2 (on PASS): fresh-process sequence OFF-1, ON-1, OFF-2, ON-2, OFF-3,
 *   ON-3 via the frozen orchestrator, then emit a compact aggregate.
 *
 * No solver files or experiment configuration are modified.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

// This wrapper lives at <repo>/shared-solver/qualification/iteration5-mt4-linux/
const SOLVER_DIR = path.resolve(__dirname, "..", "..");
const EVIDENCE_DIR = __dirname;
const TARGET_DIR = SOLVER_DIR;

const HARNESS_A = "qualify-iteration5.js";      // orchestrator
const HARNESS_B = "qualify-iteration5-run.js";  // single-run child
const FROZEN_SHA256 = {
  [HARNESS_A]: "83147509769EE830D758556514E530C56BD189F21135B18A9A62FA34CF1F1285",
  [HARNESS_B]: "A006AAD5FA02822C91B0090BE24651C4AE5187862B009871D1B410E6AFB649E1",
};

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

// ---- verify + copy harness byte-for-byte ----
for (const name of [HARNESS_A, HARNESS_B]) {
  const src = path.join(EVIDENCE_DIR, name);
  const actual = sha256(src);
  if (actual !== FROZEN_SHA256[name]) {
    console.error(`FROZEN HARNESS MISMATCH for ${name}: ${actual} != ${FROZEN_SHA256[name]}`);
    process.exit(1);
  }
  const dst = path.join(TARGET_DIR, `.tmp-${name.replace(/^qualify-/, "qualify-")}`);
  fs.copyFileSync(src, dst);
  const dstSha = sha256(dst);
  if (dstSha !== FROZEN_SHA256[name]) {
    console.error(`COPY MISMATCH for ${dst}: ${dstSha}`);
    process.exit(1);
  }
  console.log(`harness ${name}: sha256=${dstSha} (verified, copied to ${path.basename(dst)})`);
}

const CHILD = path.join(TARGET_DIR, ".tmp-qualify-iteration5-run.js");
const ORCH = path.join(TARGET_DIR, ".tmp-qualify-iteration5.js");

function runChild(label, mode) {
  const res = spawnSync(
    process.execPath,
    ["--expose-gc", CHILD, mode, label],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000 },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`run ${label} failed (${res.status}): ${res.stderr}\n${res.stdout}`);
  }
  const lines = res.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function writeJson(name, obj) {
  const outDir = path.join(TARGET_DIR, "routes", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, JSON.stringify(obj, null, 2));
  console.log(`wrote ${outPath}`);
  return outPath;
}

// ---- Stage 1: OFF smoke with environment gate ----
console.log("=== STAGE 1: OFF smoke (environment gate) ===");
const smoke = runChild("SMOKE-OFF", "control");
writeJson("iteration5-final-smoke.json", smoke);

const smokePass =
  smoke.budget.stoppedReason !== "rss-limit" &&
  smoke.budget.stoppedReason !== "heap-limit" &&
  Number(smoke.processTree.peakRssMb || 0) < 250 &&
  Number(smoke.runWide.unknownCompletion || 0) === 0;
const smokeDetail = {
  label: smoke.label,
  found: smoke.found,
  finalCanonicalOutcome: smoke.finalCanonicalOutcome,
  budgetStoppedReason: smoke.budget.stoppedReason,
  processTreePeakMb: smoke.processTree.peakRssMb,
  unknownCompletion: smoke.runWide.unknownCompletion,
  pass: smokePass,
};
console.log(`SMOKE_GATE=${smokePass ? "PASS" : "FAIL"} ${JSON.stringify(smokeDetail)}`);

if (!smokePass) {
  writeJson("iteration5-final-qualification.json", {
    schema: "motapathfinder.iteration5-final-qualification.v1",
    qualificationStatus: "ENVIRONMENT_INVALID",
    smoke: smokeDetail,
    note: "Terminated per authorization: do not run the remaining five runs; do not change solver or performance code.",
  });
  console.log("QUALIFICATION_STATUS=ENVIRONMENT_INVALID (terminated before 3+3)");
  process.exit(0);
}

// ---- Stage 2: frozen 3+3 via the original orchestrator ----
console.log("=== STAGE 2: frozen OFF/ON 3+3 ===");
const orch = spawnSync(process.execPath, [ORCH], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 1800000 });
if (orch.error) throw orch.error;
if (orch.status !== 0) {
  throw new Error(`orchestrator failed (${orch.status}): ${orch.stderr}\n${orch.stdout}`);
}
process.stderr.write(orch.stderr || "");
const aggregatePath = path.join(TARGET_DIR, "routes", "generated", "iteration5-requalification.json");
const aggregate = JSON.parse(fs.readFileSync(aggregatePath, "utf8"));
aggregate.qualificationStatus = "COMPLETED";
aggregate.smoke = smokeDetail;
aggregate.authorityEnvironment = {
  os: "ubuntu-24.04",
  arch: "x64",
  node: process.version,
  v8: process.versions.v8,
  hostRamGb: 16,
  singleJobSerial: true,
};
writeJson("iteration5-final-qualification.json", aggregate);
console.log("QUALIFICATION_STATUS=COMPLETED (6 runs executed)");
