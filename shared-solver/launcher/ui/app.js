"use strict";

const MODEL_FIELDS = [
  ["hp", "dominance"],
  ["atk", "key"],
  ["def", "key"],
  ["mdef", "key"],
  ["lv", "key"],
  ["exp", "key"],
  ["money", "key"],
  ["equipment", "key"],
  ["followers", "key"],
  ["hpmax", "disabled"],
  ["mana", "disabled"],
  ["manamax", "disabled"],
];
const MODEL_MODES = ["disabled", "value", "dominance", "key", "snapshot-only"];

const BEST_KNOWN_LABELS = {
  "progress-state": "尚未达到目标的当前进展",
  "goal-candidate": "已达到目标，尚未构建或验证路线",
  "route-artifact": "路线已生成，未执行 runtime replay",
  "verified-route": "路线已通过 runtime replay",
};

// failureClass -> UI 文案。预算耗尽 / action 截断 / 未达到目标是"未完成"语义，不是执行错误。
const FAILURE_LABELS = {
  "RUNTIME_BUDGET_EXHAUSTED": "未完成 · 时间预算耗尽",
  "EXPANSION_BUDGET_EXHAUSTED": "未完成 · 扩展预算耗尽",
  "ACTION_TRIMMED": "未完成 · 动作候选被截断",
  "GOAL_NOT_REACHED": "当前完整搜索范围内未达到目标",
  "STRICT_REPLAY_FAILED": "路线运行时验证失败",
  "INTERNAL_ERROR": "执行错误",
};

const RETRYABLE_FAILURES = ["RUNTIME_BUDGET_EXHAUSTED", "EXPANSION_BUDGET_EXHAUSTED", "ACTION_TRIMMED", "GOAL_NOT_REACHED"];

const state = {
  tower: null,
  towerFingerprint: null,
  regionSpec: null,
  regionOrder: [],
  jobs: [],
  activeJob: null,
  eventSource: null,
  lastTask: null,
};

function $(id) {
  return document.getElementById(id);
}

async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }
  return { status: response.status, payload };
}

function esc(value) {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function formatTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

async function refreshHealth() {
  const { payload } = await api("GET", "/api/health");
  const dot = $("health");
  const text = $("health-text");
  if (payload && payload.status === "ok") {
    dot.className = "health-dot ok";
    text.textContent = "服务正常";
  } else {
    dot.className = "health-dot err";
    text.textContent = "无法连接";
  }
}

function stateBadge(state, failureClass) {
  const isIncomplete = failureClass && RETRYABLE_FAILURES.includes(failureClass);
  if (state === "failed" && isIncomplete) {
    return `<span class="badge incomplete">未完成</span>`;
  }
  const label = { completed: "已完成", failed: "执行错误", cancelled: "已取消", queued: "排队中", running: "运行中", interrupted: "已中断" }[state] || state;
  return `<span class="badge ${esc(state)}">${esc(label)}</span>`;
}

function bestKnownHtml(bestKnown) {
  if (!bestKnown) return '<span class="muted">—</span>';
  const label = BEST_KNOWN_LABELS[bestKnown.kind] || bestKnown.kind;
  const routeLen = bestKnown.routeLengthExact
    ? esc(bestKnown.routeLength)
    : '<span class="state-warn">待路线重建</span>';
  let objectiveText;
  if (!bestKnown.objectiveFingerprint) {
    // 无显式 ObjectiveSpec：legacy 任务的数值是 HP / 传统排序值，不是 objective。
    const hp = bestKnown.hero && bestKnown.hero.hp != null ? bestKnown.hero.hp : "—";
    objectiveText = `Legacy · HP ${esc(hp)}`;
  } else if (bestKnown.objectiveValueExact) {
    objectiveText = esc(JSON.stringify(bestKnown.objectiveValue));
  } else {
    objectiveText = '<span class="state-warn">暂不可精确计算</span>';
  }
  return [
    `<span class="badge ${esc(bestKnown.kind)}">${esc(label)}</span>`,
    `<div class="small muted">decisionDepth=${esc(bestKnown.decisionDepth ?? "—")} · routeLength=${routeLen}</div>`,
    `<div class="small muted">${objectiveText}${bestKnown.verified ? ' · <span class="state-ok">verified</span>' : ""}</div>`,
  ].join("");
}

const FAILURE_RECOMMENDATIONS = {
  "RUNTIME_BUDGET_EXHAUSTED": "可增加运行时间后重试",
  "EXPANSION_BUDGET_EXHAUSTED": "可增加扩展预算后重试",
  "ACTION_TRIMMED": "可扩大动作候选后重试",
  "GOAL_NOT_REACHED": "可调整搜索范围后重试",
};

function failureHtml(failure) {
  if (!failure) return "";
  const label = FAILURE_LABELS[failure.failureClass] || failure.failureClass || "未知";
  const recommendation = failure.retryable ? (FAILURE_RECOMMENDATIONS[failure.failureClass] || "可重试") : "";
  const recommendationText = recommendation ? ` · ${esc(recommendation)}` : "";
  return `<div class="failure ${esc(failure.failureClass)}"><span class="state-warn">${esc(label)}</span><span class="muted small">${recommendationText}</span><div class="small muted">${esc(failure.message || "")}</div></div>`;
}

async function restoreTowerAndRegion(task) {
  if (!task || !task.tower) return;
  const towerSelect = $("tower-select");
  if (task.tower.id && towerSelect.value !== task.tower.id) {
    // Programmatic select changes never fire the change handler; call
    // loadRegions so state.tower / towerFingerprint / region options are
    // actually re-synced for the restored tower.
    towerSelect.value = task.tower.id;
    await loadRegions();
  }
  // v2: restore the ordered region sequence exactly (order + content).
  if (Array.isArray(task.tower.regions) && task.tower.regions.length >= 1) {
    state.regionOrder = task.tower.regions.map((entry) =>
      JSON.parse(JSON.stringify(entry && entry.spec ? entry.spec : entry)),
    );
    renderRegionOrder();
    if (state.regionOrder[0]) {
      state.regionSpec = state.regionOrder[0];
      const firstOption = Array.from($("region-select").options || []).find((o) =>
        state.regionOrder[0].id && String(state.regionOrder[0].id).endsWith(o.value));
      if (firstOption) $("region-select").value = firstOption.value;
    }
    return;
  }
  const spec = task.tower.region && task.tower.region.spec;
  if (spec) {
    // A v1 restore must never leave a stale ordered region list behind: the
    // next submit would otherwise still emit a v2 task from the old order.
    state.regionOrder = [];
    renderRegionOrder();
    // Keep the job's own exact RegionSpec (not the registry's current copy).
    state.regionSpec = JSON.parse(JSON.stringify(spec));
    // The region select values are file stems (e.g. "region-1") while the spec
    // id is prefixed ("onlyup-region-1"); match by suffix.
    const regionOption = Array.from($("region-select").options || []).find((o) => spec.id && String(spec.id).endsWith(o.value));
    if (regionOption) $("region-select").value = regionOption.value;
  }
}

// The normalized task carries the user-submitted SolverModel separately from
// region.spec.model; restore task.model so the Builder reproduces the exact
// model fingerprint that actually ran.
function restoreModel(model) {
  MODEL_FIELDS.forEach(([field, fallback]) => {
    const input = $(`model-${field}`);
    if (input) input.value = (model && model.heroFields && model.heroFields[field]) || fallback;
  });
}

function restoreObjective(objective) {
  const mode = objective && objective.mode ? objective.mode : "clear";
  $("objective-mode").value = mode;
  if (objective) {
    if (objective.field) $("objective-field").value = objective.field;
    if (objective.terms) $("score-terms").value = JSON.stringify(objective.terms, null, 2);
    if (objective.objectives) $("lex-items").value = JSON.stringify(objective.objectives, null, 2);
  }
  updateObjectiveVisibility();
}

async function loadTaskIntoBuilder(task) {
  if (!task) return;
  await restoreTowerAndRegion(task);
  restoreModel(task.model);
  if (task.search) {
    const search = task.search;
    $("s-max-expansions").value = search.maxExpansions ?? "";
    $("s-max-runtime").value = search.maxRuntimeMs ?? "";
    $("s-max-actions").value = search.maxActionsPerState ?? "";
    $("s-candidate-limit").value = search.candidateLimit ?? "";
    $("s-region-candidate-limit").value = search.regionCandidateLimit ?? search.candidateLimit ?? "";
    $("s-goal-skyline").value = search.goalSkylineLimit ?? "";
    $("s-dp-skyline").value = search.dpSkylineMax ?? "";
    $("s-stop-first").checked = Boolean(search.stopOnFirstGoal);
  }
  if (task.tower && task.tower.rank) $("rank-input").value = task.tower.rank;
  restoreObjective(task.objective || null);
  // verification.strictReplay must be restored too (default true).
  $("strict-replay").checked = !task.verification || task.verification.strictReplay !== false;
}

function budgetMaxRuntimeMs(job, progress) {
  const fromBudget = progress.budget && progress.budget.maxRuntimeMs;
  if (fromBudget != null) return fromBudget;
  const fromTask = job.search && job.search.maxRuntimeMs;
  return fromTask != null ? fromTask : 0;
}

function retryActions(job, failureClass, maxRuntimeMs) {
  const buttons = [];
  if (["completed", "failed", "cancelled"].includes(job.state)) {
    buttons.push(`<button class="retry-btn" data-job="${esc(job.id)}" data-scale="1">按原配置重试</button>`);
    if (job.state === "failed") {
      // 按 failureClass 精确生成预算型 Retry，不把非预算失败包装成可加预算。
      if (failureClass === "RUNTIME_BUDGET_EXHAUSTED" && Number(maxRuntimeMs) > 0) {
        buttons.push(`<button class="retry-btn" data-job="${esc(job.id)}" data-scale="time2">运行时间 ×2</button>`);
      } else if (failureClass === "EXPANSION_BUDGET_EXHAUSTED") {
        buttons.push(`<button class="retry-btn" data-job="${esc(job.id)}" data-scale="exp2">扩展预算 ×2</button>`);
      } else if (failureClass === "ACTION_TRIMMED") {
        buttons.push(`<button class="retry-btn" data-job="${esc(job.id)}" data-scale="actions2">动作候选 ×2</button>`);
      }
    }
  }
  if (["queued", "running"].includes(job.state)) {
    buttons.push(`<button class="cancel-btn danger" data-job="${esc(job.id)}">Cancel</button>`);
  } else {
    // Any terminal job (completed or failed) can be restored into the Builder.
    buttons.push(`<button class="config-btn" data-job="${esc(job.id)}">打开配置</button>`);
  }
  return buttons.join(" ");
}

async function loadTowers() {
  const { payload } = await api("GET", "/api/towers");
  const select = $("tower-select");
  select.innerHTML = "";
  (payload.towers || []).forEach((tower) => {
    const option = document.createElement("option");
    option.value = tower.id;
    option.textContent = `${tower.label} (${tower.regionCount} 区域)`;
    select.appendChild(option);
  });
  if (select.options.length > 0) {
    select.value = select.options[0].value;
    await loadRegions();
  }
}

async function loadRegions() {
  const towerId = $("tower-select").value;
  const { payload } = await api("GET", `/api/towers/${encodeURIComponent(towerId)}`);
  state.tower = payload.tower;
  state.towerFingerprint = payload.tower.projectFingerprint;
  $("tower-meta").textContent = `projectRoot=${payload.tower.projectRoot}\nfingerprint=${payload.tower.projectFingerprint || "—"}`;
  // A tower switch must never carry the previous tower's ordered region list
  // into a new tower (that would build a mixed Tower A regions + Tower B task).
  state.regionOrder = [];
  renderRegionOrder();
  const { payload: regionPayload } = await api("GET", `/api/towers/${encodeURIComponent(towerId)}/regions`);
  const select = $("region-select");
  select.innerHTML = "";
  (regionPayload.regions || []).forEach((region) => {
    const option = document.createElement("option");
    option.value = region.id;
    option.textContent = region.label;
    select.appendChild(option);
  });
  if (select.options.length > 0) {
    select.value = select.options[0].value;
    await loadRegion();
  }
}

function renderRegionOrder() {
  const list = $("region-order-list");
  if (!list) return;
  list.innerHTML = state.regionOrder.length === 0
    ? `<div class="muted small">（空：使用 v1 单区构建）</div>`
    : state.regionOrder.map((spec, index) => {
      const label = (spec && spec.label) || (spec && spec.id) || `region-${index}`;
      return `<div class="region-order-item" data-index="${index}">
        <span class="region-order-index">${index + 1}</span>
        <span class="region-order-label">${esc(label)}</span>
        <button type="button" class="region-move-up" data-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="region-move-down" data-index="${index}" ${index === state.regionOrder.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="region-remove" data-index="${index}">✕</button>
      </div>`;
    }).join("");
  list.querySelectorAll(".region-move-up").forEach((button) => {
    button.addEventListener("click", () => moveRegionOrder(Number(button.dataset.index), -1));
  });
  list.querySelectorAll(".region-move-down").forEach((button) => {
    button.addEventListener("click", () => moveRegionOrder(Number(button.dataset.index), 1));
  });
  list.querySelectorAll(".region-remove").forEach((button) => {
    button.addEventListener("click", () => {
      state.regionOrder.splice(Number(button.dataset.index), 1);
      renderRegionOrder();
    });
  });
}

function moveRegionOrder(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= state.regionOrder.length) return;
  const [item] = state.regionOrder.splice(index, 1);
  state.regionOrder.splice(target, 0, item);
  renderRegionOrder();
}

function addCurrentRegionToOrder() {
  if (!state.regionSpec) return;
  state.regionOrder.push(JSON.parse(JSON.stringify(state.regionSpec)));
  renderRegionOrder();
}

async function loadRegion() {
  const towerId = $("tower-select").value;
  const regionId = $("region-select").value;
  const { payload } = await api("GET", `/api/towers/${encodeURIComponent(towerId)}/regions/${encodeURIComponent(regionId)}`);
  if (!payload || !payload.region) return;
  const spec = payload.region.spec;
  state.regionSpec = spec;
  $("rank-input").value = spec.rank || "chaos";
  if (spec.model && spec.model.heroFields) {
    MODEL_FIELDS.forEach(([field]) => {
      const input = $(`model-${field}`);
      if (input && spec.model.heroFields[field]) input.value = spec.model.heroFields[field];
    });
  }
  const objective = spec.objective;
  if (objective && objective.mode) {
    $("objective-mode").value = objective.mode;
    updateObjectiveVisibility();
  }
  renderModelTable();
}

function renderModelTable() {
  const tbody = $("model-table").querySelector("tbody");
  // Collect existing values BEFORE clearing the tbody so RegionSpec-prefilled
  // SolverModel fields survive re-renders.
  const existingValues = {};
  MODEL_FIELDS.forEach(([field]) => {
    const input = $(`model-${field}`);
    if (input) existingValues[field] = input.value;
  });
  tbody.innerHTML = "";
  MODEL_FIELDS.forEach(([field, mode]) => {
    const selected = existingValues[field] || mode;
    const row = document.createElement("tr");
    row.innerHTML = `<td>${esc(field)}</td><td><select id="model-${esc(field)}">${MODEL_MODES.map((m) => `<option value="${m}" ${m === selected ? "selected" : ""}>${m}</option>`).join("")}</select></td>`;
    tbody.appendChild(row);
  });
}

function updateObjectiveVisibility() {
  const mode = $("objective-mode").value;
  $("objective-field-wrap").style.display = mode === "maximize" ? "block" : "none";
  $("score-terms-wrap").style.display = mode === "maximize-score" ? "block" : "none";
  $("lex-items-wrap").style.display = mode === "lexicographic" ? "block" : "none";
  let json = "";
  if (mode === "max-final-hp") json = '{"mode":"max-final-hp"}';
  else if (mode === "maximize") json = JSON.stringify({ mode: "maximize", field: $("objective-field").value || "hero.atk" }, null, 2);
  else if (mode === "maximize-score") json = JSON.stringify({ mode: "maximize-score", terms: safeJson($("score-terms").value, []) }, null, 2);
  else if (mode === "lexicographic") json = JSON.stringify({ mode: "lexicographic", objectives: safeJson($("lex-items").value, []) }, null, 2);
  else json = "";
  $("objective-json").value = json;
}

function safeJson(text, fallback) {
  try {
    const parsed = JSON.parse(text || "");
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function buildTask() {
  const heroFields = {};
  MODEL_FIELDS.forEach(([field]) => {
    heroFields[field] = $(`model-${field}`).value;
  });
  const mode = $("objective-mode").value;
  let objective = null;
  if (mode === "max-final-hp") objective = { mode: "max-final-hp" };
  else if (mode === "maximize") objective = { mode: "maximize", field: $("objective-field").value || "hero.atk" };
  else if (mode === "maximize-score") objective = { mode: "maximize-score", terms: safeJson($("score-terms").value, []) };
  else if (mode === "lexicographic") objective = { mode: "lexicographic", objectives: safeJson($("lex-items").value, []) };
  const task = {
    schema: state.regionOrder.length >= 1 ? "motapathfinder.solve-task.v2" : "motapathfinder.solve-task.v1",
    tower: {
      id: state.tower ? state.tower.id : "unknown",
      projectRoot: state.tower ? state.tower.projectRoot : null,
      projectFingerprint: state.towerFingerprint || undefined,
      rank: $("rank-input").value || "chaos",
    },
    model: { heroFields },
    objective,
    search: {
      algorithm: "segment-dp",
      maxExpansions: Number($("s-max-expansions").value) || 50000,
      maxRuntimeMs: Number($("s-max-runtime").value) || 0,
      maxActionsPerState: Number($("s-max-actions").value) || 256,
      candidateLimit: Number($("s-candidate-limit").value) || 8,
      regionCandidateLimit: Number($("s-region-candidate-limit").value) || Number($("s-candidate-limit").value) || 8,
      goalSkylineLimit: Number($("s-goal-skyline").value) || 8,
      dpSkylineMax: Number($("s-dp-skyline").value) || 1,
      stopOnFirstGoal: $("s-stop-first").checked,
    },
    verification: { strictReplay: $("strict-replay").checked },
  };
  if (state.regionOrder.length >= 1) {
    task.tower.regions = state.regionOrder.map((spec) => ({ spec: JSON.parse(JSON.stringify(spec)) }));
  } else {
    task.tower.region = { spec: state.regionSpec || {} };
  }
  return task;
}

async function validateTask() {
  let task;
  try {
    task = buildTask();
  } catch (error) {
    $("preflight-result").innerHTML = `<div class="state-err">构建任务失败：${esc(error.message)}</div>`;
    return;
  }
  state.lastTask = task;
  $("normalized-task").textContent = JSON.stringify(task, null, 2);
  const { status, payload } = await api("POST", "/api/tasks/validate", task);
  if (status === 200 && payload.valid) {
    const identity = payload.identity;
    const segmentText = (segment) => {
      const per = segment.perAttempt || segment;
      const runtime = per.maxRuntimeMs > 0 ? `${per.maxRuntimeMs}ms` : "不限";
      const caps = segment.attemptCaps || {};
      const capText = [
        caps.initial == null ? "初始=随 frontier" : `初始 ≤${caps.initial}`,
        caps.configuredRepair != null ? `修复 ≤${caps.configuredRepair}` : "修复=随 frontier",
        `回溯重试 ≤${caps.backtrackRetry ?? "?"}`,
      ].join(" · ");
      return `<div>${esc(segment.segmentId)}：每次 attempt exp≤${esc(per.maxExpansions)} · runtime=${runtime} · ${capText}</div>`;
    };
    const segments = Array.isArray(payload.effectiveSegments) && payload.effectiveSegments.length > 0
      && payload.effectiveSegments[0] && Array.isArray(payload.effectiveSegments[0].effectiveSegments)
      ? payload.effectiveSegments.map((regionEntry) =>
        `<div class="region-group"><strong>Region ${esc(regionEntry.regionId)}</strong>${regionEntry.effectiveSegments.map(segmentText).join("")}</div>`,
      ).join("")
      : payload.effectiveSegments.map(segmentText).join("");
    $("preflight-result").innerHTML = [
      `<div class="state-ok">preflight 通过</div>`,
      `<div class="small">task fingerprint: <code>${esc(identity.taskFingerprint)}</code></div>`,
      `<div class="small">model fingerprint: <code>${esc(identity.solverModelFingerprint || "—")}</code></div>`,
      `<div class="small">objective fingerprint: <code>${esc(identity.objectiveFingerprint || "—（legacy）")}</code></div>`,
      `<div class="small">objective: explicit=${payload.objective.explicit} searchPreserving=${payload.objective.searchPreserving} terminalOnly=${payload.objective.terminalOnly}</div>`,
      segments ? `<div class="small">每次 attempt 上限（预算作用于每个候选 attempt，非整个 segment 总量）：</div>${segments}` : "",
    ].join("");
  } else {
    const failure = (payload && payload.failure) || {};
    $("preflight-result").innerHTML = `<div class="state-err">preflight 失败：${esc(failure.message || JSON.stringify(payload))}</div>`;
  }
}

async function submitJob() {
  let task;
  try {
    task = buildTask();
  } catch (error) {
    alert(`构建任务失败：${error.message}`);
    return;
  }
  state.lastTask = task;
  const { status, payload } = await api("POST", "/api/jobs", task);
  if (status === 202 && payload.job) {
    await refreshJobs();
    if (state.eventSource) state.eventSource.close();
    renderJobDetail(payload.job.id);
  } else {
    const failure = (payload && payload.failure) || {};
    alert(`提交失败：${failure.message || JSON.stringify(payload)}`);
  }
}

async function refreshJobs() {
  const { payload } = await api("GET", "/api/jobs");
  state.jobs = (payload.jobs || []);
  renderJobs();
}

function renderJobs() {
  const filter = document.querySelector(".filter-btn.active");
  const filterName = filter ? filter.dataset.filter : "all";
  const list = $("job-table");
  list.innerHTML = "";
  const visible = state.jobs
    .filter((job) => {
      if (filterName === "all") return true;
      if (filterName === "active") return ["queued", "running", "interrupted"].includes(job.state);
      if (filterName === "failed") return job.state === "failed" || (job.failure && RETRYABLE_FAILURES.includes(job.failure.failureClass));
      return job.state === filterName;
    })
    .slice(0, 40);
  if (visible.length === 0) {
    list.innerHTML = '<div class="muted small">暂无任务</div>';
    return;
  }
  visible.forEach((job) => {
    const progress = job.lastProgress || {};
    const bestKnown = progress.bestKnown || job.bestKnown || null;
    const failureClass = (job.failure && job.failure.failureClass) || (progress.failure && progress.failure.failureClass);
    const row = document.createElement("div");
    row.className = "job-row";
    row.innerHTML = [
      `<div class="job-row-head"><a href="#" data-job="${esc(job.id)}" class="job-link">${esc(job.id)}</a>${stateBadge(job.state, failureClass)}</div>`,
      `<div class="small muted">${esc(progress.phase || job.phase || "—")} · ${formatTime(job.createdAt)}</div>`,
      `<div class="small">${bestKnownHtml(bestKnown)}</div>`,
      failureClass ? failureHtml(job.failure || progress.failure) : "",
      `<div class="job-actions">${retryActions(job, failureClass, budgetMaxRuntimeMs(job, progress))}</div>`,
    ].join("");
    list.appendChild(row);
  });
  list.querySelectorAll("a[data-job]").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      if (state.eventSource) state.eventSource.close();
      renderJobDetail(anchor.dataset.job);
    });
  });
  list.querySelectorAll(".cancel-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("POST", `/api/jobs/${encodeURIComponent(button.dataset.job)}/cancel`);
      await refreshJobs();
    });
  });
  list.querySelectorAll(".config-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const detail = await api("GET", `/api/jobs/${encodeURIComponent(button.dataset.job)}`);
      const task = detail.payload && detail.payload.task;
      if (task) await loadTaskIntoBuilder(task);
      document.querySelector(".col-center").scrollIntoView({ behavior: "smooth" });
    });
  });
  list.querySelectorAll(".retry-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      // Retry re-submits the original job task with the scaled budget, so the
      // new SolveTask genuinely inherits the failed job config.
      const detail = await api("GET", `/api/jobs/${encodeURIComponent(button.dataset.job)}`);
      const task = detail.payload && detail.payload.task ? JSON.parse(JSON.stringify(detail.payload.task)) : null;
      if (!task || !task.search) {
        alert("无法读取原任务配置");
        return;
      }
      const scale = button.dataset.scale;
      if (scale === "exp2") task.search = { ...task.search, maxExpansions: (Number(task.search.maxExpansions) || 0) * 2 };
      if (scale === "time2") task.search = { ...task.search, maxRuntimeMs: (Number(task.search.maxRuntimeMs) || 0) * 2 };
      if (scale === "actions2") task.search = { ...task.search, maxActionsPerState: (Number(task.search.maxActionsPerState) || 0) * 2 };
      const { status, payload } = await api("POST", "/api/jobs", task);
      if (status === 202 && payload.job) {
        await refreshJobs();
        if (state.eventSource) state.eventSource.close();
        renderJobDetail(payload.job.id);
      }
    });
  });
}

function metric(k, v) {
  return `<div class="metric"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
}

async function renderJobDetail(jobId) {
  state.activeJob = jobId;
  const { payload } = await api("GET", `/api/jobs/${encodeURIComponent(jobId)}`);
  const job = payload.job;
  $("current-job-title").textContent = `当前 Job ${job.id}`;
  $("job-detail").innerHTML = `<div class="metrics" id="job-metrics"></div><div id="job-best" class="small"></div><div id="job-result"></div>`;
  const renderMetrics = (progress) => {
    const search = progress.search || {};
    const budget = progress.budget || {};
    const bestKnown = progress.bestKnown || null;
    const failureClass = (job.failure && job.failure.failureClass) || progress.failureClass;
    const metrics = [
      metric("state", stateBadge(job.state, failureClass)),
      metric("phase", esc(progress.phase || "—")),
      metric("segment", progress.segment ? `${esc(progress.segment.id)} ${progress.segment.attempt}/${progress.segment.total}` : "—"),
      metric("expansions", search.expansions ?? "—"),
      metric("generated", search.generated ?? "—"),
      metric("accepted", search.accepted ?? "—"),
      metric("goalCandidates", search.goalCandidates ?? "—"),
      metric("actionTrimmed", search.actionTrimmed ?? "—"),
      metric("decisionDepth", bestKnown && bestKnown.decisionDepth != null ? String(bestKnown.decisionDepth) : "—"),
      metric("routeLength", bestKnown && bestKnown.routeLengthExact ? String(bestKnown.routeLength) : '<span class="state-warn">待路线重建</span>'),
      metric("expansion 预算消耗（当前 attempt）", budget.current && budget.maxExpansions > 0 ? `${((budget.current.expansionBudgetUsedRatio || 0) * 100).toFixed(1)}%` : "—"),
      metric("runtime 预算消耗（当前 attempt）", budget.current && budget.maxRuntimeMs > 0 ? `${((budget.current.runtimeBudgetUsedRatio || 0) * 100).toFixed(1)}%` : "—"),
      metric("累计 expansions", (budget.total && budget.total.expansions) ?? "—"),
      metric("累计 elapsedMs", (budget.total && budget.total.elapsedMs) != null ? `${budget.total.elapsedMs}ms` : "—"),
      metric("proof claim", esc((progress.proof && progress.proof.claim) || "—")),
    ];
    $("job-metrics").innerHTML = metrics.join("");
    $("job-best").innerHTML = bestKnown ? bestKnownHtml(bestKnown) : '<span class="muted">尚无 bestKnown</span>';
  };
  renderMetrics(job.lastProgress || {});
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
  state.eventSource.addEventListener("progress", (event) => {
    renderMetrics(JSON.parse(event.data));
  });
  state.eventSource.addEventListener("terminal", (event) => {
    renderMetrics(JSON.parse(event.data));
    state.eventSource.close();
    refreshJobs();
    loadResult(jobId);
  });
  state.eventSource.onerror = () => { /* EventSource 自动重连 */ };
  loadResult(jobId);
}

async function loadResult(jobId) {
  const { payload } = await api("GET", `/api/jobs/${encodeURIComponent(jobId)}/result`);
  const result = payload.result;
  if (!result) {
    $("job-result").innerHTML = '<div class="muted small">尚无 result</div>';
    return;
  }
  const failure = result.failure;
  const route = result.route;
  const objectiveText = result.objective == null
    ? "无显式 ObjectiveSpec（legacy）"
    : esc(JSON.stringify(result.objective.value));
  const html = [
    `<h3>Result（${esc(result.status)}）</h3>`,
    `<div class="small muted">found=${result.found} · objective=${objectiveText}</div>`,
    failure ? failureHtml(failure) : "",
    route ? [
      `<div class="small">verificationStatus=${esc(route.verificationStatus)} · strictReplayVerified=${route.strictReplayVerified}</div>`,
      `<div class="small">decisionDepth=${esc(route.record.stats && route.record.stats.depth)} · routeLength=${esc(route.record.stats && route.record.stats.routeLength)}</div>`,
      `<div class="small">route fingerprint=${esc(route.fingerprint && route.fingerprint.sha256)}</div>`,
      `<a href="/api/jobs/${encodeURIComponent(jobId)}/route" download>导出 route artifact</a>`,
    ].join("") : '<div class="muted small">无 route artifact</div>',
  ].join("");
  $("job-result").innerHTML = html;
}

function initFilters() {
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      renderJobs();
    });
  });
}

async function poll() {
  await refreshHealth();
  await refreshJobs();
  setTimeout(poll, 3000);
}

window.addEventListener("DOMContentLoaded", async () => {
  renderModelTable();
  $("objective-mode").addEventListener("change", updateObjectiveVisibility);
  $("objective-field").addEventListener("change", updateObjectiveVisibility);
  $("tower-select").addEventListener("change", loadRegions);
  $("region-select").addEventListener("change", loadRegion);
  $("region-add-btn").addEventListener("click", addCurrentRegionToOrder);
  renderRegionOrder();
  $("validate-btn").addEventListener("click", validateTask);
  $("submit-btn").addEventListener("click", submitJob);
  initFilters();
  updateObjectiveVisibility();
  await loadTowers();
  await poll();
});