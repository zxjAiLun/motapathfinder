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
    assert.throws(() => d.validateConfig({ ...config, maxRuntimeMs: -1 }));
    assert.throws(() => d.validateConfig({ ...config, heapMb: 0 }));
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
    // Verify render-only search preview projection & persistence contract
    // 1. Projection stripping: must contain render fields, must NOT contain route/trace/nodes/caches
    const mockState = {
      floorId: "A",
      hero: { hp: 100, atk: 1, def: 0, lv: 1, exp: 0, loc: { x: 1, y: 0, direction: "right" } },
      inventory: { greenKey: 30 },
      flags: { testFlag: 1 },
      route: ["step1", "step2"],
      trace: ["trace1"],
      nodes: new Map(),
      floorStates: { A: { removed: { "1,0": true }, replaced: {} } },
    };
    const preview = d.buildSearchPreview({
      task: { id: "0-task-preview", stage: 0, tier: 0 },
      stageGoal: { floorId: "B" },
      state: mockState,
      stoppedReason: "heap-limit",
      progressProjection: { feasible: true, floorMatch: false, completion: 0.5 },
    });
    assert.equal(preview.schema, d.SEARCH_PREVIEW_SCHEMA);
    assert.equal(preview.kind, "progress-preview");
    assert.equal(preview.stoppedReason, "heap-limit");
    assert.equal(preview.entryCheckpointId, "0-task-preview");
    assert.ok(preview.previewStateFingerprint, "previewStateFingerprint must be populated");
    assert.equal(preview.renderState.floorId, "A");
    assert.equal(preview.renderState.hero.hp, 100);
    assert.equal(preview.renderState.floorStates.A.removed["1,0"], true);
    assert.equal(preview.renderState.route, undefined, "route must NOT be leaked into render preview");
    assert.equal(preview.renderState.trace, undefined, "trace must NOT be leaked into render preview");
    assert.equal(preview.renderState.nodes, undefined, "search nodes must NOT be leaked into render preview");

    // 2. Integration and persistence: preview.json and previews/<id>.preview.json are written
    const mockJournal = d.newJournal("ident", config, mockState);
    const mockTask = d.pickTask(mockJournal);
    d.integrate(mockJournal, mockTask, {
      candidates: [],
      stats: { expansions: 50, frontierSize: 10, stoppedReason: "heap-limit", searchComplete: false, foundGoal: false },
      verified: null,
      bestProgressPreview: preview,
    }, config, runDir);

    assert.equal(mockJournal.state, "ready", "heap-limited attempt must NOT declare verified route");
    assert.ok(fs.existsSync(path.join(runDir, "preview.json")), "preview.json must exist");
    assert.ok(fs.existsSync(path.join(runDir, "previews", `${mockTask.id}.preview.json`)), "task preview must exist");
    const savedPreview = d.readJson(path.join(runDir, "preview.json"));
    assert.equal(savedPreview.stoppedReason, "heap-limit");
    assert.equal(savedPreview.renderState.hero.hp, 100);

    // 3. Progress server API delivers preview and falls back cleanly for old tasks
    const rPrev = await fetch(`${url}/api/preview`);
    assert.equal(rPrev.status, 200);
    const prevJson = await rPrev.json();
    assert.equal(prevJson.preview.stoppedReason, "heap-limit");

    // Contract: old task with base state in states/ but no preview file must fall back cleanly to entry
    const oldTaskId = "0-old-task-fallback";
    d.atomicJson(path.join(runDir, "states", `${oldTaskId}.json`), mockState);
    const rFallback = await fetch(`${url}/api/view-state?id=${oldTaskId}&mode=preview`);
    assert.equal(rFallback.status, 200);
    const fallbackJson = await rFallback.json();
    assert.equal(fallbackJson.viewType, "entry", "must cleanly fall back to entry when preview is absent");
    assert.equal(fallbackJson.hasPreview, false, "hasPreview must be false when preview is absent");
    assert.equal(fallbackJson.state.floorId, "A");

    const rOldTask = await fetch(`${url}/api/view-state?id=non-existent-task`);
    assert.equal(rOldTask.status, 404, "non-existent task must return 404");

    // 4. Problem contract hardening: altering stages/initial/protected items in config throws on recovery
    const savedJournal = d.readJson(path.join(runDir, "journal.json"));
    const corruptedConfig = { ...config, stages: [{ floorId: "CorruptedStage" }] };
    assert.throws(
      () => d.recoverJournal(savedJournal, d.identityOf(corruptedConfig, path.dirname(project)), { config: corruptedConfig, towerRoot: path.dirname(project) }),
      /problem contract mismatch/
    );

    // 5. Worker identity drift guard: child worker rejects mismatched expectedExecutionIdentity
    const driftSpecPath = path.join(temp, "drift-task.json");
    d.atomicJson(driftSpecPath, {
      config,
      towerRoot: path.dirname(project),
      dir: runDir,
      task: mockTask,
      output: path.join(temp, "drift-out.json"),
      expectedExecutionIdentity: "fake-unmatched-parent-identity",
    });
    const workerDriftRun = spawnSync(process.execPath, [path.join(__dirname, "run-durable-search.js"), `--worker=${driftSpecPath}`], { encoding: "utf8" });
    assert.notEqual(workerDriftRun.status, 0, "worker must fail-closed on identity drift");
    assert(workerDriftRun.stderr.includes("WORKER_IDENTITY_DRIFT"), "error must mention WORKER_IDENTITY_DRIFT");

    console.log("PASS durable-search: real DP + strict replay; input isolation; zero-spend guards; journal resume/identity; single writer; bounded MISS; render-only progress-preview; worker-drift-guard; read-only HTTP/security");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
