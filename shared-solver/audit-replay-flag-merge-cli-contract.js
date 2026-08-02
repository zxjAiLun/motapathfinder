"use strict";

const assert = require("node:assert");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { parseFromStep } = require("./route-gui");
const {
  buildCheckpointRoute,
  ensureFixedRoute,
  FIXED_INPUTS,
} = require("./audit-replay-start-offset-contract");
const {
  buildRuntimeSnapshotIdentityPair,
  diffRouteSnapshot,
} = require("./lib/live-replay");
const { loadProject } = require("./lib/project-loader");
const { ReplaySession } = require("./lib/replay-session");
const { buildDominanceKey, buildStateKey } = require("./lib/state-key");
const { buildSolverSnapshot } = require("./lib/route-snapshot");
const { StaticSimulator } = require("./lib/simulator");
const { cloneState } = require("./lib/state");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_SCHEMA = "motapathfinder.pr-5.1a1a-replay-flag-merge-cli.v1";
const DEFAULT_OUT = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1a1a-replay-flag-merge-cli-contract.json",
);
const DEFAULT_OUT_MD = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1a1a-replay-flag-merge-cli-contract.md",
);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/") || ".";
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

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function routeSignature(routeRecord) {
  const stable = {
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

function stripTravelState(action) {
  const clean = cloneJson(action);
  delete clean.travelState;
  return clean;
}

function decisionRecord(project, before, action, after, floorIds, index) {
  const cleanAction = stripTravelState(action);
  return {
    index,
    ...cleanAction,
    preStateKey: buildDominanceKey(before),
    postStateKey: buildDominanceKey(after),
    preDominanceKey: buildDominanceKey(before),
    postDominanceKey: buildDominanceKey(after),
    preExactStateKey: buildStateKey(before),
    postExactStateKey: buildStateKey(after),
    preSnapshot: buildSolverSnapshot(project, before, { floorIds }),
    postSnapshot: buildSolverSnapshot(project, after, { floorIds }),
  };
}

function buildCheckpointContinuationControl() {
  const projectRoot = path.resolve(REPO_ROOT, "whiteisland（9）");
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    stopFloorId: null,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
  });
  const floorIds = ["Start", "A1", "A2"];
  const preCheckpointState = simulator.createInitialState({ rank: "chaos" });
  preCheckpointState.floorId = "A1";
  preCheckpointState.visitedFloors.A1 = true;
  preCheckpointState.hero.loc = { x: 11, y: 2, direction: "down" };
  preCheckpointState.inventory.fly = 1;
  simulator.stabilizeState(preCheckpointState);

  const changeFloor = simulator.enumeratePrimitiveActions(preCheckpointState).actions.find(
    (action) => action.kind === "changeFloor" && action.summary === "changeFloor@A1:11,2",
  );
  requireCondition(changeFloor, "checkpoint continuation: A1 changeFloor action is missing");
  const checkpointState = simulator.applyAction(
    cloneState(preCheckpointState),
    changeFloor,
    { storeRoute: false },
  );
  const changeFloorAfterCheckpoint = simulator.enumeratePrimitiveActions(checkpointState).actions.find(
    (action) => action.kind === "changeFloor" && action.summary === "changeFloor@A2:11,2",
  );
  requireCondition(
    changeFloorAfterCheckpoint,
    "checkpoint continuation: post-checkpoint A2 changeFloor action is missing",
  );
  const afterChangeFloorState = simulator.applyAction(
    cloneState(checkpointState),
    changeFloorAfterCheckpoint,
    { storeRoute: false },
  );
  const floorFly = simulator.enumerateFloorFlyActions(afterChangeFloorState).find(
    (action) => action.kind === "floorFly" && action.targetFloorId === "A2" && action.stance.x === 11 && action.stance.y === 2,
  );
  requireCondition(floorFly, "checkpoint continuation: A2 floorFly action is missing");
  const finalState = simulator.applyAction(
    cloneState(afterChangeFloorState),
    floorFly,
    { storeRoute: false },
  );

  const routeRecord = {
    schema: "motapathfinder.route.v1",
    source: {
      commit: "shadow-control",
      solver: "static-simulator",
      profile: "pr-5.1a1a-whiteisland-checkpoint-continuation",
      rank: "chaos",
      projectTitle: project.data && project.data.firstData && project.data.firstData.title,
    },
    goal: { type: "floor", floorId: "A2" },
    metadata: {
      replayFlagMergeControl: {
        nonInitialFloorCheckpoint: true,
        sourceFloor: "A1",
        checkpointFloor: "A2",
        laterChangeFloor: true,
        laterFloorFly: true,
        flyRecordPosition: project.defaultFlags && project.defaultFlags.flyRecordPosition === true,
      },
    },
    stats: { depth: 3, routeLength: 3 },
    start: {
      snapshot: buildSolverSnapshot(project, preCheckpointState, { floorIds }),
      stateKey: buildDominanceKey(preCheckpointState),
      dominanceKey: buildDominanceKey(preCheckpointState),
      exactStateKey: buildStateKey(preCheckpointState),
    },
    final: {
      snapshot: buildSolverSnapshot(project, finalState, { floorIds }),
      stateKey: buildDominanceKey(finalState),
      dominanceKey: buildDominanceKey(finalState),
      exactStateKey: buildStateKey(finalState),
      floorId: finalState.floorId,
    },
    decisions: [
      decisionRecord(project, preCheckpointState, changeFloor, checkpointState, floorIds, 1),
      decisionRecord(project, checkpointState, changeFloorAfterCheckpoint, afterChangeFloorState, floorIds, 2),
      decisionRecord(project, afterChangeFloorState, floorFly, finalState, floorIds, 3),
    ],
    rawRoute: [],
    notes: [],
  };
  const checkpoint = buildCheckpointRoute(routeRecord, 1, { projectRoot });
  const checkpointFlags = (((checkpoint.start || {}).snapshot || {}).flags || {}).__leaveLoc__ || {};
  requireCondition(checkpoint.start.snapshot.floorId === "A2", "checkpoint continuation must start on A2");
  requireCondition(checkpointFlags.Start, "checkpoint continuation must retain initial Start baseline");
  requireCondition(checkpointFlags.A1, "checkpoint continuation must retain current A1 leave location");

  return {
    projectRoot,
    sourceRoute: routeRecord,
    checkpoint,
    evidence: {
      sourceFloor: "A1",
      checkpointFloor: checkpoint.start.snapshot.floorId,
      changeFloorSummary: routeRecord.decisions[0].summary,
      postCheckpointChangeFloorSummary: checkpoint.decisions[0].summary,
      floorFlySummary: checkpoint.decisions[1].summary,
      flyRecordPosition: project.defaultFlags && project.defaultFlags.flyRecordPosition === true,
      expectedBaseline: cloneJson(checkpointFlags.Start),
      expectedCurrentLeaveLoc: cloneJson(afterChangeFloorState.flags.__leaveLoc__.A2),
      finalHeroLoc: cloneJson(finalState.hero.loc),
      finalFloor: finalState.floorId,
    },
  };
}

function mergeFlagFloors(previousFlags, nextFlags) {
  const previous = previousFlags && previousFlags.__leaveLoc__;
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return;
  if (!nextFlags.__leaveLoc__ || typeof nextFlags.__leaveLoc__ !== "object" || Array.isArray(nextFlags.__leaveLoc__)) {
    nextFlags.__leaveLoc__ = {};
  }
  Object.entries(previous).forEach(([floorId, loc]) => {
    if (!Object.prototype.hasOwnProperty.call(nextFlags.__leaveLoc__, floorId)) {
      nextFlags.__leaveLoc__[floorId] = cloneJson(loc);
    }
  });
}

function makeShadowReplayApi() {
  return {
    async launchRuntimeSession(routeRecord) {
      return {
        url: "shadow://replay/pr-5.1a1a",
        snapshot: cloneJson((routeRecord.start || {}).snapshot || {}),
        exactStateKey: (routeRecord.start || {}).exactStateKey || null,
        executedSteps: [],
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
      if (runtime.exactStateKey !== decision.preExactStateKey) {
        return { ok: false, mismatch: "shadow pre-state exact key mismatch", actual: cloneJson(runtime.snapshot) };
      }
      const previousFlags = cloneJson(runtime.snapshot.flags || {});
      const previousFloors = runtime.snapshot.floors;
      runtime.snapshot = cloneJson(decision.postSnapshot);
      runtime.snapshot.flags = runtime.snapshot.flags || {};
      mergeFlagFloors(previousFlags, runtime.snapshot.flags);
      if (previousFloors && runtime.snapshot.floors) {
        Object.entries(previousFloors).forEach(([floorId, floor]) => {
          if (!Object.prototype.hasOwnProperty.call(runtime.snapshot.floors, floorId)) {
            runtime.snapshot.floors[floorId] = cloneJson(floor);
          }
        });
      }
      runtime.exactStateKey = decision.postExactStateKey;
      runtime.executedSteps.push(decision.index);
      return { ok: true, actual: cloneJson(runtime.snapshot) };
    },
    async describeRuntimeStatus(runtime) {
      const snapshot = runtime.snapshot || {};
      const hero = snapshot.hero || {};
      return {
        floorId: snapshot.floorId || null,
        hero: {
          x: hero.loc && hero.loc.x,
          y: hero.loc && hero.loc.y,
          direction: hero.loc && hero.loc.direction,
          hp: hero.hp,
          atk: hero.atk,
          def: hero.def,
          mdef: hero.mdef,
        },
        exactStateKey: runtime.exactStateKey,
        executedSteps: runtime.executedSteps.slice(),
        moving: false,
        lockControl: false,
        replayAnimating: false,
      };
    },
  };
}

async function runShadowContinuation(routeRecord, projectRoot) {
  const session = new ReplaySession({
    routeRecord,
    projectRoot,
    liveOptions: { runtimeAutoBattle: 1, stepDelayMs: 0 },
    replayApi: makeShadowReplayApi(),
  });
  try {
    const started = await session.start({ fromStep: 1 });
    assert.strictEqual(started.runtimeSnapshotIdentityMatches, true, "checkpoint start runtime identity");
    assert.strictEqual(started.runtimeProjectedSolverStateMatches, true, "checkpoint start projected identity");
    const completed = await session.play({ stepDelayMs: 0 });
    assert.strictEqual(completed.state, "completed", "checkpoint continuation completes");
    assert.strictEqual(completed.runtimeSnapshotIdentityMatches, true, "checkpoint continuation runtime identity");
    assert.strictEqual(completed.runtimeProjectedSolverStateMatches, true, "checkpoint continuation projected identity");
    assert.strictEqual(
      completed.runtimeSnapshotIdentity,
      completed.expectedRuntimeSnapshotIdentity,
      "checkpoint continuation identity hash",
    );
    return {
      state: completed.state,
      runtimeSnapshotIdentity: completed.runtimeSnapshotIdentity,
      expectedRuntimeSnapshotIdentity: completed.expectedRuntimeSnapshotIdentity,
      runtimeSnapshotIdentityMatches: completed.runtimeSnapshotIdentityMatches,
      runtimeProjectedSolverStateMatches: completed.runtimeProjectedSolverStateMatches,
      finalHeroLoc: cloneJson(session.lastRuntimeSnapshot.hero.loc),
      finalLeaveLoc: cloneJson((session.lastRuntimeSnapshot.flags || {}).__leaveLoc__ || null),
      finalSnapshot: cloneJson(session.lastRuntimeSnapshot),
    };
  } finally {
    await session.closeRuntimeOnly();
  }
}

function buildMismatchControl(control, continuation) {
  const route = control.checkpoint;
  const options = {
    runtimeAutoBattle: 1,
    routeStartSnapshot: route.start.snapshot,
  };
  const controls = [
    { id: "old-baseline", floorId: "Start", delta: 1 },
    { id: "new-leave-location", floorId: "A2", delta: -1 },
  ].map(({ id, floorId, delta }) => {
    const actual = cloneJson(continuation.finalSnapshot);
    actual.flags.__leaveLoc__[floorId].x += delta;
    const mismatch = diffRouteSnapshot(
      route.final.snapshot,
      actual,
      options,
      ["checkpoint", "floorFly", id],
    );
    const identity = buildRuntimeSnapshotIdentityPair(route.final.snapshot, actual, options);
    assert.ok(mismatch, `${id}: altered leave location must mismatch`);
    assert.strictEqual(identity.matches, false, `${id}: altered leave location identity`);
    return {
      id,
      alteredFloorId: floorId,
      mismatch,
      identityMatches: identity.matches,
      expectedRuntimeSnapshotIdentity: identity.expected,
      divergentRuntimeSnapshotIdentity: identity.actual,
    };
  });
  return controls;
}

function runDirectCliControl(input) {
  const args = [
    path.join(__dirname, "route-gui.js"),
    `--project-root=${input.projectRoot}`,
    `--route-file=${input.routeFile}`,
    "--from-step=abc",
    "--live=1",
    "--open=1",
    "--headless=1",
    "--keep-open=0",
  ];
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: __dirname,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  assert.notStrictEqual(result.status, 0, "invalid CLI offset must exit nonzero");
  assert.match(stderr, /REPLAY_STEP_OUT_OF_RANGE/, "CLI stderr must expose validation code");
  assert.doesNotMatch(stdout, /Route GUI:/, "CLI gate must run before server listen");
  assert.doesNotMatch(stdout, /Starting live runtime/, "CLI gate must run before runtime launch");
  return {
    rawInput: "abc",
    exitCode: result.status,
    signal: result.signal,
    errorCode: "REPLAY_STEP_OUT_OF_RANGE",
    serverStarted: /Route GUI:/.test(stdout),
    browserOpened: false,
    runtimeStarted: /Starting live runtime/.test(stdout),
  };
}

async function buildReport() {
  const whiteInput = ensureFixedRoute(FIXED_INPUTS.find((input) => input.tower === "whiteisland"));
  const control = buildCheckpointContinuationControl();
  const checkpointContinuation = await runShadowContinuation(control.checkpoint, control.projectRoot);
  assert.deepStrictEqual(checkpointContinuation.finalHeroLoc, control.evidence.finalHeroLoc);
  assert.deepStrictEqual(checkpointContinuation.finalLeaveLoc.Start, control.evidence.expectedBaseline);
  assert.deepStrictEqual(checkpointContinuation.finalLeaveLoc.A2, control.evidence.expectedCurrentLeaveLoc);
  const mismatches = buildMismatchControl(control, checkpointContinuation);
  const directCli = runDirectCliControl(whiteInput);

  assert.strictEqual(parseFromStep("abc"), "abc", "route-gui must preserve raw nonnumeric input");
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "replay-runtime-flag-merge-cli",
      entrypoint: "shared-solver/route-gui.js",
      runtimeLayer: "shared-solver/lib/live-replay.js",
      session: "shared-solver/lib/replay-session.js",
      fixedInputSource: "PR-4.8b WhiteIsland route plus a real WhiteIsland StaticSimulator checkpoint continuation",
      deterministicFullReportRebuild: true,
      generationCommit: generationCommit(),
      liveRuntimeExecuted: false,
      productionReplayRuntimeChanged: true,
      productionSolverChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      routeSelectionSemanticsChanged: false,
    },
    scope: {
      shadowOnly: false,
      replayRuntimeHardening: true,
      noProductionSolverSearchSemanticsChange: true,
      projectedRuntimeStateIdentity: "template-projected solver-state witness; not a complete runtime exact-state capture",
      runtimeSnapshotIdentity: "sha256 of normalized full runtime snapshot including per-floor __leaveLoc__ and floor mutations",
      productionSolverSearchSemanticsChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      routeSelectionSemanticsChanged: false,
    },
    controls: {
      directCli: directCli,
      checkpointContinuation: {
        routeSignature: routeSignature(control.checkpoint),
        projectRoot: relativePath(control.projectRoot),
        sourceFloor: control.evidence.sourceFloor,
        checkpointFloor: control.evidence.checkpointFloor,
        actions: {
          initialChangeFloor: control.evidence.changeFloorSummary,
          checkpointChangeFloor: control.evidence.postCheckpointChangeFloorSummary,
          floorFly: control.evidence.floorFlySummary,
        },
        flyRecordPosition: control.evidence.flyRecordPosition,
        expectedBaseline: control.evidence.expectedBaseline,
        expectedCurrentLeaveLoc: control.evidence.expectedCurrentLeaveLoc,
        continuation: {
          state: checkpointContinuation.state,
          runtimeSnapshotIdentity: checkpointContinuation.runtimeSnapshotIdentity,
          expectedRuntimeSnapshotIdentity: checkpointContinuation.expectedRuntimeSnapshotIdentity,
          runtimeSnapshotIdentityMatches: checkpointContinuation.runtimeSnapshotIdentityMatches,
          runtimeProjectedSolverStateMatches: checkpointContinuation.runtimeProjectedSolverStateMatches,
          finalHeroLoc: checkpointContinuation.finalHeroLoc,
          finalLeaveLoc: checkpointContinuation.finalLeaveLoc,
        },
        mismatchControls: mismatches,
      },
    },
  };
}

function markdownReport(report) {
  const control = report.controls.checkpointContinuation;
  const lines = [
    "# PR-5.1a1a Checkpoint Flag Merge & CLI Gate",
    "",
    `Schema: \`${report.schema}\``,
    "Status: completed",
    "Mode: replay-runtime-flag-merge-cli",
    "",
    "This contract keeps the production replay-runtime boundary explicit: it changes no solver/search semantics, while checkpoint flag compatibility is merged per floor and the direct CLI validates before server/browser/runtime startup.",
    "",
    "## Controls",
    "",
    "| Control | Evidence | Result |",
    "| --- | --- | --- |",
    `| Direct CLI | --from-step=abc | exit=${report.controls.directCli.exitCode}; code=${report.controls.directCli.errorCode}; server=${report.controls.directCli.serverStarted}; runtime=${report.controls.directCli.runtimeStarted} |`,
    `| Checkpoint continuation | ${control.checkpointFloor} -> ${control.actions.checkpointChangeFloor} -> ${control.actions.floorFly} | identity=${control.continuation.runtimeSnapshotIdentityMatches}; final=${JSON.stringify(control.continuation.finalHeroLoc)} |`,
    `| Per-floor flag merge | baseline Start + current A2 | Start=${JSON.stringify(control.continuation.finalLeaveLoc.Start)}; A2=${JSON.stringify(control.continuation.finalLeaveLoc.A2)} |`,
    "",
    "## Mismatch witnesses",
    "",
    ...control.mismatchControls.map((item) => `- ${item.id}: altered ${item.alteredFloorId}; rejected=${item.identityMatches === false}; path=\`${item.mismatch}\``),
    "",
    "## Identity naming",
    "",
    "`runtimeProjectedSolverStateKey` is a template projection and is not presented as a complete runtime exact-state capture. `runtimeSnapshotIdentity` remains the complete normalized runtime snapshot hash used for flag identity.",
    "",
  ];
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach((arg) => {
    const match = String(arg).match(/^--([^=]+)=(.*)$/);
    if (match) options[match[1]] = match[2];
  });
  return options;
}

async function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const out = path.resolve(args.out || DEFAULT_OUT);
  const outMd = path.resolve(args["out-md"] || DEFAULT_OUT_MD);
  const report = await buildReport();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outMd, markdownReport(report));
  process.stdout.write(`wrote ${relativePath(out)}\n`);
  process.stdout.write(`wrote ${relativePath(outMd)}\n`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  buildCheckpointContinuationControl,
  buildReport,
  markdownReport,
  main,
};
