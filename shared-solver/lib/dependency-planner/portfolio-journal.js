"use strict";

// Portfolio journal file I/O and identity validation only. No planner,
// simulator, or lifecycle imports: the controller owns the loop state and
// builds the snapshot; this module only makes it durable and fail-closed.
const fs = require("node:fs");
const path = require("node:path");

const JOURNAL_SCHEMA = "motapathfinder.dependency-portfolio-journal.v1";

/**
 * Stable identity of the loop a journal belongs to. Budgets, flags and the
 * terminal goal must match on resume; `maxRounds` is deliberately EXCLUDED so
 * a journaled run can be resumed with a LARGER round budget (the whole point
 * of the journal) and a smaller one simply exits the loop early.
 */
function journalIdentity({ terminalGoal, initialStateFingerprint, controls }) {
  return JSON.stringify({
    schema: JOURNAL_SCHEMA,
    terminalGoal,
    initialStateFingerprint,
    controls,
  });
}

function writePortfolioJournal(filePath, snapshot) {
  if (!filePath || !snapshot) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify({ ...snapshot, schema: JOURNAL_SCHEMA })}\n`;
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readPortfolioJournal(filePath, expectedIdentity) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`portfolio journal not found: ${filePath}`);
  }
  const journal = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!journal || journal.schema !== JOURNAL_SCHEMA) {
    throw new Error(`unsupported portfolio journal schema in ${filePath}: ${journal && journal.schema}`);
  }
  if (expectedIdentity != null && journal.identity !== expectedIdentity) {
    throw new Error(
      `portfolio journal identity mismatch in ${filePath}: the journaled run was started with different terminal goal, budgets, flags, or initial state`,
    );
  }
  return journal;
}

module.exports = {
  JOURNAL_SCHEMA,
  journalIdentity,
  readPortfolioJournal,
  writePortfolioJournal,
};
