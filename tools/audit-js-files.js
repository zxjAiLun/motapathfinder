#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const docsDir = path.join(repoRoot, "docs");
const inventoryPath = path.join(docsDir, "js-inventory.md");
const entrypointsPath = path.join(docsDir, "solver-entrypoints.md");
const legacyBaselinePath = path.join(docsDir, "legacy-tower-solver-js-baseline.json");
const solverManifestPath = path.join(repoRoot, "shared-solver", "solver-manifest.json");

let cachedSolverManifest = null;

function loadSolverManifest() {
  if (cachedSolverManifest) return cachedSolverManifest;
  if (!fs.existsSync(solverManifestPath)) {
    cachedSolverManifest = null;
    return null;
  }
  cachedSolverManifest = JSON.parse(fs.readFileSync(solverManifestPath, "utf8"));
  return cachedSolverManifest;
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchPathRule(relPath, rule) {
  if (!rule || !rule.match) return false;
  return globToRegExp(rule.match).test(relPath);
}

function lookupManifestEntry(relPath) {
  const manifest = loadSolverManifest();
  if (!manifest) return null;
  if (manifest.modules && manifest.modules[relPath]) {
    return { kind: "module", entry: manifest.modules[relPath] };
  }
  if (manifest.tests && manifest.tests[relPath]) {
    return { kind: "test", entry: manifest.tests[relPath] };
  }
  if (Array.isArray(manifest.pathRules)) {
    for (const rule of manifest.pathRules) {
      if (matchPathRule(relPath, rule)) return { kind: "pathRule", entry: rule };
    }
  }
  return null;
}

function manifestRecommendedAction(relPath, category) {
  const hit = lookupManifestEntry(relPath);
  if (!hit) return null;
  const entry = hit.entry || {};
  if (entry.recommendedAction) return entry.recommendedAction;
  if (hit.kind === "test") {
    const grade = entry.grade || "ungraded";
    const allowsNotFound = entry.allowsNotFound ? "allows found=false" : "expects success semantics per script";
    return `test grade=${grade}; ${allowsNotFound}`;
  }
  const status = entry.status || "supporting";
  const role = entry.role || "supporting";
  const correctness = entry.correctnessSource === true ? "correctness-source" : "not-correctness-source";
  if (status === "archive-candidate") {
    return "archive to _archive/experiments/pre-canonical/; do not treat as canonical";
  }
  if (status === "experimental") {
    return `experimental ${role}; ${correctness}; candidate-generator only`;
  }
  if (status === "exploration") {
    return `exploration ${role}; never treat miss as proof of no route`;
  }
  if (status === "canonical" && entry.correctnessSource === true) {
    return "keep as canonical correctness implementation";
  }
  if (status === "canonical") {
    return `keep as canonical ${role || category}`;
  }
  return `keep as ${status} ${role}; ${correctness}`;
}

function manifestCategory(relPath, fallback) {
  const hit = lookupManifestEntry(relPath);
  if (!hit) return fallback;
  const entry = hit.entry || {};
  if (hit.kind === "test") return "solver test";
  if (entry.status === "archive-candidate") return "archive candidate";
  if (entry.status === "experimental") return "experimental solver";
  if (entry.status === "exploration") return "exploration solver";
  if (entry.layer === "cli" || entry.role === "cli") return "solver cli";
  if (entry.layer === "tests" || entry.role === "test") return "solver test";
  if (entry.layer && String(entry.layer).startsWith("tools")) return "solver tool";
  if (entry.layer === "diagnostics" || entry.role === "diagnostics") return "solver diagnostics";
  if (entry.layer === "public" || entry.role === "public-api") return "solver public api";
  if (entry.correctnessSource === true) return "canonical solver core";
  if (entry.status === "canonical") return "canonical solver support";
  if (entry.status === "supporting") return "solver support";
  return fallback;
}

const EXCLUDED_DIRS = new Set([
  ".git",
  ".cache",
  ".venv",
  ".venv-standard-server",
  "__pycache__",
  "_archive",
  "node_modules",
  "replay-downloads",
  "venv",
]);

const LEGACY_TOWER_SOLVER_ROOTS = [
  "Only upV2.1/Only upV2.1/solver/",
  "whiteisland（9）/solver/",
];

const TOWER_RUNTIME_DIRS = [
  "extensions",
  "libs",
  "project",
  "_docs",
  "_server",
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function relativePath(filePath) {
  return toPosix(path.relative(repoRoot, filePath));
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function classifyFile(relPath) {
  if (relPath.startsWith("tools/")) return "repo tools";
  if (relPath.startsWith("benchmarks/")) return "benchmark harness";
  if (relPath.startsWith("agents/")) return "agent sandbox";
  if (relPath.startsWith("shared-solver/")) {
    return manifestCategory(relPath, "canonical solver");
  }
  if (isLegacyTowerSolverPath(relPath)) return "legacy solver candidate";
  if (relPath.startsWith("routes/") || relPath.includes("/routes/")) return "suspicious route js";
  if (relPath.startsWith("logs/") || relPath.includes("/logs/")) return "suspicious log js";
  if (relPath.includes("/project/")) return "tower project data/runtime";
  if (isTowerRuntimePath(relPath)) return "tower project data/runtime";
  return "uncategorized js";
}

function isTowerRuntimePath(relPath) {
  const parts = relPath.split("/");
  if (parts.length < 2) return false;
  if (parts[parts.length - 1] === "main.js") return true;
  return TOWER_RUNTIME_DIRS.some((dirName) => parts.includes(dirName));
}

function isLegacyTowerSolverPath(relPath) {
  return LEGACY_TOWER_SOLVER_ROOTS.some((root) => relPath.startsWith(root));
}

function recommendedAction(category, relPath) {
  if (relPath) {
    const fromManifest = manifestRecommendedAction(relPath, category);
    if (fromManifest) return fromManifest;
  }
  switch (category) {
    case "canonical solver":
    case "canonical solver core":
      return "keep as canonical implementation";
    case "canonical solver support":
      return "keep as canonical support module";
    case "experimental solver":
      return "experimental; candidate-generator only; not a correctness proof";
    case "exploration solver":
      return "exploration only; never treat miss as proof of no route";
    case "archive candidate":
      return "archive to _archive/experiments/pre-canonical/; do not treat as canonical";
    case "solver test":
      return "keep as regression/check script; consult solver-manifest test grade";
    case "solver cli":
      return "keep as CLI orchestration; no reusable logic growth";
    case "solver tool":
      return "keep as solver tooling";
    case "solver diagnostics":
      return "keep as diagnostics";
    case "solver public api":
      return "stable public API surface for agents; keep thin";
    case "solver support":
      return "keep as supporting solver module";
    case "legacy solver candidate":
      return "freeze; archive later; do not add or edit solver JS here";
    case "tower project data/runtime":
      return "leave untouched as h5mota project/runtime";
    case "suspicious route js":
    case "suspicious log js":
      return "inspect; generated routes/logs should not contain solver code";
    case "repo tools":
      return "keep as repository tooling";
    case "benchmark harness":
      return "keep as benchmark/agent harness";
    case "agent sandbox":
      return "allow as agent sandbox";
    default:
      return "review ownership";
  }
}

function extractDependencies(source) {
  const dependencies = new Set();
  const patterns = [
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+(?:[^"']+?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) dependencies.add(match[1]);
  }
  return [...dependencies];
}

function extractExports(source) {
  const exportsFound = new Set();

  if (/\bmodule\.exports\s*=/.test(source)) exportsFound.add("module.exports");

  for (const match of source.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    exportsFound.add(match[1]);
  }
  for (const match of source.matchAll(/\bmodule\.exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    exportsFound.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    exportsFound.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const rawName of match[1].split(",")) {
      const name = rawName.trim().split(/\s+as\s+/i).pop().trim();
      if (name) exportsFound.add(name);
    }
  }
  if (/\bexport\s+default\b/.test(source)) exportsFound.add("default");

  return [...exportsFound].sort();
}

function resolveRelativeDependency(fromRelPath, dependency) {
  if (!dependency.startsWith(".")) return null;
  const fromAbs = path.join(repoRoot, fromRelPath);
  const base = path.resolve(path.dirname(fromAbs), dependency);
  const candidates = [
    base,
    `${base}.js`,
    path.join(base, "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return relativePath(candidate);
    }
  }
  return null;
}

function collectInventory() {
  const absoluteFiles = walk(repoRoot).sort((left, right) => relativePath(left).localeCompare(relativePath(right)));
  const byHash = new Map();
  const rows = [];
  const importedBy = new Map();

  for (const absolutePath of absoluteFiles) {
    const relPath = relativePath(absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    const hash = sha256(source);
    const category = classifyFile(relPath);
    const dependencies = extractDependencies(source);
    const resolvedDeps = dependencies
      .map((dependency) => resolveRelativeDependency(relPath, dependency))
      .filter(Boolean);

    for (const resolved of resolvedDeps) {
      if (!importedBy.has(resolved)) importedBy.set(resolved, new Set());
      importedBy.get(resolved).add(relPath);
    }

    const duplicateOf = byHash.has(hash) ? byHash.get(hash) : null;
    if (!byHash.has(hash)) byHash.set(hash, relPath);

    const manifestHit = lookupManifestEntry(relPath);
    rows.push({
      path: relPath,
      category,
      sha256: hash,
      exports: extractExports(source),
      dependencies,
      resolvedDeps,
      isDuplicateOf: duplicateOf,
      recommendedAction: recommendedAction(category, relPath),
      manifestStatus: manifestHit && manifestHit.entry ? (manifestHit.entry.status || manifestHit.entry.grade || "-") : "-",
      manifestLayer: manifestHit && manifestHit.entry ? (manifestHit.entry.layer || (manifestHit.kind === "test" ? "tests" : "-")) : "-",
      correctnessSource: manifestHit && manifestHit.entry && manifestHit.entry.correctnessSource === true,
    });
  }

  for (const row of rows) {
    row.importedBy = [...(importedBy.get(row.path) || [])].sort();
  }

  return rows;
}

function escapeCell(value) {
  const text = String(value == null || value === "" ? "-" : value);
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function compactList(values, limit = 4) {
  if (!values || values.length === 0) return "-";
  const shown = values.slice(0, limit);
  const suffix = values.length > limit ? `<br>… +${values.length - limit}` : "";
  return `${shown.map(escapeCell).join("<br>")}${suffix}`;
}

function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) || 0) + 1);
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function writeInventory(rows) {
  const lines = [];
  lines.push("# JS Inventory");
  lines.push("");
  lines.push("Generated by `node tools/audit-js-files.js`.");
  lines.push("");
  lines.push("Categories for `shared-solver/**` are refined by `shared-solver/solver-manifest.json` when present.");
  lines.push("Do not treat `experimental` / `exploration` / `archive-candidate` as correctness proof sources.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total JS files: ${rows.length}`);
  lines.push(`- Excluded directories: ${[...EXCLUDED_DIRS].sort().map((name) => `\`${name}\``).join(", ")}`);
  lines.push(`- Solver manifest: ${fs.existsSync(solverManifestPath) ? "`shared-solver/solver-manifest.json`" : "missing"}`);
  lines.push("");
  lines.push("| Category | Count |");
  lines.push("| --- | ---: |");
  for (const [category, count] of countBy(rows, "category")) {
    lines.push(`| ${escapeCell(category)} | ${count} |`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("| Path | Category | Status | Layer | SHA-256 | Imported By | Exports | Duplicate Of | Recommended Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push([
      escapeCell(row.path),
      escapeCell(row.category),
      escapeCell(row.manifestStatus || "-"),
      escapeCell(row.manifestLayer || "-"),
      escapeCell(row.sha256.slice(0, 16)),
      compactList(row.importedBy),
      compactList(row.exports, 6),
      escapeCell(row.isDuplicateOf || "-"),
      escapeCell(row.recommendedAction),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  fs.writeFileSync(inventoryPath, `${lines.join("\n")}\n`);
}

function findExisting(relPath) {
  const absPath = path.join(repoRoot, relPath);
  return fs.existsSync(absPath) ? relPath : null;
}

function writeEntrypoints(rows) {
  const sharedCli = rows
    .filter((row) => row.path.startsWith("shared-solver/") && /^shared-solver\/(?:run|check|verify|route|export|search|print|find|profile|record|audit)[^/]*\.js$/.test(row.path))
    .map((row) => row.path)
    .sort();
  const towerWrappers = [
    findExisting("Only upV2.1/Only upV2.1/solver.sh"),
    findExisting("Only upV2.1/Only upV2.1/solver.config.json"),
    findExisting("whiteisland（9）/solver.sh"),
    findExisting("whiteisland（9）/solver.config.json"),
  ].filter(Boolean);
  const legacySolvers = rows
    .filter((row) => row.category === "legacy solver candidate")
    .map((row) => row.path)
    .sort();

  const lines = [];
  lines.push("# Solver Entrypoints");
  lines.push("");
  lines.push("Generated by `node tools/audit-js-files.js`.");
  lines.push("");
  lines.push("## Policy");
  lines.push("");
  lines.push("- `shared-solver/` is the canonical solver implementation.");
  lines.push("- Module identity lives in `shared-solver/solver-manifest.json` (status/layer/correctnessSource/test grade).");
  lines.push("- `shared-solver/public.js` is the stable API for external agents; see `docs/public-api.md`.");
  lines.push("- Public-layer write boundaries are documented in `docs/development-boundaries.md`.");
  lines.push("- Region/segment canonical DP is the correctness path; `linear-main` / beam / macro search is auxiliary exploration. See `docs/solver-architecture.md`.");
  lines.push("- Experimental modules (`resource-timing`, `resource-deferral`, `milestone-decomposer`) are candidate generators, not impossibility proofs.");
  lines.push("- Tower `solver/` directories are legacy copies and are frozen.");
  lines.push("- Tower project/runtime JavaScript under `project/`, `libs/`, `extensions/`, `_server/`, and `main.js` is not solver code and should remain in place.");
  lines.push("- New solver work should land in `shared-solver/`, `tools/`, or documented agent sandboxes, not inside tower `solver/` directories.");
  lines.push("- Smoke-grade checks may pass with `found=false`; only closure-grade checks assert found + strict replay.");
  lines.push("");
  lines.push("## Tower Wrappers");
  lines.push("");
  for (const wrapper of towerWrappers) lines.push(`- \`${wrapper}\``);
  if (towerWrappers.length === 0) lines.push("- None found.");
  lines.push("");
  lines.push("## Normal Commands");
  lines.push("");
  lines.push("Only Up:");
  lines.push("");
  lines.push("```bash");
  lines.push("cd \"Only upV2.1/Only upV2.1\" && ./solver.sh");
  lines.push("```");
  lines.push("");
  lines.push("Whiteisland:");
  lines.push("");
  lines.push("```bash");
  lines.push("cd \"whiteisland（9）\" && ./solver.sh");
  lines.push("```");
  lines.push("");
  lines.push("Shared solver:");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run run:onlyup:segmented --prefix shared-solver");
  lines.push("```");
  lines.push("");
  lines.push("Unified region DP:");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run run:onlyup:region1 --prefix shared-solver");
  lines.push("```");
  lines.push("");
  lines.push("Public benchmark harness:");
  lines.push("");
  lines.push("```bash");
  lines.push("node benchmarks/run-agent.js --agent=agents/.templates/agent.json --suite=benchmarks/public/region-suite.json");
  lines.push("```");
  lines.push("");
  lines.push("## Canonical Shared-Solver CLIs");
  lines.push("");
  for (const entrypoint of sharedCli) lines.push(`- \`${entrypoint}\``);
  if (sharedCli.length === 0) lines.push("- None found.");
  lines.push("");
  lines.push("## Legacy Solver Copies");
  lines.push("");
  lines.push("These files are inventoried for migration/archive only. Do not edit them for new solver behavior.");
  lines.push("");
  for (const legacyPath of legacySolvers) lines.push(`- \`${legacyPath}\``);
  if (legacySolvers.length === 0) lines.push("- None found.");
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("- Regenerate inventory: `node tools/audit-js-files.js`");
  lines.push("- Check solver manifest coverage: `node tools/audit-js-files.js --check-manifest`");
  lines.push("- Freeze legacy tower solver JS: `npm run check:no-tower-solver-js --prefix shared-solver`");
  lines.push("- Check public-layer writes: `npm run check:public-layer-boundaries --prefix shared-solver`");
  lines.push("- Check strict agent output writes: `npm run check:agent-boundaries --prefix shared-solver -- --agent=<agent-name>`");
  lines.push("- Teacher divergence audit: `npm run check:teacher-divergence --prefix shared-solver`");
  lines.push("- Refresh legacy baseline only after intentional archive/freeze reset: `node tools/audit-js-files.js --refresh-legacy-baseline`");
  lines.push("- Refresh solver manifest module list: `node shared-solver/scripts/generate-solver-manifest.js`");
  lines.push("");
  lines.push("## Shared-Solver Module Boundaries");
  lines.push("");
  lines.push("These are the intended layers. Current files do not need to move immediately; new code should respect the boundary.");
  lines.push("");
  lines.push("| Layer | Responsibility | Current Examples |");
  lines.push("| --- | --- | --- |");
  lines.push("| Core | Project loading, state simulation, expressions, battle/door/equipment/tool resolution, reachability, step simulation | `shared-solver/lib/project-loader.js`, `shared-solver/lib/simulator.js`, `shared-solver/lib/battle-resolver.js`, `shared-solver/lib/reachability.js` |");
  lines.push("| Search | DP, segment graph, adaptive planning, search profiles, resource intent/lookahead/cluster logic | `shared-solver/lib/dp-search.js`, `shared-solver/lib/segment-dp.js`, `shared-solver/lib/adaptive-segment-planner.js`, `shared-solver/lib/resource-intent-scanner.js` |");
  lines.push("| Replay | Route schema, route snapshots, live replay sessions, GUI playback | `shared-solver/lib/route-store.js`, `shared-solver/lib/route-snapshot.js`, `shared-solver/lib/replay-session.js`, `shared-solver/route-gui.js` |");
  lines.push("| CLI | Thin command wrappers only; no core search logic should live here | `shared-solver/run-segmented-dp.js`, `shared-solver/run-adaptive-segment-dp.js`, `shared-solver/verify-route-live.js` |");
  lines.push("");
  lines.push("Legacy tower copies of replay/search files, including `solver/route-gui.js` and `solver/lib/replay-session.js`, should be archived in a later phase after shared replay commands cover the same workflows.");
  fs.writeFileSync(entrypointsPath, `${lines.join("\n")}\n`);
}

function writeLegacyBaseline(rows) {
  const legacyRows = rows
    .filter((row) => isLegacyTowerSolverPath(row.path))
    .map((row) => ({
      path: row.path,
      sha256: row.sha256,
      category: row.category,
      recommendedAction: row.recommendedAction,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const baseline = {
    generatedBy: "node tools/audit-js-files.js",
    policy: "Legacy tower solver JavaScript is frozen. New or modified JS under these roots should fail check:no-tower-solver-js.",
    legacyRoots: LEGACY_TOWER_SOLVER_ROOTS,
    excludedDirs: [...EXCLUDED_DIRS].sort(),
    files: legacyRows,
  };
  fs.writeFileSync(legacyBaselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

function checkNoTowerSolverJs() {
  if (!fs.existsSync(legacyBaselinePath)) {
    console.error(`Missing baseline: ${relativePath(legacyBaselinePath)}`);
    console.error("Run `node tools/audit-js-files.js` first.");
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(legacyBaselinePath, "utf8"));
  const baselineByPath = new Map((baseline.files || []).map((entry) => [entry.path, entry]));
  const rows = collectInventory().filter((row) => isLegacyTowerSolverPath(row.path));
  const currentByPath = new Map(rows.map((row) => [row.path, row]));

  const added = [];
  const modified = [];
  const missing = [];

  for (const row of rows) {
    const baselineEntry = baselineByPath.get(row.path);
    if (!baselineEntry) {
      added.push(row.path);
    } else if (baselineEntry.sha256 !== row.sha256) {
      modified.push(row.path);
    }
  }

  for (const pathName of baselineByPath.keys()) {
    if (!currentByPath.has(pathName)) missing.push(pathName);
  }

  if (added.length > 0 || modified.length > 0) {
    console.error("Legacy tower solver JS freeze check failed.");
    if (added.length > 0) {
      console.error("");
      console.error("New legacy solver JS files:");
      for (const pathName of added) console.error(`  - ${pathName}`);
    }
    if (modified.length > 0) {
      console.error("");
      console.error("Modified legacy solver JS files:");
      for (const pathName of modified) console.error(`  - ${pathName}`);
    }
    if (missing.length > 0) {
      console.error("");
      console.error("Missing baseline files (warning only, likely archive/delete work):");
      for (const pathName of missing) console.error(`  - ${pathName}`);
    }
    process.exit(1);
  }

  console.log(`Legacy tower solver JS freeze check passed (${rows.length} files).`);
  if (missing.length > 0) {
    console.log(`Warning: ${missing.length} baseline files are missing; regenerate baseline after intentional archive/delete work.`);
  }
}

function checkSolverManifest() {
  const manifest = loadSolverManifest();
  if (!manifest) {
    console.error(`Missing solver manifest: ${relativePath(solverManifestPath)}`);
    process.exit(1);
  }

  const libDir = path.join(repoRoot, "shared-solver", "lib");
  const libFiles = fs.existsSync(libDir)
    ? fs.readdirSync(libDir).filter((name) => name.endsWith(".js")).map((name) => `shared-solver/lib/${name}`)
    : [];
  const moduleKeys = new Set(Object.keys(manifest.modules || {}));
  const testEntries = manifest.tests || {};
  const missing = libFiles.filter((filePath) => !moduleKeys.has(filePath));
  const stale = [...moduleKeys].filter((filePath) => !fs.existsSync(path.join(repoRoot, filePath)));
  const sharedSolverDir = path.join(repoRoot, "shared-solver");
  const checkFiles = fs.existsSync(sharedSolverDir)
    ? fs.readdirSync(sharedSolverDir)
      .filter((name) => /^check-.*\.js$/.test(name))
      .map((name) => `shared-solver/${name}`)
    : [];
  const missingTests = checkFiles.filter((filePath) => !Object.prototype.hasOwnProperty.call(testEntries, filePath));
  const staleTests = Object.keys(testEntries).filter((filePath) => !fs.existsSync(path.join(repoRoot, filePath)));
  const allowedGrades = new Set([
    "unit",
    "unit-plus-micro",
    "integration-local",
    "local-regression",
    "diagnostic",
    "smoke",
    "smoke-wrapper",
    "closure",
  ]);
  const invalidTests = [];
  for (const [filePath, entry] of Object.entries(testEntries)) {
    if (!entry || !allowedGrades.has(entry.grade)) {
      invalidTests.push(`${filePath}: invalid grade=${entry && entry.grade}`);
      continue;
    }
    for (const field of ["allowsNotFound", "requiresStrictReplay", "cleanCheckout"]) {
      if (typeof entry[field] !== "boolean") {
        invalidTests.push(`${filePath}: ${field} must be boolean`);
      }
    }
    if (entry.grade === "closure" && (entry.allowsNotFound || !entry.requiresStrictReplay)) {
      invalidTests.push(`${filePath}: closure must require strict replay and reject found=false`);
    }
  }

  const tmpFiles = [];
  if (fs.existsSync(sharedSolverDir)) {
    for (const name of fs.readdirSync(sharedSolverDir)) {
      if (name.startsWith(".tmp-") && name.endsWith(".js")) {
        tmpFiles.push(`shared-solver/${name}`);
      }
    }
  }

  let failed = false;
  if (missing.length > 0) {
    failed = true;
    console.error("Solver manifest missing lib modules:");
    for (const filePath of missing) console.error(`  - ${filePath}`);
  }
  if (stale.length > 0) {
    failed = true;
    console.error("Solver manifest points at missing files:");
    for (const filePath of stale) console.error(`  - ${filePath}`);
  }
  if (missingTests.length > 0) {
    failed = true;
    console.error("Solver manifest missing check grades:");
    for (const filePath of missingTests) console.error(`  - ${filePath}`);
  }
  if (staleTests.length > 0) {
    failed = true;
    console.error("Solver manifest points at missing tests:");
    for (const filePath of staleTests) console.error(`  - ${filePath}`);
  }
  if (invalidTests.length > 0) {
    failed = true;
    console.error("Solver manifest has invalid test metadata:");
    for (const issue of invalidTests) console.error(`  - ${issue}`);
  }
  if (tmpFiles.length > 0) {
    console.log(`Note: ${tmpFiles.length} shared-solver/.tmp-*.js archive candidates present (gitignored).`);
  }

  if (failed) {
    console.error("");
    console.error("Refresh with: node shared-solver/scripts/generate-solver-manifest.js");
    process.exit(1);
  }

  console.log(
    `Solver manifest check passed (${moduleKeys.size} modules, ${Object.keys(testEntries).length} graded tests).`,
  );
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--check-no-tower-solver-js")) {
    checkNoTowerSolverJs();
    return;
  }
  if (args.has("--check-manifest")) {
    checkSolverManifest();
    return;
  }

  fs.mkdirSync(docsDir, { recursive: true });
  const rows = collectInventory();
  writeInventory(rows);
  writeEntrypoints(rows);
  if (args.has("--refresh-legacy-baseline") || !fs.existsSync(legacyBaselinePath)) {
    writeLegacyBaseline(rows);
    console.log(`Wrote ${relativePath(legacyBaselinePath)}`);
  } else {
    console.log(`Kept existing ${relativePath(legacyBaselinePath)}`);
  }
  console.log(`Wrote ${relativePath(inventoryPath)}`);
  console.log(`Wrote ${relativePath(entrypointsPath)}`);
  if (fs.existsSync(solverManifestPath)) {
    console.log(`Using ${relativePath(solverManifestPath)}`);
  } else {
    console.log("Warning: shared-solver/solver-manifest.json missing; categories fall back to coarse rules.");
  }
}

if (require.main === module) main();
