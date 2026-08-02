"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const { createGuiServer } = require("./route-gui");
const { loadProject } = require("./lib/project-loader");
const { ReplaySession } = require("./lib/replay-session");
const { readRouteFile } = require("./lib/route-store");
const { enrichReplayStartSnapshot } = require("./lib/live-replay");
const { CONTROLS: PR48_CONTROLS } = require("./audit-region-route-output-contract");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_SCHEMA = "motapathfinder.pr-5.1a-replay-start-offset.v1";
const DEFAULT_OUT = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1a-replay-start-offset-contract.json",
);
const DEFAULT_OUT_MD = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1a-replay-start-offset-contract.md",
);

const FIXED_INPUTS = [
  {
    id: "onlyup-pr-4.8b-route",
    controlId: "onlyup-region-output-contract-smoke",
    tower: "onlyup",
  },
  {
    id: "whiteisland-pr-4.8b-route",
    controlId: "whiteisland-trial-output-contract-smoke",
    tower: "whiteisland",
  },
];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/") || ".";
}

function solverRelativePath(filePath) {
  return path.relative(__dirname, filePath).replace(/\\/g, "/") || ".";
}

function generationCommit() {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    return null;
  }
}

function fixedRouteSignature(routeRecord) {
  const stable = {
    schema: routeRecord.schema,
    sourceProfile: routeRecord.source && routeRecord.source.profile,
    startExactStateKey: routeRecord.start && routeRecord.start.exactStateKey,
    decisions: (routeRecord.decisions || []).map((decision) => ({
      kind: decision.kind,
      summary: decision.summary,
      preExactStateKey: decision.preExactStateKey,
      postExactStateKey: decision.postExactStateKey,
    })),
    finalExactStateKey: routeRecord.final && routeRecord.final.exactStateKey,
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function mergeFloorBaseline(baselineFloors, currentFloors) {
  const merged = cloneJson(currentFloors || {});
  Object.entries(baselineFloors || {}).forEach(([floorId, baseline]) => {
    const current = merged[floorId];
    if (!current) {
      merged[floorId] = cloneJson(baseline);
    }
  });
  return merged;
}

function findPr48Control(controlId) {
  const control = PR48_CONTROLS.find((candidate) => candidate.id === controlId);
  requireCondition(control, `PR-4.8b fixed route control not found: ${controlId}`);
  return control;
}

function ensureFixedRoute(input) {
  const sourceControl = findPr48Control(input.controlId);
  if (!fs.existsSync(sourceControl.outFile)) {
    const args = [
      "run-region-dp.js",
      `--project-root=${solverRelativePath(sourceControl.projectRoot)}`,
      `--region-spec=${solverRelativePath(sourceControl.specFile)}`,
      `--out=${solverRelativePath(sourceControl.outFile)}`,
      `--max-expansions=${sourceControl.probe.maxExpansions}`,
      `--max-runtime-ms=${sourceControl.probe.maxRuntimeMs}`,
      "--stop-on-first-goal=0",
      "--print-failures=0",
      "--structured-errors=1",
    ];
    const result = childProcess.spawnSync(process.execPath, args, {
      cwd: __dirname,
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Unable to materialize fixed ${input.id}: ${result.error ? result.error.message : `exit ${result.status}`}\n${result.stderr || ""}`,
      );
    }
  }
  const routeRecord = readRouteFile(sourceControl.outFile);
  requireCondition(routeRecord.schema === "motapathfinder.route.v1", `${input.id}: invalid route schema`);
  requireCondition(routeRecord.source && routeRecord.source.profile === input.controlId, `${input.id}: route is not the PR-4.8b fixed input`);
  requireCondition(Array.isArray(routeRecord.decisions) && routeRecord.decisions.length > 0, `${input.id}: fixed route has no decisions`);
  return {
    ...input,
    routeFile: sourceControl.outFile,
    projectRoot: sourceControl.projectRoot,
    specFile: sourceControl.specFile,
    routeRecord,
  };
}

function buildCheckpointRoute(routeRecord, sourceStep, options) {
  const sourceDecision = routeRecord.decisions[sourceStep - 1];
  requireCondition(sourceDecision, `checkpoint source decision ${sourceStep} is missing`);
  const checkpoint = cloneJson(routeRecord);
  checkpoint.source = {
    ...cloneJson(routeRecord.source || {}),
    profile: `${(routeRecord.source || {}).profile || "route"}-checkpoint-${sourceStep}`,
  };
  checkpoint.metadata = {
    ...cloneJson(routeRecord.metadata || {}),
    replayCheckpoint: {
      sourceRouteProfile: (routeRecord.source || {}).profile || null,
      sourceStep,
      exactStateKey: sourceDecision.postExactStateKey || null,
    },
  };
  const checkpointStartSnapshot = {
    ...cloneJson(sourceDecision.postSnapshot),
    floors: mergeFloorBaseline(
      ((routeRecord.start || {}).snapshot || {}).floors,
      (sourceDecision.postSnapshot || {}).floors,
    ),
  };
  checkpoint.start = {
    ...cloneJson(routeRecord.start || {}),
    snapshot: enrichReplayStartSnapshot(
      checkpointStartSnapshot,
      options && options.projectRoot,
      { start: { snapshot: checkpointStartSnapshot } },
    ),
    stateKey: sourceDecision.postStateKey || sourceDecision.postExactStateKey || null,
    dominanceKey: sourceDecision.postDominanceKey || sourceDecision.postExactStateKey || null,
    exactStateKey: sourceDecision.postExactStateKey || null,
  };
  checkpoint.decisions = (routeRecord.decisions || []).slice(sourceStep).map((decision, index) => ({
    ...cloneJson(decision),
    index: index + 1,
  }));
  checkpoint.stats = {
    ...cloneJson(routeRecord.stats || {}),
    depth: checkpoint.decisions.length,
    routeLength: checkpoint.decisions.length,
  };
  if (
    checkpoint.start.snapshot &&
    checkpoint.start.snapshot.flags &&
    checkpoint.start.snapshot.flags.__leaveLoc__
  ) {
    checkpoint.metadata.replayCheckpoint.expectedRuntimeFlags = {
      __leaveLoc__: cloneJson(checkpoint.start.snapshot.flags.__leaveLoc__),
    };
  }
  return checkpoint;
}

function summarizeHero(hero) {
  return cloneJson(hero || {});
}

function expectedBoundary(routeRecord, currentStep) {
  if (currentStep <= 1) {
    return {
      exactStateKey: (routeRecord.start || {}).exactStateKey || null,
      snapshot: cloneJson((routeRecord.start || {}).snapshot || null),
    };
  }
  const previous = routeRecord.decisions[currentStep - 2] || null;
  return {
    exactStateKey: previous ? previous.postExactStateKey || null : (routeRecord.final || {}).exactStateKey || null,
    snapshot: cloneJson(previous ? previous.postSnapshot || null : (routeRecord.final || {}).snapshot || null),
  };
}

function makeShadowReplayApi(counters) {
  return {
    async launchRuntimeSession(routeRecord) {
      counters.launches += 1;
      return {
        url: `shadow://replay/${counters.id}`,
        snapshot: cloneJson((routeRecord.start || {}).snapshot || {}),
        exactStateKey: (routeRecord.start || {}).exactStateKey || null,
        executedSteps: [],
        sideEffects: [],
      };
    },
    async verifyInitialRuntimeSnapshot(runtime, routeRecord) {
      const expected = (routeRecord.start || {}).exactStateKey || null;
      return {
        ok: runtime.exactStateKey === expected,
        mismatch: runtime.exactStateKey === expected ? null : "shadow initial exactStateKey mismatch",
        actual: cloneJson(runtime.snapshot),
      };
    },
    async executeRouteDecision(runtime, decision) {
      const preExactStateKey = runtime.exactStateKey;
      if (preExactStateKey !== decision.preExactStateKey) {
        return {
          ok: false,
          mismatch: `shadow pre-state mismatch at ${decision.index}`,
          actual: cloneJson(runtime.snapshot),
        };
      }
      const leaveLoc = runtime.snapshot && runtime.snapshot.flags && runtime.snapshot.flags.__leaveLoc__;
      const previousFloors = runtime.snapshot && runtime.snapshot.floors;
      runtime.snapshot = cloneJson(decision.postSnapshot || {});
      if (
        leaveLoc &&
        runtime.snapshot.flags &&
        !Object.prototype.hasOwnProperty.call(runtime.snapshot.flags, "__leaveLoc__")
      ) {
        runtime.snapshot.flags.__leaveLoc__ = cloneJson(leaveLoc);
      }
      if (previousFloors && runtime.snapshot.floors) {
        Object.entries(previousFloors).forEach(([floorId, floor]) => {
          if (!Object.prototype.hasOwnProperty.call(runtime.snapshot.floors, floorId)) {
            runtime.snapshot.floors[floorId] = cloneJson(floor);
          }
        });
      }
      runtime.exactStateKey = decision.postExactStateKey || null;
      runtime.executedSteps.push(decision.index);
      runtime.sideEffects.push({
        index: decision.index,
        fromExactStateKey: preExactStateKey,
        toExactStateKey: runtime.exactStateKey,
      });
      counters.executions.push(decision.index);
      return { ok: true, actual: cloneJson(runtime.snapshot) };
    },
    async describeRuntimeStatus(runtime) {
      const snapshot = runtime.snapshot || {};
      return {
        floorId: snapshot.floorId || null,
        hero: summarizeHero(snapshot.hero),
        exactStateKey: runtime.exactStateKey || null,
        executedSteps: runtime.executedSteps.slice(),
        sideEffects: cloneJson(runtime.sideEffects),
        eventId: null,
        eventType: null,
        moving: false,
        lockControl: false,
        replayAnimating: false,
      };
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function requestJson(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}

function assertHeroEqual(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, `${label}: displayed hero`);
}

async function runValidControl(input, routeRecord, requestedFromStep, metadata) {
  const counters = { id: metadata.id, launches: 0, executions: [] };
  const session = new ReplaySession({
    routeRecord,
    projectRoot: input.projectRoot,
    liveOptions: { fromStep: 1, stepDelayMs: 0 },
    replayApi: makeShadowReplayApi(counters),
  });
  const project = loadProject(input.projectRoot);
  const server = createGuiServer({
    routeRecord,
    routeFile: input.routeFile,
    session,
    project,
    debug: false,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const startResponse = await requestJson(baseUrl, "POST", "/api/session/start", { fromStep: requestedFromStep });
    assert.strictEqual(startResponse.status, 200, `${metadata.id}: start API status`);
    assert.strictEqual(startResponse.data.state, "paused", `${metadata.id}: start API state`);
    const startStatusResponse = await requestJson(baseUrl, "GET", "/api/session/status");
    assert.strictEqual(startStatusResponse.status, 200, `${metadata.id}: status API status`);
    const startStatus = startStatusResponse.data;
    const effectiveFromStep = requestedFromStep === 0 ? 1 : requestedFromStep;
    const boundary = expectedBoundary(routeRecord, effectiveFromStep);
    const nextDecision = routeRecord.decisions[effectiveFromStep - 1];
    const runtimeAtPause = startStatus.runtime || {};
    const expectedExecutedPrefix = Array.from({ length: effectiveFromStep - 1 }, (_, index) => index + 1);
    assert.strictEqual(startStatus.state, "paused", `${metadata.id}: paused state`);
    assert.strictEqual(startStatus.requestedFromStep, requestedFromStep, `${metadata.id}: requested offset`);
    assert.strictEqual(startStatus.effectiveFromStep, effectiveFromStep, `${metadata.id}: effective offset`);
    assert.strictEqual(startStatus.currentStep, effectiveFromStep, `${metadata.id}: current step`);
    assert.strictEqual(startStatus.lastCompletedStep, effectiveFromStep - 1, `${metadata.id}: last completed step`);
    assert.strictEqual(startStatus.expectedExactStateKey, boundary.exactStateKey, `${metadata.id}: expected boundary exact state`);
    assert.strictEqual(runtimeAtPause.exactStateKey, boundary.exactStateKey, `${metadata.id}: resumed exact state`);
    assert.deepStrictEqual(runtimeAtPause.executedSteps, expectedExecutedPrefix, `${metadata.id}: executed prefix`);
    assert.deepStrictEqual(startStatus.nextDecision && startStatus.nextDecision.summary, nextDecision.summary, `${metadata.id}: next decision`);
    assert.strictEqual(startStatus.display.floorId, boundary.snapshot.floorId, `${metadata.id}: displayed floor`);
    assertHeroEqual(startStatus.display.hero, boundary.snapshot.hero, metadata.id);

    const finished = await session.play({ stepDelayMs: 0 });
    const finalStatusResponse = await requestJson(baseUrl, "GET", "/api/session/status");
    assert.strictEqual(finalStatusResponse.status, 200, `${metadata.id}: final status API status`);
    const finalStatus = finalStatusResponse.data;
    const finalRuntime = finalStatus.runtime || {};
    const expectedAllSteps = routeRecord.decisions.map((decision) => decision.index);
    assert.strictEqual(finished.state, "completed", `${metadata.id}: play completion`);
    assert.strictEqual(finalStatus.state, "completed", `${metadata.id}: final state`);
    assert.strictEqual(finalStatus.currentStep, routeRecord.decisions.length + 1, `${metadata.id}: final current step`);
    assert.strictEqual(finalStatus.lastCompletedStep, routeRecord.decisions.length, `${metadata.id}: final last completed step`);
    assert.strictEqual(finalStatus.nextDecision, null, `${metadata.id}: final next decision`);
    assert.strictEqual(finalStatus.expectedExactStateKey, routeRecord.final.exactStateKey, `${metadata.id}: final expected exact state`);
    assert.strictEqual(finalRuntime.exactStateKey, routeRecord.final.exactStateKey, `${metadata.id}: final exact state`);
    assert.deepStrictEqual(finalRuntime.executedSteps, expectedAllSteps, `${metadata.id}: all executed steps`);
    assert.deepStrictEqual(counters.executions, expectedAllSteps, `${metadata.id}: side effects applied exactly once`);
    assert.strictEqual(finalStatus.display.floorId, routeRecord.final.snapshot.floorId, `${metadata.id}: final displayed floor`);
    assertHeroEqual(finalStatus.display.hero, routeRecord.final.snapshot.hero, metadata.id);
    return {
      id: metadata.id,
      kind: metadata.kind || "offset",
      requestedFromStep,
      routeLength: routeRecord.decisions.length,
      checkpoint: metadata.checkpoint || null,
      start: {
        state: startStatus.state,
        currentStep: startStatus.currentStep,
        lastCompletedStep: startStatus.lastCompletedStep,
        requestedFromStep: startStatus.requestedFromStep,
        effectiveFromStep: startStatus.effectiveFromStep,
        expectedExactStateKey: startStatus.expectedExactStateKey,
        resumedExactStateKey: runtimeAtPause.exactStateKey,
        nextDecision: cloneJson(startStatus.nextDecision),
        displayed: {
          floorId: startStatus.display.floorId,
          hero: summarizeHero(startStatus.display.hero),
        },
        executedPrefix: runtimeAtPause.executedSteps.slice(),
        sideEffectsAppliedBeforePause: runtimeAtPause.sideEffects.length,
      },
      continuation: {
        state: finalStatus.state,
        currentStep: finalStatus.currentStep,
        lastCompletedStep: finalStatus.lastCompletedStep,
        finalExpectedExactStateKey: finalStatus.expectedExactStateKey,
        finalExactStateKey: finalRuntime.exactStateKey,
        finalExactStateMatches: finalRuntime.exactStateKey === routeRecord.final.exactStateKey,
        allDecisionSideEffectsApplied: JSON.stringify(finalRuntime.executedSteps) === JSON.stringify(expectedAllSteps),
        executedSteps: finalRuntime.executedSteps.slice(),
        displayed: {
          floorId: finalStatus.display.floorId,
          hero: summarizeHero(finalStatus.display.hero),
        },
      },
    };
  } finally {
    await session.closeRuntimeOnly();
    await closeServer(server);
  }
}

async function runOutOfRangeControl(input, routeRecord, requestedFromStep, id) {
  const counters = { id, launches: 0, executions: [] };
  const session = new ReplaySession({
    routeRecord,
    projectRoot: input.projectRoot,
    replayApi: makeShadowReplayApi(counters),
  });
  const project = loadProject(input.projectRoot);
  const server = createGuiServer({
    routeRecord,
    routeFile: input.routeFile,
    session,
    project,
    debug: false,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await requestJson(baseUrl, "POST", "/api/session/start", { fromStep: requestedFromStep });
    const status = await requestJson(baseUrl, "GET", "/api/session/status");
    assert.strictEqual(response.status, 400, `${id}: out-of-range HTTP status`);
    assert.strictEqual(response.data.ok, false, `${id}: out-of-range response`);
    assert.strictEqual(response.data.code, "REPLAY_STEP_OUT_OF_RANGE", `${id}: out-of-range code`);
    assert.strictEqual(response.data.requestedStep, requestedFromStep, `${id}: out-of-range requested step`);
    assert.strictEqual(response.data.totalSteps, routeRecord.decisions.length, `${id}: out-of-range total`);
    assert.strictEqual(counters.launches, 0, `${id}: invalid offset must not launch runtime`);
    assert.strictEqual(status.data.state, "idle", `${id}: invalid offset changes no session state`);
    return {
      id,
      kind: "out-of-range",
      requestedFromStep,
      routeLength: routeRecord.decisions.length,
      response: {
        status: response.status,
        ok: response.data.ok,
        code: response.data.code,
        requestedStep: response.data.requestedStep,
        totalSteps: response.data.totalSteps,
      },
      launchCount: counters.launches,
      sessionStateAfterRequest: status.data.state,
    };
  } finally {
    await session.closeRuntimeOnly();
    await closeServer(server);
  }
}

async function buildInputReport(input) {
  const routeRecord = input.routeRecord;
  const routeLength = routeRecord.decisions.length;
  const controls = [];
  for (const requestedFromStep of [0, 1, routeLength]) {
    controls.push(await runValidControl(input, routeRecord, requestedFromStep, {
      id: `${input.id}-from-step-${requestedFromStep}`,
      kind: "offset",
    }));
  }

  const checkpointRoute = buildCheckpointRoute(routeRecord, 1, { projectRoot: input.projectRoot });
  controls.push(await runValidControl(input, checkpointRoute, 1, {
    id: `${input.id}-checkpoint-plus-from-step-1`,
    kind: "checkpoint-plus-offset",
    checkpoint: {
      sourceRouteProfile: routeRecord.source.profile,
      sourceStep: 1,
      checkpointExactStateKey: checkpointRoute.start.exactStateKey,
      checkpointRouteLength: checkpointRoute.decisions.length,
    },
  }));

  const outOfRangeControls = [
    await runOutOfRangeControl(input, routeRecord, routeLength + 1, `${input.id}-from-step-too-large`),
    await runOutOfRangeControl(input, routeRecord, -1, `${input.id}-from-step-negative`),
    await runOutOfRangeControl(input, routeRecord, 1.5, `${input.id}-from-step-non-integer`),
  ];
  return {
    id: input.id,
    tower: input.tower,
    routeFile: relativePath(input.routeFile),
    projectRoot: relativePath(input.projectRoot),
    specFile: relativePath(input.specFile),
    routeSignature: fixedRouteSignature(routeRecord),
    schema: routeRecord.schema,
    sourceProfile: routeRecord.source.profile,
    decisionCount: routeLength,
    startExactStateKey: routeRecord.start.exactStateKey,
    finalExactStateKey: routeRecord.final.exactStateKey,
    finalDisplayed: {
      floorId: routeRecord.final.snapshot.floorId,
      hero: summarizeHero(routeRecord.final.snapshot.hero),
    },
    controls,
    outOfRangeControls,
  };
}

async function buildReport() {
  const inputs = FIXED_INPUTS.map(ensureFixedRoute);
  const inputReports = [];
  for (const input of inputs) inputReports.push(await buildInputReport(input));
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "replay-contract-shadow",
      entrypoint: "shared-solver/route-gui.js",
      session: "shared-solver/lib/replay-session.js",
      fixedInputSource: "PR-4.8b OnlyUp and WhiteIsland short route outputs",
      deterministicFullReportRebuild: true,
      generationCommit: generationCommit(),
      productionSolverChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      routeSelectionSemanticsChanged: false,
      liveRuntimeExecuted: false,
    },
    contract: {
      id: "PR-5.1a",
      title: "Replay Start-Offset Contract",
      semantics: {
        decisionNumbering: "1-based primitive decisions",
        fromStepRange: "0..routeLength",
        zeroAlias: "initial checkpoint before decision 1",
        pauseBoundary: "from-step=N pauses before primitive decision N",
        lastCompletedStep: "N-1, with from-step=0 normalized to currentStep=1 and lastCompletedStep=0",
        outOfRange: "HTTP 400 REPLAY_STEP_OUT_OF_RANGE; runtime is not launched",
      },
      fixedInputs: FIXED_INPUTS.map((input) => input.id),
      requiredControls: [
        "from-step=0",
        "from-step=1",
        "from-step=routeLength",
        "checkpoint + from-step",
        "from-step=routeLength+1",
        "from-step=-1",
        "from-step=non-integer",
      ],
    },
    scope: {
      shadowOnlyReplayContract: true,
      productionSolverChanged: false,
      productionSearchSemanticsChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      routeSelectionSemanticsChanged: false,
    },
    inputs: inputReports,
  };
}

function markdownReport(report) {
  const lines = [
    "# PR-5.1a Replay Start-Offset Contract",
    "",
    `Schema: \`${report.schema}\``,
    "Status: completed",
    "Mode: replay-contract-shadow",
    "",
    "This contract uses the two PR-4.8b short cross-tower route outputs as fixed inputs. It exercises the GUI session API with a deterministic replay adapter so every prefix side effect, exact-state boundary, next decision, displayed floor/hero, and final continuation can be checked without changing solver search semantics.",
    "",
    "## Fixed inputs and valid offsets",
    "",
    "| Input | Tower | Route length | from-step=0 | from-step=1 | from-step=routeLength | checkpoint + from-step |",
    "| --- | --- | ---: | --- | --- | --- | --- |",
  ];
  report.inputs.forEach((input) => {
    const byId = new Map(input.controls.map((control) => [control.kind === "checkpoint-plus-offset" ? "checkpoint" : String(control.requestedFromStep), control]));
    lines.push(`| ${input.id} | ${input.tower} | ${input.decisionCount} | ${byId.get("0").continuation.finalExactStateMatches ? "passed" : "failed"} | ${byId.get("1").continuation.finalExactStateMatches ? "passed" : "failed"} | ${byId.get(String(input.decisionCount)).continuation.finalExactStateMatches ? "passed" : "failed"} | ${byId.get("checkpoint").continuation.finalExactStateMatches ? "passed" : "failed"} |`);
  });
  lines.push(
    "",
    "For each valid offset, the session pauses before the requested primitive decision, reports `lastCompletedStep=N-1`, exposes the resumed exact state and next decision, and then executes every remaining decision exactly once to the fixed final exact state.",
    "",
    "## Boundary evidence",
    "",
    "| Control | Requested | Effective current | Last completed | Next decision | Pause display | Final exact state | Side effects |",
    "| --- | ---: | ---: | ---: | --- | --- | --- | --- |",
  );
  report.inputs.forEach((input) => {
    input.controls.forEach((control) => {
      const start = control.start;
      const continuation = control.continuation;
      lines.push(`| ${control.id} | ${control.requestedFromStep} | ${start.currentStep} | ${start.lastCompletedStep} | ${start.nextDecision ? `#${start.nextDecision.index} ${start.nextDecision.summary}` : "-"} | ${start.displayed.floorId} hp=${start.displayed.hero.hp} | ${continuation.finalExactStateMatches ? "passed" : "failed"} | ${continuation.allDecisionSideEffectsApplied ? "all exactly once" : "failed"} |`);
    });
    input.outOfRangeControls.forEach((control) => {
      lines.push(`| ${control.id} | ${control.requestedFromStep} | - | - | rejected | - | ${control.response.code} | launch=${control.launchCount} |`);
    });
  });
  lines.push(
    "",
    "## Scope boundary",
    "",
    "This round changes replay session/API observability and GUI offset handling only. It does not modify solver, DP key, dominance, agenda, capacity, route selection, or default strategy semantics. The report is a contract-level shadow audit; live browser verification remains a separate runtime smoke.",
    "",
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) options[match[1]] = match[2];
  });
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const out = options.out ? path.resolve(__dirname, options.out) : DEFAULT_OUT;
  const outMd = options["out-md"] ? path.resolve(__dirname, options["out-md"]) : DEFAULT_OUT_MD;
  const report = await buildReport();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMd, markdownReport(report), "utf8");
  process.stdout.write(`replay start-offset contract wrote ${out} (${report.inputs.length} fixed inputs)\n`);
  return report;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  FIXED_INPUTS,
  buildCheckpointRoute,
  buildReport,
  ensureFixedRoute,
  markdownReport,
};
