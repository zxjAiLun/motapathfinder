"use strict";

const { evaluateCondition, evaluateExpression } = require("./expression");
const { recordLeaveLocation, resolveChangeFloorTarget } = require("./floor-transitions");
const { addItem, removeTileAt, replaceTileAt, hasVisitedFloor, visitFloor } = require("./state");
const { unloadEquipment } = require("./equipment-resolver");

function applyOperator(targetValue, operator, value) {
  const currentValue = targetValue == null ? 0 : targetValue;
  switch (operator || "=") {
    case "=":
      return value;
    case "+=":
      return currentValue + value;
    case "-=":
      return currentValue - value;
    case "*=":
      return currentValue * value;
    case "/=":
      return currentValue / value;
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

function setValueTarget(project, state, name, operator, expression, extra) {
  const value = evaluateExpression(expression, project, state, extra);
  if (name.startsWith("status:")) {
    const key = name.slice("status:".length);
    state.hero[key] = applyOperator(state.hero[key], operator, value);
    return;
  }
  if (name.startsWith("item:")) {
    const itemId = name.slice("item:".length);
    if ((operator || "=") === "=" && value == null) {
      delete state.inventory[itemId];
      return;
    }
    state.inventory[itemId] = applyOperator(state.inventory[itemId], operator, value);
    if (state.inventory[itemId] == null || state.inventory[itemId] === 0) {
      delete state.inventory[itemId];
    }
    return;
  }
  if (name.startsWith("flag:")) {
    const flagName = name.slice("flag:".length);
    if ((operator || "=") === "=" && value == null) {
      delete state.flags[flagName];
      return;
    }
    state.flags[flagName] = applyOperator(state.flags[flagName], operator, value);
    return;
  }
  throw new UnsupportedEventError({ type: "setValue" }, `unsupported target ${name}`);
}

function normalizeLocationList(project, state, loc, extra) {
  if (!Array.isArray(loc)) return [];
  if (loc.length === 2 && !Array.isArray(loc[0])) {
    return [
      {
        x: Number(evaluateExpression(loc[0], project, state, extra)),
        y: Number(evaluateExpression(loc[1], project, state, extra)),
      },
    ];
  }
  return loc.map((point) => ({
    x: Number(evaluateExpression(point[0], project, state, extra)),
    y: Number(evaluateExpression(point[1], project, state, extra)),
  }));
}

function defaultChoiceResolver(choiceAction) {
  if (!Array.isArray(choiceAction.choices) || choiceAction.choices.length === 0) {
    return null;
  }

  const emptyChoice = choiceAction.choices.find((choice) => Array.isArray(choice.action) && choice.action.length === 0);
  if (emptyChoice) return emptyChoice;
  return choiceAction.choices[0];
}

const NOOP_EVENT_TYPES = new Set([
  "showStatusBar",
  "hideStatusBar",
  "setText",
  "text",
  "comment",
  "sleep",
  "wait",
]);

const STATE_CHANGING_EVENT_TYPES = new Set([
  "setValue",
  "openDoor",
  "hide",
  "setBlock",
  "changeFloor",
  "win",
  "function",
  "insert",
  "unloadEquip",
  "unfollow",
]);

const SUPPORTED_EVENT_TYPES = new Set([
  ...NOOP_EVENT_TYPES,
  ...STATE_CHANGING_EVENT_TYPES,
  "if",
  "choices",
]);

class UnsupportedEventError extends Error {
  constructor(action, detail) {
    super(`Unsupported event action type: ${action && action.type || "unknown"}${detail ? ` (${detail})` : ""}`);
    this.name = "UnsupportedEventError";
    this.code = "UNSUPPORTED_EVENT_ACTION";
    this.eventType = action && action.type || null;
  }
}

function isSupportedEventType(type) {
  return SUPPORTED_EVENT_TYPES.has(type);
}

const MAX_COMMON_EVENT_DEPTH = 32;

// Deliberately not a JavaScript interpreter. Match the entire audited script,
// so a familiar prefix plus an unknown effect cannot be accepted as a no-op.
function getFunctionEventEffect(action) {
  if (action.async || typeof action.function !== "string") {
    throw new UnsupportedEventError(action, "only audited synchronous script bodies are supported");
  }
  if (/^\s*function\s*\(\s*\)\s*\{\s*\}\s*$/.test(action.function)) return "presentation";
  if (/^\s*function\s*\(\s*\)\s*\{\s*core\.setFlag\(\s*(['"])__visited__\1\s*,\s*\{\s*\}\s*\)\s*;?\s*\}\s*$/.test(action.function)) {
    return "clear-visited";
  }
  throw new UnsupportedEventError(action, "unrecognized script body");
}

function getCommonEventActions(project, action, depth) {
  if (Number(depth || 0) >= MAX_COMMON_EVENT_DEPTH) {
    throw new UnsupportedEventError(action, "common-event recursion limit");
  }
  if (typeof action.name !== "string" || !action.name || action.loc != null || action.floorId != null || action.which != null) {
    throw new UnsupportedEventError(action, "only named common-event calls are supported");
  }
  const events = project.commonEvents || {};
  if (!Object.prototype.hasOwnProperty.call(events, action.name) || !Array.isArray(events[action.name])) {
    throw new UnsupportedEventError(action, `missing or malformed common event ${action.name}`);
  }
  if (action.args != null && (!Array.isArray(action.args) || action.args.some((value) =>
    value != null && !["string", "boolean", "number"].includes(typeof value)))) {
    throw new UnsupportedEventError(action, "only scalar common-event arguments are supported");
  }
  return events[action.name];
}

function applyCommonEventArguments(state, action) {
  state.flags.arg0 = action.name;
  // Runtime passes literal values, skips null arguments and does not restore
  // previous arg flags when a nested common event returns.
  (action.args || []).forEach((value, index) => {
    if (value != null) state.flags[`arg${index + 1}`] = value;
  });
}

function removeFollower(project, state, action) {
  if (action.name != null && typeof action.name !== "string") throw new UnsupportedEventError(action, "invalid follower name");
  const followers = state.hero.followers || [];
  if (!Array.isArray(followers) || followers.some((follower) => !follower || typeof follower !== "object")) {
    throw new UnsupportedEventError(action, "malformed followers");
  }
  if (!action.name) state.hero.followers = [];
  else {
    const mapped = (state.flags.__nameMap__ || {})[action.name] || (((project.data || {}).main || {}).nameMap || {})[action.name] || action.name;
    const index = followers.findIndex((follower) => follower.name === mapped);
    if (index >= 0) followers.splice(index, 1);
    state.hero.followers = followers;
  }
  // The engine gathers surviving followers immediately after unfollow.
  state.hero.followers.forEach((follower) => Object.assign(follower, {
    x: state.hero.loc.x, y: state.hero.loc.y, direction: state.hero.loc.direction, stop: true,
  }));
}

function executeAction(project, state, action, extra, options) {
  if (action == null || typeof action === "string") return;
  if (typeof action !== "object" || !isSupportedEventType(action.type)) {
    throw new UnsupportedEventError(action);
  }

  if (NOOP_EVENT_TYPES.has(action.type)) return;

  switch (action.type) {
    case "function":
      if (getFunctionEventEffect(action) === "clear-visited") state.visitedFloors = {};
      return;
    case "insert": {
      const depth = Number(options.commonEventDepth || 0);
      const actions = getCommonEventActions(project, action, depth);
      applyCommonEventArguments(state, action);
      executeActionList(project, state, actions, extra, { ...options, commonEventDepth: depth + 1 });
      return;
    }
    case "unloadEquip":
      if (!Number.isInteger(action.pos) || action.pos < 0) throw new UnsupportedEventError(action, "invalid equipment slot");
      unloadEquipment(project, state, action.pos);
      return;
    case "unfollow":
      removeFollower(project, state, action);
      return;
    case "setValue":
      setValueTarget(project, state, action.name, action.operator, action.value, extra);
      return;
    case "openDoor": {
      const eventLoc = action.loc ? normalizeLocationList(project, state, action.loc, extra) : [extra.eventLoc];
      eventLoc.filter(Boolean).forEach((point) => removeTileAt(state, state.floorId, point.x, point.y));
      return;
    }
    case "if": {
      const branch = evaluateCondition(action.condition, project, state, extra) ? action.true : action.false;
      executeActionList(project, state, branch, extra, options);
      return;
    }
    case "choices": {
      const resolver = (options && options.choiceResolver) || defaultChoiceResolver;
      const choice = resolver(action, { project, state, extra });
      if (choice && Array.isArray(choice.action)) {
        executeActionList(project, state, choice.action, extra, options);
      }
      return;
    }
    case "hide": {
      const points = normalizeLocationList(project, state, action.loc, extra);
      points.forEach((point) => removeTileAt(state, state.floorId, point.x, point.y));
      return;
    }
    case "setBlock": {
      const points = normalizeLocationList(project, state, action.loc, extra);
      const number = Number.isFinite(action.number)
        ? Number(action.number)
        : project.mapNumbersById[action.number];
      if (number == null) {
        throw new UnsupportedEventError(action, `unknown block ${action.number}`);
      }
      points.forEach((point) => replaceTileAt(state, state.floorId, point.x, point.y, number));
      return;
    }
    case "changeFloor": {
      const target = resolveChangeFloorTarget(project, state, action);
      recordLeaveLocation(state, target.floorId, { isFlying: false });
      state.floorId = target.floorId;
      state.hero.loc.x = target.x;
      state.hero.loc.y = target.y;
      state.hero.loc.direction = target.direction;
      applyFloorArrival(project, state, state.floorId, options);
      return;
    }
    case "win":
      if (!state.meta) state.meta = {};
      state.meta.winReason = action.reason || true;
      state.notes.push(`Win event recorded but not used as solver terminal: ${action.reason || ""}`);
      return;
    default:
      throw new UnsupportedEventError(action);
  }
}

function executeActionList(project, state, actions, extra, options) {
  if (!actions || actions.length === 0) return;
  const depth = Number((options || {}).eventExecutionDepth || 0);
  const executionOptions = { ...options, eventExecutionDepth: depth + 1 };
  actions.forEach((action) => {
    if (typeof action === "string") return;
    executeAction(project, state, action, extra || {}, executionOptions);
  });
  // Runtime closePanel clears temporary parameters only when the whole event
  // queue ends, not on return from an if/choice/common-event/arrival sublist.
  if (depth === 0) {
    Object.keys(state.flags || {}).forEach((key) => {
      if (key.startsWith("@temp@") || /^arg\d+$/.test(key)) delete state.flags[key];
    });
  }
}

function runLevelUps(project, state, options) {
  const entries = (((project || {}).data || {}).firstData || {}).levelUp || [];
  while (Number(state.hero.lv || 0) < entries.length) {
    const next = entries[Number(state.hero.lv || 0)] || null;
    if (!next) return;
    const need = evaluateExpression(next.need, project, state, { floorId: state.floorId });
    if (need == null) return;
    if (Number(state.hero.exp || 0) < Number(need)) return;
    state.hero.lv = Number(state.hero.lv || 0) + 1;
    if (next.clear) {
      state.hero.exp = Number(state.hero.exp || 0) - Number(need);
    }
    executeActionList(project, state, next.action || [], { floorId: state.floorId }, options);
  }
}

function applyFloorArrival(project, state, floorId, options) {
  const floor = project.floorsById[floorId];
  if (!floor) throw new Error(`Unknown floor: ${floorId}`);

  const actions = [];
  if (!hasVisitedFloor(state, floorId)) {
    // The runtime queues firstArrive, marks visited, then executes the queue.
    // A firstArrive script may deliberately clear that mark again.
    visitFloor(state, floorId);
    actions.push(...(floor.firstArrive || []));
  }

  actions.push(...(floor.eachArrive || []));
  executeActionList(project, state, actions, { floorId }, options);
  runAutoEvents(project, state, options);
}

function runAutoEvents(project, state, options) {
  const floor = project.floorsById[state.floorId];
  const autoEvent = floor.autoEvent || {};
  let guard = 0;

  while (true) {
    guard += 1;
    if (guard > 64) {
      throw new UnsupportedEventError({ type: "autoEvent" }, `loop limit on floor ${state.floorId}`);
    }

    const eligible = [];
    Object.keys(autoEvent)
      .sort()
      .forEach((locKey) => {
        const [x, y] = locKey.split(",").map(Number);
        const entry = autoEvent[locKey] || {};
        Object.keys(entry)
          .sort((left, right) => Number(left) - Number(right))
          .forEach((index) => {
            const event = entry[index];
            if (!event) return;
            const uniqueKey = `${state.floorId}:${locKey}:${index}`;
            if (!event.multiExecute && state.triggeredAutoEvents[uniqueKey]) return;
            if (!evaluateCondition(event.condition, project, state, { floorId: state.floorId })) return;
            eligible.push({ event, uniqueKey, x, y });
          });
      });
    if (eligible.length === 0) break;

    eligible.forEach((entry) => {
      executeActionList(project, state, entry.event.data || [], { floorId: state.floorId, eventLoc: { x: entry.x, y: entry.y } }, options);
      if (!entry.event.multiExecute) state.triggeredAutoEvents[entry.uniqueKey] = true;
    });
  }
}

module.exports = {
  NOOP_EVENT_TYPES,
  SUPPORTED_EVENT_TYPES,
  STATE_CHANGING_EVENT_TYPES,
  UnsupportedEventError,
  MAX_COMMON_EVENT_DEPTH,
  getFunctionEventEffect,
  getCommonEventActions,
  applyCommonEventArguments,
  isSupportedEventType,
  applyFloorArrival,
  executeActionList,
  runAutoEvents,
  runLevelUps,
};
