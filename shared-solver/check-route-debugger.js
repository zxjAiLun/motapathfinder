"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { buildRouteTimeline, exportRouteState } = require("./lib/route-debugger");
const { StaticSimulator } = require("./lib/simulator");
const { loadStartState } = require("./lib/start-state-loader");
const { renderHtml } = require("./render-route-debugger");
const { attachRepairReport } = require("./debug-route-timeline");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_FILE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json");

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: null,
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

function checkTimeline() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const routeRecord = readRouteFile(ROUTE_FILE);
  const timeline = buildRouteTimeline(project, simulator, routeRecord, {
    routeFile: ROUTE_FILE,
  });
  assert.equal(timeline.schema, "motapathfinder.routeTimeline.v1");
  assert.equal(timeline.stats.decisionCount, routeRecord.decisions.length);
  assert.equal(timeline.stats.stepCount, routeRecord.decisions.length + 1);
  assert.equal(timeline.stats.endedWithError, false);
  assert.equal(timeline.steps[0].summary, "start");
  assert.ok(timeline.steps[1].delta.hero.length > 0, "first step should have hero diff rows");
  assert.ok(timeline.steps.some((step) => step.target), "timeline should expose action targets");
  assert.ok(timeline.steps[0].battleOverlay, "timeline should include battle overlay data");
  assert.ok(timeline.steps[0].battleOverlay.enemyCount > 0, "battle overlay should list current-floor enemies");
  const firstBattleOverlay = Object.values(timeline.steps[0].battleOverlay.enemies)[0];
  assert.ok(firstBattleOverlay.display, "battle overlay should include display damage text");
  assert.ok(timeline.steps[0].actionInspector, "timeline should include action inspector data");
  assert.ok(timeline.steps[0].actionInspector.totalActions > 0, "action inspector should enumerate candidates");
  assert.ok(
    timeline.steps[0].actionInspector.candidates.some((candidate) => candidate.plannedNext),
    "action inspector should mark the next route action",
  );
  assert.equal(timeline.map.tiles.redGem.name, "初始红宝石");
  assert.ok(timeline.map.tiles.blackSlime.sprite, "timeline should expose tile sprite metadata");
  assert.equal(timeline.map.tiles.autotile59.wallLike, true);
  assert.equal(timeline.map.tiles.autotile59.sprite, null);
  return { steps: timeline.stats.stepCount, lastFloor: timeline.steps[timeline.steps.length - 1].floorId };
}

function checkRenderAndExport() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const routeRecord = readRouteFile(ROUTE_FILE);
  const timeline = buildRouteTimeline(project, simulator, routeRecord, {
    routeFile: ROUTE_FILE,
  });
  const html = renderHtml(timeline, { assetBase: "../../../Only upV2.1/Only upV2.1/project" });
  assert.ok(html.includes("Route Debugger"));
  assert.ok(html.includes("timeline-json"));
  assert.ok(html.includes("初始红宝石"));
  assert.ok(html.includes("materials/enemys.png"));
  assert.ok(html.includes("damageBadge"));
  assert.ok(html.includes("candidateTable"));
  assert.ok(html.includes("候选动作"));
  assert.ok(!html.includes("autotiles/autotile59.png"));
  assert.ok(html.includes("主角属性"));
  assert.ok(html.includes("当前 Action"));
  const jsonMatch = html.match(/<script id="timeline-json" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(jsonMatch, "rendered HTML should embed timeline JSON");
  assert.equal(JSON.parse(jsonMatch[1]).stats.stepCount, timeline.stats.stepCount);
  const scriptMatch = html.match(/<script>\n([\s\S]*?)\n  <\/script>/);
  assert.ok(scriptMatch, "rendered HTML should contain app script");
  new Function(scriptMatch[1]);

  const exported = exportRouteState(project, simulator, routeRecord, 12);
  assert.equal(exported.schema, "motapathfinder.exportedState.v1");
  assert.equal(exported.step, 12);
  assert.equal(exported.state.floorId, "MT2");
  assert.ok(exported.stateKey);
  assert.ok(exported.snapshot.hero.hp > 0);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "route-debugger-"));
  const outFile = path.join(tmpDir, "state.json");
  fs.writeFileSync(outFile, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
  assert.ok(fs.existsSync(outFile));
  const loaded = loadStartState(project, outFile, { rank: "chaos" });
  assert.equal(loaded.state.floorId, exported.state.floorId);
  assert.equal(loaded.state.hero.hp, exported.state.hero.hp);
  return { exportedStep: exported.step, floorId: exported.state.floorId, hp: exported.state.hero.hp };
}

function checkRepairAnnotations() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const routeRecord = readRouteFile(ROUTE_FILE);
  const timeline = buildRouteTimeline(project, simulator, routeRecord, { routeFile: ROUTE_FILE });
  attachRepairReport(timeline, {
    acceptedCount: 1,
    baselineFinalHp: 100,
    candidateFinalHp: 125,
    finalRouteVerified: true,
    stoppedReason: "no-findings",
    iterations: [{
      iterationIndex: 0,
      baselineFinalHp: 100,
      candidateAttempts: [{
        sourceStepIndex: 3,
        originalSummary: "battle:old@MT1:1,1",
        patch: { cheaperSummary: "battle:new@MT1:2,1", actions: [{ summary: "battle:new@MT1:2,1" }] },
        accepted: true,
        candidateFinalHp: 125,
        outputStartStep: 3,
        outputActionCount: 1,
      }, {
        sourceStepIndex: 4,
        originalSummary: "battle:rejected@MT1:3,1",
        patch: { cheaperSummary: "battle:worse@MT1:4,1", actions: [{ summary: "battle:worse@MT1:4,1" }] },
        accepted: false,
        rejectedReason: "final-hp-not-improved",
        candidateFinalHp: 90,
      }],
    }],
  });
  assert.equal(timeline.repair.summary.acceptedCount, 1);
  assert.equal(timeline.steps[3].repairAnnotations[0].accepted, true);
  assert.equal(timeline.steps[4].repairAnnotations[0].rejectedReason, "final-hp-not-improved");
  const html = renderHtml(timeline, { assetBase: "../../../Only upV2.1/Only upV2.1/project" });
  assert.ok(html.includes("repairHeader"));
  assert.ok(html.includes("repairAccepted"));
  assert.ok(html.includes("Route Repair"));
  assert.ok(html.includes("final-hp-not-improved"));
  return { accepted: 1, rejected: 1 };
}

function main() {
  const timeline = checkTimeline();
  const renderAndExport = checkRenderAndExport();
  const repairAnnotations = checkRepairAnnotations();
  console.log(JSON.stringify({ timeline, renderAndExport, repairAnnotations }, null, 2));
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
};
