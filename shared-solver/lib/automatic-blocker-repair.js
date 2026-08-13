"use strict";

const crypto = require("node:crypto");

const { buildAutomaticMacroGraph } = require("./automatic-macro-graph");
const { compileAutomaticDependencyPlan } = require("./automatic-dependency-planner");
const { compileAutomaticFeasibilitySubgoals } = require("./automatic-feasibility-subgoals");
const { makeBlindSimulator } = require("./blind-discovery-baseline");
const { EquipmentResolver, getEquipType } = require("./equipment-resolver");
const { cloneState, getTileDefinitionAt } = require("./state");
const { buildStateKey } = require("./state-key");

const SCHEMA = "motapathfinder.automatic-blocker-repair.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function repairProjection(state) {
  const projection = JSON.parse(buildStateKey(state));
  delete projection.hero.x;
  delete projection.hero.y;
  delete projection.hero.direction;
  delete projection.flags.__leaveLoc__;
  return projection;
}

function repairProjectionFingerprint(state) {
  const projection = repairProjection(state);
  return hash(JSON.stringify(projection));
}

function accessProjectionFingerprint(access) {
  return hash(JSON.stringify(access || null));
}

function makeRepairCompilationCache() {
  return {
    checkpointAnalyses: new Map(),
    accessByStateAndResource: new Map(),
  };
}

function blockerProjectionFingerprint(leading) {
  const evidence = (leading || {}).evidence || {};
  const target = (leading || {}).target || {};
  return hash(JSON.stringify({
    tileId: target.tileId || null,
    role: target.role || null,
    status: evidence.status || null,
    damage: evidence.damage == null ? null : number(evidence.damage, 0),
    currentHp: evidence.currentHp == null ? null : number(evidence.currentHp, 0),
  }));
}

function battleStatus(evaluation, hp) {
  const damage = evaluation && evaluation.damageInfo && evaluation.damageInfo.damage;
  if (!evaluation || !evaluation.supported) return "unsupported";
  if (damage == null) return "unbeatable-at-current-stats";
  return number(damage, Infinity) < number(hp, 0)
    ? "viable-at-current-state"
    : "lethal-at-current-hp";
}

function statusRank(status) {
  if (status === "viable-at-current-state") return 3;
  if (status === "lethal-at-current-hp") return 2;
  if (status === "unbeatable-at-current-stats") return 1;
  return 0;
}

function counterfactualPickup(project, simulator, state, node) {
  const next = cloneState(state);
  next.floorId = node.floorId;
  next.hero.loc = { ...(next.hero.loc || {}), x: node.x, y: node.y };
  try {
    simulator.resolvePickupAt(next, node.x, node.y);
  } catch (_error) {
    return null;
  }
  if (node.role === "equipment") {
    const equipType = getEquipType(project, next, node.tileId);
    if (equipType >= 0) {
      try {
        new EquipmentResolver().applyAction({
          project,
          state: next,
          action: { equipId: node.tileId, equipType },
        });
      } catch (_error) {
        return null;
      }
    }
  }
  return next;
}

function counterfactualCombatReward(project, simulator, state, node) {
  const next = cloneState(state);
  next.floorId = node.floorId;
  next.hero.loc = { ...(next.hero.loc || {}), x: node.x, y: node.y };
  try {
    simulator.battleResolver.applyBattleAt({
      project,
      state: next,
      floorId: node.floorId,
      x: node.x,
      y: node.y,
      enemyId: node.tileId,
    });
  } catch (_error) {
    return null;
  }
  return next;
}

function counterfactualResource(project, simulator, state, node) {
  return node.kind === "enemy"
    ? counterfactualCombatReward(project, simulator, state, node)
    : counterfactualPickup(project, simulator, state, node);
}

function repairGoal(node) {
  return node.role === "equipment"
    ? { equipmentIncludes: [node.tileId] }
    : { type: "tileRemoved", floorId: node.floorId, x: node.x, y: node.y };
}

function candidateFor(project, simulator, checkpoint, alternative, leading, node, projectionFingerprint) {
  const counterfactual = counterfactualResource(project, simulator, checkpoint.state, node);
  if (!counterfactual) return null;
  const before = leading.evidence || {};
  const evaluationState = cloneState(counterfactual);
  evaluationState.floorId = leading.target.floorId;
  evaluationState.hero.loc = {
    ...(evaluationState.hero.loc || {}),
    x: leading.target.x,
    y: leading.target.y,
  };
  const afterEvaluation = simulator.battleResolver.evaluateBattle(
    evaluationState,
    leading.target.floorId,
    leading.target.x,
    leading.target.y,
    leading.target.tileId,
  );
  const afterDamage = afterEvaluation.damageInfo && afterEvaluation.damageInfo.damage;
  const afterStatus = battleStatus(afterEvaluation, counterfactual.hero.hp);
  const beforeRank = statusRank(before.status);
  const afterRank = statusRank(afterStatus);
  const beforeDamage = before.damage == null ? null : number(before.damage, 0);
  const beforeSurvivalMargin = beforeDamage == null || before.currentHp == null
    ? null
    : number(before.currentHp, 0) - beforeDamage;
  const damageReduction = beforeDamage == null || afterDamage == null
    ? 0
    : beforeDamage - number(afterDamage, 0);
  const survivalMargin = afterDamage == null
    ? null
    : number(counterfactual.hero.hp, 0) - number(afterDamage, 0);
  const survivalMarginGain = beforeSurvivalMargin == null || survivalMargin == null
    ? 0
    : survivalMargin - beforeSurvivalMargin;
  const expGain = number(counterfactual.hero.exp, 0) - number(checkpoint.state.hero.exp, 0);
  const levelGain = number(counterfactual.hero.lv, 0) - number(checkpoint.state.hero.lv, 0);
  const blockerImprovement = afterRank > beforeRank || damageReduction > 0 || survivalMarginGain > 0;
  const levelProgress = node.kind === "enemy" && (levelGain > 0 || expGain > 0);
  if (afterRank < beforeRank) return null;
  if (!blockerImprovement && !levelProgress) return null;
  return {
    id: `repair-${checkpoint.id}-${alternative.id}-${node.id}`,
    repairProjectionFingerprint: projectionFingerprint,
    blockerProjectionFingerprint: blockerProjectionFingerprint(leading),
    kind: "blocker-feasibility-repair",
    provenance: "automatic-current-map-resource-counterfactual+simulator-battle-probe",
    checkpointId: checkpoint.id,
    checkpointRoles: (checkpoint.roles || []).slice(),
    sourceNodeId: node.id,
    resourceKind: node.kind === "enemy" ? "combat-reward" : "item",
    target: {
      floorId: node.floorId,
      x: node.x,
      y: node.y,
      tileId: node.tileId,
      itemId: node.kind === "item" ? node.tileId : null,
      enemyId: node.kind === "enemy" ? node.tileId : null,
    },
    goal: repairGoal(node),
    repairs: {
      alternativeId: alternative.id,
      prerequisiteId: leading.sourceNodeId,
      prerequisiteTarget: { ...leading.target },
      beforeStatus: before.status,
      beforeDamage,
      beforeSurvivalMargin,
      afterStatus,
      afterDamage: afterDamage == null ? null : number(afterDamage, 0),
      survivalMargin,
      survivalMarginGain,
      blockerImprovement,
      levelProgress,
      statusImprovement: afterRank - beforeRank,
      damageReduction,
      hpGain: number(counterfactual.hero.hp, 0) - number(checkpoint.state.hero.hp, 0),
      atkGain: number(counterfactual.hero.atk, 0) - number(checkpoint.state.hero.atk, 0),
      defGain: number(counterfactual.hero.def, 0) - number(checkpoint.state.hero.def, 0),
      mdefGain: number(counterfactual.hero.mdef, 0) - number(checkpoint.state.hero.mdef, 0),
      expGain,
      levelGain,
    },
  };
}

function compareCandidate(left, right, preferFirstGoal, preferLevelProgress) {
  const progressOrder = preferLevelProgress
    ? Number(right.repairs.levelProgress) - Number(left.repairs.levelProgress)
    : 0;
  const firstGoalOrder = preferFirstGoal
    ? Number(right.checkpointRoles.includes("first-goal")) -
      Number(left.checkpointRoles.includes("first-goal"))
    : 0;
  return progressOrder || firstGoalOrder ||
    Number(right.repairs.blockerImprovement) - Number(left.repairs.blockerImprovement) ||
    statusRank(right.repairs.afterStatus) - statusRank(left.repairs.afterStatus) ||
    number(right.repairs.survivalMargin, -Infinity) - number(left.repairs.survivalMargin, -Infinity) ||
    right.repairs.survivalMarginGain - left.repairs.survivalMarginGain ||
    right.repairs.statusImprovement - left.repairs.statusImprovement ||
    right.repairs.damageReduction - left.repairs.damageReduction ||
    left.id.localeCompare(right.id);
}

function accessSummary(plan) {
  const alternatives = (plan.alternatives || []).map((alternative) => {
    const leading = (alternative.prerequisites || [])[0] || null;
    return {
      alternativeId: alternative.id,
      remainingPrerequisiteCount: (alternative.prerequisites || []).length,
      leadingPrerequisiteId: leading ? leading.sourceNodeId : null,
      leadingStatus: leading ? ((leading.evidence || {}).status || null) : "target-directly-reachable",
      startable: !leading || ((leading.evidence || {}).status) === "viable-at-current-state",
    };
  });
  return {
    startable: alternatives.some((alternative) => alternative.startable),
    alternatives,
  };
}

function compileRepairDependencyPlan(project, terminalGoal, checkpoint, repair, options) {
  const config = options || {};
  const graph = config.prebuiltGraph || buildAutomaticMacroGraph(project, checkpoint.state, terminalGoal, {
    towerId: config.towerId || "automatic",
    envelopeMode: "state-visible-revisitable",
  });
  const plan = compileAutomaticDependencyPlan(
    project,
    checkpoint.state,
    terminalGoal,
    graph,
    { selectedSubgoals: [repair] },
  );
  return {
    graph,
    graphBuilt: !config.prebuiltGraph,
    plan,
    access: accessSummary(plan),
  };
}

function compileAutomaticBlockerRepairs(project, terminalGoal, checkpoints, options) {
  if (!project || !terminalGoal || !Array.isArray(checkpoints)) {
    throw new Error("Automatic blocker repair requires project, terminalGoal, and checkpoints");
  }
  const config = options || {};
  const startedAt = Date.now();
  const excluded = config.excludedRepairExperimentKeys || new Set();
  const excludedAcquisitions = config.excludedRepairAcquisitionKeys || new Set();
  const compilationCache = config.compilationCache || null;
  const simulator = makeBlindSimulator(project);
  const candidates = [];
  const checkpointGraphs = new Map();
  let graphBuildCount = 0;
  let graphReuseCount = 0;
  let checkpointAnalysisCacheHits = 0;
  let accessCacheHits = 0;
  for (const checkpoint of checkpoints) {
    const projectionFingerprint = repairProjectionFingerprint(checkpoint.state);
    const stateAnalysisKey = checkpoint.exactStateFingerprint || hash(buildStateKey(checkpoint.state));
    const analysisKey = `${config.includeCombatRewardRepairs === true ? "item+combat" : "item"}|${stateAnalysisKey}`;
    let analysis = compilationCache
      ? compilationCache.checkpointAnalyses.get(analysisKey)
      : null;
    if (analysis) {
      checkpointAnalysisCacheHits += 1;
    } else {
      const graph = buildAutomaticMacroGraph(project, checkpoint.state, terminalGoal, {
        towerId: config.towerId || "automatic",
        envelopeMode: "state-visible-revisitable",
      });
      graphBuildCount += 1;
      const feasibility = compileAutomaticFeasibilitySubgoals(
        project,
        checkpoint.state,
        terminalGoal,
        graph,
      );
      const plan = compileAutomaticDependencyPlan(
        project,
        checkpoint.state,
        terminalGoal,
        graph,
        feasibility,
      );
      const resourceNodes = (graph.nodes || []).filter((node) =>
        (node.kind === "item" || (
          config.includeCombatRewardRepairs === true &&
          node.kind === "enemy" &&
          node.role !== "terminal-boss"
        )) &&
        node.id !== config.excludeTargetNodeId &&
        getTileDefinitionAt(project, checkpoint.state, node.floorId, node.x, node.y));
      analysis = { graph, plan, resourceNodes };
      if (compilationCache) compilationCache.checkpointAnalyses.set(analysisKey, analysis);
    }
    const { graph, plan, resourceNodes } = analysis;
    checkpointGraphs.set(checkpoint.id, graph);
    for (const alternative of plan.alternatives || []) {
      const leading = (alternative.prerequisites || [])[0];
      if (!leading || leading.target.role !== "combat-gate-candidate") continue;
      if ((leading.evidence || {}).status === "viable-at-current-state") continue;
      for (const node of resourceNodes) {
        const candidate = candidateFor(
          project,
          simulator,
          checkpoint,
          alternative,
          leading,
          node,
          projectionFingerprint,
        );
        if (candidate) candidates.push(candidate);
      }
    }
  }
  candidates.sort((left, right) =>
    compareCandidate(
      left,
      right,
      config.preferFirstGoalCheckpoint !== false,
      config.repairPriorityMode === "level-progress-first",
    ));
  let selected = null;
  let candidatesEvaluatedForAccess = 0;
  const accessByKey = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.checkpointId}|${candidate.sourceNodeId}`;
    let access = accessByKey.get(key);
    if (!access) {
      const checkpoint = checkpoints.find((entry) => entry.id === candidate.checkpointId);
      const stateAnalysisKey = checkpoint.exactStateFingerprint || hash(buildStateKey(checkpoint.state));
      const analysisKey = `${config.includeCombatRewardRepairs === true ? "item+combat" : "item"}|${stateAnalysisKey}`;
      const sharedAccessKey = `${analysisKey}|${candidate.sourceNodeId}`;
      access = compilationCache
        ? compilationCache.accessByStateAndResource.get(sharedAccessKey)
        : null;
      if (access) {
        accessCacheHits += 1;
      } else {
        const dependency = compileRepairDependencyPlan(
          project,
          terminalGoal,
          checkpoint,
          candidate,
          config.reuseCheckpointGraph === false
            ? config
            : { ...config, prebuiltGraph: checkpointGraphs.get(candidate.checkpointId) },
        );
        access = dependency.access;
        if (dependency.graphBuilt) graphBuildCount += 1;
        else graphReuseCount += 1;
        if (compilationCache) {
          compilationCache.accessByStateAndResource.set(sharedAccessKey, access);
        }
      }
      accessByKey.set(key, access);
      candidatesEvaluatedForAccess += 1;
    }
    candidate.access = access;
    const accessFingerprint = accessProjectionFingerprint(access);
    candidate.acquisitionExperimentKey = [
      candidate.repairProjectionFingerprint,
      candidate.sourceNodeId,
      accessFingerprint,
    ].join("|");
    candidate.experimentKey = [
      candidate.acquisitionExperimentKey,
      candidate.blockerProjectionFingerprint,
    ].join("|");
    if (
      excluded.has(candidate.experimentKey) ||
      excludedAcquisitions.has(candidate.acquisitionExperimentKey)
    ) continue;
    if (access.startable) {
      selected = candidate;
      break;
    }
  }
  const visibleCandidates = candidates.slice(0, number(config.candidateLimit, 16));
  if (selected && !visibleCandidates.includes(selected)) visibleCandidates.push(selected);
  return {
    schema: SCHEMA,
    inputContract: {
      inputs: ["tower-project", "terminal-goal", "automatic-local-checkpoints", "current-map-resources"],
      forbidden: ["route-fixture", "route-prefix", "authored-milestone", "authored-event-order", "authored-resource-threshold"],
      knownRouteUsed: false,
    },
    selectionPolicy: config.repairPriorityMode === "level-progress-first"
      ? "level-progress-before-first-goal-and-counterfactual-margin"
      : "first-goal-least-commitment-before-counterfactual-margin",
    compilationCost: {
      graphBuildCount,
      graphReuseCount,
      checkpointCount: checkpoints.length,
      uniqueAccessProbeCount: candidatesEvaluatedForAccess,
      checkpointAnalysisCacheHits,
      accessCacheHits,
      wallMs: Date.now() - startedAt,
    },
    candidateCount: candidates.length,
    candidateKinds: candidates.reduce((counts, candidate) => {
      counts[candidate.resourceKind] = Number(counts[candidate.resourceKind] || 0) + 1;
      return counts;
    }, {}),
    excludedExperimentCount: excluded.size,
    excludedAcquisitionCount: excludedAcquisitions.size,
    candidatesEvaluatedForAccess,
    candidates: visibleCandidates,
    selected,
    verdict: selected
      ? "AUTOMATIC_BLOCKER_REPAIR_IDENTIFIED"
      : "NO_AUTOMATIC_BLOCKER_REPAIR_IDENTIFIED",
  };
}

module.exports = {
  SCHEMA,
  accessProjectionFingerprint,
  battleStatus,
  blockerProjectionFingerprint,
  compileAutomaticBlockerRepairs,
  compileRepairDependencyPlan,
  counterfactualCombatReward,
  counterfactualPickup,
  counterfactualResource,
  makeRepairCompilationCache,
  repairGoal,
  repairProjectionFingerprint,
  statusRank,
};
