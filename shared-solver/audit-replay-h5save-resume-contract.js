"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  FIXED_INPUTS,
  ensureFixedRoute,
} = require("./audit-replay-start-offset-contract");
const {
  buildRuntimeSnapshotIdentityPair,
  projectSupportsRuntimeAutoBattle,
} = require("./lib/live-replay");
const { loadProject } = require("./lib/project-loader");
const {
  RESUME_ARTIFACT_SCHEMA,
  buildResumeArtifact,
  cloneJson,
  summarizeResumeDecision,
  validateResumeArtifact,
} = require("./lib/replay-resume-artifact");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_SCHEMA = "motapathfinder.pr-5.1b-h5save-resume.v1";
const DEFAULT_OUT = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1b-h5save-resume-contract.json",
);
const DEFAULT_OUT_MD = path.join(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-5.1b-h5save-resume-contract.md",
);

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/") || ".";
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

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function captureErrorCode(callback) {
  try {
    callback();
    return null;
  } catch (error) {
    return error && error.code || null;
  }
}

function buildReport() {
  const input = ensureFixedRoute(FIXED_INPUTS.find((candidate) => candidate.tower === "whiteisland"));
  const project = loadProject(input.projectRoot);
  const routeRecord = input.routeRecord;
  const checkpointStep = 1;
  const boundaryRouteSnapshot = routeRecord.decisions[checkpointStep - 1].postSnapshot;
  const finalRouteSnapshot = routeRecord.final.snapshot;
  const identityOptions = {
    projectRoot: input.projectRoot,
    runtimeAutoBattle: projectSupportsRuntimeAutoBattle(input.projectRoot),
    routeStartSnapshot: null,
  };
  const boundaryIdentity = buildRuntimeSnapshotIdentityPair(
    boundaryRouteSnapshot,
    boundaryRouteSnapshot,
    identityOptions,
  );
  const finalIdentity = buildRuntimeSnapshotIdentityPair(
    finalRouteSnapshot,
    finalRouteSnapshot,
    identityOptions,
  );
  const shadowSuffix = routeRecord.decisions.slice(checkpointStep);
  const shadowSaveData = {
    floorId: boundaryRouteSnapshot.floorId,
    hero: cloneJson(boundaryRouteSnapshot.hero),
    route: "encoded-prefix-fixture",
    __toReplay__: "encoded-suffix-fixture",
    __solverReplay__: shadowSuffix,
  };
  const artifact = buildResumeArtifact({
    project,
    projectRoot: relativePath(input.projectRoot),
    routeRecord,
    routeFile: relativePath(input.routeFile),
    checkpointStep,
    boundarySnapshot: boundaryRouteSnapshot,
    boundaryRuntimeSnapshot: boundaryRouteSnapshot,
    boundaryIdentity,
    finalSnapshot: finalRouteSnapshot,
    finalRuntimeSnapshot: finalRouteSnapshot,
    finalIdentity,
    nativeSaveData: shadowSaveData,
    structuredSuffix: shadowSuffix,
    encodedSuffix: shadowSaveData.__toReplay__,
    nativeName: "Islands",
    nativeVersion: "Ver 2.8.2",
  });
  const validation = validateResumeArtifact(artifact, {
    project,
    routeRecord,
    saveData: shadowSaveData,
  });

  const projectMismatch = cloneJson(artifact);
  projectMismatch.projectFingerprint.fingerprintSha256 = "0".repeat(64);
  const routeMismatch = cloneJson(artifact);
  routeMismatch.routeFingerprint.sha256 = "0".repeat(64);
  const nativePayloadMismatchData = cloneJson(shadowSaveData);
  nativePayloadMismatchData.hero.hp += 1;
  const structuredSuffixMismatchData = cloneJson(shadowSaveData);
  structuredSuffixMismatchData.__solverReplay__[0].summary = `${structuredSuffixMismatchData.__solverReplay__[0].summary}:tampered`;
  const encodedSuffixMismatchData = cloneJson(shadowSaveData);
  encodedSuffixMismatchData.__toReplay__ = `${encodedSuffixMismatchData.__toReplay__}:tampered`;

  requireCondition(boundaryIdentity.matches, "shadow boundary identity must match");
  requireCondition(finalIdentity.matches, "shadow final identity must match");
  requireCondition(validation.projectFingerprintMatches, "project fingerprint must validate");
  requireCondition(validation.routeFingerprintMatches, "route fingerprint must validate");

  return {
    schema: CONTRACT_SCHEMA,
    status: "completed",
    provenance: {
      mode: "replay-runtime-h5save-resume-artifact",
      deterministicFullReportRebuild: true,
      liveRuntimeExecuted: false,
      liveRuntimeChecker: "shared-solver/check-replay-h5save-resume-live.js",
      productionReplayRuntimeChanged: true,
      productionSolverChanged: false,
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultPolicyChanged: false,
      routeSelectionSemanticsChanged: false,
      generationCommit: generationCommit(),
    },
    scope: {
      shadowOnly: false,
      replayRuntimeHardening: true,
      noProductionSolverSearchSemanticsChange: true,
    },
    input: {
      id: "whiteisland-pr-5.1b-route-boundary",
      tower: input.tower,
      projectRoot: relativePath(input.projectRoot),
      routeFile: relativePath(input.routeFile),
      checkpointStep,
      routeDecisionCount: routeRecord.decisions.length,
    },
    h5savePackage: {
      topLevelKeys: ["name", "version", "data", "__solverResumeArtifact__"],
      encoding: "lz-string base64 JSON",
      nativePayload: "h5mota-core.saveData",
      artifactSchema: RESUME_ARTIFACT_SCHEMA,
      nativePayloadSha256Stored: Boolean(artifact.nativeSave.nativeSavePayloadSha256),
      structuredSuffixSha256Stored: Boolean(artifact.nativeSave.structuredSuffixSha256),
      encodedSuffixSha256Stored: Boolean(artifact.nativeSave.encodedSuffixSha256),
    },
    projectFingerprint: artifact.projectFingerprint,
    routeFingerprint: artifact.routeFingerprint,
    boundary: {
      executedStepCount: artifact.boundary.executedStepCount,
      nextStep: artifact.boundary.nextStep,
      exactStateKeyMatchesRoute: artifact.boundary.exactStateKey === routeRecord.decisions[checkpointStep - 1].postExactStateKey,
      nextDecision: artifact.boundary.nextDecision,
      routeSnapshotStored: Boolean(artifact.boundary.routeSnapshot),
      runtimeSnapshotStored: Boolean(artifact.boundary.snapshot),
      identityMatches: artifact.boundary.identityMatches,
      runtimeSnapshotIdentity: artifact.boundary.runtimeSnapshotIdentity,
      capturedRuntimeSnapshotIdentity: artifact.boundary.capturedRuntimeSnapshotIdentity,
    },
    continuation: {
      suffixDecisionCount: artifact.continuation.suffixDecisionCount,
      finalExactStateKeyMatchesRoute: artifact.continuation.finalExactStateKey === routeRecord.final.exactStateKey,
      routeFinalSnapshotStored: Boolean(artifact.continuation.routeFinalSnapshot),
      finalRuntimeSnapshotStored: Boolean(artifact.continuation.finalSnapshot),
      identityMatches: artifact.continuation.identityMatches,
      runtimeSnapshotIdentity: artifact.continuation.runtimeSnapshotIdentity,
      capturedRuntimeSnapshotIdentity: artifact.continuation.capturedRuntimeSnapshotIdentity,
    },
    loaderOwned: {
      productionEntryPoint: "shared-solver/export-h5-segment.js:openNativeReplay",
      artifactPreflightBeforeBrowser: true,
      routeFileRequiredByDefault: true,
      legacyRouteIdentityUsesArtifactFloors: true,
      storedRuntimeIdentityRecomputed: true,
      boundaryVerificationBeforeSuffix: true,
      suffixDecisionCountBeforeBoundaryVerification: 0,
      nextDecisionVerificationBeforeSuffix: true,
      finalVerificationAfterSuffix: true,
    },
    freshRuntime: {
      required: true,
      nativeSaveLoadHelper: "shared-solver/lib/replay-resume-artifact.js:loadRuntimeSaveData",
      continuationDriver: "shared-solver/lib/live-replay.js:executeRouteDecision",
      liveRuntimeExecuted: false,
      liveChecker: "shared-solver/check-replay-h5save-resume-live.js",
    },
    mismatchControls: [
      {
        id: "project-fingerprint-mismatch",
        alteredField: "projectFingerprint.fingerprintSha256",
        expectedErrorCode: captureErrorCode(() => validateResumeArtifact(projectMismatch, { project, routeRecord })),
      },
      {
        id: "route-fingerprint-mismatch",
        alteredField: "routeFingerprint.sha256",
        expectedErrorCode: captureErrorCode(() => validateResumeArtifact(routeMismatch, { project, routeRecord })),
      },
      {
        id: "route-file-required",
        alteredField: "routeRecord omitted while requireRoute=true",
        expectedErrorCode: captureErrorCode(() => validateResumeArtifact(artifact, {
          project,
          saveData: shadowSaveData,
          requireRoute: true,
        })),
      },
    ],
    bindingControls: [
      {
        id: "native-save-payload-mismatch",
        alteredField: "data.hero.hp",
        expectedErrorCode: captureErrorCode(() => validateResumeArtifact(artifact, {
          project,
          routeRecord,
          saveData: nativePayloadMismatchData,
        })),
      },
      {
        id: "structured-suffix-mismatch",
        alteredField: "data.__solverReplay__[0].summary",
        expectedErrorCode: captureErrorCode(() => validateResumeArtifact(artifact, {
          project,
          routeRecord,
          saveData: structuredSuffixMismatchData,
        })),
      },
      {
        id: "encoded-suffix-mismatch",
        alteredField: "data.__toReplay__",
        expectedErrorCode: captureErrorCode(() => validateResumeArtifact(artifact, {
          project,
          routeRecord,
          saveData: encodedSuffixMismatchData,
        })),
      },
    ],
  };
}

function markdownReport(report) {
  const lines = [
    `# ${CONTRACT_SCHEMA}`,
    "",
    `- status: **${report.status}**`,
    `- input: ${report.input.id}`,
    `- checkpoint: decision ${report.boundary.executedStepCount} completed; next decision ${report.boundary.nextStep}`,
    `- artifact schema: ${report.h5savePackage.artifactSchema}`,
    `- live runtime executed by this shadow report: **${report.provenance.liveRuntimeExecuted}**`,
    "",
    "## Boundary",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| exact state key matches route | ${report.boundary.exactStateKeyMatchesRoute} |`,
    `| next decision | ${report.boundary.nextDecision.summary} |`,
    `| route snapshot stored | ${report.boundary.routeSnapshotStored} |`,
    `| runtime snapshot stored | ${report.boundary.runtimeSnapshotStored} |`,
    `| identity matches | ${report.boundary.identityMatches} |`,
    "",
    "## Continuation",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| suffix decision count | ${report.continuation.suffixDecisionCount} |`,
    `| final exact state key matches route | ${report.continuation.finalExactStateKeyMatchesRoute} |`,
    `| final runtime snapshot stored | ${report.continuation.finalRuntimeSnapshotStored} |`,
    `| identity matches | ${report.continuation.identityMatches} |`,
    "",
    "## Loader-owned verification",
    "",
    "| Contract | Value |",
    "| --- | --- |",
    `| production entry point | ${report.loaderOwned.productionEntryPoint} |`,
    `| artifact preflight before browser | ${report.loaderOwned.artifactPreflightBeforeBrowser} |`,
    `| route file required by default | ${report.loaderOwned.routeFileRequiredByDefault} |`,
    `| legacy identity uses artifact floor set | ${report.loaderOwned.legacyRouteIdentityUsesArtifactFloors} |`,
    `| stored runtime identity recomputed | ${report.loaderOwned.storedRuntimeIdentityRecomputed} |`,
    `| suffix decisions before boundary verification | ${report.loaderOwned.suffixDecisionCountBeforeBoundaryVerification} |`,
    `| final verification after suffix | ${report.loaderOwned.finalVerificationAfterSuffix} |`,
    "",
    "## Mismatch controls",
    "",
    "| Control | Altered field | Expected error |",
    "| --- | --- | --- |",
    ...report.mismatchControls.map((control) => `| ${control.id} | ${control.alteredField} | ${control.expectedErrorCode} |`),
    "",
    "## Payload binding controls",
    "",
    "| Control | Altered field | Expected error |",
    "| --- | --- | --- |",
    ...report.bindingControls.map((control) => `| ${control.id} | ${control.alteredField} | ${control.expectedErrorCode} |`),
    "",
    "## Scope",
    "",
    "This contract changes replay/export runtime artifact handling only. It does not change production solver DP keys, dominance, agenda, capacity, default policy, or route-selection semantics.",
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

async function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const out = path.resolve(args.out || DEFAULT_OUT);
  const outMd = path.resolve(args["out-md"] || DEFAULT_OUT_MD);
  const report = buildReport();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMd, markdownReport(report), "utf8");
  process.stdout.write(`replay h5save resume contract wrote ${out}\n`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT_SCHEMA,
  DEFAULT_OUT,
  DEFAULT_OUT_MD,
  buildReport,
  markdownReport,
};
