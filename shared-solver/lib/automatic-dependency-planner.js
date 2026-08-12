"use strict";

const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { cloneState, getTileDefinitionAt } = require("./state");

const SCHEMA = "motapathfinder.automatic-dependency-plan.v1";
const TRAVERSAL_EDGE_KINDS = new Set([
  "initial-location",
  "static-adjacency",
  "poi-contact",
  "floor-transition",
]);

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nodeAt(graph, id) {
  return (graph.nodes || []).find((node) => node.id === id) || null;
}

function targetNodeId(graph, subgoal) {
  if (subgoal.sourceNodeId && nodeAt(graph, subgoal.sourceNodeId)) return subgoal.sourceNodeId;
  const target = subgoal.target || {};
  const matches = (graph.nodes || []).filter((node) =>
    node.floorId === target.floorId &&
    number(node.x, NaN) === number(target.x, NaN) &&
    number(node.y, NaN) === number(target.y, NaN) &&
    (!target.itemId || node.tileId === target.itemId));
  if (matches.length !== 1) {
    throw new Error(`Automatic dependency target must match exactly one graph node; matched ${matches.length}`);
  }
  return matches[0].id;
}

function traversalAdjacency(graph) {
  const adjacency = new Map();
  for (const edge of graph.edges || []) {
    if (!TRAVERSAL_EDGE_KINDS.has(edge.kind)) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push({ to: edge.to, edge });
  }
  for (const entries of adjacency.values()) {
    entries.sort((left, right) => left.to.localeCompare(right.to) || left.edge.id.localeCompare(right.edge.id));
  }
  return adjacency;
}

function unresolvedPoi(project, state, node, targetId) {
  if (!node || node.id === targetId) return false;
  if (!["enemy", "door", "event"].includes(node.kind)) return false;
  if (node.x == null || node.y == null || !node.floorId) return node.kind === "event";
  const tile = getTileDefinitionAt(project, state, node.floorId, node.x, node.y);
  if (node.kind === "event") return true;
  return Boolean(tile && (!node.tileId || tile.id === node.tileId));
}

function nodeTraversalCost(project, state, node, targetId) {
  if (!node) return 1000000;
  if (node.id === targetId) return 0;
  if (unresolvedPoi(project, state, node, targetId)) return 1000;
  if (node.kind === "item") return 1;
  return 0;
}

function compareQueue(left, right) {
  return left.cost - right.cost || left.hops - right.hops || left.signature.localeCompare(right.signature);
}

function shortestPath(project, state, graph, sourceId, goalId, options) {
  const config = options || {};
  const bannedNodes = config.bannedNodes || new Set();
  const bannedEdges = config.bannedEdges || new Set();
  const adjacency = config.adjacency || traversalAdjacency(graph);
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const queue = [{ id: sourceId, cost: 0, hops: 0, path: [sourceId], edgeIds: [], signature: sourceId }];
  const best = new Map([[sourceId, { cost: 0, hops: 0 }]]);
  while (queue.length > 0) {
    queue.sort(compareQueue);
    const current = queue.shift();
    const known = best.get(current.id);
    if (known && (current.cost > known.cost || (current.cost === known.cost && current.hops > known.hops))) continue;
    if (current.id === goalId) return current;
    for (const entry of adjacency.get(current.id) || []) {
      if (bannedNodes.has(entry.to) || bannedEdges.has(entry.edge.id)) continue;
      const nextNode = nodes.get(entry.to);
      if (!nextNode) continue;
      const cost = current.cost + nodeTraversalCost(project, state, nextNode, goalId);
      const hops = current.hops + 1;
      const previous = best.get(entry.to);
      if (previous && (cost > previous.cost || (cost === previous.cost && hops >= previous.hops))) continue;
      best.set(entry.to, { cost, hops });
      queue.push({
        id: entry.to,
        cost,
        hops,
        path: current.path.concat(entry.to),
        edgeIds: current.edgeIds.concat(entry.edge.id),
        signature: `${current.signature}>${entry.to}`,
      });
    }
  }
  return null;
}

function blockerEvidence(project, state, node, battleResolver) {
  if (node.kind === "enemy") {
    const evaluationState = cloneState(state);
    evaluationState.floorId = node.floorId;
    evaluationState.hero.loc = {
      ...(evaluationState.hero.loc || {}),
      x: node.x,
      y: node.y,
    };
    const evaluation = battleResolver.evaluateBattle(evaluationState, node.floorId, node.x, node.y, node.tileId);
    const damage = evaluation.damageInfo && evaluation.damageInfo.damage;
    return {
      kind: "battle-survivability",
      status: !evaluation.supported
        ? "unsupported"
        : damage == null
          ? "unbeatable-at-current-stats"
          : number(damage, Infinity) >= number((state.hero || {}).hp, 0)
            ? "lethal-at-current-hp"
            : "viable-at-current-state",
      damage: damage == null ? null : number(damage, 0),
      currentHp: number((state.hero || {}).hp, 0),
      reason: evaluation.reason || null,
      probeSemantics: "counterfactual-current-resources-at-target-floor-not-path-execution",
    };
  }
  if (node.kind === "door") {
    const missing = Object.entries(node.requirements || {})
      .map(([itemId, amount]) => ({
        itemId,
        required: number(amount, 0),
        current: number((state.inventory || {})[itemId], 0),
      }))
      .filter((entry) => entry.current < entry.required);
    return {
      kind: "door-resource",
      status: missing.length === 0 ? "viable-at-current-state" : "missing-resource",
      missing,
    };
  }
  return {
    kind: "scripted-event",
    status: "requires-simulator-execution",
  };
}

function planFromPath(project, state, graph, targetId, path, battleResolver, ordinal) {
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const prerequisites = path.path
    .map((id) => nodes.get(id))
    .filter((node) => unresolvedPoi(project, state, node, targetId))
    .map((node, index) => ({
      id: `require-${node.id}`,
      kind: "prerequisite",
      relation: "AND",
      order: index,
      sourceNodeId: node.id,
      actionGoal: node.kind === "enemy" || node.kind === "door"
        ? { type: "tileRemoved", floorId: node.floorId, x: node.x, y: node.y }
        : { type: "eventReached", floorId: node.floorId, x: node.x, y: node.y },
      target: {
        floorId: node.floorId,
        x: node.x,
        y: node.y,
        tileId: node.tileId || null,
        role: node.role || null,
      },
      evidence: blockerEvidence(project, state, node, battleResolver),
      provenance: "automatic-macro-graph-topology+current-state-simulator-probe",
    }));
  return {
    id: `alternative-${ordinal + 1}`,
    relation: "OR",
    rank: ordinal + 1,
    blockerCount: prerequisites.length,
    topologyHops: path.hops,
    topologyCost: path.cost,
    prerequisites,
    pathNodeIds: path.path,
    pathEdgeIds: path.edgeIds,
  };
}

function distinctAlternativePaths(project, state, graph, sourceId, goalId, limit) {
  const adjacency = traversalAdjacency(graph);
  const first = shortestPath(project, state, graph, sourceId, goalId, { adjacency });
  if (!first) return [];
  const candidates = [first];
  const signatures = new Set([first.path.join(">")]);
  const blockerIds = first.path.filter((id) => unresolvedPoi(project, state, nodeAt(graph, id), goalId));
  for (const blockerId of blockerIds) {
    const alternative = shortestPath(project, state, graph, sourceId, goalId, {
      adjacency,
      bannedNodes: new Set([blockerId]),
    });
    if (!alternative) continue;
    const signature = alternative.path.join(">");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    candidates.push(alternative);
  }
  for (const edgeId of first.edgeIds) {
    const alternative = shortestPath(project, state, graph, sourceId, goalId, {
      adjacency,
      bannedEdges: new Set([edgeId]),
    });
    if (!alternative) continue;
    const signature = alternative.path.join(">");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    candidates.push(alternative);
  }
  return candidates
    .sort(compareQueue)
    .slice(0, Math.max(1, number(limit, 6)));
}

function compileAutomaticDependencyPlan(project, state, terminalGoal, graph, feasibilityReport, options) {
  if (!project || !state || !terminalGoal || !graph || !feasibilityReport) {
    throw new Error("Automatic dependency planner requires project, state, terminalGoal, graph, and feasibilityReport");
  }
  const selected = (feasibilityReport.selectedSubgoals || [])[0];
  if (!selected) {
    return {
      schema: SCHEMA,
      inputContract: {
        inputs: ["tower-project", "route-free-current-state", "terminal-goal", "automatic-macro-graph", "automatic-feasibility-subgoals"],
        forbidden: ["route-fixture", "route-prefix", "milestone", "authored-event-order", "authored-resource-threshold"],
        knownRouteUsed: false,
      },
      objective: { terminalGoal },
      alternatives: [],
      verdict: "NO_SELECTED_FEASIBILITY_SUBGOAL",
    };
  }
  const targetId = targetNodeId(graph, selected);
  const paths = distinctAlternativePaths(project, state, graph, "source:initial", targetId, (options || {}).alternativeLimit);
  const battleResolver = new FunctionBackedBattleResolver(project);
  const alternatives = paths.map((path, index) =>
    planFromPath(project, state, graph, targetId, path, battleResolver, index));
  const allPrerequisiteIds = Array.from(new Set(alternatives.flatMap((alternative) =>
    alternative.prerequisites.map((entry) => entry.sourceNodeId)))).sort();
  const commonPrerequisiteIds = alternatives.length === 0 ? [] : allPrerequisiteIds.filter((id) =>
    alternatives.every((alternative) => alternative.prerequisites.some((entry) => entry.sourceNodeId === id)));
  return {
    schema: SCHEMA,
    inputContract: {
      inputs: ["tower-project", "route-free-current-state", "terminal-goal", "automatic-macro-graph", "automatic-feasibility-subgoals"],
      forbidden: ["route-fixture", "route-prefix", "milestone", "authored-event-order", "authored-resource-threshold"],
      knownRouteUsed: false,
      authoredSequenceUsed: false,
    },
    objective: {
      terminalGoal: { ...terminalGoal },
      selectedFeasibilitySubgoal: selected,
      targetNodeId: targetId,
    },
    logic: {
      rootRelation: "OR",
      alternativeRelation: "AND",
      alternativeCount: alternatives.length,
      commonPrerequisiteIds,
    },
    alternatives,
    summary: {
      allPrerequisiteIds,
      viableNow: allPrerequisiteIds.filter((id) => alternatives.some((alternative) =>
        alternative.prerequisites.some((entry) => entry.sourceNodeId === id && entry.evidence.status === "viable-at-current-state"))),
      blockedNow: allPrerequisiteIds.filter((id) => alternatives.some((alternative) =>
        alternative.prerequisites.some((entry) => entry.sourceNodeId === id && entry.evidence.status !== "viable-at-current-state"))),
      dependencyCompleteness: "bounded-topology-alternatives-not-proof",
    },
    verdict: alternatives.length > 0
      ? "AUTOMATIC_AND_OR_DEPENDENCY_PLAN_COMPILED"
      : "AUTOMATIC_DEPENDENCY_TARGET_DISCONNECTED",
  };
}

module.exports = {
  SCHEMA,
  compileAutomaticDependencyPlan,
  distinctAlternativePaths,
  shortestPath,
  traversalAdjacency,
};
