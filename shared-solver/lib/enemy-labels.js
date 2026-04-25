"use strict";

function getEnemyName(project, enemyId) {
  if (!enemyId) return "";
  const enemy = project && project.enemysById && project.enemysById[enemyId];
  return enemy && enemy.name ? String(enemy.name) : "";
}

function formatEnemyLabel(project, enemyId) {
  if (!enemyId) return "";
  const name = getEnemyName(project, enemyId);
  return name && name !== enemyId ? `${enemyId}（${name}）` : String(enemyId);
}

function parseEnemyIdFromSummary(summary) {
  const match = /^battle:([^@]+)@/.exec(summary || "");
  return match ? match[1] : null;
}

function formatActionLabel(project, actionOrSummary) {
  const summary = typeof actionOrSummary === "string"
    ? actionOrSummary
    : (actionOrSummary && actionOrSummary.summary) || "";
  const enemyId = typeof actionOrSummary === "object" && actionOrSummary
    ? actionOrSummary.enemyId || parseEnemyIdFromSummary(summary)
    : parseEnemyIdFromSummary(summary);
  if (!enemyId) return summary || ((actionOrSummary && actionOrSummary.kind) || "");
  return summary.replace(enemyId, formatEnemyLabel(project, enemyId));
}

module.exports = {
  formatActionLabel,
  formatEnemyLabel,
  getEnemyName,
};
