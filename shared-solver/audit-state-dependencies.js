"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseKeyValueArgs, resolveProjectRoot } = require("./lib/cli-options");
const { loadProject } = require("./lib/project-loader");

const WATCH_PATTERNS = [
  { id: "status:lv", regex: /status:lv|\bcore\.status\.hero\.lv\b|\bhero\.lv\b/g, branchRelevant: true },
  { id: "status:hpmax", regex: /status:hpmax|\bcore\.status\.hero\.hpmax\b|\bhero\.hpmax\b/g, branchRelevant: true },
  { id: "status:mana", regex: /status:mana|\bcore\.status\.hero\.mana\b|\bhero\.mana\b/g, branchRelevant: true },
  { id: "status:manamax", regex: /status:manamax|\bcore\.status\.hero\.manamax\b|\bhero\.manamax\b/g, branchRelevant: true },
  { id: "core.hasEquip", regex: /\bcore\.hasEquip\s*\(/g, branchRelevant: true },
  { id: "core.getEquip", regex: /\bcore\.getEquip\s*\(/g, branchRelevant: true },
  { id: "followers", regex: /\bfollowers\b|\bcore\.status\.followers\b/g, branchRelevant: true },
  { id: "status:steps", regex: /status:steps|\bcore\.status\.hero\.steps\b|\bhero\.steps\b/g, branchRelevant: false },
];

const SOURCE_EXTENSIONS = new Set([".js", ".json", ".ts"]);
const DEFAULT_WHITELIST = {
  "status:steps": [
    "solver tracks steps in route/replay diagnostics; not currently used as solver branch condition in this project unless found in project event/function files",
  ],
};

const KEY_REQUIREMENT_BY_PATTERN = {
  "status:lv": "hero.lv",
  "status:hpmax": "hero.hpmax",
  "status:mana": "hero.mana",
  "status:manamax": "hero.manamax",
  "core.hasEquip": "hero.equipment",
  "core.getEquip": "hero.equipment",
  followers: "hero.followers",
};

function walkFiles(root, predicate, result) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  entries.forEach((entry) => {
    if (entry.name === "node_modules" || entry.name === ".git") return;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(filePath, predicate, result);
      return;
    }
    if (predicate(filePath)) result.push(filePath);
  });
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
  }
}

function locationKind(filePath, projectRoot) {
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  if (/^_server\//.test(rel) || rel === "runtime.d.ts") return "reference-doc";
  if (/^project\//.test(rel)) return "project";
  if (/^floors\//.test(rel) || /^data\//.test(rel)) return "project";
  if (/^libs\//.test(rel)) return "engine-lib";
  if (/^plugins\//.test(rel)) return "plugin-or-lib";
  if (/^extensions\//.test(rel)) return "plugin-or-lib";
  if (/^solver\//.test(rel)) return "solver-code";
  return "other";
}

function lineColumnOf(text, index) {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function lineSnippet(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  const endIndex = text.indexOf("\n", index);
  const end = endIndex === -1 ? text.length : endIndex;
  return text.slice(start, end).trim().slice(0, 220);
}

function scanText(text, filePath, projectRoot) {
  const matches = [];
  WATCH_PATTERNS.forEach((pattern) => {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) != null) {
      const loc = lineColumnOf(text, match.index);
      matches.push({
        id: pattern.id,
        file: path.relative(projectRoot, filePath).replace(/\\/g, "/"),
        line: loc.line,
        column: loc.column,
        kind: locationKind(filePath, projectRoot),
        branchRelevantPattern: pattern.branchRelevant,
        snippet: lineSnippet(text, match.index),
      });
    }
  });
  return matches;
}

function classifyMatch(match) {
  const whitelist = DEFAULT_WHITELIST[match.id] || [];
  if (match.kind === "solver-code") {
    return {
      disposition: "whitelisted",
      reason: "solver internal reference; does not indicate project runtime branching dependency by itself",
    };
  }
  if (match.kind === "reference-doc") {
    return {
      disposition: "whitelisted",
      reason: "editor/runtime documentation reference, not project branching logic",
    };
  }
  if (match.kind === "engine-lib") {
    return {
      disposition: "whitelisted",
      reason: "generic engine library reference; project-specific usages are reviewed separately",
    };
  }
  if (whitelist.length > 0 && !match.branchRelevantPattern) {
    return {
      disposition: "whitelisted",
      reason: whitelist[0],
    };
  }
  if (/condition|if|choices|switch|case|core\.hasEquip|core\.getEquip|status:/i.test(match.snippet)) {
    return {
      disposition: "needs-review",
      reason: "reference appears in branch-like or event-like context; consider adding to key or disabling affected pruning",
    };
  }
  if (match.kind === "project" || match.kind === "plugin-or-lib") {
    return {
      disposition: match.branchRelevantPattern ? "needs-review" : "whitelisted",
      reason: match.branchRelevantPattern
        ? "project/plugin dependency may affect solver branch semantics"
        : "project/plugin reference is currently treated as non-branching unless surrounding logic proves otherwise",
    };
  }
  return {
    disposition: "whitelisted",
    reason: "reference outside project/plugin branch surfaces",
  };
}

function summarize(matches) {
  const byId = {};
  matches.forEach((match) => {
    const classified = classifyMatch(match);
    const entry = { ...match, ...classified };
    if (!byId[match.id]) byId[match.id] = { total: 0, needsReview: 0, whitelisted: 0, samples: [] };
    byId[match.id].total += 1;
    if (entry.disposition === "needs-review") byId[match.id].needsReview += 1;
    else byId[match.id].whitelisted += 1;
    if (byId[match.id].samples.length < 12) byId[match.id].samples.push(entry);
  });
  WATCH_PATTERNS.forEach((pattern) => {
    if (!byId[pattern.id]) byId[pattern.id] = { total: 0, needsReview: 0, whitelisted: 0, samples: [] };
  });
  return byId;
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(args, path.resolve(__dirname, "../Only upV2.1/Only upV2.1"));
  loadProject(projectRoot);
  const files = [];
  walkFiles(projectRoot, (filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)), files);
  const matches = files.flatMap((filePath) => scanText(safeRead(filePath), filePath, projectRoot));
  const byId = summarize(matches);
  const needsReview = Object.entries(byId)
    .filter(([, value]) => value.needsReview > 0)
    .map(([id, value]) => ({ id, needsReview: value.needsReview, total: value.total }));
  const requiredByCurrentTower = needsReview.map((entry) => ({
    pattern: entry.id,
    keyRequirement: KEY_REQUIREMENT_BY_PATTERN[entry.id] || null,
    needsReview: entry.needsReview,
    status: KEY_REQUIREMENT_BY_PATTERN[entry.id] ? "covered-by-current-state-key-or-dominance-policy-review" : "requires-manual-review",
  }));
  const ignoredWithReason = Object.entries(byId)
    .filter(([id, value]) => value.total > 0 && value.needsReview === 0)
    .map(([id, value]) => ({
      pattern: id,
      total: value.total,
      reason: ((value.samples || [])[0] || {}).reason || "no branch-affecting project usage found",
    }));
  const keyCoverage = {
    stateKeyIncludes: ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv", "equipment", "followers"],
    dominanceSummaryIncludes: ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv", "inventory"],
    intentionallyNotKeyed: {
      "status:steps": "route/replay metric; not a branching key unless audit finds project/plugin branch dependency",
    },
  };
  const report = {
    scannedFiles: files.length,
    watched: WATCH_PATTERNS.map((pattern) => pattern.id),
    needsReview,
    requiredByCurrentTower,
    ignoredWithReason,
    byId,
    keyCoverage,
    policy: {
      passCondition: "audit is informational; needs-review entries require explicit key/pruning decision before claiming safe dominance coverage",
      noGlobalOptimalityClaim: true,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--fail-on-review") && needsReview.length > 0) process.exitCode = 2;
}

main();
