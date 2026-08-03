"use strict";

const state = {
  route: null,
  resume: null,
  selectedStep: 1,
  fromStepInput: 1,
  stepDetail: null,
  session: { state: "idle", stepStatuses: {} },
  polling: null,
  speedDelayMs: 1400,
  controlsRendered: false,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false)
    throw new Error(data.error || response.statusText);
  return data;
}

function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function loadRoute() {
  state.route = await fetchJson("/api/route");
  state.resume = state.route.resume || await fetchJson("/api/resume").catch(() => null);
  state.selectedStep = Math.min(1, state.route.decisionCount || 1);
  state.fromStepInput = state.selectedStep;
  await loadStep(state.selectedStep);
  renderAll();
}

async function loadStep(index) {
  const effectiveStep = Number(index) === 0 ? 1 : Number(index);
  if (!state.route || effectiveStep < 1 || effectiveStep > state.route.decisionCount) return;
  state.selectedStep = effectiveStep;
  state.stepDetail = await fetchJson(`/api/route/step/${effectiveStep}`);
  await postJson("/api/session/select-step", { step: effectiveStep }).catch(() => null);
  renderAll();
}

function renderTopbar() {
  const route = state.route;
  if (!route) return;
  const source = route.source || {};
  const finalHero = (route.final || {}).hero || {};
  const session = state.session || {};
  const displayed = session.display || session.runtime || {};
  const displayedHero = displayed.hero || {};
  const nextDecision = session.nextDecision || null;
  const runtimeIdentity = session.runtimeSnapshotIdentity || "-";
  const runtimeIdentityLabel = session.runtimeSnapshotIdentityMatches === true
    ? "✓"
    : session.runtimeSnapshotIdentityMatches === false
      ? "⚠"
      : "-";
  const baseline = route.baseline || null;
  const divergence =
    baseline && baseline.divergence ? baseline.divergence : null;
  const baselineLabel =
    divergence && !divergence.identical
      ? `<span class="badge error">⚠ 第 ${divergence.divergedAt} 步分叉</span>`
      : divergence && divergence.identical
        ? '<span class="badge ok">✓ 路线一致</span>'
        : "";
  $("topbar").innerHTML = `
    <strong>${escapeHtml(route.routeFile || "Route")}</strong>
    <span>Goal: ${escapeHtml((route.goal || {}).floorId || "-")}</span>
    <span>Solver: ${escapeHtml(source.solver || "-")} / ${escapeHtml(source.profile || "-")} / ${escapeHtml(source.rank || "-")}</span>
    <span>Steps: ${route.decisionCount}</span>
    <span>Final: ${escapeHtml((route.final || {}).floorId || "-")} hp=${escapeHtml(finalHero.hp)}</span>
    <span class="badge ${escapeHtml(session.state || "idle")}">${escapeHtml(session.state || "idle")}</span>
    <span>Current: ${escapeHtml(session.currentStep || 1)} / ${escapeHtml(session.totalSteps || route.decisionCount)}</span>
    <span>Displayed: ${escapeHtml(displayed.floorId || "-")} hp=${escapeHtml(displayedHero.hp == null ? "-" : displayedHero.hp)} atk=${escapeHtml(displayedHero.atk == null ? "-" : displayedHero.atk)}</span>
    <span>Runtime identity: ${runtimeIdentityLabel} ${escapeHtml(runtimeIdentity)}</span>
    <span>Next: ${nextDecision ? `#${escapeHtml(nextDecision.index)} ${escapeHtml(nextDecision.summary)}` : "-"}</span>
    ${session.browserUrl ? `<span class="muted">Runtime: ${escapeHtml(session.browserUrl)}</span>` : ""}
    ${baselineLabel}
  `;
}

function shortHash(value) {
  const text = String(value || "");
  return text.length > 24 ? `${text.slice(0, 16)}…${text.slice(-8)}` : text || "-";
}

function resumeDisplayText(display) {
  const value = display || {};
  const loc = value.x == null || value.y == null ? "-" : `${value.x},${value.y}`;
  return `${value.floorId || "-"} @ ${loc} ${value.direction || ""} hp=${value.hp == null ? "-" : value.hp} atk=${value.atk == null ? "-" : value.atk} def=${value.def == null ? "-" : value.def}`;
}

function renderResume() {
  const resume = state.resume;
  if (!resume || resume.status === "not-loaded") {
    $("resume-status").innerHTML = '<div class="muted">No resume artifact loaded.</div>';
    return;
  }
  const status = resume.status || "failed";
  const statusLabel = {
    verified: "✓ Verified",
    legacy: "⚠ Legacy / route unverified",
    failed: "✕ Resume failed",
  }[status] || status;
  const binding = resume.payloadBinding || {};
  const boundary = resume.boundary || {};
  const continuation = resume.continuation || {};
  const next = boundary.nextDecision || null;
  const failure = resume.failure || null;
  const bindingRows = [
    ["Native payload", binding.nativeSavePayloadBound, binding.nativeSavePayloadSha256],
    ["Structured suffix", binding.structuredSuffixBound, binding.structuredSuffixSha256],
    ["Encoded suffix", binding.encodedSuffixBound, binding.encodedSuffixSha256],
  ].map(([label, bound, hash]) => `
    <tr><td>${escapeHtml(label)}</td><td class="${bound ? "resume-ok" : "resume-failed"}">${bound ? "✓ bound" : "✕ missing"}</td><td><code>${escapeHtml(shortHash(hash))}</code></td></tr>
  `).join("");
  $("resume-status").innerHTML = `
    <div class="resume-card">
      <div class="resume-heading"><span class="badge resume-${escapeHtml(status)}">${escapeHtml(statusLabel)}</span><span class="muted">${escapeHtml(resume.h5saveFile || "")}</span></div>
      <div class="resume-meta"><span>Route verified: <strong>${resume.routeVerified ? "yes" : "no"}</strong></span><span>Project: <strong>${resume.projectFingerprintMatches === true ? "match" : resume.projectFingerprintMatches === false ? "mismatch" : "-"}</strong></span><span>Route: <strong>${resume.routeFingerprintMatches === true ? "match" : resume.routeFingerprintMatches === false ? "mismatch" : "-"}</strong></span></div>
    </div>
    <div class="resume-card">
      <h3>Boundary / Next</h3>
      <div class="resume-grid"><span>Completed</span><strong>${escapeHtml(boundary.executedStepCount == null ? "-" : boundary.executedStepCount)}</strong><span>Next step</span><strong>${escapeHtml(boundary.nextStep == null ? "-" : boundary.nextStep)}</strong><span>Runtime</span><strong>${escapeHtml(resumeDisplayText(boundary.runtimeDisplay))}</strong><span>Identity</span><strong class="${boundary.identityMatches ? "resume-ok" : "resume-failed"}">${boundary.identityMatches ? "✓ match" : "✕ mismatch"}</strong></div>
      <div class="resume-next"><span>Next decision:</span> ${next ? `<code>#${escapeHtml(next.index)} ${escapeHtml(next.summary || "")}</code>` : "-"}</div>
    </div>
    <div class="resume-card">
      <h3>Payload binding</h3>
      <table><thead><tr><th>Binding</th><th>Status</th><th>SHA-256</th></tr></thead><tbody>${bindingRows}</tbody></table>
      <div class="resume-meta"><span>All bindings verified: <strong class="${binding.verified ? "resume-ok" : "resume-failed"}">${binding.verified ? "yes" : "no"}</strong></span><span>Suffix decisions: <strong>${escapeHtml(continuation.suffixDecisionCount == null ? "-" : continuation.suffixDecisionCount)}</strong></span><span>Final: <strong>${escapeHtml(resumeDisplayText(continuation.runtimeDisplay))}</strong></span></div>
    </div>
    ${failure ? `<div class="resume-card resume-error"><h3>Recovery failure</h3><div><strong>${escapeHtml(failure.code || "UNKNOWN")}</strong></div><div>${escapeHtml(failure.message || "")}</div></div>` : ""}
  `;
}

function renderControls() {
  if (!state.controlsRendered) {
    $("controls").innerHTML = `
      <button id="btn-start">打开游戏进行回放</button>
      <button id="btn-play">Play</button>
      <button id="btn-pause">Pause</button>
      <button id="btn-step">Step</button>
      <button id="btn-restart">Restart</button>
      <button id="btn-jump">Jump to selected</button>
      <label>Speed <select id="speed">
        <option value="0">0x (fast)</option>
        <option value="2800">0.5x</option>
        <option value="1400">1x</option>
        <option value="700">2x</option>
      </select></label>
      <label>From Step <input id="from-step" type="number" min="0"></label>
    `;
    $("btn-start").onclick = startLive;
    $("btn-play").onclick = play;
    $("btn-pause").onclick = pause;
    $("btn-step").onclick = stepOnce;
    $("btn-restart").onclick = restart;
    $("btn-jump").onclick = jumpToSelected;
    $("speed").onchange = (event) => {
      state.speedDelayMs = Number(event.target.value);
    };
    $("from-step").onchange = (event) => {
      const requested = Number(event.target.value);
      state.fromStepInput = Number.isFinite(requested) ? requested : state.selectedStep;
      return loadStep(requested);
    };
    state.controlsRendered = true;
  }

  const session = state.session || { state: "idle" };
  const isRunning =
    session.state === "running" || session.state === "pausing" || session.busy;
  const isPaused = session.state === "paused";
  const canStart =
    ["idle", "closed", "failed"].includes(session.state || "idle") &&
    !session.busy;

  $("btn-start").disabled = !canStart;
  $("btn-play").disabled = !isPaused || !!session.busy;
  $("btn-pause").disabled = !isRunning;
  $("btn-step").disabled = !isPaused || !!session.busy;
  $("btn-restart").disabled = isRunning;
  $("btn-jump").disabled = isRunning;

  if (document.activeElement !== $("speed")) {
    $("speed").value = String(state.speedDelayMs);
  }
  $("from-step").max = String((state.route || {}).decisionCount || 1);
  if (document.activeElement !== $("from-step")) {
    $("from-step").value = String(state.fromStepInput == null ? state.selectedStep : state.fromStepInput);
  }
}

function rowStatus(index) {
  const statuses = (state.session || {}).stepStatuses || {};
  if (statuses[String(index)]) return statuses[String(index)];
  if (
    (state.session || {}).currentStep === index &&
    ["running", "pausing"].includes((state.session || {}).state)
  )
    return "running";
  return "pending";
}

function renderTimeline() {
  const route = state.route;
  if (!route) return;
  const baseline = route.baseline || null;
  const divergence =
    baseline && baseline.divergence ? baseline.divergence : null;
  const divergedAt =
    divergence && !divergence.identical ? divergence.divergedAt : -1;

  const rows = (route.decisions || [])
    .map((decision) => {
      const status = rowStatus(decision.index);
      const afterDivergence =
        divergedAt > 0 && decision.index >= divergedAt
          ? " after-divergence"
          : "";
      const selected = decision.index === state.selectedStep ? " selected" : "";
      const isDiverged = decision.index === divergedAt ? " diverged-row" : "";
      const item =
        decision.thingLabel ||
        decision.enemyId ||
        decision.itemId ||
        decision.tool ||
        decision.equipId ||
        decision.doorId ||
        "";
      return `<tr class="${selected}${afterDivergence}${isDiverged}" data-step="${decision.index}">
      <td><span class="status-dot ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
      <td>#${String(decision.index).padStart(3, "0")}</td>
      <td>${escapeHtml(decision.kind)}</td>
      <td>${escapeHtml(decision.floorId)}</td>
      <td>${escapeHtml(decision.targetLabel)}</td>
      <td title="${escapeHtml(decision.mapThing ? `map=${decision.mapThing.id || ""} ${decision.mapThing.name || ""}` : "")}">${decision.thingMismatch ? "⚠️ " : ""}${escapeHtml(item)}</td>
      <td>${escapeHtml(decision.damage == null ? "" : decision.damage)}</td>
      <td>${escapeHtml(decision.exp == null ? "" : decision.exp)}</td>
      <td>${escapeHtml(decision.hpDelta == null ? "" : decision.hpDelta)}</td>
      <td>${escapeHtml(decision.score == null ? "" : decision.score)}</td>
      <td class="summary-cell" title="${escapeHtml(decision.summary)}">${escapeHtml(decision.summary)}</td>
    </tr>`;
    })
    .join("");

  const baselineHtml =
    divergence && !divergence.identical
      ? `<div style="margin:4px 0;font-size:13px;" class="card"><span class="badge error">⚠ 第 ${divergence.divergedAt} 步与基线分叉</span> 基线选了 <code>${escapeHtml((divergence.baselineDecision || {}).summary || "?")}</code>，求解器选了 <code>${escapeHtml((divergence.solverDecision || {}).summary || "?")}</code></div>`
      : divergence && divergence.identical
        ? `<div style="margin:4px 0;font-size:13px;" class="card"><span class="badge ok">✓ 与基线路线完全一致</span></div>`
        : "";

  $("timeline").innerHTML =
    `${baselineHtml}<table><thead><tr><th>Status</th><th>#</th><th>Kind</th><th>Floor</th><th>Target</th><th>Thing</th><th>Dmg</th><th>Exp</th><th>HPΔ</th><th>Score</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table>`;
  $("timeline")
    .querySelectorAll("tr[data-step]")
    .forEach((row) => {
      const step = Number(row.dataset.step);
      row.onclick = () => loadStep(step);
      row.ondblclick = () => jumpToStep(step);
    });
}

function tableForRows(rows) {
  if (!rows || rows.length === 0) return `<div class="muted">No changes.</div>`;
  return `<table><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.key || row.label || row.floorId || "")}</td><td><pre class="json-block">${escapeHtml(JSON.stringify(row.before ?? row.beforeCount ?? row.value ?? "", null, 2))}</pre></td><td><pre class="json-block">${escapeHtml(JSON.stringify(row.after ?? row.afterCount ?? row.delta ?? "", null, 2))}</pre></td></tr>`).join("")}</tbody></table>`;
}

function renderDetails() {
  const detail = state.stepDetail;
  if (!detail) return;
  const mismatch = (state.session || {}).lastMismatch;
  const scoreRows = ((detail.score || {}).displayRows || [])
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.label)}</td><td class="kind-${escapeHtml(row.kind)}">${escapeHtml(row.value)}</td><td>${escapeHtml(row.kind)}</td></tr>`,
    )
    .join("");
  $("details").innerHTML = `
    ${mismatch ? `<div class="card"><h3 class="error">Mismatch</h3><div class="card-body"><pre class="json-block">${escapeHtml(JSON.stringify(mismatch, null, 2))}</pre></div></div>` : ""}
    <div class="card"><h3>Action</h3><pre class="json-block">${escapeHtml(JSON.stringify(detail.decision, null, 2))}</pre></div>
    <div class="card"><h3>Score / Estimate</h3><div class="card-body"><table><tbody>${scoreRows || `<tr><td class="muted">No score rows.</td></tr>`}</tbody></table></div></div>
    <div class="card"><h3>Hero Diff</h3><div class="card-body">${tableForRows(detail.diff.hero)}</div></div>
    <div class="card"><h3>Inventory Diff</h3><div class="card-body">${tableForRows(detail.diff.inventory)}</div></div>
    <div class="card"><h3>Flags Diff</h3><div class="card-body">${tableForRows(detail.diff.flags)}</div></div>
    <div class="card"><h3>Floor Mutations</h3><div class="card-body">${tableForRows(detail.diff.floors)}</div></div>
  `;
}

function renderRuntime() {
  $("runtime-status").textContent = JSON.stringify(
    state.session || {},
    null,
    2,
  );
}

function renderAll() {
  renderTopbar();
  renderResume();
  renderControls();
  renderTimeline();
  renderDetails();
  renderRuntime();
}

async function refreshSessionStatus() {
  try {
    state.session = await fetchJson("/api/session/status");
    if (
      ["running", "pausing"].includes(state.session.state) &&
      state.session.currentStep
    ) {
      state.selectedStep = Math.min(
        state.session.currentStep,
        (state.route || {}).decisionCount || state.session.currentStep,
      );
    }
    if (
      state.session.state === "failed" &&
      state.session.lastMismatch &&
      state.session.lastMismatch.step
    ) {
      state.selectedStep = state.session.lastMismatch.step;
      await loadStep(state.selectedStep).catch(() => null);
    }
    renderAll();
  } catch (error) {
    state.session = Object.assign({}, state.session, {
      lastError: { message: error.message },
    });
    renderAll();
  }
}

function ensurePolling() {
  if (state.polling) return;
  state.polling = setInterval(refreshSessionStatus, 500);
}

async function startLive() {
  const rawFromStep = $("from-step").value;
  const fromStep = rawFromStep === "" ? state.selectedStep || 1 : Number(rawFromStep);
  state.fromStepInput = fromStep;
  state.session = await postJson("/api/session/start", {
    fromStep,
    stepDelayMs: state.speedDelayMs,
    liveOptions: { headless: "0" },
  });
  ensurePolling();
  renderAll();
}
async function play() {
  await postJson("/api/session/play", { stepDelayMs: state.speedDelayMs });
  ensurePolling();
  await refreshSessionStatus();
}
async function pause() {
  state.session = await postJson("/api/session/pause", {});
  renderAll();
}
async function stepOnce() {
  state.session = await postJson("/api/session/step", {
    stepDelayMs: state.speedDelayMs,
  });
  ensurePolling();
  await refreshSessionStatus();
}
async function restart() {
  state.session = await postJson("/api/session/restart", {});
  ensurePolling();
  await refreshSessionStatus();
}
async function jumpToStep(step) {
  state.session = await postJson("/api/session/jump", { step });
  ensurePolling();
  await refreshSessionStatus();
}
async function jumpToSelected() {
  await jumpToStep(state.selectedStep);
}

loadRoute()
  .then(refreshSessionStatus)
  .then(ensurePolling)
  .catch((error) => {
    document.body.innerHTML = `<pre class="json-block error">${escapeHtml(error.stack || error.message)}</pre>`;
  });
