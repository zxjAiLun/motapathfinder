"use strict";

// Branch identity, lifecycle and reporting only. No planner, simulator or
// scheduling imports. Returned branch references remain live, as before;
// the controller still records per-experiment attempt counters on those records.
function createBranchLedger() {
  const branches = new Map();
  const lastEvaluationMap = new Map();
  let branchCounter = 0;

  function register(parentBranchId, state, cumulativeDecisions, exactStateFingerprint, via, openedByRound) {
    branchCounter += 1;
    const branchId = `branch-${branchCounter}`;
    const parent = parentBranchId ? branches.get(parentBranchId) : null;
    const branch = {
      branchId,
      parentBranchId: parent ? parent.branchId : null,
      state,
      exactStateFingerprint,
      cumulativeDecisions: cumulativeDecisions.slice(),
      status: "open",
      depth: parent ? parent.depth + 1 : 0,
      openedByRound,
      openedVia: via || null,
      attemptCount: 0,
      attemptedExperimentKeys: [],
      exhaustedReason: null,
    };
    branches.set(branchId, branch);
    return branch;
  }

  function open() {
    return Array.from(branches.values()).filter((branch) => branch.status !== "exhausted");
  }

  function checkpoint(branch) {
    return {
      id: branch.branchId,
      roles: branch.parentBranchId ? [`branch-depth-${branch.depth}`] : ["root-branch"],
      exactStateFingerprint: branch.exactStateFingerprint,
      state: branch.state,
    };
  }

  function exhaust(branchId, reason) {
    const branch = branches.get(branchId);
    if (!branch) return;
    branch.status = "exhausted";
    branch.exhaustedReason = reason;
  }

  function collapseEvaluation(evaluation) {
    if (!evaluation.canAdvance) {
      const branch = branches.get(evaluation.checkpointId);
      if (branch && branch.status !== "exhausted") {
        exhaust(branch.branchId, evaluation.feedbackClass);
        branch.lastEvaluationAlternatives = evaluation.alternatives;
      }
    }
  }

  function collapseEvaluations(evaluations) {
    for (const evaluation of evaluations) collapseEvaluation(evaluation);
  }

  function recordEvaluationPass(evaluations) {
    lastEvaluationMap.clear();
    for (const evaluation of evaluations) {
      lastEvaluationMap.set(evaluation.checkpointId, evaluation);
      collapseEvaluation(evaluation);
    }
  }

  function applyLocalOutcome(branchId, execution, checkpointCount) {
    const branch = branches.get(branchId);
    if (!branch || checkpointCount !== 0) return;
    if (execution && execution.outcome.budgetExhausted === true) {
      branch.status = "open";
    } else if (execution == null) {
      branch.status = "open";
    } else {
      exhaust(branchId, execution.outcome.reason || "local-execution-produced-no-checkpoint");
    }
    // Retain the old exhaustedReason/evidence when reopening after an
    // inconclusive execution. Changing that reporting contract is not a split.
  }

  function finalize(evaluateBranch) {
    const sweep = { evaluated: 0, newlyExhausted: [], advanceable: [], records: [] };
    // Evaluate the WHOLE open snapshot before mutating any lifecycle record.
    // The caller supplies effective normal-union-repair evaluations, not just
    // normal prerequisite feasibility. This preserves the PR-5.27f contract.
    const finalEvaluations = open().map(evaluateBranch);
    lastEvaluationMap.clear();
    sweep.evaluated = finalEvaluations.length;
    for (const evaluation of finalEvaluations) {
      const branch = branches.get(evaluation.checkpointId);
      lastEvaluationMap.set(evaluation.checkpointId, evaluation);
      let newlyExhaustedHere = false;
      if (!evaluation.effectiveCanAdvance && branch && branch.status !== "exhausted") {
        exhaust(branch.branchId, evaluation.feedbackClass);
        branch.lastEvaluationAlternatives = evaluation.alternatives;
        sweep.newlyExhausted.push(evaluation.checkpointId);
        newlyExhaustedHere = true;
      }
      // Collapse first, then report: never return stale open/null attribution.
      sweep.records.push({
        branchId: evaluation.checkpointId,
        depth: branch ? branch.depth : null,
        status: branch ? branch.status : null,
        exhaustedReason: branch ? branch.exhaustedReason : null,
        newlyExhaustedByFinalSweep: newlyExhaustedHere,
        floorId: branch && branch.state ? branch.state.floorId || null : null,
        canAdvance: evaluation.effectiveCanAdvance,
        feedbackClass: evaluation.effectiveFeedbackClass,
        normalCanAdvance: evaluation.normalCanAdvance,
        normalFeedbackClass: evaluation.normalFeedbackClass,
        repairExperimentCount: evaluation.repairExperimentCount,
        alternatives: evaluation.alternatives,
      });
      if (evaluation.effectiveCanAdvance) sweep.advanceable.push(evaluation.checkpointId);
    }
    // Historical exhaustion records come after the newly evaluated snapshot,
    // in registration order, and only when attribution evidence exists.
    for (const branch of branches.values()) {
      if (branch.status !== "exhausted") continue;
      if (sweep.records.some((entry) => entry.branchId === branch.branchId)) continue;
      const alternativeSummary = branch.lastEvaluationAlternatives || null;
      if (!alternativeSummary) continue;
      sweep.records.push({
        branchId: branch.branchId,
        depth: branch.depth,
        status: branch.status,
        exhaustedReason: branch.exhaustedReason,
        floorId: branch.state ? branch.state.floorId || null : null,
        canAdvance: false,
        feedbackClass: branch.exhaustedReason,
        alternatives: alternativeSummary,
      });
    }
    return sweep;
  }

  function summarize() {
    const allBranches = Array.from(branches.values());
    const openBranches = open();
    return {
      uniqueExactStateCount: new Set(allBranches.map((branch) => branch.exactStateFingerprint)).size,
      branchCount: branches.size,
      openBranchCount: openBranches.length,
      advanceableBranchCount: openBranches.filter((branch) => {
        const evaluation = lastEvaluationMap.get(branch.branchId);
        return evaluation && evaluation.canAdvance === true;
      }).length,
      exhaustedBranchCount: allBranches.filter((branch) => branch.status === "exhausted").length,
      branchIds: Array.from(branches.keys()),
      branches: allBranches.map((branch) => ({
        branchId: branch.branchId,
        parentBranchId: branch.parentBranchId,
        exactStateFingerprint: branch.exactStateFingerprint,
        floorId: (branch.state || {}).floorId || null,
        depth: branch.depth,
        status: branch.status,
        exhaustedReason: branch.exhaustedReason,
        cumulativeDecisionCount: branch.cumulativeDecisions.length,
        attemptCount: branch.attemptCount,
        openedByRound: branch.openedByRound,
        openedVia: branch.openedVia,
      })),
    };
  }

  // PR-5.28 (owner-authorized item A): durable portfolio journal support.
  // Serialization reports the ledger's OWN records in registration order; it
  // imports nothing and decides nothing. Deserialization is fail-closed on
  // shape, so a truncated or tampered journal can never silently resurrect a
  // half branch.
  function serialize() {
    return {
      branchCounter,
      branches: Array.from(branches.values()).map((branch) => ({
        ...branch,
        cumulativeDecisions: branch.cumulativeDecisions.slice(),
        attemptedExperimentKeys: branch.attemptedExperimentKeys.slice(),
      })),
      lastEvaluations: Array.from(lastEvaluationMap.entries()).map(([branchId, evaluation]) => ({
        branchId,
        evaluation,
      })),
    };
  }

  function deserialize(data) {
    if (!data || !Array.isArray(data.branches)) {
      throw new Error("branch-ledger: journal payload is missing the branches array");
    }
    branches.clear();
    lastEvaluationMap.clear();
    branchCounter = Number(data.branchCounter) || 0;
    for (const record of data.branches) {
      if (!record || typeof record.branchId !== "string" || !record.state) {
        throw new Error(`branch-ledger: invalid branch record in journal: ${JSON.stringify(record && record.branchId)}`);
      }
      branches.set(record.branchId, {
        branchId: record.branchId,
        parentBranchId: record.parentBranchId || null,
        state: record.state,
        exactStateFingerprint: record.exactStateFingerprint,
        cumulativeDecisions: Array.isArray(record.cumulativeDecisions) ? record.cumulativeDecisions.slice() : [],
        status: record.status || "open",
        depth: Number(record.depth) || 0,
        openedByRound: record.openedByRound == null ? null : record.openedByRound,
        openedVia: record.openedVia || null,
        attemptCount: Number(record.attemptCount) || 0,
        attemptedExperimentKeys: Array.isArray(record.attemptedExperimentKeys)
          ? record.attemptedExperimentKeys.slice()
          : [],
        exhaustedReason: record.exhaustedReason || null,
        lastEvaluationAlternatives: record.lastEvaluationAlternatives || null,
      });
    }
    for (const entry of Array.isArray(data.lastEvaluations) ? data.lastEvaluations : []) {
      if (entry && typeof entry.branchId === "string") {
        lastEvaluationMap.set(entry.branchId, entry.evaluation);
      }
    }
    return { branchCount: branches.size };
  }

  return {
    register,
    get: (branchId) => branches.get(branchId),
    open,
    checkpoint,
    exhaust,
    collapseEvaluations,
    recordEvaluationPass,
    applyLocalOutcome,
    finalize,
    summarize,
    serialize,
    deserialize,
  };
}

module.exports = { createBranchLedger };
