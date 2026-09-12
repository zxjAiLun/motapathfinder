"use strict";
/**
 * PR-5.25p Diagnostic 1 - Terminal-Goal-Dependent Frontier Differential.
 *
 * STATIC ONLY. This script never runs a search: it builds the autonomous
 * dependency frontier twice for the same project and the same canonical CHAOS
 * MT1 start state, once per terminal goal, and differences them.
 *
 *   F3 = buildDependencyFrontier(project, initialState, floorReached(MT3))
 *   F4 = buildDependencyFrontier(project, initialState, floorReached(MT4))
 *
 * Motivation: the PR-5.25p MT4 run reused the PR-5.25o search policy verbatim,
 * but `frontierSet` is derived from the terminal goal, and `frontierSet`
 * membership is exactly what sets `frontierGuided`, which is exactly what the
 * bounded-candidate retention rank uses (goal=0, frontierGuided=10,
 * paretoAdmitted=20, plain=30). So changing the goal can change which pending
 * candidates survive the cap before any MT3 transition is reached.
 *
 * This diagnostic answers: is the MT4 miss confounded by terminal-goal-dependent
 * frontier reordering? It reports set diffs overall and restricted to MT1/MT2,
 * target-transition and resource/return-identity diffs, the PR-5.25o winner's
 * action membership under both frontiers, and guided-class flips for every legal
 * successor along the winner's replayed states.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { buildDependencyFrontier } = require("./lib/dependency-frontier");
const { actionToSemanticIdentity } = require("./lib/transport-collapse");
const { resolveRecordedAction } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");
const { resolveRelativeFloor } = require("./lib/floor-transitions");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const WINNER_ARTIFACT = path.resolve(__dirname, "..", "docs", "260912", "qualification", "5-25o-cap1024-winner.json");
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525p-frontier-differential.json");

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT11",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    searchGraphMode: "primitive",
    walkReachabilityMode: "safe-fast",
  });
}

/** Identity strings are `<kind>:<floor>:...` except mutation `<mutation>:<hook>:<floor>:<at>`. */
function floorFromIdentity(identity) {
  const parts = String(identity).split(":");
  if (parts[0] === "mutation") return parts[2] || null;
  return parts[1] || null;
}

function kindFromIdentity(identity) {
  return String(identity).split(":")[0];
}

function diffSets(f3, f4) {
  const only3 = [...f3].filter((id) => !f4.has(id)).sort();
  const only4 = [...f4].filter((id) => !f3.has(id)).sort();
  const inter = [...f3].filter((id) => f4.has(id)).sort();
  return { intersection: inter, f3Only: only3, f4Only: only4 };
}

function groupByIdentity(list) {
  const byFloor = {};
  const byKind = {};
  for (const id of list) {
    const floor = floorFromIdentity(id) || "unknown";
    const kind = kindFromIdentity(id);
    byFloor[floor] = (byFloor[floor] || 0) + 1;
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  return { byFloor, byKind };
}

function summarizeTransitions(frontier) {
  return (frontier.derivedTargetTransitions || []).map((t) => ({
    floorId: t.floorId,
    at: t.at,
    targetFloorId: t.targetFloorId,
    transition: t.transition,
  }));
}

/** Cheap exact identity: only changeFloor depends on nextState, and it can be resolved statically. */
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

/** Replay the promoted PR-5.25o winner to recover its per-step pre-states. No search is invoked. */
function replayWinnerStates(simulator, project, trace) {
  let state = simulator.createInitialState({ rank: "chaos" });
  const steps = [];
  for (let i = 0; i < trace.length; i += 1) {
    const entry = trace[i];
    const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
    const resolved = resolveRecordedAction(simulator, state, {
      ...entry.action,
      postExactStateKey: entry.postExactStateKey || null,
    }, { candidates: actions });
    if (!resolved || !resolved.action) {
      throw new Error(`winner replay failed to resolve step ${i} (${entry.action.summary}): ${resolved && resolved.reason}`);
    }
    steps.push({ index: i, floorId: state.floorId, preState: state, action: resolved.action });
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`winner replay died at step ${i}`);
  }
  return { steps, finalState: state, finalKey: buildStateKey(state) };
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const simulator = makeSimulator(project);
  const initialState = simulator.createInitialState({ rank: "chaos" });

  const f3 = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: "MT3" });
  const f4 = buildDependencyFrontier(project, initialState, { type: "floorReached", floorId: "MT4" });

  const overall = diffSets(f3.frontierSet, f4.frontierSet);

  const PRE = new Set(["MT1", "MT2"]);
  const pre3 = new Set([...f3.frontierSet].filter((id) => PRE.has(floorFromIdentity(id))));
  const pre4 = new Set([...f4.frontierSet].filter((id) => PRE.has(floorFromIdentity(id))));
  const preDiff = diffSets(pre3, pre4);

  const oGroup = { f3Only: groupByIdentity(overall.f3Only), f4Only: groupByIdentity(overall.f4Only) };
  const preGroup = { f3Only: groupByIdentity(preDiff.f3Only), f4Only: groupByIdentity(preDiff.f4Only) };

  // --- Winner action membership under both frontiers ---
  const artifact = JSON.parse(fs.readFileSync(WINNER_ARTIFACT, "utf8"));
  const trace = artifact.winner.routeTrace;
  const winner = replayWinnerStates(simulator, project, trace);

  const membership = { BOTH_GUIDED: 0, F3_ONLY: 0, F4_ONLY: 0, NEITHER: 0 };
  const membershipSteps = winner.steps.map((step) => {
    const identity = identityForAction(project, step.action, step.preState);
    const inF3 = f3.frontierSet.has(identity);
    const inF4 = f4.frontierSet.has(identity);
    let cls;
    if (inF3 && inF4) cls = "BOTH_GUIDED";
    else if (inF3) cls = "F3_ONLY";
    else if (inF4) cls = "F4_ONLY";
    else cls = "NEITHER";
    membership[cls] += 1;
    return {
      step: step.index,
      floorId: step.floorId,
      summary: step.action.summary,
      semanticIdentity: identity,
      inF3,
      inF4,
      classification: cls,
    };
  });

  // --- Guided-class flips over every legal successor along the winner states ---
  const flips = { F3_GUIDED_TO_F4_NEUTRAL: 0, F3_NEUTRAL_TO_F4_GUIDED: 0, BOTH_GUIDED: 0, NEITHER: 0 };
  const perKind = {};
  const observedActionIdentities = new Set();
  let changeFloorEnumeratedTotal = 0;
  let changeFloorEnumeratedWithTarget = 0;
  const flipSteps = [];
  for (const step of winner.steps) {
    const actions = (simulator.enumeratePrimitiveActions(step.preState) || {}).actions || [];
    const seen = new Set();
    let legal = 0;
    const local = { F3_GUIDED_TO_F4_NEUTRAL: 0, F3_NEUTRAL_TO_F4_GUIDED: 0, BOTH_GUIDED: 0, NEITHER: 0 };
    const examples = { F3_GUIDED_TO_F4_NEUTRAL: [], F3_NEUTRAL_TO_F4_GUIDED: [] };
    for (const action of actions) {
      const identity = identityForAction(project, action, step.preState);
      const dedupeKey = `${identity}::${JSON.stringify(action.path || [])}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      legal += 1;
      observedActionIdentities.add(identity);
      if (action.kind === "changeFloor") {
        changeFloorEnumeratedTotal += 1;
        if (action.target) changeFloorEnumeratedWithTarget += 1;
      }
      const inF3 = f3.frontierSet.has(identity);
      const inF4 = f4.frontierSet.has(identity);
      let cls;
      if (inF3 && inF4) cls = "BOTH_GUIDED";
      else if (inF3) cls = "F3_GUIDED_TO_F4_NEUTRAL";
      else if (inF4) cls = "F3_NEUTRAL_TO_F4_GUIDED";
      else cls = "NEITHER";
      local[cls] += 1;
      flips[cls] += 1;
      const bucket = perKind[action.kind] || (perKind[action.kind] = { total: 0, BOTH_GUIDED: 0, NEITHER: 0, F3_GUIDED_TO_F4_NEUTRAL: 0, F3_NEUTRAL_TO_F4_GUIDED: 0 });
      bucket.total += 1;
      bucket[cls] += 1;
      if ((cls === "F3_GUIDED_TO_F4_NEUTRAL" || cls === "F3_NEUTRAL_TO_F4_GUIDED") && examples[cls].length < 5) {
        examples[cls].push(identity);
      }
    }
    flipSteps.push({ step: step.index, floorId: step.floorId, legalSuccessors: legal, local, examples });
  }

  // --- Effective delta: frontier differences that an enumerated action could actually match ---
  const effectiveF3Only = overall.f3Only.filter((id) => observedActionIdentities.has(id));
  const effectiveF4Only = overall.f4Only.filter((id) => observedActionIdentities.has(id));
  const countChangeFloor = (set) => [...set].filter((id) => kindFromIdentity(id) === "changeFloor").length;
  const identityContract = {
    note: "PR-5.25q repair: actionToSemanticIdentity now resolves changeFloor coordinates explicit target -> action x/y -> stance, so enumerated changeFloor identities use the stair tile and can match frontier POIs; before this repair they fell back to action.stance and no changeFloor frontier entry could ever set frontierGuided",
    frontierChangeFloorEntriesF3: countChangeFloor(f3.frontierSet),
    frontierChangeFloorEntriesF4: countChangeFloor(f4.frontierSet),
    enumeratedChangeFloorAlongWinner: changeFloorEnumeratedTotal,
    enumeratedChangeFloorWithTarget: changeFloorEnumeratedWithTarget,
  };

  const report = {
    milestone: "PR-5.25p",
    diagnostic: "TERMINAL_GOAL_DEPENDENT_FRONTIER_DIFFERENTIAL",
    searchRun: false,
    searchPolicyChange: "NONE",
    initialStateExactKey: buildStateKey(initialState),
    goal3: {
      envelope: f3.derivedFloorEnvelope,
      preGoalFloors: f3.derivedPreGoalFloors,
      targetTransitions: summarizeTransitions(f3),
      targetPoiIdentities: f3.derivedTargetPoiIdentities,
      allStrategicPoiCount: f3.allStrategicPoiCount,
      frontierCount: f3.frontierCount,
      alternativePathsCount: f3.alternativePathsCount,
    },
    goal4: {
      envelope: f4.derivedFloorEnvelope,
      preGoalFloors: f4.derivedPreGoalFloors,
      targetTransitions: summarizeTransitions(f4),
      targetPoiIdentities: f4.derivedTargetPoiIdentities,
      allStrategicPoiCount: f4.allStrategicPoiCount,
      frontierCount: f4.frontierCount,
      alternativePathsCount: f4.alternativePathsCount,
    },
    overallDiff: {
      intersectionCount: overall.intersection.length,
      f3OnlyCount: overall.f3Only.length,
      f4OnlyCount: overall.f4Only.length,
      f3OnlyByFloor: oGroup.f3Only.byFloor,
      f4OnlyByFloor: oGroup.f4Only.byFloor,
      f3OnlyByKind: oGroup.f3Only.byKind,
      f4OnlyByKind: oGroup.f4Only.byKind,
      f3Only: overall.f3Only,
      f4Only: overall.f4Only,
    },
    preMt3Diff: {
      restriction: ["MT1", "MT2"],
      f3Count: pre3.size,
      f4Count: pre4.size,
      intersectionCount: preDiff.intersection.length,
      f3OnlyCount: preDiff.f3Only.length,
      f4OnlyCount: preDiff.f4Only.length,
      f3OnlyByKind: preGroup.f3Only.byKind,
      f4OnlyByKind: preGroup.f4Only.byKind,
      f3Only: preDiff.f3Only,
      f4Only: preDiff.f4Only,
    },
    targetTransitionDiff: {
      f3: summarizeTransitions(f3),
      f4: summarizeTransitions(f4),
      f3Only: summarizeTransitions(f3).filter((t) => !summarizeTransitions(f4).some((u) => u.floorId === t.floorId && u.at === t.at && u.targetFloorId === t.targetFloorId)),
      f4Only: summarizeTransitions(f4).filter((t) => !summarizeTransitions(f3).some((u) => u.floorId === t.floorId && u.at === t.at && u.targetFloorId === t.targetFloorId)),
    },
    winnerActionMembership: {
      winnerRouteLength: trace.length,
      totals: membership,
      steps: membershipSteps,
      note: "F3_ONLY means the MT3 winner relied on an action that is frontier-guided under goal MT3 but neutral under goal MT4.",
    },
    legalSuccessorGuidedFlips: {
      totals: flips,
      byKind: perKind,
      states: flipSteps,
      note: "F3_GUIDED_TO_F4_NEUTRAL counts legal successors that lose guided status when the goal moves MT3 -> MT4.",
    },
    effectiveDelta: {
      observedActionIdentitiesCount: observedActionIdentities.size,
      f3OnlyMatchableByAnAction: effectiveF3Only,
      f4OnlyMatchableByAnAction: effectiveF4Only,
      effectiveF3OnlyCount: effectiveF3Only.length,
      effectiveF4OnlyCount: effectiveF4Only.length,
      note: "Frontier entries whose identity can actually be produced by an enumerated action along the winner trajectory. Entries outside this set cannot change frontierGuided admission.",
    },
    changeFloorIdentityContract: identityContract,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log("PR-5.25p Diagnostic 1 - terminal-goal-dependent frontier differential (static, no search)");
  console.log(`  F3 goal=MT3 frontier=${f3.frontierCount} envelope=${f3.derivedFloorEnvelope.join("->")} preGoal=[${f3.derivedPreGoalFloors.join(",")}]`);
  console.log(`  F4 goal=MT4 frontier=${f4.frontierCount} envelope=${f4.derivedFloorEnvelope.join("->")} preGoal=[${f4.derivedPreGoalFloors.join(",")}]`);
  console.log(`  overall diff: intersection=${overall.intersection.length} F3-only=${overall.f3Only.length} F4-only=${overall.f4Only.length}`);
  console.log(`  MT1/MT2-only diff: F3=${pre3.size} F4=${pre4.size} intersection=${preDiff.intersection.length} F3-only=${preDiff.f3Only.length} F4-only=${preDiff.f4Only.length}`);
  console.log(`  F3-only by floor: ${JSON.stringify(oGroup.f3Only.byFloor)}`);
  console.log(`  F4-only by floor: ${JSON.stringify(oGroup.f4Only.byFloor)}`);
  console.log(`  winner action membership: ${JSON.stringify(membership)}`);
  console.log(`  legal successor flips: ${JSON.stringify(flips)}`);
  console.log(`  effective delta (action-matchable): F3-only=${effectiveF3Only.length} F4-only=${effectiveF4Only.length}`);
  console.log(`  changeFloor identity contract: enumerated=${changeFloorEnumeratedTotal} withTarget=${changeFloorEnumeratedWithTarget} frontierEntriesF3=${identityContract.frontierChangeFloorEntriesF3} frontierEntriesF4=${identityContract.frontierChangeFloorEntriesF4}`);
  console.log(`  report artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
