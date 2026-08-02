"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { executeActionList } = require("./lib/events");
const { loadProject } = require("./lib/project-loader");
const {
  SUPPORTED_ACTION_KINDS,
  buildProjectFingerprint,
  buildRegionSpecIdentity,
  buildStartCheckpoint,
  validateRegionEntryContract,
} = require("./lib/region-entry-validator");
const { loadRegionSpec } = require("./lib/region-spec");
const {
  readRouteFile,
  resolveRecordedAction,
} = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");
const { StaticSimulator } = require("./lib/simulator");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRYPOINT = "shared-solver/run-region-dp.js";
const CONTRACT_SCHEMA = "motapathfinder.pr-4.8b1-runner-owned-output-cleanup.v1";
const DEFAULT_OUT = path.join(__dirname, "routes", "generated", "agenda-policy-evaluation", "pr-4.8b1-runner-owned-output-cleanup.json");
const DEFAULT_OUT_MD = path.join(__dirname, "routes", "generated", "agenda-policy-evaluation", "pr-4.8b1-runner-owned-output-cleanup.md");

const CONTROLS = [
  {
    id: "onlyup-region-output-contract-smoke",
    specFile: path.join(REPO_ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json"),
    projectRoot: path.join(REPO_ROOT, "Only upV2.1", "Only upV2.1"),
    outFile: path.join(__dirname, "routes", "generated", "region-route-output-contract", "onlyup-smoke.route.json"),
    probe: { maxExpansions: 1000, maxRuntimeMs: 10000 },
  },
  {
    id: "whiteisland-trial-output-contract-smoke",
    specFile: path.join(REPO_ROOT, "towers", "whiteisland", "trial-specs", "trial-output-contract-smoke.json"),
    projectRoot: path.join(REPO_ROOT, "whiteisland（9）"),
    outFile: path.join(__dirname, "routes", "generated", "region-route-output-contract", "whiteisland-smoke.route.json"),
    probe: { maxExpansions: 1000, maxRuntimeMs: 10000 },
  },
];

const NEGATIVE_CONTROLS = [
  {
    id: "whiteisland-trial-output-contract-not-found",
    specFile: path.join(REPO_ROOT, "towers", "whiteisland", "trial-specs", "trial-smoke.json"),
    projectRoot: path.join(REPO_ROOT, "whiteisland（9）"),
    outFile: path.join(__dirname, "routes", "generated", "region-route-output-contract", "whiteisland-not-found.route.json"),
    probe: { maxExpansions: 1, maxRuntimeMs: 100 },
    expectedStatus: "not-found",
    expectedRunnerExitCode: 0,
  },
  {
    id: "onlyup-region-output-contract-prefix-failure",
    specFile: path.join(REPO_ROOT, "towers", "onlyup", "region-specs", "region-2.json"),
    projectRoot: path.join(REPO_ROOT, "Only upV2.1", "Only upV2.1"),
    outFile: path.join(__dirname, "routes", "generated", "region-route-output-contract", "onlyup-prefix-failure.route.json"),
    probe: {
      maxExpansions: 1,
      maxRuntimeMs: 100,
      prefixMaxExpansions: 1,
      prefixMaxRuntimeMs: 100,
    },
    expectedStatus: "structured-failure",
    expectedRunnerExitCode: 1,
    expectedError: {
      stage: "prefix-milestone",
      termination: "prefix-budget-exhausted",
      failureClass: "prefix-budget-exhausted",
      failedSegmentId: "mt1-gate-1559",
    },
  },
];

const CONTROL_EXPECTATIONS = {
  "onlyup-region-output-contract-smoke": {
    exitCode: 0,
    found: true,
    reachedMilestone: "onlyup-region-output-contract-smoke-goal",
    primitiveDecisionCount: 2,
    final: {
      floorId: "MT1",
      hero: {
        hp: 201,
        hpmax: 9999,
        mana: 0,
        manamax: -1,
        atk: 3,
        def: 0,
        mdef: 10,
        money: 0,
        exp: 2,
        lv: 1,
        loc: { x: 2, y: 7, direction: "down" },
        equipment: [],
      },
    },
  },
  "whiteisland-trial-output-contract-smoke": {
    exitCode: 0,
    found: true,
    reachedMilestone: "whiteisland-trial-output-contract-smoke-goal",
    primitiveDecisionCount: 2,
    final: {
      floorId: "A1",
      hero: {
        hp: 160,
        hpmax: 9999,
        mana: 0,
        manamax: -1,
        atk: 1,
        def: 1,
        mdef: 0,
        money: 0,
        exp: 1,
        lv: 1,
        loc: { x: 6, y: 10, direction: "up" },
        equipment: [],
      },
    },
  },
};

const MACRO_KINDS = new Set(["resourcePocket", "resourceCluster", "resourceChain", "fightToLevelUp"]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function generationCommit() {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    return null;
  }
}

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/") || ".";
}

function solverRelativePath(filePath) {
  return path.relative(__dirname, filePath).replace(/\\/g, "/") || ".";
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === true || value === "1" || value === "true" || value === "on") return true;
  if (value === false || value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

function parseFirstJsonObject(text) {
  const source = String(text || "");
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1));
          } catch (error) {
            break;
          }
        }
      }
    }
  }
  return null;
}

function structuredErrorEvidence(text) {
  const parsed = parseFirstJsonObject(text);
  if (!parsed || parsed.kind !== "region-dp-error") return null;
  return {
    schema: parsed.schema || null,
    stage: parsed.stage || "runner",
    termination: parsed.termination || "runner-error",
    failureClass: parsed.failureClass || "runner-error",
    failedSegmentId: parsed.failedSegmentId || null,
    message: parsed.message || null,
  };
}

function compactSummary(summary) {
  if (!summary) return null;
  const final = summary.metrics && summary.metrics.final;
  return {
    kind: summary.kind || null,
    regionId: summary.regionId || null,
    found: Boolean(summary.found),
    reachedMilestone: summary.reachedMilestone || null,
    proofClaim: summary.proofClaim ? {
      proofLevel: summary.proofClaim.proofLevel || null,
      completeWithinActionSet: Boolean(summary.proofClaim.completeWithinActionSet),
      actionTrimmed: Number(summary.proofClaim.actionTrimmed || 0),
      expansionBudgetExhausted: Boolean(summary.proofClaim.expansionBudgetExhausted),
      stoppedReasons: (summary.proofClaim.stoppedReasons || []).slice(),
    } : null,
    metrics: {
      expansions: Number(summary.metrics && summary.metrics.expansions || 0),
      routeLength: Number(summary.metrics && summary.metrics.routeLength || 0),
      final: final ? {
        floorId: final.floorId || null,
        hp: Number(final.hp || 0),
        atk: Number(final.atk || 0),
        def: Number(final.def || 0),
        mdef: Number(final.mdef || 0),
        exp: Number(final.exp || 0),
      } : null,
    },
  };
}

function compactPreflight(summary) {
  if (!summary) return null;
  return {
    schema: summary.schema || null,
    valid: summary.valid === true,
    regionId: summary.regionId || null,
    milestoneOrder: Array.isArray(summary.milestoneOrder) ? summary.milestoneOrder.slice() : [],
    checks: summary.checks || null,
    errors: (summary.errors || []).map((error) => error.code),
  };
}

function removeOutput(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function spawnRunner(args) {
  return childProcess.spawnSync(process.execPath, args, {
    cwd: __dirname,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
}

function runnerArgs(control, extra) {
  return [
    "run-region-dp.js",
    `--project-root=${solverRelativePath(control.projectRoot)}`,
    `--region-spec=${solverRelativePath(control.specFile)}`,
    `--out=${solverRelativePath(control.outFile)}`,
    ...(extra || []),
  ];
}

function runPreflight(control) {
  removeOutput(control.outFile);
  const args = runnerArgs(control, ["--validate-only=1", "--structured-errors=1"]);
  const result = spawnRunner(args);
  const summary = parseFirstJsonObject(result.stdout);
  return {
    command: ["node", ...args],
    exitCode: result.status == null ? null : result.status,
    signal: result.signal || null,
    errorCode: result.error && result.error.code ? result.error.code : null,
    summaryParsed: Boolean(summary),
    summary: compactPreflight(summary),
    errorEvidence: structuredErrorEvidence(result.stderr),
    outputPathExistsAfter: fs.existsSync(control.outFile),
  };
}

function runValidateOnlyPreservation(control) {
  removeOutput(control.outFile);
  fs.mkdirSync(path.dirname(control.outFile), { recursive: true });
  const sentinel = "pr-4.8b1-validate-only-sentinel";
  fs.writeFileSync(control.outFile, `${JSON.stringify({ schema: "motapathfinder.route.v1", sentinel }, null, 2)}\n`);
  const staleRouteExistedBeforeRunner = fs.existsSync(control.outFile);
  const args = runnerArgs(control, ["--validate-only=1", "--structured-errors=1"]);
  const result = spawnRunner(args);
  const outputPathExistsAfterRunner = fs.existsSync(control.outFile);
  const preservedContent = outputPathExistsAfterRunner && fs.readFileSync(control.outFile, "utf8").includes(sentinel);
  const runnerDeletedOutput = staleRouteExistedBeforeRunner && !outputPathExistsAfterRunner;
  removeOutput(control.outFile);
  return {
    command: ["node", ...args],
    exitCode: result.status == null ? null : result.status,
    summaryParsed: Boolean(parseFirstJsonObject(result.stdout)),
    staleRouteExistedBeforeRunner,
    harnessRemovedOutput: false,
    runnerDeletedOutput,
    routePreserved: Boolean(staleRouteExistedBeforeRunner && preservedContent),
    outputPathExistsAfterRunner,
    errorEvidence: structuredErrorEvidence(result.stderr),
  };
}

function runProbe(control) {
  const staleRouteExistedBeforeRunner = fs.existsSync(control.outFile);
  const harnessRemovedOutput = false;
  const args = runnerArgs(control, [
    `--max-expansions=${control.probe.maxExpansions}`,
    `--max-runtime-ms=${control.probe.maxRuntimeMs}`,
    "--stop-on-first-goal=0",
    "--print-failures=0",
    "--structured-errors=1",
  ]);
  if (control.probe.prefixMaxExpansions != null) args.push(`--prefix-max-expansions=${control.probe.prefixMaxExpansions}`);
  if (control.probe.prefixMaxRuntimeMs != null) args.push(`--prefix-max-runtime-ms=${control.probe.prefixMaxRuntimeMs}`);
  const result = spawnRunner(args);
  const summary = parseFirstJsonObject(result.stdout);
  const outputPathExistsAfter = fs.existsSync(control.outFile);
  let routeReadError = null;
  if (outputPathExistsAfter) {
    try {
      readRouteFile(control.outFile);
    } catch (error) {
      routeReadError = error.message;
    }
  }
  const runnerOwnedCleanup = staleRouteExistedBeforeRunner && !harnessRemovedOutput && !outputPathExistsAfter;
  return {
    command: ["node", ...args],
    exitCode: result.status == null ? null : result.status,
    signal: result.signal || null,
    errorCode: result.error && result.error.code ? result.error.code : null,
    summaryParsed: Boolean(summary),
    summary: compactSummary(summary),
    errorEvidence: structuredErrorEvidence(result.stderr),
    staleRouteExistedBeforeRunner,
    harnessRemovedOutput,
    runnerOwnedCleanup,
    outputPathExistsAfter,
    routeReadError,
  };
}

function buildSimulator(project, spec) {
  const simulatorConfig = spec.simulator || {};
  return new StaticSimulator(project, {
    stopFloorId: simulatorConfig.stopFloorId || null,
    battleResolver: new FunctionBackedBattleResolver(project, {
      autoLevelUp: simulatorConfig.autoLevelUp !== false,
    }),
    autoPickupEnabled: parseBoolean(simulatorConfig.autoPickupEnabled, true),
    autoBattleEnabled: parseBoolean(simulatorConfig.autoBattleEnabled, true),
    enableFightToLevelUp: parseBoolean(simulatorConfig.enableFightToLevelUp, false),
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: simulatorConfig.searchGraphMode || "primitive",
  });
}

function buildReplayStartState(project, simulator, spec) {
  let state = simulator.createInitialState({ rank: spec.rank || "chaos" });
  if ((spec.start || {}).type === "whiteislandTrial") {
    const choices = (((project.floorsById.Start || {}).events || {})["3,3"] || [])[0] || {};
    const trialChoice = (choices.choices || []).find((choice) => choice.text === "试炼间");
    requireCondition(trialChoice, `${spec.id}: missing Whiteisland trial choice`);
    executeActionList(project, state, trialChoice.action || [], { floorId: "Start" }, { choiceResolver: simulator.choiceResolver });
    state = simulator.stabilizeState(state);
  }
  return state;
}

function heroSummary(state) {
  const hero = (state && state.hero) || {};
  const loc = hero.loc || {};
  return {
    floorId: state && state.floorId || null,
    hero: {
      hp: Number(hero.hp || 0),
      hpmax: Number(hero.hpmax || 0),
      mana: Number(hero.mana || 0),
      manamax: Number(hero.manamax || 0),
      atk: Number(hero.atk || 0),
      def: Number(hero.def || 0),
      mdef: Number(hero.mdef || 0),
      money: Number(hero.money || 0),
      exp: Number(hero.exp || 0),
      lv: Number(hero.lv || 0),
      loc: {
        x: Number(loc.x || 0),
        y: Number(loc.y || 0),
        direction: loc.direction || null,
      },
      equipment: Array.isArray(hero.equipment) ? cloneJson(hero.equipment) : [],
    },
  };
}

function replayRoute(project, spec, record) {
  const simulator = buildSimulator(project, spec);
  let state = buildReplayStartState(project, simulator, spec);
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  const reparsed = [];
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index];
    requireCondition(SUPPORTED_ACTION_KINDS.has(decision.kind), `${spec.id}: unsupported persisted action kind at ${index + 1}: ${decision.kind}`);
    requireCondition(!MACRO_KINDS.has(decision.kind), `${spec.id}: macro action persisted at ${index + 1}: ${decision.kind}`);
    requireCondition(!Array.isArray(decision.plan) && !Array.isArray(decision.planEntries), `${spec.id}: macro plan persisted at ${index + 1}`);
    if (decision.preExactStateKey) {
      requireCondition(buildStateKey(state) === decision.preExactStateKey, `${spec.id}: replay pre-state mismatch at ${index + 1}`);
    }
    const resolved = resolveRecordedAction(simulator, state, decision, { project });
    requireCondition(resolved && resolved.action, `${spec.id}: decision ${index + 1} did not reparse (${resolved && resolved.reason})`);
    reparsed.push({
      index: index + 1,
      kind: decision.kind,
      summary: decision.summary,
      matchType: resolved.matchType,
      candidates: resolved.candidates,
    });
    state = simulator.applyAction(state, resolved.action);
    if (decision.postExactStateKey) {
      requireCondition(buildStateKey(state) === decision.postExactStateKey, `${spec.id}: replay post-state mismatch at ${index + 1}`);
    }
  }
  const finalExactStateMatches = buildStateKey(state) === record.final.exactStateKey;
  requireCondition(finalExactStateMatches, `${spec.id}: replay final exact state differs from route final`);
  const metadataFinal = record.metadata && record.metadata.regionDp && record.metadata.regionDp.final;
  const finalSummaryMatches = JSON.stringify(heroSummary(state)) === JSON.stringify(metadataFinal);
  requireCondition(finalSummaryMatches, `${spec.id}: replay final summary differs from route metadata`);
  return {
    everyDecisionReparsed: reparsed.length === decisions.length,
    reparsedDecisionCount: reparsed.length,
    persistedMacroActionCount: 0,
    decisions: reparsed,
    finalExactStateMatches,
    finalSummaryMatches,
    final: heroSummary(state),
  };
}

function routeMetadataContract(control, spec, project, record, summary) {
  const regionDp = record.metadata && record.metadata.regionDp;
  const expectedSpecIdentity = buildRegionSpecIdentity(spec, control.specFile);
  const expectedProjectFingerprint = buildProjectFingerprint(project);
  requireCondition(regionDp && typeof regionDp === "object", `${control.id}: route metadata.regionDp missing`);
  requireCondition(regionDp.regionId === spec.id, `${control.id}: route metadata region ID mismatch`);
  requireCondition(regionDp.regionSpecIdentity && regionDp.regionSpecIdentity.id === expectedSpecIdentity.id, `${control.id}: route metadata spec identity missing`);
  requireCondition(regionDp.regionSpecIdentity.sourceSha256 === expectedSpecIdentity.sourceSha256, `${control.id}: route metadata source hash mismatch`);
  requireCondition(regionDp.regionSpecIdentity.normalizedSha256 === expectedSpecIdentity.normalizedSha256, `${control.id}: route metadata normalized hash mismatch`);
  requireCondition(regionDp.projectFingerprint && regionDp.projectFingerprint.fingerprintSha256 === expectedProjectFingerprint.fingerprintSha256, `${control.id}: route metadata project fingerprint mismatch`);
  requireCondition(regionDp.projectFingerprint.structuralFingerprintSha256 === expectedProjectFingerprint.structuralFingerprintSha256, `${control.id}: route metadata structural fingerprint mismatch`);
  requireCondition(regionDp.reachedMilestone === summary.reachedMilestone, `${control.id}: route metadata reached milestone mismatch`);
  requireCondition(regionDp.primitiveDecisionCount === record.decisions.length, `${control.id}: route metadata primitive count mismatch`);
  requireCondition(JSON.stringify(regionDp.final) === JSON.stringify(heroSummary({
    floorId: record.final.floorId,
    hero: record.final.snapshot.hero,
  })), `${control.id}: route metadata final summary mismatch`);
  return {
    regionSpecId: regionDp.regionId,
    regionSpecIdentity: cloneJson(regionDp.regionSpecIdentity),
    projectFingerprint: cloneJson(regionDp.projectFingerprint),
    reachedMilestone: regionDp.reachedMilestone,
    primitiveDecisionCount: Number(regionDp.primitiveDecisionCount),
    final: cloneJson(regionDp.final),
  };
}

function controlIdentity(spec, project, control) {
  return {
    specIdentity: {
      ...buildRegionSpecIdentity(spec, control.specFile),
      sourceFile: relativePath(control.specFile),
    },
    projectIdentity: {
      ...buildProjectFingerprint(project),
      root: relativePath(control.projectRoot),
    },
  };
}

function buildPositiveControl(control) {
  const spec = loadRegionSpec(control.specFile);
  const project = loadProject(control.projectRoot);
  const validation = validateRegionEntryContract(spec, project, {
    specFile: control.specFile,
    projectRoot: control.projectRoot,
    outFile: control.outFile,
  });
  requireCondition(validation.valid, `${control.id}: entry validation failed: ${validation.errors.map((error) => error.code).join(",")}`);
  const preflight = runPreflight(control);
  requireCondition(preflight.exitCode === 0 && preflight.summaryParsed && preflight.summary.valid, `${control.id}: preflight failed`);
  const probe = runProbe(control);
  requireCondition(probe.exitCode === 0 && probe.summaryParsed && probe.summary.found, `${control.id}: positive runner did not find route`);
  requireCondition(probe.outputPathExistsAfter && !probe.routeReadError, `${control.id}: positive route was not readable`);
  const record = readRouteFile(control.outFile);
  const metadata = routeMetadataContract(control, spec, project, record, probe.summary);
  const replay = replayRoute(project, spec, record);
  return {
    id: control.id,
    ...controlIdentity(spec, project, control),
    milestoneOrder: validation.effectiveMilestones.map((milestone) => milestone.id),
    startCheckpoint: buildStartCheckpoint(spec),
    entryValidation: {
      valid: validation.valid,
      errors: validation.errors,
      boundary: validation.boundary,
    },
    preflight,
    execution: {
      status: "found",
      found: true,
      reachedMilestone: probe.summary.reachedMilestone,
      routePrimitiveCount: record.decisions.length,
      final: metadata.final,
    },
    routeOutput: {
      schema: record.schema,
      file: relativePath(control.outFile),
      metadata,
      routePrimitiveCount: record.decisions.length,
      reachedMilestone: probe.summary.reachedMilestone,
      final: metadata.final,
    },
    replay,
    runnerProbe: probe,
    outputProvenance: {
      entrypoint: ENTRYPOINT,
      projectRoot: relativePath(control.projectRoot),
      regionSpec: relativePath(control.specFile),
      requestedOutput: relativePath(control.outFile),
      routeWritten: true,
      outputPathExistsAfterRun: probe.outputPathExistsAfter,
      liveVerified: false,
      command: probe.command,
    },
  };
}

function buildNegativeControl(control) {
  const spec = loadRegionSpec(control.specFile);
  const project = loadProject(control.projectRoot);
  const validation = validateRegionEntryContract(spec, project, {
    specFile: control.specFile,
    projectRoot: control.projectRoot,
    outFile: control.outFile,
  });
  requireCondition(validation.valid, `${control.id}: negative source spec must validate`);
  const preflight = runPreflight(control);
  requireCondition(preflight.exitCode === 0 && preflight.summaryParsed && preflight.summary.valid, `${control.id}: negative preflight failed`);
  fs.mkdirSync(path.dirname(control.outFile), { recursive: true });
  fs.writeFileSync(control.outFile, `${JSON.stringify({ schema: "motapathfinder.route.v1", stale: true }, null, 2)}\n`);
  const probe = runProbe(control);
  const found = Boolean(probe.summary && probe.summary.found);
  const routeOutputExistsAfterRun = probe.outputPathExistsAfter;
  if (routeOutputExistsAfterRun) removeOutput(control.outFile);
  requireCondition(probe.staleRouteExistedBeforeRunner, `${control.id}: stale route was not present before runner`);
  requireCondition(probe.harnessRemovedOutput === false, `${control.id}: harness removed output before runner`);
  requireCondition(probe.runnerOwnedCleanup === true, `${control.id}: runner did not own stale output cleanup`);
  requireCondition(!routeOutputExistsAfterRun, `${control.id}: runner left route output`);
  if (control.expectedStatus === "not-found") {
    requireCondition(probe.exitCode === control.expectedRunnerExitCode && probe.summaryParsed && !found, `${control.id}: not-found control unexpectedly found or errored`);
    requireCondition(probe.errorEvidence === null, `${control.id}: unexpected structured error for not-found control`);
  } else {
    requireCondition(probe.exitCode === control.expectedRunnerExitCode && !probe.summaryParsed && !found, `${control.id}: structured failure control did not fail as expected`);
    requireCondition(probe.errorEvidence, `${control.id}: structured failure evidence missing`);
    Object.entries(control.expectedError || {}).forEach(([key, value]) => {
      requireCondition(probe.errorEvidence[key] === value, `${control.id}: structured error ${key} mismatch`);
    });
  }
  const evidence = probe.errorEvidence || {};
  const summary = probe.summary || {};
  return {
    id: control.id,
    ...controlIdentity(spec, project, control),
    expectedStatus: control.expectedStatus,
    expectedRunnerExitCode: control.expectedRunnerExitCode,
    expectedError: control.expectedError || null,
    entryValidation: {
      valid: validation.valid,
      errors: validation.errors,
    },
    preflight,
    execution: {
      status: control.expectedStatus,
      found,
      reachedMilestone: summary.reachedMilestone || null,
      routePrimitiveCount: 0,
      termination: summary.proofClaim && summary.proofClaim.expansionBudgetExhausted
        ? "expansion-budget-exhausted"
        : evidence.termination || "not-found",
      failureClass: evidence.failureClass || null,
      failedSegmentId: evidence.failedSegmentId || null,
    },
    staleRouteExistedBeforeRunner: probe.staleRouteExistedBeforeRunner,
    harnessRemovedOutput: probe.harnessRemovedOutput,
    runnerOwnedCleanup: probe.runnerOwnedCleanup,
    routeOutputExistsAfterRun,
    runnerProbe: probe,
    outputProvenance: {
      entrypoint: ENTRYPOINT,
      projectRoot: relativePath(control.projectRoot),
      regionSpec: relativePath(control.specFile),
      requestedOutput: relativePath(control.outFile),
      routeWritten: false,
      outputPathExistsAfterRun: routeOutputExistsAfterRun,
      liveVerified: false,
      command: probe.command,
    },
  };
}

function buildReport() {
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "shadow-only",
      entrypoint: ENTRYPOINT,
      runner: "shared-solver/run-region-dp.js",
      runnerProbeMode: "runner-owned-output-cleanup-with-real-short-routes-and-structured-failure",
      deterministicFullReportRebuild: true,
      generationCommit: generationCommit(),
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      describesCompleteTowerRoute: false,
    },
    contract: {
      id: "PR-4.8b1",
      title: "Runner-owned Output Cleanup",
      unifiedEntry: {
        command: "node shared-solver/run-region-dp.js --project-root=<project-root> --region-spec=<region-spec> --out=<output>",
        requiredPaths: ["project-root", "region-spec", "out"],
      },
      requiredReportFields: [
        "routeOutput.metadata.regionSpecIdentity",
        "routeOutput.metadata.projectFingerprint",
        "routeOutput.reachedMilestone",
        "routeOutput.routePrimitiveCount",
        "routeOutput.final",
        "replay.everyDecisionReparsed",
        "replay.finalExactStateMatches",
        "replay.finalSummaryMatches",
        "validateOnlyPreservation.routePreserved",
        "negativeControls.staleRouteExistedBeforeRunner",
        "negativeControls.harnessRemovedOutput",
        "negativeControls.runnerOwnedCleanup",
        "negativeControls.routeOutputExistsAfterRun",
      ],
      fixedControls: CONTROLS.map((control) => control.id),
      fixedExpectedControlOutcomes: CONTROL_EXPECTATIONS,
      negativeControls: NEGATIVE_CONTROLS.map((control) => control.id),
      deterministicLiveRebuild: true,
    },
    validateOnlyPreservation: runValidateOnlyPreservation(CONTROLS[0]),
    controls: CONTROLS.map(buildPositiveControl),
    negativeControls: NEGATIVE_CONTROLS.map(buildNegativeControl),
    scope: {
      shadowOnly: true,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      describesCompleteTowerRoute: false,
    },
  };
}

function markdownReport(report) {
  const lines = [
    "# PR-4.8b1 Runner-owned Output Cleanup",
    "",
    `Schema: \`${report.schema}\``,
    "Status: completed",
    "Mode: shadow-only",
    "",
    "The contract uses two real short RegionSpec positives through `run-region-dp.js`. It reads the written route, locks RegionSpec identity and project fingerprint metadata, checks the reached milestone and final summary, and reparses every persisted primitive decision. It also proves normal runner-owned stale-output cleanup, preserves pre-existing output in validate-only mode, and exercises a structured prefix failure. It is not a full MT1-MT5 or full Whiteisland route claim.",
    "",
    "## Positive controls",
    "",
    "| Control | Project | Reached milestone | Primitive decisions | Final floor | Final HP | Final ATK | Replay |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | --- |",
  ];
  report.controls.forEach((control) => {
    const final = control.routeOutput.final;
    lines.push(`| ${control.id} | ${control.projectIdentity.title} | ${control.routeOutput.reachedMilestone} | ${control.routeOutput.routePrimitiveCount} | ${final.floorId} | ${final.hero.hp} | ${final.hero.atk} | ${control.replay.everyDecisionReparsed && control.replay.finalExactStateMatches && control.replay.finalSummaryMatches ? "passed" : "failed"} |`);
  });
  lines.push(
    "",
    "Each positive route was written by the real runner and then parsed with the route-store schema. Macro kinds and macro plan fields are rejected from persisted decisions.",
    "",
    "## Negative controls",
    "",
    "| Control | Expected | Stale before runner | Harness removed | Runner cleanup | Route after run | Result |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  report.negativeControls.forEach((control) => {
    lines.push(`| ${control.id} | ${control.expectedStatus} | ${control.staleRouteExistedBeforeRunner} | ${control.harnessRemovedOutput} | ${control.runnerOwnedCleanup} | ${control.routeOutputExistsAfterRun} | ${control.execution.status === control.expectedStatus && control.runnerOwnedCleanup && !control.routeOutputExistsAfterRun ? "passed" : "failed"} |`);
  });
  lines.push(
    "",
    `Validate-only preservation: ${report.validateOnlyPreservation.routePreserved ? "passed" : "failed"} (pre-existing output remains and is not deleted by the runner).`,
    "",
    "## Scope boundary",
    "",
    "This round does not modify the production DP key, dominance, agenda, capacity, default strategy, or search order. The positives are short cross-tower output/replay controls only; they do not establish complete tower routes.",
    "",
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) options[match[1]] = match[2];
  });
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const out = options.out ? path.resolve(__dirname, options.out) : DEFAULT_OUT;
  const outMd = options["out-md"] ? path.resolve(__dirname, options["out-md"]) : DEFAULT_OUT_MD;
  const report = buildReport();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outMd, markdownReport(report));
  process.stdout.write(`runner-owned output cleanup contract wrote ${out} (${report.controls.length} positive controls, ${report.negativeControls.length} negative controls)\n`);
  return report;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  CONTRACT_SCHEMA,
  CONTROLS,
  CONTROL_EXPECTATIONS,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  NEGATIVE_CONTROLS,
  buildReport,
  markdownReport,
};
