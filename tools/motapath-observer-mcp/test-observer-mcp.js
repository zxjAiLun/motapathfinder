"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const { TOOL_DEFINITIONS } = require("./lib/tool-definitions");
const core = require("./lib/observer-core");
const security = require("./lib/path-security");
const provenance = require("./lib/provenance");
const { createHttpServer, handleJsonRpc } = require("./server");

async function createTestEnvironment() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "motapath-observer-test-"));
  const runsRoot = path.join(tempDir, "runs");
  const runDir = path.join(runsRoot, "neko-zero-key");
  const releasesRoot = path.join(tempDir, "releases");
  const releaseDir = path.join(releasesRoot, "20260920-release-test");

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, "states"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "previews"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "tasks"), { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  // 1. Create synthetic status.json
  const status = {
    title: "纳可物语 · 试炼诊断",
    state: "paused",
    heartbeatAt: "2026-09-20T12:00:00.000Z",
    completedAttempts: 160,
    totalExpansions: 6757300,
    candidates: 53,
    pending: 27,
    current: null,
    telemetry: {
      expansions: 8000,
      frontierSize: 505,
      floorId: "TS12",
      rssMb: 844.7,
    },
    limits: {
      heapMb: 5222,
      maxRssMb: 8192,
    },
  };
  fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify(status, null, 2));

  // 2. Create synthetic journal.json with 34 TS13 nodes (all ATK 6, DEF 0)
  const nodes = [
    {
      id: "0-root",
      stage: 0,
      tier: 3,
      status: "searched",
      summary: { floorId: "TS11", hp: 100, atk: 1, def: 0, lv: 1, exp: 0, loc: { x: 6, y: 1 } },
    },
  ];

  // Stage 1 nodes
  for (let i = 0; i < 18; i++) {
    nodes.push({
      id: `1-node-${i}`,
      parent: "0-root",
      stage: 1,
      tier: 2,
      status: "searched",
      summary: { floorId: "TS12", hp: 900 + i * 5, atk: 4, def: 0, lv: 2, exp: 1, loc: { x: 6, y: 12 } },
    });
  }

  // Stage 2 nodes: EXACTLY 34 nodes, all ATK 6, DEF 0
  for (let i = 0; i < 34; i++) {
    nodes.push({
      id: `2-node-${i.toString().padStart(2, "0")}`,
      parent: `1-node-${i % 18}`,
      stage: 2,
      tier: i < 12 ? 3 : 0,
      status: i < 12 ? "bounded" : "pending",
      summary: {
        floorId: "TS13",
        hp: 1300 + i * 2,
        atk: 6,
        def: 0,
        lv: 2,
        exp: 17,
        loc: { x: 6, y: 12 },
      },
    });
  }

  const history = [
    {
      id: "0-root",
      stage: 0,
      tier: 0,
      expansions: 8000,
      frontierSize: 505,
      stoppedReason: "expansion-limit",
      searchComplete: false,
      foundGoal: true,
      candidateCount: 16,
      actionTrimmed: 0,
      archiveTrimmed: true,
      time: "2026-09-19T12:14:55.683Z",
      diagnostics: {
        dp: {
          keys: 1471,
          goalSkylineLimit: 16,
          goalArchiveTrimmed: true,
          goalArchiveEvictedCount: 875,
          activeGoalCount: 708,
          memory: {
            peakHeapUsedMb: 715.4,
            peakRssMb: 844.7,
            rssGcCount: 0,
          },
          statProgress: {
            maxHeroSeen: { hp: 1150, atk: 4, def: 0, mdef: 0, exp: 9 },
          },
        },
        retention: {
          acceptedNodes: 11058,
          generatedNodes: 24929,
          bestByKeySize: 1471,
        },
        confluenceDominance: {
          rejectedByHigherHp: 8674,
          sameHpRejected: 5198,
        },
      },
    },
  ];

  const journal = {
    schema: "durable-search-v1",
    identity: "synth-identity-12345",
    problemFingerprint: "prob-synth-001",
    resumeSearchFingerprint: "resume-synth-002",
    createdAt: "2026-09-19T12:00:00.000Z",
    state: "paused",
    completedAttempts: 160,
    totalExpansions: 6757300,
    nodes,
    history,
    best: null,
  };
  fs.writeFileSync(path.join(runDir, "journal.json"), JSON.stringify(journal, null, 2));

  // 3. Create a state file and preview file
  const sampleState = {
    floorId: "TS13",
    hero: { hp: 1369, atk: 6, def: 0, lv: 2, exp: 17, loc: { x: 6, y: 12 } },
    inventory: { greenKey: 34 },
    floorStates: { TS13: { removed: {}, replaced: {} } },
  };
  fs.writeFileSync(path.join(runDir, "states", "2-node-00.json"), JSON.stringify(sampleState, null, 2));

  const samplePreview = {
    schema: "motapathfinder.search-preview.v1",
    kind: "progress-preview",
    taskId: "2-node-00",
    capturedAt: "2026-09-20T12:00:00.000Z",
    stoppedReason: "expansion-limit",
    renderState: sampleState,
  };
  fs.writeFileSync(path.join(runDir, "previews", "2-node-00.preview.json"), JSON.stringify(samplePreview, null, 2));

  // 4. Create a 256k.json probe artifact with service telemetry
  const probe256k = {
    identity: "probe-256k-synth",
    expansions: 256000,
    frontierSize: 41305,
    stoppedReason: null,
    foundGoal: false,
    wallMs: 1344477,
    service: {
      TS13: {
        inserted: 40913,
        popped: 128,
        evictedPending: 12088,
        pending: 28697,
        oldestPending: 255999,
      },
      TS12: {
        inserted: 106525,
        popped: 88506,
        evictedPending: 5416,
        pending: 12603,
        oldestPending: 255963,
      },
      TS11: {
        inserted: 167371,
        popped: 167366,
        evictedPending: 0,
        pending: 5,
        oldestPending: 9,
      },
    },
    diagnostics: {
      retention: {
        nodesSize: 314809,
        bestByKeySize: 86000,
        acceptedNodes: 314809,
        rejectedNodes: 385596,
        replacedNodes: 226591,
      },
      dp: {
        keys: 86000,
        dpSkylineMax: 16,
        memory: {
          peakHeapUsedMb: 3938.7,
          peakRssMb: 4542.2,
          rssGcCount: 0,
        },
      },
    },
  };
  fs.writeFileSync(path.join(runDir, "256k.json"), JSON.stringify(probe256k, null, 2));

  // 5. Create worker.log
  const logLines = [
    "2026-09-20T12:00:01.000Z [INFO] Worker started pid=12345",
    "2026-09-20T12:00:02.000Z [TELEMETRY] expansions=1000 frontier=120 heap=512MB",
    "2026-09-20T12:00:03.000Z [TELEMETRY] expansions=8000 frontier=505 heap=715MB",
    "2026-09-20T12:00:04.000Z [STOP] Task completed reached budget",
  ];
  fs.writeFileSync(path.join(runDir, "worker.log"), logLines.join("\n") + "\n");

  // 6. Release manifest
  fs.writeFileSync(path.join(releaseDir, "bundle-manifest.json"), JSON.stringify({ "test.js": "abcdef" }, null, 2));

  const context = {
    repoRoot: tempDir,
    runsRoot,
    runDir,
    runId: "neko-zero-key",
    releaseDir,
    releaseId: "20260920-release-test",
    gitSha: "test-commit-sha-42",
  };

  return { tempDir, context };
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, rawBody: data });
        }
      });
    });
    req.on("error", reject);
    req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, rawBody: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function runTests() {
  console.log("=== Running motapath-observer-mcp Test Suite ===");
  const { tempDir, context } = await createTestEnvironment();

  try {
    // 1. Test get_runtime_status
    console.log("Test 1: get_runtime_status...");
    const statusRes = core.getRuntimeStatus(context);
    assert.equal(statusRes.service, "paused");
    assert.equal(statusRes.run_id, "neko-zero-key");
    assert.equal(statusRes.completed_attempts, 160);
    assert.equal(statusRes.total_expansions, 6757300);
    assert.equal(statusRes.solver_digest, "resume-synth-002");
    assert(statusRes._provenance != null);
    assert.equal(statusRes._provenance.run_id, "neko-zero-key");
    console.log("  PASS");

    // 2. Test list_durable_nodes and 34 TS13 hero distribution
    console.log("Test 2: list_durable_nodes (TS13 ATK=6, DEF=0 verification)...");
    const stage2Res = core.listDurableNodes(context, { stage: 2 });
    assert.equal(stage2Res.total_matching, 34);
    assert.deepEqual(stage2Res.hero_distribution.atk_distribution, { "6": 34 });
    assert.deepEqual(stage2Res.hero_distribution.def_distribution, { "0": 34 });
    assert.equal(stage2Res.hero_distribution.floor_distribution.TS13, 34);
    assert.equal(stage2Res.hero_distribution.status_distribution.bounded, 12);
    assert.equal(stage2Res.hero_distribution.status_distribution.pending, 22);
    assert.equal(stage2Res.nodes.length, 34);
    console.log("  PASS: Exactly 34 TS13 nodes verified all ATK=6 / DEF=0 in single call");

    // 3. Test pagination in list_durable_nodes
    console.log("Test 3: list_durable_nodes pagination...");
    const paged = core.listDurableNodes(context, { stage: 2, limit: 10, offset: 5 });
    assert.equal(paged.total_matching, 34);
    assert.equal(paged.returned_count, 10);
    assert.equal(paged.offset, 5);
    assert.equal(paged.nodes[0].id, "2-node-05");
    console.log("  PASS");

    // 4. Test get_durable_node
    console.log("Test 4: get_durable_node...");
    const nodeRes = core.getDurableNode(context, "2-node-00", { include_full_state: true });
    assert.equal(nodeRes.id, "2-node-00");
    assert.equal(nodeRes.summary.floorId, "TS13");
    assert.equal(nodeRes.state_file_exists, true);
    assert.equal(nodeRes.has_preview, true);
    assert.equal(nodeRes.full_state.hero.hp, 1369);
    assert.throws(() => core.getDurableNode(context, "non-existent-node"), /Node not found/);
    console.log("  PASS");

    // 5. Test get_attempt_history
    console.log("Test 5: get_attempt_history...");
    const histRes = core.getAttemptHistory(context, { stage: 0 });
    assert.equal(histRes.total_matching, 1);
    assert.equal(histRes.history[0].expansions, 8000);
    assert.equal(histRes.history[0].diagnostics_summary.uniqueKeys, 1471);
    assert.equal(histRes.history[0].diagnostics_summary.rejectedByHigherHp, 8674);
    console.log("  PASS");

    // 6. Test get_search_diagnostics (attempt and probe)
    console.log("Test 6: get_search_diagnostics...");
    const diagAttempt = core.getSearchDiagnostics(context, { task_id: "0-root" });
    assert.equal(diagAttempt.source, "attempt");
    assert.equal(diagAttempt.dp.goalSkylineLimit, 16);
    assert.equal(diagAttempt.dominance.rejectedByHigherHp, 8674);

    const diagProbe = core.getSearchDiagnostics(context, { probe_name: "256k" });
    assert.equal(diagProbe.source, "probe");
    assert.equal(diagProbe.expansions, 256000);
    assert.equal(diagProbe.frontierSize, 41305);
    assert.equal(diagProbe.memory.peakHeapUsedMb, 3938.7);
    console.log("  PASS");

    // 7. Test analyze_stage_candidates
    console.log("Test 7: analyze_stage_candidates...");
    const candAnalysis = core.analyzeStageCandidates(context, { stage: 2 });
    assert.equal(candAnalysis.stage, 2);
    assert.equal(candAnalysis.total_candidates_in_journal, 34);
    assert.deepEqual(candAnalysis.hero_distribution.atk, { "6": 34 });
    assert.deepEqual(candAnalysis.hero_distribution.def, { "0": 34 });
    assert(candAnalysis.causal_assessment.includes("identical stats: ATK=6, DEF=0"));
    assert.equal(candAnalysis.top_hp_candidates.length, 16);
    console.log("  PASS: Causal assessment identifies homogeneous candidate set");

    // 8. Test inspect_frontier_snapshot
    console.log("Test 8: inspect_frontier_snapshot...");
    const frontier = core.inspectFrontierSnapshot(context, {});
    assert.equal(frontier.active_frontier, 41305);
    assert.equal(frontier.by_floor.TS13, 28697);
    assert.equal(frontier.by_floor.TS12, 12603);
    assert.equal(frontier.by_floor.TS11, 5);
    assert.equal(frontier.service_summary.popped_by_floor.TS13, 128);
    assert.equal(frontier.service_summary.evicted_pending_by_floor.TS13, 12088);
    assert(frontier.starvation_diagnosis.includes("TS13 pop ratio is extremely low"));
    console.log("  PASS: Starvation diagnosis and queue service correctly extracted");

    // 9. Test read_artifact and json_path
    console.log("Test 9: read_artifact and json_path subkey extraction...");
    const artStatus = core.readArtifact(context, { artifact_type: "status" });
    assert.equal(artStatus.content.title, "纳可物语 · 试炼诊断");

    const artJsonPath = core.readArtifact(context, {
      artifact_type: "probe",
      id: "256k",
      json_path: "service.TS13",
    });
    assert.equal(artJsonPath.content.popped, 128);
    assert.equal(artJsonPath.content.pending, 28697);
    console.log("  PASS");

    // 10. Test read_bounded_log
    console.log("Test 10: read_bounded_log...");
    const logRes = core.readBoundedLog(context, { source: "worker", tail_lines: 2 });
    assert.equal(logRes.returned_lines, 2);
    assert(logRes.lines[1].includes("[STOP]"));

    const filteredLog = core.readBoundedLog(context, { source: "worker", pattern: "TELEMETRY" });
    assert.equal(filteredLog.returned_lines, 2);
    assert(filteredLog.lines.every((l) => l.includes("TELEMETRY")));
    console.log("  PASS");

    // 11. Security negative controls: path traversal and forbidden files
    console.log("Test 11: Security negative controls...");
    assert.throws(
      () => security.sanitizeIdentifier("../etc/passwd"),
      /path separators or traversal/
    );
    assert.throws(
      () => security.sanitizeIdentifier("..\\windows\\win.ini"),
      /path separators or traversal/
    );
    assert.throws(
      () => security.assertSafePath(path.join(tempDir, ".env"), [tempDir]),
      /blacklist/
    );
    assert.throws(
      () => security.assertSafePath(path.join(tempDir, "id_rsa"), [tempDir]),
      /blacklist/
    );
    assert.throws(
      () => security.assertSafePath("/etc/shadow", [tempDir]),
      /blacklist/
    );
    assert.throws(
      () => security.assertSafePath(path.join(os.tmpdir(), "other-random-unallowed-dir/file.json"), [tempDir]),
      /outside allowed root/
    );
    console.log("  PASS: Path traversal and sensitive file access blocked");

    // 12. JSON-RPC protocol handling
    console.log("Test 12: JSON-RPC protocol dispatcher...");
    const initRes = await handleJsonRpc(context, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    assert.equal(initRes.result.serverInfo.name, "motapath-observer-mcp");

    const toolsRes = await handleJsonRpc(context, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert.equal(toolsRes.result.tools.length, TOOL_DEFINITIONS.length);

    const callRes = await handleJsonRpc(context, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "list_durable_nodes",
        arguments: { stage: 2 },
      },
    });
    assert(!callRes.result.isError);
    const parsedContent = JSON.parse(callRes.result.content[0].text);
    assert.equal(parsedContent.total_matching, 34);
    console.log("  PASS");

    // 13. HTTP Server and Bearer Token Auth
    console.log("Test 13: HTTP Server, Streamable HTTP and Auth...");
    const testPort = 18789;
    const testToken = "test-secret-token-xyz";
    const server = createHttpServer(context, {
      port: testPort,
      host: "127.0.0.1",
      authToken: testToken,
    });

    try {
      // Health check (should succeed without token)
      const health = await httpGet(`http://127.0.0.1:${testPort}/health`);
      assert.equal(health.status, 200);
      assert.equal(health.body.status, "ok");

      // POST /mcp without token -> 401
      const unauth = await httpPost(`http://127.0.0.1:${testPort}/mcp`, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      assert.equal(unauth.status, 401);

      // POST /mcp with wrong token -> 401
      const wrongAuth = await httpPost(
        `http://127.0.0.1:${testPort}/mcp`,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { Authorization: "Bearer wrong-token" }
      );
      assert.equal(wrongAuth.status, 401);

      // POST /mcp with valid token -> 200 OK
      const authed = await httpPost(
        `http://127.0.0.1:${testPort}/mcp`,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { Authorization: `Bearer ${testToken}` }
      );
      assert.equal(authed.status, 200);
      assert.equal(authed.body.result.tools.length, TOOL_DEFINITIONS.length);

      // POST /mcp call analyze_stage_candidates
      const callStage = await httpPost(
        `http://127.0.0.1:${testPort}/mcp`,
        {
          jsonrpc: "2.0",
          id: 42,
          method: "tools/call",
          params: {
            name: "analyze_stage_candidates",
            arguments: { stage: 2 },
          },
        },
        { Authorization: `Bearer ${testToken}` }
      );
      assert.equal(callStage.status, 200);
      const stageContent = JSON.parse(callStage.body.result.content[0].text);
      assert.equal(stageContent.total_candidates_in_journal, 34);
      assert.deepEqual(stageContent.hero_distribution.atk, { "6": 34 });

      console.log("  PASS: HTTP Streamable endpoint and Bearer auth verified");
    } finally {
      server.close();
    }

    console.log("\n>>> ALL 13 TEST GROUPS PASSED SUCCESSFULLY! <<<\n");
  } finally {
    // Cleanup temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error("Test failed:", err);
    process.exitCode = 1;
  });
}

module.exports = { runTests };
