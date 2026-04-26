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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasTarget(decision) {
  return decision && decision.target && decision.target.x != null && decision.target.y != null;
}

function validateDecision(decision) {
  assert(decision.kind !== "resourcePocket", `decision #${decision.index} is unexpanded resourcePocket`);
  assert(decision.kind !== "resourceCluster", `decision #${decision.index} is unexpanded resourceCluster`);
  assert(decision.kind !== "fightToLevelUp", `decision #${decision.index} is unexpanded fightToLevelUp`);
  assert(decision.fingerprint, `decision #${decision.index} missing fingerprint`);
  assert(decision.kind, `decision #${decision.index} missing kind`);
  assert(Array.isArray(decision.path), `decision #${decision.index} missing path array`);
  if (["battle", "pickup", "openDoor", "changeFloor", "event"].includes(decision.kind)) {
    assert(hasTarget(decision), `decision #${decision.index} missing target`);
  }
  if (decision.kind === "battle") assert(decision.enemyId, `decision #${decision.index} battle missing enemyId`);
  if (decision.kind === "pickup") assert(decision.itemId, `decision #${decision.index} pickup missing itemId`);
  if (decision.kind === "useTool") assert(decision.tool, `decision #${decision.index} useTool missing tool`);
  if (decision.kind === "equip") assert(decision.equipId, `decision #${decision.index} equip missing equipId`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["route-file"]) throw new Error("Missing --route-file=...");
  const route = readRouteFile(path.resolve(process.cwd(), args["route-file"]));
  assert(route.schema === "motapathfinder.route.v1", "invalid route schema");
  assert(Array.isArray(route.decisions), "route.decisions must be an array");
  route.decisions.forEach(validateDecision);
  console.log(`Route record ok: decisions=${route.decisions.length}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
