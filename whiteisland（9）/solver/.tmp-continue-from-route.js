const path = require('path');
const fs = require('fs');
const { loadProject } = require('./lib/project-loader');
const { StaticSimulator } = require('./lib/simulator');
const { FunctionBackedBattleResolver } = require('./lib/battle-resolver');
const { createSearchProfile } = require('./lib/search-profiles');
const { searchTopK } = require('./lib/search');
const { buildRouteRecord, writeRouteFile } = require('./lib/route-store');
const { buildResourcePocketSearchOptions } = require('./lib/cli-options');

function argValue(name, fallback) {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

function replayRoute(simulator, routeRecord) {
  let state = simulator.createInitialState({ rank: 'chaos' });
  for (const [index, decision] of (routeRecord.decisions || []).entries()) {
    const actions = simulator.enumerateActions(state);
    const action = actions.find((candidate) => {
      if (decision.fingerprint && simulator.getActionFingerprint(candidate) === decision.fingerprint) return true;
      return candidate.summary === decision.summary;
    });
    if (!action) throw new Error(`Unable to replay decision ${index + 1}: ${decision.summary || decision.fingerprint}`);
    state = simulator.applyAction(state, action);
  }
  return state;
}

(async () => {
  const projectRoot = path.resolve('..');
  const project = loadProject(projectRoot);
  const toFloor = argValue('to-floor', 'MT5');
  const maxExpansions = Number(argValue('max-expansions', '500'));
  const resourceMode = argValue('resource-pocket-mode', 'off');
  const startRouteFile = argValue('start-route', 'routes/latest/continue-hp3779-i893.route.json');
  const out = argValue('out', `routes/latest/continue-i893-${toFloor.toLowerCase()}-best.route.json`);
  const profileName = 'stage-mt1-mt11';

  const simulator = new StaticSimulator(project, {
    stopFloorId: toFloor,
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: resourceMode !== 'off',
    resourcePocketSearchOptions: buildResourcePocketSearchOptions({ 'resource-pocket-mode': resourceMode }),
  });
  const profile = createSearchProfile(profileName, simulator, { targetFloorId: toFloor });
  const startRecord = JSON.parse(fs.readFileSync(startRouteFile, 'utf8'));
  const startState = replayRoute(simulator, startRecord);
  console.log('start', { route: startRouteFile, floor: startState.floorId, hp: startState.hero.hp, atk: startState.hero.atk, def: startState.hero.def, mdef: startState.hero.mdef, lv: startState.hero.lv, exp: startState.hero.exp, equipment: startState.hero.equipment, routeLen: startState.route.length });

  const result = await searchTopK(simulator, startState, {
    ...profile,
    topK: 5,
    maxExpansions,
    disableDominance: false,
    safeDominanceMode: true,
    perf: true,
    targetFloorId: toFloor,
    profileName,
    projectRoot,
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: true,
    enableResourcePocket: resourceMode !== 'off',
    resourcePocketSearchOptions: buildResourcePocketSearchOptions({ 'resource-pocket-mode': resourceMode }),
  });

  const chosen = result.goalState || result.bestProgressState || result.bestSeenState;
  const kind = result.goalState ? 'goal' : (result.bestProgressState ? 'best-progress' : 'best-seen');
  const continuationRecord = buildRouteRecord({
    project,
    simulator,
    initialState: startState,
    finalState: chosen,
    nodes: result.searchNodes || result.actionEntries || null,
    options: {
      projectRoot,
      toFloor,
      profile: profileName,
      rank: 'chaos',
      solver: 'continue-topk',
      expanded: result.expansions,
      generated: result.diagnostics && result.diagnostics.generated,
      metadata: { kind: 'continuation', foundGoal: Boolean(result.goalState) },
    },
  });
  const record = {
    ...startRecord,
    createdAt: new Date().toISOString(),
    goal: { type: 'floor', floorId: toFloor },
    metadata: {
      kind,
      foundGoal: Boolean(result.goalState),
      startRouteFile,
      startCheckpoint: { hp: startState.hero.hp, atk: startState.hero.atk, def: startState.hero.def, mdef: startState.hero.mdef, lv: startState.hero.lv, exp: startState.hero.exp, equipment: startState.hero.equipment },
      targetFloorId: toFloor,
      maxExpansions,
      resourceMode,
      continuationDecisions: continuationRecord.decisions.length,
    },
    stats: continuationRecord.stats,
    final: continuationRecord.final,
    decisions: startRecord.decisions.concat(continuationRecord.decisions.map((decision, index) => ({ ...decision, index: startRecord.decisions.length + index + 1 }))),
    rawRoute: (startRecord.rawRoute || []).concat((continuationRecord.rawRoute || []).slice((startRecord.rawRoute || []).length)),
    notes: (startRecord.notes || []).concat(continuationRecord.notes || []),
  };
  writeRouteFile(out, record);
  const hero = record.final.snapshot.hero;
  console.log('written', out);
  console.log('result', { kind, foundGoal: Boolean(result.goalState), expansions: result.expansions, frontier: result.frontierSize, floor: record.final.floorId, hp: hero.hp, atk: hero.atk, def: hero.def, mdef: hero.mdef, lv: hero.lv, exp: hero.exp, equipment: hero.equipment, decisions: record.decisions.length });
  console.log('tail decisions:');
  record.decisions.slice(Math.max(0, record.decisions.length - 14)).forEach((decision) => {
    const post = decision.postSnapshot && decision.postSnapshot.hero;
    console.log(`${decision.index}. ${decision.summary} -> floor=${decision.postSnapshot.floorId} hp=${post.hp} atk=${post.atk} def=${post.def} mdef=${post.mdef} lv=${post.lv} exp=${post.exp} eq=${JSON.stringify(post.equipment || [])}`);
  });
})().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
