"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { getMilestoneSpec } = require("./lib/milestone-spec");
const { loadProject } = require("./lib/project-loader");
const { searchDP } = require("./lib/dp-search");
const { readRouteFile } = require("./lib/route-store");
const { buildSegmentActionProvider } = require("./lib/segment-dp");
const { StaticSimulator } = require("./lib/simulator");
const { buildStateKey } = require("./lib/state-key");
const { getTileDefinitionAt } = require("./lib/state");
const { strictReplayRoute } = require("./lib/agenda-policy-evaluation");

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const DEFAULT_ROUTE_FILE = path.resolve(
  __dirname,
  "routes",
  "fixtures",
  "mt1-mt3-i893-hp8425.route.json",
);
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-hp3834-teacher-fixture-oracle-audit.json",
);

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function findAction(simulator, state, summary) {
  const primitive = simulator.enumeratePrimitiveActions(state).actions || [];
  return primitive.find((action) => action.summary === summary) || null;
}

function heroSummary(state) {
  const hero = (state && state.hero) || {};
  return {
    hp: Number(hero.hp || 0),
    atk: Number(hero.atk || 0),
    def: Number(hero.def || 0),
    mdef: Number(hero.mdef || 0),
    exp: Number(hero.exp || 0),
  };
}

function tileKey(tile) {
  return `${tile.floorId}:${tile.x},${tile.y}`;
}

function missingHardTiles(project, state, hardTiles) {
  return hardTiles
    .filter(
      (tile) =>
        getTileDefinitionAt(project, state, tile.floorId, tile.x, tile.y) == null,
    )
    .map(tileKey);
}

function compactState(project, state, hardTiles) {
  return {
    floorId: state.floorId,
    hero: heroSummary(state),
    exactStateKey: buildStateKey(state),
    decisionDepth: Number((state.meta || {}).decisionDepth || 0),
    missingHardTiles: missingHardTiles(project, state, hardTiles),
  };
}

function meetsMinHero(state, minHero) {
  const hero = heroSummary(state);
  return Object.entries(minHero || {}).every(
    ([field, value]) => hero[field] >= Number(value),
  );
}

function replayFixture(project, simulator, record) {
  let state = simulator.createInitialState({ rank: "chaos" });
  const states = [state];
  const replayErrors = [];
  for (const decision of record.decisions || []) {
    const action = findAction(simulator, state, decision.summary);
    if (!action) {
      replayErrors.push({ index: decision.index, summary: decision.summary });
      break;
    }
    try {
      state = simulator.applyAction(state, action);
    } catch (error) {
      replayErrors.push({
        index: decision.index,
        summary: decision.summary,
        error: String(error.message || error),
      });
      break;
    }
    states.push(state);
  }
  return { state, states, replayErrors };
}

function eventActionSummary(event) {
  return event && event.action && event.action.summary;
}

function oracleObserverAudit(project, simulator, segment, witness, nextFixtureSummary) {
  const actionProvider = buildSegmentActionProvider(simulator, segment);
  const providerActions = actionProvider(simulator, witness.state);
  const providerAction = providerActions.find(
    (action) => action.summary === nextFixtureSummary,
  );
  const events = [];
  const result = searchDP(simulator, witness.state, {
    maxExpansions: 1,
    maxRuntimeMs: 60000,
    maxActionsPerState: 256,
    dpKeyMode: "mutation",
    dpSkylineMax: 4,
    stopOnFirstGoal: false,
    goalPredicate: () => false,
    actionProvider,
    actionApplier: (state, action) => simulator.applyAction(state, action, { storeRoute: false }),
    observerIncludeExactStateKey: true,
    observer: {
      includeExactStateKey: true,
      onEvent: (event) => events.push(event),
    },
  });
  const matchingGenerated = events.filter(
    (event) =>
      event.eventType === "candidateGenerated" &&
      eventActionSummary(event) === nextFixtureSummary,
  );
  const matchingRejected = events.filter(
    (event) =>
      event.eventType === "candidateRejected" &&
      eventActionSummary(event) === nextFixtureSummary,
  );
  const matchingInserted = events.filter(
    (event) =>
      event.eventType === "skylineInserted" &&
      eventActionSummary(event) === nextFixtureSummary,
  );
  const matchingEvicted = events.filter(
    (event) =>
      event.eventType === "skylineEvicted" &&
      eventActionSummary(event) === nextFixtureSummary,
  );
  const insertedNodeIds = new Set(matchingInserted.map((event) => event.nodeId));
  const matchingAgendaPops = events.filter(
    (event) =>
      event.eventType === "agendaPopped" && insertedNodeIds.has(event.nodeId),
  );
  return {
    providerActionCount: providerActions.length,
    providerContainsNextFixtureAction: Boolean(providerAction),
    nextFixtureAction: providerAction
      ? {
          summary: providerAction.summary,
          kind: providerAction.kind,
          target: providerAction.target || null,
        }
      : null,
    search: {
      expansions: result.expansions,
      frontierSize: result.frontierSize,
      acceptedStates: result.diagnostics.dp.acceptedStates,
      generatedActions: result.diagnostics.dp.actionsGeneratedByKind,
      eventCounts: events.reduce((counts, event) => {
        counts[event.eventType] = (counts[event.eventType] || 0) + 1;
        return counts;
      }, {}),
    },
    nextActionWitness: {
      successorGenerated: matchingGenerated.length > 0,
      rejectedReasons: matchingRejected.map((event) => event.reasonCode),
      dominanceRejected: matchingRejected.some(
        (event) => event.reasonCode === "dominance-rejected",
      ),
      skylineInserted: matchingInserted.length > 0,
      skylineEvicted: matchingEvicted.length > 0,
      agendaExpanded: matchingAgendaPops.length > 0,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args["project-root"] || DEFAULT_PROJECT_ROOT);
  const routeFile = path.resolve(args.route || DEFAULT_ROUTE_FILE);
  const outFile = path.resolve(args.out || DEFAULT_OUT);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const record = JSON.parse(fs.readFileSync(routeFile, "utf8"));
  const strictReplay = strictReplayRoute(
    project,
    simulator,
    record,
  );
  const replay = replayFixture(project, simulator, record);
  const spec = getMilestoneSpec(project, "onlyup-chaos-mt5-blueking");
  const segment = spec.milestones.find((milestone) => milestone.id === "mt2-hp3834");
  const hardTiles = segment.goal.presentTiles || [];
  const witnessIndex = replay.states.findIndex(
    (state) => meetsMinHero(state, segment.goal.minHero) && missingHardTiles(project, state, hardTiles).length === 0,
  );
  const witnessState = witnessIndex >= 0 ? replay.states[witnessIndex] : null;
  const nextDecision = witnessIndex >= 0 ? record.decisions[witnessIndex] || null : null;
  const summaryReplayFinal = replay.state;
  const report = {
    schema: "motapathfinder.hp3834-teacher-fixture-oracle-audit.v1",
    generatedAt: new Date().toISOString(),
    source: {
      fixture: path.relative(__dirname, routeFile),
      projectRoot: path.relative(__dirname, projectRoot),
      fixtureDecisionsInjectedIntoProductionSearch: false,
    },
    target: {
      milestone: segment.id,
      minHero: segment.goal.minHero,
      hardPresentTiles: hardTiles.map((tile) => ({
        floorId: tile.floorId,
        x: tile.x,
        y: tile.y,
        reason: tile.reason || null,
        propagatedFromMilestone: tile.propagatedFromMilestone || null,
      })),
    },
    strictReplay,
    summaryReplay: {
      decisionsAttempted: (record.decisions || []).length,
      decisionsApplied: replay.states.length - 1,
      replayErrors: replay.replayErrors,
      final: compactState(project, summaryReplayFinal, hardTiles),
    },
    earliestContinuationCompatibleWitness: witnessState
      ? {
          decisionIndex: witnessIndex,
          reachedAfterDecision: witnessIndex === 0 ? null : record.decisions[witnessIndex - 1].index,
          state: compactState(project, witnessState, hardTiles),
          nextFixtureDecision: nextDecision
            ? { index: nextDecision.index, summary: nextDecision.summary }
            : null,
        }
      : null,
    oracleObserverAudit: witnessState
      ? oracleObserverAudit(
          project,
          simulator,
          segment,
          { state: witnessState },
          nextDecision && nextDecision.summary,
        )
      : null,
    conclusion: strictReplay.valid
      ? "fixture strict replay valid; witness audit is oracle-only"
      : "fixture strict replay failed; summary replay is retained only as a non-strict oracle trace",
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (replay.replayErrors.length > 0 || !witnessState) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  replayFixture,
  oracleObserverAudit,
};
