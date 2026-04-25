"use strict";

const fs = require("fs");
const path = require("path");
const { readRouteFile } = require("./lib/route-store");

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function primitiveDiff(before, after, prefix, rows) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    keys.forEach((key) => primitiveDiff(before[key], after[key], prefix ? `${prefix}.${key}` : key, rows));
    return;
  }
  rows.push({ path: prefix || "root", before, after });
}

function diffRows(before, after) {
  const rows = [];
  primitiveDiff(before || {}, after || {}, "", rows);
  return rows.slice(0, 200);
}

function targetText(decision) {
  const target = decision.target || {};
  if (target.x == null || target.y == null) return decision.floorId || "";
  return `${target.floorId || decision.floorId || ""} ${target.x},${target.y}`;
}

function overview(route) {
  const hero = (((route.final || {}).snapshot || {}).hero) || {};
  return `
    <section>
      <h2>Overview</h2>
      <dl>
        <dt>Created</dt><dd>${escapeHtml(route.createdAt)}</dd>
        <dt>Project</dt><dd>${escapeHtml((route.source || {}).projectTitle)}</dd>
        <dt>Solver</dt><dd>${escapeHtml((route.source || {}).solver)} / ${escapeHtml((route.source || {}).profile)} / rank=${escapeHtml((route.source || {}).rank)}</dd>
        <dt>Goal</dt><dd>${escapeHtml((route.goal || {}).type)} ${escapeHtml((route.goal || {}).floorId)}</dd>
        <dt>Stats</dt><dd>expanded=${escapeHtml((route.stats || {}).expanded)} generated=${escapeHtml((route.stats || {}).generated)} depth=${escapeHtml((route.stats || {}).depth)}</dd>
        <dt>Final Hero</dt><dd>floor=${escapeHtml((route.final || {}).floorId)} hp=${escapeHtml(hero.hp)} atk=${escapeHtml(hero.atk)} def=${escapeHtml(hero.def)} mdef=${escapeHtml(hero.mdef)}</dd>
      </dl>
    </section>`;
}

function decisionTable(route) {
  const rows = (route.decisions || []).map((decision) => `
    <tr>
      <td>${escapeHtml(decision.index)}</td>
      <td>${escapeHtml(decision.kind)}</td>
      <td>${escapeHtml(decision.floorId || ((decision.target || {}).floorId) || "")}</td>
      <td>${escapeHtml(targetText(decision))}</td>
      <td>${escapeHtml((decision.path || []).join(","))}</td>
      <td><code>${escapeHtml(decision.fingerprint)}</code></td>
    </tr>`).join("");
  return `
    <section>
      <h2>Decision Table</h2>
      <table><thead><tr><th>#</th><th>Kind</th><th>Floor</th><th>Target</th><th>Path</th><th>Fingerprint</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
}

function stepDetails(route) {
  return (route.decisions || []).map((decision) => {
    const rows = diffRows(decision.preSnapshot, decision.postSnapshot).map((row) => `
      <tr><td>${escapeHtml(row.path)}</td><td><pre>${json(row.before)}</pre></td><td><pre>${json(row.after)}</pre></td></tr>`).join("");
    return `
      <details>
        <summary>#${escapeHtml(decision.index)} ${escapeHtml(decision.kind)} ${escapeHtml(decision.summary)}</summary>
        <h3>Structured Action</h3>
        <pre>${json({
          kind: decision.kind,
          floorId: decision.floorId,
          stance: decision.stance,
          target: decision.target,
          path: decision.path,
          direction: decision.direction,
          tool: decision.tool,
          equipId: decision.equipId,
          enemyId: decision.enemyId,
          itemId: decision.itemId,
          doorId: decision.doorId,
          changeFloor: decision.changeFloor,
          estimate: decision.estimate,
          fingerprint: decision.fingerprint,
        })}</pre>
        <h3>Snapshot Diff</h3>
        <table><thead><tr><th>Path</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>
      </details>`;
  }).join("");
}

function render(route) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Route Report ${escapeHtml((route.goal || {}).floorId || "")}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 24px; color: #1f2933; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
th, td { border: 1px solid #d9e2ec; padding: 6px 8px; vertical-align: top; }
th { background: #f0f4f8; text-align: left; }
code, pre { background: #f5f7fa; border-radius: 4px; }
pre { padding: 8px; overflow: auto; max-height: 280px; }
details { border: 1px solid #d9e2ec; border-radius: 6px; padding: 10px 12px; margin: 12px 0; }
summary { cursor: pointer; font-weight: 600; }
dt { font-weight: 700; float: left; clear: left; width: 120px; }
dd { margin-left: 140px; }
</style>
</head>
<body>
<h1>Route Report</h1>
${overview(route)}
${decisionTable(route)}
<section><h2>Steps</h2>${stepDetails(route)}</section>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["route-file"]) throw new Error("Missing --route-file=...");
  if (!args.out) throw new Error("Missing --out=...");
  const route = readRouteFile(path.resolve(process.cwd(), args["route-file"]));
  const outPath = path.resolve(process.cwd(), args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, render(route), "utf8");
  console.log(`Route report written: ${outPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
