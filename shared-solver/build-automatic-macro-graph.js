"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { buildAutomaticMacroGraph } = require("./lib/automatic-macro-graph");
const { makeBlindSimulator, readBlindGoal } = require("./lib/blind-discovery-baseline");
const { loadProject } = require("./lib/project-loader");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_GOAL_FILE = path.resolve(__dirname, "blind-goals", "onlyup-mt5-blueking.json");

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const blindGoal = readBlindGoal(path.resolve(args["goal-file"] || DEFAULT_GOAL_FILE));
  const project = loadProject(projectRoot);
  const simulator = makeBlindSimulator(project);
  const graph = buildAutomaticMacroGraph(project, simulator.createInitialState(), blindGoal.goal, {
    towerId: blindGoal.project,
  });
  if (args.out) {
    const output = path.resolve(args.out);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
  return graph;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
