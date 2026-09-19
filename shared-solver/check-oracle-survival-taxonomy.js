"use strict";
/**
 * PR-5.26b - Oracle survival stage taxonomy micro.
 *
 * Locks the precedence of the MT4 oracle prefix survival classifier against the
 * misclassification found in owner review of PR-5.26a.
 *
 * THE BUG IT REPAIRS (recorded in docs/260913/5-26b.md):
 *   classifyStage() evaluated `dropped > duplicateSkipped > registered`. PR-5.25t
 *   had already established that duplicateSkipped is not a death event - it only
 *   means this exact state was reached again through another action variant, and
 *   what matters is the fate of the canonical registered node for that key. But
 *   the precedence still let a duplicateSkipped event outrank a LIVE registered
 *   twin. cp#9 reported exactly:
 *       generated = true, duplicateSkipped = true, registered = true,
 *       dropped = false, expanded = false
 *   i.e. a registered, retained, unexpanded node - and the classifier called it
 *   DUPLICATE_TO_EXISTING_STATE. That single mislabel turned "a retained node
 *   never got an expansion slot" into an apparent upstream generation gap and
 *   supported the (now withdrawn) claim that the MT4 limitation had become
 *   coverage.
 *
 * Correct precedence follows the registered node's own fate:
 *   expanded                   -> SURVIVED
 *   dropped                    -> DROPPED_BY_CAP
 *   registered                 -> REGISTERED_NEUTRAL_NOT_EXPANDED (skyline
 *                                 dominated) or
 *                                 KEPT_BUT_NOT_EXPANDED_BEFORE_BUDGET_END
 *   duplicateSkipped (no twin) -> DUPLICATE_WITHOUT_OBSERVED_REGISTERED_TWIN
 *   otherwise                  -> NEVER_GENERATED
 *
 * The taxonomy itself is pure. The appended migration contract also checks
 * historical audit paths and performs an independent replay-only helper load;
 * it never runs the historical fixed-work A/B searches.
 */

const fs = require("node:fs");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("path");
const { classifyStage } = require("./audits/flat-search/audit-pr525t-oracle-survival");

const failures = [];
const check = (label, got, want) => {
  if (got !== want) failures.push({ label, detail: `got ${got}, want ${want}` });
};
const E = (...types) => types.map((type) => ({ type }));

function main() {
  console.log("PR-5.26b oracle survival stage taxonomy");

  // The exact combination owner review flagged. This is the regression test:
  // pre-repair it returned DUPLICATE_TO_EXISTING_STATE.
  check(
    "cp9: duplicateSkipped + registered + !dropped + !expanded",
    classifyStage(E("strategicGenerated", "duplicateSkipped", "registered", "classified")),
    "KEPT_BUT_NOT_EXPANDED_BEFORE_BUDGET_END",
  );

  // A live registered twin must outrank the duplicate observation regardless of
  // whether the duplicate event was emitted before or after registration.
  check(
    "duplicate observed after registration",
    classifyStage(E("registered", "classified", "duplicateSkipped")),
    "KEPT_BUT_NOT_EXPANDED_BEFORE_BUDGET_END",
  );

  // The cap drop of the canonical node is still the loss stage when it happens.
  check("registered then dropped", classifyStage(E("registered", "classified", "dropped")), "DROPPED_BY_CAP");
  check("dropped outranks duplicate", classifyStage(E("duplicateSkipped", "registered", "dropped")), "DROPPED_BY_CAP");
  check("expanded outranks everything", classifyStage(E("registered", "classified", "expanded")), "SURVIVED");

  // The genuinely ambiguous case: dedup with no registered twin ever observed.
  check(
    "duplicate with no observed twin",
    classifyStage(E("strategicGenerated", "duplicateSkipped")),
    "DUPLICATE_WITHOUT_OBSERVED_REGISTERED_TWIN",
  );

  // Boundary cases.
  check("no events", classifyStage([]), "NEVER_GENERATED");
  check("undefined events", classifyStage(undefined), "NEVER_GENERATED");
  check("closure-only events", classifyStage(E("closureSeen")), "NEVER_GENERATED");
  check(
    "skyline-dominated registered twin",
    classifyStage([{ type: "registered" }, { type: "classified", skylineDominated: true }]),
    "REGISTERED_NEUTRAL_NOT_EXPANDED",
  );

  // Falsification guard: the two names the repair removed must never be
  // returned again, so a stale copy of the old precedence cannot hide here.
  const observed = [
    classifyStage(E("duplicateSkipped", "registered")),
    classifyStage(E("registered")),
    classifyStage(E("registered", "classified", "dropped")),
  ];
  for (const name of ["DUPLICATE_TO_EXISTING_STATE", "KEPT_BUT_NOT_EXPANDED_BEFORE_TIMEOUT", "REGISTERED_BUT_SKYLINE_DOMINATED"]) {
    if (observed.includes(name)) failures.push({ label: "retired stage name", detail: name });
  }

  console.log(`  classifier module: ${path.relative(process.cwd(), require.resolve("./audits/flat-search/audit-pr525t-oracle-survival"))}`);
  console.log("  locked precedence: SURVIVED > DROPPED_BY_CAP > registered > duplicateSkipped > NEVER_GENERATED");
  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures) console.log(`    ${f.label}: ${f.detail}`);
  } else {
    console.log("  PASS");
  }
  if (failures.length > 0) process.exitCode = 1;
}

function checkAuditMigrationContracts() {
  const directory = path.join(__dirname, "audits", "flat-search");
  const repoRoot = path.resolve(__dirname, "..");
  const files = fs.readdirSync(directory).filter((name) => /^audit-pr52[56].*\.js$/.test(name));
  assert.strictEqual(files.length, 16);
  let anchorsChecked = 0;
  let requiresChecked = 0;
  let microPath = null;
  for (const file of files) {
    const source = fs.readFileSync(path.join(directory, file), "utf8");
    const anchors = [...source.matchAll(/path\.(resolve|join)\(\s*__dirname,([^)]*)\)/g)];
    assert.strictEqual(anchors.length, (source.match(/\b__dirname\b/g) || []).length, `${file}: untested anchor`);
    for (const [, method, argumentsSource] of anchors) {
      assert.strictEqual(argumentsSource.replace(/"[^"]*"|[\s,]/g, ""), "", `${file}: nonliteral anchor`);
      const parts = [...argumentsSource.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
      const tail = parts.filter((part) => part !== "..");
      const repoRelative = tail.length === 0 || ["Only upV2.1", "docs"].includes(tail[0]);
      assert.ok(repoRelative || ["routes", "check-guided-retro-demotion.js"].includes(tail[0]), `${file}: unknown anchor`);
      const resolved = path[method](directory, ...parts);
      assert.strictEqual(resolved, path.join(repoRelative ? repoRoot : __dirname, ...tail), `${file}: path anchor`);
      if (tail[0] === "check-guided-retro-demotion.js") microPath = resolved;
      anchorsChecked += 1;
    }
    for (const [, target] of source.matchAll(/require\("(\.[^"]*)"\)/g)) {
      assert.ok(fs.existsSync(require.resolve(path.resolve(directory, target))), `${file}: ${target}`);
      requiresChecked += 1;
    }
  }
  assert.strictEqual(anchorsChecked, 37);
  assert.strictEqual(requiresChecked, 96);
  assert.ok(microPath, "g audit must retain its child correctness-check path");
  const micros = spawnSync(process.execPath, [microPath], { encoding: "utf8", timeout: 30000 });
  assert.ifError(micros.error);
  assert.strictEqual(micros.status, 0, micros.stderr || micros.stdout);

  const helper = path.join(directory, "audit-pr525t-oracle-survival.js");
  const loader = path.join(__dirname, "lib", "project-loader.js");
  const childCode = `const a = require(${JSON.stringify(helper)}); ` +
    `const p = require(${JSON.stringify(loader)}).loadProject(a.PROJECT_ROOT); ` +
    "const r = a.buildOracleCheckpoints(a.makeSimulator(p)); " +
    "console.log(JSON.stringify({ projectRoot: a.PROJECT_ROOT, fixture: a.ORACLE_FIXTURE, " +
    "steps: r.allSteps.length, checkpoints: r.strategicCheckpoints.length, floor: r.finalFloorId, hp: r.finalHeroHp }));";
  const replay = spawnSync(process.execPath, ["-e", childCode], { cwd: repoRoot, encoding: "utf8", timeout: 30000 });
  assert.ifError(replay.error);
  assert.strictEqual(replay.status, 0, replay.stderr);
  assert.deepStrictEqual(JSON.parse(replay.stdout), {
    projectRoot: path.join(repoRoot, "Only upV2.1", "Only upV2.1"),
    fixture: path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json"),
    steps: 55, checkpoints: 52, floor: "MT4", hp: 6428,
  });
  console.log(`  migration: ${anchorsChecked} anchors, ${requiresChecked} requires, child micros and replay-only helper PASS`);
}

main();
checkAuditMigrationContracts();
