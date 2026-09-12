"use strict";
/**
 * PR-5.25r - Strategic POI Identity Contract Completion audit.
 *
 * STATIC ONLY (no search). PR-5.25q repaired the changeFloor identity branch;
 * owner review confirmed the same contract drift on `event` (identity used the
 * hero stance instead of the event tile) and on ordinary `pickup` (no `target`,
 * no `itemId` - both coordinate and entity id mismatched), while `interactPickup`
 * already carried the complete schema.
 *
 * Contract under test:
 *   Every action that interacts with a map POI produces the same semantic
 *   identity as the POI it interacts with: the identity uses the POI tile,
 *   not the hero stance, and carries the POI's entity id when the POI has one.
 *
 * Method:
 *   Sample states = the 30 promoted PR-5.25o winner pre-states plus the
 *   canonical CHAOS MT1 initial state. At each state EVERY enumerated action
 *   is classified (not only winner chosen actions) against the POI identity
 *   built from the action's own interaction data:
 *
 *     MATCHED                            actionToSemanticIdentity == poiToSemanticIdentity
 *     MISSING_TARGET_COORD               kind expects a target tile but the action has none
 *     MISSING_ENTITY_ID                  kind expects an entity id but the action has none
 *     STANCE_USED_WHERE_POI_COORD_EXISTS identity used stance coords while the action's x/y is the POI tile
 *     MISMATCHED                         anything else
 *
 *   Because ordinary pickup actions are not enumerated along the sampled
 *   states in this configuration (items sit on standable tiles and are
 *   consumed by the AutoActionResolver stabilization layer), pickup parity is
 *   additionally verified at the schema level: a pickup action built exactly
 *   as the repaired simulator constructor builds it is checked against a real
 *   macro-graph item POI, including route-store normalization (itemId must
 *   come from the field, not from summary parsing).
 *
 *   The check PASSES iff every sampled action of the six supported kinds is
 *   MATCHED with no missing coordinates/ids and the pickup schema micro holds.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { actionToSemanticIdentity, poiToSemanticIdentity } = require("./lib/transport-collapse");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { buildAutomaticMacroGraph } = require("./lib/automatic-macro-graph");
const { resolveRecordedAction, normalizeAction } = require("./lib/route-store");
const { resolveRelativeFloor } = require("./lib/floor-transitions");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const WINNER_ARTIFACT = path.resolve(__dirname, "..", "docs", "260912", "qualification", "5-25o-cap1024-winner.json");
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525r-poi-identity-parity.json");

const SUPPORTED_KINDS = ["battle", "openDoor", "pickup", "interactPickup", "event", "changeFloor"];
const KINDS_EXPECTING_TARGET = new Set(["battle", "openDoor", "pickup", "interactPickup"]);
const ENTITY_ID_FIELD = { battle: "enemyId", openDoor: "doorId", pickup: "itemId", interactPickup: "itemId" };

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

/** The POI the action interacts with, in poiToSemanticIdentity shape. */
function poiForAction(action, state) {
  const floorId = action.floorId || (state && state.floorId) || "";
  const target = action.target || (action.x != null && action.y != null ? { x: action.x, y: action.y } : null) || action.stance || {};
  switch (action.kind) {
    case "battle":
      return { floorId, x: target.x, y: target.y, kind: "enemy", tileId: action.enemyId };
    case "openDoor":
      return { floorId, x: target.x, y: target.y, kind: "door", tileId: action.doorId };
    case "pickup":
    case "interactPickup":
      return { floorId, x: target.x, y: target.y, kind: "item", tileId: action.itemId };
    case "event":
      return { floorId, x: target.x, y: target.y, kind: "event" };
    case "changeFloor":
      return { floorId, x: target.x, y: target.y, kind: "changeFloor", transition: action.changeFloor };
    default:
      return null;
  }
}

function classifyAction(action, state, project) {
  const identity = identityForAction(project, action, state);
  const poi = poiForAction(action, state);
  const poiIdentity = poi ? poiToSemanticIdentity(poi, project) : null;
  const missingTargetCoord = KINDS_EXPECTING_TARGET.has(action.kind) && !action.target;
  const idField = ENTITY_ID_FIELD[action.kind];
  const missingEntityId = Boolean(idField) && !action[idField];
  const stance = action.stance;
  const poiCoordsDifferFromStance = stance && action.x != null && action.y != null
    && (action.x !== stance.x || action.y !== stance.y);
  const stanceUsed = Boolean(poiCoordsDifferFromStance && identity.includes(`:${stance.x},${stance.y}:`));
  const matched = poiIdentity != null && identity === poiIdentity;
  let classification;
  if (missingTargetCoord) classification = "MISSING_TARGET_COORD";
  else if (missingEntityId) classification = "MISSING_ENTITY_ID";
  else if (stanceUsed) classification = "STANCE_USED_WHERE_POI_COORD_EXISTS";
  else if (matched) classification = "MATCHED";
  else classification = "MISMATCHED";
  return { identity, poiIdentity, classification };
}

function emptyKindStats() {
  return { total: 0, MATCHED: 0, MISMATCHED: 0, MISSING_TARGET_COORD: 0, MISSING_ENTITY_ID: 0, STANCE_USED_WHERE_POI_COORD_EXISTS: 0 };
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

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
  const frontierByKind = (set) => {
    const counts = {};
    for (const id of set) {
      const kind = String(id).split(":")[0];
      counts[kind] = (counts[kind] || 0) + 1;
    }
    return counts;
  };

  // --- Sampled states: canonical initial + winner trajectory pre-states ---
  const artifact = JSON.parse(fs.readFileSync(WINNER_ARTIFACT, "utf8"));
  const trace = artifact.winner.routeTrace;
  const sampledStates = [{ label: "canonical-initial", state: initialState }];
  let cursor = initialState;
  for (let i = 0; i < trace.length; i += 1) {
    const entry = trace[i];
    const actions = (simulator.enumeratePrimitiveActions(cursor) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, cursor, {
      ...entry.action,
      postExactStateKey: entry.postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) throw new Error(`winner replay failed at step ${i}`);
    sampledStates.push({ label: `winner-step-${i}`, state: cursor });
    cursor = simulator.applyAction(cursor, resolved.action, { storeRoute: true });
    if (!cursor || !cursor.hero || cursor.hero.hp <= 0) throw new Error(`winner replay died at step ${i}`);
  }

  const byKind = {};
  for (const kind of SUPPORTED_KINDS) byKind[kind] = emptyKindStats();
  const outOfScopeKinds = {};
  const examples = {};
  let totalActions = 0;

  for (const { label, state } of sampledStates) {
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    for (const action of actions) {
      totalActions += 1;
      if (!byKind[action.kind]) {
        outOfScopeKinds[action.kind] = (outOfScopeKinds[action.kind] || 0) + 1;
        continue;
      }
      const stats = byKind[action.kind];
      stats.total += 1;
      const result = classifyAction(action, state, project);
      stats[result.classification] += 1;
      if (result.classification !== "MATCHED") {
        const key = `${action.kind}:${result.classification}`;
        if (!examples[key]) {
          examples[key] = { state: label, summary: action.summary, actionIdentity: result.identity, poiIdentity: result.poiIdentity };
        }
      }
    }
  }

  // --- Pickup schema micro (no pickup actions are enumerable along sampled states) ---
  const pickupObserved = byKind.pickup.total + byKind.interactPickup.total;
  const pickupMicro = { pickupActionsObserved: pickupObserved, ok: false, detail: null };
  try {
    const macroGraph = buildAutomaticMacroGraph(project, initialState, { type: "floorReached", floorId: "MT3" });
    const itemNode = macroGraph.nodes.find((n) => n.kind === "item" && n.tileId && n.x != null && n.y != null);
    if (!itemNode) throw new Error("no macro-graph item POI found for the schema micro");
    const synthesized = {
      kind: "pickup",
      floorId: itemNode.floorId,
      stance: { x: itemNode.x, y: itemNode.y - 1 },
      direction: "down",
      x: itemNode.x,
      y: itemNode.y,
      target: { x: itemNode.x, y: itemNode.y },
      itemId: itemNode.tileId,
      path: [],
      travelState: null,
      summary: `pickup:${itemNode.tileId}@${itemNode.floorId}:${itemNode.x},${itemNode.y}`,
    };
    const identity = actionToSemanticIdentity(synthesized, { floorId: itemNode.floorId }, null, project);
    const expected = poiToSemanticIdentity(itemNode, project);
    const normalized = normalizeAction(synthesized);
    const problems = [];
    if (identity !== expected) problems.push(`identity ${identity} != poi ${expected}`);
    if (normalized.itemId !== itemNode.tileId) problems.push(`normalized itemId ${normalized.itemId} != ${itemNode.tileId}`);
    if (!normalized.target || normalized.target.x !== itemNode.x || normalized.target.y !== itemNode.y) {
      problems.push("normalized target is not the item tile");
    }
    if (!normalized.fingerprint || !normalized.fingerprint.includes(`${itemNode.x},${itemNode.y}`) || !normalized.fingerprint.includes(itemNode.tileId)) {
      problems.push(`fingerprint ${normalized.fingerprint} does not use item tile + itemId`);
    }
    pickupMicro.ok = problems.length === 0;
    pickupMicro.detail = problems.length === 0
      ? `parity on macro item POI ${expected}; normalized itemId/target/fingerprint from fields`
      : problems.join("; ");
    pickupMicro.itemPoi = expected;
  } catch (error) {
    pickupMicro.detail = `micro error: ${error.message}`;
  }

  const failures = [];
  for (const kind of SUPPORTED_KINDS) {
    const stats = byKind[kind];
    for (const bad of ["MISMATCHED", "MISSING_TARGET_COORD", "MISSING_ENTITY_ID", "STANCE_USED_WHERE_POI_COORD_EXISTS"]) {
      if (stats[bad] > 0) failures.push({ label: `${kind}:${bad}`, count: stats[bad], example: examples[`${kind}:${bad}`] || null });
    }
  }
  if (!pickupMicro.ok) failures.push({ label: "pickup-schema-micro", count: 1, example: pickupMicro.detail });

  const summary = {
    milestone: "PR-5.25r",
    check: "STRATEGIC_POI_IDENTITY_PARITY",
    searchRun: false,
    contract: "action semantic identity == POI semantic identity (POI tile coords + entity id)",
    sampledStates: sampledStates.length,
    totalEnumeratedActions: totalActions,
    parityByKind: byKind,
    outOfScopeKinds,
    pickupSchemaMicro: pickupMicro,
    frontierEntriesByKind: { f3: frontierByKind(f3.frontierSet), f4: frontierByKind(f4.frontierSet) },
    failures,
    ok: failures.length === 0,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.25r strategic POI identity parity audit (static, no search)");
  console.log(`  sampled states: ${sampledStates.length}, enumerated actions: ${totalActions}`);
  for (const kind of SUPPORTED_KINDS) {
    const s = byKind[kind];
    console.log(`  ${kind.padEnd(15)} total=${s.total} matched=${s.MATCHED} mismatched=${s.MISMATCHED} missingTarget=${s.MISSING_TARGET_COORD} missingId=${s.MISSING_ENTITY_ID} stanceUsed=${s.STANCE_USED_WHERE_POI_COORD_EXISTS}`);
  }
  if (Object.keys(outOfScopeKinds).length > 0) console.log(`  out-of-scope kinds: ${JSON.stringify(outOfScopeKinds)}`);
  console.log(`  frontier entries by kind: F3=${JSON.stringify(summary.frontierEntriesByKind.f3)}`);
  console.log(`  pickup schema micro: ok=${pickupMicro.ok} (${pickupMicro.detail})`);
  if (failures.length > 0) {
    console.log(`  FAIL (${failures.length}):`);
    for (const f of failures.slice(0, 10)) console.log(`    ${f.label} x${f.count}${f.example ? ` e.g. ${f.example.actionIdentity} vs ${f.example.poiIdentity}` : ""}`);
  } else {
    console.log("  PASS");
  }
  if (failures.length > 0) process.exitCode = 1;
}

main();
