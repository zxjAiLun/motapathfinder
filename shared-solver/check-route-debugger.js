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
        firstReplayFailure: { reason: "action-unavailable", stepIndex: 6, summary: "battle:bridge@MT1:5,1" },
        suffixBridges: [{
          failureStepIndex: 6,
          expectedSummary: "battle:bridge@MT1:5,1",
          status: "found",
          actions: [{ summary: "pickup:redGem@MT1:4,1" }],
          consumedFutureSteps: [8],
          selectedCandidateId: "bridge#1",
          candidates: [{
            id: "bridge#0",
            status: "short-blocked",
            shortProgress: 3,
            shortHp: 80,
            shortlisted: false,
            selected: false,
            eliminatedReason: "not-shortlisted",
          }, {
            id: "bridge#1",
            status: "shortlisted",
            shortProgress: 8,
            shortHp: 120,
            shortlisted: true,
            selected: true,
            fullReplayStatus: "completed",
            finalHp: 125,
          }],
        }],
        skippedSatisfiedSteps: [{ stepIndex: 8, reason: "consumed-by-bridge" }],
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
  assert.equal(timeline.steps[3].repairAnnotations[0].suffixBridges.length, 1);
  assert.equal(timeline.steps[4].repairAnnotations[0].rejectedReason, "final-hp-not-improved");
  const html = renderHtml(timeline, { assetBase: "../../../Only upV2.1/Only upV2.1/project" });
  assert.ok(html.includes("repairHeader"));
  assert.ok(html.includes("repairAccepted"));
  assert.ok(html.includes("Route Repair"));
  assert.ok(html.includes("bridge actions"));
  assert.ok(html.includes("bridge candidates"));
  assert.ok(html.includes("not-shortlisted"));
  assert.ok(html.includes("final-hp-not-improved"));
  return { accepted: 1, rejected: 1 };
}

function checkWindowRepairAnnotations() {
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const routeRecord = readRouteFile(ROUTE_FILE);
  const timeline = buildRouteTimeline(project, simulator, routeRecord, { routeFile: ROUTE_FILE });
  attachRepairReport(timeline, {
    kind: "window-repair",
    mode: "window",
    profile: "test-profile",
    windowStart: 3,
    windowEnd: 6,
    ok: false,
    baselineHp: 100,
    finalHp: null,
    stoppedReason: "no-accepted-candidate",
    farthestStage: 2,
    stageResults: [
      {
        stageIndex: 0,
        segmentId: "stage-1",
        found: true,
        rawCandidateCount: 2,
        candidateCount: 2,
        skylineCount: 2,
        expansions: 50,
        frontierSize: 10,
        stoppedReason: "time-limit",
        candidates: [
          { id: "stage-1-candidate-1", hero: { hp: 90, atk: 10 }, effectiveHero: { atk: 15 }, routeLength: 5, tags: ["highest-hp"] },
          { id: "stage-1-candidate-2", hero: { hp: 85, atk: 12 }, effectiveHero: { atk: 18 }, routeLength: 4, tags: ["shortest"] },
        ],
      },
      {
        stageIndex: 1,
        segmentId: "stage-2",
        found: true,
        rawCandidateCount: 4,
        candidateCount: 2,
        skylineCount: 4,
        expansions: 100,
        frontierSize: 5,
        stoppedReason: "time-limit",
        candidates: [
          { id: "stage-2-candidate-1", hero: { hp: 80, atk: 20 }, effectiveHero: { atk: 25 }, routeLength: 7, tags: ["highest-hp"] },
        ],
      },
    ],
    validations: [
      {
        candidateId: "stage-3-candidate-1",
        hero: { hp: 70 },
        effectiveHero: { atk: 30 },
        tags: ["highest-hp", "baseline-local-probe"],
        windowActionCount: 3,
        actionTrace: ["battle:enemyA@MT1:1,1", "battle:enemyB@MT1:2,1", "changeFloor@MT1:3,1"],
        fullReplayOk: true,
        replayFailure: null,
        goalFailures: [],
        finalHp: 130,
        baselineHp: 100,
        hpImproved: true,
        accepted: true,
        rejectedReason: null,
        localProbe: true,
        baselineLocalProbe: true,
        sourceCandidateId: "baseline",
        probeType: "baseline-swap-chain",
        probe: { swaps: [[7, 8], [5, 7], [6, 7]] },
        baselineMatchCount: 2,
        baselineMobilityMatchCount: 1,
      },
      {
        candidateId: "stage-3-candidate-2",
        hero: { hp: 55 },
        effectiveHero: { atk: 28 },
        tags: [],
        windowActionCount: 2,
        actionTrace: ["battle:enemyA@MT1:1,1", "battle:enemyC@MT1:4,1"],
        fullReplayOk: false,
        replayFailure: { reason: "action-unavailable", summary: "battle:missing@MT1:5,1" },
        goalFailures: [{ field: "hero.atk", expected: 30, actual: 28 }],
        finalHp: null,
        baselineHp: 100,
        hpImproved: false,
        accepted: false,
        rejectedReason: "full-replay-failed",
        baselineMatchCount: 1,
        baselineMobilityMatchCount: 0,
      },
    ],
    accepted: null,
    rebuildError: null,
    strictReplayOk: false,
    strictFinalHp: null,
    debugTrace: [
      { marker: "window-start", floorId: "MT1", heroHp: 100, prefixRouteLength: 5, windowStart: 3, windowEnd: 6 },
      { marker: "stage-complete", stageIndex: 0, candidateCount: 2, bestCandidateHp: 90 },
      { marker: "validation-complete", candidateCount: 2, acceptedCount: 0, bestValidationHp: 70 },
    ],
    windowRepair: {
      finalGoal: { floorId: "MT2", minHero: { atk: 30 } },
      bestCandidateHp: 70,
      acceptedId: null,
    },
  });
  // Assert summary structure
  assert.equal(timeline.repair.summary.kind, "window-repair");
  assert.equal(timeline.repair.summary.windowStart, 3);
  assert.equal(timeline.repair.summary.windowEnd, 6);
  assert.equal(timeline.repair.summary.baselineHp, 100);
  assert.equal(timeline.repair.summary.stoppedReason, "no-accepted-candidate");
  assert.equal(timeline.repair.summary.bestCandidateHp, 70);
  // Assert window stages
  assert.ok(Array.isArray(timeline.repair.windowStages));
  assert.equal(timeline.repair.windowStages.length, 2);
  assert.equal(timeline.repair.windowStages[0].stageIndex, 0);
  assert.equal(timeline.repair.windowStages[0].candidateCount, 2);
  assert.equal(timeline.repair.windowStages[0].candidates[0].id, "stage-1-candidate-1");
  // Assert window validations
  assert.ok(Array.isArray(timeline.repair.windowValidations));
  assert.equal(timeline.repair.windowValidations.length, 2);
  assert.equal(timeline.repair.windowValidations[0].candidateId, "stage-3-candidate-1");
  assert.equal(timeline.repair.windowValidations[0].fullReplayOk, true);
  assert.equal(timeline.repair.windowValidations[0].accepted, true);
  assert.equal(timeline.repair.windowValidations[0].probeType, "baseline-swap-chain");
  assert.deepEqual(timeline.repair.windowValidations[0].probe.swaps, [[7, 8], [5, 7], [6, 7]]);
  assert.equal(timeline.repair.windowValidations[1].replayFailure.reason, "action-unavailable");
  assert.equal(timeline.repair.windowValidations[1].goalFailures[0].field, "hero.atk");
  // Assert debug trace
  assert.ok(Array.isArray(timeline.repair.debugTrace));
  assert.equal(timeline.repair.debugTrace.length, 3);
  assert.equal(timeline.repair.debugTrace[0].marker, "window-start");
  assert.equal(timeline.repair.debugTrace[2].marker, "validation-complete");
  // Assert step annotations in window range (0-based startIndex=2)
  const step2 = timeline.steps[2];
  assert.ok(step2 && Array.isArray(step2.repairAnnotations), "step at window start should have repair annotations");
  const windowAnnotations = step2.repairAnnotations.filter((a) => a.kind === "window-repair");
  assert.equal(windowAnnotations.length, 2, "two candidates should annotate the window start step");
  assert.equal(windowAnnotations[0].candidateId, "stage-3-candidate-1");
  assert.equal(windowAnnotations[0].actionSummary, "battle:enemyA@MT1:1,1");
  assert.equal(windowAnnotations[0].probeType, "baseline-swap-chain");
  assert.deepEqual(windowAnnotations[0].probe.swaps, [[7, 8], [5, 7], [6, 7]]);
  assert.equal(windowAnnotations[0].baselineHp, 100);
  assert.equal(windowAnnotations[0].baselineMatchCount, 2);
  assert.equal(windowAnnotations[0].baselineMobilityMatchCount, 1);
  assert.equal(windowAnnotations[1].goalFailures[0].field, "hero.atk");
  const html = renderHtml(timeline, { assetBase: "../../../Only upV2.1/Only upV2.1/project" });
  assert.ok(html.includes("window candidate"), "HTML renderer should include window repair fields");
  assert.ok(html.includes("baseline-swap-chain"), "HTML renderer should include local probe type");
  assert.ok(html.includes('"swaps":[[7,8],[5,7],[6,7]]'), "HTML should embed swap chain data");
  assert.ok(html.includes("baseline match"), "HTML renderer should include baseline-match field");
  assert.ok(html.includes("stage-3-candidate-1"), "HTML should embed/render window candidate id");
  assert.ok(html.includes("battle:enemyA@MT1:1,1"), "HTML should embed/render window action summary");
  return { stages: timeline.repair.windowStages.length, validations: timeline.repair.windowValidations.length };
}

function main() {
  const timeline = checkTimeline();
  const renderAndExport = checkRenderAndExport();
  const repairAnnotations = checkRepairAnnotations();
  const windowRepair = checkWindowRepairAnnotations();
  console.log(JSON.stringify({ timeline, renderAndExport, repairAnnotations, windowRepair }, null, 2));
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
