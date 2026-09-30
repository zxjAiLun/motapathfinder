"use strict";

const { executeActionList, SUPPORTED_EVENT_TYPES, STATE_CHANGING_EVENT_TYPES, UnsupportedEventError,
  getFunctionEventEffect, getCommonEventActions, applyCommonEventArguments } = require("./events");
const { evaluateCondition } = require("./expression");
const { coordinateKey } = require("./reachability");

function asActionList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isStateChangingAction(action) {
  if (action == null || typeof action === "string") return false;
  if (typeof action !== "object" || !SUPPORTED_EVENT_TYPES.has(action.type)) return true;
  if (action.type === "function") {
    try { return getFunctionEventEffect(action) !== "presentation"; } catch (_) { return true; }
  }
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
    hasStateChange: prefix.hasStateChange === true || child.hasStateChange === true,
  };
}

function analyzeAction(project, state, action, extra) {
  const result = { choicePath: [], unsupported: [], hasStateChange: false };
  if (action == null || typeof action === "string") return [result];
  if (typeof action !== "object") {
    appendUnsupported(result, "unsupported-event-shape", { type: typeof action });
    return [result];
  }
  if (!SUPPORTED_EVENT_TYPES.has(action.type)) {
    appendUnsupported(result, "unsupported-event-type", action);
    return [result];
  }

  if (action.type === "function") {
    try { result.hasStateChange = getFunctionEventEffect(action) !== "presentation"; }
    catch (error) { appendUnsupported(result, error.message, action); }
    return [result];
  }
  if (action.type === "insert") {
    try {
      const depth = Number((extra || {}).commonEventDepth || 0);
      const actions = getCommonEventActions(project, action, depth);
      const callState = { ...state, flags: { ...state.flags } };
      applyCommonEventArguments(callState, action);
      return analyzeActionList(project, callState, actions, { ...extra, commonEventDepth: depth + 1 });
    } catch (error) {
      appendUnsupported(result, error.message, action);
      return [result];
    }
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

  if (action.type !== "choices") {
    result.hasStateChange = STATE_CHANGING_EVENT_TYPES.has(action.type);
    return [result];
  }

  const choices = Array.isArray(action.choices) ? action.choices : [];
  if (choices.length === 0) return [result];

  const stateChangingChoiceIndexes = choices
    .map((choice, index) => ({ choice, index }))
    .filter((entry) => actionListHasStateChange(entry.choice && entry.choice.action))
    .map((entry) => entry.index);

  if (stateChangingChoiceIndexes.length === 0) {
    const analyzedChoices = choices.map((choice, index) => ({
      index,
      branches: analyzeActionList(project, state, choice && choice.action || [], extra),
      isNoop: asActionList(choice && choice.action).length === 0,
    }));
    const safeChoice = analyzedChoices.find((entry) => entry.isNoop && entry.branches.some((branch) => (branch.unsupported || []).length === 0)) ||
      analyzedChoices.find((entry) => entry.branches.some((branch) => (branch.unsupported || []).length === 0)) ||
      analyzedChoices[0];
    const safeBranch = (safeChoice.branches || []).find((branch) => (branch.unsupported || []).length === 0) || (safeChoice.branches || [result])[0];
    return [mergeBranch({ choicePath: [safeChoice.index], unsupported: [] }, safeBranch)];
  }

  // Keep legal no-op exits as well as changing branches. Unknown scripts must
  // not cause the analyzer to discard a supported menu exit.
  return choices.flatMap((choice, index) => {
    const childBranches = analyzeActionList(project, state, choice && choice.action || [], extra);
    return childBranches.map((branch) => mergeBranch({ choicePath: [index], unsupported: [] }, branch));
  });
}

function analyzeActionList(project, state, actions, extra) {
  return asActionList(actions).reduce((branches, action) => {
    const nextBranches = analyzeAction(project, state, action, extra);
    return branches.flatMap((branch) => nextBranches.map((next) => mergeBranch(branch, next)));
  }, [{ choicePath: [], unsupported: [], hasStateChange: false }]);
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
      (node, tile, targetX, targetY, lookupState) =>
        Boolean(this.getEventAt(project, lookupState, lookupState.floorId, targetX, targetY)),
      (node, direction, targetX, targetY, tile, path, nodeState) => {
        const event = this.getEventAt(project, nodeState, nodeState.floorId, targetX, targetY);
        const branches = analyzeActionList(project, nodeState, event.data || [], {
          floorId: nodeState.floorId,
          eventLoc: { x: targetX, y: targetY },
        });
        return branches
          .map((branch, branchIndex) => {
            const unsupported = (branch.unsupported || []).length > 0;
            // Keep an explicit rejected-action descriptor: dropping it here
            // would hide model errors from canonical DP completeness accounting.
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
              hasStateChange: branch.hasStateChange === true,
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
      throw new UnsupportedEventError({ type: "event" }, `unsupported branch ${action.summary}`);
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
