"use strict";

const path = require("node:path");

const { parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { applyConfigDefaults, loadSolverConfig } = require("./lib/solver-config");
const { main: runSearch } = require("./run-search");

async function main() {
  const rawArgs = parseKeyValueArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(rawArgs, path.resolve(__dirname, ".."));
  const project = loadProject(projectRoot);
  const resolvedConfig = loadSolverConfig(projectRoot, project, rawArgs);
  const args = applyConfigDefaults(rawArgs, resolvedConfig);
  await runSearch(args, { resolvedConfig });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
