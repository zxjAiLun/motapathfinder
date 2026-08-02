"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { buildRegionMilestoneSpec, loadRegionSpec } = require("./lib/region-spec");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRYPOINT = "shared-solver/run-region-dp.js";
const CONTRACT_SCHEMA = "motapathfinder.pr-4.8a-region-entry-contract.v1";
const DEFAULT_OUT = path.join(__dirname, "routes", "generated", "agenda-policy-evaluation", "pr-4.8a-region-entry-contract.json");
const DEFAULT_OUT_MD = path.join(__dirname, "routes", "generated", "agenda-policy-evaluation", "pr-4.8a-region-entry-contract.md");

const SUPPORTED_GOAL_TYPES = new Set(["heroAtLeast", "bossDefeated", "tileRemoved"]);
const SUPPORTED_ACTION_KINDS = new Set([
  "battle",
  "pickup",
  "interactPickup",
  "equip",
  "openDoor",
  "useTool",
  "changeFloor",
  "floorFly",
  "event",
]);

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

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/") || ".";
}

function solverRelativePath(filePath) {
  return path.relative(__dirname, filePath).replace(/\\/g, "/") || ".";
}

function pathIsParseable(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  const parsed = path.parse(filePath);
  return Boolean(parsed.root && parsed.dir != null && parsed.base);
}

function addError(errors, code, detail) {
  if (errors.some((entry) => entry.code === code)) return;
  errors.push({ code, detail });
}

function extractGoalEntries(milestoneSpec) {
  return (milestoneSpec && Array.isArray(milestoneSpec.milestones))
    ? milestoneSpec.milestones.map((milestone) => ({
      id: milestone.id,
      goal: milestone.goal || {},
      dp: milestone.dp || {},
      actionPolicy: milestone.actionPolicy || {},
      startFrom: milestone.startFrom || null,
    }))
    : [];
}

function checkMilestoneGraph(milestoneSpec, errors) {
  const milestones = extractGoalEntries(milestoneSpec);
  const ids = new Set();
  milestones.forEach((milestone) => {
    if (ids.has(milestone.id)) addError(errors, "duplicate-milestone-id", `duplicate milestone id: ${milestone.id}`);
    ids.add(milestone.id);
  });

  const edges = new Map();
  milestones.forEach((milestone) => {
    if (milestone.startFrom && !ids.has(milestone.startFrom)) {
      addError(errors, "dangling-startFrom", `${milestone.id} starts from missing milestone ${milestone.startFrom}`);
    }
    edges.set(milestone.id, milestone.startFrom || null);
  });

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      addError(errors, "cyclic-milestone-dependency", `cycle reaches ${id}`);
      return;
    }
    visiting.add(id);
    const parent = edges.get(id);
    if (parent) visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  ids.forEach(visit);
}

function checkGoalTypes(milestoneSpec, errors) {
  extractGoalEntries(milestoneSpec).forEach((milestone) => {
    const type = milestone.goal && milestone.goal.type;
    if (!SUPPORTED_GOAL_TYPES.has(type)) {
      addError(errors, "unsupported-goal-type", `${milestone.id} uses unsupported goal type ${type || "<missing>"}`);
    }
  });
}

function checkMilestoneActionPolicies(milestoneSpec, scopeFloors, floors, errors) {
  extractGoalEntries(milestoneSpec).forEach((milestone) => {
    const policy = milestone.actionPolicy || {};
    if (policy.actionKinds != null && (!Array.isArray(policy.actionKinds) || policy.actionKinds.length === 0)) {
      addError(errors, "invalid-action-scope", `${milestone.id} actionKinds must be non-empty`);
    }
    (policy.actionKinds || []).forEach((actionKind) => {
      if (!SUPPORTED_ACTION_KINDS.has(actionKind)) addError(errors, "unsupported-action-kind", `${milestone.id} uses unsupported action kind ${actionKind}`);
    });
    (policy.allowedFloors || []).forEach((floorId) => {
      if (!scopeFloors.includes(floorId)) addError(errors, "illegal-action-policy-floor", `${milestone.id} action policy floor ${floorId} is outside the region scope`);
      if (!floors.has(floorId)) addError(errors, "unknown-floor", `${milestone.id} action policy references unknown floor ${floorId}`);
    });
  });
}

function effectiveMilestones(milestoneSpec, spec) {
  const milestones = (milestoneSpec && milestoneSpec.milestones) || [];
  const prefix = spec && spec.start && spec.start.milestonePrefix;
  const fromId = spec && spec.fromMilestoneId || (prefix && prefix.toMilestoneId) || null;
  const toId = spec && spec.toMilestoneId || null;
  const fromIndex = fromId ? milestones.findIndex((milestone) => milestone.id === fromId) : -1;
  const toIndex = toId ? milestones.findIndex((milestone) => milestone.id === toId) : -1;
  const startIndex = fromIndex >= 0 ? fromIndex + 1 : 0;
  const endIndex = toIndex >= 0 ? toIndex : milestones.length - 1;
  if (startIndex > endIndex) return [];
  return milestones.slice(startIndex, endIndex + 1);
}

function effectiveActionScopeFloors(milestoneSpec, spec, scopeFloors) {
  const result = scopeFloors.slice();
  const prefix = spec && spec.start && spec.start.milestonePrefix;
  const fromId = spec && spec.fromMilestoneId || (prefix && prefix.toMilestoneId) || null;
  if (!fromId) return result;
  const boundary = ((milestoneSpec && milestoneSpec.milestones) || []).find((milestone) => milestone.id === fromId);
  const boundaryFloors = boundary && boundary.actionPolicy && boundary.actionPolicy.allowedFloors;
  (boundaryFloors || []).forEach((floorId) => {
    if (!result.includes(floorId)) result.push(floorId);
  });
  return result;
}

function checkPositiveBudget(budget, label, errors) {
  if (!budget || typeof budget !== "object") {
    addError(errors, "invalid-dp-budget", `${label} budget is missing`);
    return;
  }
  ["maxExpansions", "maxRuntimeMs"].forEach((field) => {
    const value = Number(budget[field]);
    if (!Number.isFinite(value) || value <= 0) {
      addError(errors, "invalid-dp-budget", `${label}.${field} must be finite and positive`);
    }
  });
}

function projectFloorIds(project) {
  return new Set(Object.keys((project && project.floorsById) || {}));
}

function validateEntryContract(spec, project, paths) {
  const errors = [];
  if (!spec || typeof spec !== "object") {
    addError(errors, "invalid-region-spec", "RegionSpec must be an object");
    return { valid: false, errors };
  }

  if (!pathIsParseable(paths.specFile)) addError(errors, "unparseable-input-path", "region spec path is not parseable");
  if (!pathIsParseable(paths.projectRoot)) addError(errors, "unparseable-input-path", "project root path is not parseable");
  if (!pathIsParseable(paths.outFile)) addError(errors, "unparseable-output-path", "output path is not parseable");
  if (!fs.existsSync(paths.specFile)) addError(errors, "missing-input-path", `region spec does not exist: ${paths.specFile}`);
  if (!fs.existsSync(paths.projectRoot)) addError(errors, "missing-input-path", `project root does not exist: ${paths.projectRoot}`);
  if (!fs.existsSync(path.join(__dirname, "run-region-dp.js"))) {
    addError(errors, "missing-entrypoint", ENTRYPOINT);
  }

  const floors = projectFloorIds(project);
  const scopeFloors = Array.isArray(spec.scope && spec.scope.floors) ? spec.scope.floors : [];
  scopeFloors.forEach((floorId) => {
    if (!floors.has(floorId)) addError(errors, "unknown-floor", `scope references unknown floor ${floorId}`);
  });
  const allowedFloors = Array.isArray(spec.actionPolicy && spec.actionPolicy.allowedFloors)
    ? spec.actionPolicy.allowedFloors
    : scopeFloors;
  allowedFloors.forEach((floorId) => {
    if (!scopeFloors.includes(floorId)) {
      addError(errors, "illegal-action-policy-floor", `action policy floor ${floorId} is outside the region scope`);
    }
    if (!floors.has(floorId)) addError(errors, "unknown-floor", `action policy references unknown floor ${floorId}`);
  });
  (spec.actionPolicy && spec.actionPolicy.actionKinds || []).forEach((actionKind) => {
    if (!SUPPORTED_ACTION_KINDS.has(actionKind)) {
      addError(errors, "unsupported-action-kind", `unsupported action kind ${actionKind}`);
    }
  });

  checkPositiveBudget(spec.search && spec.search.dpBudget, `${spec.id || "region"}.search.dpBudget`, errors);

  const rawMilestones = Array.isArray(spec.segments)
    ? spec.segments.map((segment, index) => ({
      id: segment && segment.id || `${spec.id || "region"}-${index + 1}`,
      goal: segment && segment.goal || {},
      dp: segment && segment.dp || {},
      actionPolicy: segment && segment.actionPolicy || {},
      startFrom: segment && segment.startFrom || null,
    }))
    : null;
  if (rawMilestones) {
    const rawMilestoneSpec = { milestones: rawMilestones };
    checkMilestoneGraph(rawMilestoneSpec, errors);
    checkGoalTypes(rawMilestoneSpec, errors);
    const activeRawMilestones = effectiveMilestones(rawMilestoneSpec, spec);
    checkMilestoneActionPolicies({ milestones: activeRawMilestones }, effectiveActionScopeFloors(rawMilestoneSpec, spec, scopeFloors), floors, errors);
    rawMilestones.forEach((milestone) => checkPositiveBudget(milestone.dp, `${milestone.id}.dp`, errors));
  }

  let milestoneSpec = null;
  try {
    milestoneSpec = buildRegionMilestoneSpec(project, spec);
  } catch (error) {
    addError(errors, "invalid-milestone-graph", error.message);
  }
  if (milestoneSpec) {
    checkMilestoneGraph(milestoneSpec, errors);
    checkGoalTypes(milestoneSpec, errors);
    const activeMilestoneEntries = effectiveMilestones(milestoneSpec, spec);
    checkMilestoneActionPolicies({ milestones: activeMilestoneEntries }, effectiveActionScopeFloors(milestoneSpec, spec, scopeFloors), floors, errors);
    activeMilestoneEntries.forEach((milestone) => {
      checkPositiveBudget(milestone.dp, `${milestone.id}.dp`, errors);
      const goalFloor = milestone.goal && milestone.goal.floorId;
      if (goalFloor && !floors.has(goalFloor)) addError(errors, "unknown-floor", `${milestone.id} goal references unknown floor ${goalFloor}`);
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    milestoneSpec,
  };
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
  return {
    root: relativePath(projectRoot),
    title,
    floorCount: floorSummary.length,
    floorOrder,
    fingerprintSha256: hashJson({ title, floorOrder, floorSummary }),
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

function startCheckpoint(spec) {
  const start = spec.start || {};
  const prefix = start.milestonePrefix || null;
  return {
    type: start.type || (prefix ? "milestonePrefix" : "initial"),
    floorId: start.floorId || null,
    routeFile: start.routeFile || null,
    routeName: prefix && prefix.routeName || null,
    fromMilestoneId: prefix && prefix.fromMilestoneId || null,
    toMilestoneId: prefix && prefix.toMilestoneId || null,
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

function probeArgs(control) {
  const args = [
    "run-region-dp.js",
    `--project-root=${solverRelativePath(control.projectRoot)}`,
    `--region-spec=${solverRelativePath(control.specFile)}`,
    `--out=${solverRelativePath(control.outFile)}`,
    `--max-expansions=${control.probe.maxExpansions}`,
    `--max-runtime-ms=${control.probe.maxRuntimeMs}`,
    "--print-failures=0",
  ];
  if (control.probe.prefixMaxExpansions != null) args.push(`--prefix-max-expansions=${control.probe.prefixMaxExpansions}`);
  if (control.probe.prefixMaxRuntimeMs != null) args.push(`--prefix-max-runtime-ms=${control.probe.prefixMaxRuntimeMs}`);
  return args;
}

function runProbe(control) {
  const args = probeArgs(control);
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: __dirname,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  const summary = parseFirstJsonObject(result.stdout);
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
  };
}

function executionFromProbe(spec, control, probe) {
  const summary = probe.summary;
  const failureClass = summary && summary.failureClasses.length > 0
    ? summary.failureClasses[0]
    : (summary ? null : "runner-error");
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
    startCheckpoint: startCheckpoint(spec),
    reachedMilestone: summary && summary.reachedMilestone || null,
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
      usedExpansions: summary ? summary.metrics.expansions : null,
      expansionBudgetExhausted: summary ? summary.expansionBudgetExhausted : null,
    },
  };
}

function outputProvenance(control, probe) {
  const routeFile = probe.summary && probe.summary.found ? relativePath(control.outFile) : null;
  return {
    entrypoint: ENTRYPOINT,
    projectRoot: relativePath(control.projectRoot),
    regionSpec: relativePath(control.specFile),
    requestedOutput: relativePath(control.outFile),
    routeWritten: Boolean(routeFile),
    routeFile,
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
  spec.label = "PR-4.8a negative control";
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
  spec.id = `pr-4.8a-negative-${id}`;
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
  const validation = validateEntryContract(spec, project, paths);
  const milestoneSpec = validation.milestoneSpec || buildRegionMilestoneSpec(project, spec);
  const probe = runProbe(control);
  return {
    id: control.id,
    specIdentity: specIdentity(spec, control.specFile),
    projectIdentity: projectIdentity(project, control.projectRoot),
    milestoneOrder: effectiveMilestones(milestoneSpec, spec).map((milestone) => milestone.id),
    startCheckpoint: startCheckpoint(spec),
    entryValidation: {
      valid: validation.valid,
      errors: validation.errors,
    },
    execution: executionFromProbe(spec, control, probe),
    outputProvenance: outputProvenance(control, probe),
    runnerProbe: probe,
  };
}

function buildNegativeControls(sourceSpec, project, sourcePaths) {
  return NEGATIVE_CONTROLS.map((negative) => {
    const spec = makeNegativeSpec(sourceSpec, negative.id);
    const validation = validateEntryContract(spec, project, sourcePaths);
    const observedErrors = validation.errors.map((entry) => entry.code);
    return {
      id: negative.id,
      expectedError: negative.expectedError,
      observedErrors,
      rejected: observedErrors.includes(negative.expectedError),
      specNormalizedSha256: hashJson({ ...spec, sourceFile: null }),
    };
  });
}

function buildReport() {
  const sourceControl = CONTROLS[0];
  const sourceSpec = loadRegionSpec(sourceControl.specFile);
  const sourceProject = loadProject(sourceControl.projectRoot);
  const controls = CONTROLS.map(buildControl);
  const negativePaths = {
    specFile: sourceControl.specFile,
    projectRoot: sourceControl.projectRoot,
    outFile: path.join(__dirname, "routes", "generated", "region-entry-contract", "negative.route.json"),
  };
  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "shadow-only",
      entrypoint: ENTRYPOINT,
      runner: "shared-solver/run-region-dp.js",
      runnerProbeMode: "bounded-entry-probe",
      deterministicFullReportRebuild: true,
      generationCommit: null,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      describesCompleteTowerRoute: false,
    },
    contract: {
      id: "PR-4.8a",
      title: "RegionSpec Entry Contract",
      unifiedEntry: {
        command: "node shared-solver/run-region-dp.js --project-root=<project-root> --region-spec=<region-spec> --out=<output>",
        requiredPaths: ["project-root", "region-spec", "out"],
      },
      requiredReportFields: [
        "specIdentity",
        "projectIdentity",
        "milestoneOrder",
        "startCheckpoint",
        "reachedMilestone",
        "termination",
        "failureClass",
        "routePrimitiveCount",
        "budgetUsage",
        "outputProvenance",
      ],
      fixedControls: CONTROLS.map((control) => control.id),
      negativeControls: NEGATIVE_CONTROLS.map((control) => control.id),
      supportedGoalTypes: [...SUPPORTED_GOAL_TYPES],
      deterministicLiveRebuild: true,
    },
    controls,
    negativeControls: buildNegativeControls(sourceSpec, sourceProject, negativePaths),
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
    "# PR-4.8a RegionSpec Entry Contract",
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
    "| Control | Spec | Milestones | Entry validation | Probe status | Termination | Failure class | Route primitives |",
    "| --- | --- | ---: | --- | --- | --- | --- | ---: |",
  ];
  report.controls.forEach((control) => {
    lines.push(`| ${control.id} | ${control.specIdentity.sourceFile} | ${control.milestoneOrder.length} | ${control.entryValidation.valid ? "passed" : "failed"} | ${control.execution.status} | ${control.execution.termination} | ${control.execution.failureClass || "none"} | ${control.execution.routePrimitiveCount} |`);
  });
  lines.push(
    "",
    "Each control records the normalized spec hash, project fingerprint, ordered milestone IDs, start checkpoint, reached milestone, termination/failure class, route primitive count, bounded probe budget usage, and output provenance.",
    "",
    "## Negative controls",
    "",
    "| Negative control | Expected rejection | Observed | Result |",
    "| --- | --- | --- | --- |",
  );
  report.negativeControls.forEach((control) => {
    lines.push(`| ${control.id} | ${control.expectedError} | ${control.observedErrors.join(", ")} | ${control.rejected ? "passed" : "failed"} |`);
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
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  NEGATIVE_CONTROLS,
  SUPPORTED_GOAL_TYPES,
  buildReport,
  markdownReport,
  validateEntryContract,
};
