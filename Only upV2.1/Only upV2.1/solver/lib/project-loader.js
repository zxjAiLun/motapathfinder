"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function runScript(filePath, context) {
  const code = fs.readFileSync(filePath, "utf8");
  vm.runInNewContext(code, context, { filename: filePath });
  return context;
}

function loadGeneratedObject(filePath, prefix) {
  const context = {};
  runScript(filePath, context);
  const key = Object.keys(context).find((name) => name.startsWith(prefix));
  if (!key) {
    throw new Error(`Unable to find generated object with prefix "${prefix}" in ${filePath}`);
  }
  return context[key];
}

function loadFloors(floorsDir) {
  const context = { main: { floors: {} } };
  const files = fs
    .readdirSync(floorsDir)
    .filter((name) => name.endsWith(".js"))
    .sort((left, right) => left.localeCompare(right));

  files.forEach((name) => {
    runScript(path.join(floorsDir, name), context);
  });

  return context.main.floors;
}

function buildIdToNumberIndex(mapTilesByNumber) {
  const index = {};
  Object.entries(mapTilesByNumber).forEach(([number, tile]) => {
    if (tile == null || tile.id == null) return;
    if (index[tile.id] == null) {
      index[tile.id] = Number(number);
    }
  });
  return index;
}

function loadProject(projectRoot) {
  const projectDir = path.join(projectRoot, "project");
  const data = loadGeneratedObject(path.join(projectDir, "data.js"), "data_");
  const itemsById = loadGeneratedObject(path.join(projectDir, "items.js"), "items_");
  const enemysById = loadGeneratedObject(path.join(projectDir, "enemys.js"), "enemys_");
  const mapTilesByNumber = loadGeneratedObject(path.join(projectDir, "maps.js"), "maps_");
  const floorsById = loadFloors(path.join(projectDir, "floors"));

  return {
    root: projectRoot,
    projectDir,
    data,
    values: data.values || {},
    defaultFlags: data.flags || {},
    floorOrder: ((data.main || {}).floorIds || []).slice(),
    floorsById,
    itemsById,
    enemysById,
    mapTilesByNumber,
    mapNumbersById: buildIdToNumberIndex(mapTilesByNumber),
  };
}

module.exports = {
  loadProject,
};
