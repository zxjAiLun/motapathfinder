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
  "auto-battle-fast-reject.js",
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
  "automatic-macro-graph.js",
  "hierarchical-blind-planner.js",
  "blind-qualification.js",
  "blind-discovery-baseline.js",
  "discovery-capability-audit.js",
  "milestone-decomposer.js",
  "landmarks.js",
  "teacher-divergence-audit.js",
  "teacher-search-observer.js",
  "teacher-dominance-audit.js",
  "hierarchical-discovery-engine.js",
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
        realFixture: file === "teacher-divergence-audit.js" || file === "hierarchical-discovery-engine.js",
        segmentClosure: file === "hierarchical-discovery-engine.js",
        fullClosure: false,
        cleanCheckout: true,
      },
      notes: file === "teacher-divergence-audit.js"
        ? "teacher-forced step audit; test-side only; never feeds teacher actions into production search"
        : file === "teacher-search-observer.js"
          ? "real search event diagnostics; synthetic contract plus manual teacher fixture runs; never feeds teacher actions into production search"
        : file === "teacher-dominance-audit.js"
          ? "dominance witness continuation diagnostics; never feeds teacher actions into production search"
        : file === "hierarchical-discovery-engine.js"
          ? "PR-5.17a2 route-free terminal dependency, checkpoint feedback, blocker repair, and local canonical DP loop; D2 remains open"
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
  "shared-solver/check-strategic-d2-search.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.18c verifies re-enumerated connector edge replay (including corruption and frontier-trim negatives), real integrated two-step connector strict replay, protected lazy-work lifecycle, recoverable deferred exact posts, target-floor floorFly variant retention, six agenda queues, real D2 64-expansion frontier, and I621 implicit-consumption evidence"
  },
  "shared-solver/check-strategic-blocker-connector.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.18d verifies terminal blocker analysis (attack-blocked -> combat-power), synthetic and real blocker-derived intermediate connector strict replay, intermediate combat-power metric improvement, shared-total-work edge controls (remaining 1/0/3), and a same-total-search-work A/B against the strategic-only baseline; --qualification-1000 adds the frozen 1000-work A/B for marker-only CI"
  },
  "shared-solver/check-strategic-dependency-connector.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.18e verifies synthetic completionPredicate-only dependency connector strict replay, positive/negative dependency compile controls, real unreachable-option counterfactual compile, shared-budget edge controls (remaining 0/1/3), and same-total-work A/B; --qualification-1000 adds the frozen 1000-work A/B; Repair 1 adds source-aware scheduler synthetic contract, pickup->equip two-stage synthetic control, and dependencySatisfied/dependencyStateCreated/dependencyGlobalBlockerAdvanced split diagnostics; Repair 2 adds feedback-aware S0-fail/S1-retry synthetic control and dependencyAttemptWitnesses contract"
  },
  "shared-solver/check-strategic-dependency-attribution.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19a verifies observation-only attribution does not change D2 search stats, synthetic distance metrics and boundary classifiers, real no-semantic-change A/B, and --qualification-1000 frozen 8-attempt attribution contract (8 attempts / 8 distinct sources / 1 semantic dependency); Repair 1 adds relevant/irrelevant access-cut synthetic controls and qualification targetRelevanceSummary; Repair 2 adds adversarial 0-1 BFS path controls and structural access summary contract"
  },
  "shared-solver/check-strategic-battle-access-prerequisite.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.19b verifies synthetic battle-access prerequisite compile and strict-replay connector, one-layer discipline, shared-budget edge controls, and --qualification-1000 frozen mechanism/promotion A/B"
  },
  "shared-solver/check-strategic-battle-viability.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19c verifies synthetic attack-blocked/lethal/viable/unsupported/unresolved-no-damage classification, full battleBefore/After fields, on/off observation search stats are identical, and --qualification-1000 real 8-attempt attribution contract with success causal fields and structuralAfter.available/reason/unavailableReason"
  },
  "shared-solver/check-strategic-parent-dependency-continuation.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.19d verifies parentDependencyId+exactStateKey continuation identity, lazy-work kind, exact-merge intent preservation, cross-floor waiting without oracle-return, legal resume on target floor, next-boundary re-attribution, and --qualification-1000 frozen same-total-work A/B mechanism/promotion split; Repair 1 adds adversarial lineage tree (unrelated target-floor node must not resume, descendant must resume) and split next-prerequisite scheduling failure reasons"
  },
  "shared-solver/check-strategic-hierarchical-call-allocation.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19e verifies active hierarchy priority synthetic sequence (root S1 success activates C1, sibling S2 defers, child P2 gets next call, feedback releases, sibling resumes), focused on/off no-semantic-change, and --qualification-1000 real frozen mechanism gate that a continuation-derived child prerequisite actually receives one connector call; Repair 1 adds lifecycle-safe merge controls (completed no-reactivation, active preserved, parked preserved)"
  },
  "shared-solver/check-strategic-battle-stage-prerequisite.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.19f verifies attack-blocked -> damageable compile identity (distinct from generic battle-access), synthetic completion/strict replay, lethal out-of-scope, and --qualification-1000 A/B control (5.19e generic child) vs candidate (stage-decomposed child)"
  },
  "shared-solver/check-strategic-retroactive-continuation-observation.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19g observation-only frozen 1000-work contract for exact-merged stage continuation; currently observes historical eligible descendants 0 / future eligible descendants 0 / calls remaining 2 / priority active at end, so retroactive historical-descendant re-entry hypothesis is not supported"
  },
  "shared-solver/check-strategic-canonical-successor-edge-attribution.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19h observation-only frozen 1000-work contract for anchor expansion lifecycle, outgoing transition disposition, and canonical legal successor edge graph; currently classifies stage anchor 840 as case-1-anchor-never-expanded while control anchor 109 is expanded and canonical-edge-reachable to MT5"
  },
  "shared-solver/check-strategic-continuation-anchor-expansion-scheduling.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19i verifies one-shot anchor expansion request lifecycle (duplicate rejected, selected once, already-expanded skip, inactive skip), frozen control OFF vs candidate ON, anchor expanded after continuation, lineage-safe resume, and generic lethal child receiving a real connector call"
  },
  "shared-solver/check-strategic-lethal-survival-attribution.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19j verifies synthetic survival observer and frozen depth-2 lethal child attribution; real result class B: best survival margin -617833 -> -150104, 43/50 states improved, max HP 214597, min damage 168451, viable state false"
  },
  "shared-solver/check-strategic-survival-edge-attribution.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.19k verifies synthetic edge observer and frozen depth-2 edge attribution; real result: 124 edges / 42 positive / 6 unique battle targets, best chain decomposed to skeletonKing MT5 +90953, devilWarrior MT5 +279323 damage reduction, changeFloor 0, skeletonKing MT4 +97453"
  },
  "shared-solver/check-strategic-survival-opportunity-prerequisite.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.19l verifies synthetic discrete consumption predicate and frozen witness-backed recovery; PR-5.19n extends the synthetic contracts with R1/R2/R3/R4 residual paid-witness attribution and real observation asserts O2-compatible suffix replay without changing the frozen result; --residual-recovery adds PR-5.19o prefix-only strict replay/materialization/continuation gates; --post-o3-observation adds PR-5.19p P1/P2/P3/P4 attribution from the O2+O3 prefix without behavior"
  },
  "shared-solver/check-d2-deferred-heal-attribution.js": {
    "grade": "diagnostic",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.17a13 post-hoc early-versus-delayed I621 causal A/B plus route-free hierarchical consume-now vocabulary audit; tracked route is never a planner input"
  },
  "shared-solver/check-repair-actual-closure.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.17a5 synthetic actual repair closure class commit and rollback contract"
  },
  "shared-solver/check-hierarchical-discovery-engine.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.17a2 route-free D2 hierarchical loop executes five local prerequisites with strict replay, then freezes the cross-floor EXP/composite repair boundary"
  },
  "shared-solver/check-automatic-blocker-repair.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.17a1 real D2 blocked evilHero repair, circular I1009 rejection, startable I1014 selection, first prerequisite strict replay, and empty-portfolio negative control"
  },
  "shared-solver/check-dependency-feedback-controller.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.16d real D2 top-1 checkpoint failure versus multi-role checkpoint and OR-alternative switch with incremental strict replay"
  },
  "shared-solver/check-local-dependency-executor.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.16c real D2 automatic skeletonKing prerequisite, eight multi-role checkpoints, strict replay, deterministic fingerprints, and no-viable negative control"
  },
  "shared-solver/check-automatic-dependency-planner.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.16b real D2 I894 AND/OR dependency alternatives, POI-contact, simulator evidence, and disconnected negative controls"
  },
  "shared-solver/check-search-observatory.js": {
    "grade": "diagnostic",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.16a D2 human-readable search intent and cost observatory baseline"
  },
  "shared-solver/check-automatic-feasibility-subgoals.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.15b real detached MT5 state envelope and automatic equipment feasibility candidate with removed-item and missing-enemy negative controls"
  },
  "shared-solver/check-d2-blind-failure-attribution.js": {
    "grade": "diagnostic",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.15a tracked checkpoint construction plus detached-state 1000-expansion D2 attribution and MT5-only negative control"
  },
  "shared-solver/check-blind-qualification.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.14 D0-D3 input-boundary and verdict contract; D0 strict replay passes while bounded D2/D3 misses remain explicit open evidence"
  },
  "shared-solver/check-failure-triggered-macro-backtracking.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.13b bounded post-goal collection, deepest-expanded state, and route-free failure-triggered checkpoint/backtracking contract"
  },
  "shared-solver/check-adaptive-onlyup.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-adaptive-repair-outcomes.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic shadow-only repair outcome contract with deterministic rebuild"
  },
  "shared-solver/check-agenda-policy-evaluation.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic agenda policy matrix and aggregation checks; no tower/project load"
  },
  "shared-solver/check-auto-milestone-decomposition.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "serialization/budget/branch tests + tiny direct-goal; not 51533→I894 closure"
  },
  "shared-solver/check-auto-stabilize.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-bounded-abstraction-counterexample.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-checkpoint-repair.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-confluence-dominance.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-core-regressions.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "canonical core regression suite; no ignored route dependency"
  },
  "shared-solver/check-automatic-macro-graph.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.12 route-free automatic floor corridor, TowerIR POI, resource-gate, mutation dependency, and terminal boss graph contract"
  },
  "shared-solver/check-hierarchical-blind-planner.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.13 route-free automatic floor-stage planner contract; bounded not-found is expected and does not prove no route"
  },
  "shared-solver/check-blind-discovery-baseline.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.10c terminal-only D3 input contract plus bounded real OnlyUp not-found baseline; found=false is expected evidence, not a no-route proof"
  },
  "shared-solver/check-discovery-capability-audit.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.10b human-hint inventory, ablation ladder, architectural ceiling, and terminal-only blind-spec contract"
  },
  "shared-solver/check-dp-observer.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic searchDP observer contract; no tower/project load"
  },
  "shared-solver/check-eval-vector.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "observation-only eval vector contract: signed per-field margins, near-term bottleneck vs full-horizon reporting, unknown-evidence is never viable, tracked MT5 first-sweep/third-gate HP-drop chain"
  },
  "shared-solver/check-floor-scout.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-capacity-matrix-k.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-capacity10-j.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-capacity10-j1.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-capacity10-j2.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-goal-archive-audit-i.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-natural-search-a.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-natural-search-b.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hp3834-mt2-candidate2-natural-search.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-hybrid-fair-agenda.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic hybrid-fair agenda contract; no tower/project load"
  },
  "shared-solver/check-live-snapshot-normalization.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-manifest-runner.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "manifest suite selection and fail-fast semantics; no tower/project load"
  },
  "shared-solver/check-milestone-audit.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-mt2-local-order.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-mt2-resource-branch.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-mt5-51533-next-smoke.js": {
    "grade": "smoke",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "maxExpansions=1; allows found||legal failure diagnostics; not a closure test"
  },
  "shared-solver/check-mt5-51533-next.js": {
    "grade": "smoke-wrapper",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "thin compatibility wrapper around check-mt5-51533-next-smoke.js"
  },
  "shared-solver/check-mt5-feasibility-surface.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "MT5 near-term feasibility surface contract: clause expressibility, measured gain provenance, level-up/I608 unsoundness guards, the constant-bound-cannot-prune-third-gate result, and zero-false-prune controls with a live floor-graph refutation"
  },
  "shared-solver/check-mt5-third-gate-resource-timing.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "Tracked MT4 fixture proves the 13846 HP causal benefit of delaying MT4:8,3/I621, then requires the refined milestone graph to reach mt5-third-gate within 500 expansions per segment without action trimming"
  },
  "shared-solver/check-mt5-blueking-long-chain.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.7c tracked MT4 long-chain requalification: every resource-timing milestone through MT5 blueKing closes within 500 expansions per segment, with no action trimming or budget exhaustion and a strict recorded-decision replay"
  },
  "shared-solver/check-post-mt5-long-chain-baseline.js": {
    "grade": "local-regression",
    "allowsNotFound": true,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.8a historical coarse-graph baseline reconstructed after 5.8b: fixed expansions and no wall timeout pin mt7-special80-ready as the first failure, exclude trimming/budget exhaustion, strictly replay the reached prefix, and retain the pre-repair MT6 resource order"
  },
  "shared-solver/check-mt6-defense-timing-causal-repair.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.8b one-variable causal repair: move MT6:2,1 +500 DEF before MT6:6,8 while preserving budgets, DP options, action scope, key, dominance, and selection; special80 changes from the pinned 5.8a failure to a strict-replay-qualified success"
  },
  "shared-solver/check-mt7-left-sword-budget-baseline.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.8c fixed-500 attribution from the exact strict-replay-qualified special80 state: left-sword is feasible and strictly replayable even though its skyline remains live at the expansion ceiling; distinguishes found=true/incomplete-skyline from a route-search failure without changing production search semantics"
  },
  "shared-solver/check-mt7-mt8-strict-replay-attribution.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.8e/5.8g real-fixture closure: preserve the decision-13 legacy witness and exact-post path-17 selection, strictly replay 13/13 suffix and 37/37 full lineage, reproduce the winner final state, reuse all 37 selected post-states, and hard-filter structurally impossible candidates before apply"
  },
  "shared-solver/check-recorded-travel-variant-replay.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.8e/5.8g synthetic resolver controls: retain same-choice travel variants, preserve unique/no/multiple exact-post semantics, reject hard structural mismatches before apply, and reuse the selected post-state without a second winner apply"
  },
  "shared-solver/check-search-outcome-taxonomy.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.8f truth-table, doctor, and solver-job projection controls; found plus incomplete must remain a successful feasible route, with the real MT7 witness qualified separately"
  },
  "shared-solver/check-mt5-route-repair-closure.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-mt5-window-repair-closure.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-objective-spec-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "ObjectiveSpec normalization/comparison/proof controls plus a short real RegionSpec route artifact"
  },
  "shared-solver/check-objective-safe-archive.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.3b1 objective-safe goal archive: terminal comparator retains the objective winner under the goalSkylineLimit cap, objective-search compatibility negative controls, proof claim truncation downgrade, and composed route-length objective metadata"
  },
  "shared-solver/check-objective-spec-live.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "real Chromium replay recomputes and verifies the persisted terminal objective value"
  },
  "shared-solver/check-onlyup-floorfly-dedup-safety.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-onlyup-key-states.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-onlyup-mt7-special80.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-onlyup-segment-dp.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "OnlyUp segmented DP regression plus synthetic one-level and two-level failure-class-driven checkpoint repair coverage for PR-5.6d"
  },
  "shared-solver/check-progressive-monster-planner.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-progressive-to-milestone.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-region-entry-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "bounded live RegionSpec entry contract with fixed controls, schema gates, negative controls, and deterministic rebuild"
  },
  "shared-solver/check-region-route-output-contract.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-4.8b1 runner-owned cleanup with real short OnlyUp and Whiteisland positives, validate-only preservation, strict primitive replay, and not-found/structured-failure stale-output controls; not a full tower route"
  },
  "shared-solver/check-region-specs.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-replay-flag-identity-contract.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.1a1 shadow-only runtime snapshot identity with preserved __leaveLoc__, checkpoint baseline, real simulator changeFloor/floorFly witness, mismatch rejection, and deterministic rebuild"
  },
  "shared-solver/check-replay-flag-merge-cli-contract.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.1a1a replay-runtime per-floor __leaveLoc__ merge, non-initial-floor checkpoint continuation, dual mismatch witnesses, direct route-gui CLI gate, and deterministic rebuild"
  },
  "shared-solver/check-replay-h5save-gui-flow-live.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "PR-5.2b local Chrome/Edge GUI API flow with a real exported h5save, asynchronous play acknowledgement, pause/resume, native loader restore, boundary gate, suffix continuation, and final verification"
  },
  "shared-solver/check-replay-h5save-gui-flow.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.2c Route GUI cached failure status retention, busy/completed/failed play controls, legacy API controls, gate-failure cleanup, real picker/drop upload, and DOM operation smoke"
  },
  "shared-solver/check-replay-h5save-gui.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.1c1 Route GUI tri-state fingerprint status, verified/legacy/failure projection, headless DOM smoke, metadata-only legacy mode, and real CLI/API tampered/missing h5save controls"
  },
  "shared-solver/check-replay-h5save-resume-contract.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.1b deterministic h5save resume-artifact schema, boundary/continuation fields, project/route fingerprint mismatch controls, and report rebuild"
  },
  "shared-solver/check-replay-h5save-resume-live.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "PR-5.1b local Chrome/Edge export, fresh native h5save load, next-decision continuation, final identity, and CLI fingerprint mismatch smoke"
  },
  "shared-solver/check-replay-start-offset-contract.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.1a GUI session start-offset contract with fixed PR-4.8b cross-tower routes, checkpoint composition, exact boundary status, displayed floor/hero, side-effect ordering, and deterministic rebuild"
  },
  "shared-solver/check-replay-start-offset-live.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "PR-5.1a local Chrome/Edge live smoke across both PR-4.8b routes, valid offsets, checkpoint plus offset, and pre-launch out-of-range rejection"
  },
  "shared-solver/check-resource-cluster.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-resource-deferral.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "real OnlyUp prefix + hand-written atk/def threshold; not full auto closure"
  },
  "shared-solver/check-resource-intent-contract.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic shadow-only resource intent evidence contract with deterministic rebuild"
  },
  "shared-solver/check-resource-pocket-order.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-resource-timing-model.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic resource timing unit checks"
  },
  "shared-solver/check-resource-timing.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "depends on ignored routes/latest fixture"
  },
  "shared-solver/check-route-audit.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-route-debugger.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-route-gui-compare.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-route-productization.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-route-record.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-route-repair.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-route-store-exact.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic exact final-state route reconstruction check"
  },
  "shared-solver/check-solver-model-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.3a manual model authority, legacy compatibility, compact solver state/key projection, and invalid-model controls"
  },
  "shared-solver/check-solver-model-runtime-boundary-live.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "PR-5.3a1 real Chromium compact-model replay; verifies partial solver snapshots, raw runtime identity separation, and disabled-field preservation"
  },
  "shared-solver/check-stage-acceptance.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-state-abstraction-audit.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-state-abstraction-collision-inventory.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-state-key-audit.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-teacher-divergence.js": {
    "grade": "diagnostic",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "teacher-forced divergence audit; tracked fixture always; MT5 teacher optional if present"
  },
  "shared-solver/check-teacher-dominance-audit.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic dominance witness continuation audit; diagnostics-only"
  },
  "shared-solver/check-teacher-search-observer.js": {
    "grade": "unit",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "synthetic real-search teacher observer outcome contract"
  },
  "shared-solver/check-whiteisland-trial-resource-order.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-window-repair.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-windows-route-gui-close.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": false,
    "notes": "auto-graded inventory entry; refine when the check becomes a tracked clean-checkout or closure test"
  },
  "shared-solver/check-search-trace-explainability.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.11 decision-depth/floor/action/rejection trace, human-review buckets, and same-control before-after comparison contract"
  },
  "shared-solver/check-solve-task-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.3c SolveTask schema, stable task identity, external compiled:true trust boundary, budget validation, legacy region compatibility"
  },
  "shared-solver/check-solver-job-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.3c job state machine, honest progress, failure classification, cancel, identity binding, micro job lifecycle"
  },
  "shared-solver/check-solver-job-live.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "real Chromium short SolveTask job queued->completed with strict route replay"
  },
  "shared-solver/check-launcher-api.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.3d launcher API contract: registry path safety, task preflight, job lifecycle, SSE, restart persistence"
  },
  "shared-solver/check-launcher-ui-live.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": false,
    "notes": "real Chromium launcher UI smoke: builder, preflight, worker job verified-route, refresh recovery, route metrics"
  },
  "shared-solver/check-solve-task-v2-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4a v2 ordered-region contract: schema, fingerprint, explicit model, regionCandidateLimit, non-goals"
  },
  "shared-solver/check-multi-region-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4a sequential region execution: state transfer, failure stop, boundary pruning"
  },
  "shared-solver/check-multi-region-route-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4a Commit 3: multi-region-route.v1 composite, exact boundary fingerprints, result regions, unified entry"
  },
  "shared-solver/check-perf-baseline-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4b Commit 1: deterministic perf baseline schema, result parity, structural stability"
  },
  "shared-solver/check-route-free-state-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4b Commit 2: canonical DP route-free state, rawRouteLength semantics, Commit-1 parity"
  },
  "shared-solver/check-tower-ir-shadow-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4b Commit 3: single-Region TowerIR compile determinism, structure, shadow parity on representative corpus, observation isolation, immutability"
  },
  "shared-solver/check-key-dependency-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4c Commit 1 Repair 3: complete travel-variant-set dominance coverage (findChoiceRecords, no first-record-only), equivalent vs metadata-only split, exact goal predicate floorId+exp"
  },
  "shared-solver/check-dual-key-shadow-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4c Commit 2 Repair: independent candidate key builds (no exact-key cache in gate), equivalent->reject accounting, event vs occupancy split, negative state delta, perf-tracker key phase estimate"
  },
  "shared-solver/check-candidate-key-promotion-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4c Commit 3 Repair: start-component ablation profile, split field distribution (32/32 only startComponentId), real strict-replay Gate B -> PROMOTION_CANDIDATE (without-start-component, delta 0)"
  },
  "shared-solver/check-candidate-key-paired-benchmark.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4d Repair + real-route benchmark cleanup: dpKeyProfile alone selects guarded experimental builder; smoke reuses one strict A/B pair and qualification uses four A/B/B/A search rounds"
  },
  "shared-solver/check-real-route-performance-qualification.js": {
    "grade": "diagnostic",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "Research-only MT2-MT5 performance harness: tracked route fixtures create trusted checkpoints, then A production key vs B injected without-start-component candidate run fresh branching milestone search; no production promotion or guard expansion"
  },
  "shared-solver/check-walk-reachability-fast-path.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "Tracked MT4 regression proves safe-fast walk reachability and primitive-action parity against legacy exact simulation; poison, hazards, live auto events, and directional tools fail back to exact"
  },
  "shared-solver/check-walk-reachability-performance.js": {
    "grade": "diagnostic",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "Independent-process legacy-exact vs safe-fast comparison on the tracked MT4 to MT5 branching workload; exact final state, route, search scale, and strict replay parity are mandatory while timing remains directional"
  },
  "shared-solver/check-reachability-reuse-attribution.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.9a candidate-default MT1 exp9 attribution: exact cache unchanged, safe-fast misses grouped by current-floor topology, normalized closure parity and pinned winner/route/objective required"
  },
  "shared-solver/check-reachability-skeleton-cache.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.9b independent-process A/B/B/A: exact-state LRU parity, state-free safe-fast skeleton cache, per-exact-state safety classification, 116-state action/successor exact corpus, pinned winner/route/objective/scale and strict replay"
  },
  "shared-solver/check-reachability-rebase-attribution.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.9c candidate-default MT1 exp9 rebase allocation/consumer attribution: eager nodes, state/key reads, travel-state escapes, complete named consumer matrix and pinned winner/route/objective/scale/strict replay"
  },
  "shared-solver/check-topology-first-materialization.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.9d independent-process A/B topology-first safe-fast materialization: pinned 116-state/434-action successor corpus, winner/route/objective/scale/strict replay and real clone/key-build reduction"
  },
  "shared-solver/check-remaining-materialization-attribution.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.9e observation-only attribution of all topology materializations without final travel-state escape to battle pre-action lethal/no-damage-info rejection, with overlap union control and pinned winner/route/objective/scale/strict replay"
  },
  "shared-solver/check-battle-evaluation-projection.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.9f independent-process A/B/B/A battle evaluation projection repair: immutable stance metadata, base-state isolation, exact action/successor corpus and winner/route/objective/scale/strict replay parity, with rejected-battle clone elimination"
  },
  "shared-solver/check-reachability-optimization-requalification.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.9g independent-process A/B/B/A cumulative reachability optimization closure across six MT1 workloads and tracked MT2-MT3 plus MT4-MT5-entry routes; exact winner/route/scale/strict replay parity and per-workload non-increasing structural cost are mandatory"
  },
  "shared-solver/check-full-solve-hotspot-reprofiling.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.10a independent-process exclusive/self-time hotspot reprofiling across representative MT1, tracked MT4-MT5 entry, full MT5 closure, and special80-MT8 closure; inclusive phase compatibility, residual wall, exact outcome, deterministic scale, and strict replay remain explicit"
  },
  "shared-solver/check-goal-directed-search.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "Tracked MT2 to MT3 exact parity plus MT4 to MT5 first-feasible comparison for goal-directed agenda ordering; ordered downstream goal dependencies and explicit adaptive-feasible intent remain opt-in"
  },
  "shared-solver/check-candidate-quality-shadow.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.7a capture-all materialized goal candidates, exact 1/2/4/8 retention decisions including DP-key dedup vs capacity, and distinct stop-condition A/B/C controls"
  },
  "shared-solver/check-route-search-portfolio.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.6e controlled independent-process route portfolio; serial/parallel exact state and strict route replay parity are mandatory while timing is directional"
  },
  "shared-solver/check-goal-feasibility-bounds.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.6c admissible necessary-condition bounds, unknown-evidence keep semantics, and structured prune witness diagnostics"
  },
  "shared-solver/check-mt1-workload-matrix-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4f: MT1 workload matrix promotion-parity (6 workloads x default/candidate/rollback), A==B==pinned baseline + effective-profile diagnostics; PR-5.4e partition qualification already certified safety"
  },
  "shared-solver/check-mt1-default-promotion-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.4f: MT1 default promotion + explicit rollback contract (Gates A-H): scope-aware implicit default, rollback restores production path, unapproved scope fallback vs explicit fail-closed, representative strict replay, production invariants"
  },
  "shared-solver/check-mt1-post-promotion-regression-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.4g: post-promotion full-tower regression (S1-S4): single-Region default->candidate + pinned, explicit rollback->production scale, unapproved-scope implicit fallback, campaign/multi-Region v2 per-region isolation (approved MT1->candidate, unapproved->production, no leak)"
  },
  "shared-solver/check-multi-region-key-shadow-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.5a: multi-Region dual-key shadow + boundary corpus (research only, no production change): 3-layer corpus (pre-boundary/boundary-transfer/post-boundary), state + boundary partition audits, ordered CEGAR (boundary-transfer first), negative-control fail-visible"
  },
  "shared-solver/check-multi-region-boundary-matrix-contract.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.5d/5.5e tracked same-project hole closure: 19-workload matrix stays 44/44/535 with Start green-key acquire/openDoor consume; maintained mt1-mt2 fixture live-replays an exact recorded travel variant to a real MT1->MT2 changeFloor edge, with fail-closed parent/floor/visited provenance controls. Both holes filled, candidate collision remains absent, verdict pinned NO_COLLISION_OBSERVED"
  },
  "shared-solver/check-static-combat-economy-core.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.20a/5.20b verifies the frozen H1-H6 acceptance in a single process with no worker pool: H1 fixed cases match the unpruned exhaustive oracle on found, optimal final hp AND goal archive set; H2 the invest-before-conserve case is missed by a conserve-only schedule at maxExpandedStates=32 while the adaptive schedule switches CONSERVE_HP->BREAK_BOTTLENECK and reaches the goal; H3 32 fixed seeds with at most 7 interactions agree with the oracle; H4 wall<10s, observed peak RSS<256MB, compact stdout<5KB; H5 the goal Pareto archive keeps >=2 mutually non-dominated finishes on the trade-off case; H6 the scale gate solves both 24-32 interaction cases inside 50000 expansions with peakFrontier<=10000. Also locks the exact-budget boundary (budget==expanded is SOLVED, budget-1 is RESOURCE_LIMIT), that agenda tickets carry only id/rank, and that heap rebuild preserves pop order. Every successful route is strictly replayed and a permanently attack-blocked case guards against false success."
  },
  "shared-solver/check-static-combat-economy-h5-adapter.js": {
    "grade": "unit-plus-micro",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.20c locks A1-A4 in a single process with no worker pool, no disk cache and no real tower: A1 the native H5-shaped fixture adapts automatically and equals an independently derived expectedStaticProblem; A2 the static solver finds a route and goal archive on its own, every archive route strictly replays and every mapped H5 step matches the recorded provenance cell for cell; A3 41 mutations covering each unsupported semantic all give eligible=false, problem=null and no route; A4 wall<10s, observed peak RSS<256MB, compact stdout<5KB."
  },
  "shared-solver/check-onlyup-mt1-real-route-gate.js": {
    "grade": "closure",
    "allowsNotFound": false,
    "requiresStrictReplay": true,
    "cleanCheckout": true,
    "notes": "PR-5.20d locks the real-tower gate: source identity (title='Only Up', start MT1@6,7, target MT2), the fixed 50000/30s/256MB budget, verdict REAL_MT1_GATE_PASSED, final floor MT2 for both search and strict replay, per-field hero/inventory/flags/floorMutations equality plus identical exact state keys, every recorded decision re-derived from the live enumeration, and zero unresolved required choices. Also unit tests the difficulty guard and proves the choice resolver refuses ambiguous or consequential choices and never picks by option text. Deliberately does NOT lock route content, route length or monster order -- the search decides those. A failure means 5.20 static promotion is frozen."
  },
  "shared-solver/check-onlyup-first-region-real-route-gate.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.21a/PR-5.21b first-region direct gate: ONE MT1->MT6 search from the real firstData start state under the same fixed budget the MT2 gate passed under (50000 expansions / 30s / 256MB, single process, no worker, no disk frontier). It does NOT solve MT2..MT5 first and does NOT stitch intermediate results. Validates the gate contract (real project identity, Chaos difficulty at start, decision depth 0, budget untampered, no difficulty lever used, no guessed choice) and FREEZES the real outcome, which is currently a failure: REAL_FIRST_REGION_GATE_FAILED / RESOURCE_LIMIT, binding constraint may be rss or wall across environment samples; expansion cap does not bind; do not infer that rss and wall necessarily trip near-simultaneously; bestProgress floor reached MT2. allowsNotFound=true because the frozen result is a genuine not-found; a PASS would deliberately fail the checker so the expectation is re-baselined on purpose rather than drifting."
  },
  "shared-solver/check-action-expansion-cache-correctness.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.21b/PR-5.21b1 stateful exact-cache removal regression and 100-expansion consistency contract"
  },
  "shared-solver/check-expansion-profiler-parity.js": {
    "grade": "local-regression",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.22a expansion-cost profiler parity with frozen 100-expansion contract, attribution consistency, and overhead qualification"
  },
  "shared-solver/check-expansion-cost-attribution.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.22a first-region direct search expansion-cost attribution, top-level self-time breakdown, inclusive subsystem metrics, and slow-expansion sampling"
  },
  "shared-solver/check-onlyup-first-region-expansion-profile.js": {
    "grade": "integration-local",
    "allowsNotFound": true,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.22a real OnlyUp first-region direct gate execution with opt-in expansion profiling"
  },
  "shared-solver/check-auto-battle-attribution-contract.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.22c2 auto-battle attribution contract & reverify rejection fixture demonstrating live hazardRebuildWithoutInterveningMutation counter"
  },
  "shared-solver/check-auto-battle-fast-reject-matrix.js": {
    "grade": "integration-local",
    "allowsNotFound": false,
    "requiresStrictReplay": false,
    "cleanCheckout": true,
    "notes": "PR-5.22d auto-battle safe fast-reject adversarial boundary matrix validating zero false rejects across vanilla, special, and modified states"
  }
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
        "shared-solver/check-automatic-macro-graph.js",
        "shared-solver/check-hierarchical-blind-planner.js",
        "shared-solver/check-teacher-divergence.js",
        "shared-solver/check-manifest-runner.js",
        "shared-solver/check-dp-observer.js",
        "shared-solver/check-objective-safe-archive.js",
        "shared-solver/check-solve-task-contract.js",
        "shared-solver/check-solve-task-v2-contract.js",
        "shared-solver/check-solver-job-contract.js",
        "shared-solver/check-launcher-api.js",
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
        "shared-solver/check-multi-region-contract.js",
        "shared-solver/check-multi-region-route-contract.js",
        "shared-solver/check-perf-baseline-contract.js",
        "shared-solver/check-route-free-state-contract.js",
        "shared-solver/check-tower-ir-shadow-contract.js",
        "shared-solver/check-key-dependency-contract.js",
        "shared-solver/check-dual-key-shadow-contract.js",
        "shared-solver/check-candidate-key-promotion-contract.js",
        "shared-solver/check-candidate-key-paired-benchmark.js",
        "shared-solver/check-real-route-performance-qualification.js",
        "shared-solver/check-walk-reachability-fast-path.js",
        "shared-solver/check-walk-reachability-performance.js",
        "shared-solver/check-reachability-reuse-attribution.js",
        "shared-solver/check-reachability-skeleton-cache.js",
        "shared-solver/check-reachability-rebase-attribution.js",
        "shared-solver/check-topology-first-materialization.js",
        "shared-solver/check-remaining-materialization-attribution.js",
        "shared-solver/check-battle-evaluation-projection.js",
        "shared-solver/check-reachability-optimization-requalification.js",
        "shared-solver/check-full-solve-hotspot-reprofiling.js",
        "shared-solver/check-goal-directed-search.js",
        "shared-solver/check-candidate-quality-shadow.js",
        "shared-solver/check-mt1-workload-matrix-contract.js",
        "shared-solver/check-mt1-default-promotion-contract.js",
        "shared-solver/check-mt1-post-promotion-regression-contract.js",
        "shared-solver/check-multi-region-key-shadow-contract.js",
        "shared-solver/check-multi-region-boundary-matrix-contract.js",
        "shared-solver/check-action-expansion-cache-correctness.js",
        "shared-solver/check-expansion-profiler-parity.js",
        "shared-solver/check-auto-battle-attribution-contract.js",
        "shared-solver/check-auto-battle-fast-reject-matrix.js"
      ],
      requiredCommands: ["check:no-tower-solver-js"],
      paths: ["shared-solver/check-launcher-api.js"],
    },
  },
  modules,
  tests,
};

const outPath = path.join(root, "solver-manifest.json");
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(`modules=${Object.keys(modules).length} tests=${Object.keys(tests).length}`);
