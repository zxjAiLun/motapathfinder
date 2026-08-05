"use strict";

/**
 * TEST GRADE: integration-local
 *
 * PR-5.3d Launcher UI smoke: a real Chromium browser drives the manual
 * SolveTask builder + job dashboard against the real launcher server.  Covers
 * model defaults, preflight, worker job completion with verified-route,
 * refresh recovery, strictReplay:false route-artifact, legacy objective-less
 * jobs, and auto-step route metrics.  No fake completion percentage.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright-core");
const { createLauncherServer } = require("./launcher/server");
const { findBrowserExecutable } = require("./lib/live-replay");

const ROOT = path.resolve(__dirname, "..");
const ONLY_UP_ROOT = path.join(ROOT, "Only upV2.1", "Only upV2.1");

async function waitFor(condition, timeoutMs, intervalMs) {
  const started = Date.now();
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs || 100));
  }
}

async function submitViaApi(page, base, task, label) {
  const jobId = await page.evaluate(async ({ base, task }) => {
    const response = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
    const payload = await response.json();
    return payload.job && payload.job.id || null;
  }, { base, task });
  assert.ok(jobId, `${label}: job must be accepted via the API`);
  await waitFor(async () => {
    const state = await page.evaluate(async ({ base, jobId }) => {
      const response = await fetch(`${base}/api/jobs/${jobId}`);
      const payload = await response.json();
      return payload.job && payload.job.state;
    }, { base, jobId });
    return ["completed", "failed", "cancelled"].includes(state);
  }, 120000, 200);
  return jobId;
}

async function fetchJobResult(page, base, jobId) {
  return page.evaluate(async ({ base, jobId }) => {
    const response = await fetch(`${base}/api/jobs/${jobId}/result`);
    const payload = await response.json();
    return payload.result;
  }, { base, jobId });
}
function buildTask() {
  const spec = JSON.parse(fs.readFileSync(
    path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json"),
    "utf8",
  ));
  return {
    schema: "motapathfinder.solve-task.v1",
    tower: {
      id: "onlyup-v2.1",
      projectRoot: ONLY_UP_ROOT,
      region: { spec },
    },
    objective: { mode: "max-final-hp" },
    search: {
      algorithm: "segment-dp",
      maxExpansions: 1000,
      maxRuntimeMs: 10000,
      candidateLimit: 2,
      goalSkylineLimit: 8,
    },
    verification: { strictReplay: true },
  };
}

async function main() {
  assert.ok(findBrowserExecutable(), "Chrome/Edge executable is required for the Launcher UI smoke");
  const jobsRoot = path.join(__dirname, "routes", "generated", "launcher-ui-check");
  fs.rmSync(jobsRoot, { recursive: true, force: true });
  const launcher = createLauncherServer({ port: 0, jobsRoot, maxConcurrentJobs: 1 });
  const port = await launcher.listen();
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: findBrowserExecutable(), headless: true });
  try {
    const page = await browser.newPage();

    // 1. Open the Launcher and wait for the tower registry.
    
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector("#tower-select option", { state: "attached", timeout: 15000 });
    const towerOptions = await page.locator("#tower-select option").count();
    assert.ok(towerOptions >= 1, "tower registry must populate the tower selector");
    const towerValue = await page.locator("#tower-select").inputValue();
    assert.strictEqual(towerValue, "onlyup-v2.1");

    // 2. Region select populated; choose the short smoke region so the worker
    //    job completes promptly, and wait for its SolverModel to load.
    await page.waitForSelector("#region-select option", { state: "attached", timeout: 15000 });
    const regionOptions = await page.locator("#region-select option").count();
    assert.ok(regionOptions >= 1, "region registry must populate the region selector");
    await page.selectOption("#region-select", "region-output-contract-smoke");
    await waitFor(async () => {
      const value = await page.locator("#model-followers").inputValue().catch(() => "pending");
      return value === "disabled";
    }, 10000, 200);
    assert.strictEqual(await page.locator("#model-money").inputValue(), "disabled", "the smoke region model must override the UI defaults");

    // 3. SolverModel defaults: mana / hpmax disabled, hp dominance.
    assert.strictEqual(await page.locator("#model-mana").inputValue(), "disabled");
    assert.strictEqual(await page.locator("#model-hpmax").inputValue(), "disabled");
    assert.strictEqual(await page.locator("#model-hp").inputValue(), "dominance");

    // 4-5. max-final-hp default; run preflight.
    assert.strictEqual(await page.locator("#objective-mode").inputValue(), "max-final-hp");
    
    await page.click('#validate-btn');
    await waitFor(async () => {
      const text = await page.locator("#preflight-result").innerText().catch(() => "");
      return text.includes("preflight 通过");
    }, 15000, 200);
    const preflightText = await page.locator("#preflight-result").innerText();
    assert.ok(preflightText.includes("task fingerprint"), "preflight must display the task fingerprint");

    // Use the smoke-test search parameters so the produced route replays
    // cleanly in the real runtime (the UI defaults explore a wider frontier).
    await page.fill("#s-max-expansions", "1000");
    await page.fill("#s-max-runtime", "10000");
    await page.fill("#s-candidate-limit", "2");
    await page.fill("#s-goal-skyline", "8");

    // 6-9. Submit a default worker job and wait for verified-route.
    
    await page.click('#submit-btn');
    await page.waitForSelector("#job-detail .metrics", { timeout: 15000 });
    await waitFor(async () => {
      const text = await page.locator("#job-detail").innerText().catch(() => "");
      return text.includes("路线已通过 runtime replay");
    }, 120000, 300);
    const detailText = await page.locator("#job-detail").innerText();
    assert.ok(detailText.includes("decisionDepth"), "dashboard must display decisionDepth");
    assert.ok(detailText.includes("routeLength"), "dashboard must display routeLength");
    assert.ok(detailText.includes("预算消耗"), "dashboard must label budget ratios as consumption");

    // 7. No fake completion percentage anywhere in the UI.
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.ok(!/完成\s*[0-9]+%/.test(bodyText), "the UI must not show a fake completion percentage");

    // 16. Refresh: terminal job + result recoverable.
    
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(async () => {
      const text = await page.locator("#job-table").innerText().catch(() => "");
      return text.includes("completed");
    }, 20000, 300);

    // 7b. A terminal job must offer Retry, never Cancel.
    const tableAfterDone = await page.locator("#job-table").innerText();
    assert.ok(tableAfterDone.includes("按原配置重试"), "a terminal job must offer Retry");
    assert.ok(!tableAfterDone.includes("Cancel"), "a terminal job must not offer Cancel");

    // 13. strictReplay:false job → route-artifact bestKnown, not verified-route.
    // 13. strictReplay:false job → route-artifact bestKnown, not verified-route.
    const noReplayTask = buildTask();
    noReplayTask.verification.strictReplay = false;
    const noReplayJobId = await submitViaApi(page, base, noReplayTask, "strictReplay:false");
    const noReplayFull = await page.evaluate(async ({ base, jobId }) => {
      const response = await fetch(`${base}/api/jobs/${jobId}/result`);
      return await response.json();
    }, { base, jobId: noReplayJobId });
    assert.strictEqual(noReplayFull.result.route.verificationStatus, "not-requested");
    assert.strictEqual(noReplayFull.result.route.strictReplayVerified, false);

    // 10. Legacy objective-less job completes with objective null.
    const legacyTask = buildTask();
    legacyTask.objective = undefined;
    const legacyJobId = await submitViaApi(page, base, legacyTask, "legacy");
    const legacyResult = await page.evaluate(async ({ base, jobId }) => {
      const response = await fetch(`${base}/api/jobs/${jobId}/result`);
      const payload = await response.json();
      return payload.result;
    }, { base, jobId: legacyJobId });
    assert.strictEqual(legacyResult.found, true);
    assert.strictEqual(legacyResult.objective, null);
    assert.strictEqual(legacyResult.route.verificationStatus, "verified");
    assert.strictEqual(legacyResult.route.verificationStatus, "verified");
    // 6b. Legacy bestKnown must not be labelled as an objective.
    await waitFor(async () => {
      const text = await page.locator("#job-table").innerText().catch(() => "");
      return text.includes("Legacy · HP");
    }, 20000, 300);

    // 5b. An incomplete search shows "未完成", not a generic failure, and
    //     offers a ×2 retry that resubmits the original task with a doubled budget.
    const exhaustSpec = JSON.parse(fs.readFileSync(
      path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json"), "utf8"));
    exhaustSpec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 999 } };
    const exhaustTask = buildTask();
    exhaustTask.tower.region.spec = exhaustSpec;
    exhaustTask.search.maxExpansions = 5;
    exhaustTask.search.maxRuntimeMs = 0; // unlimited: time ×2 must never appear
    console.error("M exhaust submit");
    const exhaustJobId = await submitViaApi(page, base, exhaustTask, "exhausted");
    const exhaustResult = await fetchJobResult(page, base, exhaustJobId);
    assert.strictEqual(exhaustResult.failure.failureClass, "EXPANSION_BUDGET_EXHAUSTED");
    assert.strictEqual(exhaustResult.failure.retryable, true);
    await waitFor(async () => {
      const text = await page.locator("#job-table").innerText().catch(() => "");
      return text.includes("未完成") && text.includes("扩展预算 ×2");
    }, 20000, 300);
    // Retry buttons must be narrowed by failureClass: an expansion-exhausted
    // job (with unlimited runtime) offers only expansion ×2.
    const exhaustRowText = await page.locator(`.job-row:has-text("${exhaustJobId}")`).innerText();
    assert.ok(exhaustRowText.includes("扩展预算 ×2"), "expansion-exhausted job must offer expansion ×2");
    assert.ok(!exhaustRowText.includes("运行时间 ×2"), "expansion-exhausted / unlimited-runtime job must not offer time ×2");
    assert.ok(!exhaustRowText.includes("动作候选 ×2"), "expansion-exhausted job must not offer action-cap ×2");
    // A runtime-exhausted job offers time ×2 only.
    const runtimeTask = buildTask();
    runtimeTask.tower.region.spec = JSON.parse(JSON.stringify(exhaustSpec));
    runtimeTask.search.maxRuntimeMs = 1;
    runtimeTask.search.maxExpansions = 100000;
    console.error("M runtime submit");
    const runtimeJobId = await submitViaApi(page, base, runtimeTask, "runtime-exhausted");
    const runtimeResult = await fetchJobResult(page, base, runtimeJobId);
    assert.strictEqual(runtimeResult.failure.failureClass, "RUNTIME_BUDGET_EXHAUSTED");
    await waitFor(async () => {
      const text = await page.locator("#job-table").innerText().catch(() => "");
      return text.includes("运行时间 ×2");
    }, 20000, 300);
    const runtimeRowText = await page.locator(`.job-row:has-text("${runtimeJobId}")`).innerText();
    assert.ok(runtimeRowText.includes("运行时间 ×2"), "runtime-exhausted job must offer time ×2");
    assert.ok(!runtimeRowText.includes("扩展预算 ×2"), "runtime-exhausted job must not offer expansion ×2");

    // ACTION_TRIMMED job offers action-cap ×2 (not budget ×2); clicking it
    // resubmits with the original task's maxActionsPerState doubled.
    const trimTask = buildTask();
    trimTask.tower.region.spec = JSON.parse(JSON.stringify(exhaustSpec));
    trimTask.search.maxActionsPerState = 1;
    trimTask.search.maxExpansions = 100;
    trimTask.search.maxRuntimeMs = 10000;
    const trimJobId = await submitViaApi(page, base, trimTask, "action-trimmed");
    const trimResult = await fetchJobResult(page, base, trimJobId);
    assert.strictEqual(trimResult.failure.failureClass, "ACTION_TRIMMED");
    await waitFor(async () => {
      const text = await page.locator(`.job-row:has-text("${trimJobId}")`).innerText().catch(() => "");
      return text.includes("动作候选 ×2");
    }, 20000, 300);
    const trimRowText = await page.locator(`.job-row:has-text("${trimJobId}")`).innerText();
    assert.ok(trimRowText.includes("动作候选 ×2"), "action-trimmed job must offer action-cap ×2");
    assert.ok(!trimRowText.includes("扩展预算 ×2"), "action-trimmed job must not offer expansion ×2");
    assert.ok(!trimRowText.includes("运行时间 ×2"), "action-trimmed job must not offer time ×2");
    const jobsBeforeTrimRetry = (await (await fetch(`${base}/api/jobs`)).json()).jobs.length;
    await page.locator(`.retry-btn[data-scale="actions2"][data-job="${trimJobId}"]`).click();
    await waitFor(async () => {
      const jobsAfter = (await (await fetch(`${base}/api/jobs`)).json()).jobs.length;
      return jobsAfter > jobsBeforeTrimRetry;
    }, 15000, 300);
    // The newest job carries the doubled action cap.
    const newestJobId = (await (await fetch(`${base}/api/jobs`)).json()).jobs[0].id;
    const newestTask = (await (await fetch(`${base}/api/jobs/${newestJobId}`)).json()).task;
    assert.strictEqual(newestTask.search.maxActionsPerState, 2, "actions2 retry must double maxActionsPerState");

    // P2: "打开配置" must restore the failed job's FULL task into the Builder
    // (objective mode/terms, verification, search) so buildTask() reproduces
    // the original task, not a hybrid with current Builder state.
    const customTrimTask = buildTask();
    customTrimTask.tower.region.spec = JSON.parse(JSON.stringify(exhaustSpec));
    // The user-submitted SolverModel differs from the RegionSpec defaults
    // (hp dominance -> key, money disabled -> key); the restored Builder must
    // reproduce the job's own model, not the RegionSpec's.
    customTrimTask.model = {
      heroFields: {
        hp: "key",
        hpmax: "disabled",
        mana: "disabled",
        manamax: "disabled",
        atk: "key",
        def: "key",
        mdef: "key",
        lv: "key",
        exp: "key",
        money: "key",
        equipment: "key",
        followers: "disabled",
      },
    };
    customTrimTask.search.maxActionsPerState = 1;
    customTrimTask.search.maxExpansions = 100;
    customTrimTask.search.maxRuntimeMs = 10000;
    customTrimTask.objective = { mode: "maximize-score", terms: [{ path: "hero.hp", weight: 1 }] };
    customTrimTask.verification.strictReplay = false;
    const customTrimJobId = await submitViaApi(page, base, customTrimTask, "custom-trim");
    const customTrimResult = await fetchJobResult(page, base, customTrimJobId);
    assert.strictEqual(customTrimResult.failure.failureClass, "ACTION_TRIMMED");
    await waitFor(async () => {
      const text = await page.locator(`.job-row:has-text("${customTrimJobId}")`).innerText().catch(() => "");
      return text.includes("打开配置");
    }, 20000, 300);
    await page.locator(`.config-btn[data-job="${customTrimJobId}"]`).click();
    // The config-btn handler loads the job task asynchronously; wait for the
    // Builder to reflect the restored objective before asserting.
    await waitFor(async () => {
      const value = await page.locator("#objective-mode").inputValue().catch(() => "");
      return value === "maximize-score";
    }, 15000, 200);
    assert.strictEqual(await page.locator("#objective-mode").inputValue(), "maximize-score", "Builder must restore the objective mode");
    assert.ok((await page.locator("#score-terms").inputValue()).includes('"hero.hp"'), "Builder must restore score terms");
    assert.strictEqual(await page.locator("#strict-replay").isChecked(), false, "Builder must restore strictReplay=false");
    assert.strictEqual(await page.locator("#s-max-actions").inputValue(), "1", "Builder must restore maxActionsPerState");
    await page.click("#validate-btn");
    await waitFor(async () => {
      const text = await page.locator("#preflight-result").innerText().catch(() => "");
      return text.includes("preflight 通过");
    }, 15000, 200);
    const restoredTask = JSON.parse(await page.locator("#normalized-task").innerText());
    assert.strictEqual(restoredTask.verification.strictReplay, false, "restored Builder must reproduce strictReplay=false");
    assert.strictEqual(restoredTask.search.maxActionsPerState, 1, "restored Builder must reproduce maxActionsPerState");
    // The restored Builder must reproduce the job's OWN SolverModel (task.model),
    // not the RegionSpec defaults: hp key (spec dominance), money key (spec disabled).
    assert.strictEqual(restoredTask.model.heroFields.hp, "key", "restored Builder must reproduce task.model.hp");
    assert.strictEqual(restoredTask.model.heroFields.money, "key", "restored Builder must reproduce task.model.money");
    assert.strictEqual(restoredTask.tower.id, customTrimTask.tower.id, "restored Builder must reproduce tower.id");
    assert.strictEqual(restoredTask.tower.projectRoot, customTrimTask.tower.projectRoot, "restored Builder must reproduce projectRoot");
    assert.strictEqual(restoredTask.tower.region.spec.id, customTrimTask.tower.region.spec.id, "restored Builder must reproduce region spec id");

    // PR-5.4a Commit 4/5: ordered-region builder round-trip with two DIFFERENT
    // regions, real open-config restore (no .catch), and order assertions.
    // Reload first so the builder is not carrying the failed job's spec.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll("#region-select option").length > 0, null, { timeout: 15000 });
    await page.uncheck("#strict-replay");
    // Insert order: A = smoke, B = region-1.
    await page.locator("#region-select").selectOption("region-output-contract-smoke");
    await page.locator("#region-add-btn").click();
    await page.waitForFunction(() => document.querySelectorAll(".region-order-item").length === 1);
    await page.locator("#region-select").selectOption("region-1");
    await page.locator("#region-add-btn").click();
    await page.waitForFunction(() => document.querySelectorAll(".region-order-item").length === 2);
    const insertOrder = await page.locator(".region-order-label").allInnerTexts();
    assert.ok(insertOrder[0].includes("Output Contract Smoke"), "insertion order A first");
    assert.ok(insertOrder[1].includes("Region 1"), "insertion order B second");
    // Move A down -> order becomes [B, A].
    await page.locator(".region-order-item[data-index=\"0\"] .region-move-down").click();
    await page.waitForFunction(() => {
      const first = document.querySelector(".region-order-label");
      return first && first.textContent.includes("Region 1");
    });
    await page.click("#validate-btn");
    await waitFor(async () => {
      const text = await page.locator("#preflight-result").innerText().catch(() => "");
      return text.includes("preflight 通过") && text.includes("Region");
    }, 15000, 200);
    const orderedTask = JSON.parse(await page.locator("#normalized-task").innerText());
    assert.strictEqual(orderedTask.schema, "motapathfinder.solve-task.v2", "two regions must emit solve-task.v2");
    assert.strictEqual(orderedTask.tower.regions.length, 2, "buildTask must emit the ordered region list");
    assert.strictEqual(orderedTask.tower.regions[0].spec.id, "onlyup-region-1", "the moved-down order must place region-1 first");
    assert.strictEqual(orderedTask.tower.regions[1].spec.id, "onlyup-region-output-contract-smoke");

    // Real restore round-trip via a fast-failing v2 job (region A unreachable).
    const smokeSpecForV2 = JSON.parse(fs.readFileSync(path.join(ROOT, "towers", "onlyup", "region-specs", "region-output-contract-smoke.json"), "utf8"));
    const v2ExhaustSpec = JSON.parse(JSON.stringify(smokeSpecForV2));
    v2ExhaustSpec.goal = { type: "heroAtLeast", floorId: "MT99", minHero: {} };
    exhaustSpec.goal = { type: "heroAtLeast", floorId: "MT1", minHero: { exp: 999 } };
    const region1Spec = JSON.parse(fs.readFileSync(
      path.join(ROOT, "towers", "onlyup", "region-specs", "region-1.json"), "utf8",
    ));
    const v2FailTask = {
      schema: "motapathfinder.solve-task.v2",
      tower: { id: "onlyup-v2.1", projectRoot: ONLY_UP_ROOT, regions: [{ spec: v2ExhaustSpec }, { spec: region1Spec }] },
      model: JSON.parse(JSON.stringify(smokeSpecForV2.model)),
      objective: { mode: "max-final-hp" },
      search: { algorithm: "segment-dp", maxExpansions: 1000, maxRuntimeMs: 10000, candidateLimit: 2, regionCandidateLimit: 8 },
      verification: { strictReplay: false },
    };
    const v2FailCreated = await (await fetch(`${base}/api/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v2FailTask),
    })).json();
    const v2FailJobId = v2FailCreated.job.id;
    await waitFor(async () => {
      const st = await (await fetch(`${base}/api/jobs/${v2FailJobId}`)).json();
      return ["completed", "failed"].includes(st.job.state);
    }, 90000, 500);
    const v2FailConfig = page.locator(`.config-btn[data-job="${v2FailJobId}"]`);
    await v2FailConfig.waitFor({ timeout: 15000 });
    await v2FailConfig.click();
    await waitFor(async () => {
      const labels = await page.locator(".region-order-label").allInnerTexts().catch(() => []);
      return labels.length === 2 && labels[1].includes("Region 1");
    }, 15000, 200);
    await page.click("#validate-btn");
    await waitFor(async () => {
      const text = await page.locator("#preflight-result").innerText().catch(() => "");
      return text.includes("preflight 通过");
    }, 15000, 200);
    const restoredOrdered = JSON.parse(await page.locator("#normalized-task").innerText());
    assert.strictEqual(restoredOrdered.schema, "motapathfinder.solve-task.v2");
    assert.strictEqual(restoredOrdered.tower.regions.length, 2, "restored Builder must reproduce the region count");
    assert.strictEqual(restoredOrdered.tower.regions[0].spec.id, v2ExhaustSpec.id, "restored Builder must reproduce the exact spec id");
    assert.strictEqual(restoredOrdered.tower.regions[1].spec.id, "onlyup-region-1", "restored Builder must reproduce the order");
    // Remove the first region (region-1) -> only the exhaust region remains.
    await page.locator(".region-order-item[data-index=\"0\"] .region-remove").click();
    await page.waitForFunction(() => document.querySelectorAll(".region-order-item").length === 1);
    await page.click("#validate-btn");
    await waitFor(async () => {
      const text = await page.locator("#preflight-result").innerText().catch(() => "");
      return text.includes("preflight 通过");
    }, 15000, 200);
    const afterRemove = JSON.parse(await page.locator("#normalized-task").innerText());
    assert.strictEqual(afterRemove.tower.regions.length, 1, "removing a region must shrink the sequence");
    assert.strictEqual(afterRemove.tower.regions[0].spec.id, "onlyup-region-1", "removing the first region must leave region-1");

    // v2 -> v1 restore residue check: open a v1 job and the ordered list clears.
    const v1JobId = (await (await fetch(`${base}/api/jobs`)).json()).jobs.find((entry) => {
      return entry && entry.id !== v2FailJobId;
    })?.id;
    if (v1JobId) {
      const v1Config = page.locator(`.config-btn[data-job="${v1JobId}"]`);
      if (await v1Config.count()) {
        await v1Config.click();
        await waitFor(async () => {
          const count = await page.locator(".region-order-item").count().catch(() => 0);
          return count === 0;
        }, 15000, 200);
        await page.click("#validate-btn");
        await waitFor(async () => {
          const text = await page.locator("#preflight-result").innerText().catch(() => "");
          return text.includes("preflight 通过");
        }, 15000, 200);
        const v1Restored = JSON.parse(await page.locator("#normalized-task").innerText());
        assert.strictEqual(v1Restored.schema, "motapathfinder.solve-task.v1", "a v1 restore must not leave a v2 region order behind");
      }
    }

    const jobsBeforeRetry = (await (await fetch(`${base}/api/jobs`)).json()).jobs.length;
    await page.locator(".retry-btn[data-scale=\"exp2\"]").first().click();
    await waitFor(async () => {
      const jobsAfter = (await (await fetch(`${base}/api/jobs`)).json()).jobs.length;
      return jobsAfter > jobsBeforeRetry;
    }, 15000, 300);

    // 11. Auto-step job: decisionDepth=1, routeLength=5.
    const routeTask = buildTask();
    routeTask.objective = { mode: "maximize-score", terms: [{ path: "route.length", weight: -1 }] };
    routeTask.verification.strictReplay = true;
    console.error("M route submit");
    const routeJobId = await submitViaApi(page, base, routeTask, "route-length");
    const routeResult = await page.evaluate(async ({ base, jobId }) => {
      const response = await fetch(`${base}/api/jobs/${jobId}/result`);
      const payload = await response.json();
      return payload.result;
    }, { base, jobId: routeJobId });
    assert.strictEqual(routeResult.route.record.stats.depth, 1, "auto-step route must have decisionDepth 1");
    assert.strictEqual(routeResult.route.record.stats.routeLength, 5, "auto-step route must have routeLength 5");
    assert.ok(routeResult.route.record.stats.routeLength > routeResult.route.record.stats.depth);
    assert.strictEqual(routeResult.route.record.metadata.finalObjectiveValue, -5);
    assert.strictEqual(routeResult.route.verificationStatus, "verified");

    process.stdout.write(JSON.stringify({
      schema: "motapathfinder.pr-5.3d1-launcher-ui-live.v1",
      status: "passed",
      port,
      controls: {
        towerAndRegionLoaded: true,
        modelDefaultsManaHpmaxDisabled: true,
        maxFinalHpPreflightFingerprint: true,
        defaultWorkerJobVerifiedRoute: true,
        noFakeCompletionPercent: true,
        refreshRecoversTerminalJob: true,
        strictReplayFalseRouteArtifact: true,
        legacyObjectiveOmittedCompleted: true,
        autoStepDepth1RouteLength5: true,
        dashboardShowsDecisionDepthRouteLength: true,
        terminalJobNoCancel: true,
        legacyBestKnownNotObjective: true,
        incompleteSearchShowsNotDone: true,
        retryDoublesBudgetResubmits: true,
        retryNarrowedByFailureClass: true,
        runtimeExhaustedTime2Only: true,
        unlimitedRuntimeNoTime2: true,
        openConfigRestoresFullTask: true,
        orderedRegionBuilderRoundTrip: true,
      },
    }, null, 2) + "\n");
  } finally {
    await browser.close();
    await launcher.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
