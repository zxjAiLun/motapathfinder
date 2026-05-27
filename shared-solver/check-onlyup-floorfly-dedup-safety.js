"use strict";

/**
 * OnlyUp floorFly dedup safety audit.
 *
 * Scans real floorFly actions from the OnlyUp project, groups by targetFloorId,
 * applies each to the same state, and compares postState keys.
 *
 * If all floorFly actions going to the same target floor produce
 * identical postState (buildStateKey + buildDpStateKey + hero.loc +
 * floorStates + flags + inventory), then portalDedupMode=target-floor
 * is safe for this tower.
 */

const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");
const { buildStateKey, buildDominanceKey } = require("./lib/state-key");
const { buildDpStateKey } = require("./lib/dp-search");
const { cloneState } = require("./lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: null,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function compactStateDiff(left, right) {
  const fields = {};
  ["floorId", "hp", "atk", "def", "mdef", "lv", "exp", "money"].forEach((f) => {
    const lv = left.hero ? left.hero[f] : undefined;
    const rv = right.hero ? right.hero[f] : undefined;
    if (lv !== rv) fields[f] = { left: lv, right: rv };
  });
  const lLoc = (left.hero && left.hero.loc) || {};
  const rLoc = (right.hero && right.hero.loc) || {};
  if (lLoc.x !== rLoc.x || lLoc.y !== rLoc.y) fields.loc = { left: lLoc, right: rLoc };
  return fields;
}

function main() {
  console.log("=== OnlyUp floorFly dedup safety audit ===\n");

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const state = simulator.createInitialState({ rank: "chaos" });

  // Give the hero a fly item so floorFly actions are generated
  state.inventory = state.inventory || {};
  state.inventory.fly = 99;
  // Mark some floors as visited so fly works
  const allFloorIds = Object.keys(project.floorsById || {});
  state.visitedFloors = state.visitedFloors || {};
  allFloorIds.forEach((fid) => { state.visitedFloors[fid] = true; });

  // Collect floorFly actions across all relevant states
  const byFloor = new Map();
  const floorsToSample = allFloorIds.slice(0, 12); // First 12 floors

  console.log(`Sampling ${floorsToSample.length} floors...\n`);

  for (const floorId of floorsToSample) {
    const floor = project.floorsById[floorId];
    if (!floor) continue;

    // Set hero on this floor
    const testState = cloneState(state);
    testState.floorId = floorId;
    const width = floor.width || 0;
    const height = floor.height || (Array.isArray(floor.map) ? floor.map.length : 0);
    testState.hero = testState.hero || {};
    testState.hero.loc = { x: Math.min(6, width - 1), y: Math.min(6, height - 1), direction: "down" };

    try {
      const flyActions = simulator.enumerateFloorFlyActions(testState) || [];
      for (const action of flyActions) {
        const tf = action.targetFloorId || (action.target && action.target.floorId) || "?";
        const bucket = byFloor.get(tf) || [];
        bucket.push({ action, sourceFloorId: floorId, summary: action.summary });
        if (!byFloor.has(tf)) byFloor.set(tf, bucket);
      }
    } catch (e) { /* skip */ }
  }

  console.log(`FloorFly targets found: ${byFloor.size}`);
  byFloor.forEach((actions, tf) => {
    console.log(`  ${tf}: ${actions.length} actions`);
  });
  console.log();

  // For each group with >1 action, compare postState keys
  let safeGroups = 0;
  let unsafeGroups = 0;
  const unsafeDetails = [];

  for (const [targetFloor, actions] of byFloor) {
    if (actions.length <= 1) continue;

    console.log(`--- Checking ${targetFloor} (${actions.length} actions) ---`);

    const baseState = cloneState(state);
    // Place hero at a neutral starting position
    baseState.floorId = actions[0].sourceFloorId;
    baseState.hero.loc = { x: 6, y: 6, direction: "down" };

    const postStates = [];
    for (const entry of actions) {
      try {
        const post = simulator.applyAction(cloneState(baseState), entry.action, { storeRoute: false });
        postStates.push({
          summary: entry.summary,
          state: post,
          stateKey: buildStateKey(post),
          dominanceKey: buildDominanceKey(post),
          dpKey: buildDpStateKey(simulator, post, { keyMode: "location" }),
          hero: post.hero,
          floorId: post.floorId,
        });
      } catch (e) {
        postStates.push({ summary: entry.summary, error: e.message });
      }
    }

    const validStates = postStates.filter((p) => !p.error);
    if (validStates.length <= 1) continue;

    const first = validStates[0];
    let allMatch = true;

    for (let i = 1; i < validStates.length; i++) {
      const cur = validStates[i];
      const keysMatch = cur.stateKey === first.stateKey;
      const dpKeysMatch = cur.dpKey === first.dpKey;
      const floorMatch = cur.floorId === first.floorId;

      if (!keysMatch || !dpKeysMatch || !floorMatch) {
        allMatch = false;
        console.log(`  MISMATCH: ${first.summary} vs ${cur.summary}`);
        if (!keysMatch) console.log(`    stateKey differs`);
        if (!dpKeysMatch) console.log(`    dpKey differs`);
        const diff = compactStateDiff(first.state, cur.state);
        if (Object.keys(diff).length > 0) {
          console.log(`    state diff: ${JSON.stringify(diff)}`);
        }
        unsafeDetails.push({
          targetFloor,
          left: first.summary,
          right: cur.summary,
          diff,
        });
      }
    }

    if (allMatch) {
      safeGroups += 1;
      console.log(`  ✓ All ${validStates.length} floorFly actions to ${targetFloor} produce identical postState keys`);
    } else {
      unsafeGroups += 1;
    }
    console.log();
  }

  console.log("=".repeat(60));
  console.log("RESULT:");
  console.log(`  Safe groups (identical postState keys): ${safeGroups}`);
  console.log(`  Unsafe groups (differing postState keys): ${unsafeGroups}`);

  if (unsafeGroups > 0) {
    console.log("\n  UNSAFE DETAILS:");
    unsafeDetails.forEach((d) => {
      console.log(`    ${d.targetFloor}: ${d.left} vs ${d.right}`);
      console.log(`      diff: ${JSON.stringify(d.diff)}`);
    });
    console.log("\n  → target-floor dedup is NOT universally safe for this tower.");
    console.log("  → Only enable portalDedupMode=target-floor after manual verification.");
    process.exitCode = 1;
  } else {
    console.log("\n  → All floorFly actions to the same target floor produce identical postState keys.");
    console.log("  → portalDedupMode=target-floor is safe for this tower.");
  }
}

main();
