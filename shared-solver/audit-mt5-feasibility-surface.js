"use strict";

/**
 * PR-5.6b Eval A1 — coverage audit for the MT5 near-term feasibility surface.
 *
 * Emits, per near-term milestone, whether admissible-v1 can express its
 * declared goal at all, which fields have safe evidence, and where every
 * number came from.  Nothing here writes milestone JSON or touches pruning;
 * it exists so the bounds that DO get written are the ones backed by evidence.
 *
 * Usage:
 *   node audit-mt5-feasibility-surface.js
 *   node audit-mt5-feasibility-surface.js --json
 *   node audit-mt5-feasibility-surface.js --segments mt5-first-sweep,mt5-third-gate
 */

const path = require("node:path");
const { loadProject } = require("./lib/project-loader");
const { buildSegmentAdmissibleBounds } = require("./lib/mt5-feasibility-surface");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_DIR = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const MILESTONE_FILE = path.join(__dirname, "milestones", "onlyup-chaos-mt5-blueking.json");

// The near-term chain the third-gate investigation and Route-Q actually search.
// Deliberately not all 31 milestones: bounds are correctness evidence, and only
// the segments under active search earn the cost of proving them.
const NEAR_TERM_SEGMENTS = [
  "mt5-first-sweep",
  "mt5-third-gate",
  "mt5-sustain-balance",
];

// Hero level at the MT4/MT5 handoff, measured from the tracked MT3 fixture.
// Level-ups remain available from here, which is what makes a constant atk/def
// bound unsound; see summarizeLevelUpRisk.
const HERO_LV_AT_HANDOFF = 4;

function parseArgs(argv) {
  const options = { json: false, segments: NEAR_TERM_SEGMENTS.slice() };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--segments") {
      options.segments = String(argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--all") options.segments = null;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  const project = loadProject(PROJECT_DIR);
  const milestoneFile = require(MILESTONE_FILE);
  const allSegments = milestoneFile.milestones || [];
  const selected = options.segments
    ? allSegments.filter((m) => options.segments.includes(m.id))
    : allSegments;

  const missing = (options.segments || []).filter(
    (id) => !allSegments.some((m) => m.id === id),
  );

  const reports = selected.map((segment) =>
    buildSegmentAdmissibleBounds(project, segment, { heroLv: HERO_LV_AT_HANDOFF }));

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      milestoneFile: path.basename(MILESTONE_FILE),
      totalMilestones: allSegments.length,
      audited: reports.length,
      missingRequestedSegments: missing,
      heroLvAtHandoff: HERO_LV_AT_HANDOFF,
      reports,
    }, null, 2)}\n`);
    return;
  }

  console.log("=== MT5 near-term admissible coverage audit ===");
  console.log(`milestone file    : ${path.basename(MILESTONE_FILE)}`);
  console.log(`milestones total  : ${allSegments.length} (audited ${reports.length}, by design not all)`);
  console.log(`hero lv at handoff: ${HERO_LV_AT_HANDOFF}`);
  if (missing.length) console.log(`MISSING segments  : ${missing.join(", ")}`);
  console.log();

  for (const report of reports) {
    console.log(`--- ${report.segmentId} ---`);
    if (!report.supported) {
      console.log(`  admissible-v1 support : NO (${report.reason})`);
      console.log(`  unsupported clauses   : ${report.unsupportedClauses.join(", ")}`);
      console.log("  verdict               : stays unknown-evidence (correct behaviour)");
      console.log();
      continue;
    }
    const { coverage, provenance, admissibleBounds } = report;
    console.log(`  floors in scope       : ${provenance.floors.join(", ") || "(none)"}`);
    console.log(`  floor graph complete  : ${coverage.floorGraphComplete}`);
    if (provenance.floorGraph.unresolvedGateways.length) {
      console.log(`    unresolved gateways : ${provenance.floorGraph.unresolvedGateways.join(", ")}`);
    } else {
      console.log(`    edges               : ${provenance.floorGraph.edges.map((e) => `${e.from}->${e.to}`).join(" ") || "(none)"}`);
    }
    console.log(`  gain pool (measured)  : ${JSON.stringify(provenance.gainPool)}`);
    console.log(`    from                : ${provenance.itemSourceCount} item tiles, ${provenance.enemySourceCount} enemy tiles`);
    if (provenance.nonConstantItems.length) {
      console.log(`    non-constant items  : ${provenance.nonConstantItems.length} excluded (proportional effects)`);
      for (const item of provenance.nonConstantItems.slice(0, 5)) {
        console.log(`      ${item.id} @ ${item.at} low=${JSON.stringify(item.lowDelta)} high=${JSON.stringify(item.highDelta)}`);
      }
    }
    if (provenance.measurementErrors.length) {
      console.log(`    measurement errors  : ${provenance.measurementErrors.length}`);
      for (const err of provenance.measurementErrors.slice(0, 5)) {
        console.log(`      ${err.id} @ ${err.at}: ${err.message}`);
      }
    }
    console.log(`  level-up still active : ${provenance.levelUp.applicable} (lv ${provenance.levelUp.heroLv}/${provenance.levelUp.entriesTotal})`);
    console.log(`    remaining atk/def   : +${provenance.levelUp.remainingGrants.atk} / +${provenance.levelUp.remainingGrants.def}`);
    console.log(`    exp multiplier      : up to x${provenance.levelUp.maxExpMultiplier} via I608 grants at lv ${provenance.levelUp.expMultiplierGrants.map((g) => g.atLevel).join(",")}`);
    if (provenance.omittedForLevelUp.length) {
      console.log(`    omitted for level-up: ${provenance.omittedForLevelUp.join(", ")} (no sound constant exists)`);
    }
    console.log(`  declared goal fields  : ${coverage.declaredFields.join(", ")}`);
    console.log(`  covered by evidence   : ${coverage.coveredFields.join(", ") || "(none)"}`);
    console.log(`  uncovered             : ${coverage.uncoveredFields.join(", ") || "(none)"}`);
    console.log(`  evidence-complete     : ${coverage.evidenceCompleteForDeclaredGoal}`);
    console.log(`  optimisticHeroGain    : ${JSON.stringify(admissibleBounds.optimisticHeroGain)}`);
    console.log();
  }

  const supported = reports.filter((r) => r.supported);
  const complete = supported.filter((r) => r.coverage.evidenceCompleteForDeclaredGoal);
  console.log("=== summary ===");
  console.log(`admissible-v1 expressible : ${supported.length}/${reports.length}`);
  console.log(`evidence-complete         : ${complete.length}/${reports.length}`);
  console.log(`  ${complete.map((r) => r.segmentId).join(", ") || "(none)"}`);
}

if (require.main === module) main();

module.exports = { NEAR_TERM_SEGMENTS, HERO_LV_AT_HANDOFF, MILESTONE_FILE, PROJECT_DIR };
