#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

const TOWER_ROOTS = [
  "Only upV2.1/",
  "whiteisland（9）/",
  "猫可露露V5.9（屑猫头基础教程）/",
];

const LEGACY_SOLVER_ROOTS = [
  "Only upV2.1/Only upV2.1/solver/",
  "whiteisland（9）/solver/",
];

const GENERATED_OUTPUT_ROOTS = [
  "runs/",
  "routes/generated/",
  "logs/generated/",
  "benchmarks/results/",
];

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    args[match[1]] = match[2] == null ? "1" : match[2];
  }
  return args;
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

function changedFiles() {
  const names = new Set();
  for (const line of runGit(["diff", "--name-only"]).split(/\r?\n/)) {
    if (line.trim()) names.add(toPosix(line.trim()));
  }
  for (const line of runGit(["diff", "--name-only", "--cached"]).split(/\r?\n/)) {
    if (line.trim()) names.add(toPosix(line.trim()));
  }
  for (const line of runGit(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/)) {
    if (line.trim()) names.add(toPosix(line.trim()));
  }
  return [...names].sort();
}

function startsWithAny(filePath, roots) {
  return roots.some((root) => filePath.startsWith(root));
}

function isAgentRunPath(filePath, agentName) {
  if (!filePath.startsWith("agents/")) return false;
  const parts = filePath.split("/");
  if (parts.length < 4) return false;
  if (agentName && parts[1] !== agentName) return false;
  return parts[2] === "runs";
}

function isGeneratedOutputPath(filePath) {
  return startsWithAny(filePath, GENERATED_OUTPUT_ROOTS);
}

function isAllowedPublicLayerDevPath(filePath) {
  return (
    filePath.startsWith("shared-solver/") ||
    filePath.startsWith("tools/") ||
    filePath.startsWith("docs/") ||
    filePath.startsWith("agents/") ||
    filePath.startsWith("benchmarks/") ||
    filePath.startsWith("towers/") ||
    filePath.startsWith("runs/") ||
    filePath.startsWith("routes/generated/") ||
    filePath.startsWith("logs/generated/")
  );
}

function classifyWriteViolation(filePath, config) {
  if (startsWithAny(filePath, LEGACY_SOLVER_ROOTS)) {
    return "legacy tower solver write";
  }
  if (startsWithAny(filePath, TOWER_ROOTS)) {
    return "tower project write";
  }
  if (filePath.startsWith("shared-solver/") && !config.allowPublicLayerDev) {
    return "shared-solver write outside public-layer development";
  }
  if (config.allowPublicLayerDev) {
    return isAllowedPublicLayerDevPath(filePath) ? null : "write outside public-layer development roots";
  }
  if (isAgentRunPath(filePath, config.agentName)) return null;
  if (isGeneratedOutputPath(filePath)) return null;
  return "write outside agent output roots";
}

function readFileIfPresent(filePath) {
  const absolutePath = path.join(repoRoot, filePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return "";
  return fs.readFileSync(absolutePath, "utf8");
}

function importViolations(filePath) {
  if (!filePath.startsWith("agents/") || !filePath.endsWith(".js")) return [];
  const source = readFileIfPresent(filePath);
  if (!source) return [];
  const violations = [];
  const patterns = [
    {
      pattern: /(?:require|from|import\s*\()\s*\(?\s*["'][^"']*(?:Only upV2\.1|whiteisland（9）)[^"']*\/solver(?:\/lib)?[^"']*["']/g,
      reason: "agent imports tower legacy solver",
    },
    {
      pattern: /(?:require|from|import\s*\()\s*\(?\s*["'][^"']*shared-solver\/lib\/[^"']*["']/g,
      reason: "agent imports shared-solver private lib",
    },
  ];
  for (const rule of patterns) {
    if (rule.pattern.test(source)) violations.push(rule.reason);
  }
  return violations;
}

function usage() {
  console.log([
    "Usage:",
    "  node tools/check-agent-boundaries.js [--agent=<name>]",
    "  node tools/check-agent-boundaries.js --allow-public-layer-dev=1",
    "  node tools/check-agent-boundaries.js --public-layer-dev",
    "",
    "Strict agent mode allows writes only under:",
    "  agents/<agent>/runs/**, runs/**, routes/generated/**, logs/generated/**, benchmarks/results/**",
    "",
    "Public-layer dev mode also allows shared-solver/**, tools/**, docs/**, agents/**, benchmarks/**, towers/**.",
    "Tower project and legacy tower solver writes are always rejected.",
  ].join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const config = {
    agentName: args.agent || null,
    allowPublicLayerDev: args["allow-public-layer-dev"] === "1" ||
      args["allow-public-layer-dev"] === "true" ||
      args["public-layer-dev"] === "1" ||
      args["public-layer-dev"] === "true",
  };

  const files = changedFiles();
  const writeViolations = [];
  const importProblems = [];

  for (const filePath of files) {
    const reason = classifyWriteViolation(filePath, config);
    if (reason) writeViolations.push({ filePath, reason });
    for (const importReason of importViolations(filePath)) {
      importProblems.push({ filePath, reason: importReason });
    }
  }

  if (writeViolations.length > 0 || importProblems.length > 0) {
    console.error("Agent boundary check failed.");
    if (writeViolations.length > 0) {
      console.error("");
      console.error("Write violations:");
      for (const violation of writeViolations) {
        console.error(`  - ${violation.filePath}: ${violation.reason}`);
      }
    }
    if (importProblems.length > 0) {
      console.error("");
      console.error("Import violations:");
      for (const violation of importProblems) {
        console.error(`  - ${violation.filePath}: ${violation.reason}`);
      }
    }
    process.exit(1);
  }

  console.log(`Agent boundary check passed (${files.length} changed files).`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}
