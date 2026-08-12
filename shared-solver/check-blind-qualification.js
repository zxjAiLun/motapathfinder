"use strict";

/** TEST GRADE: unit-plus-micro */

const assert = require("node:assert");
const path = require("node:path");

const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { runBlindQualification, SCHEMA } = require("./lib/blind-qualification");
const { loadProject } = require("./lib/project-loader");
const { makeSimulator, replayFixture } = require("./check-mt5-third-gate-resource-timing");

function main() {
  const projectRoot = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
  const project = loadProject(projectRoot);
  const goal = readBlindGoal(path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json"));
  const knownSimulator = makeSimulator(project);
  const knownInitialState = knownSimulator.createInitialState({ rank: "chaos" });
  const knownFinalState = replayFixture(knownSimulator);
  const localState = makeBlindSimulator(project).createInitialState({ rank: goal.rank });
  const result = runBlindQualification({
    project,
    projectRoot,
    terminalGoal: goal.goal,
    knownInitialState,
    knownFinalState,
    d1StartState: localState,
    d2StartState: localState,
    d3InitialState: makeBlindSimulator(project).createInitialState({ rank: goal.rank }),
    d1MaxExpansions: 1,
    d2MaxExpansions: 1,
    d3MaxExpansions: 1,
    baselineD3: {
      found: false,
      maxExpansions: 1,
      bestFloorId: "MT1",
      wallMs: 100,
    },
  });
  assert.strictEqual(result.schema, SCHEMA);
  assert.deepStrictEqual(result.levels.map((level) => level.grade), ["D0", "D1", "D2", "D3"]);
  assert.strictEqual(result.levels[0].passed, true);
  assert.strictEqual(result.levels[0].strictReplay.stepsCompleted, 55);
  assert.strictEqual(result.levels[1].passed, false);
  assert.strictEqual(result.levels[2].passed, false);
  assert.strictEqual(result.levels[3].passed, false);
  assert.strictEqual(result.autonomousDiscoveryVerified, false);
  assert.strictEqual(result.comparison.sameExpansionBudget, true);
  assert.strictEqual(result.comparison.correctnessOutcomeImproved, false);
  assert.strictEqual(result.comparison.timingIsDirectional, true);
  assert.strictEqual(
    result.verdict,
    "EXECUTION_AND_LOCAL_DISCOVERY_VERIFIED_AUTONOMOUS_DISCOVERY_OPEN",
  );
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    levels: result.levels.map((level) => ({ grade: level.grade, passed: level.passed })),
    verdict: result.verdict,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
