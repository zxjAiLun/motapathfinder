"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { FunctionBackedBattleResolver } = require("./battle-resolver");
const { loadProject } = require("./project-loader");
const { normalizeActionEntry } = require("./search-nodes");
const { StaticSimulator } = require("./simulator");
const { buildStateKey } = require("./state-key");

const project = loadProject(workerData.projectRoot);
const simulator = new StaticSimulator(project, {
  stopFloorId: workerData.stopFloorId,
  battleResolver: new FunctionBackedBattleResolver(project),
  autoPickupEnabled: workerData.autoPickupEnabled !== false,
  autoBattleEnabled: workerData.autoBattleEnabled !== false,
  enableFightToLevelUp: Boolean(workerData.enableFightToLevelUp),
  enableResourcePocket: Boolean(workerData.enableResourcePocket),
});

function expandNode(node) {
  const actions = simulator.enumerateActions(node.state);
  const candidates = [];
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    try {
      const nextState = simulator.applyAction(node.state, action, { storeRoute: false });
      candidates.push({
        parentId: node.nodeId,
        parentOrder: node.order,
        parentDepth: node.depth,
        actionIndex,
        actionEntry: normalizeActionEntry(action),
        state: nextState,
        stateKey: buildStateKey(nextState),
        floorId: nextState.floorId,
      });
    } catch (error) {
      candidates.push({
        parentId: node.nodeId,
        parentOrder: node.order,
        parentDepth: node.depth,
        actionIndex,
        invalid: true,
        error: error && error.message ? error.message : String(error),
      });
    }
  }
  return candidates;
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "expandBatch") return;
  try {
    const candidates = [];
    let expanded = 0;
    for (const node of message.nodes || []) {
      candidates.push(...expandNode(node));
      expanded += 1;
    }
    parentPort.postMessage({
      jobId: message.jobId,
      candidates,
      stats: { expanded, generated: candidates.length },
    });
  } catch (error) {
    parentPort.postMessage({
      jobId: message.jobId,
      error: error && error.stack ? error.stack : String(error),
    });
  }
});
