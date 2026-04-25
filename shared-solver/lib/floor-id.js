"use strict";

function parseFloorId(floorId) {
  const value = String(floorId || "");
  const mtMatch = /^MT(\d+)$/.exec(value);
  if (mtMatch) {
    return {
      family: "MT",
      level: Number(mtMatch[1]),
      order: Number(mtMatch[1]),
    };
  }

  const towerMatch = /^([A-Z]+)(\d+)$/.exec(value);
  if (!towerMatch) return null;
  const family = towerMatch[1];
  const familyOrder = family.split("").reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0);
  const level = Number(towerMatch[2]);
  return {
    family,
    level,
    order: familyOrder * 1000 + level,
  };
}

function getFloorOrder(floorId) {
  const parsed = parseFloorId(floorId);
  return parsed ? parsed.order : -1;
}

function findContiguousTowerTerminalFloor(project, startFloorId) {
  const parsedStart = parseFloorId(startFloorId);
  if (!parsedStart || parsedStart.family === "MT") return null;
  const floorOrder = ((project || {}).floorOrder || []).slice();
  const startIndex = floorOrder.indexOf(startFloorId);
  if (startIndex < 0) return null;

  let terminal = startFloorId;
  let previousLevel = parsedStart.level;
  for (let index = startIndex + 1; index < floorOrder.length; index += 1) {
    const floorId = floorOrder[index];
    const parsed = parseFloorId(floorId);
    if (!parsed || parsed.family !== parsedStart.family) break;
    if (parsed.level !== previousLevel + 1) break;
    terminal = floorId;
    previousLevel = parsed.level;
  }
  return terminal;
}

module.exports = {
  findContiguousTowerTerminalFloor,
  getFloorOrder,
  parseFloorId,
};
