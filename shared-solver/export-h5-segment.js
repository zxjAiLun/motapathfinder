#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const {
  buildRuntimeSnapshotIdentityPair,
  captureRuntimeSnapshot,
  createStaticServer,
  executeRouteDecision,
  findBrowserExecutable,
  launchRuntimeSession,
  prepareReplayRouteRecord,
  projectSupportsRuntimeAutoBattle,
  quickStartRuntime,
  routeSnapshotFloors,
  stabilizeRuntime,
  waitForRuntimeReady,
} = require("./lib/live-replay");
const {
  buildResumeArtifact,
  captureRuntimeSaveData,
  decodeH5SavePackage,
  encodeH5SavePackage,
  validateResumeArtifact,
} = require("./lib/replay-resume-artifact");
const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolveRouteFile(inputPath) {
  if (!inputPath) throw new Error("Missing --route-file=...");
  const candidates = [
    path.resolve(process.cwd(), inputPath),
    path.resolve(__dirname, inputPath),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Route file not found: ${inputPath}`);
  return found;
}

function loadLzString(projectRoot) {
  return require(path.join(projectRoot, "libs", "thirdparty", "lz-string.min.js"));
}

function safeName(value) {
  return String(value || "segment").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function makeFileBase(routeFile, checkpointStep) {
  const base = path.basename(routeFile, ".route.json");
  return `${base}-from-step${checkpointStep + 1}`;
}

function nativeActionsForDecision(decision) {
  const actions = Array.isArray(decision && decision.path) ? decision.path.slice() : [];
  const summary = String((decision && decision.summary) || "");
  if ((decision && decision.kind) === "equip") {
    actions.push(summary);
  } else if ((decision && decision.kind) === "interactPickup") {
    if (decision.direction) actions.push(`turn:${decision.direction}`);
    actions.push("getNext");
  } else if ((decision && decision.kind) === "floorFly") {
    if (decision.targetFloorId) actions.push(`fly:${decision.targetFloorId}`);
  } else if ((decision && decision.kind) === "useTool") {
    const tool = summary.startsWith("useTool:") ? summary.slice("useTool:".length) : null;
    if (tool) actions.push(`item:${tool}`);
  } else if ((decision && decision.direction)) {
    actions.push(decision.direction);
  }
  return actions;
}

function nativeRouteForDecisions(decisions) {
  return (decisions || []).flatMap(nativeActionsForDecision);
}

function forceSaveAutomation(saveData, options) {
  if (!saveData || !saveData.hero) return saveData;
  const config = options || {};
  saveData.hero.flags = saveData.hero.flags || {};
  if (config.runtimeAutoPickup !== false) saveData.hero.flags.shiqu = 1;
  saveData.hero.flags.autoBattle = config.runtimeAutoBattle === false ? 0 : 1;
  return saveData;
}

function stripReplayHelpers(saveData) {
  const data = JSON.parse(JSON.stringify(saveData || {}));
  delete data.__toReplay__;
  delete data.__solverReplay__;
  return data;
}

function collectVerifyFloors(saveData, decisions) {
  const floors = new Set();
  if (saveData && saveData.floorId) floors.add(saveData.floorId);
  (decisions || []).forEach((decision) => {
    if (decision.floorId) floors.add(decision.floorId);
    if (decision.target && decision.target.floorId) floors.add(decision.target.floorId);
    if (decision.preSnapshot && decision.preSnapshot.floorId) floors.add(decision.preSnapshot.floorId);
    if (decision.postSnapshot && decision.postSnapshot.floorId) floors.add(decision.postSnapshot.floorId);
  });
  return Array.from(floors).filter(Boolean);
}

async function getRuntimeRouteInfo(page) {
  return page.evaluate(() => ({
    name: core.firstData.name,
    version: core.firstData.version,
    hard: core.status.hard,
    seed: core.getFlag("__seed__"),
    floorId: core.status.floorId,
    route: core.status.route.slice(),
    hero: {
      hp: core.status.hero.hp,
      atk: core.status.hero.atk,
      def: core.status.hero.def,
      mdef: core.status.hero.mdef,
      lv: core.status.hero.lv,
      exp: core.status.hero.exp,
      loc: core.clone(core.status.hero.loc),
      equipment: core.clone(core.status.hero.equipment || []),
    },
  }));
}

async function encodeRuntimeRoute(page, route) {
  return page.evaluate((list) => core.encodeRoute(list), route);
}

async function runDecisions(runtime, decisions, startIndex, endIndex, options) {
  for (let index = startIndex; index < endIndex; index += 1) {
    const decision = decisions[index];
    await executeRouteDecision(runtime, decision, {
      timeoutMs: options.timeoutMs,
      stepDelayMs: 0,
      "trace-live": false,
    });
    if (options.progress && ((index + 1) % options.progress === 0 || index + 1 === endIndex)) {
      console.log(`Fast-forwarded ${index + 1}/${endIndex}`);
    }
  }
}

async function exportH5Segment({ routeRecord, routeFile, projectRoot, checkpointStep, outDir, timeoutMs }) {
  const runtimeRouteRecord = prepareReplayRouteRecord(routeRecord, projectRoot);
  const decisions = runtimeRouteRecord.decisions || [];
  if (checkpointStep < 0 || checkpointStep >= decisions.length) {
    throw new Error(`Invalid --checkpoint-step=${checkpointStep}; route has ${decisions.length} decisions`);
  }

  const runtime = await launchRuntimeSession(runtimeRouteRecord, {
    projectRoot,
    headless: "1",
    timeoutMs,
    stepDelayMs: 0,
    keepOpen: false,
  });

  try {
    await runDecisions(runtime, decisions, 0, checkpointStep, { timeoutMs, progress: 20 });
    const checkpointInfo = await getRuntimeRouteInfo(runtime.page);
    const checkpointRuntimeSnapshot = await captureRuntimeSnapshot(runtime.page, {
      verifyFloors: routeSnapshotFloors(runtimeRouteRecord, {}),
    });
    const checkpointSave = await captureRuntimeSaveData(runtime.page);
    const checkpointRoute = nativeRouteForDecisions(decisions.slice(0, checkpointStep));

    await runDecisions(runtime, decisions, checkpointStep, decisions.length, { timeoutMs, progress: 20 });
    const finalInfo = await getRuntimeRouteInfo(runtime.page);
    const finalRuntimeSnapshot = await captureRuntimeSnapshot(runtime.page, {
      verifyFloors: routeSnapshotFloors(runtimeRouteRecord, {}),
    });
    const suffixRoute = nativeRouteForDecisions(decisions.slice(checkpointStep));
    const fullRoute = checkpointRoute.concat(suffixRoute);
    const encodedSuffix = await encodeRuntimeRoute(runtime.page, suffixRoute);
    const encodedFull = await encodeRuntimeRoute(runtime.page, fullRoute);
    const encodedPrefix = await encodeRuntimeRoute(runtime.page, checkpointRoute);

    const runtimeAutoBattle = projectSupportsRuntimeAutoBattle(projectRoot);
    const identityOptions = {
      projectRoot,
      runtimeAutoBattle,
      routeStartSnapshot: (runtimeRouteRecord.start || {}).snapshot || null,
    };
    const boundarySnapshot = checkpointStep === 0
      ? (runtimeRouteRecord.start || {}).snapshot
      : ((decisions[checkpointStep - 1] || {}).postSnapshot);
    const boundaryIdentity = buildRuntimeSnapshotIdentityPair(
      boundarySnapshot,
      checkpointRuntimeSnapshot,
      identityOptions,
    );
    const finalIdentity = buildRuntimeSnapshotIdentityPair(
      (routeRecord.final || {}).snapshot,
      finalRuntimeSnapshot,
      identityOptions,
    );
    if (!boundaryIdentity.matches) {
      throw new Error(`H5 resume checkpoint snapshot mismatch: ${boundaryIdentity.expected} !== ${boundaryIdentity.actual}`);
    }
    if (!finalIdentity.matches) {
      throw new Error(`H5 resume final snapshot mismatch: ${finalIdentity.expected} !== ${finalIdentity.actual}`);
    }

    forceSaveAutomation(checkpointSave, { runtimeAutoBattle, runtimeAutoPickup: true });
    checkpointSave.route = encodedPrefix;
    checkpointSave.__toReplay__ = encodedSuffix;
    checkpointSave.__solverReplay__ = decisions.slice(checkpointStep);

    const lzString = loadLzString(projectRoot);
    fs.mkdirSync(outDir, { recursive: true });
    const base = makeFileBase(routeFile, checkpointStep);
    const h5saveFile = path.join(outDir, `${safeName(base)}.h5save`);
    const suffixRouteFile = path.join(outDir, `${safeName(base)}-suffix.h5route`);
    const fullRouteFile = path.join(outDir, `${safeName(base)}-full.h5route`);

    const project = loadProject(projectRoot);
    const resumeArtifact = buildResumeArtifact({
      project,
      projectRoot,
      routeRecord,
      routeFile,
      checkpointStep,
      boundarySnapshot,
      boundaryRuntimeSnapshot: checkpointRuntimeSnapshot,
      boundaryIdentity,
      finalSnapshot: (runtimeRouteRecord.final || {}).snapshot,
      finalRuntimeSnapshot,
      finalIdentity,
      nativeName: checkpointInfo.name,
      nativeVersion: checkpointInfo.version,
    });

    const savePackage = {
      name: checkpointInfo.name,
      version: checkpointInfo.version,
      data: checkpointSave,
      __solverResumeArtifact__: resumeArtifact,
    };
    fs.writeFileSync(h5saveFile, encodeH5SavePackage(projectRoot, savePackage), "utf8");

    fs.writeFileSync(suffixRouteFile, lzString.compressToBase64(JSON.stringify({
      name: checkpointInfo.name,
      version: checkpointInfo.version,
      hard: checkpointInfo.hard,
      seed: checkpointInfo.seed,
      route: encodedSuffix,
      note: `Suffix route from solver decision step ${checkpointStep + 1}; load the paired h5save or use replay-since.`,
    })), "utf8");

    fs.writeFileSync(fullRouteFile, lzString.compressToBase64(JSON.stringify({
      name: checkpointInfo.name,
      version: checkpointInfo.version,
      hard: checkpointInfo.hard,
      seed: checkpointInfo.seed,
      route: encodedFull,
    })), "utf8");

    return {
      h5saveFile,
      suffixRouteFile,
      fullRouteFile,
      checkpointStep,
      nextStep: checkpointStep + 1,
      checkpoint: checkpointInfo,
      final: finalInfo,
      routeLengths: {
        prefix: checkpointRoute.length,
        suffix: suffixRoute.length,
        full: fullRoute.length,
      },
      encodedPrefix,
      encodedSuffix,
      checkpointSave,
      suffixRoute,
      checkpointRuntimeSnapshot,
      finalRuntimeSnapshot,
      boundaryIdentity,
      finalIdentity,
      resumeArtifact,
    };
  } finally {
    await Promise.allSettled([
      runtime.browser && runtime.browser.close ? runtime.browser.close() : Promise.resolve(),
      runtime.server && runtime.server.close ? runtime.server.close() : Promise.resolve(),
    ]);
  }
}

async function openNativeReplay({ projectRoot, saveData, suffixRoute, encodedSuffixRoute, rank, timeoutMs, headless, keepOpen, autoPlay, runtimeAutoBattle, runtimeAutoPickup, postStabilize }) {
  const browserPath = findBrowserExecutable();
  if (!browserPath) throw new Error("No Chrome/Edge executable found for native replay.");
  const server = await createStaticServer(projectRoot);
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless,
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(page);
    await quickStartRuntime(page, rank || "chaos", { timeoutMs });
    forceSaveAutomation(saveData, { runtimeAutoBattle, runtimeAutoPickup });
    const solverReplay = Array.isArray(saveData.__solverReplay__) ? saveData.__solverReplay__ : null;
    const loadData = stripReplayHelpers(saveData);
    await page.evaluate(({ data, route, encodedRoute, playNative, enableAutoBattle, enableAutoPickup }) => new Promise((resolve) => {
      const list = route || (encodedRoute ? core.decodeRoute(encodedRoute) : []);
      core.loadData(data, function () {
        core.removeFlag("__fromLoad__");
        if (enableAutoPickup) core.setFlag("shiqu", 1);
        core.setFlag("autoBattle", enableAutoBattle ? 1 : 0);
        if (core.updateCheckBlock) core.updateCheckBlock();
        if (playNative && list.length > 0) {
          core.startReplay(list);
          core.resumeReplay();
        }
        resolve(true);
      });
    }), {
      data: loadData,
      route: suffixRoute || null,
      encodedRoute: encodedSuffixRoute || null,
      playNative: autoPlay && !solverReplay,
      enableAutoBattle: runtimeAutoBattle !== false,
      enableAutoPickup: runtimeAutoPickup !== false,
    });
    if (solverReplay && autoPlay) {
      console.log(`Structured solver replay: ${solverReplay.length} decisions`);
      const session = {
        browser,
        context,
        page,
        server,
        rank: rank || "chaos",
        verifyFloors: collectVerifyFloors(saveData, solverReplay),
        url: server.url,
        timeoutMs,
        visibleReplay: !headless,
        options: {
          projectRoot,
          timeoutMs,
          idleTimeoutMs: timeoutMs,
          runtimeAutoBattle: runtimeAutoBattle !== false,
          runtimeAutoPickup: runtimeAutoPickup !== false,
        },
      };
      for (let index = 0; index < solverReplay.length; index += 1) {
        await executeRouteDecision(session, solverReplay[index], {
          timeoutMs,
          idleTimeoutMs: timeoutMs,
          stepDelayMs: headless ? 0 : 120,
          "trace-live": false,
          runtimeAutoBattle: runtimeAutoBattle !== false,
          runtimeAutoPickup: runtimeAutoPickup !== false,
        });
        if ((index + 1) % 5 === 0 || index + 1 === solverReplay.length) {
          console.log(`Structured replayed ${index + 1}/${solverReplay.length}`);
        }
      }
    } else if (postStabilize) {
      await stabilizeRuntime(page, timeoutMs, {
        idleTimeoutMs: timeoutMs,
        projectRoot,
        runtimeAutoBattle: runtimeAutoBattle !== false,
      });
    } else {
      await page.waitForTimeout(Math.min(1000, timeoutMs));
    }
    const status = await getRuntimeRouteInfo(page);
    console.log(`Replay opened: floor=${status.floorId}, hp=${status.hero.hp}, atk=${status.hero.atk}, def=${status.hero.def}, mdef=${status.hero.mdef}`);
    console.log(`Runtime URL: ${server.url}`);
    if (keepOpen) {
      console.log("Browser is kept open. Press Ctrl+C in this terminal when done.");
      await new Promise(() => {});
    }
  } finally {
    if (!keepOpen) {
      await Promise.allSettled([
        browser.close(),
        new Promise((resolve) => server.close(resolve)),
      ]);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const timeoutMs = parseNumber(args["timeout-ms"], 30000);
  const play = parseBoolean(args.play, false);
  const autoPlay = parseBoolean(args["auto-play"], true);
  const headless = parseBoolean(args.headless, true);
  const keepOpen = parseBoolean(args["keep-open"], play);
  const runtimeAutoBattle = args["runtime-auto-battle"] == null
    ? (args.h5save ? projectSupportsRuntimeAutoBattle(projectRoot) : true)
    : parseBoolean(args["runtime-auto-battle"], true);
  const runtimeAutoPickup = parseBoolean(args["runtime-auto-pickup"], true);
  const postStabilize = parseBoolean(args["post-stabilize"], false);
  if (args.h5save) {
    const h5savePath = path.resolve(args.h5save);
    const decoded = decodeH5SavePackage(projectRoot, h5savePath);
    const saveData = decoded.saveData;
    if (!saveData || !saveData.__toReplay__) throw new Error(`h5save has no __toReplay__: ${h5savePath}`);
    if (decoded.artifact) {
      const project = loadProject(projectRoot);
      const routeFile = args["route-file"] ? resolveRouteFile(args["route-file"]) : null;
      const routeRecord = routeFile ? readRouteFile(routeFile) : null;
      validateResumeArtifact(decoded.artifact, { project, routeRecord });
    }
    await openNativeReplay({
      projectRoot,
      saveData,
      encodedSuffixRoute: saveData.__toReplay__,
      rank: saveData.hard || args.rank || "chaos",
      timeoutMs,
      headless,
      keepOpen,
      autoPlay,
      runtimeAutoBattle,
      runtimeAutoPickup,
      postStabilize,
    });
    return;
  }
  const routeFile = resolveRouteFile(args["route-file"]);
  const routeRecord = readRouteFile(routeFile);
  const checkpointStep = parseNumber(args["checkpoint-step"], 93);
  const outDir = path.resolve(args["out-dir"] || path.join(__dirname, "routes", "latest", "h5"));

  const exported = await exportH5Segment({
    routeRecord,
    routeFile,
    projectRoot,
    checkpointStep,
    outDir,
    timeoutMs,
  });

  console.log(JSON.stringify({
    checkpointStep: exported.checkpointStep,
    nextStep: exported.nextStep,
    checkpoint: exported.checkpoint,
    final: exported.final,
    routeLengths: exported.routeLengths,
    h5saveFile: exported.h5saveFile,
    suffixRouteFile: exported.suffixRouteFile,
    fullRouteFile: exported.fullRouteFile,
  }, null, 2));

  if (play) {
    await openNativeReplay({
      projectRoot,
      saveData: exported.checkpointSave,
      suffixRoute: exported.suffixRoute,
      rank: ((routeRecord.source || {}).rank) || args.rank || "chaos",
      timeoutMs,
      headless,
      keepOpen,
      autoPlay,
      runtimeAutoBattle,
      runtimeAutoPickup,
      postStabilize,
    });
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (error && error.code) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error(error.stack || error.message);
    }
    process.exit(1);
  });
}

module.exports = {
  exportH5Segment,
  main,
  openNativeReplay,
};
