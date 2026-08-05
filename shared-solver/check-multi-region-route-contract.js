"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4a Commit 3: multi-region-route.v1 composite, exact boundary state
 * fingerprints, result.regions semantics, and the unified first-region entry
 * transition (including arrival events).  The Chromium live composite replay
 * is covered separately by check-solver-job-live.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { compileSolveTaskV2 } = require("./lib/solve-task-v2");
const { SolverJobManager } = require("./lib/solver-job-manager");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_SPEC = path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

function model() {
  return {
    heroFields: {
      hp: "dominance",
      atk: "key",
      def: "key",
      mdef: "key",
      lv: "key",
      exp: "key",
      money: "disabled",
      equipment: "key",
      followers: "disabled",
      hpmax: "disabled",
      mana: "disabled",
      manamax: "disabled",
    },
  };
}

function regionB() {
  const base = JSON.parse(fs.readFileSync(SMOKE_SPEC, "utf8"));
  return {
    ...base,
    id: "onlyup-region-b",
    actionPolicy: { actionKinds: ["pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"] },
    goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
  };
}

function v2Task(regions, overrides) {
  return {
    schema: "motapathfinder.solve-task.v2",
    tower: { id: "onlyup-v2.1", projectRoot: ONLY_UP_ROOT, regions },
    model: model(),
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 10000,
      candidateLimit: 2,
      regionCandidateLimit: 8,
      ...((overrides && overrides.search) || {}),
    },
    verification: { strictReplay: false },
    ...(overrides || {}),
  };
}

function waitForJob(manager, id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const job = manager.getJob(id);
      if (job && (job.state === "completed" || job.state === "failed" || job.state === "cancelled")) {
        resolve(job);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for job ${id}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

async function runJob(rawTask) {
  const task = compileSolveTaskV2(rawTask);
  const manager = new SolverJobManager({ maxConcurrentJobs: 1, allowInProcess: true });
  const job = manager.submit(task);
  return waitForJob(manager, job.id, 120000);
}

async function main() {
  const smoke = JSON.parse(fs.readFileSync(SMOKE_SPEC, "utf8"));

  // 1. First-region floor entry is executed (unified entry helper): the
  //    initial state carries the floor's arrival events (book/fly from MT1
  //    firstArrive) and the requested loc.
  const floorFirst = await runJob(v2Task([{
    spec: {
      ...JSON.parse(JSON.stringify(smoke)),
      start: { type: "floor", floorId: "MT1", x: 5, y: 7, direction: "down" },
    },
  }]));
  assert.strictEqual(floorFirst.state, "completed", "first-region floor entry must complete");
  const firstRecord = floorFirst.result.route.record;
  assert.strictEqual(firstRecord.schema, "motapathfinder.multi-region-route.v1");
  const firstSnapshot = firstRecord.regions[0].record.start.snapshot;
  assert.strictEqual(
    firstSnapshot.hero.loc.x,
    5,
    "first-region floor entry must apply the requested loc (not the spawn)",
  );
  assert.strictEqual(firstSnapshot.hero.loc.y, 7);
  assert.ok(
    firstSnapshot.inventory && (firstSnapshot.inventory.book === 1 || firstSnapshot.inventory.fly === 1),
    "first-region floor entry must run arrival events (book/fly granted)",
  );

  // 2. Two-region composite: boundary fingerprints match and result.regions
  //    carries per-region success semantics.
  const twoRegion = await runJob(v2Task([{ spec: smoke }, { spec: regionB() }]));
  assert.strictEqual(twoRegion.state, "completed");
  const composite = twoRegion.result.route.record;
  assert.strictEqual(composite.schema, "motapathfinder.multi-region-route.v1");
  assert.strictEqual(composite.regions.length, 2, "composite must contain one entry per region");
  assert.strictEqual(composite.boundaryFingerprintsMatch, true);
  composite.regions.forEach((entry, index) => {
    assert.strictEqual(entry.index, index);
    assert.ok(entry.record, "each composite region must carry a route record");
    assert.ok(entry.exactBoundaryStateFingerprint, "each region must carry an exact boundary fingerprint");
    assert.ok(entry.outputExactBoundaryStateFingerprint, "each region must carry its output exact fingerprint");
  });
  assert.ok(twoRegion.result.regions, "result must carry regions[] summaries");
  assert.strictEqual(twoRegion.result.regions.length, 2);
  assert.strictEqual(twoRegion.result.regions[0].status, "completed");
  assert.strictEqual(twoRegion.result.regions[1].status, "completed");

  // 3. Result regions[] failure semantics: a failing second region is recorded.
  const unreachable = JSON.parse(JSON.stringify(regionB()));
  unreachable.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 999 } };
  const failing = await runJob(v2Task([{ spec: smoke }, { spec: unreachable }]));
  assert.strictEqual(failing.state, "failed");
  assert.ok(failing.result.regions, "a failed multi-region job must still carry regions[]");
  assert.strictEqual(failing.result.regions.length, 2);
  assert.strictEqual(failing.result.regions[0].status, "completed");
  assert.strictEqual(failing.result.regions[1].status, "failed");
  assert.ok(failing.result.regions[1].failure, "the failing region must carry its failure");

  // 4. Exact boundary fingerprint distinguishes states (the replay boundary
  //    proof uses exact fingerprints, not the DP identity key).
  const { exactStateFingerprint, projectedSnapshotsMatch } = require("./lib/solver-job");
  const stateA = {
    floorId: "MT1",
    hero: { hp: 100, loc: { x: 1, y: 1, direction: "down" } },
    inventory: { book: 1 },
    flags: { autoBattle: 1 },
    floors: { MT1: { removed: [], replaced: [] } },
    route: [],
  };
  const stateB = JSON.parse(JSON.stringify(stateA));
  stateB.hero.loc.direction = "up";
  assert.notStrictEqual(
    exactStateFingerprint(stateA),
    exactStateFingerprint(stateB),
    "exactStateFingerprint must distinguish direction (unlike the DP identity key)",
  );

  // 5. Winner-chain ancestry: Region A produces two candidates; A0 ranks
  //    first locally (max HP, battled the redSlime at 2,8) but only A1 (which
  //    kept the redSlime present) can satisfy Region B's presentTiles gate.
  //    The composite Region A record must follow A1, never default to A0.
  const redSlimeSpec = JSON.parse(JSON.stringify(regionB()));
  redSlimeSpec.goal = {
    type: "heroAtLeast",
    floorId: "MT1",
    minHero: { exp: 2 },
    presentTiles: [{ floorId: "MT1", x: 2, y: 8 }],
  };
  const ancestry = await runJob(v2Task([{ spec: smoke }, { spec: redSlimeSpec }]));
  assert.strictEqual(ancestry.state, "completed", "Region B must succeed via the candidate that kept the redSlime");
  const ancestryComposite = ancestry.result.route.record;
  assert.strictEqual(ancestryComposite.schema, "motapathfinder.multi-region-route.v1");
  assert.strictEqual(ancestryComposite.boundaryFingerprintsMatch, true);
  const regionAEntry = ancestryComposite.regions[0];
  // The winning chain must have used the non-first candidate: Region B's
  // winner came from input index 1 (the candidate that kept the redSlime),
  // never defaulting to input 0.
  assert.strictEqual(
    ancestryComposite.regions[1].regionInputIndex,
    1,
    "the composite must follow the non-first winner candidate into Region B",
  );
  // Region A's record in the chain must be the candidate that kept the
  // redSlime (2,8 present), i.e. not the local-first candidate A0.
  const ancestrySnapshot = regionAEntry.record.final.snapshot;
  const removed = (ancestrySnapshot.floors && ancestrySnapshot.floors.MT1 && ancestrySnapshot.floors.MT1.removed) || [];
  assert.ok(!removed.includes("2,8"), "the Region A record in the winning chain must NOT have removed the redSlime (2,8)");

  // 6. Runtime projection completeness + negative pollution: the boundary
  //    replay projection must detect replaced-tile and equipment differences.
  const baseSnap = {
    floorId: "MT1",
    hero: { hp: 100, atk: 3, def: 1, mdef: 10, lv: 1, exp: 2, money: 0, hpmax: 120, mana: 0, manamax: 0, loc: { x: 5, y: 7, direction: "down" }, equipment: [], followers: [] },
    inventory: { book: 1 },
    flags: { autoBattle: 1 },
    floors: { MT1: { removed: ["2,7"], replaced: [] } },
  };
  assert.strictEqual(projectedSnapshotsMatch(baseSnap, JSON.parse(JSON.stringify(baseSnap))), true, "matching snapshots must pass");
  const replacedPolluted = JSON.parse(JSON.stringify(baseSnap));
  replacedPolluted.floors.MT1.replaced = ["3,9"];
  assert.strictEqual(projectedSnapshotsMatch(baseSnap, replacedPolluted), false, "a replaced-tile difference must fail the boundary projection");
  const equipmentPolluted = JSON.parse(JSON.stringify(baseSnap));
  equipmentPolluted.hero.equipment = ["sword"];
  assert.strictEqual(projectedSnapshotsMatch(baseSnap, equipmentPolluted), false, "an equipment difference must fail the boundary projection");

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4a-multi-region-route.v1",
    status: "passed",
    controls: {
      firstRegionFloorEntryExecuted: true,
      arrivalEventsRun: true,
      compositeSchemaAndRecords: true,
      boundaryFingerprintsMatch: true,
      exactBoundaryFingerprintsPresent: true,
      resultRegionsSuccessSemantics: true,
      resultRegionsFailureSemantics: true,
      exactFingerprintDistinguishesDirection: true,
    winnerChainFollowsNonFirstCandidate: true,
    projectionRejectsReplacedPollution: true,
    projectionRejectsEquipmentPollution: true,
    },
  }, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
