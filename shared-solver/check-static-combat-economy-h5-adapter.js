"use strict";

/** TEST GRADE: unit-plus-micro */

/**
 * PR-5.20c native H5 static adapter checker.
 *
 * Single process. No worker pool, no disk cache, no real tower: the fixture is an
 * in-memory H5-shaped object, and nothing here calls the project loader,
 * functions.js runtime, battle resolver, simulator or event resolver.
 *
 *   A1  the native fixture adapts automatically and the produced problem is
 *       deepStrictEqual to the fixture's independently-derived expectedStaticProblem
 *   A2  the static solver finds a route and a goal archive on its own, every
 *       archive route strictly replays, and each mapped H5 step agrees with the
 *       recorded provenance cell for cell
 *   A3  every unsupported semantic has at least one mutation, and each one gives
 *       eligible=false, problem=null and no route -- never a rewritten obstacle
 *   A4  wall < 10s, observed peak RSS < 256MB, compact stdout < 5KB
 *
 * A3 is the gate that matters. If a mutation ever adapts into a solvable problem
 * that is a FAILED_ADAPTER_GATE, not something to paper over with more audit
 * fields.
 */

const assert = require("node:assert");
const path = require("node:path");

const {
  CANONICAL_RESOURCE_ITEMS,
  adaptH5StaticFloor,
  inspectH5StaticFloorEligibility,
  mapStaticRouteToH5Steps,
} = require("./lib/static-combat-economy-h5-adapter");
const {
  replayStaticCombatEconomyRoute,
  solveStaticCombatEconomy,
  validateStaticCombatEconomyProblem,
} = require("./lib/static-combat-economy-core");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "static-combat-economy-h5-native.json");
const HARD_LIMIT_MS = 10000;
const HARD_LIMIT_RSS_BYTES = 256 * 1024 * 1024;
const COMPACT_STDOUT_LIMIT = 5120;

let peakRssBytes = 0;
function sampleRss() {
  const rss = process.memoryUsage().rss;
  if (rss > peakRssBytes) peakRssBytes = rss;
  return rss;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function main() {
  const startedAt = process.hrtime.bigint();
  sampleRss();
  const fixture = require(FIXTURE_PATH);
  assert.ok(fixture.project && fixture.expectedStaticProblem);
  // The fixture must be native H5 shape, not a pre-digested static problem.
  ["data", "values", "mapTilesByNumber", "itemsById", "enemysById", "floorsById"]
    .forEach((field) => {
      assert.ok(fixture.project[field] != null, `fixture must expose project.${field}`);
    });
  assert.ok(fixture.project.data.firstData.floorId);
  // No route may be smuggled in as a hint.
  const fixtureText = JSON.stringify(fixture);
  ["route", "checkpoint", "expectedRoute", "order", "sequence"].forEach((word) => {
    assert.strictEqual(
      new RegExp(`"${word}"`).test(fixtureText),
      false,
      `fixture must not carry a "${word}" hint`,
    );
  });

  // --- A1: mechanical adaptation --------------------------------------------
  const inspection = inspectH5StaticFloorEligibility(fixture.project);
  assert.strictEqual(
    inspection.eligible,
    true,
    `native fixture must be eligible: ${JSON.stringify(inspection.unsupported)}`,
  );
  assert.strictEqual(inspection.floorId, fixture.project.data.firstData.floorId);
  assert.deepStrictEqual(inspection.unsupported, []);
  const adaptation = adaptH5StaticFloor(fixture.project);
  assert.strictEqual(adaptation.eligible, true);
  assert.deepStrictEqual(adaptation.unsupported, []);
  assert.deepStrictEqual(
    adaptation.problem,
    fixture.expectedStaticProblem,
    "adapted problem must equal the independently derived expectedStaticProblem",
  );
  assert.ok(
    adaptation.problem.interactions.length >= 20,
    `fixture must carry >=20 interactions, got ${adaptation.problem.interactions.length}`,
  );
  // Provenance must cover every interaction exactly once, with real tile identity.
  assert.strictEqual(
    adaptation.provenance.byIndex.length,
    adaptation.problem.interactions.length,
  );
  const seenProvenanceIds = new Set();
  adaptation.provenance.byIndex.forEach((record, index) => {
    const interaction = adaptation.problem.interactions[index];
    assert.strictEqual(record.interactionIndex, index);
    assert.strictEqual(record.id, interaction.id);
    assert.strictEqual(record.kind, interaction.kind);
    assert.strictEqual(record.x, interaction.x);
    assert.strictEqual(record.y, interaction.y);
    assert.strictEqual(record.floorId, adaptation.floorId);
    assert.ok(typeof record.tileNumber === "number" && Number.isSafeInteger(record.tileNumber));
    assert.ok(typeof record.tileId === "string" && record.tileId.length > 0);
    // The id really is floorId + coordinates + tile id.
    assert.strictEqual(record.id, `${record.floorId}:${record.x},${record.y}:${record.tileId}`);
    assert.strictEqual(seenProvenanceIds.has(record.id), false, "interaction ids must be unique");
    seenProvenanceIds.add(record.id);
    assert.strictEqual(adaptation.provenance.byId[record.id], record);
    // The tile number must be the one actually on the floor at that cell.
    const floor = fixture.project.floorsById[record.floorId];
    assert.strictEqual(floor.map[record.y][record.x], record.tileNumber);
    assert.strictEqual(
      fixture.project.mapTilesByNumber[String(record.tileNumber)].id,
      record.tileId,
    );
  });
  // Resource gains must come from project.values and floor.ratio, nothing else.
  const floorRatio = fixture.project.floorsById[adaptation.floorId].ratio;
  adaptation.problem.interactions.forEach((interaction, index) => {
    if (interaction.kind !== "resource") return;
    const tileId = adaptation.provenance.byIndex[index].tileId;
    const canonical = CANONICAL_RESOURCE_ITEMS[tileId];
    assert.ok(canonical, `resource ${tileId} must be in the canonical allowlist`);
    const base = fixture.project.values[canonical.valueKey];
    const withRatio = base * floorRatio;
    const amount = interaction[canonical.attribute];
    assert.ok(
      amount === base || amount === withRatio,
      `resource ${tileId} gain ${amount} must be values.${canonical.valueKey} optionally times ratio`,
    );
  });
  sampleRss();

  // --- A2: the solver does the work, and the mapping stays honest ------------
  const validation = validateStaticCombatEconomyProblem(adaptation.problem);
  assert.strictEqual(
    validation.valid,
    true,
    `adapted problem failed core validation: ${validation.errors.join(",")}`,
  );
  const solved = solveStaticCombatEconomy(validation.problem, { maxExpandedStates: 200000 });
  assert.strictEqual(solved.status, "SOLVED", `adapted floor must be solved, got ${solved.status}`);
  assert.ok(Array.isArray(solved.route) && solved.route.length > 0);
  assert.ok(solved.goalArchive.length >= 1);
  let mappedSteps = 0;
  solved.goalArchive.forEach((entry, entryIndex) => {
    const replay = replayStaticCombatEconomyRoute(validation.problem, entry.route);
    assert.strictEqual(
      replay.valid,
      true,
      `archive route ${entryIndex} failed strict replay: ${replay.reason}`,
    );
    assert.strictEqual(replay.finalHero.hp, entry.hero.hp);
    const mapped = mapStaticRouteToH5Steps(adaptation, entry.route);
    assert.strictEqual(mapped.ok, true, `route ${entryIndex} mapping failed: ${mapped.reason}`);
    assert.strictEqual(mapped.steps.length, entry.route.length);
    mapped.steps.forEach((step, stepIndex) => {
      const routeStep = entry.route[stepIndex];
      const record = adaptation.provenance.byIndex[routeStep.interactionIndex];
      assert.strictEqual(step.interactionIndex, routeStep.interactionIndex);
      assert.strictEqual(step.id, routeStep.id);
      assert.strictEqual(step.kind, routeStep.kind);
      assert.strictEqual(step.floorId, record.floorId);
      assert.strictEqual(step.x, record.x);
      assert.strictEqual(step.y, record.y);
      assert.strictEqual(step.tileNumber, record.tileNumber);
      assert.strictEqual(step.tileId, record.tileId);
      const floor = fixture.project.floorsById[step.floorId];
      assert.strictEqual(floor.map[step.y][step.x], step.tileNumber);
    });
    mappedSteps += mapped.steps.length;
  });
  // A forged step must not map.
  const forged = mapStaticRouteToH5Steps(adaptation, [
    { interactionIndex: 0, kind: "monster", id: "not-a-real-id" },
  ]);
  assert.strictEqual(forged.ok, false);
  assert.strictEqual(forged.reason, "route-step-provenance-mismatch:0");
  const outOfRange = mapStaticRouteToH5Steps(adaptation, [
    { interactionIndex: 9999, kind: "monster", id: "x" },
  ]);
  assert.strictEqual(outOfRange.ok, false);
  assert.strictEqual(outOfRange.reason, "unknown-route-step:0");
  sampleRss();

  // --- A3: every unsupported semantic fails the whole floor closed -----------
  const floorId = adaptation.floorId;
  const enemyCell = adaptation.provenance.byIndex.find((entry) => entry.kind === "monster");
  const resourceCell = adaptation.provenance.byIndex.find((entry) => entry.kind === "resource");
  const jewelCell = adaptation.provenance.byIndex.find((entry) => entry.tileId === "redJewel");
  const exitKey = Object.keys(fixture.project.floorsById[floorId].changeFloor)[0];

  const mutations = [
    ["events", (p) => { p.floorsById[floorId].events = { "3,1": [{ type: "text", text: "hi" }] }; }],
    ["autoEvent", (p) => { p.floorsById[floorId].autoEvent = { "3,1": { 0: { condition: "true" } } }; }],
    ["firstArrive", (p) => { p.floorsById[floorId].firstArrive = [{ type: "text", text: "hi" }]; }],
    ["eachArrive", (p) => { p.floorsById[floorId].eachArrive = [{ type: "setValue" }]; }],
    ["parallelDo", (p) => { p.floorsById[floorId].parallelDo = "core.setFlag('x', 1)"; }],
    ["beforeBattle", (p) => { p.floorsById[floorId].beforeBattle = { greenSlime: [{ type: "text" }] }; }],
    ["afterBattle", (p) => { p.floorsById[floorId].afterBattle = { "3,1": [{ type: "text" }] }; }],
    ["afterGetItem", (p) => { p.floorsById[floorId].afterGetItem = { "1,3": [{ type: "text" }] }; }],
    ["door", (p) => {
      p.mapTilesByNumber["81"] = { id: "yellowDoor", cls: "animates", canPass: false, trigger: "openDoor" };
      p.floorsById[floorId].map[1][2] = 81;
    }],
    ["key", (p) => {
      p.mapTilesByNumber["82"] = { id: "yellowKey", cls: "items", canPass: false, trigger: "getItem" };
      p.itemsById.yellowKey = { id: "yellowKey", cls: "items", itemEffect: "core.status.hero.items.yellowKey++" };
      p.floorsById[floorId].map[1][2] = 82;
    }],
    ["shop", (p) => {
      p.mapTilesByNumber["83"] = { id: "shop", cls: "npcs", canPass: false, trigger: "action" };
      p.floorsById[floorId].map[1][2] = 83;
    }],
    ["equipment", (p) => {
      p.mapTilesByNumber["84"] = { id: "sword1", cls: "items", canPass: false, trigger: "getItem" };
      p.itemsById.sword1 = { id: "sword1", cls: "items", equip: { type: 0, atk: 10 }, itemEffect: "" };
      p.floorsById[floorId].map[1][2] = 84;
    }],
    ["skill", (p) => {
      p.mapTilesByNumber["85"] = { id: "book", cls: "items", canPass: false, trigger: "getItem" };
      p.itemsById.book = { id: "book", cls: "items", useItemEffect: "core.openBook()" };
      p.floorsById[floorId].map[1][2] = 85;
    }],
    ["hero-money", (p) => { p.data.firstData.hero.money = 100; }],
    ["hero-exp", (p) => { p.data.firstData.hero.exp = 50; }],
    ["hero-level", (p) => { p.data.firstData.hero.lv = 2; }],
    ["hero-items", (p) => { p.data.firstData.hero.items = { yellowKey: 1 }; }],
    ["hero-equipment", (p) => { p.data.firstData.hero.equipment = { 0: "sword1" }; }],
    ["enemy-money", (p) => { p.enemysById[enemyCell.tileId].money = 12; }],
    ["enemy-exp", (p) => { p.enemysById[enemyCell.tileId].exp = 7; }],
    ["enemy-point", (p) => { p.enemysById[enemyCell.tileId].point = 3; }],
    ["special-monster-number", (p) => { p.enemysById[enemyCell.tileId].special = 1; }],
    ["special-monster-array", (p) => { p.enemysById[enemyCell.tileId].special = [1, 2]; }],
    ["special-monster-field", (p) => { p.enemysById[enemyCell.tileId].firstAttack = true; }],
    ["custom-item-effect", (p) => {
      p.itemsById[jewelCell.tileId].itemEffect = "core.status.hero.atk += 999";
    }],
    ["item-effect-with-extra-expression", (p) => {
      p.itemsById[jewelCell.tileId].itemEffect =
        "core.status.hero.atk += core.values.redJewel * core.status.thisMap.ratio; core.setFlag('x',1)";
    }],
    ["tool-sensitive-tile", (p) => {
      p.mapTilesByNumber["86"] = { id: "specialWall", cls: "terrains", canPass: false, trigger: "pickaxe" };
      p.floorsById[floorId].map[1][2] = 86;
    }],
    ["tile-script", (p) => {
      p.mapTilesByNumber["87"] = { id: "scriptedFloor", cls: "terrains", canPass: true, event: [{ type: "text" }] };
      p.floorsById[floorId].map[1][2] = 87;
    }],
    ["unknown-tile-passability", (p) => {
      p.mapTilesByNumber["88"] = { id: "mysteryTile", cls: "terrains" };
      p.floorsById[floorId].map[1][2] = 88;
    }],
    ["multiple-exits", (p) => {
      p.floorsById[floorId].changeFloor["1,1"] = { floorId: "MT3", loc: [1, 1] };
    }],
    ["missing-exit", (p) => { p.floorsById[floorId].changeFloor = {}; }],
    ["cross-floor-continuation", (p) => {
      // A second stair tile the floor never registered: it must not become terrain.
      p.floorsById[floorId].map[1][2] = 2;
    }],
    ["exit-tile-mismatch", (p) => {
      const parts = exitKey.split(",");
      p.floorsById[floorId].map[Number(parts[1])][Number(parts[0])] = 0;
    }],
    ["unknown-map-number", (p) => { p.floorsById[floorId].map[1][2] = 999; }],
    ["unknown-item", (p) => { delete p.itemsById[resourceCell.tileId]; }],
    ["unknown-enemy", (p) => { delete p.enemysById[enemyCell.tileId]; }],
    ["unknown-item-value", (p) => { delete p.values[CANONICAL_RESOURCE_ITEMS[jewelCell.tileId].valueKey]; }],
    ["non-rectangular-map", (p) => { p.floorsById[floorId].map[1].push(0); }],
    ["missing-floor", (p) => { p.data.firstData.floorId = "MT99"; }],
    ["missing-hero", (p) => { delete p.data.firstData.hero; }],
    ["interaction-on-start", (p) => {
      const start = p.data.firstData.hero.loc;
      p.floorsById[floorId].map[start.y][start.x] = enemyCell.tileNumber;
    }],
  ];

  const mutationReports = [];
  for (const [label, mutate] of mutations) {
    const mutated = clone(fixture.project);
    mutate(mutated);
    const probe = inspectH5StaticFloorEligibility(mutated);
    const adapted = adaptH5StaticFloor(mutated);
    assert.strictEqual(
      probe.eligible,
      false,
      `FAILED_ADAPTER_GATE: mutation ${label} was still eligible`,
    );
    assert.strictEqual(
      adapted.eligible,
      false,
      `FAILED_ADAPTER_GATE: mutation ${label} was still adapted`,
    );
    assert.strictEqual(
      adapted.problem,
      null,
      `FAILED_ADAPTER_GATE: mutation ${label} produced a problem instead of failing closed`,
    );
    assert.strictEqual(adapted.provenance, null);
    assert.ok(
      adapted.unsupported.length > 0,
      `mutation ${label} must report at least one reason`,
    );
    // Every finding must carry a locatable, stable identity.
    adapted.unsupported.forEach((entry) => {
      assert.ok(Object.prototype.hasOwnProperty.call(entry, "floorId"));
      assert.ok(Object.prototype.hasOwnProperty.call(entry, "x"));
      assert.ok(Object.prototype.hasOwnProperty.call(entry, "y"));
      assert.ok(typeof entry.reason === "string" && entry.reason.length > 0);
    });
    // Stable ordering: re-sorting must be a no-op.
    const resorted = adapted.unsupported.slice().sort((left, right) => {
      const leftFloor = left.floorId == null ? "" : String(left.floorId);
      const rightFloor = right.floorId == null ? "" : String(right.floorId);
      if (leftFloor !== rightFloor) return leftFloor < rightFloor ? -1 : 1;
      const leftY = left.y == null ? -1 : left.y;
      const rightY = right.y == null ? -1 : right.y;
      if (leftY !== rightY) return leftY - rightY;
      const leftX = left.x == null ? -1 : left.x;
      const rightX = right.x == null ? -1 : right.x;
      if (leftX !== rightX) return leftX - rightX;
      if (left.reason !== right.reason) return left.reason < right.reason ? -1 : 1;
      return 0;
    });
    assert.deepStrictEqual(adapted.unsupported, resorted, `mutation ${label} report is not stably sorted`);
    // No route can exist: there is no problem to solve, and mapping refuses.
    const mappingAttempt = mapStaticRouteToH5Steps(adapted, solved.route);
    assert.strictEqual(mappingAttempt.ok, false);
    assert.strictEqual(mappingAttempt.reason, "adaptation-not-eligible");
    assert.deepStrictEqual(mappingAttempt.steps, []);
    mutationReports.push({ mutation: label, reasons: adapted.unsupported.length, firstReason: adapted.unsupported[0].reason });
  }
  sampleRss();

  // The unmutated fixture must still be eligible after all that cloning.
  assert.strictEqual(inspectH5StaticFloorEligibility(fixture.project).eligible, true);

  // --- A4 budgets -----------------------------------------------------------
  const wallMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  const peakRssMb = Math.round((sampleRss() / (1024 * 1024)) * 10) / 10;
  assert.ok(wallMs < HARD_LIMIT_MS, `A4 wall ${wallMs}ms exceeded ${HARD_LIMIT_MS}ms`);
  assert.ok(
    peakRssBytes < HARD_LIMIT_RSS_BYTES,
    `A4 peak RSS ${peakRssMb}MB exceeded ${HARD_LIMIT_RSS_BYTES / (1024 * 1024)}MB`,
  );

  const compact = {
    status: "passed",
    schema: "motapathfinder.static-combat-economy-h5-adapter-check.v1",
    a1: {
      floorId: adaptation.floorId,
      eligible: adaptation.eligible,
      interactions: adaptation.problem.interactions.length,
      monsters: adaptation.problem.interactions.filter((entry) => entry.kind === "monster").length,
      resources: adaptation.problem.interactions.filter((entry) => entry.kind === "resource").length,
      gridSize: `${adaptation.problem.grid[0].length}x${adaptation.problem.grid.length}`,
      start: adaptation.problem.start,
      goal: adaptation.problem.goal,
      floorRatio,
      matchesExpectedStaticProblem: true,
    },
    a2: {
      status: solved.status,
      finalHp: solved.finalHero.hp,
      routeLength: solved.route.length,
      goalArchive: solved.goalArchive.length,
      archiveVectors: solved.goalArchive.map((entry) =>
        `${entry.hero.hp}/${entry.hero.atk}/${entry.hero.def}/${entry.hero.mdef}`),
      expanded: solved.expanded,
      dominated: solved.dominated,
      peakFrontier: solved.peakFrontier,
      agendaRebuilds: solved.agendaRebuilds,
      mappedH5Steps: mappedSteps,
    },
    a3: {
      mutations: mutationReports.length,
      allFailedClosed: true,
      mutationList: mutationReports.map((entry) => entry.mutation),
    },
    a4: {
      wallMs,
      peakRssMb,
      singleProcess: true,
      workerPool: false,
      diskCache: false,
    },
  };
  const serialized = `${JSON.stringify(compact, null, 2)}\n`;
  assert.ok(
    serialized.length < COMPACT_STDOUT_LIMIT,
    `A4 compact stdout ${serialized.length}B exceeded ${COMPACT_STDOUT_LIMIT}B`,
  );
  process.stdout.write(serialized);
}

main();
