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

const state = {
  tower: null,
  region: null,
  towerFingerprint: null,
  regionSpec: null,
  jobs: [],
  activeJob: null,
  eventSource: null,
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
  $("health").textContent = payload && payload.status === "ok"
    ? `ok · live=${payload.liveJobs} queued=${payload.queuedJobs}`
    : "unreachable";
}

async function loadTowers() {
  const { payload } = await api("GET", "/api/towers");
  const select = $("tower-select");
  select.innerHTML = "";
  (payload.towers || []).forEach((tower) => {
    const option = document.createElement("option");
    option.value = tower.id;
    option.textContent = `${tower.label} (${tower.regionCount} regions)`;
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

async function loadRegion() {
  const towerId = $("tower-select").value;
  const regionId = $("region-select").value;
  const { payload } = await api("GET", `/api/towers/${encodeURIComponent(towerId)}/regions/${encodeURIComponent(regionId)}`);
  if (!payload || !payload.region) return;
  state.region = payload.region;
  const spec = payload.region.spec;
  $("rank-input").value = spec.rank || "chaos";
  renderModelTable();
  if (spec.model && spec.model.heroFields) {
    MODEL_FIELDS.forEach(([field]) => {
      const input = $(`model-${field}`);
      if (input && spec.model.heroFields[field]) input.value = spec.model.heroFields[field];
    });
  }
  const objective = spec.objective;
  if (objective) {
    $("objective-mode").value = objective.mode || "clear";
    if (objective.field) $("objective-field").value = objective.field;
    if (objective.terms) $("score-terms").value = JSON.stringify(objective.terms, null, 2);
    if (objective.objectives) $("lex-items").value = JSON.stringify(objective.objectives, null, 2);
    updateObjectiveVisibility();
  }
}

function renderModelTable() {
  const tbody = $("model-table").querySelector("tbody");
  tbody.innerHTML = "";
  MODEL_FIELDS.forEach(([field, mode]) => {
    const existing = $(`model-${field}`) ? $(`model-${field}`).value : null;
    const selected = existing || mode;
    const row = document.createElement("tr");
    row.innerHTML = `<td>${esc(field)}</td><td><select id="model-${esc(field)}">${MODEL_MODES.map((m) => `<option value="${m}" ${m === selected ? "selected" : ""}>${m}</option>`).join("")}</select></td>`;
    tbody.appendChild(row);
  });
}

function updateObjectiveVisibility() {
  const mode = $("objective-mode").value;
  $("objective-field-wrap").style.display = mode === "maximize" ? "flex" : "none";
  $("score-terms-wrap").style.display = mode === "maximize-score" ? "block" : "none";
  $("lex-items-wrap").style.display = mode === "lexicographic" ? "block" : "none";
}

function buildTask() {
  const heroFields = {};
  MODEL_FIELDS.forEach(([field]) => {
    heroFields[field] = $(`model-${field}`).value;
  });
  const objectiveMode = $("objective-mode").value;
  let objective = null;
  if (objectiveMode === "max-final-hp") {
    objective = { mode: "max-final-hp" };
  } else if (objectiveMode === "maximize") {
    objective = { mode: "maximize", field: $("objective-field").value || "hero.atk" };
  } else if (objectiveMode === "maximize-score") {
    objective = { mode: "maximize-score", terms: JSON.parse($("score-terms").value || "[]") };
  } else if (objectiveMode === "lexicographic") {
    objective = { mode: "lexicographic", objectives: JSON.parse($("lex-items").value || "[]") };
  }
  return {
    schema: "motapathfinder.solve-task.v1",
    tower: {
      id: state.tower ? state.tower.id : "unknown",
      projectRoot: state.tower ? state.tower.projectRoot : null,
      projectFingerprint: state.towerFingerprint || undefined,
      rank: $("rank-input").value || "chaos",
      region: { spec: state.region ? state.region.spec : {} },
    },
    model: { heroFields },
    objective,
    search: {
      algorithm: "segment-dp",
      maxExpansions: Number($("s-max-expansions").value) || 50000,
      maxRuntimeMs: Number($("s-max-runtime").value) || 0,
      maxActionsPerState: Number($("s-max-actions").value) || 256,
      candidateLimit: Number($("s-candidate-limit").value) || 8,
      goalSkylineLimit: Number($("s-goal-skyline").value) || 8,
      dpSkylineMax: Number($("s-dp-skyline").value) || 1,
      stopOnFirstGoal: $("s-stop-first").checked,
    },
    verification: { strictReplay: $("strict-replay").checked },
  };
}

async function validateTask() {
  let task;
  try {
    task = buildTask();
  } catch (error) {
    $("preflight-result").innerHTML = `<div class="state-err">构建任务失败：${esc(error.message)}</div>`;
    return;
  }
  const { status, payload } = await api("POST", "/api/tasks/validate", task);
  $("normalized-task").textContent = JSON.stringify(task, null, 2);
  if (status === 200 && payload.valid) {
    const identity = payload.identity;
    $("preflight-result").innerHTML = [
      `<div class="state-ok">preflight 通过</div>`,
      `<div>task fingerprint: <code>${esc(identity.taskFingerprint)}</code></div>`,
      `<div>tower fingerprint: <code>${esc(identity.towerFingerprint || "—")}</code></div>`,
      `<div>model fingerprint: <code>${esc(identity.solverModelFingerprint || "—")}</code></div>`,
      `<div>objective fingerprint: <code>${esc(identity.objectiveFingerprint || "—")}</code></div>`,
      `<div>objective: explicit=${payload.objective.explicit} searchPreserving=${payload.objective.searchPreserving} terminalOnly=${payload.objective.terminalOnly}</div>`,
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

function bestKnownHtml(bestKnown) {
  if (!bestKnown) return '<span class="muted">—</span>';
  const label = BEST_KNOWN_LABELS[bestKnown.kind] || bestKnown.kind;
  const routeLen = bestKnown.routeLengthExact
    ? esc(bestKnown.routeLength)
    : '<span class="state-warn">待路线重建</span>';
  const objective = bestKnown.objectiveValueExact
    ? esc(JSON.stringify(bestKnown.objectiveValue))
    : '<span class="state-warn">暂不可精确计算</span>';
  return [
    `<span class="badge ${esc(bestKnown.kind)}">${esc(label)}</span>`,
    `<div class="small muted">decisionDepth=${esc(bestKnown.decisionDepth ?? "—")} · routeLength=${routeLen}</div>`,
    `<div class="small muted">objective=${objective}${bestKnown.verified ? ' · <span class="state-ok">verified</span>' : ""}</div>`,
  ].join("");
}

async function refreshJobs() {
  const { payload } = await api("GET", "/api/jobs");
  state.jobs = (payload.jobs || []);
  renderJobs();
}

function renderJobs() {
  const filter = document.querySelector(".filter-btn.active");
  const filterName = filter ? filter.dataset.filter : "all";
  const tbody = $("job-table").querySelector("tbody");
  tbody.innerHTML = "";
  state.jobs
    .filter((job) => {
      if (filterName === "all") return true;
      if (filterName === "active") return ["queued", "running", "interrupted"].includes(job.state);
      return job.state === filterName;
    })
    .forEach((job) => {
      const row = document.createElement("tr");
      const progress = job.lastProgress || {};
      const bestKnown = progress.bestKnown || job.bestKnown || null;
      row.innerHTML = [
        `<td><a href="#" data-job="${esc(job.id)}">${esc(job.id)}</a></td>`,
        `<td><span class="badge ${esc(job.state)}">${esc(job.state)}</span></td>`,
        `<td>${esc(progress.phase || job.phase || "—")}</td>`,
        `<td>${formatTime(job.createdAt)}</td>`,
        `<td class="small">${esc(job.objectiveSummary || "—")}</td>`,
        `<td>${job.strictReplay == null ? "—" : (job.strictReplay ? "true" : "false")}</td>`,
        `<td class="small">${bestKnownHtml(bestKnown)}</td>`,
        `<td><button class="cancel-btn danger" data-job="${esc(job.id)}" ${["completed", "failed", "cancelled"].includes(job.state) ? "disabled" : ""}>Cancel</button></td>`,
      ].join("");
      tbody.appendChild(row);
    });
  tbody.querySelectorAll("a[data-job]").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      if (state.eventSource) state.eventSource.close();
      renderJobDetail(anchor.dataset.job);
    });
  });
  tbody.querySelectorAll(".cancel-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("POST", `/api/jobs/${encodeURIComponent(button.dataset.job)}/cancel`);
      await refreshJobs();
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
  $("job-detail").innerHTML = `<fieldset><legend>Job ${esc(job.id)}</legend><div class="metrics" id="job-metrics"></div><div id="job-best" class="small"></div><div id="job-result"></div></fieldset>`;
  const detail = $("job-detail");
  const renderMetrics = (progress) => {
    const search = progress.search || {};
    const budget = progress.budget || {};
    const bestKnown = progress.bestKnown || null;
    const metrics = [
      metric("state", `<span class="badge ${esc(job.state)}">${esc(job.state)}</span>`),
      metric("phase", esc(progress.phase || "—")),
      metric("segment", progress.segment ? `${esc(progress.segment.id)} ${progress.segment.attempt}/${progress.segment.total}` : "—"),
      metric("expansions", search.expansions ?? "—"),
      metric("generated", search.generated ?? "—"),
      metric("accepted", search.accepted ?? "—"),
      metric("goalCandidates", search.goalCandidates ?? "—"),
      metric("actionTrimmed", search.actionTrimmed ?? "—"),
      metric("decisionDepth", bestKnown && bestKnown.decisionDepth != null ? String(bestKnown.decisionDepth) : "—"),
      metric("routeLength", bestKnown && bestKnown.routeLengthExact ? String(bestKnown.routeLength) : '<span class="state-warn">待路线重建</span>'),
      metric("expansion 预算消耗", budget.expansionBudgetUsedRatio == null ? "—" : `${(budget.expansionBudgetUsedRatio * 100).toFixed(1)}%`),
      metric("runtime 预算消耗", budget.runtimeBudgetUsedRatio == null ? "—" : `${(budget.runtimeBudgetUsedRatio * 100).toFixed(1)}%`),
      metric("proof claim", esc((progress.proof && progress.proof.claim) || "—")),
    ];
    $("job-metrics").innerHTML = metrics.join("");
    $("job-best").innerHTML = bestKnown ? bestKnownHtml(bestKnown) : '<span class="muted">尚无 bestKnown</span>';
  };
  renderMetrics(job.lastProgress || {});
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
  state.eventSource.addEventListener("progress", (event) => {
    const snapshot = JSON.parse(event.data);
    renderMetrics(snapshot);
  });
  state.eventSource.addEventListener("terminal", (event) => {
    const snapshot = JSON.parse(event.data);
    renderMetrics(snapshot);
    state.eventSource.close();
    refreshJobs();
    loadResult(jobId);
  });
  state.eventSource.onerror = () => { /* reconnect handled by EventSource */ };
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
  const html = [
    `<h3>Result (${esc(result.status)})</h3>`,
    `<div class="small muted">found=${result.found} · taskFingerprint=${esc(result.taskFingerprint)}</div>`,
    failure ? `<div class="state-err">failureClass=${esc(failure.failureClass)} · retryable=${failure.retryable} · ${esc(failure.message)}</div>` : "",
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
  $("tower-select").addEventListener("change", loadRegions);
  $("region-select").addEventListener("change", loadRegion);
  $("validate-btn").addEventListener("click", validateTask);
  $("submit-btn").addEventListener("click", submitJob);
  initFilters();
  updateObjectiveVisibility();
  await loadTowers();
  await poll();
});
