"use strict";

/**
 * TEST GRADE: deterministic-contract
 *
 * This check inventories human-authored planning information and proves that
 * the blind spec contains only tower-independent terminal-goal information.
 * It does not claim that the blind search reaches the goal.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  auditDiscoveryCapability,
  buildBlindDiscoverySpec,
} = require("./lib/discovery-capability-audit");

const RAW_SPEC = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "milestones", "onlyup-chaos-mt5-blueking.json"),
    "utf8",
  ),
);

function main() {
  const targetMilestoneId = "mt5-blueking-kill";
  const endToEnd = auditDiscoveryCapability(RAW_SPEC, { targetMilestoneId });
  const assistedClosure = auditDiscoveryCapability(RAW_SPEC, {
    fromMilestoneId: "mt4-hp4459",
    targetMilestoneId,
    routeFixture: "routes/fixtures/mt1-mt4-hp6428-best.route.json",
  });
  const blind = buildBlindDiscoverySpec(RAW_SPEC, { targetMilestoneId });

  assert.strictEqual(endToEnd.schema, "motapathfinder.discovery-capability-audit.v1");
  assert.strictEqual(endToEnd.authoredHintInventory.milestonePlan.totalMilestones, 28);
  assert.strictEqual(endToEnd.authoredHintInventory.milestonePlan.intermediateMilestones, 27);
  assert.ok(endToEnd.authoredHintInventory.resourceThresholds.minHeroFields > 0);
  assert.ok(endToEnd.authoredHintInventory.floorRestrictions.allowedFloorEntries > 0);
  assert.ok(endToEnd.authoredHintInventory.eventOrdering.implicitArrayOrderEdges > 0);
  assert.strictEqual(endToEnd.authoredHintInventory.routeFixture.count, 0);
  assert.strictEqual(assistedClosure.authoredHintInventory.routeFixture.count, 1);
  assert.strictEqual(assistedClosure.authoredHintInventory.milestonePlan.totalMilestones, 18);
  assert.strictEqual(endToEnd.architecturalCeiling.capability, "unordered-event-planning");
  assert.strictEqual(endToEnd.architecturalCeiling.presentAt, "A0-assisted-plan");
  assert.strictEqual(endToEnd.verdict, "ASSISTED_EXECUTION_NOT_AUTONOMOUS_DISCOVERY");

  assert.strictEqual(blind.milestones.length, 1);
  assert.deepStrictEqual(blind.milestones[0].goal, {
    type: "bossDefeated",
    floorId: "MT5",
    x: 6,
    y: 7,
    enemyId: "blueKing",
  });
  assert.deepStrictEqual(blind.milestones[0].actionPolicy, {});
  assert.deepStrictEqual(blind.milestones[0].dp, {});
  const serializedBlind = JSON.stringify(blind);
  for (const forbidden of [
    "startFrom",
    "minHero",
    "allowedFloors",
    "allowChangeFloors",
    "presentTiles",
    "route-fixture",
  ]) {
    if (forbidden === "route-fixture") {
      assert.ok(blind.discoveryContract.forbiddenInputs.includes(forbidden));
    } else {
      assert.strictEqual(serializedBlind.includes(`\"${forbidden}\"`), false);
    }
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    verdict: endToEnd.verdict,
    targetMilestoneId,
    endToEnd: endToEnd.authoredHintInventory,
    assistedClosure: assistedClosure.authoredHintInventory,
    architecturalCeiling: endToEnd.architecturalCeiling,
    blindGoal: blind.milestones[0].goal,
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { main };
