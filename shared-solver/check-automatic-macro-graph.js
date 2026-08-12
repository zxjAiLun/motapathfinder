"use strict";

/** TEST GRADE: unit-plus-micro */

const assert = require("node:assert");
const path = require("node:path");

const { buildAutomaticMacroGraph, shortestFloorPath } = require("./lib/automatic-macro-graph");
const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const GOAL_FILE = path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function main() {
  const blindGoal = readBlindGoal(GOAL_FILE);
  const project = loadProject(PROJECT_ROOT);
  const initialState = makeBlindSimulator(project).createInitialState();
  const corridor = shortestFloorPath(project, initialState.floorId, blindGoal.goal.floorId);
  assert.deepStrictEqual(corridor.floorIds, ["MT1", "MT2", "MT3", "MT4", "MT5"]);
  const graph = buildAutomaticMacroGraph(project, initialState, blindGoal.goal, { towerId: "onlyup" });
  const repeat = buildAutomaticMacroGraph(project, initialState, blindGoal.goal, { towerId: "onlyup" });
  assert.strictEqual(graph.graphFingerprint, repeat.graphFingerprint);
  assert.strictEqual(graph.inputContract.knownRouteUsed, false);
  assert.strictEqual(graph.inputContract.milestoneUsed, false);
  assert.strictEqual(graph.floorCorridor.selection, "shortest-static-changeFloor-path");
  assert.deepStrictEqual(graph.floorCorridor.floorIds, corridor.floorIds);
  assert.ok(graph.nodes.some((node) => node.role === "terminal-boss" && node.tileId === "blueKing"));
  assert.ok(graph.nodes.some((node) => node.kind === "door" && Object.keys(node.requirements || {}).length > 0));
  assert.ok(graph.nodes.some((node) => node.role === "equipment"));
  assert.ok(graph.edges.some((edge) => edge.kind === "floor-transition" && edge.targetFloorId === "MT5"));
  assert.ok(graph.edges.some((edge) => edge.kind === "initial-location"));
  assert.ok(!graph.edges.some((edge) => edge.kind === "resource-supply-candidate"));
  const bossMutation = graph.nodes.find((node) =>
    node.kind === "mutation" && node.hook === "afterBattle" && node.floorId === "MT5" && node.at === "6,7");
  assert.ok(bossMutation);
  assert.ok(bossMutation.effects.some((effect) => effect.name === "flag:door_MT5_4_1"));
  assert.ok(bossMutation.effects.some((effect) => effect.name === "item:I573"));
  const doorAutoEvent = graph.nodes.find((node) =>
    node.kind === "mutation" && node.hook === "autoEvent" && node.floorId === "MT5" && node.at === "4,1");
  assert.ok(doorAutoEvent);
  assert.ok(graph.edges.some((edge) =>
    edge.kind === "state-mutation-dependency-candidate"
      && edge.from === bossMutation.id
      && edge.to === doorAutoEvent.id));
  assert.ok(graph.edges.some((edge) =>
    edge.kind === "scripted-mutation-target"
      && edge.from === doorAutoEvent.id
      && edge.to === "MT5:door:4,1:specialDoor"));
  assert.strictEqual(graph.summary.dependencyCompleteness, "candidate-graph-not-proof");
  assert.ok(graph.summary.unresolvedCombatGateCount > 0);
  assert.deepStrictEqual(
    graph.summary.unresolvedResourceRequirements.map((entry) => entry.itemId),
    ["specialKey", "specialKey"],
  );
  const serialized = JSON.stringify(graph);
  for (const forbidden of ["routeRecord", "routeFixture", "startFrom", "minHero", "presentTiles", "removedTiles"]) {
    assert.ok(!serialized.includes(`\"${forbidden}\"`), `graph leaked forbidden input ${forbidden}`);
  }
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    graphFingerprint: graph.graphFingerprint,
    floorCorridor: graph.floorCorridor,
    summary: graph.summary,
    mutationHooks: graph.hookRecords.length,
    resourceSupplyEdges: graph.edges.filter((edge) => edge.kind === "resource-supply-candidate").length,
    mutationDependencyEdges: graph.edges.filter((edge) => edge.kind === "state-mutation-dependency-candidate").length,
    floorTransitionEdges: graph.edges.filter((edge) => edge.kind === "floor-transition").length,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
