#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const sharedScript = path.resolve(projectRoot, "..", "shared-solver", "route-gui.js");
const args = process.argv.slice(2);
const hasProjectRoot = args.some((arg) => arg === "--project-root" || arg.startsWith("--project-root="));
const finalArgs = hasProjectRoot ? args : [`--project-root=${projectRoot}`, ...args];

const result = spawnSync(process.execPath, [sharedScript, ...finalArgs], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status == null ? 1 : result.status);
