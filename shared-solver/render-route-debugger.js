"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseKeyValueArgs } = require("./lib/cli-options");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function defaultOutFile(timelineFile) {
  const base = path.basename(timelineFile, ".timeline.json");
  return path.resolve(path.dirname(timelineFile), `${base}.html`);
}

function relativeAssetBase(timeline, outFile) {
  const projectRoot = timeline && timeline.source && timeline.source.projectRoot;
  if (!projectRoot) return "assets";
  const projectDir = path.join(projectRoot, "project");
  const relative = path.relative(path.dirname(outFile), projectDir) || ".";
  return toPosixPath(relative);
}

function embeddedJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function renderHtml(timeline, options) {
  const config = options || {};
  const assetBase = toPosixPath(config.assetBase || "assets");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Route Debugger</title>
  <style>
    :root {
      --bg: #111315;
      --panel: #1b2025;
      --panel2: #222831;
      --line: #35404b;
      --text: #eef3f7;
      --muted: #9ca9b5;
      --gain: #2e8f61;
      --loss: #b84545;
      --hero: #2f80ed;
      --target: #d7a928;
      --removed: #4b5563;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      background: #15191d;
      position: sticky;
      top: 0;
      z-index: 5;
    }
    header h1 { font-size: 15px; margin: 0; font-weight: 650; }
    button, input {
      background: var(--panel2);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 6px 8px;
      font: inherit;
    }
    button { cursor: pointer; min-width: 34px; }
    input[type="range"] { flex: 1; padding: 0; min-width: 180px; }
    input[type="number"] { width: 84px; }
    main {
      display: grid;
      grid-template-columns: 300px minmax(480px, 1fr) 420px;
      gap: 12px;
      padding: 12px;
      align-items: start;
    }
    .leftCol, .centerCol, .rightCol {
      display: grid;
      gap: 12px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      min-width: 0;
    }
    .panel h2 {
      margin: 0;
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      font-weight: 650;
    }
    .panelBody { padding: 10px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .mapWrap { overflow: auto; padding: 8px 0 2px; }
    table.map {
      border-collapse: collapse;
      margin: 0 auto;
      table-layout: fixed;
    }
    .map td {
      width: 42px;
      height: 42px;
      border: 1px solid #2f3843;
      text-align: center;
      vertical-align: middle;
      font-size: 10px;
      color: #dbe5ed;
      position: relative;
      background-color: #20262d;
      overflow: hidden;
    }
    .map td.enemy { background: #553034; }
    .map td.item { background: #254b38; }
    .map td.door { background: #594f2f; }
    .map td.portal { background: #2f4359; }
    .map td.wall { background: #33413b; }
    .map td.removed { filter: grayscale(1); opacity: .48; color: #c1cad2; }
    .map td.hero { outline: 3px solid var(--hero); outline-offset: -3px; }
    .map td.target { box-shadow: inset 0 0 0 3px var(--target); }
    .cellName {
      position: absolute;
      left: 1px;
      right: 1px;
      bottom: 1px;
      background: rgba(0, 0, 0, .58);
      color: #f2f6fa;
      font-size: 9px;
      line-height: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 2px;
      text-shadow: 0 1px 1px #000;
    }
    .cellXY { position: absolute; top: 1px; right: 2px; color: #a9b5c0; font-size: 8px; text-shadow: 0 1px 1px #000; }
    .damageBadge {
      position: absolute;
      left: 2px;
      top: 1px;
      min-width: 14px;
      padding: 0 2px;
      border-radius: 3px;
      background: rgba(0, 0, 0, .72);
      color: #ffd84d;
      font-weight: 750;
      font-size: 10px;
      line-height: 12px;
      text-shadow: 0 1px 1px #000;
      pointer-events: none;
    }
    .damageBadge.lethal { color: #ff5b5b; }
    .damageBadge.zero { color: #7cf59b; }
    .damageBadge.unsupported { color: #ff6fcf; }
    .heroMark {
      position: absolute;
      left: 5px;
      top: -2px;
      width: 32px;
      height: 42px;
      background-image: url("${assetBase}/images/hero.png");
      background-repeat: no-repeat;
      background-position: 0 0;
      background-size: 112px 168px;
      filter: drop-shadow(0 0 4px #63a4ff);
      pointer-events: none;
    }
    .tileSprite {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 32px;
      height: 32px;
      transform: translate(-50%, -50%);
      background-repeat: no-repeat;
      image-rendering: pixelated;
      pointer-events: none;
    }
    .tileSprite.tall {
      height: 42px;
      top: 46%;
    }
    .summary {
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      overflow-wrap: anywhere;
      color: #dce7f0;
    }
    .kv {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }
    .kv div {
      background: #151a1f;
      border: 1px solid #2c3540;
      border-radius: 4px;
      padding: 5px 6px;
    }
    .kv b { display: block; color: var(--muted); font-weight: 500; font-size: 11px; }
    .list {
      max-height: 540px;
      overflow: auto;
      border-top: 1px solid var(--line);
    }
    .routeRow {
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: 6px;
      padding: 6px 9px;
      border-bottom: 1px solid #2b333d;
      cursor: pointer;
    }
    .routeRow:hover, .routeRow.active { background: #29323b; }
    .routeRow code { color: #dce7f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actionBox {
      display: grid;
      gap: 8px;
    }
    .actionBox .summary {
      background: #151a1f;
      border: 1px solid #2c3540;
      border-radius: 4px;
      padding: 8px;
    }
    .nameLine {
      display: grid;
      grid-template-columns: 84px 1fr;
      gap: 6px;
      padding: 4px 0;
      border-bottom: 1px solid #2c3540;
    }
    .nameLine b { color: var(--muted); font-weight: 500; }
    .muted { color: var(--muted); }
    .diffTable {
      width: 100%;
      border-collapse: collapse;
    }
    .diffTable th, .diffTable td {
      border-bottom: 1px solid #2c3540;
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
    }
    .diffTable th { color: var(--muted); font-weight: 600; }
    .deltaPos { color: #74d39b; }
    .deltaNeg { color: #f08b8b; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      color: #dce7f0;
    }
    @media (max-width: 1180px) {
      main { grid-template-columns: 1fr; }
      header { flex-wrap: wrap; }
      input[type="range"] { flex-basis: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Route Debugger</h1>
    <button id="prev">Prev</button>
    <button id="next">Next</button>
    <input id="slider" type="range" min="0" value="0">
    <label>Step <input id="stepInput" type="number" min="0" value="0"></label>
    <span id="stepCount" class="muted"></span>
  </header>
  <main>
    <div class="leftCol">
      <section class="panel">
        <h2>主角属性</h2>
        <div id="hero" class="panelBody kv"></div>
      </section>
      <section class="panel">
        <h2>背包</h2>
        <div class="panelBody"><pre id="inventory"></pre></div>
      </section>
      <section class="panel">
        <h2>Flags</h2>
        <div class="panelBody"><pre id="flags"></pre></div>
      </section>
    </div>
    <div class="centerCol">
      <section class="panel">
        <h2>地图</h2>
        <div class="panelBody">
          <div id="stepSummary" class="summary"></div>
          <p id="floorLine" class="muted"></p>
          <div id="map" class="mapWrap"></div>
        </div>
      </section>
      <section class="panel">
        <h2>State Keys</h2>
        <div class="panelBody">
          <pre id="keys"></pre>
        </div>
      </section>
    </div>
    <div class="rightCol">
      <section class="panel">
        <h2>当前 Action</h2>
        <div id="actionDetails" class="panelBody actionBox"></div>
      </section>
      <section class="panel">
        <h2>Step Diff</h2>
        <div id="diff" class="panelBody"></div>
      </section>
      <aside class="panel">
        <h2>Route Actions</h2>
        <div id="routeList" class="list"></div>
      </aside>
    </div>
  </main>
  <script id="timeline-json" type="application/json">${embeddedJson(timeline)}</script>
  <script>
    const timeline = JSON.parse(document.getElementById("timeline-json").textContent);
    const steps = timeline.steps || [];
    const slider = document.getElementById("slider");
    const input = document.getElementById("stepInput");
    const routeList = document.getElementById("routeList");
    slider.max = Math.max(0, steps.length - 1);
    input.max = Math.max(0, steps.length - 1);
    document.getElementById("stepCount").textContent = "/ " + Math.max(0, steps.length - 1);

    function text(value) {
      if (value == null) return "";
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    }

    function pretty(value) {
      return JSON.stringify(value || {}, null, 2);
    }

    function esc(value) {
      return text(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function mutationSets(step) {
      const floor = (step && step.currentFloorMutation) || {};
      const removed = new Set(floor.removed || []);
      const replaced = new Map();
      (floor.replaced || []).forEach((entry) => {
        const match = /^(\\d+,\\d+)=(.+)$/.exec(String(entry));
        if (match) replaced.set(match[1], match[2]);
      });
      return { removed, replaced };
    }

    function tileLabel(tile, tileId) {
      if (!tile && !tileId) return "";
      if (!tile) return tileId || "";
      return tile.name || tile.id || tileId || "";
    }

    function assetUrl(sprite) {
      if (!sprite || !sprite.sheet) return "";
      return "${assetBase}/" + sprite.sheet;
    }

    function spriteStyle(tile) {
      const sprite = tile && tile.sprite;
      if (!sprite) return "";
      return "background-image:url('" + assetUrl(sprite).replace(/'/g, "%27") + "');" +
        "background-position:-" + Number(sprite.x || 0) + "px -" + Number(sprite.y || 0) + "px;";
    }

    function spriteHtml(tile) {
      if (!tile || !tile.sprite) return "";
      const tall = Number(tile.sprite.height || 32) > 32 ? " tall" : "";
      return '<span class="tileSprite' + tall + '" style="' + esc(spriteStyle(tile)) + '"></span>';
    }

    function tileAt(step, x, y) {
      const floor = timeline.map.floors[step.floorId];
      if (!floor) return null;
      const key = x + "," + y;
      const { removed, replaced } = mutationSets(step);
      const tileId = replaced.has(key) ? replaced.get(key) : floor.map[y][x];
      return {
        key,
        removed: removed.has(key),
        tileId,
        tile: timeline.map.tiles[tileId] || null,
      };
    }

    function battleInfoAt(step, key) {
      const overlay = step.battleOverlay || {};
      return (overlay.enemies || {})[key] || null;
    }

    function damageClass(info) {
      if (!info) return "";
      if (!info.supported) return " unsupported";
      if (info.lethal) return " lethal";
      if (Number(info.damage || 0) === 0) return " zero";
      return "";
    }

    function damageHtml(info) {
      if (!info) return "";
      return '<span class="damageBadge' + damageClass(info) + '" title="' + esc(info.name + " damage=" + info.display) + '">' + esc(info.display) + '</span>';
    }

    function tileClass(tile) {
      const cls = String((tile && tile.cls) || "");
      if (cls.indexOf("enemy") === 0 || cls === "enemys") return "enemy";
      if (cls === "items") return "item";
      if (tile && tile.wallLike) return "wall";
      if (cls.indexOf("door") >= 0) return "door";
      if (cls.indexOf("portal") >= 0 || cls.indexOf("stairs") >= 0) return "portal";
      return "";
    }

    function renderMap(step) {
      const floor = timeline.map.floors[step.floorId];
      if (!floor) {
        document.getElementById("map").textContent = "No map metadata for " + step.floorId;
        return;
      }
      const { removed, replaced } = mutationSets(step);
      const hero = step.loc || {};
      const target = step.target || {};
      let html = '<table class="map"><tbody>';
      for (let y = 0; y < floor.height; y += 1) {
        html += "<tr>";
        for (let x = 0; x < floor.width; x += 1) {
          const info = tileAt(step, x, y);
          const key = info.key;
          const isRemoved = info.removed;
          const tileId = info.tileId;
          const tile = info.tile;
          const battle = battleInfoAt(step, key);
          const classes = [tileClass(tile)];
          if (isRemoved) classes.push("removed");
          if (Number(hero.x) === x && Number(hero.y) === y) classes.push("hero");
          if ((target.floorId || step.floorId) === step.floorId && Number(target.x) === x && Number(target.y) === y) classes.push("target");
          const label = isRemoved ? "已移除" : tileLabel(tile, tileId);
          html += '<td class="' + classes.filter(Boolean).join(" ") + '" title="' + esc(key + " " + label + " " + text(tile && tile.id)) + '">';
          if (!isRemoved) html += spriteHtml(tile);
          if (!isRemoved) html += damageHtml(battle);
          if (Number(hero.x) === x && Number(hero.y) === y) html += '<span class="heroMark"></span>';
          html += '<span class="cellName">' + esc(label) + '</span><span class="cellXY">' + esc(key) + '</span></td>';
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      document.getElementById("map").innerHTML = html;
    }

    function renderHero(step) {
      const hero = step.hero || {};
      const fields = ["hp", "hpmax", "atk", "def", "mdef", "money", "exp", "lv", "mana", "manamax"];
      document.getElementById("hero").innerHTML = fields.map((field) =>
        "<div><b>" + esc(field) + "</b>" + esc(hero[field]) + "</div>"
      ).join("") + "<div><b>loc</b>" + esc(hero.loc) + "</div>";
    }

    function currentTargetInfo(step) {
      const target = step.target || {};
      if ((target.floorId || step.floorId) !== step.floorId) return null;
      if (target.x == null || target.y == null) return null;
      return tileAt(step, Number(target.x), Number(target.y));
    }

    function renderActionDetails(step) {
      const action = step.action || {};
      const targetInfo = currentTargetInfo(step);
      const tile = targetInfo && targetInfo.tile;
      const battle = targetInfo && battleInfoAt(step, targetInfo.key);
      const lines = [
        ["index", step.index],
        ["kind", action.kind || ""],
        ["floor", step.floorId],
        ["target", step.target || ""],
        ["目标中文名", tileLabel(tile, targetInfo && targetInfo.tileId)],
        ["目标 id", tile && tile.id],
        ["目标 cls", tile && tile.cls],
        ["目标伤害", battle ? battle.display : ""],
        ["可击杀", battle ? (battle.supported && !battle.lethal ? "yes" : "no") : ""],
      ];
      document.getElementById("actionDetails").innerHTML =
        '<div class="summary">' + esc(step.summary) + '</div>' +
        lines.map(([key, value]) => '<div class="nameLine"><b>' + esc(key) + '</b><span>' + esc(value) + '</span></div>').join("");
    }

    function rowValue(value) {
      if (value == null) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }

    function renderDiffRows(rows) {
      return (rows || []).map((row) => {
        const delta = row.delta == null ? "" : row.delta;
        const cls = Number(delta) > 0 ? "deltaPos" : (Number(delta) < 0 ? "deltaNeg" : "");
        const key = row.floorId ? row.floorId + "." + row.key : row.key;
        const before = row.added || row.removed
          ? "count " + row.beforeCount
          : rowValue(row.before);
        const after = row.added || row.removed
          ? "count " + row.afterCount + " +" + JSON.stringify(row.added || []) + " -" + JSON.stringify(row.removed || [])
          : rowValue(row.after);
        return "<tr><td>" + esc(row.category) + "</td><td>" + esc(key) + "</td><td>" + esc(before) + "</td><td>" + esc(after) + "</td><td class=\\"" + cls + "\\">" + esc(delta) + "</td></tr>";
      }).join("");
    }

    function renderDiff(step) {
      const delta = step.delta || {};
      const rows = []
        .concat(delta.hero || [])
        .concat(delta.inventory || [])
        .concat(delta.flags || [])
        .concat(delta.floors || []);
      if (!rows.length) {
        document.getElementById("diff").innerHTML = '<p class="muted">No diff for this step.</p>';
        return;
      }
      document.getElementById("diff").innerHTML = '<table class="diffTable"><thead><tr><th>Category</th><th>Key</th><th>Before</th><th>After</th><th>Delta</th></tr></thead><tbody>' + renderDiffRows(rows) + '</tbody></table>';
    }

    function renderRouteList(activeIndex) {
      routeList.innerHTML = steps.map((step, index) =>
        '<div class="routeRow ' + (index === activeIndex ? "active" : "") + '" data-step="' + index + '"><span class="muted">#' + index + '</span><code>' + esc(step.summary) + '</code></div>'
      ).join("");
    }

    function setStep(index) {
      const bounded = Math.max(0, Math.min(Number(index) || 0, steps.length - 1));
      const step = steps[bounded];
      slider.value = bounded;
      input.value = bounded;
      document.getElementById("stepSummary").textContent = "#" + bounded + " " + text(step.summary);
      document.getElementById("floorLine").textContent = "floor=" + step.floorId + " target=" + text(step.target || null);
      renderMap(step);
      renderHero(step);
      renderActionDetails(step);
      document.getElementById("inventory").textContent = pretty(step.inventory);
      document.getElementById("flags").textContent = pretty(step.flagsSummary);
      document.getElementById("keys").textContent = "stateKey:\\n" + step.stateKey + "\\n\\ndominanceKey:\\n" + step.dominanceKey + "\\n\\nrouteTail:\\n" + pretty(step.routeTail);
      renderDiff(step);
      renderRouteList(bounded);
    }

    slider.addEventListener("input", () => setStep(slider.value));
    input.addEventListener("change", () => setStep(input.value));
    document.getElementById("prev").addEventListener("click", () => setStep(Number(input.value) - 1));
    document.getElementById("next").addEventListener("click", () => setStep(Number(input.value) + 1));
    routeList.addEventListener("click", (event) => {
      const row = event.target.closest(".routeRow");
      if (row) setStep(row.getAttribute("data-step"));
    });
    setStep(0);
  </script>
</body>
</html>
`;
}

function main() {
  const args = parseKeyValueArgs(process.argv.slice(2));
  const timelineFile = args.timeline ? path.resolve(process.cwd(), args.timeline) : null;
  if (!timelineFile) throw new Error("Missing --timeline=<file>.");
  const outFile = path.resolve(process.cwd(), args.out || defaultOutFile(timelineFile));
  const timeline = readJson(timelineFile);
  if (!timeline || timeline.schema !== "motapathfinder.routeTimeline.v1") {
    throw new Error(`Unsupported timeline schema in ${timelineFile}`);
  }
  writeText(outFile, renderHtml(timeline, {
    assetBase: args["asset-base"] || relativeAssetBase(timeline, outFile),
  }));
  console.log(`Route debugger HTML written: ${outFile}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  renderHtml,
};
