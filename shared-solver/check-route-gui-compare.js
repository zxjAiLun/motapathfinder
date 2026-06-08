"use strict";

const assert = require("node:assert");
const path = require("node:path");

const { loadProject } = require("./lib/project-loader");
const { readRouteFile } = require("./lib/route-store");
const { findDivergence } = require("./lib/route-inspector");
const { createGuiServer } = require("./route-gui");

const PROJECT_ROOT = path.resolve(__dirname, "..", "Only upV2.1", "Only upV2.1");
const ROUTE_FILE = path.resolve(__dirname, "routes", "fixtures", "mt1-mt2-hp3834.route.json");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStubSession() {
  return {
    async getStatusAsync() {
      return {
        state: "idle",
        currentStep: 1,
        totalSteps: 0,
        stepStatuses: {},
      };
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function fetchJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const data = await response.json();
  assert.equal(response.status, 200, `${pathName} should return 200`);
  return data;
}

function mutateRouteAt(route, index, summary) {
  const next = cloneJson(route);
  next.decisions[index - 1].summary = summary;
  next.decisions[index - 1].fingerprint = summary;
  return next;
}

function checkFindDivergence() {
  const route = readRouteFile(ROUTE_FILE);
  assert.equal(findDivergence(route, cloneJson(route)), null);

  const diverged = mutateRouteAt(route, 3, "battle:synthetic@MT1:9,9");
  const divergence = findDivergence(route, diverged);
  assert.equal(divergence.divergedAt, 3);
  assert.equal(divergence.totalCommon, 2);
  assert.equal(divergence.solverDecision.summary, route.decisions[2].summary);
  assert.equal(divergence.baselineDecision.summary, "battle:synthetic@MT1:9,9");

  const shorter = cloneJson(route);
  shorter.decisions = shorter.decisions.slice(0, 5);
  const lengthDivergence = findDivergence(route, shorter);
  assert.equal(lengthDivergence.divergedAt, 6);
  assert.equal(lengthDivergence.totalCommon, 5);

  return {
    summaryDivergedAt: divergence.divergedAt,
    lengthDivergedAt: lengthDivergence.divergedAt,
  };
}

async function checkGuiCompareApi() {
  const project = loadProject(PROJECT_ROOT);
  const route = readRouteFile(ROUTE_FILE);
  const baseline = mutateRouteAt(route, 2, "battle:baseline@MT1:1,1");
  const server = createGuiServer({
    routeRecord: route,
    routeFile: ROUTE_FILE,
    session: makeStubSession(),
    project,
    debug: true,
    baselineRecord: baseline,
    baselineFile: ROUTE_FILE,
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const routeResponse = await fetchJson(baseUrl, "/api/route");
    assert.equal(routeResponse.baseline.divergence.divergedAt, 2);
    assert.equal(routeResponse.baseline.summary.decisionCount, route.decisions.length);

    const compareResponse = await fetchJson(baseUrl, "/api/route/compare");
    assert.equal(compareResponse.ok, true);
    assert.equal(compareResponse.divergence.divergedAt, 2);
    assert.equal(compareResponse.divergence.baselineDecision.summary, "battle:baseline@MT1:1,1");

    return {
      routeDivergedAt: routeResponse.baseline.divergence.divergedAt,
      compareDivergedAt: compareResponse.divergence.divergedAt,
    };
  } finally {
    await closeServer(server);
  }
}

async function main() {
  const divergence = checkFindDivergence();
  const api = await checkGuiCompareApi();
  console.log(JSON.stringify({ divergence, api }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
