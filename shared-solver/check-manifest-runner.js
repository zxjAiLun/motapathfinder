"use strict";

/**
 * TEST GRADE: unit
 *
 * Selection and failure-mode checks for the manifest runner. This deliberately
 * uses a synthetic manifest so it never loads a tower project or generated route.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { listSolverLibFiles, groupSolverEntrypoints } = require("../tools/audit-js-files");
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

function checkNestedModuleCoverage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "solver-manifest-nested-"));
  try {
    const lib = path.join(root, "shared-solver/lib");
    fs.mkdirSync(path.join(lib, "planner/evidence"), { recursive: true });
    fs.mkdirSync(path.join(root, "tools"));
    fs.writeFileSync(path.join(lib, "root.js"), '"use strict";\n');
    fs.writeFileSync(path.join(lib, "planner/evidence/nested.js"), '"use strict";\n');
    fs.writeFileSync(path.join(lib, "planner/README.md"), "not a module\n");
    assert.deepEqual(listSolverLibFiles(lib), ["planner/evidence/nested.js", "root.js"]);
    assert.deepEqual(listSolverLibFiles(path.join(root, "absent")), []);

    // Exercise the real checker in an isolated miniature repo, not just its
    // scanner. A missing nested module must make the CLI fail closed.
    const audit = path.join(root, "tools/audit-js-files.js");
    fs.copyFileSync(path.resolve(__dirname, "../tools/audit-js-files.js"), audit);
    const manifestPath = path.join(root, "shared-solver/solver-manifest.json");
    const manifest = { modules: { "shared-solver/lib/root.js": {} }, tests: {} };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const missing = spawnSync(process.execPath, [audit, "--check-manifest"], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing lib modules/);
    assert.match(missing.stderr, /planner\/evidence\/nested\.js/);
    manifest.modules["shared-solver/lib/planner/evidence/nested.js"] = {};
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const complete = spawnSync(process.execPath, [audit, "--check-manifest"], { encoding: "utf8" });
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /2 modules/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function checkEntrypointRoles() {
  const manifest = { entrypointGroups: [{
    id: "canonical-dp", title: "Canonical DP",
    paths: ["shared-solver/run-region-dp.js", "shared-solver/check-mislabelled.js", "shared-solver/probe-mislabelled.js"],
  }] };
  const files = ["run-region-dp.js", "run-unknown.js", "check-mislabelled.js",
    "audit-example.js", "probe-example.js", "probe-mislabelled.js", ".tmp-scratch.js",
    "audits/probes/probe-nested.js"];
  const groups = groupSolverEntrypoints(files.map((name) => ({ path: `shared-solver/${name}` })), manifest);
  const byId = Object.fromEntries(groups.map((group) => [group.id, group.paths]));
  assert.deepEqual(byId["canonical-dp"], ["shared-solver/run-region-dp.js"]);
  assert.deepEqual(byId.checks, ["shared-solver/check-mislabelled.js"]);
  assert.deepEqual(byId.diagnostics, ["shared-solver/audit-example.js", "shared-solver/audits/probes/probe-nested.js", "shared-solver/probe-example.js", "shared-solver/probe-mislabelled.js"]);
  assert.deepEqual(byId.other, ["shared-solver/run-unknown.js"]);
  assert.throws(() => groupSolverEntrypoints([], {
    entrypointGroups: [manifest.entrypointGroups[0], manifest.entrypointGroups[0]],
  }), /Duplicate entrypoint assignment/);

  const actual = require("./solver-manifest.json");
  for (const group of actual.entrypointGroups) {
    for (const file of group.paths) assert.ok(fs.existsSync(path.resolve(__dirname, "..", file)), file);
  }
}

function checkTrackedHandoffBoundary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "solver-handoff-boundary-"));
  const files = path.join(root, "files.json");
  const checker = path.resolve(__dirname, "../tools/check-agent-boundaries.js");
  function check(file, publicLayer, expected) {
    fs.writeFileSync(files, JSON.stringify([file]));
    const args = [checker, `--changed-files=${files}`];
    if (publicLayer) args.push("--public-layer-dev");
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, expected, `${file}: ${result.stderr}`);
  }
  try {
    check("20260804handoff.md", true, 0);
    check("20260804handoff.md", false, 1);
    check("20260804handoff.md.bak", true, 1);
    check("arbitrary-root.js", true, 1);
    check("Only upV2.1/Only upV2.1/project/data.js", true, 1);
    check("Only upV2.1/Only upV2.1/solver/illegal.js", true, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  checkSuiteSelection();
  checkCleanLocalExclusion();
  checkContinueFlag();
  checkSuiteContract();
  checkNestedModuleCoverage();
  checkEntrypointRoles();
  checkTrackedHandoffBoundary();
  console.log("check-manifest-runner: ok");
}

if (require.main === module) main();

module.exports = {
  main,
  checkSuiteSelection,
  checkCleanLocalExclusion,
  checkContinueFlag,
  checkSuiteContract,
  checkNestedModuleCoverage,
  checkEntrypointRoles,
  checkTrackedHandoffBoundary,
};
