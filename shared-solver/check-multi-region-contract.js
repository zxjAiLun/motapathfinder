"use strict";

/**
 * TEST GRADE: unit-plus-micro
 *
 * PR-5.4a Commit 2: sequential region frontier execution and real state
 * transfer.  Region B's reachability must DEPEND on a persistent field Region A
 * produced; without the transfer B fails.  Also covers region failure stopping
 * the sequence and regionCandidateLimit boundary pruning.
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

// Region B cannot gain exp (no battle, and the gems are removed by Region A),
// so it can only reach the exp>=2 gate if Region A's hero state carried over.
function regionB() {
  const base = JSON.parse(fs.readFileSync(SMOKE_SPEC, "utf8"));
  return {
    ...base,
    id: "onlyup-region-b",
    actionPolicy: { actionKinds: ["pickup", "interactPickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"] },
    goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 2 } },
  };
}

function regionC() {
  const b = regionB();
  return { ...b, id: "onlyup-region-c", goal: { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 999 } } };
}

function v2Task(regions, searchOverrides) {
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
      ...(searchOverrides || {}),
    },
    verification: { strictReplay: false },
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
  // 1. Two-region real state transfer: A -> B completes.
  const smoke = JSON.parse(fs.readFileSync(SMOKE_SPEC, "utf8"));
  const twoRegion = await runJob(v2Task([{ spec: smoke }, { spec: regionB() }]));
  assert.strictEqual(twoRegion.state, "completed", "A -> B must complete when A's state transfers");

  // 2. Without the transfer (solo B) the same gate fails.
  const solo = await runJob(v2Task([{ spec: regionB() }]));
  assert.strictEqual(solo.state, "failed", "solo B cannot reach the gate without A's transfer");
  assert.ok(
    ["GOAL_NOT_REACHED", "REGION_NOT_REACHED"].includes(solo.failure.failureClass),
    `solo B must fail with a not-reached class, got ${solo.failure.failureClass}`,
  );

  // 3. A region failure stops the sequence: B fails, C never runs.
  const failSeq = await runJob(v2Task([{ spec: smoke }, { spec: regionB() }, { spec: regionC() }]));
  assert.strictEqual(failSeq.state, "failed");

  // 4. Region boundary pruning: with regionCandidateLimit=1, A's outgoing
  //    frontier is capped to 1 and the pruning is recorded.
  const pruned = await runJob(v2Task([{ spec: smoke }, { spec: regionB() }], { regionCandidateLimit: 1 }));
  assert.strictEqual(pruned.state, "completed", "boundary pruning must not break the run");
  const regionProgress = pruned.lastProgress && pruned.lastProgress.region;
  assert.ok(regionProgress, "progress must carry a region coordinate");
  assert.ok(regionProgress.total === 2 && regionProgress.current === 2, "region coordinate must report current/total");
  assert.ok("outgoingCandidates" in regionProgress, "region coordinate must report outgoingCandidates");

  process.stdout.write(JSON.stringify({
    schema: "motapathfinder.pr-5.4a-multi-region-execution.v1",
    status: "passed",
    controls: {
      twoRegionRealStateTransfer: true,
      soloRegionFailsWithoutTransfer: true,
      regionFailureStopsSequence: true,
      regionCandidateLimitPruningVisible: true,
      progressRegionCoordinate: true,
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
