"use strict";

const path = require("node:path");

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function numberOfEntries(value) {
  return Array.isArray(value) ? value.length : 0;
}

function milestoneScope(rawSpec, options) {
  const config = options || {};
  const milestones = Array.isArray(rawSpec && rawSpec.milestones)
    ? rawSpec.milestones
    : [];
  const targetIndex = config.targetMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === config.targetMilestoneId)
    : milestones.length - 1;
  if (targetIndex < 0) {
    throw new Error(`Unknown target milestone: ${config.targetMilestoneId}`);
  }
  const startIndex = config.fromMilestoneId
    ? milestones.findIndex((milestone) => milestone.id === config.fromMilestoneId)
    : -1;
  if (config.fromMilestoneId && startIndex < 0) {
    throw new Error(`Unknown start milestone: ${config.fromMilestoneId}`);
  }
  if (startIndex >= targetIndex) {
    throw new Error("fromMilestoneId must appear before targetMilestoneId");
  }
  return milestones.slice(startIndex + 1, targetIndex + 1).map(cloneJson);
}

function authoredRegionFields(milestone) {
  const result = [];
  const visit = (value, prefix) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const field = prefix ? `${prefix}.${key}` : key;
      if (/region/i.test(key)) result.push(field);
      if (child && typeof child === "object" && !Array.isArray(child)) {
        visit(child, field);
      }
    }
  };
  visit(milestone, "");
  return result;
}

function inventoryMilestoneHints(milestones) {
  const inventory = {
    milestonePlan: {
      totalMilestones: milestones.length,
      intermediateMilestones: Math.max(0, milestones.length - 1),
    },
    eventOrdering: {
      implicitArrayOrderEdges: Math.max(0, milestones.length - 1),
      explicitStartFromEdges: 0,
    },
    resourceThresholds: {
      milestonesWithMinHero: 0,
      minHeroFields: 0,
      exactDamageHints: 0,
      equipmentRequirements: 0,
    },
    tileAndActionHints: {
      removedTiles: 0,
      anyRemovedTiles: 0,
      presentTiles: 0,
      preferredPresentTiles: 0,
      actionSurvivableTargets: 0,
    },
    floorRestrictions: {
      milestonesWithAllowedFloors: 0,
      allowedFloorEntries: 0,
      milestonesWithAllowedTransitions: 0,
      allowedTransitionEntries: 0,
    },
    regionRestrictions: {
      authoredFieldOccurrences: 0,
      fields: [],
    },
    searchTuning: {
      milestonesWithOverrides: 0,
      authoredFields: 0,
      priorityModeOverrides: 0,
    },
  };

  for (const milestone of milestones) {
    const goal = milestone.goal || {};
    const policy = milestone.actionPolicy || {};
    const dp = milestone.dp || {};
    const minHero = goal.minHero || {};
    const minHeroFields = Object.keys(minHero);
    if (minHeroFields.length > 0) inventory.resourceThresholds.milestonesWithMinHero += 1;
    inventory.resourceThresholds.minHeroFields += minHeroFields.length;
    if (goal.actionSurvivable && goal.actionSurvivable.exactDamage != null) {
      inventory.resourceThresholds.exactDamageHints += 1;
    }
    inventory.resourceThresholds.equipmentRequirements += numberOfEntries(goal.equipmentIncludes);
    inventory.tileAndActionHints.removedTiles += numberOfEntries(goal.removedTiles);
    inventory.tileAndActionHints.anyRemovedTiles += numberOfEntries(goal.anyRemovedTiles);
    inventory.tileAndActionHints.presentTiles += numberOfEntries(goal.presentTiles);
    inventory.tileAndActionHints.preferredPresentTiles += numberOfEntries(goal.preferredPresentTiles);
    if (goal.actionSurvivable && goal.actionSurvivable.summary) {
      inventory.tileAndActionHints.actionSurvivableTargets += 1;
    }
    if (milestone.startFrom) inventory.eventOrdering.explicitStartFromEdges += 1;
    if (Array.isArray(policy.allowedFloors)) {
      inventory.floorRestrictions.milestonesWithAllowedFloors += 1;
      inventory.floorRestrictions.allowedFloorEntries += policy.allowedFloors.length;
    }
    if (Array.isArray(policy.allowChangeFloors)) {
      inventory.floorRestrictions.milestonesWithAllowedTransitions += 1;
      inventory.floorRestrictions.allowedTransitionEntries += policy.allowChangeFloors.length;
    }
    const regionFields = authoredRegionFields(milestone);
    inventory.regionRestrictions.authoredFieldOccurrences += regionFields.length;
    inventory.regionRestrictions.fields.push(...regionFields);
    const dpFields = Object.keys(dp);
    if (dpFields.length > 0) inventory.searchTuning.milestonesWithOverrides += 1;
    inventory.searchTuning.authoredFields += dpFields.length;
    if (Object.prototype.hasOwnProperty.call(dp, "priorityMode")) {
      inventory.searchTuning.priorityModeOverrides += 1;
    }
  }
  inventory.regionRestrictions.fields = Array.from(
    new Set(inventory.regionRestrictions.fields),
  ).sort();
  return inventory;
}

function removeResourceHints(milestone) {
  const result = cloneJson(milestone);
  delete result.goal.minHero;
  delete result.goal.actionSurvivable;
  delete result.goal.equipmentIncludes;
  return result;
}

function removeFloorAndRegionRestrictions(milestone) {
  const result = cloneJson(milestone);
  delete result.actionPolicy.allowedFloors;
  delete result.actionPolicy.allowChangeFloors;
  for (const key of Object.keys(result.actionPolicy)) {
    if (/region/i.test(key)) delete result.actionPolicy[key];
  }
  return result;
}

function terminalGoalOnly(milestone) {
  const goal = milestone.goal || {};
  const terminalGoal = {
    type: goal.type,
  };
  for (const key of ["floorId", "x", "y", "enemyId"]) {
    if (goal[key] != null) terminalGoal[key] = cloneJson(goal[key]);
  }
  return terminalGoal;
}

function buildBlindDiscoverySpec(rawSpec, options) {
  const config = options || {};
  const scoped = milestoneScope(rawSpec, config);
  const terminal = scoped[scoped.length - 1];
  if (!terminal || !terminal.goal || !terminal.goal.type) {
    throw new Error("A terminal goal is required for blind discovery");
  }
  const targetId = terminal.id || "terminal";
  return {
    routeName: `${rawSpec.routeName || "route"}-blind-${targetId}`,
    discoveryContract: {
      grade: "D3",
      allowedInputs: ["tower", "initial-state", "terminal-goal"],
      forbiddenInputs: [
        "route-fixture",
        "intermediate-milestone",
        "event-order",
        "resource-threshold",
        "floor-or-region-restriction",
      ],
      sourceRouteName: rawSpec.routeName || null,
      sourceTerminalMilestoneId: targetId,
    },
    milestones: [
      {
        id: `blind-${targetId}`,
        label: `Blind terminal goal: ${terminal.label || targetId}`,
        goal: terminalGoalOnly(terminal),
        actionPolicy: {},
        dp: {},
      },
    ],
  };
}

function buildAblationLadder(rawSpec, options) {
  const config = options || {};
  const scoped = milestoneScope(rawSpec, config);
  const noResource = scoped.map(removeResourceHints);
  const noFloorRegion = noResource.map(removeFloorAndRegionRestrictions);
  const noExplicitEdges = noFloorRegion.map((milestone) => {
    const result = cloneJson(milestone);
    delete result.startFrom;
    return result;
  });
  const blindSpec = buildBlindDiscoverySpec(rawSpec, config);
  const fixture = config.routeFixture || null;
  return [
    {
      id: "A0-assisted-plan",
      removed: [],
      routeFixture: fixture,
      milestoneCount: scoped.length,
      executionSupport: "supported",
      note: "Current milestone graph consumes the complete authored plan.",
    },
    {
      id: "A1-no-route-fixture",
      removed: ["route-fixture"],
      routeFixture: null,
      milestoneCount: scoped.length,
      executionSupport: config.fromMilestoneId
        ? "unsupported-without-equivalent-start-state"
        : "supported",
      note: config.fromMilestoneId
        ? "A mid-route scope needs an equivalent start state; removing its fixture is not a valid end-to-end discovery run."
        : "The canonical initial state is sufficient, but the authored plan remains.",
    },
    {
      id: "A2-no-resource-thresholds",
      removed: ["route-fixture", "resource-threshold"],
      routeFixture: null,
      milestoneCount: noResource.length,
      executionSupport: "structurally-supported-semantically-degraded",
      note: "Many heroAtLeast checkpoints become floor/tile gates and no longer encode their authored preparation intent.",
    },
    {
      id: "A3-no-floor-region-restrictions",
      removed: ["route-fixture", "resource-threshold", "floor-or-region-restriction"],
      routeFixture: null,
      milestoneCount: noFloorRegion.length,
      executionSupport: "structurally-supported-semantically-degraded",
      note: "The segment list still supplies the intended event sequence.",
    },
    {
      id: "A4-no-explicit-event-edges",
      removed: [
        "route-fixture",
        "resource-threshold",
        "floor-or-region-restriction",
        "explicit-startFrom",
      ],
      routeFixture: null,
      milestoneCount: noExplicitEdges.length,
      executionSupport: "not-an-autonomous-ablation",
      note: "runMilestoneGraph still executes array order; deleting startFrom does not remove the hidden event-order answer.",
    },
    {
      id: "A5-terminal-goal-only",
      removed: [
        "route-fixture",
        "resource-threshold",
        "floor-or-region-restriction",
        "event-order",
        "intermediate-milestone",
        "per-segment-search-tuning",
      ],
      routeFixture: null,
      milestoneCount: blindSpec.milestones.length,
      executionSupport: "single-segment-only",
      note: "The current engine can run one large DP segment, but has no component that discovers an unordered macro plan.",
    },
  ];
}

function auditDiscoveryCapability(rawSpec, options) {
  const config = options || {};
  const scoped = milestoneScope(rawSpec, config);
  const terminal = scoped[scoped.length - 1];
  const inventory = inventoryMilestoneHints(scoped);
  return {
    schema: "motapathfinder.discovery-capability-audit.v1",
    routeName: rawSpec.routeName || null,
    scope: {
      fromMilestoneId: config.fromMilestoneId || null,
      targetMilestoneId: terminal.id,
      startStateSource: config.routeFixture ? "route-fixture" : "canonical-initial-state",
      routeFixture: config.routeFixture
        ? path.normalize(config.routeFixture).replace(/\\/g, "/")
        : null,
    },
    allowedGoalInformation: terminalGoalOnly(terminal),
    authoredHintInventory: {
      ...inventory,
      routeFixture: {
        count: config.routeFixture ? 1 : 0,
      },
    },
    ablationLadder: buildAblationLadder(rawSpec, config),
    architecturalCeiling: {
      presentAt: "A0-assisted-plan",
      exposedBy: "A4-no-explicit-event-edges",
      capability: "unordered-event-planning",
      reason: "Even before ablation, the existing milestone runner consumes authored array order and cannot choose the next macro objective; deleting startFrom does not remove that hidden answer.",
    },
    blindBaselineContract: buildBlindDiscoverySpec(rawSpec, config).discoveryContract,
    verdict: "ASSISTED_EXECUTION_NOT_AUTONOMOUS_DISCOVERY",
  };
}

module.exports = {
  auditDiscoveryCapability,
  buildAblationLadder,
  buildBlindDiscoverySpec,
  inventoryMilestoneHints,
  milestoneScope,
  terminalGoalOnly,
};
