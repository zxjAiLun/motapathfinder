"use strict";

/**
 * TEST GRADE: diagnostic
 *
 * Teacher-forced divergence audit.
 * - Always runs on a tracked fixture route (clean-checkout safe).
 * - Optionally audits the local MT5 teacher route when present (ignored path).
 *
 * Green means: audit engine works and tracked teacher path is fully force-walkable.
 * It does NOT mean 51533→I894 search is closed.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { StaticSimulator } = require("./lib/simulator");
const {
  formatDivergenceReport,
  runTeacherDivergenceAudit,
} = require("./lib/teacher-divergence-audit");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const FIXTURE_ROUTE = path.join(__dirname, "routes", "fixtures", "mt1-mt3-i893-hp8425.route.json");
const MT5_TEACHER_ROUTE = path.join(
  __dirname,
  "routes",
  "generated",
  "mt5-51533-prefix59-to-i894.full.route.json",
);

function makeSyntheticState(hp, route) {
  return {
    floorId: "SYNTHETIC",
    hero: {
      hp,
      hpmax: 100,
      atk: 1,
      def: 1,
      mdef: 0,
      lv: 1,
      exp: 0,
      money: 0,
      mana: 0,
      loc: { x: 2, y: 1 },
      equipment: [],
      followers: [],
    },
    inventory: {},
    flags: {},
    visitedFloors: {},
    floorStates: {},
    route: Array.isArray(route) ? route : [],
  };
}

function makeSimulator(project, stopFloorId) {
  return new StaticSimulator(project, {
    stopFloorId: stopFloorId || "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function assertReportShape(report, label) {
  assert.ok(report && report.version, `${label}: missing version`);
  assert.ok(report.counts, `${label}: missing counts`);
  assert.ok(Array.isArray(report.steps), `${label}: steps must be an array`);
  assert.equal(typeof report.ok, "boolean", `${label}: ok must be boolean`);
  assert.ok(report.counts.stepsAudited > 0, `${label}: expected audited steps`);
}

function checkTrackedFixture(project) {
  assert.ok(fs.existsSync(FIXTURE_ROUTE), `tracked fixture missing: ${FIXTURE_ROUTE}`);
  const route = readRouteFile(FIXTURE_ROUTE);
  const simulator = makeSimulator(project, "MT4");
  const report = runTeacherDivergenceAudit(simulator, route, {
    siblingLimit: 8,
    forceKeepTeacher: true,
    enableResourceTiming: false,
    dpKeyOptions: { keyMode: "location" },
  });
  assertReportShape(report, "fixture");
  assert.equal(report.counts.teacherActionsMissing, 0, "tracked fixture teacher actions must all be generated");
  assert.equal(report.counts.successorInvalid, 0, "tracked fixture teacher successors must all apply");
  assert.equal(report.ok, true, "tracked fixture force-walk must not hard-fail");
  assert.ok(
    report.finalHero && report.finalHero.floorId,
    "fixture audit must end with a final hero floor",
  );
  // Structural: every step has classification fields even when clean.
  for (const step of report.steps) {
    assert.equal(typeof step.teacherActionGenerated, "boolean");
    assert.equal(typeof step.teacherSuccessorValid, "boolean");
    assert.ok(step.dpKey, "each valid step must expose a dpKey");
  }
  return report;
}

function checkOptionalMt5Teacher(project) {
  if (!fs.existsSync(MT5_TEACHER_ROUTE)) {
    return {
      skipped: true,
      reason: "mt5-teacher-route-missing",
      path: MT5_TEACHER_ROUTE,
    };
  }
  const route = readRouteFile(MT5_TEACHER_ROUTE);
  const simulator = makeSimulator(project, "MT6");
  // Focus around known resource-order window (prefix ~59–86) while still
  // validating the whole teacher path for action generation.
  const full = runTeacherDivergenceAudit(simulator, route, {
    siblingLimit: 6,
    forceKeepTeacher: true,
    enableResourceTiming: false,
    dpKeyOptions: { keyMode: "location" },
  });
  assertReportShape(full, "mt5-full");
  assert.equal(full.counts.teacherActionsMissing, 0, "MT5 teacher actions must be generated end-to-end");
  assert.equal(full.counts.successorInvalid, 0, "MT5 teacher successors must apply");
  assert.equal(full.ok, true, "MT5 teacher force-walk must not hard-fail");

  const windowReport = runTeacherDivergenceAudit(simulator, route, {
    fromStep: 59,
    toStep: Math.min(route.decisions.length, 86),
    siblingLimit: 10,
    forceKeepTeacher: true,
    enableResourceTiming: false,
    dpKeyOptions: { keyMode: "location" },
  });
  assertReportShape(windowReport, "mt5-window");

  return {
    skipped: false,
    decisionCount: route.decisions.length,
    full,
    window: windowReport,
  };
}

function checkSyntheticDominanceDivergence() {
  const initialState = {
    ...makeSyntheticState(50, []),
    hero: {
      ...makeSyntheticState(50, []).hero,
      loc: { x: 1, y: 1 },
    },
  };
  const simulator = {
    createInitialState: () => initialState,
    enumeratePrimitiveActions: (state) => ({
      actions: state.route.length > 0
        ? []
        : [
            { summary: "teacher:preserve-resource", kind: "pickup" },
            { summary: "sibling:consume-resource", kind: "pickup" },
          ],
    }),
    applyAction: (state, action) => makeSyntheticState(
      action.summary.startsWith("teacher:") ? 40 : 90,
      (state.route || []).concat(action.summary),
    ),
  };
  const report = runTeacherDivergenceAudit(
    simulator,
    { decisions: [{ summary: "teacher:preserve-resource", kind: "pickup" }] },
    { siblingLimit: 4, forceKeepTeacher: true, dpKeyOptions: { keyMode: "location" } },
  );
  assertReportShape(report, "synthetic");
  assert.equal(report.counts.siblingDominated, 1, "teacher must be dominated by stronger same-key sibling");
  assert.equal(report.counts.wouldBeRejected, 1, "audit must report would-be dominance rejection");
  assert.equal(report.counts.forcedRetentions, 1, "teacher must be retained in force mode");
  assert.equal(report.steps[0].prunedBy, "sibling:sibling:consume-resource");
  assert.equal(Object.prototype.hasOwnProperty.call(report.steps[0], "teacherAction"), false);
  return report;
}

function checkNoProductionTeacherImport() {
  const libDir = path.join(__dirname, "lib");
  const offenders = fs
    .readdirSync(libDir)
    .filter((name) => name.endsWith(".js") && name !== "teacher-divergence-audit.js")
    .filter((name) => {
      const source = fs.readFileSync(path.join(libDir, name), "utf8");
      return /(?:require|import)\s*\(?.*teacher-divergence-audit/.test(source);
    });
  assert.deepEqual(offenders, [], "production lib must not import teacher divergence audit");
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  checkNoProductionTeacherImport();
  const synthetic = checkSyntheticDominanceDivergence();
  const fixtureReport = checkTrackedFixture(project);
  const mt5 = checkOptionalMt5Teacher(project);

  console.log("check-teacher-divergence: fixture ok");
  console.log(
    `check-teacher-divergence: synthetic ok siblingDominated=${synthetic.counts.siblingDominated} ` +
    `forcedRetentions=${synthetic.counts.forcedRetentions}`,
  );
  console.log(formatDivergenceReport(fixtureReport, { maxSteps: 8 }));
  if (mt5.skipped) {
    console.log(`check-teacher-divergence: MT5 teacher skipped (${mt5.reason})`);
    console.log(`  expected local path: ${mt5.path}`);
  } else {
    console.log(
      `check-teacher-divergence: MT5 teacher ok decisions=${mt5.decisionCount} ` +
      `firstDivergence=${mt5.full.firstDivergenceStep == null ? "none" : mt5.full.firstDivergenceStep} ` +
      `wouldReject=${mt5.full.counts.wouldBeRejected} ` +
      `siblingDominated=${mt5.full.counts.siblingDominated}`,
    );
    if (mt5.full.firstDivergence) {
      console.log(formatDivergenceReport(mt5.full, { maxSteps: 12 }));
    }
    if (mt5.window.firstDivergence) {
      console.log("MT5 window [59..) first issue:");
      console.log(formatDivergenceReport(mt5.window, { maxSteps: 12 }));
    }
  }
  console.log("check-teacher-divergence: ok (grade=diagnostic)");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  checkTrackedFixture,
  checkOptionalMt5Teacher,
  checkSyntheticDominanceDivergence,
  checkNoProductionTeacherImport,
  FIXTURE_ROUTE,
  MT5_TEACHER_ROUTE,
};
