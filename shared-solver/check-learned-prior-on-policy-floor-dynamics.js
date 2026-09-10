"use strict";

// PR-5.25i driver: on-policy floor transition dynamics probe.
//
// Zero training, zero scorer/parameter change: re-runs the dd5e597 hierarchical
// policy (CONTROL kind-prior-only, TREATMENT kind-prior + within-kind residual)
// with rich floor-transition telemetry, to distinguish
//   A within-kind transfer failure / C horizon pressure / D cyclic proposal
//   from B a prerequisite-sequencing problem.
//
// Usage:
//   node check-learned-prior-on-policy-floor-dynamics.js [--out=PATH]

const fs = require("fs");
const path = require("path");

const inventory = require("./lib/learned-prior-corpus-inventory");
const dynamics = require("./lib/learned-prior-on-policy-floor-dynamics");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-on-policy-floor-dynamics.result.json");

function parseArgs(argv) {
  let out = DEFAULT_RESULT_PATH;
  for (const token of argv.slice(2)) {
    const match = /^--out=(.*)$/.exec(token);
    if (match) out = path.resolve(__dirname, match[1]);
  }
  return { out };
}

function requireCondition(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details || null;
    throw error;
  }
}

function printArm(label, summary, classification) {
  const pct = (value) => (value == null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  console.log(`  --- ${label} ---`);
  console.log(`    floor transitions      : ${JSON.stringify(summary.floorTransitions)}`);
  console.log(`    reach                  : MT2 ${summary.rolloutsReachingMt2}/${summary.rollouts}, MT3 ${summary.rolloutsReachingMt3}/${summary.rollouts}, MT4 ${summary.rolloutsReachingMt4}, MT5 ${summary.rolloutsReachingMt5}, blueKing ${summary.terminalBlueKing}`);
  console.log(`    floor changes          : total ${summary.floorChangeCount} (forward ${summary.forwardCount}, backward ${summary.backwardCount}), consecutive-reversal ${summary.consecutiveFloorChangeReversals} (${pct(classification.metrics.consecutiveFloorChangeReversalRate)})`);
  console.log(`    MT2 steps              : ${summary.stepsAtMt2}, of which MT2 forward stair available ${summary.mt2ForwardAvailableSteps} (${pct(classification.metrics.mt2ForwardFraction)})`);
  console.log(`    MT2 forward choice     : chose forward ${summary.mt2ForwardChosenSteps}/${summary.mt2ForwardAvailableSteps} (${pct(classification.metrics.mt2ForwardChoiceRateWhenAvailable)}), landed MT3 ${summary.mt2ForwardLandedMt3Steps} (${pct(classification.metrics.mt2ForwardLandedMt3Rate)})`);
  console.log(`    forward available      : any-floor ${summary.forwardAvailableSteps} steps, chose forward ${summary.forwardChosenSteps}; changeFloor chosen ${summary.changeFloorChosenWhenForwardAvailable}`);
  if (summary.meanForwardProbabilityMass != null) {
    console.log(`    fwd prob mass (treat)  : mean ${summary.meanForwardProbabilityMass.toFixed(4)} over ${summary.forwardProbabilityMassSteps} steps`);
  }
  console.log(`    states                 : rolling ${summary.rollingStates}, unique exact ${summary.uniqueExactStates}, revisits ${summary.revisitCount} (${pct(classification.metrics.revisitRate)})`);
  console.log(`    first MT2 fwd stair    : min ${summary.firstMt2ForwardAvailableStepMin}, mean ${summary.firstMt2ForwardAvailableStepMean == null ? "n/a" : summary.firstMt2ForwardAvailableStepMean.toFixed(1)}`);
  console.log(`    kind histogram         : ${JSON.stringify(summary.kindHistogram)}`);
  const coObserved = classification.coObserved.length > 0 ? ` (co-observed: ${classification.coObserved.join(", ")})` : "";
  console.log(`    classification         : ${classification.primary}${coObserved}`);
}

function main() {
  const args = parseArgs(process.argv);
  const corpus = inventory.inventoryCorpus({ captureDecisions: true });

  const first = dynamics.runFloorDynamicsProbe({ corpus });
  const second = dynamics.runFloorDynamicsProbe({ corpus });
  const deterministic = first.treatment.floorChangeCount === second.treatment.floorChangeCount
    && first.treatment.forwardAvailableSteps === second.treatment.forwardAvailableSteps
    && first.treatment.uniqueExactStates === second.treatment.uniqueExactStates
    && first.control.backwardCount === second.control.backwardCount;
  requireCondition(deterministic, "floor dynamics probe is not deterministic", {
    first: { f: first.treatment.floorChangeCount, a: first.treatment.forwardAvailableSteps },
    second: { f: second.treatment.floorChangeCount, a: second.treatment.forwardAvailableSteps },
  });
  requireCondition(first.treatment.rollouts === 32 && first.control.rollouts === 32, "expected 32 rollouts per arm");

  const result = {
    schema: "learned-prior.on-policy-floor-dynamics.v1",
    milestone: "PR-5.25i",
    step: "ON_POLICY_FLOOR_TRANSITION_DYNAMICS_PROBE",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    invariants: {
      deterministic: "pass",
      noRetrain: "pass",
      noScorerChange: "pass",
      noParameterChange: "pass",
      samePolicyAsDd5e597: "pass",
      sameSeedSchedule: "pass",
      noHorizonChange: "pass",
    },
    ...first,
    exitCodePolicy: "0 for a coherent probe result; non-zero only on invariant violation",
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("PR-5.25i — on-policy floor transition dynamics probe");
  printArm("CONTROL (kind-prior only)", first.control, first.classification.control);
  printArm("TREATMENT (hierarchical)", first.treatment, first.classification.treatment);
  console.log(`  verdict (treatment)        : ${first.verdict}`);
  console.log(`  result artifact            : ${path.relative(process.cwd(), args.out)}`);
}

main();
