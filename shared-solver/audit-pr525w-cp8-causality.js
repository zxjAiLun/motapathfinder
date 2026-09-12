"use strict";
/**
 * PR-5.25w - Optional Resource Prefix Causality Audit.
 *
 * REPLAY / COUNTERFACTUAL ONLY - zero search runs.
 *
 * Question: is battle:skeletonWarrior@MT1:2,1 (decision #8 in all three
 * tracked fixtures; the PR-5.25t first-loss oracle checkpoint, dropped by
 * cap as a non-head neutral) an OPTIONAL RESOURCE-PREPARATION action the
 * known solutions genuinely depend on, or a one-off DP-witness choice?
 *
 * PHASE 1  replay each tracked route to decision #8's pre-state, execute the
 *          battle, and record every strategy-relevant delta (scalars,
 *          inventory, equipment, flags, floor mutations, auto events).
 * PHASE 2  deletion counterfactual: replay decisions 0..7, SKIP #8, then
 *          attempt decisions #9..end with the current resolveRecordedAction().
 *          The route is NEVER repaired - a decision that no longer resolves,
 *          executes lethally, or cannot be found is the probe result.
 * PHASE 3  (suffix fails only) the world delta between the probe's failure
 *          state and the recorded oracle pre-state at the same step - the
 *          observed deficit the suffix ran on.
 * PHASE 4  the same deletion probe on the tracked MT2/MT3/MT4 routes.
 *
 * NO search, no FIFO tuning, no frontier patches, no heuristics.
 */

const fs = require("fs");
const path = require("path");

const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { resolveRecordedAction } = require("./lib/route-store");
const { buildStateKey } = require("./lib/state-key");
const { listFloorMutationSummary, cloneState } = require("./lib/state");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const CP_SUMMARY_MARKER = "battle:skeletonWarrior@MT1:2,1";
const DEFAULT_OUT = path.resolve(__dirname, "routes", "generated", "pr525w-cp8-causality.json");

const ROUTES = [
  { name: "MT2", file: path.resolve(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json"), targetFloor: "MT2" },
  { name: "MT3", file: path.resolve(__dirname, "routes", "fixtures", "mt1-mt3-i893-hp8425.route.json"), targetFloor: "MT3" },
  { name: "MT4", file: path.resolve(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json"), targetFloor: "MT4" },
];

const SCALAR_FIELDS = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];

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

function stateWorldFingerprint(state) {
  return {
    scalars: Object.fromEntries(SCALAR_FIELDS.map((f) => [f, state.hero && state.hero[f] != null ? state.hero[f] : null])),
    inventory: state.inventory || {},
    equipment: Array.isArray(state.hero && state.hero.equipment) ? state.hero.equipment.slice().sort() : [],
    flags: state.flags || {},
    floorMutations: listFloorMutationSummary(state.floorStates || {}),
    triggeredAutoEvents: state.triggeredAutoEvents || {},
  };
}

function diffWorld(before, after) {
  const beforeFp = stateWorldFingerprint(before);
  const afterFp = stateWorldFingerprint(after);
  const scalarDelta = {};
  for (const f of SCALAR_FIELDS) {
    const a = beforeFp.scalars[f];
    const b = afterFp.scalars[f];
    if (a !== b) scalarDelta[f] = { before: a, after: b, delta: (a == null || b == null) ? null : b - a };
  }
  const diffMaps = (label, a, b) => {
    const changes = {};
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const va = a ? a[key] : undefined;
      const vb = b ? b[key] : undefined;
      if (JSON.stringify(va) !== JSON.stringify(vb)) changes[key] = { before: va == null ? null : va, after: vb == null ? null : vb };
    }
    return { label, changes };
  };
  return {
    scalarDelta,
    inventory: diffMaps("inventory", beforeFp.inventory, afterFp.inventory),
    equipment: diffMaps("equipment", beforeFp.equipment, afterFp.equipment),
    flags: diffMaps("flags", beforeFp.flags, afterFp.flags),
    floorMutations: diffMaps("floorMutations", beforeFp.floorMutations, afterFp.floorMutations),
    triggeredAutoEvents: diffMaps("triggeredAutoEvents", beforeFp.triggeredAutoEvents, afterFp.triggeredAutoEvents),
  };
}

function resolveDecision(simulator, state, decision) {
  const actions = (simulator.enumeratePrimitiveActions(state) || {}).actions || [];
  // Mirror the PR-5.25p oracle replay shape: old-format projected keys are
  // passed through as hints; the resolver falls back to summary/path matching
  // when they do not match the current key builders.
  return resolveRecordedAction(simulator, state, {
    ...decision,
    postExactStateKey: decision.postExactStateKey || decision.postStateKey || null,
  }, { candidates: actions });
}

/** Execute decisions[from..to) against `state`; throws on any failure. */
function replayPrefix(simulator, decisions, from, to, state) {
  let cursor = cloneState(state);
  for (let i = from; i < to; i += 1) {
    const resolved = resolveDecision(simulator, cursor, decisions[i]);
    if (!resolved || !resolved.action) {
      throw new Error(`prefix replay failed at decision ${i} (${decisions[i].summary}): ${resolved && resolved.reason}`);
    }
    cursor = simulator.applyAction(cursor, resolved.action, { storeRoute: true });
    if (!cursor || !cursor.hero || cursor.hero.hp <= 0) {
      throw new Error(`prefix replay died at decision ${i}`);
    }
  }
  return cursor;
}

/**
 * PHASE 2 deletion counterfactual: replay [0..cpIndex), skip cpIndex, then
 * attempt [cpIndex+1..end). Never repairs the route.
 */
function deletionProbe(simulator, decisions, cpIndex, initialState, oraclePreStates) {
  let state = replayPrefix(simulator, decisions, 0, cpIndex, initialState);
  const skipped = decisions[cpIndex];
  const result = {
    skippedDecision: { step: cpIndex, kind: skipped.kind, summary: skipped.summary },
    suffixStart: cpIndex + 1,
    steps: [],
  };
  for (let i = cpIndex + 1; i < decisions.length; i += 1) {
    const decision = decisions[i];
    const resolved = resolveDecision(simulator, state, decision);
    if (!resolved || !resolved.action) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = resolved ? resolved.reason : "resolve-returned-null";
      result.failureDecision = { step: i, kind: decision.kind, summary: decision.summary };
      result.failureStateFloorId = state.floorId;
      result.failureStateHero = { hp: state.hero.hp, atk: state.hero.atk, def: state.hero.def, mdef: state.hero.mdef, exp: state.hero.exp, lv: state.hero.lv };
      if (oraclePreStates[i]) {
        result.worldDeficitVsOraclePreState = diffWorld(state, oraclePreStates[i]);
      }
      return result;
    }
    let postState = null;
    try {
      postState = simulator.applyAction(state, resolved.action, { storeRoute: true });
    } catch (error) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = `apply-action-threw: ${error.message}`;
      result.failureDecision = { step: i, kind: decision.kind, summary: decision.summary };
      result.failureStateFloorId = state.floorId;
      return result;
    }
    if (!postState || !postState.hero || postState.hero.hp <= 0) {
      result.ok = false;
      result.firstSuffixFailureStep = i;
      result.failureReason = "lethal-transition";
      result.failureDecision = { step: i, kind: decision.kind, summary: decision.summary };
      result.failureStateFloorId = state.floorId;
      result.failureStateHero = { hp: state && state.hero ? state.hero.hp : null };
      return result;
    }
    result.steps.push({
      step: i,
      summary: resolved.action.summary,
      matchType: resolved.matchType || null,
    });
    state = postState;
  }
  result.ok = true;
  result.finalFloorId = state.floorId;
  result.finalHeroHp = state.hero.hp;
  return result;
}

function auditRoute(project, route) {
  const simulator = makeSimulator(project);
  const record = JSON.parse(fs.readFileSync(route.file, "utf8"));
  const decisions = Array.isArray(record.decisions) ? record.decisions : [];
  if (decisions.length === 0) throw new Error(`${route.name}: fixture has no decisions`);

  let cpIndex = decisions.findIndex((d) => d.summary === CP_SUMMARY_MARKER);
  if (cpIndex === -1) throw new Error(`${route.name}: ${CP_SUMMARY_MARKER} not found in fixture`);

  // Full oracle replay, recording every pre-state (also validates the fixture).
  const oraclePreStates = [];
  let state = simulator.createInitialState({ rank: "chaos" });
  if (state.floorId !== "MT1") throw new Error(`${route.name}: canonical initial state is not on MT1`);
  for (let i = 0; i < decisions.length; i += 1) {
    oraclePreStates.push(cloneState(state));
    const resolved = resolveDecision(simulator, state, decisions[i]);
    if (!resolved || !resolved.action) {
      throw new Error(`${route.name}: oracle replay failed to resolve decision ${i} (${decisions[i].summary}): ${resolved && resolved.reason}`);
    }
    state = simulator.applyAction(state, resolved.action, { storeRoute: true });
    if (!state || !state.hero || state.hero.hp <= 0) throw new Error(`${route.name}: oracle replay died at decision ${i}`);
  }
  if (state.floorId !== route.targetFloor) throw new Error(`${route.name}: oracle replay ended on ${state.floorId}, not ${route.targetFloor}`);

  // PHASE 1: cp#8 immediate delta.
  const preCp = oraclePreStates[cpIndex];
  const preKey = buildStateKey(preCp);
  const cpDecision = decisions[cpIndex];
  const cpResolved = resolveDecision(simulator, preCp, cpDecision);
  if (!cpResolved || !cpResolved.action) throw new Error(`${route.name}: cp decision failed to resolve on replay`);
  const postCp = simulator.applyAction(preCp, cpResolved.action, { storeRoute: true });
  const cpDelta = diffWorld(preCp, postCp);

  // PHASE 2 (+3): deletion counterfactual.
  const probe = deletionProbe(simulator, decisions, cpIndex, simulator.createInitialState({ rank: "chaos" }), oraclePreStates);

  return {
    route: route.name,
    fixture: path.relative(path.resolve(__dirname, ".."), route.file),
    decisions: decisions.length,
    cpIndex,
    cpDecision: { kind: cpDecision.kind, summary: cpDecision.summary, enemyId: cpDecision.enemyId || null, estimate: cpDecision.estimate || null },
    cpPreExactKey: preKey,
    cpDelta,
    probe,
  };
}

function main() {
  const outPath = (() => {
    const arg = process.argv.slice(2).find((t) => t.startsWith("--out="));
    return arg ? path.resolve(arg.slice("--out=".length)) : DEFAULT_OUT;
  })();

  const project = loadProject(PROJECT_ROOT);
  const audits = ROUTES.map((route) => auditRoute(project, route));

  const allCritical = audits.every((a) => a.probe && a.probe.ok === false);
  const anyCritical = audits.some((a) => a.probe && a.probe.ok === false);
  const verdict = {
    cp8SuffixCriticalAllRoutes: allCritical,
    cp8SuffixCriticalAnyRoute: anyCritical,
    pattern: allCritical
      ? "RECURRING_OPTIONAL_RESOURCE_PREPARATION_DEPENDENCY_SUSPECTED (all three tracked routes depend on cp#8 for their recorded suffix)"
      : anyCritical
        ? "PARTIAL_DEPENDENCY (only some tracked routes depend on cp#8; do not overfit)"
        : "CP8_SUFFIX_CRITICAL = FALSE (no tracked route requires cp#8 for its recorded suffix)",
  };

  const summary = {
    milestone: "PR-5.25w",
    audit: "OPTIONAL_RESOURCE_PREFIX_CAUSALITY",
    searchRun: false,
    routes: audits,
    verdict,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("PR-5.25w optional resource prefix causality audit (replay only, no search)");
  for (const a of audits) {
    const p = a.probe;
    console.log(`  ${a.route}: cp#8 = decision ${a.cpIndex}; suffix after skipping cp#8: ${p.ok ? `REACHES_${a.route === "MT4" ? "MT4" : a.route} (floor ${p.finalFloorId}, hp ${p.finalHeroHp})` : `FAILS at step ${p.firstSuffixFailureStep} (${p.failureReason})`}`);
    const scalars = Object.entries(a.cpDelta.scalarDelta).map(([k, v]) => `${k}:${v.before}->${v.after}`).join(", ");
    console.log(`    cp#8 scalar deltas: ${scalars || "(none)"}`);
    const nonEmpty = [a.cpDelta.inventory, a.cpDelta.equipment, a.cpDelta.flags, a.cpDelta.floorMutations, a.cpDelta.triggeredAutoEvents]
      .filter((d) => Object.keys(d.changes).length > 0);
    for (const d of nonEmpty) console.log(`    cp#8 ${d.label} changes: ${JSON.stringify(d.changes).slice(0, 200)}`);
  }
  console.log(`  verdict: ${JSON.stringify(verdict)}`);
  console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`);
}

main();
