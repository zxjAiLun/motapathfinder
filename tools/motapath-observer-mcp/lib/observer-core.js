"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildProvenance } = require("./provenance");
const {
  resolveArtifactPath,
  readBoundedFile,
  readTailLines,
  sanitizeIdentifier,
} = require("./path-security");

function resolveRunContext(baseContext, runIdOverride) {
  const context = { ...baseContext };
  if (runIdOverride) {
    const safeRunId = sanitizeIdentifier(runIdOverride);
    const candidate = path.join(context.runsRoot || path.dirname(context.runDir), safeRunId);
    if (fs.existsSync(candidate)) {
      context.runDir = candidate;
      context.runId = safeRunId;
    } else {
      throw new Error(`Run directory not found for id: ${safeRunId}`);
    }
  }
  return context;
}

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return null;
  }
}

function getRuntimeStatus(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);
  const statusPath = path.join(ctx.runDir, "status.json");
  const journalPath = path.join(ctx.runDir, "journal.json");
  const status = safeReadJson(statusPath) || {};
  const journal = safeReadJson(journalPath) || {};

  const lockPath = path.join(ctx.runDir, "runner.lock");
  const workerLockPath = path.join(ctx.runDir, "worker.lock");
  const stopPath = path.join(ctx.runDir, "STOP");

  let serviceState = status.state || journal.state || "inactive";
  const runnerActive = fs.existsSync(lockPath);
  const workerActive = fs.existsSync(workerLockPath);
  const hasStop = fs.existsSync(stopPath);

  if (workerActive || runnerActive) {
    serviceState = hasStop ? "stopping" : "running";
  } else if (serviceState === "running") {
    serviceState = "paused";
  }

  const result = {
    service: serviceState,
    title: status.title || "Motapath Durable Solver",
    run_id: ctx.runId || path.basename(ctx.runDir),
    release_id: ctx.releaseId || (ctx.releaseDir ? path.basename(ctx.releaseDir) : null),
    git_sha: ctx.gitSha || null,
    solver_digest: journal.resumeSearchFingerprint || null,
    problem_digest: journal.problemFingerprint || null,
    journal_schema: journal.schema || "durable-search-v1",
    journal_updated_at: status.heartbeatAt || journal.createdAt || null,
    completed_attempts: status.completedAttempts != null ? status.completedAttempts : (journal.completedAttempts || 0),
    total_expansions: status.totalExpansions != null ? status.totalExpansions : (journal.totalExpansions || 0),
    candidates_count: journal.nodes ? journal.nodes.length : (status.candidates || 0),
    pending_count: journal.nodes ? journal.nodes.filter((n) => n.status === "pending").length : (status.pending || 0),
    active_task: status.current || null,
    telemetry: status.telemetry || null,
    limits: status.limits || (journal.resumeSearchFingerprint ? journal.limits : null),
    best_route: journal.best || status.best || null,
    error: status.error || journal.error || null,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath: fs.existsSync(statusPath) ? statusPath : journalPath,
      gitSha: ctx.gitSha,
    }),
  };

  return result;
}

function listDurableNodes(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);
  const journalPath = path.join(ctx.runDir, "journal.json");
  const journal = safeReadJson(journalPath);
  if (!journal) {
    throw new Error(`journal.json not found in run directory: ${ctx.runDir}`);
  }

  let nodes = journal.nodes || [];

  if (options.stage != null) {
    const stageNum = Number(options.stage);
    nodes = nodes.filter((n) => n.stage === stageNum);
  }
  if (options.tier != null) {
    const tierNum = Number(options.tier);
    nodes = nodes.filter((n) => n.tier === tierNum);
  }
  if (options.status) {
    nodes = nodes.filter((n) => n.status === options.status);
  }

  const totalMatching = nodes.length;

  let heroAggregate = null;
  if (options.hero_aggregate !== false) {
    const atkDist = {};
    const defDist = {};
    const mdefDist = {};
    const lvDist = {};
    const expDist = {};
    const floorDist = {};
    const statusDist = {};
    const hpList = [];

    for (const node of nodes) {
      const s = node.summary || {};
      const hp = Number(s.hp || 0);
      hpList.push(hp);

      const atkKey = String(s.atk != null ? s.atk : "unknown");
      atkDist[atkKey] = (atkDist[atkKey] || 0) + 1;

      const defKey = String(s.def != null ? s.def : "unknown");
      defDist[defKey] = (defDist[defKey] || 0) + 1;

      const mdefKey = String(s.mdef != null ? s.mdef : "0");
      mdefDist[mdefKey] = (mdefDist[mdefKey] || 0) + 1;

      const lvKey = String(s.lv != null ? s.lv : "unknown");
      lvDist[lvKey] = (lvDist[lvKey] || 0) + 1;

      const expKey = String(s.exp != null ? s.exp : "unknown");
      expDist[expKey] = (expDist[expKey] || 0) + 1;

      const floorKey = String(s.floorId || "unknown");
      floorDist[floorKey] = (floorDist[floorKey] || 0) + 1;

      const stKey = String(node.status || "unknown");
      statusDist[stKey] = (statusDist[stKey] || 0) + 1;
    }

    hpList.sort((a, b) => a - b);
    const minHp = hpList.length ? hpList[0] : 0;
    const maxHp = hpList.length ? hpList[hpList.length - 1] : 0;
    const medianHp = hpList.length ? hpList[Math.floor(hpList.length / 2)] : 0;

    heroAggregate = {
      count: totalMatching,
      status_distribution: statusDist,
      atk_distribution: atkDist,
      def_distribution: defDist,
      mdef_distribution: mdefDist,
      lv_distribution: lvDist,
      exp_distribution: expDist,
      floor_distribution: floorDist,
      hp_summary: {
        min: minHp,
        max: maxHp,
        median: medianHp,
        samples_count: hpList.length,
      },
    };
  }

  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(Math.max(1, Number(options.limit) || 50), 500);
  const pagedNodes = nodes.slice(offset, offset + limit).map((n) => {
    const s = n.summary || {};
    return {
      id: n.id,
      parent: n.parent || null,
      stage: n.stage,
      tier: n.tier,
      status: n.status,
      floorId: s.floorId || null,
      hp: s.hp != null ? s.hp : null,
      atk: s.atk != null ? s.atk : null,
      def: s.def != null ? s.def : null,
      mdef: s.mdef != null ? s.mdef : null,
      lv: s.lv != null ? s.lv : null,
      exp: s.exp != null ? s.exp : null,
      loc: s.loc || null,
      state_fingerprint: n.id.includes("-") ? n.id.split("-")[1] : n.id,
    };
  });

  return {
    total_matching: totalMatching,
    offset,
    limit,
    returned_count: pagedNodes.length,
    hero_distribution: heroAggregate,
    nodes: pagedNodes,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath: journalPath,
      gitSha: ctx.gitSha,
    }),
  };
}

function getDurableNode(context, nodeId, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);
  const safeNodeId = sanitizeIdentifier(nodeId);
  const journalPath = path.join(ctx.runDir, "journal.json");
  const journal = safeReadJson(journalPath);
  if (!journal) throw new Error(`journal.json not found in ${ctx.runDir}`);

  const node = (journal.nodes || []).find((n) => n.id === safeNodeId);
  if (!node) {
    throw new Error(`Node not found in journal: ${safeNodeId}`);
  }

  const stateFile = path.join(ctx.runDir, "states", `${safeNodeId}.json`);
  const previewFile = path.join(ctx.runDir, "previews", `${safeNodeId}.preview.json`);
  const hasStateFile = fs.existsSync(stateFile);
  const hasPreviewFile = fs.existsSync(previewFile);

  let fullState = null;
  if (options.include_full_state && hasStateFile) {
    fullState = safeReadJson(stateFile);
  }

  let preview = null;
  if (hasPreviewFile) {
    const rawPreview = safeReadJson(previewFile);
    if (rawPreview) {
      preview = {
        schema: rawPreview.schema,
        capturedAt: rawPreview.capturedAt,
        stoppedReason: rawPreview.stoppedReason,
        renderFloorId: rawPreview.renderState && rawPreview.renderState.floorId,
        hero: rawPreview.renderState && rawPreview.renderState.hero,
      };
    }
  }

  return {
    id: node.id,
    parent: node.parent || null,
    stage: node.stage,
    tier: node.tier,
    status: node.status,
    summary: node.summary || {},
    state_file_exists: hasStateFile,
    has_preview: hasPreviewFile,
    preview,
    full_state: fullState,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath: hasStateFile ? stateFile : journalPath,
      gitSha: ctx.gitSha,
    }),
  };
}

function getAttemptHistory(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);
  const journalPath = path.join(ctx.runDir, "journal.json");
  const journal = safeReadJson(journalPath);
  if (!journal) throw new Error(`journal.json not found in ${ctx.runDir}`);

  let history = journal.history || [];

  if (options.node_id) {
    const safeNodeId = sanitizeIdentifier(options.node_id);
    history = history.filter((h) => h.id === safeNodeId);
  }
  if (options.stage != null) {
    const stageNum = Number(options.stage);
    history = history.filter((h) => h.stage === stageNum);
  }

  const totalMatching = history.length;
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(Math.max(1, Number(options.limit) || 30), 100);

  // Return in reverse chronological order (newest first)
  const reversed = [...history].reverse();
  const page = reversed.slice(offset, offset + limit);

  const items = page.map((h) => {
    let diagSummary = null;
    if (options.include_diagnostics_summary !== false && h.diagnostics) {
      const d = h.diagnostics;
      const dp = d.dp || {};
      const retention = d.retention || {};
      const confluence = d.confluenceDominance || {};
      diagSummary = {
        uniqueKeys: dp.keys || retention.bestByKeySize || 0,
        acceptedNodes: retention.acceptedNodes || 0,
        generatedNodes: retention.generatedNodes || 0,
        rejectedByHigherHp: confluence.rejectedByHigherHp || 0,
        sameHpRejected: confluence.sameHpRejected || 0,
        archiveTrimmed: dp.goalArchiveTrimmed || false,
        goalArchiveEvictedCount: dp.goalArchiveEvictedCount || 0,
        peakHeapMb: dp.memory ? dp.memory.peakHeapUsedMb : (d.perf ? d.perf.heapUsedMb : null),
        peakRssMb: dp.memory ? dp.memory.peakRssMb : (d.perf ? d.perf.rssMb : null),
      };
    }

    return {
      id: h.id,
      stage: h.stage,
      tier: h.tier,
      expansions: h.expansions,
      frontierSize: h.frontierSize,
      stoppedReason: h.stoppedReason,
      searchComplete: h.searchComplete,
      foundGoal: h.foundGoal,
      candidateCount: h.candidateCount,
      actionTrimmed: h.actionTrimmed,
      archiveTrimmed: h.archiveTrimmed,
      time: h.time,
      diagnostics_summary: diagSummary,
    };
  });

  return {
    total_matching: totalMatching,
    offset,
    limit,
    returned_count: items.length,
    history: items,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath: journalPath,
      gitSha: ctx.gitSha,
    }),
  };
}

function getSearchDiagnostics(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);

  // If probe_name is specified, look for <probe_name>.json (e.g. 256k.json)
  if (options.probe_name) {
    const probePath = resolveArtifactPath("probe", options.probe_name, ctx);
    const probeData = safeReadJson(probePath);
    if (!probeData) throw new Error(`Probe artifact could not be read: ${probePath}`);

    const diag = probeData.diagnostics || {};
    const dp = diag.dp || {};
    const retention = diag.retention || {};
    const memory = dp.memory || probeData.memory || {};

    return {
      source: "probe",
      probe_name: options.probe_name,
      expansions: probeData.expansions,
      frontierSize: probeData.frontierSize,
      stoppedReason: probeData.stoppedReason,
      foundGoal: probeData.foundGoal,
      wallMs: probeData.wallMs,
      memory: {
        peakHeapUsedMb: memory.peakHeapUsedMb || null,
        peakRssMb: memory.peakRssMb || null,
        rssGcCount: memory.rssGcCount != null ? memory.rssGcCount : null,
        beforeFinalGc: probeData.beforeFinalGc || null,
      },
      dp: {
        keys: dp.keys || retention.bestByKeySize || 0,
        dpSkylineMax: dp.dpSkylineMax || 16,
        priorityMode: dp.priorityMode || "default",
        agendaMode: dp.agendaMode || "best-first",
      },
      dominance: {
        acceptedStates: retention.acceptedNodes || 0,
        rejectedNodes: retention.rejectedNodes || 0,
        replacedNodes: retention.replacedNodes || 0,
        pruneReasons: diag.pruneReasons || {},
      },
      service: probeData.service || null,
      _provenance: buildProvenance({
        runId: ctx.runId,
        releaseId: ctx.releaseId,
        filePath: probePath,
        gitSha: ctx.gitSha,
      }),
    };
  }

  // Otherwise, inspect journal.history
  const journalPath = path.join(ctx.runDir, "journal.json");
  const journal = safeReadJson(journalPath);
  if (!journal) throw new Error(`journal.json not found in ${ctx.runDir}`);

  let record = null;
  if (options.task_id && options.task_id !== "latest") {
    const safeTaskId = sanitizeIdentifier(options.task_id);
    const matches = (journal.history || []).filter((h) => h.id === safeTaskId);
    if (options.tier != null) {
      record = matches.find((m) => m.tier === Number(options.tier));
    } else {
      record = matches[matches.length - 1];
    }
  } else {
    // latest
    const history = journal.history || [];
    record = history[history.length - 1];
  }

  if (!record || !record.diagnostics) {
    throw new Error("Diagnostics record not found in attempt history");
  }

  const d = record.diagnostics;
  const dp = d.dp || {};
  const retention = d.retention || {};
  const memory = dp.memory || {};

  return {
    source: "attempt",
    task_id: record.id,
    stage: record.stage,
    tier: record.tier,
    expansions: record.expansions,
    frontierSize: record.frontierSize,
    stoppedReason: record.stoppedReason,
    searchComplete: record.searchComplete,
    foundGoal: record.foundGoal,
    candidateCount: record.candidateCount,
    actionTrimmed: record.actionTrimmed,
    archiveTrimmed: record.archiveTrimmed,
    memory: {
      peakHeapUsedMb: memory.peakHeapUsedMb || null,
      peakRssMb: memory.peakRssMb || null,
      rssGcCount: memory.rssGcCount != null ? memory.rssGcCount : null,
    },
    dp: {
      keys: dp.keys || retention.bestByKeySize || 0,
      priorityMode: dp.priorityMode || "default",
      dpSkylineMax: dp.dpSkylineMax || 16,
      goalSkylineLimit: dp.goalSkylineLimit || 16,
      goalArchiveTrimmed: dp.goalArchiveTrimmed || false,
      goalArchiveEvictedCount: dp.goalArchiveEvictedCount || 0,
      activeGoalCount: dp.activeGoalCount || 0,
      goalNodeCount: dp.goalNodeCount || 0,
    },
    dominance: {
      acceptedStates: retention.acceptedNodes || 0,
      replacedLowerHp: dp.replacedLowerHp || (d.confluenceDominance && d.confluenceDominance.replacedLowerHp) || 0,
      sameHpShorterRoute: dp.sameHpShorterRoute || (d.confluenceDominance && d.confluenceDominance.sameHpShorterRoute) || 0,
      rejectedByHigherHp: dp.rejectedByHigherHp || (d.confluenceDominance && d.confluenceDominance.rejectedByHigherHp) || 0,
      sameHpRejected: dp.sameHpRejected || (d.confluenceDominance && d.confluenceDominance.sameHpRejected) || 0,
      pruneReasons: d.pruneReasons || {},
    },
    statProgress: dp.statProgress || null,
    actionsByKind: dp.actionsGeneratedByKind || null,
    cacheStats: (d.actionExpansionCache && d.actionExpansionCache.main) || null,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath: journalPath,
      gitSha: ctx.gitSha,
    }),
  };
}

function analyzeStageCandidates(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);
  if (options.stage == null) {
    throw new Error("stage is required (e.g. 0 for TS11->TS12, 1 for TS12->TS13, 2 for TS13->TS14)");
  }

  const targetStage = Number(options.stage);
  const journalPath = path.join(ctx.runDir, "journal.json");
  const journal = safeReadJson(journalPath);
  if (!journal) throw new Error(`journal.json not found in ${ctx.runDir}`);

  // Candidates for stage N are nodes with stage === N
  const candidates = (journal.nodes || []).filter((n) => n.stage === targetStage);

  const atkDist = {};
  const defDist = {};
  const hpDist = {};
  const statusDist = {};
  const tierDist = {};

  for (const c of candidates) {
    const s = c.summary || {};
    const atkKey = String(s.atk != null ? s.atk : "unknown");
    atkDist[atkKey] = (atkDist[atkKey] || 0) + 1;

    const defKey = String(s.def != null ? s.def : "unknown");
    defDist[defKey] = (defDist[defKey] || 0) + 1;

    const hpKey = String(s.hp != null ? s.hp : "unknown");
    hpDist[hpKey] = (hpDist[hpKey] || 0) + 1;

    const stKey = String(c.status || "unknown");
    statusDist[stKey] = (statusDist[stKey] || 0) + 1;

    const trKey = String(c.tier != null ? c.tier : "unknown");
    tierDist[trKey] = (tierDist[trKey] || 0) + 1;
  }

  // Find attempts that produced these candidates (attempts with stage === targetStage - 1 or targeting this stage)
  const producingAttempts = (journal.history || []).filter((h) => h.stage === targetStage - 1);
  let totalArchivedEvictions = 0;
  let maxSeenAtk = 0;
  let maxSeenDef = 0;
  let anyArchiveTrimmed = false;

  for (const att of producingAttempts) {
    const diag = att.diagnostics || {};
    const dp = diag.dp || {};
    if (dp.goalArchiveTrimmed) anyArchiveTrimmed = true;
    totalArchivedEvictions += Number(dp.goalArchiveEvictedCount || 0);

    const statProgress = dp.statProgress || {};
    const maxHero = statProgress.maxHeroSeen || {};
    if (maxHero.atk != null && maxHero.atk > maxSeenAtk) maxSeenAtk = maxHero.atk;
    if (maxHero.def != null && maxHero.def > maxSeenDef) maxSeenDef = maxHero.def;
  }

  // Top candidates by HP
  const sortedCandidates = [...candidates].sort((a, b) => ((b.summary && b.summary.hp) || 0) - ((a.summary && a.summary.hp) || 0));
  const topCandidates = sortedCandidates.slice(0, 16).map((c) => ({
    id: c.id,
    parent: c.parent,
    status: c.status,
    tier: c.tier,
    hp: c.summary && c.summary.hp,
    atk: c.summary && c.summary.atk,
    def: c.summary && c.summary.def,
    loc: c.summary && c.summary.loc,
    inventory: c.summary && c.summary.inventory,
  }));

  const isHomogeneousAtkDef = Object.keys(atkDist).length === 1 && Object.keys(defDist).length === 1;

  let causalAssessment = "";
  if (candidates.length === 0) {
    causalAssessment = `Stage ${targetStage} has 0 candidates in the journal.`;
  } else if (isHomogeneousAtkDef) {
    const fixedAtk = Object.keys(atkDist)[0];
    const fixedDef = Object.keys(defDist)[0];
    causalAssessment = `All ${candidates.length} stage ${targetStage} candidates in the journal have identical stats: ATK=${fixedAtk}, DEF=${fixedDef}. ` +
      `Archive trimming occurred in producing attempts: ${anyArchiveTrimmed} (${totalArchivedEvictions} total evictions). ` +
      `Max hero seen during search: ATK=${maxSeenAtk}, DEF=${maxSeenDef}.`;
  } else {
    causalAssessment = `Stage ${targetStage} has diverse candidates across ATK/DEF profiles: ATK ${JSON.stringify(atkDist)}, DEF ${JSON.stringify(defDist)}.`;
  }

  return {
    stage: targetStage,
    total_candidates_in_journal: candidates.length,
    status_distribution: statusDist,
    tier_distribution: tierDist,
    hero_distribution: {
      atk: atkDist,
      def: defDist,
      hp_counts: hpDist,
    },
    top_hp_candidates: topCandidates,
    archive_retention_evidence: {
      producing_attempts_count: producingAttempts.length,
      any_archive_trimmed: anyArchiveTrimmed,
      total_evicted_candidates: totalArchivedEvictions,
      max_hero_seen_during_search: {
        atk: maxSeenAtk,
        def: maxSeenDef,
      },
    },
    causal_assessment: causalAssessment,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath: journalPath,
      gitSha: ctx.gitSha,
    }),
  };
}

function inspectFrontierSnapshot(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);

  // First check if there is a probe file with rich service telemetry (256k.json, 128k.json)
  const probeFile = options.task_id ? `${sanitizeIdentifier(options.task_id)}.json` : "256k.json";
  const probePath = path.join(ctx.runDir, probeFile);
  let probeData = safeReadJson(probePath);

  if (!probeData && !options.task_id) {
    // Try 128k.json
    const altProbePath = path.join(ctx.runDir, "128k.json");
    probeData = safeReadJson(altProbePath);
  }

  if (probeData && probeData.service) {
    const s = probeData.service;
    const activeFrontier = probeData.frontierSize || 0;
    const byFloor = {};
    const oldestWaitByFloor = {};
    const evictedPendingByFloor = {};
    const poppedByFloor = {};
    const insertedByFloor = {};
    const popRatioPercent = {};

    let totalPopped = 0;
    for (const [floor, data] of Object.entries(s)) {
      totalPopped += Number(data.popped || 0);
    }

    for (const [floor, data] of Object.entries(s)) {
      byFloor[floor] = Number(data.pending || 0);
      oldestWaitByFloor[floor] = Number(data.oldestPending || 0);
      evictedPendingByFloor[floor] = Number(data.evictedPending || 0);
      poppedByFloor[floor] = Number(data.popped || 0);
      insertedByFloor[floor] = Number(data.inserted || 0);
      popRatioPercent[floor] = totalPopped > 0 ? Number(((data.popped || 0) / totalPopped * 100).toFixed(3)) : 0;
    }

    const ts13PopRatio = popRatioPercent.TS13 || 0;
    const starvationDiagnosis = ts13PopRatio < 0.2
      ? `TS13 pop ratio is extremely low (${ts13PopRatio}%, popped=${poppedByFloor.TS13 || 0} / ${totalPopped}). ` +
        `Pending queue on TS13 is ${byFloor.TS13} with oldest age ${oldestWaitByFloor.TS13}. ` +
        `Search is spending ${popRatioPercent.TS11 || 0}% on TS11 and ${popRatioPercent.TS12 || 0}% on TS12.`
      : `TS13 pop ratio is ${ts13PopRatio}%.`;

    return {
      source: "probe_service_telemetry",
      active_frontier: activeFrontier,
      by_floor: byFloor,
      service_summary: {
        total_popped: totalPopped,
        popped_by_floor: poppedByFloor,
        inserted_by_floor: insertedByFloor,
        evicted_pending_by_floor: evictedPendingByFloor,
        pop_ratio_percent: popRatioPercent,
      },
      oldest_wait_by_floor: oldestWaitByFloor,
      starvation_diagnosis: starvationDiagnosis,
      raw_service_telemetry: s,
      _provenance: buildProvenance({
        runId: ctx.runId,
        releaseId: ctx.releaseId,
        filePath: probePath,
        gitSha: ctx.gitSha,
      }),
    };
  }

  // Fallback to status.json telemetry
  const statusPath = path.join(ctx.runDir, "status.json");
  const status = safeReadJson(statusPath);
  if (!status) throw new Error(`Could not inspect frontier: neither probe service nor status.json found in ${ctx.runDir}`);

  const telemetry = status.telemetry || {};
  return {
    source: "status_telemetry",
    active_frontier: telemetry.frontierSize != null ? telemetry.frontierSize : null,
    current_floor: telemetry.floorId || null,
    expansions: telemetry.expansions || status.totalExpansions || 0,
    rss_mb: telemetry.rssMb || null,
    note: "Detailed floor-by-floor queue metrics require probe data (e.g. 256k.json). Only active telemetry is currently available.",
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath: statusPath,
      gitSha: ctx.gitSha,
    }),
  };
}

function readArtifact(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);
  const { artifact_type, id, max_bytes, json_path } = options;
  if (!artifact_type) throw new Error("artifact_type is required");

  const filePath = resolveArtifactPath(artifact_type, id, ctx);
  const bounded = readBoundedFile(filePath, max_bytes);

  let content = bounded.content;
  let parsedJson = null;

  if (filePath.endsWith(".json")) {
    try {
      parsedJson = JSON.parse(bounded.content);
      if (json_path && typeof json_path === "string") {
        const parts = json_path.split(".");
        let curr = parsedJson;
        for (const p of parts) {
          if (curr != null && typeof curr === "object" && p in curr) {
            curr = curr[p];
          } else {
            curr = undefined;
            break;
          }
        }
        content = curr !== undefined ? curr : null;
      } else {
        content = parsedJson;
      }
    } catch (e) {
      // Content remains raw string if truncated or invalid json
    }
  }

  return {
    artifact_type,
    id: id || null,
    path: path.relative(ctx.repoRoot || path.dirname(ctx.runDir), filePath).replace(/\\/g, "/"),
    size_bytes: bounded.size_bytes,
    read_bytes: bounded.read_bytes,
    truncated: bounded.truncated,
    content,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath,
      gitSha: ctx.gitSha,
    }),
  };
}

function readBoundedLog(context, options = {}) {
  const ctx = resolveRunContext(context, options.run_id);
  const source = options.source || "worker";
  const maxLines = Math.min(Math.max(1, Number(options.tail_lines) || 100), 300);
  const pattern = options.pattern || null;

  let filePath = null;
  if (source === "worker") {
    filePath = path.join(ctx.runDir, "worker.log");
  } else if (source === "256k" || source === "128k") {
    filePath = path.join(ctx.runDir, `${source}.log`);
  } else {
    // Check if source matches an existing log in runDir
    const safeSource = sanitizeIdentifier(source);
    const candidate = path.join(ctx.runDir, safeSource.endsWith(".log") ? safeSource : `${safeSource}.log`);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
    } else {
      throw new Error(`Log source not found: ${source}. Allowed: worker, 256k, 128k`);
    }
  }

  const result = readTailLines(filePath, maxLines, pattern);

  return {
    source,
    returned_lines: result.returned_lines,
    total_available_lines: result.total_available_lines,
    file_size_bytes: result.file_size_bytes,
    lines: result.lines,
    _provenance: buildProvenance({
      runId: ctx.runId,
      releaseId: ctx.releaseId,
      filePath,
      gitSha: ctx.gitSha,
    }),
  };
}

module.exports = {
  getRuntimeStatus,
  listDurableNodes,
  getDurableNode,
  getAttemptHistory,
  getSearchDiagnostics,
  analyzeStageCandidates,
  inspectFrontierSnapshot,
  readArtifact,
  readBoundedLog,
};
