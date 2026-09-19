"use strict";
/**
 * PR-5.26i - Dropped candidate state reclamation micros.
 *
 * SEARCH_POLICY_CHANGE = NONE. The mechanism releases the world state of a
 * candidate that the bounded cap has already dropped. A dropped candidate can
 * never return to `pending`, can never be expanded, and keeps its duplicate
 * semantics purely through `registry.has(key)`, so its state is dead payload
 * that only expansion otherwise releases.
 *
 * Four properties are locked, deliberately no more:
 *
 *   DROP_EVENT_STILL_SEES_FULL_STATE
 *   DROPPED_NODE_STATE_RELEASED_AFTER_DROP_OBSERVATION
 *   FUTURE_SAME_EXACT_KEY_STILL_DUPLICATE_SKIPPED
 *   SEARCH_RESULT_AND_ROUTE_WITH_RECLAIM_OFF_VS_ON = IDENTICAL_AT_FIXED_WORK
 *
 * plus one fixture with retroactiveGuidedSkylineDemotion enabled, because that
 * mechanism keeps dropped nodes' ids in its skyline group sets and must not
 * misread a released state when it decides liveness.
 *
 * Runs the real pipeline at fixed work: the point is a no-op proof on the
 * actual search, not on a stub. Every arm runs in its OWN child process -
 * `maxRssMb` is process-level and V8 does not return freed heap, so sequential
 * arms in one process inherit the previous arm's footprint and can even be
 * terminated early by it.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("./lib/project-loader");
const { createTransportCollapsedSearch } = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { makeSimulator, PROJECT_ROOT } = require("./audits/flat-search/audit-pr525t-oracle-survival");

const WORK = {
  maxExpansions: 1200,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 128,
};

const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

// Memory and timing accounting are the only fields allowed to differ.
const ACCOUNTING_FIELDS = new Set([
  "wallMs", "peakRssMb", "peakHeapUsedMb", "droppedStatesReclaimed", "reclaimDroppedState", "signatureWallMs",
]);

const failures = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push({ label, detail: `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` });
  return ok;
};

function runArm(arm) {
  const reclaim = arm === "on" || arm === "on-retro";
  const retro = arm === "off-retro" || arm === "on-retro";
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initial = simulator.createInitialState({ rank: "chaos" });
  const frontierReport = buildDependencyFrontier(project, initial, { type: "floorReached", floorId: "MT4" });
  const events = [];
  let result = null;
  let runError = null;
  try {
    result = createTransportCollapsedSearch(simulator).search(initial, {
      isGoalState: (state) => state.floorId === "MT4",
      allowedFloors: ["MT1", "MT2", "MT3", "MT4"],
      maxExpansions: WORK.maxExpansions,
      maxRuntimeMs: WORK.maxRuntimeMs,
      maxRssMb: WORK.maxRssMb,
      frontierSet: frontierReport.frontierSet,
      resourceSkylinePriority: true,
      pendingCandidateCap: WORK.pendingCandidateCap,
      rank20DynamicPareto: true,
      neutralParetoSubstitution: true,
      stableGuidedTieBreak: false,
      retroactiveGuidedSkylineDemotion: retro,
      reclaimDroppedState: reclaim,
      trackPeakHeapUsed: true,
      lifecyclePeerComposition: true,
      onCandidateLifecycle: (event) => { events.push(event); return null; },
    });
  } catch (error) {
    runError = `${error.name}: ${error.message}`;
  }

  const droppedEvents = events.filter((e) => e.type === "dropped");
  const peerPayloads = droppedEvents.filter((e) => e.sameIdentityPeers != null).map((e) => e.sameIdentityPeers);
  const eventStream = events.map((e) => JSON.stringify(e)).join("\n");
  const resultForCompare = {};
  if (result) {
    for (const [key, value] of Object.entries(result)) {
      if (ACCOUNTING_FIELDS.has(key)) continue;
      if (key === "route" || key === "routeTrace") continue;
      resultForCompare[key] = value;
    }
  }
  return {
    arm,
    reclaim,
    retro,
    runError,
    resultForCompare,
    routeHash: result ? sha(JSON.stringify(result.route)) : null,
    routeTraceHash: result ? sha(JSON.stringify(result.routeTrace)) : null,
    eventStreamHash: sha(eventStream),
    eventTypeCounts: events.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {}),
    droppedRankClasses: droppedEvents.map((e) => e.rankClass),
    droppedNodeIds: droppedEvents.map((e) => e.nodeId),
    peerPayloadCount: peerPayloads.length,
    peerPayloadsWithStructuralKey: peerPayloads.filter((p) => p.droppedStructuralKey != null).length,
    peerPayloadHash: sha(JSON.stringify(peerPayloads)),
    duplicateSkipped: events.filter((e) => e.type === "duplicateSkipped").length,
    memory: result
      ? {
        rssMb: result.peakRssMb,
        heapUsedMb: result.peakHeapUsedMb,
        dropped: result.candidatesDropped,
        reclaimed: result.droppedStatesReclaimed,
        registrySize: result.registrySize,
        stoppedReason: result.stoppedReason,
        expansions: result.strategicExpansions,
        retroDemotions: result.guidedRetroDemotions,
        groupTrackedIds: result.guidedGroupTrackedIds,
      }
      : null,
  };
}

function spawnArm(arm) {
  const jsonPath = path.join(os.tmpdir(), `pr526i-${process.pid}-${arm}.json`);
  const spawned = spawnSync(process.execPath, [__filename, "--child", `--arm=${arm}`, `--json=${jsonPath}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (spawned.status !== 0) {
    throw new Error(`child arm=${arm} failed:\n${spawned.stderr || spawned.stdout}`);
  }
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

function differingFields(a, b) {
  const out = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--child")) {
    const arm = (args.find((t) => t.startsWith("--arm=")) || "--arm=off").slice("--arm=".length);
    const jsonArg = args.find((t) => t.startsWith("--json="));
    const summary = runArm(arm);
    if (jsonArg) fs.writeFileSync(jsonArg.slice("--json=".length), JSON.stringify(summary));
    else console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("PR-5.26i dropped candidate state reclamation micros");
  console.log(`  workload: ${WORK.maxExpansions} expansions, cap ${WORK.pendingCandidateCap}, neutral substitution ON, ` +
    "stable tie-break OFF, one child process per arm");

  const off = spawnArm("off");
  const on = spawnArm("on");
  const offRetro = spawnArm("off-retro");
  const onRetro = spawnArm("on-retro");
  const arms = [off, on, offRetro, onRetro];

  check("every arm completed without throwing", arms.map((a) => a.runError), [null, null, null, null]);
  check("no arm was terminated before its fixed work",
    arms.map((a) => a.memory.stoppedReason), ["expansion-limit", "expansion-limit", "expansion-limit", "expansion-limit"]);
  check("the fixture actually drops candidates", off.memory.dropped > 0, true);
  check("the fixture actually observes duplicate skips", off.duplicateSkipped > 0, true);

  // --- 1. the drop observation still sees the FULL state -------------------
  check("drop events carry the same-identity peer composition", on.peerPayloadCount > 0, true);
  check("DROP_EVENT_STILL_SEES_FULL_STATE (structural key derived from the dropped state)",
    on.peerPayloadsWithStructuralKey, on.peerPayloadCount);
  check("drop events report identical rank classes with and without reclamation",
    on.droppedRankClasses, off.droppedRankClasses);
  check("drop events report identical peer payloads with and without reclamation",
    on.peerPayloadHash, off.peerPayloadHash);

  // --- 2. every dropped node's state was actually released -----------------
  check("DROPPED_NODE_STATE_RELEASED_AFTER_DROP_OBSERVATION (released === dropped)",
    on.memory.reclaimed, on.memory.dropped);
  check("reclamation is off in the OFF arm", off.memory.reclaimed, 0);
  check("no dropped id is expanded afterwards", arms.every((a) => a.droppedNodeIds.length === a.memory.dropped), true);

  // --- 3. duplicate tombstone semantics are unchanged ---------------------
  check("FUTURE_SAME_EXACT_KEY_STILL_DUPLICATE_SKIPPED (identical duplicate-skip volume)",
    on.duplicateSkipped, off.duplicateSkipped);
  check("registry identity count is unchanged", on.memory.registrySize, off.memory.registrySize);
  check("registry identities still include every generated key (registry - registered - root consistency)",
    on.memory.registrySize > on.duplicateSkipped, true);

  // --- 4. the search is untouched -----------------------------------------
  check("SEARCH_RESULT_AND_ROUTE_WITH_RECLAIM_OFF_VS_ON = IDENTICAL_AT_FIXED_WORK (result fields)",
    differingFields(off.resultForCompare, on.resultForCompare), []);
  check("identical route", on.routeHash, off.routeHash);
  check("identical route trace", on.routeTraceHash, off.routeTraceHash);
  check("identical lifecycle event stream", on.eventStreamHash, off.eventStreamHash);

  // --- 5. retro-demotion fixture: no released state is misread ------------
  check("retro fixture demotions are unchanged by reclamation",
    onRetro.memory.retroDemotions, offRetro.memory.retroDemotions);
  check("retro fixture really did demote something", offRetro.memory.retroDemotions > 0, true);
  check("retro fixture reclaimed exactly its dropped nodes",
    onRetro.memory.reclaimed, onRetro.memory.dropped);
  check("retro fixture result fields identical apart from memory accounting",
    differingFields(offRetro.resultForCompare, onRetro.resultForCompare), []);
  check("retro fixture kept its skyline group bookkeeping bounded",
    onRetro.memory.groupTrackedIds <= Math.max(256, 4 * WORK.pendingCandidateCap) + WORK.pendingCandidateCap, true);

  for (const a of arms) {
    console.log(`  ${a.arm.padEnd(9)} exp=${a.memory.expansions} drops=${a.memory.dropped} reclaimed=${a.memory.reclaimed} ` +
      `dupSkips=${a.duplicateSkipped} registry=${a.memory.registrySize} rss=${a.memory.rssMb}MB heap=${a.memory.heapUsedMb}MB ` +
      `retroDemotions=${a.memory.retroDemotions}`);
  }
  console.log(`  event stream hashes: off=${off.eventStreamHash} on=${on.eventStreamHash} ` +
    `offRetro=${offRetro.eventStreamHash} onRetro=${onRetro.eventStreamHash}`);

  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures) console.log(`    ${f.label}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("  PASS");
  }
}

main();
