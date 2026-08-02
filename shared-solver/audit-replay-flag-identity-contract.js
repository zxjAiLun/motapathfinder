"use strict";

const assert = require("node:assert");
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
const CONTRACT_SCHEMA = "motapathfinder.pr-5.1a1-replay-flag-identity.v1";
const DEFAULT_OUT = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1a1-replay-flag-identity-contract.json",
);
const DEFAULT_OUT_MD = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1a1-replay-flag-identity-contract.md",
);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/") || ".";
}

function generationCommit() {
  try {
    return require("node:child_process").execFileSync("git", ["rev-parse", "--short", "HEAD"], {
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

function buildCrossFloorControl() {
  const projectRoot = path.resolve(REPO_ROOT, "Only upV2.1", "Only upV2.1");
  const project = loadProject(projectRoot);
  const simulator = new StaticSimulator(project, {
    stopFloorId: null,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
  });
  const floorIds = ["MT1", "MT2"];
  const startState = simulator.createInitialState({ rank: "chaos" });
  startState.inventory.fly = 1;
  startState.hero.loc = { x: 6, y: 1, direction: "down" };
  simulator.stabilizeState(startState);
  const changeFloor = simulator.enumeratePrimitiveActions(startState).actions.find(
    (action) => action.kind === "changeFloor" && action.summary === "changeFloor@MT1:6,0",
  );
  requireCondition(changeFloor, "cross-floor control: changeFloor action is missing");
  const changedState = simulator.applyAction(cloneState(startState), changeFloor, { storeRoute: false });
  const floorFly = simulator.enumerateFloorFlyActions(changedState).find(
    (action) => action.kind === "floorFly" && action.targetFloorId === "MT1",
  );
  requireCondition(floorFly, "cross-floor control: floorFly back to MT1 is missing");
  const cleanFloorFly = stripTravelState(floorFly);
  const finalState = simulator.applyAction(cloneState(changedState), floorFly, { storeRoute: false });

  const divergentState = cloneState(changedState);
  divergentState.flags.__leaveLoc__.MT1.x -= 1;
  const divergentFinalState = simulator.applyAction(
    divergentState,
    { ...floorFly, travelState: divergentState },
    { storeRoute: false },
  );
  const startSnapshot = buildSolverSnapshot(project, startState, { floorIds });
  const firstDecision = decisionRecord(project, startState, changeFloor, changedState, floorIds, 1);
  const secondDecision = decisionRecord(project, changedState, floorFly, finalState, floorIds, 2);
  const finalSnapshot = buildSolverSnapshot(project, finalState, { floorIds });
  const divergentFinalSnapshot = buildSolverSnapshot(project, divergentFinalState, { floorIds });
  const routeRecord = {
    schema: "motapathfinder.route.v1",
    source: {
      commit: "shadow-control",
      solver: "static-simulator",
      profile: "pr-5.1a1-cross-floor-flag-control",
      rank: "chaos",
      projectTitle: project.data && project.data.firstData && project.data.firstData.title,
    },
    goal: { type: "floor", floorId: "MT1" },
    metadata: {
      replayFlagIdentityControl: {
        changeFloor: true,
        flyRecordPosition: project.defaultFlags && project.defaultFlags.flyRecordPosition === true,
        laterFloorFly: true,
      },
    },
    stats: { depth: 2, routeLength: 2 },
    start: {
      snapshot: startSnapshot,
      stateKey: buildDominanceKey(startState),
      dominanceKey: buildDominanceKey(startState),
      exactStateKey: buildStateKey(startState),
    },
    final: {
      snapshot: finalSnapshot,
      stateKey: buildDominanceKey(finalState),
      dominanceKey: buildDominanceKey(finalState),
      exactStateKey: buildStateKey(finalState),
      floorId: finalState.floorId,
    },
    decisions: [firstDecision, secondDecision],
    rawRoute: [],
    notes: [],
  };
  return {
    projectRoot,
    routeRecord,
    evidence: {
      changeFloorSummary: changeFloor.summary,
      floorFlySummary: floorFly.summary,
      flyRecordPosition: project.defaultFlags && project.defaultFlags.flyRecordPosition === true,
      leaveLocAfterChangeFloor: cloneJson(changedState.flags.__leaveLoc__),
      finalFloor: finalState.floorId,
      finalHeroLoc: cloneJson(finalState.hero.loc),
      divergentFinalHeroLoc: cloneJson(divergentFinalState.hero.loc),
      expectedFinalFlags: cloneJson(finalSnapshot.flags),
      divergentFinalFlags: cloneJson(divergentFinalSnapshot.flags),
    },
  };
}

function makeShadowReplayApi() {
  return {
    async launchRuntimeSession(routeRecord) {
      return {
        url: "shadow://replay/pr-5.1a1",
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
      const leaveLoc = runtime.snapshot && runtime.snapshot.flags && runtime.snapshot.flags.__leaveLoc__;
      const previousFloors = runtime.snapshot && runtime.snapshot.floors;
      runtime.snapshot = cloneJson(decision.postSnapshot);
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

async function runShadowContinuation(routeRecord, projectRoot, id) {
  const session = new ReplaySession({
    routeRecord,
    projectRoot,
    liveOptions: { runtimeAutoBattle: 1, stepDelayMs: 0 },
    replayApi: makeShadowReplayApi(),
  });
  try {
    const started = await session.start({ fromStep: 1 });
    assert.strictEqual(started.runtimeSnapshotIdentityMatches, true, `${id}: start identity`);
    assert.strictEqual(started.runtimeSolverExactStateMatches, true, `${id}: start solver identity`);
    assert.ok(started.runtimeSnapshotIdentity, `${id}: start identity hash`);
    const completed = await session.play({ stepDelayMs: 0 });
    assert.strictEqual(completed.state, "completed", `${id}: completed state`);
    assert.strictEqual(completed.runtimeSnapshotIdentityMatches, true, `${id}: final identity`);
    assert.strictEqual(completed.runtimeSolverExactStateMatches, true, `${id}: final solver identity`);
    assert.strictEqual(completed.runtimeSnapshotIdentity, completed.expectedRuntimeSnapshotIdentity, `${id}: final identity hash`);
    assert.strictEqual(
      session.lastRuntimeSnapshot.floorId,
      routeRecord.final.snapshot.floorId,
      `${id}: final runtime floor`,
    );
    assert.deepStrictEqual(
      session.lastRuntimeSnapshot.hero,
      routeRecord.final.snapshot.hero,
      `${id}: final runtime hero`,
    );
    return {
      id,
      state: completed.state,
      runtimeSnapshotIdentityMatches: completed.runtimeSnapshotIdentityMatches,
      runtimeSnapshotIdentity: completed.runtimeSnapshotIdentity,
      expectedRuntimeSnapshotIdentity: completed.expectedRuntimeSnapshotIdentity,
      runtimeSolverExactStateMatches: completed.runtimeSolverExactStateMatches,
      finalHeroLoc: cloneJson(session.lastRuntimeSnapshot.hero.loc),
      finalLeaveLoc: cloneJson((session.lastRuntimeSnapshot.flags || {}).__leaveLoc__ || null),
    };
  } finally {
    await session.closeRuntimeOnly();
  }
}

async function runNonnumericSessionControl(routeRecord, projectRoot) {
  const session = new ReplaySession({
    routeRecord,
    projectRoot,
    replayApi: makeShadowReplayApi(),
  });
  try {
    await assert.rejects(
      () => session.start({ fromStep: parseFromStep("abc") }),
      (error) => error && error.code === "REPLAY_STEP_OUT_OF_RANGE" && error.statusCode === 400,
    );
    assert.strictEqual(session.runtime, null);
    assert.strictEqual(session.state, "idle");
    return {
      rejected: true,
      code: "REPLAY_STEP_OUT_OF_RANGE",
      statusCode: 400,
      runtimeLaunched: false,
      sessionState: session.state,
    };
  } finally {
    await session.closeRuntimeOnly();
  }
}

function buildMismatchEvidence(crossFloor) {
  const route = crossFloor.routeRecord;
  const expected = route.decisions[1].postSnapshot;
  const actual = cloneJson(crossFloor.evidence.divergentFinalFlags ? crossFloor.routeRecord.final.snapshot : expected);
  actual.flags = cloneJson(crossFloor.evidence.divergentFinalFlags);
  actual.hero = {
    ...cloneJson(actual.hero),
    loc: cloneJson(crossFloor.evidence.divergentFinalHeroLoc),
  };
  const options = {
    runtimeAutoBattle: 1,
    routeStartSnapshot: route.start.snapshot,
  };
  const mismatch = diffRouteSnapshot(expected, actual, options, ["crossFloor", "floorFly"]);
  const identity = buildRuntimeSnapshotIdentityPair(expected, actual, options);
  assert.ok(mismatch, "cross-floor mismatch control must reject altered __leaveLoc__");
  assert.strictEqual(identity.matches, false, "cross-floor mismatch control must change runtime identity");
  assert.notStrictEqual(
    crossFloor.evidence.finalHeroLoc.x,
    crossFloor.evidence.divergentFinalHeroLoc.x,
    "floorFly landing must depend on the recorded leave location",
  );
  return {
    mismatch,
    expectedRuntimeSnapshotIdentity: identity.expected,
    divergentRuntimeSnapshotIdentity: identity.actual,
    identityMatches: identity.matches,
    expectedFinalHeroLoc: crossFloor.evidence.finalHeroLoc,
    divergentFinalHeroLoc: crossFloor.evidence.divergentFinalHeroLoc,
  };
}

async function buildReport() {
  const whiteInput = ensureFixedRoute(FIXED_INPUTS.find((input) => input.tower === "whiteisland"));
  const checkpoint = buildCheckpointRoute(whiteInput.routeRecord, 1, { projectRoot: whiteInput.projectRoot });
  const checkpointLeaveLoc = (((checkpoint.start || {}).snapshot || {}).flags || {}).__leaveLoc__ || null;
  requireCondition(checkpointLeaveLoc && checkpointLeaveLoc.Start, "checkpoint must carry expected Start __leaveLoc__");
  const checkpointContinuation = await runShadowContinuation(
    checkpoint,
    whiteInput.projectRoot,
    "whiteisland-checkpoint-flag-identity",
  );

  const crossFloor = buildCrossFloorControl();
  const crossFloorContinuation = await runShadowContinuation(
    crossFloor.routeRecord,
    crossFloor.projectRoot,
    "onlyup-changeFloor-floorFly-identity",
  );
  const mismatch = buildMismatchEvidence(crossFloor);

  assert.strictEqual(parseFromStep("abc"), "abc", "CLI must preserve nonnumeric from-step input");
  const cliNonnumericSession = await runNonnumericSessionControl(
    whiteInput.routeRecord,
    whiteInput.projectRoot,
  );

  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "replay-flag-identity-shadow",
      entrypoint: "shared-solver/lib/live-replay.js",
      session: "shared-solver/lib/replay-session.js",
      fixedInputSource: "PR-4.8b WhiteIsland checkpoint plus a real OnlyUp simulator cross-floor control",
      deterministicFullReportRebuild: true,
      generationCommit: generationCommit(),
      liveRuntimeExecuted: false,
      productionSolverChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      routeSelectionSemanticsChanged: false,
    },
    scope: {
      shadowOnly: true,
      displaySnapshotCompatibilityIdentity: "normalized snapshot comparison for replay display/continuation compatibility",
      runtimeSnapshotIdentity: "sha256 of normalized full runtime snapshot including flags.__leaveLoc__ and floor mutations",
      persistedSolverExactStateKey: "reported separately as route boundary metadata; never substituted with display identity",
      productionSearchSemanticsChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      routeSelectionSemanticsChanged: false,
    },
    controls: {
      cliNonnumeric: {
        rawInput: "abc",
        preservedByRouteGui: parseFromStep("abc"),
        sessionContract: "REPLAY_STEP_OUT_OF_RANGE / HTTP 400 before runtime launch",
        session: cliNonnumericSession,
      },
      checkpoint: {
        sourceProfile: whiteInput.routeRecord.source.profile,
        sourceStep: 1,
        expectedRuntimeFlags: { __leaveLoc__: checkpointLeaveLoc },
        continuation: checkpointContinuation,
      },
      crossFloor: {
        routeSignature: routeSignature(crossFloor.routeRecord),
        projectRoot: relativePath(crossFloor.projectRoot),
        actions: {
          changeFloor: crossFloor.evidence.changeFloorSummary,
          floorFly: crossFloor.evidence.floorFlySummary,
        },
        flyRecordPosition: crossFloor.evidence.flyRecordPosition,
        leaveLocAfterChangeFloor: crossFloor.evidence.leaveLocAfterChangeFloor,
        continuation: crossFloorContinuation,
        mismatchControl: mismatch,
      },
    },
  };
}

function markdownReport(report) {
  const checkpoint = report.controls.checkpoint;
  const crossFloor = report.controls.crossFloor;
  const lines = [
    "# PR-5.1a1 Replay Flag Identity Hardening",
    "",
    `Schema: \`${report.schema}\``,
    "Status: completed",
    "Mode: replay-flag-identity-shadow",
    "",
    "This audit keeps persisted solver exact-state keys separate from the replay compatibility snapshot identity. The latter is a stable SHA-256 over the normalized full runtime snapshot and retains `flags.__leaveLoc__`.",
    "",
    "## Controls",
    "",
    "| Control | Evidence | Result |",
    "| --- | --- | --- |",
    `| CLI nonnumeric | raw=${report.controls.cliNonnumeric.rawInput} preserved=${report.controls.cliNonnumeric.preservedByRouteGui} | session rejects before launch |`,
    `| WhiteIsland checkpoint | ${checkpoint.sourceProfile} step ${checkpoint.sourceStep} | __leaveLoc__ populated; identity=${checkpoint.continuation.runtimeSnapshotIdentityMatches} |`,
    `| OnlyUp cross-floor | ${crossFloor.actions.changeFloor} -> ${crossFloor.actions.floorFly} | flyRecordPosition=${crossFloor.flyRecordPosition}; final=${JSON.stringify(crossFloor.continuation.finalHeroLoc)} |`,
    "",
    "## Cross-floor identity witness",
    "",
    `- Recorded leave locations after changeFloor: \`${JSON.stringify(crossFloor.leaveLocAfterChangeFloor)}\``,
    `- Correct floorFly landing: \`${JSON.stringify(crossFloor.mismatchControl.expectedFinalHeroLoc)}\``,
    `- Altered __leaveLoc__ landing: \`${JSON.stringify(crossFloor.mismatchControl.divergentFinalHeroLoc)}\``,
    `- Altered snapshot rejected: \`${crossFloor.mismatchControl.identityMatches === false}\``,
    `- Mismatch path: \`${crossFloor.mismatchControl.mismatch}\``,
    "",
    "## Scope boundary",
    "",
    "This is a shadow-only replay identity audit. It does not change solver, DP key, dominance, agenda, capacity, route selection, or default strategy semantics.",
    "",
  ];
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
  process.stdout.write(`replay flag identity contract wrote ${out}\n`);
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
  buildCrossFloorControl,
  buildReport,
  markdownReport,
};
