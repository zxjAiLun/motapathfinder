"use strict";
/**
 * PR-5.25x Phase 1 - Combat-Progress Prevalence Audit.
 *
 * STATIC / REPLAY ONLY - no search change, no search run.
 *
 * Question: how prevalent is the combat-progress signal (a transition that
 * itself produces permanent combat-stat growth: atk/def/mdef/hpmax/lv
 * increase or an equipment change) along the tracked PR-5.25o MT3 winner
 * trajectory, and does the general rule flag the cp#8-shaped battle WITHOUT
 * knowing its identity or oracle membership?
 *
 * For every winner pre-state: enumerate ALL real primitive actions, apply
 * each, and classify the transition by the state delta only. Frontier
 * membership (F3) is used for the aggregate breakdown only; the classifier
 * itself never sees identity, kind, floor, or oracle data.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { actionToSemanticIdentity, isCombatProgressTransition } = require("./lib/transport-collapse");
const { resolveRecordedAction } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");
const { resolveRelativeFloor } = require("./lib/floor-transitions");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const WINNER_ARTIFACT = path.resolve(__dirname, "..", "docs", "260912", "qualification", "5-25o-cap1024-winner.json");
const CP_SUMMARY_MARKER = "battle:skeletonWarrior@MT1:2,1";
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525x-combat-progress-prevalence.json");

function identityForAction(project, action, state) {
  const floorId = action.floorId || (state && state.floorId) || "";
  let nextState = null;
  if (action.kind === "changeFloor") {
    const raw = (action.changeFloor && action.changeFloor.floorId) || null;
    let resolved = raw;
    try { resolved = resolveRelativeFloor(project, floorId, raw); } catch (_) { resolved = raw; }
    nextState = { floorId: resolved };
  }
  return actionToSemanticIdentity(action, state, nextState, project);
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
  const initialState = simulator.createInitialState({ rank: "chaos" });
  const f3 = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: "MT3" });

  const artifact = JSON.parse(fs.readFileSync(WINNER_ARTIFACT, "utf8"));
  const trace = artifact.winner.routeTrace;

  const rows = [];
  const byKind = {};
  const byFloor = {};
  let totalSuccessors = 0;
  let flaggedTotal = 0;
  let flaggedFrontierGuided = 0;
  let flaggedNeutral = 0;
  let applyFailures = 0;
  let cp8Flagged = null;
  let cp8Step = null;

  let state = initialState;
  for (let i = 0; i < trace.length; i += 1) {
    const entry = trace[i];
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, state, {
      ...entry.action,
      postExactStateKey: entry.postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) throw new Error(`winner replay failed at step ${i}`);

    for (const action of actions) {
      totalSuccessors += 1;
      let next = null;
      try {
        next = simulator.applyAction(state, action, { storeRoute: false });
      } catch (_) {
        applyFailures += 1;
        continue;
      }
      if (!next || !next.hero || (next.hero.hp != null && next.hero.hp <= 0)) continue;
      const flagged = isCombatProgressTransition(state, next);
      const identity = identityForAction(project, action, state);
      const frontierGuided = f3.frontierSet.has(identity);
      if (!flagged) continue;
      flaggedTotal += 1;
      if (frontierGuided) flaggedFrontierGuided += 1;
      else flaggedNeutral += 1;
      const kind = action.kind;
      byKind[kind] = (byKind[kind] || 0) + 1;
      const floor = state.floorId || "unknown";
      byFloor[floor] = (byFloor[floor] || 0) + 1;
      rows.push({
        step: i,
        kind,
        floorId: state.floorId,
        summary: action.summary || null,
        identity,
        frontierGuided,
        hero: {
          atk: state.hero.atk,
          def: state.hero.def,
          mdef: state.hero.mdef,
          hpmax: state.hero.hpmax,
          lv: state.hero.lv,
        },
      });
      if (action.summary === CP_SUMMARY_MARKER && cp8Flagged === null) {
        cp8Flagged = true;
        cp8Step = i;
      }
    }
    if (resolved.action.summary === CP_SUMMARY_MARKER && cp8Step === null) {
      cp8Step = i;
      if (cp8Flagged === null) cp8Flagged = false;
    }
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`winner replay died at step ${i}`);
  }

  const summary = {
    milestone: "PR-5.25x",
    audit: "COMBAT_PROGRESS_PREVALENCE",
    searchRun: false,
    classifierInputs: "before/after state delta only (atk/def/mdef/hpmax/lv/equipment)",
    cp8IdentityUsedByClassifier: false,
    oracleMembershipUsedByClassifier: false,
    winnerSteps: trace.length,
    totalSuccessors,
    applyFailures,
    flaggedTotal,
    flaggedFrontierGuided,
    flaggedNeutral,
    flaggedByKind: byKind,
    flaggedByFloor: byFloor,
    cp8PostHocCheck: { summary: CP_SUMMARY_MARKER, step: cp8Step, flagged: cp8Flagged },
    rows,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.25x combat-progress prevalence audit (static, no search)");
  console.log(`  winner steps: ${trace.length}, strategic successors enumerated: ${totalSuccessors} (apply failures: ${applyFailures})`);
  console.log(`  combat-progress flagged: ${flaggedTotal} (frontier-guided: ${flaggedFrontierGuided}, neutral: ${flaggedNeutral})`);
  console.log(`  flagged by kind: ${JSON.stringify(byKind)}`);
  console.log(`  flagged by floor: ${JSON.stringify(byFloor)}`);
  console.log(`  cp#8 post-hoc: step=${cp8Step} flagged=${cp8Flagged}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
