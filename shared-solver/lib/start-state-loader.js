"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { createStateFromSnapshot } = require("./route-store");
const { cloneState, getDecisionDepth } = require("./state");

function resolveExistingPath(filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(__dirname, "..", filePath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isRawState(value) {
  return Boolean(
    value &&
      value.floorId &&
      value.hero &&
      value.floorStates &&
      value.inventory &&
      value.flags,
  );
}

function loadStartState(project, filePath, options) {
  const config = options || {};
  const resolved = resolveExistingPath(filePath);
  const data = readJson(resolved);
  let state = null;
  let sourceSchema = data && data.schema ? data.schema : null;

  if (data && data.schema === "motapathfinder.exportedState.v1") {
    if (isRawState(data.state)) {
      state = cloneState(data.state);
    } else if (data.snapshot) {
      state = createStateFromSnapshot(project, data.snapshot, {
        rank: config.rank || null,
        decisionDepth: Number(data.step || 0),
      });
    }
  } else if (isRawState(data)) {
    state = cloneState(data);
    sourceSchema = "raw-state";
  } else if (data && data.snapshot) {
    state = createStateFromSnapshot(project, data.snapshot, {
      rank: config.rank || null,
      decisionDepth: Number(data.step || 0),
    });
    sourceSchema = data.schema || "snapshot-wrapper";
  }

  if (!state) {
    throw new Error(`Invalid --start-state JSON: ${resolved}`);
  }
  return {
    file: resolved,
    schema: sourceSchema,
    state,
  };
}

function summarizeStartState(state) {
  const hero = (state || {}).hero || {};
  return [
    `floor=${(state || {}).floorId || "?"}`,
    `hp=${hero.hp}`,
    `atk=${hero.atk}`,
    `def=${hero.def}`,
    `mdef=${hero.mdef}`,
    `decisions=${getDecisionDepth(state)}`,
    `routeLen=${Array.isArray((state || {}).route) ? state.route.length : 0}`,
  ].join(" ");
}

module.exports = {
  loadStartState,
  summarizeStartState,
};
