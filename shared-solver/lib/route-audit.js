"use strict";

const { cloneState, getDecisionDepth } = require("./state");
const { scanResourceIntents } = require("./resource-intent-scanner");
const { parseBattleSummary } = require("./battle-thresholds");
const { createStateFromSnapshot } = require("./route-store");
const { searchSegmentDP, buildSegmentGoalPredicate } = require("./segment-dp");

const DEFAULT_AUDIT_OPTIONS = {
  minDamageDelta: 1000,
  minSavingsRatio: 0.15,
  candidateLimit: 3,
  intentDepth: 2,
  maxIntentNodes: 80,
  maxIntentRecords: 12,
  recordsPerIntent: 4,
  maxIntents: 4,
};

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(filePath) {
  return require("node:fs").readFileSync(filePath, "utf8");
}

function parseTimeline(timeline) {
  if (!timeline) return null;
  if (typeof timeline === "string") return JSON.parse(readJson(timeline));
  return timeline;
}

function safeCandidates(inspector) {
  return Array.isArray((inspector || {}).candidates) ? inspector.candidates : [];
}

function findPickedCandidate(inspector) {
  if (!inspector) return null;
  return safeCandidates(inspector).find((c) => c && c.plannedNext) || null;
}

function pickCheaperBattleAlternatives(picked, candidates, options) {
  if (!picked || picked.damage == null) return [];
  return candidates
    .filter((c) => c && c.kind === "battle" && c.damage != null && c.damage < picked.damage)
    .sort((a, b) => a.damage - b.damage)
    .slice(0, options.candidateLimit);
}

function identifyExpensiveSteps(timeline, options) {
  const config = { ...DEFAULT_AUDIT_OPTIONS, ...(options || {}) };
  const findings = [];
  const steps = Array.isArray(timeline.steps) ? timeline.steps : [];
  for (let i = 1; i < steps.length; i += 1) {
    const step = steps[i];
    const inspector = step.preInspector || step.actionInspector;
    const picked = findPickedCandidate(inspector);
    if (!picked || picked.damage == null || picked.damage <= 0) continue;
    const alternatives = pickCheaperBattleAlternatives(picked, safeCandidates(inspector), config);
    if (alternatives.length === 0) continue;
    const bestAlt = alternatives[0];
    const savings = picked.damage - bestAlt.damage;
    if (savings < config.minDamageDelta) continue;
    if (savings / picked.damage < config.minSavingsRatio) continue;
    findings.push({
      stepIndex: i,
      stepSummary: step.summary,
      floorId: step.floorId,
      picked: { summary: picked.summary, damage: picked.damage, lethal: !!picked.lethal },
      cheaper: alternatives.map((alt) => ({
        summary: alt.summary,
        damage: alt.damage,
        enemyId: alt.enemyId,
        targetLabel: alt.targetLabel,
      })),
      bestSaving: savings,
      savingsRatio: savings / picked.damage,
      preHero: step.hero || null,
    });
  }
  return findings;
}

function buildRouteAuditCandidate(project, step, finding) {
  if (!step || !step.snapshot) return null;
  const snapshot = step.snapshot;
  if (!snapshot || !snapshot.hero) return null;
  let state;
  try {
    state = createStateFromSnapshot(project, snapshot, { rank: "chaos" });
  } catch (error) {
    return null;
  }
  return [{
    id: `route-audit:step-${finding.stepIndex}`,
    state,
  }];
}

function synthesizeFailureForFinding(finding) {
  const pickedDamage = finding.picked.damage;
  const heroHp = number((finding.preHero || {}).hp, 0);
  return {
    failureClass: heroHp > 0 && pickedDamage >= heroHp * 0.6 ? "hp-deficit" : "action-survivability-deficit",
    missingGoalFields: [
      {
        field: "actionSurvivable",
        expected: finding.picked.summary,
        actual: "expensive-pick",
        damage: pickedDamage,
      },
      {
        field: "hero.hp",
        expected: Math.max(0, pickedDamage + 1),
        actual: heroHp,
      },
    ],
  };
}

function buildRepairMilestoneFromIntent(intent, finding, existingIds) {
  const primaryRecord = (intent.records && intent.records[0]) || null;
  const actionSummary = primaryRecord ? primaryRecord.actionSummary : null;
  const targetBattle = intent.targetBattle || null;
  const scannerFloorId = intent.goal && intent.goal.floorId ? intent.goal.floorId : null;
  const floorId = scannerFloorId || targetBattle && targetBattle.floorId || finding.floorId;
  if (!floorId) return null;
  const id = `repair:route-audit:${finding.stepIndex}:${intent.kind}`;
  if (existingIds && existingIds.has(id)) return null;
  const goal = {
    type: "adaptiveResourceIntent",
    floorId,
  };
  // Route-audit prefers the picked-vs-cheaper signal: the goal is to reach
  // a state where the cheaper[0] battle is survivable, not where the
  // picked battle has been softened. Build actionSurvivable from the
  // cheaper alternative when it shares the picked floor.
  const cheaper = (finding.cheaper || [])[0];
  const cheaperParsed = cheaper ? parseBattleSummary(cheaper.summary) : null;
  if (cheaperParsed && cheaperParsed.floorId === finding.floorId) {
    goal.actionSurvivable = { summary: cheaper.summary };
  } else if (actionSummary && actionSummary.startsWith("battle:")) {
    goal.actionSurvivable = { summary: actionSummary };
  } else if (actionSummary && (actionSummary.startsWith("pickup:") || actionSummary.startsWith("interactPickup:"))) {
    goal.tileRemoved = actionSummary.split(":").slice(1).join(":");
  } else if (targetBattle) {
    goal.actionSurvivable = {
      summary: `battle:${targetBattle.enemyId}@${targetBattle.floorId}:${targetBattle.x},${targetBattle.y}`,
    };
  }
  const policy = intent.actionPolicy || {
    actionKinds: ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"],
  };
  const allowedFloorsSet = new Set(
    (policy.allowedFloors || []).filter(Boolean).concat([floorId])
  );
  return {
    id,
    label: `Route-audit repair step ${finding.stepIndex}: ${intent.kind}`,
    startFrom: "previous",
    goal,
    actionPolicy: {
      actionKinds: policy.actionKinds || ["battle", "pickup", "equip", "openDoor", "useTool", "changeFloor", "floorFly", "event"],
      allowedFloors: Array.from(allowedFloorsSet).sort(),
      allowChangeFloors: policy.allowChangeFloors || undefined,
      forbidUnsupportedEvents: true,
    },
    dp: {
      keyMode: "location",
      stopOnFirstGoal: false,
      goalSkylineLimit: 8,
      dpSkylineMax: 2,
      maxExpansions: 4000,
      maxRuntimeMs: 8000,
    },
    _meta: {
      generatedBy: "route-audit-resource-intent",
      source: "route-audit",
      stepIndex: finding.stepIndex,
      intentKind: intent.kind,
      primaryStat: intent.primaryStat,
      finding: {
        picked: finding.picked,
        cheaper: finding.cheaper,
        bestSaving: finding.bestSaving,
        savingsRatio: Math.round(finding.savingsRatio * 1000) / 1000,
      },
      topAction: actionSummary,
      topTargetBattle: targetBattle,
      goalAction: goal.actionSurvivable && goal.actionSurvivable.summary,
    },
  };
}

function auditRouteForExpensivePicks(simulator, project, timeline, options) {
  const config = { ...DEFAULT_AUDIT_OPTIONS, ...(options || {}) };
  const parsed = parseTimeline(timeline);
  if (!parsed) return { findings: [], intents: [], milestones: [] };
  const findings = identifyExpensiveSteps(parsed, config);
  const existingIds = new Set((config.existingMilestoneIds || []));
  const intents = [];
  const milestones = [];
  const usedFindings = new Set();
  for (const finding of findings) {
    if (usedFindings.has(finding.stepIndex)) continue;
    const candidate = buildRouteAuditCandidate(project, parsed.steps[finding.stepIndex - 1], finding);
    if (!candidate) continue;
    const failure = synthesizeFailureForFinding(finding);
    const targetBattle = parseBattleSummary(finding.picked.summary);
    const targetFloor = finding.floorId;
    let intent;
    try {
      const scanned = scanResourceIntents(simulator, candidate, failure, {
        intentDepth: config.intentDepth,
        maxIntentNodes: config.maxIntentNodes,
        maxIntentRecords: config.maxIntentRecords,
        recordsPerIntent: config.recordsPerIntent,
        maxIntents: config.maxIntents,
        includeBlockedResources: true,
        targetBattle,
      });
      intent = scanned && scanned[0];
    } catch (error) {
      intent = null;
    }
    if (!intent) continue;
    usedFindings.add(finding.stepIndex);
    intents.push({ finding, intent, targetBattle, targetFloor });
    const milestone = buildRepairMilestoneFromIntent(intent, finding, existingIds);
    if (milestone) {
      existingIds.add(milestone.id);
      milestones.push(milestone);
    }
  }
  return { findings, intents, milestones };
}

function summarizeRepairResult(simulator, startState, segment, options) {
  const config = options || {};
  let startSurvivable = false;
  let startReachable = false;
  try {
    const predicate = buildSegmentGoalPredicate(simulator.project, segment, simulator);
    startSurvivable = Boolean(predicate(startState));
  } catch (error) {
    /* ignore */
  }
  try {
    const goalSummary = segment && segment.goal && segment.goal.actionSurvivable && segment.goal.actionSurvivable.summary;
    const parsed = goalSummary ? parseBattleSummary(goalSummary) : null;
    if (parsed) {
      const primitive = simulator.enumeratePrimitiveActions(startState);
      const action = (primitive.actions || []).find((candidate) => candidate && candidate.summary === goalSummary);
      startReachable = Boolean(action);
      if (!startReachable) {
        const reachability = simulator.getWalkReachability(startState);
        const targetKey = `${parsed.x},${parsed.y}`;
        startReachable = Boolean(reachability && reachability.visited && reachability.visited[targetKey]);
      }
    }
  } catch (error) {
    /* ignore */
  }
  let result;
  try {
    result = searchSegmentDP(simulator, startState, segment, {
      captureTrace: false,
      maxExpansions: config.maxExpansions,
      maxRuntimeMs: config.maxRuntimeMs,
    });
  } catch (error) {
    return { found: false, error: error && error.message ? error.message : String(error), startSurvivable, startReachable };
  }
  const dpDiag = (result && result.diagnostics && result.diagnostics.dp) || {};
  const finalState = result && (result.bestGoalState || result.firstGoalState);
  if (!finalState) {
    return {
      found: false,
      startSurvivable,
      startReachable,
      stoppedReason: dpDiag.stoppedReason,
      expansions: dpDiag.expansions,
      frontierSize: dpDiag.frontierSize,
      actionTrimmed: dpDiag.actionTrimmed,
      goalFound: dpDiag.foundFirstGoal,
    };
  }
  return {
    found: true,
    startSurvivable,
    startReachable,
    finalHp: Number((finalState.hero || {}).hp || 0),
    finalFloor: finalState.floorId,
    routeLength: Array.isArray(finalState.route) ? finalState.route.length : 0,
    expansions: dpDiag.expansions,
    stoppedReason: dpDiag.stoppedReason,
  };
}

function verifyRepairMilestones(simulator, project, timeline, milestones, options) {
  const config = options || {};
  const parsed = parseTimeline(timeline);
  if (!parsed) return { results: [] };
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const results = [];
  for (const milestone of milestones) {
    const stepIndex = (milestone._meta && milestone._meta.stepIndex) || null;
    if (!stepIndex) continue;
    const preStep = steps[stepIndex - 1];
    if (!preStep || !preStep.snapshot) continue;
    let startState;
    try {
      startState = createStateFromSnapshot(project, preStep.snapshot, { rank: "chaos" });
    } catch (error) {
      results.push({
        milestoneId: milestone.id,
        found: false,
        error: `snapshot: ${error.message}`,
      });
      continue;
    }
    const summary = summarizeRepairResult(simulator, startState, milestone, {
      maxExpansions: config.maxExpansions || 4000,
      maxRuntimeMs: config.maxRuntimeMs || 8000,
    });
    const finding = (milestone._meta && milestone._meta.finding) || null;
    const pickedDamage = finding ? finding.picked.damage : null;
    const savings = finding ? finding.bestSaving : null;
    const startHp = Number((preStep.snapshot.hero || {}).hp || 0);
    let reason = "no-repair-needed";
    if (summary.found && summary.startReachable) {
      reason = "repair-routes-found";
    } else if (summary.startSurvivable && !summary.startReachable) {
      reason = "cheaper-unreachable";
    } else if (!summary.startSurvivable) {
      reason = "cheaper-not-survivable";
    } else {
      reason = "no-repair-route";
    }
    results.push({
      milestoneId: milestone.id,
      stepIndex,
      intentKind: milestone._meta && milestone._meta.intentKind,
      pickedSummary: finding && finding.picked.summary,
      pickedDamage,
      savings,
      startHp,
      ...summary,
      startSurvivable: Boolean(summary.startSurvivable),
      startReachable: Boolean(summary.startReachable),
      improved: Boolean(summary.found) && Boolean(summary.startReachable),
      reason,
    });
  }
  return { results };
}

module.exports = {
  auditRouteForExpensivePicks,
  identifyExpensiveSteps,
  parseTimeline,
  buildRepairMilestoneFromIntent,
  summarizeRepairResult,
  verifyRepairMilestones,
  DEFAULT_AUDIT_OPTIONS,
};
