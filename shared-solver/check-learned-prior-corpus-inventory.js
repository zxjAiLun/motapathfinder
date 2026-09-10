"use strict";

// PR-5.25d Step 0 driver: run the non-overlapping trajectory corpus inventory
// and persist the evidence.  This performs NO training and NO rollouts, and it
// does not change production solver behaviour.
//
// Usage:
//   node check-learned-prior-corpus-inventory.js [--out=PATH]

const fs = require("fs");
const path = require("path");

const inventory = require("./lib/learned-prior-corpus-inventory");

const DEFAULT_RESULT_PATH = path.resolve(__dirname, "routes", "generated", "learned-prior-corpus-inventory.result.json");

function parseArgs(argv) {
  let out = DEFAULT_RESULT_PATH;
  for (const token of argv.slice(2)) {
    const match = /^--out=(.*)$/.exec(token);
    if (match) out = path.resolve(__dirname, match[1]);
  }
  return { out };
}

function main() {
  const args = parseArgs(process.argv);
  const report = inventory.inventoryCorpus();
  const result = {
    schema: "learned-prior.corpus-inventory.v1",
    milestone: "PR-5.25d",
    step: "STEP_0_NON_OVERLAPPING_CORPUS_INVENTORY",
    generatedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    semantics: {
      decisionIdentity: "(buildStateKey(reconstructedState), chosenActionFingerprint)",
      trainFamily: "chaos MT1 start, final floor <= MT3",
      heldOutFamily: "final floor >= MT4 qualification family",
      keyModes: inventory.KEY_MODES,
      note: "read-only inventory; no training, no rollouts, no production change",
    },
    ...report,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const a = report.analysis;
  console.log("PR-5.25d Step 0 — non-overlapping trajectory corpus inventory");
  console.log(`  scanned / replayed        : ${report.scannedFiles} / ${report.replayedFiles} (${report.totalDecisionsReplayed} decisions)`);
  console.log(`  key modes                 : ${JSON.stringify(report.modeHistogram)}`);
  console.log(`  distinct routes           : ${report.distinctRoutes} (duplicates dropped: ${report.duplicateRoutes.length})`);
  console.log(`  distinct signatures       : ${report.distinctSignatures}`);
  console.log(`  TRAIN  (maxReached <= MT3): ${a.trainFamily.routeCount} routes / ${a.trainFamily.decisions} decisions / ${a.trainFamily.distinctSignatures} signatures`);
  console.log(`  HELDOUT(maxReached >= MT4): ${a.heldOutFamily.routeCount} routes (near ${a.heldOutFamily.nearRouteCount} / deep ${a.heldOutFamily.deepRouteCount}) / ${a.heldOutFamily.decisions} decisions / ${a.heldOutFamily.distinctUnseenSignatures} distinct unseen signatures`);
  console.log(`  unseen decision sum       : ${a.heldOutFamily.unseenDecisionSum} | max on one held-out route: ${a.maxUnseenDecisionsOnAnyHeldOutRoute}`);
  for (const route of a.heldOutFamily.routes) {
    console.log(`    ${route.layer.padEnd(4)} unseen ${String(route.unseenDecisions).padStart(3)}/${String(route.decisions).padStart(3)} (${(route.unseenFraction * 100).toFixed(0)}%) final=${route.finalFloor} max=${route.maxReachedFloorOrdinal} ${route.relPath.replace("shared-solver/routes/", "")}`);
  }
  console.log(`  not-replayed histogram    : ${JSON.stringify(report.failureHistogram)}`);
  console.log(`  VERDICT                   : ${a.verdict}`);
  console.log(`  result artifact           : ${path.relative(process.cwd(), args.out)}`);
}

main();
