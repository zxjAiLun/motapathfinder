"use strict";

/** TEST GRADE: local-regression */

/**
 * PR-5.24b Iteration 6 — MT3→MT4 Witness Differential
 *
 * Question answered (test-oracle only, no production hints):
 *   If the canonical mt3-to-mt4 segment search is handed a KNOWN-FEASIBLE
 *   MT3 history state (witnessMt3State, strictly replayed from the tracked
 *   fixture routes/fixtures/mt1-mt4-hp6428-best.route.json up to its first
 *   entry into MT3), can it reach MT4 on its own — no suffix route, no action
 *   order, no item hints?
 *
 * Branch decision per the Iteration-6 authorization:
 *   witness MT4 found → Branch A (upstream history selection is the primary
 *     defect; implement failure-conditioned ranking).
 *   witness MT4 not found (complete search) → Branch B (the MT3→MT4 action
 *     graph / DP / enumeration is the defect; do NOT touch upstream ranking).
 *
 * This check REPORTS the branch verdict; it is deterministic evidence, not a
 * pass/fail gate on the branch itself. The hard gates are: strict replay of
 * the fixture prefix must pass, and the witness state must be an exact MT3
 * state (not a shortcut).
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { runSegmentAgainstFrontierLocal } = require("./lib/segment-dp");
const { buildStateKey } = require("./lib/state-key");
const { resolveRecordedAction } = require("./lib/route-store");
const {
  FIRST_REGION_TARGET_FLOOR_ID,
  createNoStateChangeChoiceResolver,
  difficultySnapshot,
  isDecisionEntry,
} = require("./lib/onlyup-mt1-real-route-gate");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const FIXTURE = path.join(__dirname, "routes", "fixtures", "mt1-mt4-hp6428-best.route.json");
const CHAOS_DIFFICULTY = { I581: 0, I582: 0, "flag:level0": 0 };
const WITNESS_FLOOR = "MT3";

function buildSimulator(project, choiceResolver) {
  return new StaticSimulator(project, {
    stopFloorId: FIRST_REGION_TARGET_FLOOR_ID,
    battleResolver: new FunctionBackedBattleResolver(project, { enableFastReject: true }),
    autoBattleFastRejectEnabled: true,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFastHazardBlockIndex: true,
    enableCompiledEffectCache: false,
    // Iteration 6 Repair 1 (P1-1) – the SAME resolver instance the simulator
    // actually uses, so the unresolved-choices hard gate observes the real
    // replay rather than an unused parallel resolver.
    choiceResolver,
  });
}

function main() {
  const project = loadProject(DEFAULT_PROJECT_ROOT);
  const choiceResolver = createNoStateChangeChoiceResolver();
  const simulator = buildSimulator(project, choiceResolver);
  const routeFile = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const route = (routeFile.decisions || []).filter(isDecisionEntry);
  assert.ok(route.length > 0, "fixture must contain decision entries");

  // ---- strict replay the fixture until (and including) the first arrival on MT3 ----
  let replayState = simulator.createInitialState();
  assert.deepStrictEqual(
    difficultySnapshot(replayState),
    CHAOS_DIFFICULTY,
    "Replay must start on Chaos difficulty",
  );

  let witnessIndex = -1;
  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    const resolved = resolveRecordedAction(simulator, replayState, entry, {
      requireFingerprintMatch: true,
    });
    assert.ok(
      resolved != null && resolved.action != null,
      `Witness replay action not enumerated at step ${index}: ${entry.summary}`,
    );
    replayState = simulator.applyAction(replayState, resolved.action, { storeRoute: true });
    if (replayState.floorId === WITNESS_FLOOR) {
      witnessIndex = index;
      break;
    }
  }
  assert.ok(
    witnessIndex >= 0,
    "fixture replay never reached MT3 — fixture unusable as witness source",
  );
  // Iteration 6 Repair 1 (P1-1) – REAL unresolved-choices gate: this resolver
  // is the one wired into the simulator that performed the replay above.
  assert.strictEqual(
    choiceResolver.unresolved.length,
    0,
    `witness prefix replay must leave no unresolved choices (got ${choiceResolver.unresolved.length})`,
  );

  const witnessMt3State = replayState;
  const witnessStateKey = buildStateKey(witnessMt3State);
  console.log(`witness: reached ${WITNESS_FLOOR} at decision ${witnessIndex + 1}/${route.length}, hero=${JSON.stringify({
    hp: witnessMt3State.hero.hp,
    atk: witnessMt3State.hero.atk,
    def: witnessMt3State.hero.def,
    mdef: witnessMt3State.hero.mdef,
    lv: witnessMt3State.hero.lv,
    exp: witnessMt3State.hero.exp,
  })}`);

  // ---- canonical mt3-to-mt4 solo search from the witness state ----
  // Frozen Iteration-6 conditions: same per-segment budgets the qualification
  // spec uses, generous wall for the solo probe (this is a capability probe,
  // not a budget qualification — wall is diagnostic only, memory keeps the
  // qualification contract shape).
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt1-mt4");
  const mt3ToMt4 = spec.milestones.find((segment) => segment.id === "mt3-to-mt4");
  assert.ok(mt3ToMt4, "mt3-to-mt4 segment must exist in the frozen spec");

  const result = runSegmentAgainstFrontierLocal(
    simulator,
    mt3ToMt4,
    [{ id: "witness#0", state: witnessMt3State, tags: ["witness"] }],
    {
      maxRssMb: 1024,
      memoryCheckIntervalExpansions: 1,
      maxRuntimeMs: 30000,
      maxExpansions: 50000,
      stopOnFirstGoal: true,
      candidateLimit: 8,
    },
    {},
  );

  const attempt = result.summary.attempts[0];
  const dp = attempt.diagnostics.dp;
  const outcome = dp.searchOutcome || {};
  const found = Boolean(attempt.found);
  const searchComplete = outcome.searchComplete === true;
  const frontierExhausted = outcome.frontierExhausted === true;
  const stoppedReason = dp.stoppedReason || null;

  console.log(`witness mt3-to-mt4 solo: found=${found} expansions=${dp.expansions} frontierSize=${dp.frontierSize} stoppedReason=${stoppedReason} outcomeClass=${outcome.outcomeClass} actionTrimmed=${dp.actionTrimmed}`);

  // ---- branch verdict ----
  // Iteration 6 Repair 1 (P1-2) – Branch B requires the AUTHORITATIVE
  // searchComplete only. frontierExhausted alone can mean "the trimmed
  // frontier was exhausted" (actionTrimmed > 0) which does not prove the real
  // action graph was exhausted — the exact semantics hole Iteration 4
  // Repair 2 closed for candidate slices. Anything not found and not
  // search-complete is INCONCLUSIVE (budget/trim/truncated), never Branch B.
  let branch;
  if (found) {
    branch = "A";
  } else if (searchComplete) {
    branch = "B";
  } else {
    branch = "INCONCLUSIVE";
  }
  if (branch === "B") {
    assert.strictEqual(
      stoppedReason,
      null,
      `Branch B requires stoppedReason=null (got ${stoppedReason}) — a budget stop is not a complete search`,
    );
    assert.strictEqual(
      dp.actionTrimmed,
      0,
      `Branch B requires actionTrimmed=0 (got ${dp.actionTrimmed}) — a trimmed action scope is not a complete search`,
    );
    assert.strictEqual(
      searchComplete,
      true,
      "Branch B requires the authoritative searchOutcome.searchComplete=true",
    );
  }

  // ---- Branch-B missing-branch oracle: walk the fixture MT3->MT4 suffix
  // through the canonical segment provider, one action at a time, and
  // attribute the FIRST break (POLICY_FILTERED vs NOT_ENUMERATED vs exact
  // post-state mismatch). Test oracle only — no production hints encoded.
  let suffixBreak = null;
  if (branch === "B") {
    const { buildSegmentActionProvider } = require("./lib/segment-dp");
    const provider = buildSegmentActionProvider(simulator, mt3ToMt4);
    let oracleState = witnessMt3State;
    for (let i = witnessIndex + 1; i < route.length; i += 1) {
      const decision = route[i];
      const actions = provider(null, oracleState) || [];
      const match = actions.find((a) => a.summary === decision.summary);
      if (!match) {
        const raw = (simulator.enumeratePrimitiveActions(oracleState).actions || []);
        const rawMatch = raw.find((a) => a.summary === decision.summary);
        suffixBreak = {
          atDecisionIndex: i,
          summary: decision.summary,
          kind: rawMatch ? "POLICY_FILTERED" : "NOT_ENUMERATED",
          detail: rawMatch
            ? "the raw simulator enumerates the action, but the canonical segment provider (allowedFloors/actionKinds/presentTiles filters) drops it"
            : "the raw simulator itself does not enumerate the action at this state (missing branch in enumeration/stabilization)",
          stateFloorId: oracleState.floorId,
          providerActionCount: actions.length,
        };
        break;
      }
      const resolved = resolveRecordedAction(simulator, oracleState, decision, {
        requireFingerprintMatch: true,
      });
      const nextState = simulator.applyAction(oracleState, match, { storeRoute: true });
      if (resolved && resolved.action) {
        // exact post-state continuity check via the authoritative resolver
        const oracleNext = simulator.applyAction(oracleState, resolved.action, { storeRoute: true });
        if (buildStateKey(oracleNext) !== buildStateKey(nextState)) {
          suffixBreak = {
            atDecisionIndex: i,
            summary: decision.summary,
            kind: "POST_STATE_MISMATCH",
            detail: "provider action and recorded action produce different exact states",
            stateFloorId: oracleState.floorId,
            providerActionCount: actions.length,
          };
          break;
        }
      }
      oracleState = nextState;
    }
    if (!suffixBreak) {
      suffixBreak = { kind: "NONE", detail: "the full fixture MT3->MT4 suffix is provided by the canonical segment provider" };
    }
  }

  const verdict = {
    schema: "motapathfinder.mt3-mt4-witness-differential.v1",
    fixture: "routes/fixtures/mt1-mt4-hp6428-best.route.json",
    witnessDecisionIndex: witnessIndex,
    witnessStateKeyPrefix: witnessStateKey.slice(0, 96),
    witnessHero: {
      hp: witnessMt3State.hero.hp,
      atk: witnessMt3State.hero.atk,
      def: witnessMt3State.hero.def,
      mdef: witnessMt3State.hero.mdef,
      lv: witnessMt3State.hero.lv,
      exp: witnessMt3State.hero.exp,
    },
    soloSearch: {
      found,
      expansions: dp.expansions,
      frontierSize: dp.frontierSize,
      stoppedReason,
      outcomeClass: outcome.outcomeClass || null,
      searchComplete,
      frontierExhausted,
      actionTrimmed: dp.actionTrimmed,
    },
    branch,
    suffixBreak,
    meaning:
      branch === "A"
        ? "DOWNSTREAM_MT3_TO_MT4_ACTION_GRAPH=CAPABLE; primary defect is upstream history selection → implement failure-conditioned ranking"
        : branch === "B"
          ? "WITNESS_MT3_ALSO_BLOCKED; do NOT modify upstream ranking → first suffix break is the authoritative missing-branch evidence"
          : "solo search stopped for non-completion reasons (budget/trim) — rerun with a clean search before deciding the branch",
  };

  // Hard gates that must hold regardless of branch:
  assert.ok(
    Array.isArray(result.merged) || result.summary,
    "solo search must report a summary",
  );
  console.log(JSON.stringify(verdict, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = { main };
