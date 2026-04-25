"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const { chromium } = require("playwright-core");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getTileNumberAt } = require("./lib/state");
const { loadProject } = require("./lib/project-loader");
const { searchTopK } = require("./lib/search");
const { createSearchProfile } = require("./lib/search-profiles");
const { StaticSimulator } = require("./lib/simulator");
const { buildDominanceKey } = require("./lib/state-key");
const { buildResourcePocketSearchOptions, shouldEnableResourcePocket } = require("./lib/cli-options");
const {
  compareCandidateStates,
  isDecisionStep,
  sortCandidateFrontier,
  summarizeCandidateProgress,
  trimCandidateFrontier,
} = require("./lib/updown-candidate-policy");

let VERIFY_FLOORS = ["MT1", "MT2", "MT3"];
const HERO_FIELDS = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];
const FALLBACK_UP_DOWN_DECISIONS = [
  "battle:greenSlime@MT1:4,7",
  "battle:blackSlime@MT1:8,7",
  "battle:redSlime@MT1:10,8",
  "battle:blackSlime@MT1:3,10",
  "battle:slimelord@MT1:3,4",
  "battle:bat@MT1:4,11",
  "battle:slimelord@MT1:9,4",
  "battle:bat@MT1:8,11",
  "battle:bigBat@MT1:11,11",
  "battle:vampire@MT1:1,11",
  "battle:vampire@MT1:4,3",
  "battle:skeletonWarrior@MT1:2,1",
  "battle:skeletonCaptain@MT1:8,3",
  "battle:skeleton@MT1:8,1",
  "changeFloor@MT1:6,0",
  "changeFloor@MT2:6,0",
];
const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
};

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = token.match(/^--([^=]+)=(.+)$/);
    if (!match) return result;
    result[match[1]] = match[2];
    return result;
  }, {});
}

function parseBooleanFlag(value, defaultValue) {
  if (value == null) return defaultValue;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return defaultValue;
}

function parseOptionalNumber(value) {
  if (value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseSnapshotFloors(value, fallback) {
  if (!value) return fallback.slice();
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildFloorRange(toFloor) {
  const match = /^MT(\d+)$/.exec(toFloor || "");
  if (!match) return VERIFY_FLOORS.slice();
  const last = Number(match[1]);
  const floors = [];
  for (let index = 1; index <= last; index += 1) floors.push(`MT${index}`);
  return floors;
}

function stableObject(object) {
  return Object.keys(object || {})
    .sort()
    .reduce((result, key) => {
      const value = object[key];
      if (value == null) return result;
      if (value === 0) return result;
      if (Array.isArray(value) && value.length === 0) return result;
      if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return result;
      result[key] = value;
      return result;
    }, {});
}

function normalizeFlags(flags) {
  return Object.keys(flags || {})
    .sort()
    .reduce((result, key) => {
      if (key === "__frontierFeatures") return result;
      if (key.startsWith("__") && !key.endsWith("_buff__")) return result;
      const value = flags[key];
      if (value == null || value === 0) return result;
      if (typeof value === "object") return result;
      result[key] = value;
      return result;
    }, {});
}

function normalizeHero(hero) {
  const normalized = HERO_FIELDS.reduce((result, field) => {
    result[field] = Number((hero || {})[field] || 0);
    return result;
  }, {});
  normalized.loc = {
    x: Number((((hero || {}).loc || {}).x) || 0),
    y: Number((((hero || {}).loc || {}).y) || 0),
    direction: ((((hero || {}).loc || {}).direction) || "down"),
  };
  normalized.equipment = Array.isArray((hero || {}).equipment) ? hero.equipment.slice() : [];
  return normalized;
}

function tileNumberToSnapshotId(project, number) {
  if (number == null || number === 0) return null;
  const definition = project.mapTilesByNumber[String(number)];
  if (definition && definition.id != null) return definition.id;
  return `X${number}`;
}

function getBaseTileId(project, floorId, x, y) {
  const number = project.floorsById[floorId].map[y][x];
  return tileNumberToSnapshotId(project, number);
}

function getCurrentTileId(project, state, floorId, x, y) {
  const number = getTileNumberAt(project, state, floorId, x, y);
  return tileNumberToSnapshotId(project, number);
}

function buildSolverFloorMutationSnapshot(project, state, floorId) {
  const floor = project.floorsById[floorId];
  const removed = [];
  const replaced = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const baseId = getBaseTileId(project, floorId, x, y);
      const currentId = getCurrentTileId(project, state, floorId, x, y);
      if (currentId === baseId) continue;
      const loc = `${x},${y}`;
      if (currentId == null) removed.push(loc);
      else replaced.push(`${loc}=${currentId}`);
    }
  }
  return {
    removed,
    replaced,
  };
}

function buildSolverSnapshot(project, state) {
  const floors = {};
  VERIFY_FLOORS.forEach((floorId) => {
    floors[floorId] = buildSolverFloorMutationSnapshot(project, state, floorId);
  });
  return {
    floorId: state.floorId,
    hero: normalizeHero(state.hero),
    inventory: stableObject(state.inventory),
    flags: normalizeFlags(state.flags),
    floors,
  };
}

function summarizeSnapshot(snapshot) {
  return {
    floorId: snapshot.floorId,
    hero: snapshot.hero,
    inventory: snapshot.inventory,
    flags: snapshot.flags,
    floors: Object.keys(snapshot.floors || {}).reduce((result, floorId) => {
      const floor = snapshot.floors[floorId] || {};
      result[floorId] = {
        removedCount: Array.isArray(floor.removed) ? floor.removed.length : 0,
        replacedCount: Array.isArray(floor.replaced) ? floor.replaced.length : 0,
        removedPreview: Array.isArray(floor.removed) ? floor.removed.slice(0, 12) : [],
        replacedPreview: Array.isArray(floor.replaced) ? floor.replaced.slice(0, 12) : [],
      };
      return result;
    }, {}),
  };
}

function diffSnapshots(expected, actual, pathSegments) {
  const prefix = pathSegments || [];
  if (typeof expected !== typeof actual) {
    return `${prefix.join(".")}: type mismatch (${typeof expected} !== ${typeof actual})`;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return `${prefix.join(".")}: array mismatch`;
    }
    if (expected.length !== actual.length) {
      return `${prefix.join(".")}: length mismatch (${expected.length} !== ${actual.length})`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = diffSnapshots(expected[index], actual[index], prefix.concat(String(index)));
      if (mismatch) return mismatch;
    }
    return null;
  }
  if (expected && typeof expected === "object") {
    const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).sort();
    for (const key of keys) {
      const mismatch = diffSnapshots(expected[key], actual[key], prefix.concat(key));
      if (mismatch) return mismatch;
    }
    return null;
  }
  if (expected !== actual) {
    return `${prefix.join(".")}: ${JSON.stringify(expected)} !== ${JSON.stringify(actual)}`;
  }
  return null;
}

function findBrowserExecutable(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  return CHROME_PATHS.find((filePath) => fs.existsSync(filePath)) || null;
}

function createStaticServer(rootDir) {
  const server = http.createServer((request, response) => {
    const rawPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relativePath = rawPath === "/" ? "/index.html" : rawPath;
    const safePath = path.normalize(relativePath).replace(/^(\.\.[\\/])+/, "");
    const filePath = path.join(rootDir, safePath);
    if (!filePath.startsWith(rootDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500);
        response.end(error.code === "ENOENT" ? "Not Found" : "Server Error");
        return;
      }
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(content);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
        port: address.port,
        server,
        url: `http://127.0.0.1:${address.port}/index.html`,
      });
    });
  });
}

function findUpDownCandidate(project, simulator, options) {
  const config = options || {};
  const maxExpansions = Number(config.maxExpansions || 400);
  const perStateLimit = Number(config.perStateLimit || 10);
  const profile = createSearchProfile("updown-mt1-mt3", simulator, {
    perStateLimit,
  });
  const initialState = simulator.createInitialState({ rank: config.rank || "chaos" });
  const frontier = [initialState];
  const seen = new Set();
  const bestByDominanceKey = new Map([[buildDominanceKey(initialState), initialState]]);
  const expandedByDominanceKey = new Map();
  let expansions = 0;

  while (frontier.length > 0 && expansions < maxExpansions) {
    sortCandidateFrontier(simulator, frontier);
    const state = frontier.shift();
    const dominanceKey = buildDominanceKey(state);
    const bestDominanceState = bestByDominanceKey.get(dominanceKey);
    if (bestDominanceState && bestDominanceState !== state && compareCandidateStates(simulator, bestDominanceState, state) >= 0) {
      continue;
    }
    const expandedDominanceState = expandedByDominanceKey.get(dominanceKey);
    if (expandedDominanceState && compareCandidateStates(simulator, expandedDominanceState, state) >= 0) {
      continue;
    }
    const key = JSON.stringify([
      state.floorId,
      state.hero.loc,
      state.hero.hp,
      state.hero.atk,
      state.hero.def,
      state.hero.mdef,
      state.inventory,
      state.flags,
      state.floorStates,
      state.visitedFloors,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!expandedDominanceState || compareCandidateStates(simulator, state, expandedDominanceState) > 0) {
      expandedByDominanceKey.set(dominanceKey, state);
    }
    expansions += 1;

    const progress = summarizeCandidateProgress(state);
    const hasUp = progress.upCount > 0;
    const hasDown = progress.downCount > 0;
    if (state.floorId === "MT1" && progress.hasVisitedMT2 && hasUp && hasDown) {
      return { expansions, state };
    }

    const actions = (profile.sortStateActions || ((_, items) => items))(state, simulator.enumerateActions(state))
      .slice(0, perStateLimit);
    actions.forEach((action) => {
      const nextState = simulator.applyAction(state, action);
      const nextDominanceKey = buildDominanceKey(nextState);
      const bestNextState = bestByDominanceKey.get(nextDominanceKey);
      if (bestNextState && compareCandidateStates(simulator, bestNextState, nextState) >= 0) {
        return;
      }
      bestByDominanceKey.set(nextDominanceKey, nextState);
      frontier.push(nextState);
    });
    const trimmed = trimCandidateFrontier(simulator, frontier, config);
    if (trimmed !== frontier) {
      frontier.length = 0;
      frontier.push(...trimmed);
    }
  }

  throw new Error(`No MT1 -> MT2 -> MT1 candidate found within ${maxExpansions} expansions.`);
}

function findTerminalCandidate(simulator, options) {
  const config = options || {};
  const profileName = config.profile || "stage-mt1-mt11";
  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: config.maxActionsPerState,
    perStateLimit: config.perStateLimit,
  });
  const initialState = simulator.createInitialState({ rank: config.rank || "chaos" });
  const result = searchTopK(simulator, initialState, {
    ...profile,
    topK: 1,
    maxExpansions: Number(config.maxExpansions || 2000),
    beamWidth: config.beamWidth,
    perFloorBeamWidth: config.perFloorBeamWidth,
    perRegionBeamWidth: config.perRegionBeamWidth,
    maxActionsPerState: config.maxActionsPerState != null ? config.maxActionsPerState : profile.maxActionsPerState,
    disableDominance: config.disableDominance,
    dominanceMode: config.dominanceMode,
    safeDominanceMode: config.safeDominanceMode,
  });

  if (!result.foundGoal || !result.goalState) {
    const bestProgressState = result.bestProgressState || result.bestSeenState;
    const bestProgressSummary = bestProgressState
      ? `${bestProgressState.floorId}, stage=${bestProgressState.progress && bestProgressState.progress.stageIndex}, decisions=${bestProgressState.meta && bestProgressState.meta.decisionDepth}, routeLen=${bestProgressState.route.length}`
      : "none";
    const bestSeenSummary = result.bestSeenState
      ? `${result.bestSeenState.floorId}, stage=${result.bestSeenState.progress && result.bestSeenState.progress.stageIndex}, decisions=${result.bestSeenState.meta && result.bestSeenState.meta.decisionDepth}, routeLen=${result.bestSeenState.route.length}`
      : "none";
    throw new Error(
      `Solver did not find strict goal ${simulator.stopFloorId} within ${result.expansions} expansions; ` +
        `bestProgress=${bestProgressSummary}; bestSeen=${bestSeenSummary}; diagnostics=${JSON.stringify(result.diagnostics)}`
    );
  }

  return {
    diagnostics: result.diagnostics,
    expansions: result.expansions,
    state: result.goalState,
  };
}

function findBestSeenCandidate(simulator, options) {
  const config = options || {};
  const profileName = config.profile || "stage-mt1-mt11";
  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: config.maxActionsPerState,
    perStateLimit: config.perStateLimit,
  });
  const initialState = simulator.createInitialState({ rank: config.rank || "chaos" });
  const result = searchTopK(simulator, initialState, {
    ...profile,
    topK: 1,
    maxExpansions: Number(config.maxExpansions || 300),
    beamWidth: config.beamWidth,
    perFloorBeamWidth: config.perFloorBeamWidth,
    perRegionBeamWidth: config.perRegionBeamWidth,
    maxActionsPerState: config.maxActionsPerState != null ? config.maxActionsPerState : profile.maxActionsPerState,
    disableDominance: config.disableDominance,
    dominanceMode: config.dominanceMode,
    safeDominanceMode: config.safeDominanceMode,
  });
  if (!result.bestSeenState || result.bestSeenState.route.length === 0) {
    throw new Error(`No replayable best-seen route found within ${result.expansions} expansions.`);
  }
  return {
    diagnostics: result.diagnostics,
    expansions: result.expansions,
    state: result.bestSeenState,
  };
}

function findBestProgressCandidate(simulator, options) {
  const config = options || {};
  const profileName = config.profile || "stage-mt1-mt11";
  const profile = createSearchProfile(profileName, simulator, {
    maxActionsPerState: config.maxActionsPerState,
    perStateLimit: config.perStateLimit,
  });
  const initialState = simulator.createInitialState({ rank: config.rank || "chaos" });
  const result = searchTopK(simulator, initialState, {
    ...profile,
    topK: 1,
    maxExpansions: Number(config.maxExpansions || 300),
    beamWidth: config.beamWidth,
    perFloorBeamWidth: config.perFloorBeamWidth,
    perRegionBeamWidth: config.perRegionBeamWidth,
    maxActionsPerState: config.maxActionsPerState != null ? config.maxActionsPerState : profile.maxActionsPerState,
    disableDominance: config.disableDominance,
    dominanceMode: config.dominanceMode,
    safeDominanceMode: config.safeDominanceMode,
  });
  const state = result.bestProgressState || result.bestSeenState;
  if (!state || state.route.length === 0) {
    throw new Error(`No replayable best-progress route found within ${result.expansions} expansions.`);
  }
  return {
    diagnostics: result.diagnostics,
    expansions: result.expansions,
    state,
  };
}

function buildDecisionPlan(project, simulator, candidateState, rank) {
  return buildDecisionPlanFromSummaries(project, simulator, candidateState.route.filter(isDecisionStep), rank);
}

function buildDecisionPlanFromSummaries(project, simulator, decisions, rank) {
  const initialState = simulator.createInitialState({ rank });
  const plan = [];
  const snapshots = [
    {
      label: "initial",
      snapshot: buildSolverSnapshot(project, initialState),
    },
  ];

  let currentState = initialState;

  decisions.forEach((summary) => {
    const action = simulator.enumerateActions(currentState).find((item) => item.summary === summary);
    if (!action) {
      throw new Error(`Unable to reconstruct action for summary: ${summary}`);
    }

    let targetX = null;
    let targetY = null;
    if (action.kind === "battle" || action.kind === "openDoor" || action.kind === "useTool") {
      targetX = action.target ? action.target.x : null;
      targetY = action.target ? action.target.y : null;
    } else if (action.kind === "pickup" || action.kind === "changeFloor" || action.kind === "event") {
      targetX = action.x;
      targetY = action.y;
    }

    plan.push({
      direction: action.direction || null,
      equipId: action.equipId || null,
      enemyId: action.enemyId || null,
      kind: action.kind,
      path: Array.isArray(action.path) ? action.path.slice() : [],
      stanceX: action.stance ? action.stance.x : null,
      stanceY: action.stance ? action.stance.y : null,
      summary,
      targetX,
      targetY,
      tool: action.tool || null,
    });

    currentState = simulator.applyAction(currentState, action);
    snapshots.push({
      label: summary,
      snapshot: buildSolverSnapshot(project, currentState),
    });
  });

  return {
    decisions,
    finalState: currentState,
    plan,
    snapshots,
  };
}

async function waitForCondition(page, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const satisfied = await page.evaluate(predicate);
    if (satisfied) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function formatStatus(status) {
  if (!status) return "status=null";
  const hero = status.hero || {};
  const eventParts = [];
  if (status.eventId) eventParts.push(`event=${status.eventId}`);
  if (status.eventType) eventParts.push(`eventType=${status.eventType}`);
  if (status.eventSelection != null) eventParts.push(`selection=${status.eventSelection}`);
  if (status.eventChoices && status.eventChoices.length > 0) eventParts.push(`choices=${JSON.stringify(status.eventChoices)}`);
  if (status.eventCurrent) eventParts.push(`eventCurrent=${JSON.stringify(status.eventCurrent).slice(0, 240)}`);
  const checkBlock = status.checkBlock
    ? `checkBlock=${JSON.stringify(status.checkBlock).slice(0, 240)}`
    : "checkBlock=none";
  return `floor=${status.floorId} x=${hero.x} y=${hero.y} hp=${hero.hp} atk=${hero.atk} def=${hero.def} mdef=${hero.mdef} ` +
    `moving=${status.moving} lock=${status.lockControl} ${eventParts.join(" ") || "event=none"} ${checkBlock} replay=${status.replayAnimating}`;
}

function summarizePlanAction(action) {
  if (!action) return "none";
  const parts = [action.summary || action.kind];
  if (action.stanceX != null && action.stanceY != null) parts.push(`from=${action.stanceX},${action.stanceY}`);
  if (action.targetX != null && action.targetY != null) parts.push(`to=${action.targetX},${action.targetY}`);
  if (action.direction) parts.push(`dir=${action.direction}`);
  if (action.tool) parts.push(`tool=${action.tool}`);
  return parts.join(" ");
}

function runtimeReachedGoal(status, goal, toFloor) {
  if (!status) return false;
  if (toFloor) return status.floorId === toFloor;
  return false;
}

async function waitForRuntimeReady(page) {
  await waitForCondition(
    page,
    () => Boolean(
      window.main &&
      window.core &&
      core.events &&
      core.control &&
      core.maps &&
      core.firstData &&
      core.material &&
      core.material.images &&
      core.material.images.images &&
      core.material.images.images["hero.png"]
    ),
    "runtime ready",
    30000
  );
}

async function waitForRuntimeIdle(page, timeoutMs) {
  await waitForCondition(
    page,
    () => {
      if (!window.core || !core.status) return false;
      const moving = (typeof core.isMoving === "function" && core.isMoving()) || Number(core.status.heroMoving || 0) > 0;
      const eventId = ((core.status.event || {}).id) || null;
      const replayAnimating = Boolean(((core.status.replay || {}).animate));
      return Boolean(core.status.floorId) && !moving && !replayAnimating && !core.status.lockControl && !eventId;
    },
    "runtime idle",
    timeoutMs || 30000
  );
}

async function describeRuntimeStatus(page) {
  return page.evaluate(() => {
    const event = ((core.status || {}).event || {});
    const eventData = event.data || null;
    const eventUi = event.ui || null;
    const heroLoc = (((core.status || {}).hero || {}).loc || {});
    const loc = heroLoc.x != null && heroLoc.y != null ? `${heroLoc.x},${heroLoc.y}` : null;
    const checkBlockData = (core.status || {}).checkBlock || {};
    const checkBlock = loc ? {
      loc,
      damage: Number((checkBlockData.damage || {})[loc] || 0),
      type: (checkBlockData.type || {})[loc] || {},
      repulse: (checkBlockData.repulse || {})[loc] || [],
      ambush: (checkBlockData.ambush || {})[loc] || [],
    } : null;
    return {
      floorId: core.status && core.status.floorId,
      hero: core.status && core.status.hero ? {
        x: core.status.hero.loc.x,
        y: core.status.hero.loc.y,
        direction: core.status.hero.loc.direction,
        hp: core.status.hero.hp,
        atk: core.status.hero.atk,
        def: core.status.hero.def,
        mdef: core.status.hero.mdef,
      } : null,
      lockControl: Boolean(core.status && core.status.lockControl),
      moving: Boolean((typeof core.isMoving === "function" && core.isMoving()) || Number((core.status || {}).heroMoving || 0) > 0),
      eventId: event.id || null,
      eventType: eventData && eventData.type ? eventData.type : null,
      eventCurrent: Array.isArray(eventData) && eventData.length > 0 ? eventData[0] : null,
      eventSelection: event.selection == null ? null : event.selection,
      eventChoices: eventUi && Array.isArray(eventUi.choices) ? eventUi.choices.map((choice) => choice && (choice.text || choice)) : null,
      replayAnimating: Boolean((((core.status || {}).replay || {}).animate)),
      checkBlock,
      routeLength: Array.isArray((core.status || {}).route) ? core.status.route.length : null,
    };
  });
}

async function quickStartRuntime(page, rank) {
  await page.evaluate((hard) => {
    core.events.startGame(hard || "");
  }, rank);
  await waitForCondition(
    page,
    () => Boolean(window.core && core.status && core.status.floorId === core.firstData.floorId),
    "game start",
    30000
  );
  await waitForRuntimeIdle(page);
}

async function stabilizeRuntime(page, timeoutMs) {
  await page.evaluate(() => {
    core.setFlag("shiqu", 1);
    core.setFlag("autoBattle", 1);
    core.updateCheckBlock();
    core.plugin.autoGetItem();
    core.plugin.autoBattle();
  });
  await waitForRuntimeIdle(page, timeoutMs);
}

async function executeRuntimeDecision(page, action, options) {
  const config = options || {};
  if (config.traceLive) {
    console.log(`Executing runtime action: ${summarizePlanAction(action)}`);
  } else {
    console.log(`Executing runtime action: ${action.summary}`);
  }
  for (const direction of action.path || []) {
    const moved = await page.evaluate((stepDirection) => new Promise((resolve) => {
      try {
        core.moveHero(stepDirection, function () {
          resolve(true);
        });
      } catch (error) {
        resolve(false);
      }
    }), direction);
    if (!moved) {
      throw new Error(`Failed to perform path step ${direction} for action: ${action.summary}`);
    }
    try {
      await waitForRuntimeIdle(page, config.idleTimeoutMs);
    } catch (error) {
      const status = await describeRuntimeStatus(page);
      throw new Error(`Timed out after path step ${direction} for ${action.summary}: ${JSON.stringify(status)}`);
    }
  }

  if (action.kind === "equip") {
    const equipped = await page.evaluate((step) => new Promise((resolve) => {
      try {
        core.loadEquip(step.equipId, function () {
          resolve(true);
        });
      } catch (error) {
        resolve(false);
      }
    }), action);
    if (!equipped) {
      throw new Error(`Failed to equip for action: ${action.summary}`);
    }
    await waitForRuntimeIdle(page);
    await stabilizeRuntime(page, config.idleTimeoutMs);
    return;
  }

  if (action.kind === "battle") {
    if (action.targetX == null || action.targetY == null) {
      throw new Error(`Battle action missing target coordinates: ${action.summary}`);
    }
  } else if (action.kind === "useTool") {
    if (!action.tool) {
      throw new Error(`Tool action missing tool: ${action.summary}`);
    }
  } else if (action.kind !== "equip" && !action.direction) {
    throw new Error(`Runtime driver cannot execute action: ${action.summary}`);
  }

  const stepped = await page.evaluate((step) => new Promise((resolve) => {
    try {
      if (step.kind === "battle") {
        if (step.direction) core.setHeroLoc("direction", step.direction);
        core.battle(step.enemyId || null, step.targetX, step.targetY, false, function () {
          resolve(true);
        });
        return;
      }
      if (step.kind === "useTool") {
        if (step.direction) core.setHeroLoc("direction", step.direction);
        core.useItem(step.tool, true, function () {
          resolve(true);
        });
        return;
      }
      core.moveHero(step.direction, function () {
        resolve(true);
      });
    } catch (error) {
      resolve(false);
    }
  }), action);
  if (!stepped) {
    throw new Error(`Failed to perform final step for action: ${action.summary}`);
  }

  await page.evaluate(() => {
    if (core.status && core.status.event && core.status.event.id === "action") {
      core.doAction();
    }
  });

  try {
    await waitForRuntimeIdle(page);
  } catch (error) {
    const status = await describeRuntimeStatus(page);
    throw new Error(`Timed out after final step for ${action.summary}: ${JSON.stringify(status)}`);
  }
  await stabilizeRuntime(page, config.idleTimeoutMs);
}

async function captureRuntimeSnapshot(page) {
  return page.evaluate(({ verifyFloors, heroFields }) => {
    const save = core.saveData();
    const hero = save.hero || {};
    const inventory = {};
    ["tools", "constants", "equips"].forEach((bucket) => {
      Object.entries(((hero.items || {})[bucket]) || {}).forEach(([itemId, amount]) => {
        if (Number(amount || 0) > 0) inventory[itemId] = Number(amount);
      });
    });

    const normalizedHero = heroFields.reduce((result, field) => {
      result[field] = Number(hero[field] || 0);
      return result;
    }, {});
    normalizedHero.loc = {
      direction: (((hero || {}).loc || {}).direction) || "down",
      x: Number((((hero || {}).loc || {}).x) || 0),
      y: Number((((hero || {}).loc || {}).y) || 0),
    };
    normalizedHero.equipment = Array.isArray(hero.equipment) ? hero.equipment.slice() : [];

    const flags = Object.keys(hero.flags || {})
      .sort()
      .reduce((result, key) => {
        if (key.startsWith("__") && !key.endsWith("_buff__")) return result;
        const value = hero.flags[key];
        if (value == null || value === 0) return result;
        if (typeof value === "object") return result;
        result[key] = value;
        return result;
      }, {});

    const floors = {};
    verifyFloors.forEach((floorId) => {
      const floor = main.floors[floorId];
      const removed = [];
      const replaced = [];
      for (let y = 0; y < floor.height; y += 1) {
        for (let x = 0; x < floor.width; x += 1) {
          const currentId = core.getBlockId(x, y, floorId, true);
          const number = floor.map[y][x];
          const baseBlock = number == null || number === 0 ? null : core.maps.getBlockByNumber(number);
          const baseId = baseBlock && baseBlock.event ? baseBlock.event.id : (number == null || number === 0 ? null : ("X" + number));
          if (currentId === baseId) continue;
          const loc = x + "," + y;
          if (currentId == null) removed.push(loc);
          else replaced.push(loc + "=" + currentId);
        }
      }
      floors[floorId] = { removed, replaced };
    });

    return {
      floorId: save.floorId,
      hero: normalizedHero,
      inventory,
      flags,
      floors,
    };
  }, { verifyFloors: VERIFY_FLOORS, heroFields: HERO_FIELDS });
}


function summarizeReplayConfidence(plan, candidate, lastSuccessfulAction, reachedGoal) {
  const finalState = plan && plan.finalState;
  const notes = (finalState && finalState.notes) || [];
  const unsupportedNotes = notes.filter((note) => /unsupported|未支持|not supported/i.test(String(note)));
  const snapshot = plan && plan.snapshots && plan.snapshots[Math.max(0, Math.min(lastSuccessfulAction + 1, plan.snapshots.length - 1))];
  return {
    liveVerified: Boolean(reachedGoal || (plan && lastSuccessfulAction + 1 >= plan.plan.length)),
    reachedGoal: Boolean(reachedGoal),
    verifiedSteps: Math.max(0, lastSuccessfulAction + 1),
    totalSteps: plan && plan.plan ? plan.plan.length : 0,
    verifiedFloor: snapshot && snapshot.snapshot ? snapshot.snapshot.floorId : null,
    solverFinalFloor: finalState && finalState.floorId,
    routeLength: finalState && Array.isArray(finalState.route) ? finalState.route.length : 0,
    unsupportedNoteCount: unsupportedNotes.length,
    unsupportedNotesPreview: unsupportedNotes.slice(0, 5),
    searchExpansions: candidate && candidate.expansions,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(__dirname, "..");
  const project = loadProject(projectRoot);
  const toFloor = args["to-floor"] || null;
  const goal = args.goal || (toFloor ? "terminal" : "updown-mt1-mt3");
  VERIFY_FLOORS = parseSnapshotFloors(args["snapshot-floors"], toFloor ? buildFloorRange(toFloor) : VERIFY_FLOORS);
  const keepOpen = parseBooleanFlag(args["keep-open"], false);
  const stopOnGoal = parseBooleanFlag(args["stop-on-goal"], false);
  const traceLive = parseBooleanFlag(args["trace-live"], false);
  const timeoutMs = Number(args["timeout-ms"] || 30000);
  const stepDelayMs = Number(args["step-delay-ms"] || 0);
  const startDelayMs = Number(args["start-delay-ms"] || 0);
  const simulator = new StaticSimulator(project, {
    stopFloorId: toFloor || "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    enableFightToLevelUp: parseBooleanFlag(args["fight-to-levelup"], false),
    enableResourcePocket: shouldEnableResourcePocket(args, false),
    resourcePocketSearchOptions: buildResourcePocketSearchOptions(args),
  });

  const rank = args.rank || "chaos";
  let candidate = null;
  let plan = null;
  let fallbackMessage = null;
  const allowFallback = parseBooleanFlag(args["allow-fallback"], goal === "updown-mt1-mt3");
  try {
    if (goal === "terminal") {
      candidate = findTerminalCandidate(simulator, {
        beamWidth: parseOptionalNumber(args["beam-width"]),
        maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
        maxExpansions: Number(args["search-expansions"] || 2000),
        disableDominance: parseBooleanFlag(args["disable-dominance"], false),
        dominanceMode: args["dominance-mode"],
        safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
        perFloorBeamWidth: parseOptionalNumber(args["per-floor-beam-width"]),
        perRegionBeamWidth: parseOptionalNumber(args["per-region-beam-width"]),
        perStateLimit: parseOptionalNumber(args["per-state-limit"]),
        profile: args.profile || "stage-mt1-mt11",
        rank,
      });
    } else if (goal === "best-seen") {
      candidate = findBestSeenCandidate(simulator, {
        beamWidth: parseOptionalNumber(args["beam-width"]),
        maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
        maxExpansions: Number(args["search-expansions"] || 300),
        disableDominance: parseBooleanFlag(args["disable-dominance"], false),
        dominanceMode: args["dominance-mode"],
        safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
        perFloorBeamWidth: parseOptionalNumber(args["per-floor-beam-width"]),
        perRegionBeamWidth: parseOptionalNumber(args["per-region-beam-width"]),
        perStateLimit: parseOptionalNumber(args["per-state-limit"]),
        profile: args.profile || "stage-mt1-mt11",
        rank,
      });
    } else if (goal === "best-progress") {
      candidate = findBestProgressCandidate(simulator, {
        beamWidth: parseOptionalNumber(args["beam-width"]),
        maxActionsPerState: parseOptionalNumber(args["max-actions-per-state"]),
        maxExpansions: Number(args["search-expansions"] || 300),
        disableDominance: parseBooleanFlag(args["disable-dominance"], false),
        dominanceMode: args["dominance-mode"],
        safeDominanceMode: parseBooleanFlag(args["safe-dominance-mode"], true),
        perFloorBeamWidth: parseOptionalNumber(args["per-floor-beam-width"]),
        perRegionBeamWidth: parseOptionalNumber(args["per-region-beam-width"]),
        perStateLimit: parseOptionalNumber(args["per-state-limit"]),
        profile: args.profile || "stage-mt1-mt11",
        rank,
      });
    } else if (goal === "updown-mt1-mt3") {
      candidate = findUpDownCandidate(project, simulator, {
        maxExpansions: Number(args["search-expansions"] || 240),
        perStateLimit: Number(args["per-state-limit"] || 8),
        rank,
      });
    } else {
      throw new Error(`Unknown verification goal: ${goal}`);
    }
    plan = buildDecisionPlan(project, simulator, candidate.state, rank);
  } catch (error) {
    if (!allowFallback) throw error;
    fallbackMessage = `Candidate search fallback: ${error.message}`;
    plan = buildDecisionPlanFromSummaries(project, simulator, FALLBACK_UP_DOWN_DECISIONS, rank);
  }
  if (fallbackMessage) console.log(fallbackMessage);
  if (plan) {
    console.log(
      `Replay candidate: goal=${goal}${toFloor ? ` -> ${toFloor}` : ""}, ` +
        `final=${plan.finalState.floorId}, decisions=${plan.decisions.length}, routeLen=${plan.finalState.route.length}`
    );
  }
  const browserPath = findBrowserExecutable(args.browser);
  if (!browserPath) {
    throw new Error("No Chrome/Edge executable found for live verification.");
  }

  const server = await createStaticServer(projectRoot);
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: args.headless !== "0",
  });

  try {
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(page);
    await quickStartRuntime(page, rank);
    await stabilizeRuntime(page, timeoutMs);
    if (startDelayMs > 0) {
      console.log(`Waiting ${startDelayMs}ms before replay actions...`);
      await page.waitForTimeout(startDelayMs);
    }

    const initialRuntimeSnapshot = await captureRuntimeSnapshot(page);
    const initialMismatch = diffSnapshots(plan.snapshots[0].snapshot, initialRuntimeSnapshot, ["initial"]);
    if (initialMismatch) {
      console.error("Expected initial snapshot:", JSON.stringify(summarizeSnapshot(plan.snapshots[0].snapshot), null, 2));
      console.error("Actual initial snapshot:", JSON.stringify(summarizeSnapshot(initialRuntimeSnapshot), null, 2));
      throw new Error(`Initial live snapshot mismatch: ${initialMismatch}`);
    }

    let lastSuccessfulAction = -1;
    let reachedGoalDuringReplay = false;
    for (let index = 0; index < plan.plan.length; index += 1) {
      const action = plan.plan[index];
      const beforeStatus = traceLive ? await describeRuntimeStatus(page) : null;
      if (traceLive) {
        console.log(`[trace-live] step=${index + 1}/${plan.plan.length} before ${formatStatus(beforeStatus)} action=${summarizePlanAction(action)}`);
      }
      try {
        await executeRuntimeDecision(page, action, { traceLive, idleTimeoutMs: timeoutMs });
      } catch (error) {
        const actual = await describeRuntimeStatus(page).catch(() => null);
        const expected = plan.snapshots[index + 1] ? summarizeSnapshot(plan.snapshots[index + 1].snapshot) : null;
        throw new Error(
          `Live replay failed at step ${index + 1}/${plan.plan.length}; lastSuccessfulAction=${lastSuccessfulAction + 1}; ` +
            `nextAction=${summarizePlanAction(action)}; expected=${JSON.stringify(expected)}; actual=${formatStatus(actual)}; cause=${error.message}`
        );
      }
      const afterStatus = await describeRuntimeStatus(page);
      if (traceLive) {
        console.log(`[trace-live] step=${index + 1}/${plan.plan.length} after ${formatStatus(afterStatus)}`);
      }
      if (stopOnGoal && runtimeReachedGoal(afterStatus, goal, toFloor)) {
        console.log(`Stop-on-goal reached: ${formatStatus(afterStatus)}`);
        lastSuccessfulAction = index;
        reachedGoalDuringReplay = true;
        break;
      }
      const runtimeSnapshot = await captureRuntimeSnapshot(page);
      const expectedSnapshot = plan.snapshots[index + 1].snapshot;
      const mismatch = diffSnapshots(expectedSnapshot, runtimeSnapshot, [action.summary]);
      if (mismatch) {
        console.error("Expected step snapshot:", JSON.stringify(summarizeSnapshot(expectedSnapshot), null, 2));
        console.error("Actual step snapshot:", JSON.stringify(summarizeSnapshot(runtimeSnapshot), null, 2));
        throw new Error(`Live/runtime mismatch after ${action.summary}: ${mismatch}`);
      }
      lastSuccessfulAction = index;
      if (stepDelayMs > 0) await page.waitForTimeout(stepDelayMs);
    }

    console.log(`Live verification passed.`);
    console.log(`Replay confidence: ${JSON.stringify(summarizeReplayConfidence(plan, candidate, lastSuccessfulAction, reachedGoalDuringReplay))}`);
    if (candidate) console.log(`Candidate found in ${candidate.expansions} expansions.`);
    else console.log(`Candidate search used fallback decision list.`);
    if (candidate && candidate.diagnostics) {
      console.log(`Search diagnostics: ${JSON.stringify(candidate.diagnostics)}`);
    }
    console.log(`Goal: ${goal}${toFloor ? ` -> ${toFloor}` : ""}`);
    console.log(`Final replay state: floor=${plan.finalState.floorId}, hp=${plan.finalState.hero.hp}, atk=${plan.finalState.hero.atk}, def=${plan.finalState.hero.def}, mdef=${plan.finalState.hero.mdef}`);
    console.log(`Decisions (${plan.decisions.length}):`);
    plan.decisions.forEach((step) => console.log(`  ${step}`));
    if (keepOpen) {
      console.log("Browser is kept open for inspection. Press Ctrl+C in this terminal when done.");
      await new Promise(() => {});
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
