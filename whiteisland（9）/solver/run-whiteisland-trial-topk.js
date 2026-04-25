#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const sharedScript = path.resolve(projectRoot, "..", "shared-solver", "run-whiteisland-trial-topk.js");
const args = process.argv.slice(2);
const hasProjectRoot = args.some((arg) => arg === "--project-root" || arg.startsWith("--project-root="));
const hasAutoBattle = args.some((arg) => arg === "--auto-battle" || arg.startsWith("--auto-battle="));
const hasAutoLevelup = args.some((arg) => arg === "--auto-levelup" || arg.startsWith("--auto-levelup="));
const finalArgs = [
  ...(hasProjectRoot ? [] : [`--project-root=${projectRoot}`]),
  ...(hasAutoBattle ? [] : ["--auto-battle=0"]),
  ...(hasAutoLevelup ? [] : ["--auto-levelup=0"]),
  ...args,
];

const result = spawnSync(process.execPath, [sharedScript, ...finalArgs], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status == null ? 1 : result.status);
