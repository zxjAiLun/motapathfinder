"use strict";

const { evaluateCondition, evaluateExpression } = require("./expression");
const { resolveChangeFloorTarget } = require("./floor-transitions");
const { addItem, removeTileAt, replaceTileAt, hasVisitedFloor, visitFloor } = require("./state");

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
  // Arbitrary scripts are treated as presentation no-ops. A `function` body that
  // mutates game state is a KNOWN, DOCUMENTED limitation (we do not interpret
  // arbitrary JavaScript); it is not silently reclassified as a supported state
  // change. Keeping this consistent with event-resolver's classifier is what
  // lets enumeration and execution agree on the same supported surface.
  "function",
]);

const STATE_CHANGING_EVENT_TYPES = new Set([
  "setValue",
  "openDoor",
  "hide",
  "setBlock",
  "changeFloor",
  "win",
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

function executeAction(project, state, action, extra, options) {
  if (action == null || typeof action === "string") return;
  if (typeof action !== "object" || !isSupportedEventType(action.type)) {
    throw new UnsupportedEventError(action);
  }

  if (NOOP_EVENT_TYPES.has(action.type)) return;

  switch (action.type) {
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
  (actions || []).forEach((action) => {
    if (typeof action === "string") return;
    executeAction(project, state, action, extra || {}, options || {});
  });
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

  if (!hasVisitedFloor(state, floorId)) {
    executeActionList(project, state, floor.firstArrive || [], { floorId }, options);
    visitFloor(state, floorId);
  }

  executeActionList(project, state, floor.eachArrive || [], { floorId }, options);
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
  isSupportedEventType,
  applyFloorArrival,
  executeActionList,
  runAutoEvents,
  runLevelUps,
};
