"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { loadRegionSpec } = require("./lib/region-spec");
const {
  SUPPORTED_GOAL_TYPES,
  buildStartCheckpoint,
  validateRegionEntryContract,
} = require("./lib/region-entry-validator");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRYPOINT = "shared-solver/run-region-dp.js";
const CONTRACT_SCHEMA = "motapathfinder.pr-4.8a1-structured-entry-validation.v1";
const DEFAULT_OUT = path.join(__dirname, "routes", "generated", "agenda-policy-evaluation", "pr-4.8a1-structured-entry-validation.json");
const DEFAULT_OUT_MD = path.join(__dirname, "routes", "generated", "agenda-policy-evaluation", "pr-4.8a1-structured-entry-validation.md");

const CONTROLS = [
  {
    id: "onlyup-region-1",
    specFile: path.join(REPO_ROOT, "towers", "onlyup", "region-specs", "region-1.json"),
    projectRoot: path.join(REPO_ROOT, "Only upV2.1", "Only upV2.1"),
    outFile: path.join(__dirname, "routes", "generated", "region-entry-contract", "onlyup-region-1.route.json"),
    probe: {
      maxExpansions: 1,
      maxRuntimeMs: 100,
    },
  },
  {
    id: "onlyup-region-2",
    specFile: path.join(REPO_ROOT, "towers", "onlyup", "region-specs", "region-2.json"),
    projectRoot: path.join(REPO_ROOT, "Only upV2.1", "Only upV2.1"),
    outFile: path.join(__dirname, "routes", "generated", "region-entry-contract", "onlyup-region-2.route.json"),
    probe: {
      maxExpansions: 1,
      maxRuntimeMs: 100,
      prefixMaxExpansions: 1,
      prefixMaxRuntimeMs: 100,
    },
  },
  {
    id: "whiteisland-trial-smoke",
    specFile: path.join(REPO_ROOT, "towers", "whiteisland", "trial-specs", "trial-smoke.json"),
    projectRoot: path.join(REPO_ROOT, "whiteisland（9）"),
    outFile: path.join(__dirname, "routes", "generated", "region-entry-contract", "whiteisland-trial-smoke.route.json"),
    probe: {
      maxExpansions: 1,
      maxRuntimeMs: 100,
    },
  },
];

const CONTROL_EXPECTATIONS = {
  "onlyup-region-1": {
    effectiveMilestoneCount: 18,
    preflight: { exitCode: 0, summaryParsed: true, valid: true },
    probe: {
      exitCode: 0,
      summaryParsed: true,
      status: "not-found",
      termination: "expansion-budget-exhausted",
      failureClass: "target-action-unreachable",
      failedSegmentId: "mt1-gate-1559",
      usedExpansions: 1,
      routeWritten: false,
    },
  },
  "onlyup-region-2": {
    effectiveMilestoneCount: 12,
    preflight: { exitCode: 0, summaryParsed: true, valid: true },
    probe: {
      exitCode: 1,
      summaryParsed: false,
      status: "not-found",
      termination: "prefix-budget-exhausted",
      failureClass: "prefix-budget-exhausted",
      stage: "prefix-milestone",
      failedSegmentId: "mt1-gate-1559",
      usedExpansions: 1,
      routeWritten: false,
    },
  },
  "whiteisland-trial-smoke": {
    effectiveMilestoneCount: 1,
    preflight: { exitCode: 0, summaryParsed: true, valid: true },
    probe: {
      exitCode: 0,
      summaryParsed: true,
      status: "not-found",
      termination: "expansion-budget-exhausted",
      failureClass: "hp-deficit",
      failedSegmentId: "whiteisland-trial-smoke-goal",
      usedExpansions: 1,
      routeWritten: false,
    },
  },
};

const NEGATIVE_CONTROLS = [
  { id: "dangling-startFrom", expectedError: "dangling-startFrom" },
  { id: "duplicate-milestone-id", expectedError: "duplicate-milestone-id" },
  { id: "unknown-floor", expectedError: "unknown-floor" },
  { id: "unsupported-goal", expectedError: "unsupported-goal-type" },
  { id: "invalid-budget", expectedError: "invalid-dp-budget" },
  { id: "cyclic-dependency", expectedError: "cyclic-milestone-dependency" },
];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashJson(value) {
  return sha256(stableStringify(value));
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
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

function projectIdentity(project, projectRoot) {
  const floorSummary = Object.entries((project && project.floorsById) || {}).map(([id, floor]) => ({
    id,
    width: Number(floor.width || 0),
    height: Number(floor.height || 0),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const title = project && project.data && project.data.firstData
    ? project.data.firstData.title || null
    : null;
  const floorOrder = Array.isArray(project && project.floorOrder) ? project.floorOrder.slice() : [];
  const structuralFingerprintSha256 = hashJson({ title, floorOrder, floorSummary });
  const contentFingerprintSha256 = hashJson({
    data: project && project.data || {},
    floorOrder,
    floorsById: project && project.floorsById || {},
    enemysById: project && project.enemysById || {},
    itemsById: project && project.itemsById || {},
    mapTilesByNumber: project && project.mapTilesByNumber || {},
  });
  return {
    root: relativePath(projectRoot),
    title,
    floorCount: floorSummary.length,
    floorOrder,
    structuralFingerprintSha256,
    fingerprintSha256: contentFingerprintSha256,
    fingerprintInputs: ["data", "floorOrder", "floorsById", "enemysById", "itemsById", "mapTilesByNumber"],
  };
}

function specIdentity(spec, specFile) {
  const hashable = cloneJson(spec);
  delete hashable.sourceFile;
  return {
    id: spec.id,
    tower: spec.tower,
    label: spec.label || null,
    sourceFile: relativePath(specFile),
    sourceSha256: hashFile(specFile),
    normalizedSha256: hashJson(hashable),
  };
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

function compactSummary(summary) {
  if (!summary) return null;
  const segments = Array.isArray(summary.segments) ? summary.segments : [];
  const failureClasses = [];
  segments.forEach((segment) => {
    const primary = segment.failurePropagation && segment.failurePropagation.primaryFailureClass;
    if (primary && !failureClasses.includes(primary)) failureClasses.push(primary);
  });
  return {
    kind: summary.kind || null,
    regionId: summary.regionId || null,
    found: Boolean(summary.found),
    proofLevel: summary.proofClaim && summary.proofClaim.proofLevel || null,
    completeWithinActionSet: Boolean(summary.proofClaim && summary.proofClaim.completeWithinActionSet),
    actionTrimmed: Number(summary.proofClaim && summary.proofClaim.actionTrimmed || 0),
    expansionBudgetExhausted: Boolean(summary.proofClaim && summary.proofClaim.expansionBudgetExhausted),
    stoppedReasons: (summary.proofClaim && summary.proofClaim.stoppedReasons || []).slice(),
    failedSegmentId: summary.failedSegmentId || null,
    reachedMilestone: summary.reachedMilestone || null,
    metrics: {
      expansions: Number(summary.metrics && summary.metrics.expansions || 0),
      routeLength: Number(summary.metrics && summary.metrics.routeLength || 0),
      illegalWrites: Number(summary.metrics && summary.metrics.illegalWrites || 0),
      final: summary.metrics && summary.metrics.final ? {
        floorId: summary.metrics.final.floorId || null,
        hp: Number(summary.metrics.final.hp || 0),
        atk: Number(summary.metrics.final.atk || 0),
        def: Number(summary.metrics.final.def || 0),
        mdef: Number(summary.metrics.final.mdef || 0),
        exp: Number(summary.metrics.final.exp || 0),
      } : null,
    },
    segmentIds: segments.map((segment) => segment.segmentId),
    failureClasses,
  };
}

function compactPreflightSummary(summary) {
  if (!summary) return null;
  return {
    kind: summary.kind || null,
    schema: summary.schema || null,
    valid: summary.valid === true,
    regionId: summary.regionId || null,
    projectRoot: summary.projectRoot || null,
    regionSpec: summary.regionSpec || null,
    outputPath: summary.outputPath || null,
    startCheckpoint: summary.startCheckpoint || null,
    milestoneOrder: Array.isArray(summary.milestoneOrder) ? summary.milestoneOrder.slice() : [],
    boundary: summary.boundary || null,
    checks: summary.checks || null,
    errorCodes: (summary.errors || []).map((error) => error.code),
  };
}

function structuredErrorEvidence(text) {
  const parsed = parseFirstJsonObject(text);
  if (!parsed || parsed.kind !== "region-dp-error") return null;
  return {
    kind: parsed.kind,
    schema: parsed.schema || null,
    regionId: parsed.regionId || null,
    stage: parsed.stage || "runner",
    termination: parsed.termination || "runner-error",
    failureClass: parsed.failureClass || "runner-error",
    primaryFailureClass: parsed.primaryFailureClass || null,
    failedSegmentId: parsed.failedSegmentId || null,
    usedExpansions: parsed.usedExpansions == null ? null : Number(parsed.usedExpansions),
    configuredMaxExpansions: parsed.configuredMaxExpansions == null ? null : Number(parsed.configuredMaxExpansions),
    configuredMaxRuntimeMs: parsed.configuredMaxRuntimeMs == null ? null : Number(parsed.configuredMaxRuntimeMs),
    errorType: parsed.errorType || "Error",
    message: parsed.message || null,
  };
}

function removeGeneratedOutput(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function spawnRunner(args) {
  return childProcess.spawnSync(process.execPath, args, {
    cwd: __dirname,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
}

function preflightArgs(control) {
  return [
    "run-region-dp.js",
    `--project-root=${solverRelativePath(control.projectRoot)}`,
    `--region-spec=${solverRelativePath(control.specFile)}`,
    `--out=${solverRelativePath(control.outFile)}`,
    "--validate-only=1",
    "--structured-errors=1",
  ];
}

function runPreflight(control) {
  removeGeneratedOutput(control.outFile);
  const args = preflightArgs(control);
  const result = spawnRunner(args);
  const summary = parseFirstJsonObject(result.stdout);
  const errorEvidence = structuredErrorEvidence(result.stderr);
  return {
    invoked: true,
    mode: "validate-only",
    command: ["node", ...args],
    exitCode: result.status == null ? null : result.status,
    signal: result.signal || null,
    errorCode: result.error && result.error.code ? result.error.code : null,
    summaryParsed: Boolean(summary),
    summary: compactPreflightSummary(summary),
    errorEvidence,
    outputPathExistsAfter: fs.existsSync(control.outFile),
  };
}

function probeArgs(control) {
  const args = [
    "run-region-dp.js",
    `--project-root=${solverRelativePath(control.projectRoot)}`,
    `--region-spec=${solverRelativePath(control.specFile)}`,
    `--out=${solverRelativePath(control.outFile)}`,
    `--max-expansions=${control.probe.maxExpansions}`,
    `--max-runtime-ms=${control.probe.maxRuntimeMs}`,
    "--print-failures=0",
    "--structured-errors=1",
  ];
  if (control.probe.prefixMaxExpansions != null) args.push(`--prefix-max-expansions=${control.probe.prefixMaxExpansions}`);
  if (control.probe.prefixMaxRuntimeMs != null) args.push(`--prefix-max-runtime-ms=${control.probe.prefixMaxRuntimeMs}`);
  return args;
}

function runProbe(control) {
  removeGeneratedOutput(control.outFile);
  const args = probeArgs(control);
  const result = spawnRunner(args);
  const summary = parseFirstJsonObject(result.stdout);
  const errorEvidence = structuredErrorEvidence(result.stderr);
  const errorCode = result.error && result.error.code ? result.error.code : null;
  return {
    invoked: true,
    mode: "bounded-entry-probe",
    command: ["node", ...args],
    exitCode: result.status == null ? null : result.status,
    signal: result.signal || null,
    errorCode,
    summaryParsed: Boolean(summary),
    summary: compactSummary(summary),
    stderrCaptured: String(result.stderr || "").trim().length > 0,
    stderrParsed: Boolean(errorEvidence),
    errorEvidence,
    outputPathExistsAfter: fs.existsSync(control.outFile),
  };
}

function executionFromProbe(spec, control, probe) {
  const summary = probe.summary;
  const errorEvidence = probe.errorEvidence;
  if (!summary && errorEvidence && errorEvidence.stage === "prefix-milestone") {
    return {
      status: "not-found",
      found: false,
      stage: errorEvidence.stage,
      startCheckpoint: buildStartCheckpoint(spec),
      reachedMilestone: null,
      failedSegmentId: errorEvidence.failedSegmentId,
      termination: errorEvidence.termination,
      failureClass: errorEvidence.failureClass,
      primaryFailureClass: errorEvidence.primaryFailureClass,
      routePrimitiveCount: 0,
      budgetUsage: {
        configuredProbe: {
          maxExpansions: control.probe.maxExpansions,
          maxRuntimeMs: control.probe.maxRuntimeMs,
          prefixMaxExpansions: control.probe.prefixMaxExpansions || null,
          prefixMaxRuntimeMs: control.probe.prefixMaxRuntimeMs || null,
        },
        usedExpansions: errorEvidence.usedExpansions,
        expansionBudgetExhausted: errorEvidence.termination === "prefix-budget-exhausted",
      },
      failureEvidence: errorEvidence,
    };
  }
  const failureClass = summary && summary.failureClasses.length > 0
    ? summary.failureClasses[0]
    : (summary ? null : (errorEvidence && errorEvidence.failureClass || "runner-error"));
  let termination = "runner-error";
  if (summary) {
    if (summary.found) termination = "reached-target";
    else if (summary.expansionBudgetExhausted) termination = "expansion-budget-exhausted";
    else if (summary.failedSegmentId) termination = "segment-failed";
    else termination = "not-found";
  }
  return {
    status: summary ? (summary.found ? "found" : "not-found") : "runner-error",
    found: Boolean(summary && summary.found),
    stage: summary ? "region-dp" : (errorEvidence && errorEvidence.stage || "runner"),
    startCheckpoint: buildStartCheckpoint(spec),
    reachedMilestone: summary && summary.reachedMilestone || null,
    failedSegmentId: summary && summary.failedSegmentId || errorEvidence && errorEvidence.failedSegmentId || null,
    termination,
    failureClass,
    routePrimitiveCount: summary ? summary.metrics.routeLength : 0,
    budgetUsage: {
      configuredProbe: {
        maxExpansions: control.probe.maxExpansions,
        maxRuntimeMs: control.probe.maxRuntimeMs,
        prefixMaxExpansions: control.probe.prefixMaxExpansions || null,
        prefixMaxRuntimeMs: control.probe.prefixMaxRuntimeMs || null,
      },
      usedExpansions: summary ? summary.metrics.expansions : errorEvidence && errorEvidence.usedExpansions,
      expansionBudgetExhausted: summary ? summary.expansionBudgetExhausted : null,
    },
    failureEvidence: errorEvidence,
  };
}

function outputProvenance(control, probe) {
  const routeWritten = Boolean(probe.summary && probe.summary.found && probe.outputPathExistsAfter);
  const routeFile = routeWritten ? relativePath(control.outFile) : null;
  return {
    entrypoint: ENTRYPOINT,
    projectRoot: relativePath(control.projectRoot),
    regionSpec: relativePath(control.specFile),
    requestedOutput: relativePath(control.outFile),
    routeWritten,
    routeFile,
    outputPathExistsAfterProbe: probe.outputPathExistsAfter,
    liveVerified: false,
    probeMode: probe.mode,
    command: probe.command,
  };
}

function baseNegativeSpec(sourceSpec) {
  const spec = cloneJson(sourceSpec);
  delete spec.milestoneRoute;
  delete spec.fromMilestoneId;
  delete spec.toMilestoneId;
  spec.id = "pr-4.8a-negative";
  spec.label = "PR-4.8a1 negative control";
  spec.start = { type: "initial", floorId: "MT1" };
  spec.scope = { floors: ["MT1"] };
  spec.actionPolicy = {
    actionKinds: ["battle"],
    allowedFloors: ["MT1"],
  };
  spec.search = {
    algorithm: "segment-dp",
    dpKeyMode: "region",
    candidateLimit: 1,
    stopOnFirstGoal: false,
    dpBudget: {
      maxExpansions: 1,
      maxRuntimeMs: 100,
    },
  };
  spec.segments = [{
    id: "negative-a",
    label: "negative A",
    goal: {
      type: "heroAtLeast",
      floorId: "MT1",
      minHero: { hp: 1 },
    },
    actionPolicy: {
      actionKinds: ["battle"],
      allowedFloors: ["MT1"],
    },
    dp: {
      maxExpansions: 1,
      maxRuntimeMs: 100,
    },
  }];
  spec.sourceFile = sourceSpec.sourceFile;
  return spec;
}

function makeNegativeSpec(sourceSpec, id) {
  const spec = baseNegativeSpec(sourceSpec);
  if (id === "dangling-startFrom") {
    spec.segments[0].startFrom = "missing-segment";
  } else if (id === "duplicate-milestone-id") {
    spec.segments.push({ ...cloneJson(spec.segments[0]), startFrom: null });
  } else if (id === "unknown-floor") {
    spec.scope.floors = ["NO_SUCH_FLOOR"];
    spec.actionPolicy.allowedFloors = ["NO_SUCH_FLOOR"];
    spec.segments[0].actionPolicy.allowedFloors = ["NO_SUCH_FLOOR"];
    spec.segments[0].goal.floorId = "NO_SUCH_FLOOR";
  } else if (id === "unsupported-goal") {
    spec.segments[0].goal.type = "unsupportedGoal";
  } else if (id === "invalid-budget") {
    spec.search.dpBudget.maxExpansions = 0;
    spec.search.dpBudget.maxRuntimeMs = -1;
    spec.segments[0].dp.maxExpansions = 0;
    spec.segments[0].dp.maxRuntimeMs = -1;
  } else if (id === "cyclic-dependency") {
    spec.segments = [
      { ...cloneJson(spec.segments[0]), id: "negative-a", startFrom: "negative-b" },
      { ...cloneJson(spec.segments[0]), id: "negative-b", startFrom: "negative-a" },
    ];
  }
  spec.id = `pr-4.8a1-negative-${id}`;
  return spec;
}

function buildControl(control) {
  const spec = loadRegionSpec(control.specFile);
  const project = loadProject(control.projectRoot);
  const paths = {
    specFile: control.specFile,
    projectRoot: control.projectRoot,
    outFile: control.outFile,
  };
  const validation = validateRegionEntryContract(spec, project, paths);
  const preflight = runPreflight(control);
  const probe = runProbe(control);
  return {
    id: control.id,
    specIdentity: specIdentity(spec, control.specFile),
    projectIdentity: projectIdentity(project, control.projectRoot),
    milestoneOrder: validation.effectiveMilestones.map((milestone) => milestone.id),
    startCheckpoint: buildStartCheckpoint(spec),
    entryValidation: {
      valid: validation.valid,
      errors: validation.errors,
      boundary: validation.boundary,
    },
    preflight,
    execution: executionFromProbe(spec, control, probe),
    outputProvenance: outputProvenance(control, probe),
    runnerProbe: probe,
  };
}

function buildNegativeControl(sourceSpec, negative) {
  const inputDir = path.join(__dirname, "routes", "generated", "region-entry-contract", "negative-inputs");
  const outputDir = path.join(__dirname, "routes", "generated", "region-entry-contract", "negative-outputs");
  const specFile = path.join(inputDir, `${negative.id}.json`);
  const outFile = path.join(outputDir, `${negative.id}.route.json`);
  const spec = makeNegativeSpec(sourceSpec, negative.id);
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  removeGeneratedOutput(specFile);
  removeGeneratedOutput(outFile);
  fs.writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);
  const inputSha256 = hashFile(specFile);
  const args = [
    "run-region-dp.js",
    `--project-root=${solverRelativePath(CONTROLS[0].projectRoot)}`,
    `--region-spec=${solverRelativePath(specFile)}`,
    `--out=${solverRelativePath(outFile)}`,
    "--validate-only=1",
    "--structured-errors=1",
  ];
  const result = spawnRunner(args);
  const summary = parseFirstJsonObject(result.stdout);
  const errorEvidence = structuredErrorEvidence(result.stderr);
  const outputPathExistsAfter = fs.existsSync(outFile);
  const observedErrors = summary && Array.isArray(summary.errors)
    ? summary.errors.map((entry) => entry.code)
    : [];
  const specNormalizedSha256 = hashJson({ ...spec, sourceFile: null });
  removeGeneratedOutput(specFile);
  removeGeneratedOutput(outFile);
  return {
    id: negative.id,
    expectedError: negative.expectedError,
    inputPath: relativePath(specFile),
    inputSha256,
    specNormalizedSha256,
    observedErrors,
    rejected: result.status !== 0 && Boolean(summary && summary.valid === false) && observedErrors.includes(negative.expectedError),
    cli: {
      command: ["node", ...args],
      exitCode: result.status == null ? null : result.status,
      signal: result.signal || null,
      errorCode: result.error && result.error.code ? result.error.code : null,
      summaryParsed: Boolean(summary),
      summary: compactPreflightSummary(summary),
      errorEvidence,
      outputPath: relativePath(outFile),
      routeOutputExistsAfter: outputPathExistsAfter,
    },
  };
}

function buildNegativeControls(sourceSpec) {
  return NEGATIVE_CONTROLS.map((negative) => {
    return buildNegativeControl(sourceSpec, negative);
  });
}

function buildReport() {
  const sourceControl = CONTROLS[0];
  const sourceSpec = loadRegionSpec(sourceControl.specFile);
  const controls = CONTROLS.map(buildControl);
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "shadow-only",
      entrypoint: ENTRYPOINT,
      runner: "shared-solver/run-region-dp.js",
      runnerProbeMode: "validate-only-preflight-and-bounded-entry-probe",
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
      id: "PR-4.8a1",
      title: "Structured RegionSpec Entry Validation",
      unifiedEntry: {
        command: "node shared-solver/run-region-dp.js --project-root=<project-root> --region-spec=<region-spec> --out=<output>",
        requiredPaths: ["project-root", "region-spec", "out"],
      },
      requiredReportFields: [
        "specIdentity",
        "projectIdentity",
        "milestoneOrder",
        "startCheckpoint",
        "preflight",
        "reachedMilestone",
        "termination",
        "failureClass",
        "routePrimitiveCount",
        "budgetUsage",
        "outputProvenance",
      ],
      fixedControls: CONTROLS.map((control) => control.id),
      fixedExpectedControlOutcomes: CONTROL_EXPECTATIONS,
      negativeControls: NEGATIVE_CONTROLS.map((control) => control.id),
      supportedGoalTypes: [...SUPPORTED_GOAL_TYPES],
      deterministicLiveRebuild: true,
    },
    controls,
    negativeControls: buildNegativeControls(sourceSpec),
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
    "# PR-4.8a1 Structured RegionSpec Entry Validation",
    "",
    `Schema: \`${report.schema}\``,
    "Status: completed",
    "Mode: shadow-only",
    "",
    "## Unified entry",
    "",
    "All fixed controls are invoked through `shared-solver/run-region-dp.js` with explicit project-root, region-spec, and output paths. The live probes are intentionally bounded and are evidence that the contract can enter the runner; they are not route-completeness claims.",
    "",
    "## Fixed controls",
    "",
    "| Control | Spec | Milestones | Preflight | Entry validation | Probe status | Termination | Failure class | Route primitives |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | ---: |",
  ];
  report.controls.forEach((control) => {
    lines.push(`| ${control.id} | ${control.specIdentity.sourceFile} | ${control.milestoneOrder.length} | exit=${control.preflight.exitCode}, parsed=${control.preflight.summaryParsed} | ${control.entryValidation.valid ? "passed" : "failed"} | ${control.execution.status} | ${control.execution.termination} | ${control.execution.failureClass || "none"} | ${control.execution.routePrimitiveCount} |`);
  });
  lines.push(
    "",
    "Each control records the normalized spec hash, project fingerprint, ordered milestone IDs, start checkpoint, reached milestone, termination/failure class, route primitive count, bounded probe budget usage, and output provenance.",
    "",
    "## Negative controls",
    "",
    "| Negative control | Expected rejection | CLI exit | Observed | Route output | Result |",
    "| --- | --- | ---: | --- | --- | --- |",
  );
  report.negativeControls.forEach((control) => {
    lines.push(`| ${control.id} | ${control.expectedError} | ${control.cli.exitCode} | ${control.observedErrors.join(", ")} | ${control.cli.routeOutputExistsAfter ? "written" : "none"} | ${control.rejected ? "passed" : "failed"} |`);
  });
  lines.push(
    "",
    "The negative set covers dangling startFrom, duplicate milestone IDs, unknown floors, unsupported goals, invalid finite-positive DP budgets, and cyclic dependencies.",
    "",
    "## Scope boundary",
    "",
    "This audit does not modify the production DP key, dominance, agenda, capacity, default strategy, or solver semantics. It does not claim a complete OnlyUp or WhiteIsland route.",
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
  process.stdout.write(`region entry contract wrote ${out} (${report.controls.length} controls, ${report.negativeControls.length} negative controls)\n`);
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
  SUPPORTED_GOAL_TYPES,
  buildReport,
  markdownReport,
  validateRegionEntryContract,
};
