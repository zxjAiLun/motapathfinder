"use strict";

const { createLauncherServer, parseArgs } = require("./launcher/server");

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log([
      "Usage: node run-solver-launcher.js [--host=127.0.0.1] [--port=3210]",
      "  [--jobs-root=runs/jobs] [--tower-config=launcher-towers.json]",
      "  [--max-concurrent-jobs=1] [--browser=<path>]",
      "",
      "The Launcher serves a manual SolveTask builder + job dashboard on localhost.",
      "It consumes only the public SolveTask/SolverJob/SolverProgress/SolverJobResult contracts.",
    ].join("\n"));
    return;
  }
  const launcher = createLauncherServer({
    host: args.host || "127.0.0.1",
    port: Number(args.port || 3210),
    jobsRoot: args["jobs-root"],
    towerConfig: args["tower-config"],
    maxConcurrentJobs: Number(args["max-concurrent-jobs"] || 1),
  });
  launcher.listen().then((port) => {
    const towers = launcher.registry.listTowers();
    console.log(`Solver Launcher listening on http://127.0.0.1:${port}`);
    console.log(`Registered towers: ${towers.map((tower) => tower.id).join(", ") || "(none)"}`);
    console.log(`Jobs root: ${launcher.jobStore.root}`);
  }).catch((error) => {
    console.error(`Failed to start Solver Launcher: ${error.message}`);
    process.exitCode = 1;
  });
}

if (require.main === module) {
  main();
}
