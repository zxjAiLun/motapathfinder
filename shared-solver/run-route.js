"use strict";

const path = require("node:path");

const { parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");
const { applyConfigDefaults, loadSolverConfig } = require("./lib/solver-config");
const { main: runMt1Mt11 } = require("./run-mt1-mt11");

async function main() {
  const rawArgs = parseKeyValueArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(rawArgs, path.resolve(__dirname, ".."));
  const project = loadProject(projectRoot);
  const resolvedConfig = loadSolverConfig(projectRoot, project, rawArgs);
  const args = applyConfigDefaults(rawArgs, resolvedConfig);
  await runMt1Mt11(args, { resolvedConfig });
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
