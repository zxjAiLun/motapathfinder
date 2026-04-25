"use strict";

const path = require("path");
const { readRouteFile } = require("./lib/route-store");

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function formatTarget(decision) {
  const target = decision.target || {};
  const floorId = target.floorId || decision.floorId || "?";
  if (target.x == null || target.y == null) return floorId;
  return `${floorId} ${target.x},${target.y}`;
}

function formatDecision(decision) {
  const details = [];
  if (decision.itemId) details.push(`item=${decision.itemId}`);
  if (decision.enemyId) details.push(`enemy=${decision.enemyId}`);
  if (decision.doorId) details.push(`door=${decision.doorId}`);
  if (decision.tool) details.push(`tool=${decision.tool}`);
  if (decision.equipId) details.push(`equip=${decision.equipId}`);
  if (decision.estimate && decision.estimate.damage != null) details.push(`dmg=${decision.estimate.damage}`);
  if (decision.estimate && decision.estimate.exp != null) details.push(`exp=${decision.estimate.exp}`);
  if (Array.isArray(decision.path)) details.push(`path=${decision.path.join(",") || "-"}`);
  return `#${String(decision.index).padStart(3, "0")} ${String(decision.kind).padEnd(10)} ${formatTarget(decision)}  ${details.join(" ")}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["route-file"]) throw new Error("Missing --route-file=...");
  const route = readRouteFile(path.resolve(process.cwd(), args["route-file"]));
  const startFloor = (((route.start || {}).snapshot || {}).floorId) || "?";
  const finalSnapshot = ((route.final || {}).snapshot) || {};
  const finalHero = finalSnapshot.hero || {};
  console.log(`Route: ${startFloor} -> ${(route.final || {}).floorId || (route.goal || {}).floorId || "?"}`);
  console.log(`Created: ${route.createdAt}`);
  console.log(`Solver: ${((route.source || {}).solver) || "?"} profile=${((route.source || {}).profile) || "-"} rank=${((route.source || {}).rank) || "-"}`);
  console.log(`Expanded: ${(route.stats || {}).expanded} Generated: ${(route.stats || {}).generated} Depth: ${(route.stats || {}).depth}`);
  console.log(`Decisions: ${(route.decisions || []).length}`);
  console.log(`Final: floor=${(route.final || {}).floorId} hp=${finalHero.hp} atk=${finalHero.atk} def=${finalHero.def} mdef=${finalHero.mdef}`);
  console.log("");
  (route.decisions || []).forEach((decision) => console.log(formatDecision(decision)));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
