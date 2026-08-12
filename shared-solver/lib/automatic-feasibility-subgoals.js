"use strict";

const { EquipmentResolver, getEquipType } = require("./equipment-resolver");
const { addItem, cloneState, getTileDefinitionAt } = require("./state");

const SCHEMA = "motapathfinder.automatic-feasibility-subgoals.v1";

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effectiveHero(state) {
  const hero = (state || {}).hero || {};
  const flags = (state || {}).flags || {};
  return {
    atk: Math.floor(number(hero.atk, 0) * number(flags.__atk_buff__, 1)),
    def: Math.floor(number(hero.def, 0) * number(flags.__def_buff__, 1)),
    mdef: Math.floor(number(hero.mdef, 0) * number(flags.__mdef_buff__, 1)),
  };
}

function bossDeficits(project, state, terminalGoal) {
  const enemy = (project.enemysById || {})[terminalGoal.enemyId];
  if (!enemy) throw new Error(`Automatic feasibility target enemy not found: ${terminalGoal.enemyId}`);
  const hero = effectiveHero(state);
  return {
    hero,
    enemy: {
      atk: number(enemy.atk, 0),
      def: number(enemy.def, 0),
      hp: number(enemy.hp, 0),
    },
    attackDeficit: Math.max(0, number(enemy.def, 0) + 1 - hero.atk),
    defenseDeficit: Math.max(0, number(enemy.atk, 0) - hero.def - hero.mdef),
  };
}

function counterfactualEquipment(project, state, itemId) {
  const next = cloneState(state);
  addItem(next, itemId, 1);
  const equipType = getEquipType(project, next, itemId);
  if (equipType < 0) return null;
  try {
    new EquipmentResolver().applyAction({
      project,
      state: next,
      action: { equipId: itemId, equipType },
    });
    return next;
  } catch (_error) {
    return null;
  }
}

function remainingEquipmentNodes(project, state, graph) {
  return (graph.nodes || []).filter((node) => {
    if (node.role !== "equipment" || !node.tileId) return false;
    const tile = getTileDefinitionAt(project, state, node.floorId, node.x, node.y);
    return Boolean(tile && tile.id === node.tileId);
  });
}

function compileAutomaticFeasibilitySubgoals(project, state, terminalGoal, graph) {
  if (!project || !state || !terminalGoal || !graph) {
    throw new Error("Automatic feasibility subgoals require project, state, terminalGoal, and graph");
  }
  const baseline = bossDeficits(project, state, terminalGoal);
  const equipmentCandidates = remainingEquipmentNodes(project, state, graph)
    .map((node) => {
      const counterfactual = counterfactualEquipment(project, state, node.tileId);
      if (!counterfactual) return null;
      const after = bossDeficits(project, counterfactual, terminalGoal);
      const attackDeficitReduction = baseline.attackDeficit - after.attackDeficit;
      const defenseDeficitReduction = baseline.defenseDeficit - after.defenseDeficit;
      const effectiveGain =
        (after.hero.atk - baseline.hero.atk) * 1000000 +
        (after.hero.def - baseline.hero.def) * 1000 +
        (after.hero.mdef - baseline.hero.mdef);
      return {
        id: `auto-equipment-${node.tileId}-${node.floorId}-${node.x}-${node.y}`,
        kind: "equipment-feasibility",
        provenance: "automatic-macro-graph+counterfactual-equipment",
        sourceNodeId: node.id,
        target: { floorId: node.floorId, x: node.x, y: node.y, itemId: node.tileId },
        goal: { equipmentIncludes: [node.tileId] },
        score: {
          attackDeficitReduction,
          defenseDeficitReduction,
          effectiveGain,
        },
        baseline,
        counterfactual: after,
      };
    })
    .filter(Boolean)
    .filter((candidate) =>
      candidate.score.attackDeficitReduction > 0 ||
      candidate.score.defenseDeficitReduction > 0 ||
      candidate.score.effectiveGain > 0)
    .sort((left, right) =>
      right.score.attackDeficitReduction - left.score.attackDeficitReduction ||
      right.score.defenseDeficitReduction - left.score.defenseDeficitReduction ||
      right.score.effectiveGain - left.score.effectiveGain ||
      left.id.localeCompare(right.id));
  return {
    schema: SCHEMA,
    inputContract: {
      inputs: ["tower-project", "route-free-current-state", "terminal-goal", "automatic-macro-graph"],
      forbidden: ["route-fixture", "route-prefix", "milestone", "authored-event-order", "authored-resource-threshold"],
      knownRouteUsed: false,
      milestoneUsed: false,
    },
    planningEnvelope: { ...graph.floorCorridor },
    baseline,
    equipmentCandidates,
    selectedSubgoals: equipmentCandidates.slice(0, 1),
    verdict: equipmentCandidates.length > 0
      ? "AUTOMATIC_FEASIBILITY_SUBGOALS_COMPILED"
      : "NO_AUTOMATIC_FEASIBILITY_SUBGOAL_IDENTIFIED",
  };
}

module.exports = {
  SCHEMA,
  bossDeficits,
  compileAutomaticFeasibilitySubgoals,
  counterfactualEquipment,
  effectiveHero,
  remainingEquipmentNodes,
};
