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
 * Pure, no search and no simulator: the classifier is a total function of one
 * checkpoint's recorded lifecycle event list.
 */

const path = require("path");
const { classifyStage } = require("./audit-pr525t-oracle-survival");

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

  console.log(`  classifier module: ${path.relative(process.cwd(), require.resolve("./audit-pr525t-oracle-survival"))}`);
  console.log("  locked precedence: SURVIVED > DROPPED_BY_CAP > registered > duplicateSkipped > NEVER_GENERATED");
  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures) console.log(`    ${f.label}: ${f.detail}`);
  } else {
    console.log("  PASS");
  }
  if (failures.length > 0) process.exitCode = 1;
}

main();
