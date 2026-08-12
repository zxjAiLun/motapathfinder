"use strict";

const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runBlindQualification } = require("./lib/blind-qualification");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { makeSimulator, replayFixture } = require("./check-mt5-third-gate-resource-timing");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");
const MT2_FIXTURE = path.join(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json");

function findAction(simulator, state, summary) {
  return (simulator.enumeratePrimitiveActions(state).actions || []).find((action) => action.summary === summary)
    || simulator.enumerateActions(state).find((action) => action.summary === summary)
    || null;
}

function replayFixtureFile(simulator, fixtureFile) {
  let state = simulator.createInitialState({ rank: "chaos" });
  for (const decision of readRouteFile(fixtureFile).decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action) throw new Error(`fixture replay missing action ${decision.summary}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

function replaySummaries(simulator, state, summaries) {
  let next = state;
  for (const summary of summaries) {
    const action = findAction(simulator, next, summary);
    if (!action) throw new Error(`checkpoint replay missing action ${summary}`);
    next = simulator.applyAction(next, action);
  }
  return next;
}

function createMt5EntryState(project) {
  const simulator = makeSimulator(project);
  return replaySummaries(simulator, replayFixture(simulator), [
    "battle:greenKing@MT4:4,1",
    "battle:blueKnight@MT4:2,1",
    "changeFloor@MT4:6,0",
    "changeFloor@MT3:6,0",
    "battle:goldSlime@MT4:4,7",
    "battle:poisonSkeleton@MT4:6,6",
    "battle:poisonSkeleton@MT4:10,8",
    "battle:poisonSkeleton@MT4:2,8",
    "battle:poisonSkeleton@MT4:3,10",
    "battle:poisonBat@MT4:4,11",
    "changeFloor@MT4:6,12",
  ]);
}

function detachCheckpoint(state) {
  state.route = [];
  state.meta = {
    ...(state.meta || {}),
    decisionDepth: 0,
    rawRouteLength: 0,
    autoStepCount: 0,
    autoPickupCount: 0,
    autoBattleCount: 0,
  };
  return state;
}

function main() {
  const project = loadProject(PROJECT_ROOT);
  const blindGoal = readBlindGoal(path.join(__dirname, "blind-goals", "onlyup-mt5-blueking.json"));
  const knownSimulator = makeSimulator(project);
  const knownInitialState = knownSimulator.createInitialState({ rank: "chaos" });
  const knownFinalState = replayFixture(knownSimulator);
  const result = runBlindQualification({
    project,
    projectRoot: PROJECT_ROOT,
    towerId: blindGoal.project,
    terminalGoal: blindGoal.goal,
    knownInitialState,
    knownFinalState,
    d1StartState: detachCheckpoint(replayFixtureFile(makeBlindSimulator(project), MT2_FIXTURE)),
    d2StartState: detachCheckpoint(createMt5EntryState(project)),
    d3InitialState: makeBlindSimulator(project).createInitialState({ rank: blindGoal.rank }),
    d1MaxExpansions: Number(process.env.BLIND_D1_MAX_EXPANSIONS || 600),
    d2MaxExpansions: Number(process.env.BLIND_D2_MAX_EXPANSIONS || 1000),
    d3MaxExpansions: Number(process.env.BLIND_D3_MAX_EXPANSIONS || 1000),
    baselineD3: {
      found: false,
      maxExpansions: 1000,
      bestFloorId: "MT3",
      wallMs: 33046,
      source: "PR-5.10c terminal-only D3 baseline",
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
