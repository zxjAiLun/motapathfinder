"use strict";

/**
 * Run check scripts selected by solver-manifest test metadata.
 *
 * This keeps clean-checkout and local/generated-route checks explicit. It does
 * not infer whether a check found a route; each check remains responsible for
 * its own grade semantics.
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const solverRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(solverRoot, "solver-manifest.json");

function hasFlag(args, name) {
  return args.includes(name);
}

function shouldContinueOnFailure(args) {
  return hasFlag(args, "--continue-on-failure");
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`solver manifest not found: ${manifestPath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function selectTests(manifest, args) {
  const suiteArg = args.find((arg) => arg.startsWith("--suite="));
  const suiteName = suiteArg ? suiteArg.slice("--suite=".length) : null;
  const suite = suiteName ? (manifest.suites || {})[suiteName] : null;
  if (suiteName && !suite) throw new Error(`manifest suite not found: ${suiteName}`);
  const entries = Object.entries(manifest.tests || {})
    .filter(([filePath]) => filePath.startsWith("shared-solver/check-"))
    .sort(([left], [right]) => left.localeCompare(right));
  const cleanOnly = hasFlag(args, "--clean-only");
  const localOnly = hasFlag(args, "--local-only");
  if (cleanOnly && localOnly) throw new Error("--clean-only and --local-only are mutually exclusive");
  const gradeArg = args.find((arg) => arg.startsWith("--grade="));
  const grade = gradeArg ? gradeArg.slice("--grade=".length) : null;
  if (suite) {
    const requiredChecks = Array.isArray(suite.requiredChecks) ? suite.requiredChecks : [];
    const requiredCommands = Array.isArray(suite.requiredCommands) ? suite.requiredCommands : [];
    if (requiredChecks.length === 0) throw new Error(`manifest suite has no requiredChecks: ${suiteName}`);
    if (requiredCommands.length === 0) throw new Error(`manifest suite has no requiredCommands: ${suiteName}`);
    if (localOnly) throw new Error(`manifest suite cannot be combined with --local-only: ${suiteName}`);
    const byPath = new Map(entries);
    for (const requiredPath of requiredChecks) {
      const entry = byPath.get(requiredPath);
      if (!entry) throw new Error(`manifest suite check missing: ${requiredPath}`);
      if (entry.cleanCheckout !== true) {
        throw new Error(`manifest suite check is not clean-checkout safe: ${requiredPath}`);
      }
    }
    return requiredChecks.map((requiredPath) => [requiredPath, byPath.get(requiredPath)]);
  }
  return entries.filter(([, entry]) => {
    if (cleanOnly && entry.cleanCheckout !== true) return false;
    if (localOnly && entry.cleanCheckout === true) return false;
    if (grade && entry.grade !== grade) return false;
    return true;
  });
}

function checkPathFromManifest(filePath) {
  const absolute = path.resolve(path.join(solverRoot, "..", filePath));
  const relative = path.relative(solverRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`manifest check path escapes solver root: ${filePath}`);
  }
  if (!fs.existsSync(absolute)) throw new Error(`manifest check file missing: ${filePath}`);
  return absolute;
}

function main(argv) {
  const args = argv || [];
  const manifest = readManifest();
  if (hasFlag(args, "--list")) {
    for (const [filePath, entry] of selectTests(manifest, args)) {
      console.log(`${filePath} grade=${entry.grade} cleanCheckout=${entry.cleanCheckout}`);
    }
    return 0;
  }

  const selected = selectTests(manifest, args);
  if (selected.length === 0) throw new Error("manifest test selection is empty");
  const continueOnFailure = shouldContinueOnFailure(args);
  const failures = [];
  console.log(`manifest-checks: selected=${selected.length}`);
  for (const [filePath, entry] of selected) {
    const scriptPath = checkPathFromManifest(filePath);
    console.log(`\n>>> ${filePath} grade=${entry.grade} cleanCheckout=${entry.cleanCheckout}`);
    const result = childProcess.spawnSync(process.execPath, [scriptPath], {
      cwd: solverRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      failures.push({ filePath, grade: entry.grade, status: result.status, error: result.error && result.error.message });
      console.error(`manifest-checks: failed ${filePath}`);
      if (!continueOnFailure) break;
    }
  }
  if (failures.length > 0) {
    console.error(`manifest-checks: failed=${failures.length}`);
    failures.forEach((failure) => console.error(`  - ${failure.filePath} (${failure.grade})`));
    return 1;
  }
  console.log(`manifest-checks: passed=${selected.length}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main, selectTests, shouldContinueOnFailure };
