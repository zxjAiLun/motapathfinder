"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const libDir = path.join(root, "lib");

const CORE_DOMAIN = new Set([
  "project-loader.js",
  "state.js",
  "state-key.js",
  "start-state-loader.js",
  "solver-model.js",
]);
const CORE_SIM = new Set([
  "simulator.js",
  "step-simulator.js",
  "battle-resolver.js",
  "battle-thresholds.js",
  "event-resolver.js",
  "events.js",
  "effect-vm.js",
  "equipment-resolver.js",
  "door-resolver.js",
  "tool-registry.js",
  "auto-actions.js",
  "expression.js",
  "floor-transitions.js",
  "reachability.js",
  "movement-hazards.js",
]);
const CORRECTNESS = new Set([
  "dp-search.js",
  "segment-dp.js",
  "milestone-spec.js",
  "region-spec.js",
  "objective-spec.js",
  "adaptive-segment-planner.js",
  "dominance.js",
  "search-nodes.js",
  "priority-queue.js",
  "confluence-key.js",
]);
const RESOURCE_TIMING = new Set([
  "resource-timing-model.js",
  "resource-deferral-planner.js",
]);
const DECOMPOSITION = new Set([
  "blind-discovery-baseline.js",
  "discovery-capability-audit.js",
  "milestone-decomposer.js",
  "landmarks.js",
  "teacher-divergence-audit.js",
  "teacher-search-observer.js",
  "teacher-dominance-audit.js",
]);
const EXPLORATION = new Set([
  "search.js",
  "search-profiles.js",
  "search-worker.js",
  "search-cache.js",
  "exhaustive-search.js",
  "exhaustive-parallel.js",
  "progressive-monster-planner.js",
  "current-reachable-battle.js",
  "reach-and-battle-oracle.js",
  "resource-cluster.js",
  "resource-intent-scanner.js",
  "resource-lookahead.js",
  "parallel-expander.js",
  "worker-pool.js",
  "score.js",
  "progress.js",
  "progress-blockers.js",
  "stage-policy.js",
  "updown-candidate-policy.js",
  "frontier-features.js",
  "floor-scout.js",
  "floor-checkpoints.js",
]);
const ROUTE = new Set([
  "route-store.js",
  "route-snapshot.js",
  "replay-session.js",
  "live-replay.js",
  "route-audit.js",
  "route-audit-repair.js",
  "route-repair-runner.js",
  "route-repair-runner-chain.js",
  "route-window-repair.js",
  "iterative-route-repair.js",
  "checkpoint-repair.js",
  "checkpoint-store.js",
  "route-debugger.js",
  "route-inspector.js",
]);
const DIAG = new Set([
  "search-trace-explainability.js",
  "solver-doctor.js",
  "pruning-diagnostics.js",
  "perf.js",
  "enemy-labels.js",
  "cli-options.js",
  "solver-config.js",
  "floor-id.js",
  "agenda-policy-evaluation.js",
  "region-entry-validator.js",
]);

const modules = {};

function add(file, partial) {
  const id = file.replace(/\.js$/, "");
  modules[`shared-solver/lib/${file}`] = {
    id,
    path: `shared-solver/lib/${file}`,
    ...partial,
  };
}

for (const file of fs.readdirSync(libDir).filter((name) => name.endsWith(".js")).sort()) {
  if (CORE_DOMAIN.has(file)) {
    add(file, {
      layer: "domain",
      status: "canonical",
      role: "simulation-core",
      correctnessSource: true,
      tests: {
        unit: true,
        realFixture: true,
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: true,
      },
    });
  } else if (CORE_SIM.has(file)) {
    add(file, {
      layer: "simulation",
      status: "canonical",
      role: "simulation-core",
      correctnessSource: true,
      tests: {
        unit: true,
        realFixture: true,
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: true,
      },
    });
  } else if (CORRECTNESS.has(file)) {
    add(file, {
      layer: "search/correctness",
      status: "canonical",
      role: "correctness-search",
      correctnessSource: true,
      tests: {
        unit: true,
        realFixture: true,
        segmentClosure: true,
        fullClosure: false,
        cleanCheckout: true,
      },
    });
  } else if (RESOURCE_TIMING.has(file)) {
    add(file, {
      layer: "planning/resource-timing",
      status: "experimental",
      role: "candidate-generator",
      correctnessSource: false,
      tests: {
        unit: file === "resource-timing-model.js",
        realFixture: file === "resource-deferral-planner.js",
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: false,
      },
      notes: file === "resource-deferral-planner.js"
        ? "battle-only deferral; auto threshold derivation missing; not a full planner"
        : "expensive skyline annotator; timing score must not define correctness dominance",
    });
  } else if (DECOMPOSITION.has(file)) {
    const diagnosticModule = [
      "teacher-divergence-audit.js",
      "teacher-search-observer.js",
      "teacher-dominance-audit.js",
    ].includes(file);
    add(file, {
      layer: diagnosticModule
        ? "diagnostics"
        : "planning/decomposition",
      status: diagnosticModule
        ? "supporting"
        : "experimental",
      role: diagnosticModule
        ? "diagnostics"
        : "candidate-generator",
      correctnessSource: false,
      tests: {
        unit: true,
        realFixture: file === "teacher-divergence-audit.js",
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: true,
      },
      notes: file === "teacher-divergence-audit.js"
        ? "teacher-forced step audit; test-side only; never feeds teacher actions into production search"
        : file === "teacher-search-observer.js"
          ? "real search event diagnostics; synthetic contract plus manual teacher fixture runs; never feeds teacher actions into production search"
        : file === "teacher-dominance-audit.js"
          ? "dominance witness continuation diagnostics; never feeds teacher actions into production search"
        : "auto milestone decomposition; proof not yet closed into checkpoint schedule",
    });
  } else if (EXPLORATION.has(file)) {
    add(file, {
      layer: "search/exploration",
      status: "exploration",
      role: "exploration-search",
      correctnessSource: false,
      tests: {
        unit: false,
        realFixture: false,
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: true,
      },
    });
  } else if (ROUTE.has(file)) {
    add(file, {
      layer: "route",
      status: "canonical",
      role: "route-replay",
      correctnessSource: false,
      tests: {
        unit: true,
        realFixture: true,
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: true,
      },
    });
  } else if (DIAG.has(file)) {
    add(file, {
      layer: "diagnostics",
      status: "supporting",
      role: "diagnostics",
      correctnessSource: false,
      tests: {
        unit: false,
        realFixture: false,
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: true,
      },
    });
  } else {
    add(file, {
      layer: "unclassified",
      status: "supporting",
      role: "supporting",
      correctnessSource: false,
      tests: {
        unit: false,
        realFixture: false,
        segmentClosure: false,
        fullClosure: false,
        cleanCheckout: true,
      },
      notes: "auto-classified; refine in solver-manifest",
    });
  }
}

const TEST_OVERRIDES = {
  "shared-solver/check-search-trace-explainability.js": {
    grade: "unit-plus-micro",
    allowsNotFound: true,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "PR-5.11 decision-depth/floor/action/rejection trace, human-review buckets, and same-control before-after comparison contract",
  },
  "shared-solver/check-blind-discovery-baseline.js": {
    grade: "unit-plus-micro",
    allowsNotFound: true,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "PR-5.10c terminal-only D3 input contract plus bounded real OnlyUp not-found baseline; found=false is expected evidence, not a no-route proof",
  },
  "shared-solver/check-discovery-capability-audit.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "PR-5.10b human-hint inventory, ablation ladder, architectural ceiling, and terminal-only blind-spec contract",
  },
  "shared-solver/check-objective-spec-contract.js": {
    grade: "unit-plus-micro",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "ObjectiveSpec normalization/comparison/proof controls plus a short real RegionSpec route artifact",
  },
  "shared-solver/check-objective-spec-live.js": {
    grade: "integration-local",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: false,
    notes: "real Chromium replay recomputes and verifies the persisted terminal objective value",
  },
  "shared-solver/check-mt5-51533-next-smoke.js": {
    grade: "smoke",
    allowsNotFound: true,
    requiresStrictReplay: false,
    cleanCheckout: false,
    notes: "maxExpansions=1; allows found||legal failure diagnostics; not a closure test",
  },
  "shared-solver/check-mt5-51533-next.js": {
    grade: "smoke-wrapper",
    allowsNotFound: true,
    requiresStrictReplay: false,
    cleanCheckout: false,
    notes: "thin compatibility wrapper around check-mt5-51533-next-smoke.js",
  },
  "shared-solver/check-resource-timing-model.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic resource timing unit checks",
  },
  "shared-solver/check-core-regressions.js": {
    grade: "unit-plus-micro",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "canonical core regression suite; no ignored route dependency",
  },
  "shared-solver/check-resource-timing.js": {
    grade: "integration-local",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: false,
    notes: "depends on ignored routes/latest fixture",
  },
  "shared-solver/check-resource-deferral.js": {
    grade: "local-regression",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: false,
    notes: "real OnlyUp prefix + hand-written atk/def threshold; not full auto closure",
  },
  "shared-solver/check-auto-milestone-decomposition.js": {
    grade: "unit-plus-micro",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "serialization/budget/branch tests + tiny direct-goal; not 51533→I894 closure",
  },
  "shared-solver/check-teacher-divergence.js": {
    grade: "diagnostic",
    allowsNotFound: true,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "teacher-forced divergence audit; tracked fixture always; MT5 teacher optional if present",
  },
  "shared-solver/check-manifest-runner.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "manifest suite selection and fail-fast semantics; no tower/project load",
  },
  "shared-solver/check-dp-observer.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic searchDP observer contract; no tower/project load",
  },
  "shared-solver/check-hybrid-fair-agenda.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic hybrid-fair agenda contract; no tower/project load",
  },
  "shared-solver/check-agenda-policy-evaluation.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic agenda policy matrix and aggregation checks; no tower/project load",
  },
  "shared-solver/check-teacher-search-observer.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic real-search teacher observer outcome contract",
  },
  "shared-solver/check-teacher-dominance-audit.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic dominance witness continuation audit; diagnostics-only",
  },
  "shared-solver/check-route-store-exact.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic exact final-state route reconstruction check",
  },
  "shared-solver/check-adaptive-repair-outcomes.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic shadow-only repair outcome contract with deterministic rebuild",
  },
  "shared-solver/check-resource-intent-contract.js": {
    grade: "unit",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "synthetic shadow-only resource intent evidence contract with deterministic rebuild",
  },
  "shared-solver/check-region-entry-contract.js": {
    grade: "unit-plus-micro",
    allowsNotFound: true,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "bounded live RegionSpec entry contract with fixed controls, schema gates, negative controls, and deterministic rebuild",
  },
  "shared-solver/check-solver-model-contract.js": {
    grade: "unit-plus-micro",
    allowsNotFound: false,
    requiresStrictReplay: false,
    cleanCheckout: true,
    notes: "PR-5.3a manual model authority, legacy compatibility, compact solver state/key projection, and invalid-model controls",
  },
  "shared-solver/check-solver-model-runtime-boundary-live.js": {
    grade: "integration-local",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: false,
    notes: "PR-5.3a1 real Chromium compact-model replay; verifies partial solver snapshots, raw runtime identity separation, and disabled-field preservation",
  },
  "shared-solver/check-region-route-output-contract.js": {
    grade: "closure",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "PR-4.8b1 runner-owned cleanup with real short OnlyUp and Whiteisland positives, validate-only preservation, strict primitive replay, and not-found/structured-failure stale-output controls; not a full tower route",
  },
  "shared-solver/check-replay-start-offset-contract.js": {
    grade: "closure",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "PR-5.1a GUI session start-offset contract with fixed PR-4.8b cross-tower routes, checkpoint composition, exact boundary status, displayed floor/hero, side-effect ordering, and deterministic rebuild",
  },
  "shared-solver/check-replay-start-offset-live.js": {
    grade: "integration-local",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: false,
    notes: "PR-5.1a local Chrome/Edge live smoke across both PR-4.8b routes, valid offsets, checkpoint plus offset, and pre-launch out-of-range rejection",
  },
  "shared-solver/check-replay-flag-identity-contract.js": {
    grade: "closure",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "PR-5.1a1 shadow-only runtime snapshot identity with preserved __leaveLoc__, checkpoint baseline, real simulator changeFloor/floorFly witness, mismatch rejection, and deterministic rebuild",
  },
  "shared-solver/check-replay-flag-merge-cli-contract.js": {
    grade: "closure",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "PR-5.1a1a replay-runtime per-floor __leaveLoc__ merge, non-initial-floor checkpoint continuation, dual mismatch witnesses, direct route-gui CLI gate, and deterministic rebuild",
  },
  "shared-solver/check-replay-h5save-resume-contract.js": {
    grade: "closure",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "PR-5.1b deterministic h5save resume-artifact schema, boundary/continuation fields, project/route fingerprint mismatch controls, and report rebuild",
  },
  "shared-solver/check-replay-h5save-resume-live.js": {
    grade: "integration-local",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: false,
    notes: "PR-5.1b local Chrome/Edge export, fresh native h5save load, next-decision continuation, final identity, and CLI fingerprint mismatch smoke",
  },
  "shared-solver/check-replay-h5save-gui.js": {
    grade: "closure",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "PR-5.1c1 Route GUI tri-state fingerprint status, verified/legacy/failure projection, headless DOM smoke, metadata-only legacy mode, and real CLI/API tampered/missing h5save controls",
  },
  "shared-solver/check-replay-h5save-gui-flow.js": {
    grade: "closure",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: true,
    notes: "PR-5.2c Route GUI cached failure status retention, busy/completed/failed play controls, legacy API controls, gate-failure cleanup, real picker/drop upload, and DOM operation smoke",
  },
  "shared-solver/check-replay-h5save-gui-flow-live.js": {
    grade: "integration-local",
    allowsNotFound: false,
    requiresStrictReplay: true,
    cleanCheckout: false,
    notes: "PR-5.2b local Chrome/Edge GUI API flow with a real exported h5save, asynchronous play acknowledgement, pause/resume, native loader restore, boundary gate, suffix continuation, and final verification",
  },
};

function autoGradeTest(fileName) {
  const relPath = `shared-solver/${fileName}`;
  if (TEST_OVERRIDES[relPath]) return TEST_OVERRIDES[relPath];

  const isClosure = /closure|route-record/.test(fileName);
  const isDiagnostic = /audit|debugger|gui-compare|state-key-audit/.test(fileName);
  const isUnit = /resource-timing-model|auto-milestone-decomposition/.test(fileName);
  const grade = isClosure
    ? "closure"
    : isDiagnostic
      ? "diagnostic"
      : isUnit
        ? "unit"
        : "local-regression";

  return {
    grade,
    allowsNotFound: false,
    requiresStrictReplay: isClosure,
    cleanCheckout: false,
    notes: "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test",
  };
}

const tests = {};
for (const fileName of fs.readdirSync(root).filter((name) => /^check-.*\.js$/.test(name)).sort()) {
  tests[`shared-solver/${fileName}`] = autoGradeTest(fileName);
}

const pathRules = [
  {
    match: "shared-solver/scripts/**",
    status: "supporting",
    role: "manifest-tool",
    layer: "tools/manifest",
    correctnessSource: false,
    recommendedAction: "keep as manifest/inventory tooling; regenerate and validate before changing module identity",
  },
  {
    match: "shared-solver/.tmp-*.js",
    status: "archive-candidate",
    role: "experiment",
    layer: "experiments",
    correctnessSource: false,
    recommendedAction: "archive to _archive/experiments/pre-canonical/; do not treat as canonical",
  },
  {
    match: "shared-solver/check-*.js",
    status: "supporting",
    role: "test",
    layer: "tests",
    correctnessSource: false,
    recommendedAction: "keep as regression/check script; consult tests grade in solver-manifest",
  },
  {
    match: "shared-solver/run-*.js",
    status: "supporting",
    role: "cli",
    layer: "cli",
    correctnessSource: false,
    recommendedAction: "keep as CLI orchestration; no reusable logic growth",
  },
  {
    match: "shared-solver/debug-*.js",
    status: "supporting",
    role: "debug-tool",
    layer: "tools/debug",
    correctnessSource: false,
    recommendedAction: "keep as debug tool; not a correctness search",
  },
  {
    match: "shared-solver/diagnose-*.js",
    status: "supporting",
    role: "debug-tool",
    layer: "tools/debug",
    correctnessSource: false,
    recommendedAction: "keep as diagnostics CLI",
  },
  {
    match: "shared-solver/export-*.js",
    status: "supporting",
    role: "tool",
    layer: "tools/route",
    correctnessSource: false,
    recommendedAction: "keep as route export tool",
  },
  {
    match: "shared-solver/find-*.js",
    status: "exploration",
    role: "exploration-search",
    layer: "experiments/search",
    correctnessSource: false,
    recommendedAction: "exploration only; never treat miss as proof of no route",
  },
  {
    match: "shared-solver/search-*.js",
    status: "exploration",
    role: "exploration-search",
    layer: "experiments/search",
    correctnessSource: false,
    recommendedAction: "exploration/local search helper; not global correctness proof",
  },
  {
    match: "shared-solver/verify-*.js",
    status: "supporting",
    role: "verification",
    layer: "tools/route",
    correctnessSource: false,
    recommendedAction: "keep as live verification CLI",
  },
  {
    match: "shared-solver/profile-*.js",
    status: "supporting",
    role: "perf-tool",
    layer: "tools/debug",
    correctnessSource: false,
    recommendedAction: "keep as performance tooling",
  },
  {
    match: "shared-solver/record-*.js",
    status: "supporting",
    role: "perf-tool",
    layer: "tools/debug",
    correctnessSource: false,
    recommendedAction: "keep as performance baseline tooling",
  },
  {
    match: "shared-solver/print-*.js",
    status: "supporting",
    role: "tool",
    layer: "tools/route",
    correctnessSource: false,
    recommendedAction: "keep as route print utility",
  },
  {
    match: "shared-solver/route-*.js",
    status: "supporting",
    role: "tool",
    layer: "tools/route",
    correctnessSource: false,
    recommendedAction: "keep as route GUI/repair CLI",
  },
  {
    match: "shared-solver/render-*.js",
    status: "supporting",
    role: "tool",
    layer: "tools/route",
    correctnessSource: false,
    recommendedAction: "keep as route debugger rendering helper",
  },
  {
    match: "shared-solver/audit-*.js",
    status: "supporting",
    role: "diagnostics",
    layer: "diagnostics",
    correctnessSource: false,
    recommendedAction: "keep as audit CLI",
  },
  {
    match: "shared-solver/public.js",
    status: "canonical",
    role: "public-api",
    layer: "public",
    correctnessSource: false,
    recommendedAction: "stable public API surface for agents; keep thin",
  },
  {
    match: "shared-solver/gui/**",
    status: "supporting",
    role: "gui",
    layer: "tools/route",
    correctnessSource: false,
    recommendedAction: "keep as route GUI assets",
  },
];

const manifest = {
  version: 1,
  description:
    "Machine-readable identity for shared-solver modules, CLIs, and checks. Status fields prevent mistaking exploration/experimental code for correctness sources.",
  policy: {
    correctnessSources: ["domain", "simulation", "search/correctness"],
    experimentalLayers: [
      "planning/resource-timing",
      "planning/decomposition",
      "search/exploration",
      "experiments",
    ],
    unlistedLibFile: "error",
    notes: [
      "correctnessSource=true means the module participates in the trusted semantic or DP correctness path.",
      "experimental/exploration modules may generate candidates or diagnostics but must not be cited as proof that a route is impossible.",
      "Test grade smoke may pass with found=false; only closure-grade tests assert found+strict replay.",
    ],
  },
  pathRules,
  suites: {
    static: {
      requiredChecks: [
        "shared-solver/check-core-regressions.js",
        "shared-solver/check-resource-timing-model.js",
        "shared-solver/check-auto-milestone-decomposition.js",
        "shared-solver/check-discovery-capability-audit.js",
        "shared-solver/check-blind-discovery-baseline.js",
        "shared-solver/check-search-trace-explainability.js",
        "shared-solver/check-teacher-divergence.js",
        "shared-solver/check-manifest-runner.js",
        "shared-solver/check-dp-observer.js",
        "shared-solver/check-teacher-search-observer.js",
        "shared-solver/check-teacher-dominance-audit.js",
        "shared-solver/check-hybrid-fair-agenda.js",
        "shared-solver/check-agenda-policy-evaluation.js",
        "shared-solver/check-route-store-exact.js",
        "shared-solver/check-adaptive-repair-outcomes.js",
        "shared-solver/check-resource-intent-contract.js",
        "shared-solver/check-region-entry-contract.js",
        "shared-solver/check-region-route-output-contract.js",
        "shared-solver/check-replay-start-offset-contract.js",
        "shared-solver/check-replay-flag-identity-contract.js",
        "shared-solver/check-replay-flag-merge-cli-contract.js",
        "shared-solver/check-replay-h5save-resume-contract.js",
        "shared-solver/check-replay-h5save-gui.js",
        "shared-solver/check-replay-h5save-gui-flow.js",
      ],
      requiredCommands: ["check:no-tower-solver-js"],
    },
  },
  modules,
  tests,
};

const outPath = path.join(root, "solver-manifest.json");
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(`modules=${Object.keys(modules).length} tests=${Object.keys(tests).length}`);
