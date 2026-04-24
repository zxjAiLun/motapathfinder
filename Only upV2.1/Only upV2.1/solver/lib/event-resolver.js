"use strict";

const { executeActionList } = require("./events");
const { evaluateCondition } = require("./expression");
const { coordinateKey } = require("./reachability");

const SUPPORTED_EVENT_TYPES = new Set([
  "setValue",
  "openDoor",
  "if",
  "choices",
  "hide",
  "setBlock",
  "changeFloor",
  "win",
]);

const STATE_CHANGING_EVENT_TYPES = new Set([
  "setValue",
  "openDoor",
  "hide",
  "setBlock",
  "changeFloor",
  "win",
]);

function asActionList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isStateChangingAction(action) {
  if (action == null || typeof action !== "object") return false;
  if (STATE_CHANGING_EVENT_TYPES.has(action.type)) return true;
  if (action.type === "if") {
    return actionListHasStateChange(action.true) || actionListHasStateChange(action.false);
  }
  if (action.type === "choices") {
    return (action.choices || []).some((choice) => actionListHasStateChange(choice && choice.action));
  }
  return false;
}

function actionListHasStateChange(actions) {
  return asActionList(actions).some(isStateChangingAction);
}

function appendUnsupported(result, reason, action) {
  result.unsupported.push({ reason, type: action && action.type });
}

function mergeBranch(prefix, child) {
  return {
    choicePath: (prefix.choicePath || []).concat(child.choicePath || []),
    unsupported: (prefix.unsupported || []).concat(child.unsupported || []),
  };
}

function analyzeAction(project, state, action, extra) {
  const result = { choicePath: [], unsupported: [] };
  if (action == null || typeof action !== "object") return [result];
  if (!SUPPORTED_EVENT_TYPES.has(action.type)) {
    appendUnsupported(result, "unsupported-event-type", action);
    return [result];
  }

  if (action.type === "if") {
    let branch;
    try {
      branch = evaluateCondition(action.condition, project, state, extra) ? action.true : action.false;
    } catch (error) {
      appendUnsupported(result, "unsupported-if-condition", action);
      return [result];
    }
    return analyzeActionList(project, state, branch || [], extra);
  }

  if (action.type !== "choices") return [result];

  const choices = Array.isArray(action.choices) ? action.choices : [];
  if (choices.length === 0) return [result];

  const stateChangingChoiceIndexes = choices
    .map((choice, index) => ({ choice, index }))
    .filter((entry) => actionListHasStateChange(entry.choice && entry.choice.action))
    .map((entry) => entry.index);

  if (stateChangingChoiceIndexes.length === 0) {
    return [{ choicePath: [0], unsupported: [] }];
  }

  return stateChangingChoiceIndexes.flatMap((index) => {
    const choice = choices[index];
    const childBranches = analyzeActionList(project, state, choice && choice.action || [], extra);
    return childBranches.map((branch) => mergeBranch({ choicePath: [index], unsupported: [] }, branch));
  });
}

function analyzeActionList(project, state, actions, extra) {
  return asActionList(actions).reduce((branches, action) => {
    const nextBranches = analyzeAction(project, state, action, extra);
    return branches.flatMap((branch) => nextBranches.map((next) => mergeBranch(branch, next)));
  }, [{ choicePath: [], unsupported: [] }]);
}

function buildChoiceResolver(choicePath) {
  const path = Array.isArray(choicePath) ? choicePath.slice() : [];
  let index = 0;
  return (choiceAction) => {
    const choices = Array.isArray(choiceAction.choices) ? choiceAction.choices : [];
    if (choices.length === 0) return null;
    const selectedIndex = index < path.length ? path[index] : 0;
    index += 1;
    return choices[selectedIndex] || choices[0];
  };
}

class EventResolver {
  constructor(options) {
    const config = options || {};
    this.includeUnsupportedExperiments = Boolean(config.includeUnsupportedExperiments);
  }

  getEventAt(project, state, floorId, x, y) {
    const floor = project.floorsById[floorId];
    const locKey = coordinateKey(x, y);
    const event = (floor.events || {})[locKey];
    if (!event || event.enable === false) return null;
    if (!Array.isArray(event.data)) return null;
    return event;
  }

  enumerateActions(context) {
    const { project, helper } = context;
    return helper.findAdjacencyActions(
      (node, tile, targetX, targetY) => Boolean(this.getEventAt(project, node.state, node.state.floorId, targetX, targetY)),
      (node, direction, targetX, targetY, tile, path, nodeState) => {
        const event = this.getEventAt(project, nodeState, nodeState.floorId, targetX, targetY);
        const eventHasStateChange = actionListHasStateChange(event.data || []);
        const branches = analyzeActionList(project, nodeState, event.data || [], {
          floorId: nodeState.floorId,
          eventLoc: { x: targetX, y: targetY },
        });
        return branches
          .map((branch, branchIndex) => {
            const unsupported = (branch.unsupported || []).length > 0;
            if (unsupported && !this.includeUnsupportedExperiments) return null;
            return {
              kind: "event",
              floorId: nodeState.floorId,
              stance: { x: node.x, y: node.y },
              direction,
              x: targetX,
              y: targetY,
              path,
              travelState: nodeState,
              eventData: event.data,
              choicePath: branch.choicePath || [],
              hasStateChange: eventHasStateChange,
              unsupported,
              unsupportedDetails: branch.unsupported || [],
              summary: unsupported
                ? `unsupportedEvent@${nodeState.floorId}:${targetX},${targetY}#${branchIndex}`
                : `event@${nodeState.floorId}:${targetX},${targetY}#${branchIndex}:${(branch.choicePath || []).join(".") || "auto"}`,
            };
          })
          .filter(Boolean);
      }
    ).flat();
  }

  applyAction(context) {
    const { project, state, action, stabilizeState } = context;
    if (action.unsupported) {
      throw new Error(`Unsupported event branch cannot be applied: ${action.summary}`);
    }
    executeActionList(
      project,
      state,
      action.eventData || [],
      { floorId: state.floorId, eventLoc: { x: action.x, y: action.y } },
      { choiceResolver: buildChoiceResolver(action.choicePath) }
    );
    if (typeof stabilizeState === "function") stabilizeState(state);
  }
}

module.exports = {
  EventResolver,
  analyzeActionList,
  actionListHasStateChange,
};
