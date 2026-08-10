"use strict";

const { fingerprintJson } = require("./solve-task");
const {
  cloneState,
  listFloorMutationSummary,
  getTileDefinitionAt,
} = require("./state");

const DEFAULT_CAPACITIES = Object.freeze([1, 2, 4, 8]);

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function exactStateFingerprint(state) {
  if (!state) return null;
  const copy = cloneState(state);
  delete copy.route;
  delete copy.routeTrace;
  if (copy.meta) {
    delete copy.meta.rawRouteLength;
    delete copy.meta.__storeRoute;
  }
  return fingerprintJson(copy);
}

function effectiveHero(state) {
  const hero = (state && state.hero) || {};
  const flags = (state && state.flags) || {};
  const value = (field) => Math.floor(
    number(hero[field], 0) * number(flags[`__${field}_buff__`], 1),
  );
  return {
    atk: value("atk"),
    def: value("def"),
    mdef: value("mdef"),
  };
}

function compactHero(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: number(hero.hp, 0),
    atk: number(hero.atk, 0),
    def: number(hero.def, 0),
    mdef: number(hero.mdef, 0),
    exp: number(hero.exp, 0),
    lv: number(hero.lv, 0),
  };
}

function cloneCandidate(candidate, fallbackId) {
  if (!candidate || !candidate.state) return null;
  const state = cloneState(candidate.state);
  const route = Array.isArray(candidate.route)
    ? candidate.route.slice()
    : Array.isArray(state.route)
      ? state.route.slice()
      : [];
  state.route = route.slice();
  return {
    ...candidate,
    id: candidate.id || fallbackId,
    state,
    route,
    trace: Array.isArray(candidate.trace) ? candidate.trace.slice() : [],
    tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
  };
}

function candidateIdentity(candidate) {
  if (!candidate || !candidate.state) return null;
  return fingerprintJson({
    exactStateFingerprint: exactStateFingerprint(candidate.state),
    route: (candidate.route || candidate.state.route || []).map((entry) =>
      typeof entry === "string" ? entry : entry && (entry.summary || entry.kind) || "unknown"
    ),
  });
}

function isEnemyTile(project, tile) {
  return Boolean(tile && tile.id && (project.enemysById || {})[tile.id]);
}

function isResourceTile(project, tile) {
  return Boolean(tile && tile.id && (project.itemsById || {})[tile.id]);
}

function summarizeRemainingRelevantTiles(project, state, segment) {
  const scanState = cloneState(state);
  const allowedFloors = (((segment || {}).actionPolicy || {}).allowedFloors || [])
    .filter((floorId) => project.floorsById && project.floorsById[floorId]);
  const monsters = [];
  const resources = [];
  for (const floorId of allowedFloors) {
    const floor = project.floorsById[floorId];
    for (let y = 0; y < number(floor.height, 0); y += 1) {
      for (let x = 0; x < number(floor.width, 0); x += 1) {
        const tile = getTileDefinitionAt(project, scanState, floorId, x, y);
        if (isEnemyTile(project, tile)) {
          const enemy = project.enemysById[tile.id] || {};
          monsters.push({
            floorId,
            x,
            y,
            id: tile.id,
            atk: number(enemy.atk, 0),
            def: number(enemy.def, 0),
            hp: number(enemy.hp, 0),
            exp: number(enemy.exp, 0),
          });
        } else if (isResourceTile(project, tile)) {
          resources.push({ floorId, x, y, id: tile.id });
        }
      }
    }
  }
  return {
    allowedFloors,
    monsterCount: monsters.length,
    resourceCount: resources.length,
    monsters,
    resources,
    fingerprint: fingerprintJson({ monsters, resources }),
  };
}

function summarizeCandidate(project, candidate, options) {
  const config = options || {};
  const state = candidate && candidate.state;
  const dependencyProjection = config.goalDependencyGraph && state
    ? config.goalDependencyGraph.project(state, config.currentSegmentId)
    : null;
  return {
    id: candidate && candidate.id || null,
    candidateIdentity: candidateIdentity(candidate),
    exactStateFingerprint: exactStateFingerprint(state),
    floorId: state && state.floorId || null,
    hero: compactHero(state),
    effectiveHero: effectiveHero(state),
    inventory: { ...((state && state.inventory) || {}) },
    equipment: Array.isArray(state && state.hero && state.hero.equipment)
      ? state.hero.equipment.slice()
      : [],
    floorMutations: listFloorMutationSummary((state && state.floorStates) || {}),
    visitedFloors: Object.keys((state && state.visitedFloors) || {}).sort(),
    routeLength: Array.isArray(candidate && candidate.route)
      ? candidate.route.length
      : Array.isArray(state && state.route)
        ? state.route.length
        : 0,
    candidateRoles: Array.isArray(candidate && candidate.tags)
      ? candidate.tags.slice()
      : [],
    goalDependencyProjection: dependencyProjection,
    remainingRelevant: config.downstreamSegment && state
      ? summarizeRemainingRelevantTiles(project, state, config.downstreamSegment)
      : null,
  };
}

function createCandidateQualityCollector(options) {
  const config = options || {};
  const sourceSegmentId = String(config.sourceSegmentId || "");
  const merges = [];
  const rawAudits = [];
  const pipelineObserver = {
    onAttempt(payload) {
      if (!payload || !payload.segment || payload.segment.id !== sourceSegmentId) return;
      const audit = payload.attempt && payload.attempt.rawResult && payload.attempt.rawResult.goalArchiveAudit;
      if (audit) rawAudits.push(audit);
    },
    onMerge(payload) {
      if (!payload || !payload.segment || payload.segment.id !== sourceSegmentId) return;
      merges.push({
        segmentId: payload.segment.id,
        candidateLimit: number(payload.candidateLimit, 0),
        nextCandidates: (payload.nextCandidates || [])
          .map((candidate, index) => cloneCandidate(candidate, `${sourceSegmentId}:raw-${index}`))
          .filter(Boolean),
        merged: (payload.merged || [])
          .map((candidate, index) => cloneCandidate(candidate, `${sourceSegmentId}:selected-${index}`))
          .filter(Boolean),
      });
    },
  };
  return {
    pipelineObserver,
    snapshot() {
      return {
        sourceSegmentId,
        merges: merges.slice(),
        rawGoalArchiveAudits: rawAudits.slice(),
      };
    },
  };
}

function buildRetentionMatrix(simulator, candidates, segment, options) {
  const config = options || {};
  if (typeof config.selectCandidateSkyline !== "function") {
    throw new Error("candidate quality shadow requires selectCandidateSkyline");
  }
  const capacities = (config.capacities || DEFAULT_CAPACITIES)
    .map((value) => Math.max(1, number(value, 1)));
  return capacities.map((capacity) => {
    const selected = config.selectCandidateSkyline(
      simulator,
      candidates,
      segment,
      {
        candidateLimit: capacity,
        preserveSkylineRoles: config.preserveSkylineRoles !== false,
        captureSelectionAudit: true,
      },
    );
    const selectionAudit = selected.selectionAudit || null;
    const selectedById = new Map(selected.map((candidate, index) => [candidate.id, {
      rank: index,
      tags: Array.isArray(candidate.tags) ? candidate.tags.slice() : [],
    }]));
    return {
      capacity,
      candidateCount: candidates.length,
      uniqueDpKeyCount: selectionAudit
        ? selectionAudit.uniqueDpKeyCount
        : candidates.length,
      selectedCount: selected.length,
      selectedCandidateIds: selected.map((candidate) => candidate.id),
      decisions: selectionAudit
        ? selectionAudit.decisions
        : candidates.map((candidate) => {
        const kept = selectedById.get(candidate.id);
        return {
          candidateId: candidate.id,
          selected: Boolean(kept),
          selectedRank: kept ? kept.rank : null,
          candidateRoles: kept ? kept.tags : [],
          reason: kept ? "selected" : "milestone-frontier-capacity",
        };
      }),
    };
  });
}

function probeOutcome(probe) {
  if (probe && probe.reached === true) return "reached";
  if (probe && probe.budgetExhausted === true) return "budget-exhausted";
  return "failed";
}

function classifyQualityEvidence(retentionMatrix, probes) {
  const probeById = new Map((probes || []).map((probe) => [probe.candidateId, probe]));
  const witnesses = [];
  for (const row of retentionMatrix || []) {
    const retained = row.decisions.filter((decision) => decision.selected);
    const evicted = row.decisions.filter((decision) => !decision.selected);
    const retainedFailures = retained.filter((decision) =>
      probeOutcome(probeById.get(decision.candidateId)) === "failed"
    );
    const evictedSuccesses = evicted.filter((decision) =>
      probeOutcome(probeById.get(decision.candidateId)) === "reached"
    );
    if (retainedFailures.length > 0 && evictedSuccesses.length > 0) {
      witnesses.push({
        capacity: row.capacity,
        retainedFailCandidateIds: retainedFailures.map((entry) => entry.candidateId),
        evictedSuccessCandidateIds: evictedSuccesses.map((entry) => entry.candidateId),
      });
    }
  }
  if (witnesses.length > 0) {
    return {
      verdict: "EVICTED_SUCCESS_WITNESS",
      stopCondition: "A",
      witnesses,
    };
  }
  if ((probes || []).some((probe) => probeOutcome(probe) === "budget-exhausted")) {
    return {
      verdict: "BUDGET_INCONCLUSIVE",
      stopCondition: "C",
      witnesses: [],
    };
  }
  const evictedIds = new Set((retentionMatrix || []).flatMap((row) =>
    row.decisions.filter((decision) => !decision.selected).map((decision) => decision.candidateId)
  ));
  if (evictedIds.size > 0 && Array.from(evictedIds).every((id) =>
    probeOutcome(probeById.get(id)) === "failed"
  )) {
    return {
      verdict: "EVICTED_CANDIDATES_ALSO_FAIL",
      stopCondition: "B",
      witnesses: [],
    };
  }
  return {
    verdict: "INSUFFICIENT_CANDIDATE_CORPUS",
    stopCondition: null,
    witnesses: [],
  };
}

module.exports = {
  DEFAULT_CAPACITIES,
  buildRetentionMatrix,
  candidateIdentity,
  classifyQualityEvidence,
  cloneCandidate,
  createCandidateQualityCollector,
  exactStateFingerprint,
  probeOutcome,
  summarizeCandidate,
  summarizeRemainingRelevantTiles,
};
