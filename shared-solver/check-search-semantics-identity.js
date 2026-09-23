"use strict";

// PR-5.31g gate: resumeSearchFingerprint must cover EVERY effective search
// option (agenda/priority/fairness/action-cap/continuation-slice local mode) and MUST NOT
// change for diagnostic/output-only fields. Recovery must fail-closed when the
// effective semantics differ. This is an execution-identity contract test; it
// does not run a search.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const d = require("./lib/durable-search");

function buildSyntheticTower(root) {
  const project = path.join(root, "tower/project");
  fs.mkdirSync(path.join(project, "floors"), { recursive: true });
  const hero = { hp: 100, atk: 1, def: 0, lv: 1, exp: 0, items: {}, loc: { x: 0, y: 0, direction: "right" } };
  for (const [name, object] of Object.entries({
    data: { main: { floorIds: ["A", "B"] }, firstData: { floorId: "A", hero, levelUp: [] }, flags: {}, values: {} },
    maps: { 87: { id: "upFloor", cls: "terrains", trigger: "changeFloor", noPass: false } },
    items: {}, enemys: {}, icons: {}, functions: {}, events: { commonEvent: {} },
  })) fs.writeFileSync(path.join(project, `${name}.js`), `var ${name}_test = ${JSON.stringify(object)};`);
  for (const id of ["A", "B"]) {
    const floor = { floorId: id, title: id, width: 3, height: 1, map: [[0, id === "A" ? 87 : 0, 0]],
      events: {}, firstArrive: [], eachArrive: [], afterBattle: {}, autoEvent: {},
      changeFloor: id === "A" ? { "1,0": { floorId: "B", loc: [0, 0], direction: "right" } } : {} };
    fs.writeFileSync(path.join(project, "floors", `${id}.js`), `main.floors.${id} = ${JSON.stringify(floor)};`);
  }
  return path.dirname(project);
}

function baseConfig() {
  const hero = { hp: 100, atk: 1, def: 0, lv: 1, exp: 0, items: {}, loc: { x: 0, y: 0, direction: "right" } };
  return {
    title: "Semantics identity gate", initial: { floorId: "A", hero, inventory: { greenKey: 30 }, flags: {} },
    allowedFloors: ["A", "B"], protectedItems: ["greenKey"], stages: [{ floorId: "B" }],
    budgets: [{ expansions: 100, runtimeMs: 5000 }], candidateLimit: 4, heapMb: 256, maxRssMb: 512, maxRuntimeMs: 10000,
    dpPriorityMode: "goal-relative",
  };
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "semantics-identity-check-"));
  try {
    const towerRoot = buildSyntheticTower(temp);
    const base = baseConfig();
    const baseResume = d.resumeSearchFingerprint(base, towerRoot);
    const baseProblem = d.problemFingerprint(base, towerRoot);

    // G1: each effective search option must change the resume fingerprint.
    const semanticMutations = {
      dpPriorityMode: "resource-first",
      dpAgendaMode: "hybrid-fair",
      fairnessEvery: 4,
      fairOrderMode: "inherited",
      maxActionsPerState: 2048,
    };
    for (const [field, value] of Object.entries(semanticMutations)) {
      const mutated = { ...base, [field]: value };
      const resume = d.resumeSearchFingerprint(mutated, towerRoot);
      assert.notEqual(resume, baseResume, `G1 FAIL: changing ${field} did not change resumeSearchFingerprint`);
      assert.equal(d.problemFingerprint(mutated, towerRoot), baseProblem, `G1 FAIL: ${field} must not change problemFingerprint`);
    }

    // continuationSlice.* including the local comparator must invalidate resume
    // when enabled, while disabled settings remain semantically inert.
    for (const slice of [
      { enabled: true, mode: null, budget: null },
      { enabled: true, mode: "greedy-local", budget: null },
      { enabled: true, mode: "greedy-local", budget: 500 },
    ]) {
      const mutated = { ...base, continuationSlice: slice };
      assert.notEqual(d.resumeSearchFingerprint(mutated, towerRoot), baseResume,
        `G1 FAIL: continuationSlice ${JSON.stringify(slice)} did not change resumeSearchFingerprint`);
    }
    for (const localPriorityMode of ["inherit", "resource-first"]) {
      const mutated = { ...base, continuationSlice: {
        enabled: true, budget: 32, localPriorityMode,
      } };
      assert.notEqual(d.resumeSearchFingerprint(mutated, towerRoot), baseResume,
        `G1 FAIL: localPriorityMode=${localPriorityMode} did not change resumeSearchFingerprint`);
      assert.equal(d.problemFingerprint(mutated, towerRoot), baseProblem,
        "G1 FAIL: local comparator must not change problemFingerprint");
    }
    // A disabled continuation slice equals the default even when an inert local
    // comparator value is present.
    assert.equal(d.resumeSearchFingerprint({ ...base, continuationSlice: {
      enabled: false, localPriorityMode: "resource-first",
    } }, towerRoot), baseResume,
    "G1 FAIL: disabled localPriorityMode must remain semantically inert");

    // G2: diagnostic/output-only fields MUST NOT change the resume fingerprint.
    const diagnosticMutations = {
      title: "totally different title",
      scoreLabel: "different label",
      scoreFlagLabel: "irrelevant",
      logPath: "/tmp/some/other/log/path",
      reportFile: "renamed-report.json",
      description: "notes",
    };
    for (const [field, value] of Object.entries(diagnosticMutations)) {
      const mutated = { ...base, [field]: value };
      assert.equal(d.resumeSearchFingerprint(mutated, towerRoot), baseResume,
        `G2 FAIL: diagnostic field ${field} changed resumeSearchFingerprint`);
    }

    // Same config twice is stable.
    assert.equal(d.resumeSearchFingerprint(baseConfig(), towerRoot), baseResume, "STABILITY FAIL: identical config produced different fingerprint");

    // searchSemantics defaults must equal current production behavior.
    const defaults = d.searchSemantics({});
    assert.equal(defaults.dpAgendaMode, "best-first");
    assert.equal(defaults.fairnessEvery, 32);
    assert.equal(defaults.fairOrderMode, "fifo");
    assert.equal(defaults.maxActionsPerState, 4096);
    assert.equal(defaults.continuationSlice.enabled, false);
    assert.equal(defaults.continuationSlice.localPriorityMode, null);
    // fairnessEvery is a raw scalar (always fingerprinted), so changing it under
    // any agenda mode invalidates resume — no cross-option suppression.
    assert.notEqual(
      d.resumeSearchFingerprint({ ...base, fairnessEvery: 8 }, towerRoot),
      d.resumeSearchFingerprint({ ...base, fairnessEvery: 16 }, towerRoot),
      "G1 FAIL: fairnessEvery must always affect fingerprint",
    );

    // G3: recovery must fail-closed when effective semantics differ.
    const { loadProject } = require("./lib/project-loader");
    const project = loadProject(towerRoot);
    const state = d.initialState(project, d.makeSimulator(project, base), base);
    const journal = d.newJournal(d.identityOf(base, towerRoot), base, state, towerRoot);
    assert.ok(journal.executionProvenance, "G5 FAIL: newJournal must record executionProvenance");
    assert.equal(journal.executionProvenance.solverDigest.length, 64, "G5 FAIL: solverDigest must be a sha256");
    assert.equal(journal.executionProvenance.searchSemantics.dpPriorityMode, "goal-relative");
    // Recovery with identical semantics succeeds.
    assert.doesNotThrow(() => d.recoverJournal({ ...journal }, d.identityOf(base, towerRoot), { config: base, towerRoot }));
    // Recovery with a changed effective search option is refused.
    const drifted = { ...base, dpAgendaMode: "hybrid-fair", fairnessEvery: 4 };
    assert.throws(
      () => d.recoverJournal({ ...journal }, d.identityOf(drifted, towerRoot), { config: drifted, towerRoot }),
      /SEARCH_SEMANTICS_DRIFT/,
      "G3 FAIL: changed agenda/fairness must be refused on recovery",
    );
    // Recovery after only a diagnostic change still succeeds.
    assert.doesNotThrow(
      () => d.recoverJournal({ ...journal }, d.identityOf({ ...base, title: "x" }, towerRoot), { config: { ...base, title: "x" }, towerRoot }),
      "G2 FAIL: diagnostic-only change must still resume",
    );

    const inheritLocal = {
      ...base,
      continuationSlice: { enabled: true, budget: 32, localPriorityMode: "inherit" },
    };
    const resourceLocal = {
      ...base,
      continuationSlice: { enabled: true, budget: 32, localPriorityMode: "resource-first" },
    };
    const localJournal = d.newJournal(d.identityOf(inheritLocal, towerRoot), inheritLocal, state, towerRoot);
    assert.equal(localJournal.executionProvenance.searchSemantics.continuationSlice.localPriorityMode, "inherit");
    assert.throws(
      () => d.recoverJournal(localJournal, d.identityOf(resourceLocal, towerRoot), { config: resourceLocal, towerRoot }),
      /SEARCH_SEMANTICS_DRIFT/,
      "G3 FAIL: local comparator drift must be refused on recovery",
    );
    assert.throws(
      () => d.recoverJournal({ ...localJournal }, d.identityOf(resourceLocal, towerRoot), { config: resourceLocal, towerRoot }),
      /SEARCH_SEMANTICS_DRIFT/,
      "G3 FAIL: local comparator drift must fail closed even on copied journals",
    );

    const confluenceOn = {
      ...inheritLocal,
      continuationSlice: { ...inheritLocal.continuationSlice, exactConfluenceHandoff: true },
    };
    const confluenceOff = {
      ...inheritLocal,
      continuationSlice: { ...inheritLocal.continuationSlice, exactConfluenceHandoff: false },
    };
    assert.deepEqual(d.searchSemantics(confluenceOff), d.searchSemantics(inheritLocal),
      "G5 FAIL: explicit handoff OFF must retain legacy semantics serialization");
    assert.notEqual(d.resumeSearchFingerprint(confluenceOn, towerRoot), d.resumeSearchFingerprint(inheritLocal, towerRoot),
      "G5 FAIL: handoff ON must change resume fingerprint");
    assert.equal(d.problemFingerprint(confluenceOn, towerRoot), baseProblem);
    assert.equal(d.searchSemantics(confluenceOn).continuationSlice.exactConfluenceHandoff, true);
    assert.deepEqual(d.searchSemantics({ ...base, continuationSlice: { enabled: false, exactConfluenceHandoff: true } }),
      d.searchSemantics(base), "G5 FAIL: disabled slice must ignore handoff");
    assert.throws(() => d.searchSemantics({ continuationSlice: { enabled: true, exactConfluenceHandoff: "true" } }),
      /unsupported continuationSlice.exactConfluenceHandoff/);
    assert.throws(
      () => d.recoverJournal({ ...localJournal }, d.identityOf(confluenceOn, towerRoot), { config: confluenceOn, towerRoot }),
      /SEARCH_SEMANTICS_DRIFT/,
      "G5 FAIL: exact-confluence handoff drift must fail closed on recovery",
    );

    console.log("PASS search-semantics-identity: effective options fingerprinted (agenda/priority/fairness/action-cap/local comparator/exact-confluence handoff); diagnostic fields inert; recovery fail-closed; OFF serialization preserved");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
