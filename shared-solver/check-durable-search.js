"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const d = require("./lib/durable-search");
const { acquireLock } = require("./run-durable-search");
const { createProgressServer } = require("./search-progress-server");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "durable-search-check-"));
  let server;
  try {
    const project = path.join(temp, "tower/project");
    fs.mkdirSync(path.join(project, "floors"), { recursive: true });
    const hero = { hp: 100, atk: 1, def: 0, lv: 1, exp: 0, items: {}, loc: { x: 0, y: 0, direction: "right" } };
    for (const [name, object] of Object.entries({
      data: { main: { floorIds: ["Start", "A", "B"] }, firstData: { floorId: "Start", hero, levelUp: [] }, flags: {}, values: {} },
      maps: { 87: { id: "upFloor", cls: "terrains", trigger: "changeFloor", noPass: false } },
      items: {}, enemys: {}, icons: {}, functions: {}, events: { commonEvent: {} },
    })) fs.writeFileSync(path.join(project, `${name}.js`), `var ${name}_test = ${JSON.stringify(object)};`);
    for (const id of ["Start", "A", "B"]) {
      const floor = { floorId: id, title: id, width: 3, height: 1, map: [[0, id === "A" ? 87 : 0, 0]],
        events: {}, firstArrive: [], eachArrive: [], afterBattle: {}, autoEvent: {},
        changeFloor: id === "A" ? { "1,0": { floorId: "B", loc: [0, 0], direction: "right" } } : {} };
      fs.writeFileSync(path.join(project, "floors", `${id}.js`), `main.floors.${id} = ${JSON.stringify(floor)};`);
    }
    const config = { title: "Synthetic durability gate", initial: { floorId: "A", hero, inventory: { greenKey: 30 }, flags: {} },
      allowedFloors: ["A", "B"], protectedItems: ["greenKey"], stages: [{ floorId: "B" }],
      budgets: [{ expansions: 100, runtimeMs: 5000 }], candidateLimit: 4, heapMb: 256, maxRssMb: 512, maxRuntimeMs: 10000 };
    d.validateConfig(config);
    assert.throws(() => d.validateConfig({ ...config, maxRuntimeMs: 0 }));
    assert(d.protectedCost({ requirements: { greenKey: 1 } }, config));
    assert(!d.protectedCost({ requirements: {} }, config));
    assert.throws(() => d.assertProtected({ inventory: { greenKey: 30 } }, { inventory: { greenKey: 29 } }, config));
    const runDir = path.join(temp, "run");
    fs.mkdirSync(runDir);
    const release = acquireLock(runDir);
    assert.throws(() => acquireLock(runDir), /already active/);
    release();
    const configFile = path.join(temp, "config.json");
    d.atomicJson(configFile, config);
    const args = [path.join(__dirname, "run-durable-search.js"), `--config=${configFile}`, `--tower-root=${path.dirname(project)}`, `--run-dir=${runDir}`];
    const child = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30000 });
    assert.equal(child.status, 0, `${child.stderr}\n${fs.existsSync(path.join(runDir, "worker.log")) ? fs.readFileSync(path.join(runDir, "worker.log"), "utf8") : ""}`);
    const journal = d.readJson(path.join(runDir, "journal.json"));
    assert.equal(journal.state, "verified_route", JSON.stringify(journal.history));
    assert.equal(journal.initial.floorId, "A");
    assert.equal(journal.initial.inventory.greenKey, 30);
    assert.equal(journal.best.strictReplay, true);
    assert.equal(journal.best.optimalityProven, false);
    const record = d.readJson(path.join(runDir, "verified.route.json"));
    assert.equal(record.final.floorId, "B");
    assert(record.decisions.length > 0);
    assert(!JSON.stringify(record.rawRoute).includes("@Start:"));
    const again = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30000 });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(d.readJson(path.join(runDir, "journal.json")).completedAttempts, journal.completedAttempts);
    assert.throws(() => d.recoverJournal(journal, "tampered"), /identity mismatch/);
    const resumed = d.recoverJournal({ ...journal, state: "running", nodes: [{ id: "x", status: "searched" }, { id: "y", status: "running" }] }, journal.identity);
    assert.equal(resumed.nodes[0].status, "searched");
    assert.equal(resumed.nodes[1].status, "pending");
    const staged = { ...config, stages: [{ floorId: "B" }, { floorId: "B" }] };
    d.atomicJson(configFile, staged);
    const stagedDir = path.join(temp, "staged");
    const stagedArgs = [...args.slice(0, -1), `--run-dir=${stagedDir}`];
    const paused = spawnSync(process.execPath, [...stagedArgs, "--attempt-limit=1"], { encoding: "utf8", timeout: 30000 });
    assert.equal(paused.status, 0, paused.stderr);
    assert.equal(d.readJson(path.join(stagedDir, "journal.json")).state, "paused");
    assert.equal(d.readJson(path.join(stagedDir, "journal.json")).completedAttempts, 1);
    const continued = spawnSync(process.execPath, stagedArgs, { encoding: "utf8", timeout: 30000 });
    assert.equal(continued.status, 0, continued.stderr);
    const resumedJournal = d.readJson(path.join(stagedDir, "journal.json"));
    assert.equal(resumedJournal.state, "verified_route");
    assert.equal(resumedJournal.completedAttempts, 2);
    assert.equal(d.readJson(path.join(stagedDir, "verified.route.json")).final.exactStateKey, record.final.exactStateKey);
    const negative = { ...config, stages: [{ floorId: "Missing" }] };
    d.atomicJson(configFile, negative);
    const negativeDir = path.join(temp, "negative");
    const miss = spawnSync(process.execPath, [...args.slice(0, -1), `--run-dir=${negativeDir}`], { encoding: "utf8", timeout: 30000 });
    assert.equal(miss.status, 0, miss.stderr);
    assert.equal(d.readJson(path.join(negativeDir, "journal.json")).state, "bounded_not_found");
    assert(!fs.existsSync(path.join(negativeDir, "verified.route.json")));
    server = createProgressServer(runDir);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${url}/api/status`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).state, "verified_route");
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${url}/%2e%2e/config.json`)).status, 404);
    const foreignHost = await new Promise((resolve, reject) => {
      require("node:http").get(url, { headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
    });
    assert.equal(foreignHost, 403);
    assert((await (await fetch(url)).text()).includes("textContent"));
    console.log("PASS durable-search: real DP + strict replay; input isolation; zero-spend guards; journal resume/identity; single writer; bounded MISS; read-only HTTP/security");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
