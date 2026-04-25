"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const { chromium } = require("playwright-core");
const { DEFAULT_HERO_FIELDS, diffSnapshots, summarizeSnapshot } = require("./route-snapshot");

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

function parseBooleanFlag(value, defaultValue) {
  if (value == null) return defaultValue;
  if (value === true || value === "1" || value === "true" || value === "on") return true;
  if (value === false || value === "0" || value === "false" || value === "off") return false;
  return defaultValue;
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

async function waitForCondition(page, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const satisfied = await page.evaluate(predicate);
    if (satisfied) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${description}.`);
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

async function drainRuntimeActions(page, timeoutMs) {
  const startedAt = Date.now();
  const limit = timeoutMs || 30000;
  while (Date.now() - startedAt < limit) {
    const status = await page.evaluate(() => {
      if (!window.core || !core.status) return { ready: false };
      const event = core.status.event || {};
      const data = event.data || {};
      const moving = (typeof core.isMoving === "function" && core.isMoving()) || Number(core.status.heroMoving || 0) > 0;
      const replayAnimating = Boolean(((core.status.replay || {}).animate));
      const choices = event.ui && Array.isArray(event.ui.choices) ? event.ui.choices.length : 0;
      return {
        ready: true,
        eventId: event.id || null,
        eventType: data.type || null,
        noSkip: Boolean(data.current && data.current.noSkip),
        moving,
        replayAnimating,
        choices,
      };
    });
    if (!status.ready || status.moving || status.replayAnimating) {
      await page.waitForTimeout(50);
      continue;
    }
    if (!isAutoAdvanceableRuntimeEvent(status)) return;
    await page.evaluate(() => {
      const event = (core.status || {}).event || {};
      const data = event.data || {};
      if (event.id === "text") {
        core.drawText();
        return;
      }
      if (event.id === "action" && data.type === "text") {
        if (core.actions && typeof core.actions._clickAction_text === "function") {
          core.actions._clickAction_text();
        } else {
          core.doAction();
        }
        return;
      }
      if (event.id === "action" && data.type === "sleep" && data.current && !data.current.noSkip) {
        if (core.timeout && core.timeout.sleepTimeout && !core.hasAsync()) {
          clearTimeout(core.timeout.sleepTimeout);
          core.timeout.sleepTimeout = null;
        }
        core.doAction();
        return;
      }
      if (event.id === "action" && !data.type) core.doAction();
    });
    await page.waitForTimeout(status.choices > 0 ? 100 : 30);
  }
}

function isAutoAdvanceableRuntimeEvent(status) {
  if (!status) return false;
  if (status.eventId === "text") return true;
  if (status.eventId !== "action") return false;
  if (status.eventType === "text") return true;
  if (status.eventType === "sleep" && !status.noSkip) return true;
  return !status.eventType && status.choices === 0;
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

function shouldUseRuntimeAutoBattle(config) {
  const value = (config || {})["runtime-auto-battle"] != null
    ? (config || {})["runtime-auto-battle"]
    : (config || {}).runtimeAutoBattle;
  if (value != null) return parseBooleanFlag(value, false);
  return projectSupportsRuntimeAutoBattle((config || {}).projectRoot);
}

function projectSupportsRuntimeAutoBattle(projectRoot) {
  if (!projectRoot) return false;
  const itemsPath = path.join(projectRoot, "project", "items.js");
  try {
    const text = fs.readFileSync(itemsPath, "utf8");
    return /flag:autoBattle|autoBattle/.test(text) && /自动清怪|自动战斗/.test(text);
  } catch (error) {
    return false;
  }
}

function normalizeReplayOptions(options) {
  const config = Object.assign({}, options || {});
  config.runtimeAutoBattle = shouldUseRuntimeAutoBattle(config);
  return config;
}

function normalizeSnapshotForRuntime(snapshot, config) {
  if (!snapshot || shouldUseRuntimeAutoBattle(config)) return snapshot;
  const normalized = JSON.parse(JSON.stringify(snapshot));
  if (normalized.flags) delete normalized.flags.autoBattle;
  return normalized;
}

async function quickStartRuntime(page, rank, options) {
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
  await configureRuntimeAutomation(page, options);
  await waitForRuntimeIdle(page);
}

async function configureRuntimeAutomation(page, options) {
  const runtimeAutoBattle = shouldUseRuntimeAutoBattle(options);
  await page.evaluate(() => {
    if (window.core && core.status && core.plugin && typeof core.plugin.autoGetItem === "function") {
      core.plugin.autoGetItem();
    }
  });
  await drainRuntimeActions(page, 30000);
  await waitForRuntimeIdle(page, 30000);

  const pickupEnabled = await selectAutomationSwitchOption(page, 0);
  await drainRuntimeActions(page, 30000);
  await waitForRuntimeIdle(page, 30000);
  const battleEnabled = runtimeAutoBattle ? await selectAutomationSwitchOption(page, 2) : false;
  if (runtimeAutoBattle) {
    await drainRuntimeActions(page, 30000);
    await waitForRuntimeIdle(page, 30000);
  }

  await page.evaluate(({ pickupEnabled, battleEnabled, runtimeAutoBattle }) => {
    if (!pickupEnabled) core.setFlag("shiqu", 1);
    if (runtimeAutoBattle && !battleEnabled) core.setFlag("autoBattle", 1);
    if (!runtimeAutoBattle) core.setFlag("autoBattle", 0);
    if (core.updateCheckBlock) core.updateCheckBlock();
  }, { pickupEnabled, battleEnabled, runtimeAutoBattle });
}

async function restoreRuntimeSnapshotStart(page, snapshot, options) {
  if (!snapshot || !snapshot.floorId || !snapshot.hero) return;
  await page.evaluate((startSnapshot) => new Promise((resolve) => {
    const applySnapshot = () => {
      const hero = startSnapshot.hero || {};
      const fields = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];
      fields.forEach((field) => {
        if (hero[field] != null) core.status.hero[field] = hero[field];
      });
      if (hero.loc) {
        if (hero.loc.x != null) core.setHeroLoc("x", hero.loc.x, true);
        if (hero.loc.y != null) core.setHeroLoc("y", hero.loc.y, true);
        if (hero.loc.direction != null) core.setHeroLoc("direction", hero.loc.direction, true);
      }
      if (Array.isArray(hero.equipment)) core.status.hero.equipment = hero.equipment.slice();

      core.status.hero.items = core.status.hero.items || {};
      core.status.hero.items.tools = {};
      core.status.hero.items.constants = {};
      Object.entries(startSnapshot.inventory || {}).forEach(([itemId, amount]) => {
        if (amount == null || amount === 0) return;
        const item = core.material.items[itemId] || {};
        const bucket = item.cls === "constants" ? "constants" : "tools";
        core.status.hero.items[bucket][itemId] = amount;
      });

      Object.entries(startSnapshot.flags || {}).forEach(([key, value]) => {
        if (key === "autoBattle") return;
        core.setFlag(key, value);
      });

      Object.entries(startSnapshot.floors || {}).forEach(([floorId, floor]) => {
        (floor.removed || []).forEach((loc) => {
          const parts = String(loc).split(",");
          core.removeBlock(Number(parts[0]), Number(parts[1]), floorId);
        });
        (floor.replaced || []).forEach((entry) => {
          const match = String(entry).match(/^(\d+),(\d+)=(.+)$/);
          if (match) core.setBlock(match[3], Number(match[1]), Number(match[2]), floorId);
        });
      });

      if (core.updateCheckBlock) core.updateCheckBlock();
      if (core.drawMap) core.drawMap(startSnapshot.floorId);
      resolve();
    };

    if (core.status.floorId !== startSnapshot.floorId) {
      const loc = (startSnapshot.hero || {}).loc || core.status.hero.loc;
      core.changeFloor(startSnapshot.floorId, null, loc, null, applySnapshot);
    } else {
      applySnapshot();
    }
  }), snapshot);
  await page.evaluate((enableAutoBattle) => {
    core.setFlag("shiqu", 1);
    core.setFlag("autoBattle", enableAutoBattle ? 1 : 0);
    if (core.updateCheckBlock) core.updateCheckBlock();
  }, shouldUseRuntimeAutoBattle(options));
  await waitForRuntimeIdle(page);
}

async function selectAutomationSwitchOption(page, optionIndex) {
  return page.evaluate((index) => {
    if (!window.core || !core.status) return false;
    if (!core.hasItem || !core.hasItem("I600")) return false;
    core.useItem("I600", true);
    const event = (core.status || {}).event || {};
    const data = event.data || {};
    const current = data.current || {};
    if (event.id !== "action" || data.type !== "choices" || !Array.isArray(current.choices)) return false;
    const choice = current.choices[index];
    if (!choice) return false;
    if (event.interval) clearTimeout(event.interval);
    delete event.timeout;
    core.insertAction(choice.action || []);
    core.doAction();
    return true;
  }, optionIndex);
}

async function stabilizeRuntime(page, timeoutMs, options) {
  const limit = timeoutMs || 30000;
  const runtimeAutoBattle = shouldUseRuntimeAutoBattle(options);
  const startedAt = Date.now();
  for (let index = 0; index < 12 && Date.now() - startedAt < limit; index += 1) {
    const beforeSignature = await runtimeAutoSignature(page);
    await page.evaluate((enableAutoBattle) => {
      core.setFlag("shiqu", 1);
      core.setFlag("autoBattle", enableAutoBattle ? 1 : 0);
      core.updateCheckBlock();
      if (core.plugin && typeof core.plugin.autoGetItem === "function") core.plugin.autoGetItem();
      if (enableAutoBattle && core.plugin && typeof core.plugin.autoBattle === "function") core.plugin.autoBattle();
      core.updateCheckBlock();
    }, runtimeAutoBattle);
    await drainRuntimeActions(page, Math.max(1000, limit - (Date.now() - startedAt)));
    await waitForRuntimeIdle(page, Math.max(1000, limit - (Date.now() - startedAt)));
    const afterSignature = await runtimeAutoSignature(page);
    if (afterSignature === beforeSignature) return;
  }
  await waitForRuntimeIdle(page, timeoutMs);
}

async function runtimeAutoSignature(page) {
  return page.evaluate(() => {
    const blocks = Object.keys(core.getMapBlocksObj() || {}).sort().join("|");
    const hero = core.status && core.status.hero ? core.status.hero : {};
    const items = JSON.stringify((hero.items || {}));
    const flags = JSON.stringify({ shiqu: core.getFlag("shiqu", 0), autoBattle: core.getFlag("autoBattle", 0) });
    return [core.status.floorId, hero.hp, hero.atk, hero.def, hero.mdef, hero.exp, hero.lv, items, flags, blocks].join("@@");
  });
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
  const checkBlock = status.checkBlock ? `checkBlock=${JSON.stringify(status.checkBlock).slice(0, 240)}` : "checkBlock=none";
  return `floor=${status.floorId} x=${hero.x} y=${hero.y} hp=${hero.hp} atk=${hero.atk} def=${hero.def} mdef=${hero.mdef} ` +
    `moving=${status.moving} lock=${status.lockControl} ${eventParts.join(" ") || "event=none"} ${checkBlock} replay=${status.replayAnimating}`;
}

function getTargetX(action) {
  if (action.targetX != null) return action.targetX;
  return action.target && action.target.x != null ? action.target.x : null;
}

function getTargetY(action) {
  if (action.targetY != null) return action.targetY;
  return action.target && action.target.y != null ? action.target.y : null;
}

function summarizePlanAction(action) {
  if (!action) return "none";
  const parts = [action.summary || action.kind];
  const stance = action.stance || (action.stanceX != null && action.stanceY != null ? { x: action.stanceX, y: action.stanceY } : null);
  if (stance) parts.push(`from=${stance.x},${stance.y}`);
  const targetX = getTargetX(action);
  const targetY = getTargetY(action);
  if (targetX != null && targetY != null) parts.push(`to=${targetX},${targetY}`);
  if (action.direction) parts.push(`dir=${action.direction}`);
  if (action.tool) parts.push(`tool=${action.tool}`);
  if (action.equipId) parts.push(`equip=${action.equipId}`);
  return parts.join(" ");
}

async function executeRuntimeDecision(page, action, options) {
  const config = options || {};
  const label = action.summary || action.fingerprint || action.kind;
  console.log(`Executing runtime action: ${config.traceLive ? summarizePlanAction(action) : label}`);
  for (const direction of action.path || []) {
    const moved = await page.evaluate((stepDirection) => new Promise((resolve) => {
      try {
        core.moveHero(stepDirection, function () { resolve(true); });
      } catch (error) {
        resolve(false);
      }
    }), direction);
    if (!moved) throw new Error(`Failed to perform path step ${direction} for action: ${label}`);
    try {
      await drainRuntimeActions(page, config.idleTimeoutMs);
      await waitForRuntimeIdle(page, config.idleTimeoutMs);
    } catch (error) {
      const status = await describeRuntimeStatus(page);
      throw new Error(`Timed out after path step ${direction} for ${label}: ${JSON.stringify(status)}`);
    }
  }

  if (action.kind === "equip") {
    const equipResult = await page.evaluate((step) => new Promise((resolve) => {
      try {
        const equipId = step.equipId;
        if (!equipId) {
          resolve({ ok: false, reason: "missing equipId" });
          return;
        }
        const item = (core.material.items || {})[equipId] || {};
        if (!item.equip) {
          resolve({ ok: false, reason: `not an equipment item: ${equipId}` });
          return;
        }
        if (!core.canEquip(equipId, true)) {
          resolve({ ok: false, reason: `cannot equip ${equipId}` });
          return;
        }

        let equipType = step.equipType;
        if (equipType != null && equipType !== "") equipType = Number(equipType);
        else equipType = core.items.getEquipTypeById(equipId);
        if (!Number.isInteger(equipType) || equipType < 0) {
          resolve({ ok: false, reason: `cannot resolve equipType for ${equipId}` });
          return;
        }

        const slotNames = ((core.status || {}).globalAttribute || {}).equipName || [];
        const declaredType = item.equip.type;
        if (typeof declaredType === "number" && declaredType !== equipType) {
          resolve({ ok: false, reason: `equipType mismatch for ${equipId}: route=${equipType}, item=${declaredType}` });
          return;
        }
        if (typeof declaredType === "string" && slotNames[equipType] !== declaredType) {
          resolve({ ok: false, reason: `equip slot mismatch for ${equipId}: route=${equipType}/${slotNames[equipType]}, item=${declaredType}` });
          return;
        }

        const current = ((core.status || {}).hero || {}).equipment || [];
        if (current[equipType] === equipId) {
          resolve({ ok: true, noOp: true, equipType });
          return;
        }

        if (typeof core.items._realLoadEquip === "function") {
          core.items._realLoadEquip(equipType, equipId, current[equipType], function () {
            resolve({ ok: true, equipType });
          });
          return;
        }

        core.loadEquip(equipId, function () {
          const after = (((core.status || {}).hero || {}).equipment || [])[equipType];
          resolve({ ok: after === equipId, equipType, reason: after === equipId ? null : `runtime equipped ${after || "empty"} at slot ${equipType}` });
        });
      } catch (error) {
        resolve({ ok: false, reason: error.message || String(error) });
      }
    }), action);
    if (!equipResult || !equipResult.ok) {
      throw new Error(`Failed to equip for action: ${label}; ${equipResult ? equipResult.reason : "unknown error"}`);
    }
    await drainRuntimeActions(page, config.idleTimeoutMs);
    await waitForRuntimeIdle(page);
    await stabilizeRuntime(page, config.idleTimeoutMs, config);
    return;
  }

  const runtimeAction = {
    kind: action.kind,
    direction: action.direction || null,
    enemyId: action.enemyId || null,
    targetX: getTargetX(action),
    targetY: getTargetY(action),
    tool: action.tool || null,
  };

  if (runtimeAction.kind === "battle") {
    if (runtimeAction.targetX == null || runtimeAction.targetY == null) throw new Error(`Battle action missing target coordinates: ${label}`);
  } else if (runtimeAction.kind === "useTool") {
    if (!runtimeAction.tool) throw new Error(`Tool action missing tool: ${label}`);
  } else if (!runtimeAction.direction) {
    throw new Error(`Runtime driver cannot execute action: ${label}`);
  }

  const stepped = await page.evaluate((step) => new Promise((resolve) => {
    try {
      if (step.kind === "battle") {
        if (step.direction) core.setHeroLoc("direction", step.direction);
        var runtimeEnemyId = core.getBlockId(step.targetX, step.targetY) || step.enemyId || null;
        core.battle(runtimeEnemyId, step.targetX, step.targetY, false, function () { resolve(true); });
        return;
      }
      if (step.kind === "useTool") {
        if (step.direction) core.setHeroLoc("direction", step.direction);
        core.useItem(step.tool, true, function () { resolve(true); });
        return;
      }
      core.moveHero(step.direction, function () { resolve(true); });
    } catch (error) {
      resolve(false);
    }
  }), runtimeAction);
  if (!stepped) throw new Error(`Failed to perform final step for action: ${label}`);

  await drainRuntimeActions(page, config.idleTimeoutMs);

  try {
    await waitForRuntimeIdle(page, config.idleTimeoutMs);
  } catch (error) {
    const status = await describeRuntimeStatus(page);
    throw new Error(`Timed out after final step for ${label}: ${JSON.stringify(status)}`);
  }
  await stabilizeRuntime(page, config.idleTimeoutMs, config);
}

async function captureRuntimeSnapshot(page, options) {
  const config = options || {};
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
      if (!floor) {
        floors[floorId] = { removed: [], replaced: [] };
        return;
      }
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
  }, { verifyFloors: config.verifyFloors || ["MT1", "MT2", "MT3"], heroFields: config.heroFields || DEFAULT_HERO_FIELDS });
}

function routeSnapshotFloors(routeRecord, options) {
  if (options && options.snapshotFloors) {
    return String(options.snapshotFloors).split(",").map((item) => item.trim()).filter(Boolean);
  }
  return Object.keys((((routeRecord.start || {}).snapshot || {}).floors) || (((routeRecord.final || {}).snapshot || {}).floors) || { MT1: true, MT2: true, MT3: true });
}

function resolveDownloadsDir(projectRoot, config) {
  const configured = config["downloads-dir"] || config.downloadsDir;
  return path.resolve(projectRoot, configured || "replay-downloads");
}

function sanitizeDownloadName(name) {
  const safeName = String(name || "download.dat").replace(/[\\/:*?"<>|]+/g, "_");
  return safeName || "download.dat";
}

async function createRuntimePage(browser, projectRoot, config) {
  const downloadsDir = resolveDownloadsDir(projectRoot, config || {});
  fs.mkdirSync(downloadsDir, { recursive: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.exposeFunction("__solverDownload", async (filename, content) => {
    const filePath = path.join(downloadsDir, sanitizeDownloadName(filename));
    await fs.promises.writeFile(filePath, String(content == null ? "" : content), "utf8");
    console.log(`Runtime jsinterface download saved: ${filePath}`);
    return true;
  });
  await page.addInitScript(() => {
    window.jsinterface = Object.assign({}, window.jsinterface || {}, {
      download(filename, content) {
        return window.__solverDownload(filename, content);
      },
    });
  });
  page.on("download", async (download) => {
    try {
      const filePath = path.join(downloadsDir, sanitizeDownloadName(download.suggestedFilename()));
      await download.saveAs(filePath);
      console.log(`Runtime download saved: ${filePath}`);
    } catch (error) {
      console.error(`Runtime download failed: ${error.message || String(error)}`);
    }
  });
  return { context, page, downloadsDir };
}


async function launchRuntimeSession(routeRecord, options) {
  const config = normalizeReplayOptions(options);
  const projectRoot = config.projectRoot || path.resolve(__dirname, "..", "..");
  const browserPath = findBrowserExecutable(config.browser);
  if (!browserPath) throw new Error("No Chrome/Edge executable found for live verification.");

  const timeoutMs = Number(config["timeout-ms"] || config.timeoutMs || 30000);
  const headlessValue = config.headless != null ? config.headless : config["headless"];
  const visibleReplay = headlessValue === "0" || headlessValue === 0 || headlessValue === false;
  const rank = config.rank || ((routeRecord.source || {}).rank) || "chaos";
  const verifyFloors = routeSnapshotFloors(routeRecord, config);
  const startDelayMs = Number(config["start-delay-ms"] || config.startDelayMs || 0);

  const server = await createStaticServer(projectRoot);
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !visibleReplay,
  });

  try {
    const runtimePage = await createRuntimePage(browser, projectRoot, config);
    const page = runtimePage.page;
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(page);
    await quickStartRuntime(page, rank, config);
    await restoreRuntimeSnapshotStart(page, (routeRecord.start || {}).snapshot, config);
    await stabilizeRuntime(page, timeoutMs, config);
    if (startDelayMs > 0) await page.waitForTimeout(startDelayMs);
    return {
      browser,
      context: runtimePage.context,
      page,
      server,
      rank,
      verifyFloors,
      url: server.url,
      timeoutMs,
      visibleReplay,
      options: config,
      downloadsDir: runtimePage.downloadsDir,
    };
  } catch (error) {
    await Promise.allSettled([browser.close(), server.close()]);
    throw error;
  }
}

async function verifyInitialRuntimeSnapshot(session, routeRecord) {
  const actual = await captureRuntimeSnapshot(session.page, { verifyFloors: session.verifyFloors });
  const mismatch = diffSnapshots(
    normalizeSnapshotForRuntime((routeRecord.start || {}).snapshot, session.options),
    normalizeSnapshotForRuntime(actual, session.options),
    ["initial"]
  );
  return {
    ok: !mismatch,
    mismatch,
    expected: (routeRecord.start || {}).snapshot || null,
    actual,
  };
}

async function executeRouteDecision(session, decision, options) {
  const config = options || {};
  const timeoutMs = Number(config["timeout-ms"] || config.timeoutMs || config.idleTimeoutMs || session.timeoutMs || 30000);
  const traceLive = parseBooleanFlag(config["trace-live"] != null ? config["trace-live"] : config.traceLive, false);
  const stepDelayMs = Number(config["step-delay-ms"] != null ? config["step-delay-ms"] : (config.stepDelayMs != null ? config.stepDelayMs : 0));
  if (traceLive) {
    const beforeStatus = await describeRuntimeStatus(session.page);
    console.log(`[trace-live] before ${formatStatus(beforeStatus)} action=${summarizePlanAction(decision)}`);
  }
  await executeRuntimeDecision(session.page, decision, Object.assign({}, session.options || {}, config, { traceLive, idleTimeoutMs: timeoutMs }));
  if (traceLive) {
    const afterStatus = await describeRuntimeStatus(session.page);
    console.log(`[trace-live] after ${formatStatus(afterStatus)}`);
  }
  const actual = await captureRuntimeSnapshot(session.page, { verifyFloors: session.verifyFloors });
  const mismatch = diffSnapshots(
    normalizeSnapshotForRuntime(decision.postSnapshot, config),
    normalizeSnapshotForRuntime(actual, config),
    [decision.summary || decision.fingerprint || "step"]
  );
  if (stepDelayMs > 0 && !mismatch) await session.page.waitForTimeout(stepDelayMs);
  return {
    ok: !mismatch,
    mismatch,
    expected: decision.postSnapshot || null,
    actual,
  };
}

async function replayRouteFile(routeRecord, options) {
  const config = normalizeReplayOptions(options);
  const projectRoot = config.projectRoot || path.resolve(__dirname, "..", "..");
  const browserPath = findBrowserExecutable(config.browser);
  if (!browserPath) throw new Error("No Chrome/Edge executable found for live verification.");

  const timeoutMs = Number(config["timeout-ms"] || config.timeoutMs || 30000);
  const visibleReplay = (config.headless != null ? config.headless : config["headless"]) === "0";
  const stepDelayMs = Number(config["step-delay-ms"] || config.stepDelayMs || (visibleReplay ? 1400 : 0));
  const startDelayMs = Number(config["start-delay-ms"] || config.startDelayMs || 0);
  const keepOpen = parseBooleanFlag(config["keep-open"] != null ? config["keep-open"] : config.keepOpen, visibleReplay);
  const traceLive = parseBooleanFlag(config["trace-live"] != null ? config["trace-live"] : config.traceLive, false);
  const rank = config.rank || ((routeRecord.source || {}).rank) || "chaos";
  const verifyFloors = routeSnapshotFloors(routeRecord, config);
  if (parseBooleanFlag(config["trace-live"] != null ? config["trace-live"] : config.traceLive, false)) {
    console.log(`[trace-live] runtimeAutoBattle=${config.runtimeAutoBattle ? "on" : "off"}`);
  }

  const server = await createStaticServer(projectRoot);
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !visibleReplay,
  });

  try {
    const runtimePage = await createRuntimePage(browser, projectRoot, config);
    const page = runtimePage.page;
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(page);
    await quickStartRuntime(page, rank, config);
    await restoreRuntimeSnapshotStart(page, (routeRecord.start || {}).snapshot, config);
    await stabilizeRuntime(page, timeoutMs, config);
    if (startDelayMs > 0) {
      console.log(`Waiting ${startDelayMs}ms before replay actions...`);
      await page.waitForTimeout(startDelayMs);
    }

    const initialRuntimeSnapshot = await captureRuntimeSnapshot(page, { verifyFloors });
    const initialMismatch = diffSnapshots(
      normalizeSnapshotForRuntime((routeRecord.start || {}).snapshot, config),
      normalizeSnapshotForRuntime(initialRuntimeSnapshot, config),
      ["initial"]
    );
    if (initialMismatch) {
      console.error("Expected initial snapshot:", JSON.stringify(summarizeSnapshot((routeRecord.start || {}).snapshot), null, 2));
      console.error("Actual initial snapshot:", JSON.stringify(summarizeSnapshot(initialRuntimeSnapshot), null, 2));
      throw new Error(`Initial live snapshot mismatch: ${initialMismatch}`);
    }

    let lastSuccessfulAction = -1;
    const decisions = routeRecord.decisions || [];
    for (let index = 0; index < decisions.length; index += 1) {
      const action = decisions[index];
      if (traceLive) {
        const beforeStatus = await describeRuntimeStatus(page);
        console.log(`[trace-live] step=${index + 1}/${decisions.length} before ${formatStatus(beforeStatus)} action=${summarizePlanAction(action)}`);
      }
      try {
        await executeRuntimeDecision(page, action, Object.assign({}, config, { traceLive, idleTimeoutMs: timeoutMs }));
      } catch (error) {
        const actual = await describeRuntimeStatus(page).catch(() => null);
        const expected = action.postSnapshot ? summarizeSnapshot(action.postSnapshot) : null;
        throw new Error(
          `Live replay failed at step ${index + 1}/${decisions.length}; lastSuccessfulAction=${lastSuccessfulAction + 1}; ` +
            `nextAction=${summarizePlanAction(action)}; expected=${JSON.stringify(expected)}; actual=${formatStatus(actual)}; cause=${error.message}`
        );
      }
      if (traceLive) {
        const afterStatus = await describeRuntimeStatus(page);
        console.log(`[trace-live] step=${index + 1}/${decisions.length} after ${formatStatus(afterStatus)}`);
      }
      const runtimeSnapshot = await captureRuntimeSnapshot(page, { verifyFloors });
      const mismatch = diffSnapshots(
        normalizeSnapshotForRuntime(action.postSnapshot, config),
        normalizeSnapshotForRuntime(runtimeSnapshot, config),
        [action.summary || action.fingerprint || `step${index + 1}`]
      );
      if (mismatch) {
        console.error("Expected step snapshot:", JSON.stringify(summarizeSnapshot(action.postSnapshot), null, 2));
        console.error("Actual step snapshot:", JSON.stringify(summarizeSnapshot(runtimeSnapshot), null, 2));
        throw new Error(`Live/runtime mismatch after ${action.summary || action.fingerprint}: ${mismatch}`);
      }
      lastSuccessfulAction = index;
      if (stepDelayMs > 0) await page.waitForTimeout(stepDelayMs);
    }

    console.log("Live route replay passed.");
    console.log(`Verified steps: ${lastSuccessfulAction + 1}/${decisions.length}`);
    console.log(`Goal: ${((routeRecord.goal || {}).type) || "floor"}${(routeRecord.goal || {}).floorId ? ` -> ${(routeRecord.goal || {}).floorId}` : ""}`);
    const finalHero = (((routeRecord.final || {}).snapshot || {}).hero) || {};
    console.log(`Final replay state: floor=${(routeRecord.final || {}).floorId}, hp=${finalHero.hp}, atk=${finalHero.atk}, def=${finalHero.def}, mdef=${finalHero.mdef}`);
    if (keepOpen) {
      console.log("Browser is kept open for inspection. Press Ctrl+C in this terminal when done.");
      await new Promise(() => {});
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

async function replayRouteRecordLive(routeRecord, options) {
  return replayRouteFile(routeRecord, options);
}

module.exports = {
  captureRuntimeSnapshot,
  configureRuntimeAutomation,
  createStaticServer,
  describeRuntimeStatus,
  diffSnapshots,
  executeRuntimeDecision,
  findBrowserExecutable,
  isAutoAdvanceableRuntimeEvent,
  executeRouteDecision,
  launchRuntimeSession,
  projectSupportsRuntimeAutoBattle,
  quickStartRuntime,
  replayRouteFile,
  replayRouteRecordLive,
  stabilizeRuntime,
  verifyInitialRuntimeSnapshot,
  waitForRuntimeIdle,
  waitForRuntimeReady,
};
