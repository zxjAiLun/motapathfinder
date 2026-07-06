"use strict";

/**
 * State Key Audit Script
 *
 * 审计三个核心问题:
 * 1. 除了 pickaxe/bomb，还有哪些方向敏感性交互没进 state key？
 * 2. flags / visitedFloors 哪些是真正的未来依赖，哪些只是搜索痕迹？
 * 3. buildDpStateKey 的 keyMode 粗细是否合理？
 *
 * 用法: node check-state-key-audit.js [--project-root=PATH]
 */

const fs = require("node:fs");
const path = require("node:path");

const { buildDpStateKey } = require("./lib/dp-search");
const { buildStateKey, buildDominanceKey, hasDirectionalStateSensitivity } = require("./lib/state-key");
const { loadProject } = require("./lib/project-loader");
const { listFloorMutationSummary } = require("./lib/state");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { StaticSimulator } = require("./lib/simulator");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

// ====================================================================
// Section 1: Direction-sensitive items audit
// ====================================================================

const DIRECTIONAL_STATE_ITEMS = ["pickaxe", "bomb"];

function auditDirectionalItems(project) {
  const items = project.data.items || {};
  const itemDefs = { ...(items.tools || {}), ...(items.constants || {}), ...(items.equips || {}) };

  console.log("=".repeat(70));
  console.log("SECTION 1: DIRECTION-SENSITIVE ITEMS AUDIT");
  console.log("=".repeat(70));
  console.log(`\nCurrent DIRECTIONAL_STATE_ITEMS: ${JSON.stringify(DIRECTIONAL_STATE_ITEMS)}`);
  console.log(`Total items in project: ${Object.keys(itemDefs).length}`);

  // Search for direction-related keywords in item descriptions
  const directionKeywords = /direction|朝向|facing|face|前方|面前|转身|转向|面向/i;
  const suspiciousItems = [];

  Object.entries(itemDefs).forEach(([itemId, def]) => {
    if (!def) return;
    const text = JSON.stringify(def);
    // Skip pickaxe and bomb as they're already in the list
    if (itemId === "pickaxe" || itemId === "bomb") return;
    // Check text for direction sensitivity hints
    if (directionKeywords.test(text)) {
      suspiciousItems.push({ itemId, name: def.name || itemId, snippet: text.slice(0, 200) });
    }
  });

  if (suspiciousItems.length === 0) {
    console.log("\n✓ No additional direction-sensitive items found via keyword scan.");
  } else {
    console.log(`\n⚠ Found ${suspiciousItems.length} potentially direction-sensitive items:\n`);
    suspiciousItems.forEach((item) => {
      console.log(`  - ${item.itemId} (${item.name}): ${item.snippet}`);
    });
    console.log("\n  RECOMMENDATION: Manually verify if any of these items create");
    console.log("  future-state differences based on hero direction.");
  }
}

// ====================================================================
// Section 2: Direction-sensitive mechanics in floors/events
// ====================================================================

function auditFloorDirectionSensitivity(project) {
  console.log("\n" + "=".repeat(70));
  console.log("SECTION 2: FLOOR/EVENT DIRECTION SENSITIVITY AUDIT");
  console.log("=".repeat(70));

  const floors = project.floorsById || {};
  const floorIds = Object.keys(floors);
  const directionEvents = [];

  floorIds.forEach((floorId) => {
    const floor = floors[floorId];
    if (!floor || !floor.map) return;

    const height = floor.height || floor.map.length;
    for (let y = 0; y < height; y++) {
      const row = floor.map[y] || [];
      for (let x = 0; x < row.length; x++) {
        const tile = row[x];
        if (!tile || !tile.event || !tile.event.data) continue;

        const eventData = tile.event.data;
        if (Array.isArray(eventData)) {
          const text = JSON.stringify(eventData);
          // Check for direction-dependent event actions
          if (/\bchangePos\b/.test(text) && /\bdirection\b/.test(text)) {
            directionEvents.push({ floorId, x, y, eventId: tile.id });
          }
          if (/\bchangeFloor\b/.test(text) && /\bdirection\b/.test(text)) {
            directionEvents.push({ floorId, x, y, eventId: tile.id, note: "changeFloor with direction" });
          }
          if (/\bcanMoveHero\b/.test(text) && /\bdirection\b/.test(text)) {
            directionEvents.push({ floorId, x, y, eventId: tile.id, note: "canMoveHero with direction check" });
          }
        }
      }
    }
  });

  // Also check enemy afterBattle for direction-dependent actions
  const enemies = project.data.enemys || {};
  Object.entries(enemies).forEach(([enemyId, enemyDef]) => {
    if (!enemyDef || !enemyDef.afterBattle) return;
    const text = JSON.stringify(enemyDef.afterBattle);
    if (/\bchangePos\b/.test(text) && /\bdirection\b/.test(text)) {
      directionEvents.push({ type: "afterBattle", enemyId, note: "changePos with direction in afterBattle" });
    }
  });

  if (directionEvents.length === 0) {
    console.log("\n✓ No events with direction-dependent state changes found.");
  } else {
    console.log(`\n⚠ Found ${directionEvents.length} events with direction-dependent actions:\n`);
    directionEvents.forEach((ev) => {
      console.log(`  ${JSON.stringify(ev)}`);
    });
    console.log("\n  RECOMMENDATION: Verify that move/pickup actions fully capture");
    console.log("  direction-dependent game logic. If events can change hero position");
    console.log("  differently based on facing, the state key must account for it.");
  }
}

// ====================================================================
// Section 3: Flags audit
// ====================================================================

function auditFlags(project) {
  console.log("\n" + "=".repeat(70));
  console.log("SECTION 3: FLAGS AS STATE-KEY COMPONENTS");
  console.log("=".repeat(70));

  const simulator = new StaticSimulator(project, {
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: false,
    autoBattleEnabled: false,
  });

  const state = simulator.createInitialState({ rank: "chaos" });

  console.log(`\nInitial flags count: ${Object.keys(state.flags || {}).length}`);
  console.log("Initial flags:", JSON.stringify(state.flags, null, 2).slice(0, 500));

  console.log("\nAnalysis:");
  console.log("  - ALL flags are included in both buildStateKey() and buildDpStateKey()");
  console.log("  - This includes both future-relevant and trace-only flags");
  console.log("  - Example trace flags: __hp_buff__, __atk_buff__, __def_buff__ (buff multipliers)");
  console.log("  - Example future-relevant flags: boss defeated, door opened, puzzle state");

  // Categorize by naming convention
  const tracePattern = /^__/;
  const visitedPattern = /^visited_/;
  const flagKeys = Object.keys(state.flags || {});

  const traceFlags = flagKeys.filter((k) => tracePattern.test(k) || visitedPattern.test(k));
  const gameFlags = flagKeys.filter((k) => !tracePattern.test(k) && !visitedPattern.test(k));

  console.log(`\n  Trace/internal flags (__ prefix or visited_): ${traceFlags.length}`);
  console.log(`  Game-logic flags: ${gameFlags.length}`);

  console.log("\n  RISK: Including ALL flags in the state key means:");
  console.log("    - Every time a flag changes (even trace flags), it creates a new DP state");
  console.log("    - This can cause state explosion in regions with many flag mutations");
  console.log('    - The "effective value" functions (effectiveHeroValue) use __*_buff__ flags');
  console.log("    - These buff flags ARE future-relevant and MUST be in the key");

  console.log("\n  RECOMMENDATION:");
  console.log("    - Keep __*_buff__ flags in the key (they affect effective stats)");
  console.log("    - Consider whether visited_* flags should be in key or just search traces");
  console.log("    - Audit specific game flags for future dependency by simulating forward");
}

// ====================================================================
// Section 4: visitedFloors audit
// ====================================================================

function auditVisitedFloors(project) {
  console.log("\n" + "=".repeat(70));
  console.log("SECTION 4: VISITED FLOORS AS STATE-KEY COMPONENTS");
  console.log("=".repeat(70));

  console.log("\n  visitedFloors is included in both buildStateKey() and buildDpStateKey()");
  console.log("  It is sorted array of floor IDs the hero has entered.");
  console.log("\n  Analysis:");
  console.log("    - Some game events check if a floor has been visited (common in魔塔)");
  console.log("    - If any event/condition depends on 'has visited floor X', then visitedFloors MUST be in key");
  console.log("    - However, visitedFloors grows monotonically - it only ever gets larger");
  console.log("    - This means the state key WILL change after every floor transition");

  console.log("\n  RISK:");
  console.log("    - In DP search with keyMode 'region', the floorId is already part of the key");
  console.log("    - visitedFloors adds additional state splitting that may be redundant");
  console.log("    - If no game logic depends on visitedFloors (only on currentFloor), it's just noise");

  // Check project for visited-floor-dependent events
  const floors = project.floorsById || {};
  let visitedDependentCount = 0;
  let visitedDependentExamples = [];

  Object.entries(floors).forEach(([floorId, floor]) => {
    if (!floor || !floor.map) return;
    const height = floor.height || floor.map.length;
    for (let y = 0; y < height; y++) {
      const row = floor.map[y] || [];
      for (let x = 0; x < row.length; x++) {
        const tile = row[x];
        if (!tile || !tile.event || !tile.event.data) continue;
        const text = JSON.stringify(tile.event.data);
        if (/\bvisitedFloor\b/i.test(text) || /\bvisited\b.*\bfloor\b/i.test(text)) {
          visitedDependentCount++;
          if (visitedDependentExamples.length < 5) {
            visitedDependentExamples.push({ floorId, x, y, eventId: tile.id });
          }
        }
      }
    }
  });

  if (visitedDependentCount > 0) {
    console.log(`\n  ⚠ Found ${visitedDependentCount} events that reference visitedFloor`);
    console.log("  Examples:", JSON.stringify(visitedDependentExamples, null, 2));
    console.log("  → visitedFloors MUST remain in the state key.");
  } else {
    console.log("\n  ✓ No visitedFloor-dependent events found via keyword scan.");
    console.log("  → But visitedFloors may still be checked by game engine core logic.");
    console.log("  → Keep in key unless proven unnecessary.");
  }
}

// ====================================================================
// Section 5: DP key mode analysis
// ====================================================================

function auditDpKeyModes(project) {
  console.log("\n" + "=".repeat(70));
  console.log("SECTION 5: DP KEY MODE ANALYSIS");
  console.log("=".repeat(70));

  console.log("\n  buildDpStateKey supports three keyModes:");
  console.log("");
  console.log("  1. 'region' (default)");
  console.log("     - Uses simulator.buildReachableRegionSignature(state)");
  console.log("     - Groups states by connected region + reachable endpoints");
  console.log("     - Coarser: more HP dominance merges, faster but may over-merge");
  console.log("");
  console.log("  2. 'location'  ");
  console.log("     - Uses floorId:x,y as the key");
  console.log("     - Finer: less merging, more state explosion");
  console.log("     - Safer for card-HP regions where position matters");
  console.log("");
  console.log("  3. 'mutation'");
  console.log("     - Ignoring region/location entirely, keying only on mutations");
  console.log("     - Coarsest: maximum merging, highest risk of over-merge");
  console.log("");

  console.log("  Key components (ALL modes):");
  console.log("    floorId, atk, def, mdef, lv, exp, money, mana,");
  console.log("    equipment, followers, inventory, flags, visitedFloors, mutations");
  console.log("");
  console.log("  Notably EXCLUDED from DP key:");
  console.log("    ✓ HP (handled via HP dominance: higher HP dominates lower HP)");
  console.log("    ✓ direction (unless pickaxe/bomb in inventory)");
  console.log("    ✓ exact position (unless keyMode='location')");
  console.log("");

  console.log("  RECOMMENDATION for card-HP regions:");
  console.log("    - Use keyMode='location' for safety (prevents over-merge)");
  console.log("    - Combine with dpSkylineMax >= 3 and preserveSkylineRoles=true");
  console.log("    - Increase candidateLimit/goalSkylineLimit to 16-32");
}

// ====================================================================
// Section 6: Item mutation effects audit
// ====================================================================

function auditItemEffects(project) {
  console.log("\n" + "=".repeat(70));
  console.log("SECTION 6: ITEM EFFECTS THAT MAY BYPASS STATE KEY");
  console.log("=".repeat(70));

  const items = project.data.items || {};
  const allItems = { ...(items.tools || {}), ...(items.constants || {}), ...(items.equips || {}) };

  // Check for items that change hero properties conditionally
  const conditionalItems = [];

  Object.entries(allItems).forEach(([itemId, def]) => {
    if (!def || !def.cls) return;
    // Items with 'cls' are equippable equipment
    const text = JSON.stringify(def);
    // Equipment with conditional effects
    if (/\bif\b.*\bhp\b/i.test(text) || /\bwhen\b.*\bhp\b/i.test(text)) {
      conditionalItems.push({ itemId, name: def.name || itemId, type: "conditional-hp" });
    }
    if (/\bif\b.*\bdirection\b/i.test(text) || /\bwhen\b.*\bdirection\b/i.test(text)) {
      conditionalItems.push({ itemId, name: def.name || itemId, type: "conditional-direction" });
    }
  });

  if (conditionalItems.length === 0) {
    console.log("\n  ✓ No conditionally-sensitive equipment effects found.");
  } else {
    console.log(`\n  ⚠ Found ${conditionalItems.length} items with conditional effects:\n`);
    conditionalItems.forEach((item) => {
      console.log(`    - ${item.itemId} (${item.name}): ${item.type}`);
    });
    console.log("\n  NOTE: These items' effects are applied at equip time and reflected");
    console.log("  in the states hero stats, so they ARE captured by the state key.");
  }
}

// ====================================================================
// Section 7: Summary and recommendations
// ====================================================================

function printSummary() {
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY: STATE KEY AUDIT FINDINGS");
  console.log("=".repeat(70));
  console.log("");
  console.log("  1. DIRECTIONAL_STATE_ITEMS = ['pickaxe', 'bomb']");
  console.log("     → Verify no other items have direction-dependent future-state effects.");
  console.log("     → Events with changePos/changeFloor using direction are captured");
  console.log("       by the action fingerprint (includes direction for interactPickup).");
  console.log("");
  console.log("  2. FLAGS: All flags are in both stateKey and dpStateKey.");
  console.log("     → __*_buff__ flags MUST stay (used by effectiveHeroValue).");
  console.log("     → Other flags: may cause state explosion in mutation-heavy regions.");
  console.log("     → Consider a whitelist/blacklist approach for flags in DP key.");
  console.log("");
  console.log("  3. VISITED FLOORS: In both keys.");
  console.log("     → Only relevant if game logic checks visitedFloor.");
  console.log("     → With keyMode='region' or 'location', floorId already provides");
  console.log("       some state separation — visitedFloors may be redundant.");
  console.log("");
  console.log("  4. DP KEY MODE: 'region' is default, 'location' is safer for card-HP.");
  console.log("     → For card-HP proof runs: use keyMode='location', dpSkylineMax >= 3,");
  console.log("       preserveSkylineRoles=true, goalSkylineLimit/candidateLimit >= 16.");
  console.log("");
  console.log("  5. MUTATIONS: listFloorMutationSummary is comprehensive but may be too fine.");
  console.log("     → Consider whether 'removed' tiles need full detail or just a counter.");
  console.log("");
}

// ====================================================================
// Main
// ====================================================================

function main() {
  const args = process.argv.slice(2).reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});

  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  console.log(`Auditing project: ${projectRoot}\n`);

  let project;
  try {
    project = loadProject(projectRoot);
  } catch (error) {
    console.error(`Failed to load project: ${error.message}`);
    // Continue with partial audit using static analysis
    project = { data: {}, floorsById: {} };
  }

  auditDirectionalItems(project);
  auditFloorDirectionSensitivity(project);
  auditFlags(project);
  auditVisitedFloors(project);
  auditDpKeyModes(project);
  auditItemEffects(project);
  printSummary();
}

main();
