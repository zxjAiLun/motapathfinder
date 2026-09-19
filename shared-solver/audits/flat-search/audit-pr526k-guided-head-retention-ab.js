"use strict";

/**
 * PR-5.26k - guided scheduler / retention decoupling A/B.
 *
 * The gate this round has to clear is not "the mechanism fires" but "the observed
 * blocker moves". PR-5.26j localized the first real prefix loss to checkpoint 29
 * (`battle:MT2:6,6:brownWizard`), a rank-10 guided candidate that was not even
 * pure-fill-kept, i.e. it never entered the active pool at all. This A/B asks
 * whether decoupling scheduler membership from the permanent rank-10 storage
 * entitlement lets the prefix advance past that point.
 *
 * Both arms, same commit, one child process each:
 *   CAP = 1024, MAX_EXPANSIONS = 20000, MAX_RUNTIME_MS = 0, RSS 2048MB,
 *   rank20DynamicPareto ON, neutralParetoSubstitution ON,
 *   stableGuidedTieBreak OFF, retroactiveGuidedSkylineDemotion OFF,
 *   reclaimDroppedState ON, same front: only `guidedHeadRetention` differs.
 *
 * Pre-declared success: LAST_EXPANDED_CHECKPOINT_ON > LAST_EXPANDED_CHECKPOINT_OFF
 * OR the ON arm finds MT4. Nothing here predicts that checkpoint 29 itself must
 * expand - the whole trajectory changes, so the identity of the first loss may
 * move even if the depth does not.
 *
 * `ORACLE_KEYS_AFFECT_SEARCH_DECISIONS = FALSE`: the observer only filters
 * post-hoc, and the fate table keeps oracle-keyed events only.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadProject } = require("../../lib/project-loader");
const { createTransportCollapsedSearch } = require("../../lib/transport-collapse");
const { buildDependencyFrontier } = require("../../lib/dependency-frontier");
const { makeSimulator, PROJECT_ROOT, classifyStage } = require("./audit-pr525t-oracle-survival");
const { classifyOracleRoute } = require("./audit-pr526j-mt4-bottleneck-localization");

const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "routes", "generated", "pr526k-guided-head-retention-ab.json");

const FROZEN = {
  initialRank: "chaos",
  region: ["MT1", "MT2", "MT3", "MT4"],
  goalFloorId: "MT4",
  maxExpansions: 20000,
  maxRuntimeMs: 0,
  maxRssMb: 2048,
  pendingCandidateCap: 1024,
  rank20DynamicPareto: true,
  neutralParetoSubstitution: true,
  stableGuidedTieBreak: false,
  retroactiveGuidedSkylineDemotion: false,
  reclaimDroppedState: true,
};

const PR526J_REFERENCE = { lastExpandedCheckpoint: 28, firstNotSurvivingCheckpoint: 29, firstLossStage: "DROPPED_BY_CAP" };

function runArm(arm) {
  const guidedHeadRetention = arm === "on";
  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: FROZEN.initialRank });
  const frontierReport = buildDependencyFrontier(project, initialState, {
    type: "floorReached",
    floorId: FROZEN.goalFloorId,
  });
  const oracle = classifyOracleRoute(simulator, project, frontierReport.frontierSet);

  const oracleKeys = new Map(oracle.rows.map((r) => [r.postKey, r]));
  const events = new Map();
  let totalEvents = 0;
  let retained = 0;
  let expansionIndex = 0;
  const result = createTransportCollapsedSearch(simulator).search(initialState, {
    isGoalState: (state) => state.floorId === FROZEN.goalFloorId,
    allowedFloors: FROZEN.region,
    maxExpansions: FROZEN.maxExpansions,
    maxRuntimeMs: FROZEN.maxRuntimeMs,
    maxRssMb: FROZEN.maxRssMb,
    frontierSet: frontierReport.frontierSet,
    resourceSkylinePriority: true,
    pendingCandidateCap: FROZEN.pendingCandidateCap,
    rank20DynamicPareto: FROZEN.rank20DynamicPareto,
    neutralParetoSubstitution: FROZEN.neutralParetoSubstitution,
    stableGuidedTieBreak: FROZEN.stableGuidedTieBreak,
    retroactiveGuidedSkylineDemotion: FROZEN.retroactiveGuidedSkylineDemotion,
    reclaimDroppedState: FROZEN.reclaimDroppedState,
    guidedHeadRetention,
    onCandidateLifecycle: (event) => {
      totalEvents += 1;
      if (event.type === "expanded" && event.strategicExpansion != null) expansionIndex = event.strategicExpansion;
      if (typeof event.exactKey === "string" && oracleKeys.has(event.exactKey)) {
        retained += 1;
        const list = events.get(event.exactKey) || [];
        list.push({ ...event, observedAtExpansion: expansionIndex });
        events.set(event.exactKey, list);
      }
      return null;
    },
  });

  const last = (list, type) => {
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].type === type) return list[i];
    return null;
  };
  const table = [];
  for (const row of oracle.rows) {
    if (!row.strategic) continue;
    const list = events.get(row.postKey) || [];
    const types = new Set(list.map((e) => e.type));
    const classified = last(list, "classified");
    const dropped = last(list, "dropped");
    const expanded = last(list, "expanded");
    const registered = last(list, "registered");
    table.push({
      decisionIndex: row.decisionIndex,
      semanticIdentity: row.semanticIdentity,
      floorAfter: row.floorAfter,
      staticClass: row.staticClass,
      generated: types.has("strategicGenerated"),
      registered: types.has("registered"),
      dropped: types.has("dropped"),
      expanded: types.has("expanded"),
      stage: classifyStage(list),
      frontierGuided: classified ? classified.frontierGuided === true : null,
      guidedAdmitted: classified ? classified.guidedAdmitted === true : null,
      combatProgress: classified ? classified.combatProgress === true : null,
      rankClassDerived: classified
        ? (classified.guidedAdmitted === true && !guidedHeadRetention ? 10 : (classified.combatProgress === true ? 20 : 30))
        : null,
      registeredAt: registered ? registered.registeredAtStrategicExpansion : null,
      droppedAt: dropped ? dropped.observedAtExpansion : null,
      expandedAt: expanded ? expanded.strategicExpansion : null,
      dropAttribution: dropped
        ? {
          pureFillKept: dropped.pureFillKept,
          displacedByFifoHeadProtection: dropped.displacedByFifoHeadProtection === true,
          displacedByGuidedHeadProtection: dropped.displacedByGuidedHeadProtection === true,
          rankClass: dropped.rankClass,
          rank20ParetoDominated: dropped.rank20ParetoDominated,
          pendingRankCounts: dropped.trim ? dropped.trim.pendingRankCounts : null,
          keptRankCounts: dropped.trim ? dropped.trim.keptRankCounts : null,
          rank0PlusRank10Pending: dropped.trim ? dropped.trim.rank0PlusRank10Pending : null,
        }
        : null,
    });
  }
  const expandedRows = table.filter((r) => r.expanded);
  const notSurviving = table.filter((r) => !r.expanded);
  const firstLoss = notSurviving.length === 0 ? null : notSurviving[0];
  const verdictRows = {
    lastExpandedCheckpoint: expandedRows.length === 0 ? null : expandedRows[expandedRows.length - 1].decisionIndex,
    firstNotSurvivingCheckpoint: firstLoss ? firstLoss.decisionIndex : null,
    firstLossStage: firstLoss ? firstLoss.stage : null,
    survived: expandedRows.length,
    strategicCheckpoints: table.length,
    nonSurvivingStageCounts: notSurviving.reduce((acc, r) => {
      acc[r.stage] = (acc[r.stage] || 0) + 1;
      return acc;
    }, {}),
  };

  return {
    arm,
    guidedHeadRetention,
    search: {
      found: result.found,
      routeLength: result.route ? result.route.length : null,
      strategicExpansions: result.strategicExpansions,
      stoppedReason: result.stoppedReason,
      candidatesDropped: result.candidatesDropped,
      droppedStatesReclaimed: result.droppedStatesReclaimed,
      deepestReachedFloorOrdinal: result.deepestReachedFloorOrdinal,
      deepestStrategicDepth: result.deepestStrategicDepth,
      peakRssMb: result.peakRssMb,
      wallMs: result.wallMs,
      registrySize: result.registrySize,
      guidedExpansions: result.guidedExpansions,
      neutralExpansions: result.neutralExpansions,
      guidedAdmittedGenerated: result.guidedAdmittedGenerated,
      liveGuidedPendingAtEnd: result.liveGuidedPendingAtEnd,
      rank10PendingAtEnd: result.rank10PendingAtEnd,
      guidedHeadProtectionOpportunities: result.guidedHeadProtectionOpportunities,
      guidedHeadProtected: result.guidedHeadProtected,
      guidedHeadWouldHaveDroppedWithoutProtection: result.guidedHeadWouldHaveDroppedWithoutProtection,
      guidedHeadDisplacedAfterProtection: result.guidedHeadDisplacedAfterProtection,
      guidedHeadStaleTopPops: result.guidedHeadStaleTopPops,
      guidedHeadNotPendingAtTrim: result.guidedHeadNotPendingAtTrim,
      fifoHeadProtected: result.fifoHeadProtected,
      fifoHeadProtectionOpportunities: result.fifoHeadProtectionOpportunities,
      routeHash: crypto.createHash("sha256").update(JSON.stringify(result.route)).digest("hex").slice(0, 16),
    },
    verdict: verdictRows,
    firstLoss,
    lifecycleEventsTotal: totalEvents,
    lifecycleEventsOracleMatched: retained,
    table,
  };
}

function spawnArm(arm) {
  const jsonPath = path.join(os.tmpdir(), `pr526k-${process.pid}-${arm}.json`);
  const spawned = spawnSync(process.execPath, [__filename, "--child", `--arm=${arm}`, `--json=${jsonPath}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (spawned.status !== 0) throw new Error(`child arm=${arm} failed:\n${spawned.stderr || spawned.stdout}`);
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  try { fs.unlinkSync(jsonPath); } catch (_) { /* best effort */ }
  return summary;
}

function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((t) => t.startsWith("--out="));
  const outPath = outArg ? path.resolve(outArg.slice("--out=".length)) : DEFAULT_OUT;
  if (args.includes("--child")) {
    const arm = (args.find((t) => t.startsWith("--arm=")) || "--arm=off").slice("--arm=".length);
    const jsonArg = args.find((t) => t.startsWith("--json="));
    const summary = runArm(arm);
    if (jsonArg) fs.writeFileSync(jsonArg.slice("--json=".length), JSON.stringify(summary));
    else console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("PR-5.26k guided head retention A/B");
  console.log(`  ${FROZEN.maxExpansions} expansions, no wall limit, cap ${FROZEN.pendingCandidateCap}, ` +
    "dynamic Pareto ON, neutral substitution ON, stable tie-break OFF, retro demotion OFF, reclaim ON");

  const off = spawnArm("off");
  const on = spawnArm("on");

  const lastOff = off.verdict.lastExpandedCheckpoint;
  const lastOn = on.verdict.lastExpandedCheckpoint;
  const checks = {
    BOTH_ARMS_REACHED_FIXED_WORK: off.search.stoppedReason === "expansion-limit" && on.search.stoppedReason === "expansion-limit",
    OFF_REPRODUCES_PR526J_FIRST_LOSS: lastOff === PR526J_REFERENCE.lastExpandedCheckpoint
      && off.verdict.firstNotSurvivingCheckpoint === PR526J_REFERENCE.firstNotSurvivingCheckpoint
      && off.verdict.firstLossStage === PR526J_REFERENCE.firstLossStage,
    MECHANISM_FIRED_IN_ON_ARM: on.search.guidedHeadProtectionOpportunities > 0,
    RETENTION_DIFFERS_BETWEEN_ARMS: on.search.routeHash !== off.search.routeHash
      || on.search.candidatesDropped !== off.search.candidatesDropped,
    PREFIX_ADVANCES_BEYOND_OFF: lastOn != null && lastOff != null && lastOn > lastOff,
    MT4_FOUND_IN_ON_ARM: on.search.found === true,
  };
  checks.SUCCESS_GATE = checks.PREFIX_ADVANCES_BEYOND_OFF || checks.MT4_FOUND_IN_ON_ARM;

  const summary = {
    milestone: "PR-5.26k",
    audit: "GUIDED_HEAD_RETENTION_AB",
    searchPolicyChange: "GUIDED_HEAD_RETENTION_OPT_IN",
    oracleUse: "OBSERVATION_ONLY",
    oracleKeysAffectSearchDecisions: false,
    frozen: FROZEN,
    differenceBetweenArms: "guidedHeadRetention",
    pr526jReference: PR526J_REFERENCE,
    preDeclaredGates: [
      "BOTH_ARMS_REACHED_FIXED_WORK = TRUE",
      "OFF_REPRODUCES_PR526J_FIRST_LOSS = TRUE",
      "MECHANISM_FIRED_IN_ON_ARM = TRUE",
      "RETENTION_DIFFERS_BETWEEN_ARMS = TRUE",
      "PREFIX_ADVANCES_BEYOND_OFF (or MT4 found) = the capability gate",
    ],
    checks,
    off,
    on,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  const line = (a) => `  ${a.arm === "on" ? "ON " : "OFF"}: found=${a.search.found} last=${a.verdict.lastExpandedCheckpoint} ` +
    `firstLoss=${a.verdict.firstNotSurvivingCheckpoint} stage=${a.verdict.firstLossStage} survived=${a.verdict.survived}/${a.verdict.strategicCheckpoints} ` +
    `exp=${a.search.strategicExpansions} stopped=${a.search.stoppedReason} deepest=${a.search.deepestReachedFloorOrdinal} ` +
    `drops=${a.search.candidatesDropped} rss=${a.search.peakRssMb}MB wall=${a.search.wallMs}ms`;
  console.log(line(off));
  console.log(line(on));
  console.log(`  ON protections: opportunities=${on.search.guidedHeadProtectionOpportunities} protected=${on.search.guidedHeadProtected} ` +
    `wouldHaveDropped=${on.search.guidedHeadWouldHaveDroppedWithoutProtection} displacedBack=${on.search.guidedHeadDisplacedAfterProtection} ` +
    `staleTopPops=${on.search.guidedHeadStaleTopPops} notPending=${on.search.guidedHeadNotPendingAtTrim} ` +
    `fifoProtected=${on.search.fifoHeadProtected}/${on.search.fifoHeadProtectionOpportunities}`);
  const fl = (a) => a.firstLoss
    ? `  ${a.arm} first loss: cp${a.firstLoss.decisionIndex} ${a.firstLoss.semanticIdentity} rank=${a.firstLoss.rankClassDerived} ` +
      `guided=${a.firstLoss.guidedAdmitted} fg=${a.firstLoss.frontierGuided} cp=${a.firstLoss.combatProgress} ` +
      `attribution=${JSON.stringify(a.firstLoss.dropAttribution)}`
    : `  ${a.arm} first loss: none`;
  console.log(fl(off));
  console.log(fl(on));
  for (const [name, value] of Object.entries(checks)) console.log(`  ${name} = ${value}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
  if (!checks.SUCCESS_GATE || !checks.BOTH_ARMS_REACHED_FIXED_WORK || !checks.OFF_REPRODUCES_PR526J_FIRST_LOSS
    || !checks.MECHANISM_FIRED_IN_ON_ARM) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { FROZEN };
