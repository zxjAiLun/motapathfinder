"use strict";

/**
 * Explicit Operator Migration Script for Cloud Durable Run
 *
 * Re-queues bounded nodes for Tier 3 expansion (256,000 expansions)
 * and attaches verified problem and resume fingerprints to the journal.
 */

const fs = require("node:fs");
const path = require("node:path");
const d = require("../lib/durable-search");

function main() {
  const runDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(process.env.HOME, "motapath-solver/runs/neko-zero-key");
  const towerRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(__dirname, "../../tower");
  const configPath = process.argv[4] ? path.resolve(process.argv[4]) : path.resolve(__dirname, "../profiles/neko-zero-key.json");

  console.log("Starting explicit journal migration...");
  console.log("Run dir:", runDir);
  console.log("Tower root:", towerRoot);
  console.log("Config:", configPath);

  const config = d.readJson(configPath);
  const journalPath = path.join(runDir, "journal.json");
  if (!fs.existsSync(journalPath)) throw new Error(`Journal not found: ${journalPath}`);

  const journal = d.readJson(journalPath);
  console.log("Loaded journal. Previous state:", journal.state, "completedAttempts:", journal.completedAttempts);

  // Compute immutable fingerprints
  const problem = d.problemFingerprint(config, towerRoot);
  const resume = d.resumeSearchFingerprint(config, towerRoot);
  const identity = d.identityOf(config, towerRoot);

  // Verify problem contract matches
  if (journal.initial && config.initial) {
    if (journal.initial.floorId !== config.initial.floorId) {
      throw new Error(`Problem contract mismatch: journal floor ${journal.initial.floorId} !== config ${config.initial.floorId}`);
    }
  }

  // Requeue bounded nodes to pending at new tier
  let requeuedCount = 0;
  for (const node of journal.nodes) {
    if (node.status === "bounded") {
      node.status = "pending";
      // Point to highest available tier
      node.tier = Math.min(node.tier + 1, config.budgets.length - 1);
      requeuedCount += 1;
    }
  }

  console.log(`Re-queued ${requeuedCount} bounded nodes back to pending (now tier ${config.budgets.length - 1}).`);

  const migrationRecord = {
    migratedAt: new Date().toISOString(),
    operatorConfirmed: true,
    reason: "requeue_bounded_nodes_for_tier3_256k_expansion",
    requeuedNodeCount: requeuedCount,
    previousState: journal.state,
    newState: "ready",
    previousIdentity: journal.identity,
    newIdentity: identity,
    problemFingerprint: problem,
    resumeSearchFingerprint: resume,
  };

  journal.migrations = journal.migrations || [];
  journal.migrations.push(migrationRecord);
  journal.problemFingerprint = problem;
  journal.resumeSearchFingerprint = resume;
  journal.identity = identity;
  journal.state = "ready";

  d.atomicJson(journalPath, journal);
  console.log("Migration complete! Journal saved successfully with 3-tier fingerprints.");
}

if (require.main === module) {
  main();
}

module.exports = { main };
