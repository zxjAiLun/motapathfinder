"use strict";

/**
 * TEST GRADE: unit
 *
 * Selection and failure-mode checks for the manifest runner. This deliberately
 * uses a synthetic manifest so it never loads a tower project or generated route.
 */

const assert = require("node:assert");
const {
  selectTests,
  shouldContinueOnFailure,
} = require("./scripts/run-manifest-checks");

const BASE_MANIFEST = {
  tests: {
    "shared-solver/check-a.js": { cleanCheckout: true, grade: "unit" },
    "shared-solver/check-b.js": { cleanCheckout: true, grade: "diagnostic" },
    "shared-solver/check-local.js": { cleanCheckout: false, grade: "local-regression" },
  },
  suites: {
    static: {
      requiredChecks: ["shared-solver/check-a.js", "shared-solver/check-b.js"],
      requiredCommands: ["check:no-tower-solver-js"],
    },
  },
};

function checkSuiteSelection() {
  const selected = selectTests(BASE_MANIFEST, ["--suite=static", "--clean-only"]);
  assert.deepEqual(selected.map(([filePath]) => filePath), [
    "shared-solver/check-a.js",
    "shared-solver/check-b.js",
  ]);
}

function checkCleanLocalExclusion() {
  assert.deepEqual(
    selectTests(BASE_MANIFEST, ["--clean-only"]).map(([filePath]) => filePath),
    ["shared-solver/check-a.js", "shared-solver/check-b.js"],
  );
  assert.deepEqual(
    selectTests(BASE_MANIFEST, ["--local-only"]).map(([filePath]) => filePath),
    ["shared-solver/check-local.js"],
  );
  assert.throws(
    () => selectTests(BASE_MANIFEST, ["--clean-only", "--local-only"]),
    /mutually exclusive/,
  );
}

function checkContinueFlag() {
  assert.equal(shouldContinueOnFailure([]), false);
  assert.equal(shouldContinueOnFailure(["--continue-on-failure"]), true);
  assert.equal(shouldContinueOnFailure(["--continue-on-failure=0"]), false);
}

function checkSuiteContract() {
  const invalid = JSON.parse(JSON.stringify(BASE_MANIFEST));
  invalid.tests["shared-solver/check-b.js"].cleanCheckout = false;
  assert.throws(
    () => selectTests(invalid, ["--suite=static"]),
    /not clean-checkout safe/,
  );
  assert.throws(
    () => selectTests(BASE_MANIFEST, ["--suite=missing"]),
    /suite not found/,
  );
}

function main() {
  checkSuiteSelection();
  checkCleanLocalExclusion();
  checkContinueFlag();
  checkSuiteContract();
  console.log("check-manifest-runner: ok");
}

if (require.main === module) main();

module.exports = {
  main,
  checkSuiteSelection,
  checkCleanLocalExclusion,
  checkContinueFlag,
  checkSuiteContract,
};
