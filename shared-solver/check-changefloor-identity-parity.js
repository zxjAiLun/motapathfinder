"use strict";
/**
 * PR-5.25q - ChangeFloor Semantic Identity Contract Repair micros.
 *
 * STATIC ONLY (no search). PR-5.25p Diagnostic 1 proved that
 * actionToSemanticIdentity() fell back to action.stance for enumerated
 * changeFloor actions (which carry no `target`), so every changeFloor identity
 * the search produced used the hero position instead of the stair tile and
 * could never match the frontier POI built by poiToSemanticIdentity(). All
 * changeFloor frontier guidance was inert before this repair.
 *
 * Micros:
 *   1. Parity: every enumerated changeFloor action along the promoted PR-5.25o
 *      winner trajectory yields the same identity from the action itself and
 *      from a macro-graph POI built on the action's own stair tile.
 *   2. The MT2 (6,12) -> MT3 transition resolves to changeFloor:MT2:6,12->MT3
 *      (never the stance tile 6,11) and is a frontier member under the MT4
 *      goal; its F3 membership is reported as observed (F3 excludes its own
 *      target transition POI from frontierSet by construction).
 *   3. Non-changeFloor kinds keep the pre-repair byte-for-byte contract:
 *      battle/openDoor identities come from action.target, item and event
 *      identities still come from action.stance. This locks the shared
 *      extraction so a future global "unification" cannot silently drift.
 *   4. No enumerated changeFloor identity uses stance coordinates while the
 *      action carries x/y.
 *
 * The changeFloor action schema is NOT changed here: `stance` remains the hero
 * position and `x/y` remains the stair tile (simulator contract).
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { actionToSemanticIdentity, poiToSemanticIdentity } = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { resolveRecordedAction } = require("./lib/route-store");
const { resolveRelativeFloor } = require("./lib/floor-transitions");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const WINNER_ARTIFACT = path.resolve(__dirname, "..", "docs", "260912", "qualification", "5-25o-cap1024-winner.json");
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525q-changefloor-identity-parity.json");

function identityForAction(project, action, state) {
  const floorId = action.floorId || (state && state.floorId) || "";
  let nextState = null;
  if (action.kind === "changeFloor") {
    const raw = (action.changeFloor && action.changeFloor.floorId) || null;
    let resolved = raw;
    try { resolved = resolveRelativeFloor(project, floorId, raw); } catch (_) { resolved = raw; }
    nextState = { floorId: resolved };
  }
  return actionToSemanticIdentity(action, state, nextState, project);
}

/** Expected identity under the frozen non-changeFloor contract (pre-repair behavior). */
function expectedNonChangeFloorIdentity(action, state) {
  const floorId = action.floorId || (state && state.floorId) || "";
  const source = action.target || action.stance || {};
  const x = source.x;
  const y = source.y;
  if (action.kind === "battle") return `battle:${floorId}:${x},${y}:${action.enemyId || ""}`;
  if (action.kind === "openDoor") return `door:${floorId}:${x},${y}:${action.doorId || ""}`;
  if (action.kind === "pickup" || action.kind === "interactPickup") return `item:${floorId}:${x},${y}:${action.itemId || ""}`;
  if (action.kind === "event") return `event:${floorId}:${x},${y}`;
  return `${action.kind}:${floorId}:${x},${y}`;
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const failures = [];
  const check = (ok, label, detail) => {
    if (!ok) failures.push({ label, detail });
    return ok;
  };

  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
  const initialState = simulator.createInitialState({ rank: "chaos" });

  const f3 = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: "MT3" });
  const f4 = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: "MT4" });

  const artifact = JSON.parse(fs.readFileSync(WINNER_ARTIFACT, "utf8"));
  const trace = artifact.winner.routeTrace;

  let state = initialState;
  let changeFloorTotal = 0;
  let changeFloorParityOk = 0;
  let changeFloorStanceLeak = 0;
  let mt2ToMt3Identity = null;
  let mt2ToMt3InF3 = null;
  const nonChangeFloorChecked = {};
  const frontierChangeFloorMatchable = { f3: 0, f4: 0 };
  const matchableIdentity = { f3: new Set(), f4: new Set() };

  for (let i = 0; i < trace.length; i += 1) {
    const entry = trace[i];
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, state, {
      ...entry.action,
      postExactStateKey: entry.postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) throw new Error(`winner replay failed at step ${i}`);

    for (const action of actions) {
      const identity = identityForAction(project, action, state);
      if (action.kind === "changeFloor") {
        changeFloorTotal += 1;
        // Micro 1: poi/action parity on the action's own stair tile.
        const poiIdentity = poiToSemanticIdentity({
          floorId: action.floorId || state.floorId,
          x: action.x,
          y: action.y,
          kind: "changeFloor",
          transition: action.changeFloor,
        }, project);
        if (check(poiIdentity === identity, "changefloor-poi-action-parity", `step ${i} ${action.summary}: poi=${poiIdentity} action=${identity}`)) {
          changeFloorParityOk += 1;
        }
        // Micro 4: stance coordinates must not leak into changeFloor identities.
        if (action.x != null && action.y != null && action.stance
          && (action.stance.x !== action.x || action.stance.y !== action.y)
          && identity.includes(`:${action.stance.x},${action.stance.y}->`)) {
          changeFloorStanceLeak += 1;
          check(false, "changefloor-stance-leak", `step ${i} ${identity}`);
        }
        matchableIdentity.f3.add(identity);
        matchableIdentity.f4.add(identity);
        if (state.floorId === "MT2" && action.x === 6 && action.y === 12
          && identity === "changeFloor:MT2:6,12->MT3") {
          mt2ToMt3Identity = identity;
        }
      } else {
        // Micro 3: frozen pre-repair contract for the other kinds.
        const expected = expectedNonChangeFloorIdentity(action, state);
        check(identity === expected, "non-changefloor-byte-for-byte",
          `step ${i} ${action.kind} ${action.summary}: got=${identity} expected=${expected}`);
        nonChangeFloorChecked[action.kind] = (nonChangeFloorChecked[action.kind] || 0) + 1;
        if (action.kind === "battle" && action.target) {
          check(!identity.includes(`:${action.stance.x},${action.stance.y}:`),
            "battle-uses-target-not-stance", `step ${i} ${identity}`);
        }
      }
    }
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`winner replay died at step ${i}`);
  }

  // Micro 2: the corrected MT2 (6,12) -> MT3 identity is frontier-matchable.
  if (mt2ToMt3Identity == null) {
    failures.push({ label: "mt2-to-mt3-identity-found", detail: "no enumerated MT2 6,12 -> MT3 changeFloor along the winner trajectory" });
  } else {
    mt2ToMt3InF3 = f3.frontierSet.has(mt2ToMt3Identity);
    check(f4.frontierSet.has(mt2ToMt3Identity), "mt2-to-mt3-in-f4-frontier", mt2ToMt3Identity);
  }
  for (const id of f3.frontierSet) {
    if (id.startsWith("changeFloor:") && matchableIdentity.f3.has(id)) frontierChangeFloorMatchable.f3 += 1;
  }
  for (const id of f4.frontierSet) {
    if (id.startsWith("changeFloor:") && matchableIdentity.f4.has(id)) frontierChangeFloorMatchable.f4 += 1;
  }
  check(frontierChangeFloorMatchable.f4 > 0, "f4-changefloor-frontier-matchable",
    `matchable F4 changeFloor frontier entries: ${frontierChangeFloorMatchable.f4}`);

  const summary = {
    milestone: "PR-5.25q",
    check: "CHANGEFLOOR_SEMANTIC_IDENTITY_PARITY",
    searchRun: false,
    winnerRouteSteps: trace.length,
    changeFloorTotal,
    changeFloorParityOk,
    changeFloorStanceLeak,
    mt2ToMt3Identity,
    mt2ToMt3InF3,
    mt2ToMt3InF4: mt2ToMt3Identity ? f4.frontierSet.has(mt2ToMt3Identity) : null,
    frontierChangeFloorMatchable,
    nonChangeFloorChecked,
    failures,
    ok: failures.length === 0,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.25q changeFloor semantic identity parity (static, no search)");
  console.log(`  changeFloor enumerated along winner: ${changeFloorTotal}, poi/action parity ok: ${changeFloorParityOk}, stance leaks: ${changeFloorStanceLeak}`);
  console.log(`  MT2 (6,12)->MT3 identity: ${mt2ToMt3Identity} inF3=${mt2ToMt3InF3} inF4=${summary.mt2ToMt3InF4}`);
  console.log(`  matchable changeFloor frontier entries: F3=${frontierChangeFloorMatchable.f3} F4=${frontierChangeFloorMatchable.f4}`);
  console.log(`  non-changeFloor kinds checked (frozen contract): ${JSON.stringify(nonChangeFloorChecked)}`);
  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures.slice(0, 10)) console.log(`    ${f.label}: ${f.detail}`);
  } else {
    console.log("  PASS");
  }
  if (failures.length > 0) process.exitCode = 1;
}

main();
