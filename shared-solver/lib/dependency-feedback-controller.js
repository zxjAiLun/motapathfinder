"use strict";

// Cross-round orchestration and compatibility entry. Feedback, repair, branch
// lifecycle and route finalization live in dependency-planner/.
const crypto = require("node:crypto");
const { buildStateKey } = require("./state-key");
const { createBranchLedger } = require("./dependency-planner/branch-ledger");
const { terminalGoalReached, finalizeDependencyRoute } = require("./dependency-planner/route-finalization");
const { makeBlindSimulator } = require("./blind-discovery-baseline");
const { executeLocalDependency } = require("./local-dependency-executor");
const {
  SCHEMA,
  buildDependencyContext,
  evaluateCheckpoint,
  evaluateBranchExperiments,
  summarizeAlternative,
  runDependencyFeedback,
} = require("./dependency-planner/feedback");
const {
  RESOURCE_REPAIR_TRIGGER_STATUSES,
  evaluateResourceRepairTrigger,
  isBattleRelevantRepairIntent,
  prerequisiteIdentityOf,
  normalizePrerequisiteIdentity,
  collectReplannedPrerequisiteStatuses,
  collectReplannedPrerequisiteEvidence,
  classifyRepairOutcome,
  aggregateRepairOutcome,
} = require("./dependency-planner/repair-experiments");
const {
  journalIdentity,
  readPortfolioJournal,
  writePortfolioJournal,
} = require("./dependency-planner/portfolio-journal");

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The checkpoint fingerprint as the one-step controller computes it. Kept in
 * lockstep with `local-dependency-executor.stateFingerprint` so the loop can
 * burn the round-0 experiment identity without having to re-run the executor.
 */
function stateFingerprintOf(state) {
  return crypto.createHash("sha256").update(buildStateKey(state)).digest("hex").slice(0, 16);
}

function runDependencyFeedbackLoop(project, projectRoot, terminalGoal, initialState, options) {
  if (!project || !terminalGoal || !initialState) {
    throw new Error("Dependency feedback loop requires project, terminalGoal, and initialState");
  }
  const config = options || {};
  const maxRounds = Math.max(1, number(config.maxRounds, 8));
  const maxTotalLocalExpansions = Math.max(1, number(config.maxTotalLocalExpansions, 4096));
  const localMaxExpansions = Math.max(1, number(config.localMaxExpansions, 64));
  const candidateLimit = Math.max(2, number(config.candidateLimit, 8));
  const contextOptions = { towerId: config.towerId, alternativeLimit: config.alternativeLimit };
  const startedAt = Date.now();

  // Test seam: the loop's own contract (branch portfolio, backtracking, budget
  // clamping, route stitching) must be provable on a synthetic world whose shape
  // is guaranteed, not by waiting for the real tower to produce a forced
  // backtrack. Overriding these two does not change any production behaviour,
  // because their defaults are the real planner and the real executor.
  const executeLocal = typeof config.executeLocalDependency === "function"
    ? config.executeLocalDependency
    : executeLocalDependency;
  const buildContext = typeof config.buildDependencyContext === "function"
    ? config.buildDependencyContext
    : buildDependencyContext;

  // PR-5.27b: the loop keeps a PERSISTENT BRANCH PORTFOLIO instead of chaining a
  // single `previousExecution`. Each round's selection is drawn from every branch
  // that can still advance, so a blocked branch can be abandoned and an older
  // branch revisited. Without this, "the current portfolio is blocked" is
  // indistinguishable from "the search is exhausted".
  const ledger = createBranchLedger();
  const attempts = [];
  // PR-5.27e: failure-conditioned resource-repair accounting.
  const battleRelevantRepairOnly = config.battleRelevantRepairOnly === true;
  // PR-5.27g: outcome-conditioned commitment. Default OFF; the 5.27c
  // commitment contract is unchanged unless this flag is explicitly set.
  const outcomeConditionedRepairCommitment = config.outcomeConditionedRepairCommitment === true;
  const repairTelemetry = {
    generated: 0,
    selected: 0,
    checkpointsCreated: 0,
    convertedToViable: 0,
    exactSamePrerequisiteConversions: 0,
    blockedStatusesSeen: {},
    attempts: [],
    conversions: [],
    rejectedByRelevance: 0,
    rejectedIntentKinds: {},
    outcomeCounts: {},
    commitmentsWithheld: 0,
  };
  const rounds = [];
  const visitedExactCheckpointStates = new Set();
  const attemptedExperimentKeys = new Set();
  const commitSuccessfulLineage = config.commitSuccessfulLineage === true;
  const failureConditionedResourceRepair = config.failureConditionedResourceRepair === true;
  let preferredCohortBranchIds = new Set();
  let totalLocalExpansions = 0;
  let frontierState = initialState;
  let frontierOrigin = "route-free-initial-state";
  let rootBranch = null;
  let frontierStateKey = null;
  let terminationReason = null;
  let terminationClass = null;
  let reachedTerminal = false;
  let terminalBranchId = null;
  let roundIndex = 0;

  // Owner-authorized item A: durable portfolio journal. Opt-in via
  // config.portfolioJournalPath (write-only observation); resume additionally
  // requires config.resumePortfolioJournal. The journal identity binds the
  // terminal goal, the initial state fingerprint, budgets and flags, so a
  // mismatched journal fails closed instead of silently resuming a different
  // run. maxRounds is deliberately NOT part of the identity: resuming with a
  // larger round budget is the journal's purpose, and a smaller one just exits
  // the loop early.
  const journalPath = typeof config.portfolioJournalPath === "string" && config.portfolioJournalPath
    ? config.portfolioJournalPath
    : null;
  const resumeFromJournal = Boolean(journalPath) && config.resumePortfolioJournal === true;
  const journalIdentityValue = journalIdentity({
    terminalGoal,
    initialStateFingerprint: stateFingerprintOf(initialState),
    controls: {
      towerId: config.towerId || null,
      maxTotalLocalExpansions,
      localMaxExpansions,
      candidateLimit,
      commitSuccessfulLineage,
      failureConditionedResourceRepair,
      battleRelevantRepairOnly,
      outcomeConditionedRepairCommitment,
    },
  });
  let resumedFromJournal = false;
  if (resumeFromJournal) {
    const journal = readPortfolioJournal(journalPath, journalIdentityValue);
    ledger.deserialize(journal.ledger);
    rootBranch = ledger.get(journal.rootBranchId);
    if (!rootBranch) {
      throw new Error(`portfolio journal restore failed: root branch ${journal.rootBranchId} is missing`);
    }
    roundIndex = Number(journal.roundIndex) || 0;
    for (const entry of Array.isArray(journal.rounds) ? journal.rounds : []) rounds.push(entry);
    for (const entry of Array.isArray(journal.attempts) ? journal.attempts : []) attempts.push(entry);
    Object.assign(repairTelemetry, journal.repairTelemetry || {});
    for (const key of journal.attemptedExperimentKeys || []) attemptedExperimentKeys.add(key);
    for (const key of journal.visitedExactCheckpointStates || []) visitedExactCheckpointStates.add(key);
    preferredCohortBranchIds = new Set(journal.preferredCohortBranchIds || []);
    frontierState = journal.frontierState || initialState;
    frontierStateKey = journal.frontierStateKey || null;
    frontierOrigin = journal.frontierOrigin || "route-free-initial-state";
    reachedTerminal = journal.reachedTerminal === true;
    terminalBranchId = journal.terminalBranchId || null;
    terminationReason = journal.terminationReason || null;
    terminationClass = journal.terminationClass || null;
    totalLocalExpansions = Number(journal.totalLocalExpansions) || 0;
    resumedFromJournal = true;
  }
  const writeJournalSnapshot = () => {
    if (!journalPath) return;
    writePortfolioJournal(journalPath, {
      identity: journalIdentityValue,
      roundIndex,
      rounds,
      attempts,
      repairTelemetry,
      attemptedExperimentKeys: Array.from(attemptedExperimentKeys),
      visitedExactCheckpointStates: Array.from(visitedExactCheckpointStates),
      preferredCohortBranchIds: Array.from(preferredCohortBranchIds),
      ledger: ledger.serialize(),
      rootBranchId: rootBranch ? rootBranch.branchId : null,
      frontierState,
      frontierStateKey,
      frontierOrigin,
      reachedTerminal,
      terminalBranchId,
      terminationReason,
      terminationClass,
      totalLocalExpansions,
    });
  };

  // The global expansion budget is HARD: a local call may only spend what is left
  // of it. The pre-round `>=` check alone is not enough, because issuing the next
  // call with the full local budget can overshoot the global ceiling before the
  // check is reached again.
  const remainingGlobalBudget = () => maxTotalLocalExpansions - totalLocalExpansions;
  const effectiveLocalBudget = () => Math.min(localMaxExpansions, remainingGlobalBudget());

  if (!resumedFromJournal) {

  // Round 0 treats the caller's exact state as a portfolio of one. No route, no
  // prefix, no authored subgoal.
  rootBranch = ledger.register(
    null,
    initialState,
    [],
    stateFingerprintOf(initialState),
    "route-free-initial-state",
    rounds.length,
  );
  const initialContext = buildContext(project, initialState, terminalGoal, contextOptions);
  const initialExecution = executeLocal(project, projectRoot, initialState, initialContext.plan, {
    maxExpansions: effectiveLocalBudget(),
    candidateLimit,
    simulatorFactory: config.simulatorFactory,
  });
  totalLocalExpansions += number(initialExecution.outcome.expansions, 0);
  rootBranch.attemptCount += 1;
  if (initialExecution.selected) {
    // The initial execution selects a prerequisite too, so its experiment identity
    // must be burned as well. Otherwise round 1 can legitimately re-select the very
    // same (checkpoint state, alternative, prerequisite) triple, which is exactly
    // the duplication this loop exists to prevent.
    const initialKey = [
      rootBranch.exactStateFingerprint,
      initialExecution.selected.alternativeId,
      (initialExecution.selected.prerequisite || {}).sourceNodeId || "complete",
    ].join("|");
    attemptedExperimentKeys.add(initialKey);
    rootBranch.attemptedExperimentKeys.push(initialKey);
    attempts.push({
      experimentKey: initialKey,
      branchId: rootBranch.branchId,
      round: 0,
      expansions: number(initialExecution.outcome.expansions, 0),
      outcome: initialExecution.outcome.budgetExhausted === true
        ? "attempted-but-inconclusive"
        : initialExecution.outcome.frontierExhausted === true
          ? "exhausted"
          : "produced-checkpoints",
    });
  }
  const initialCheckpoints = initialExecution.checkpoints || [];
  rounds.push({
    round: 0,
    kind: "initial-local-execution",
    origin: frontierOrigin,
    branchId: rootBranch.branchId,
    selected: initialExecution.selected
      ? {
        branchId: rootBranch.branchId,
        alternativeId: initialExecution.selected.alternativeId,
        prerequisiteId: initialExecution.selected.prerequisite.sourceNodeId,
      }
      : null,
    outcome: {
      goalFound: initialExecution.outcome.goalFound,
      expansions: number(initialExecution.outcome.expansions, 0),
      budgetExhausted: initialExecution.outcome.budgetExhausted,
      frontierExhausted: initialExecution.outcome.frontierExhausted,
      reason: initialExecution.outcome.reason || null,
    },
    checkpointCount: initialCheckpoints.length,
    checkpointDiversity: initialExecution.checkpointDiversity || null,
    verdict: initialExecution.verdict,
  });

  // Each retained checkpoint from the initial execution becomes its own open
  // branch, carrying the accumulated decisions that reached it.
  const childBranches = [];
  for (const checkpoint of initialCheckpoints) {
    visitedExactCheckpointStates.add(checkpoint.exactStateFingerprint);
    const child = ledger.register(
      rootBranch.branchId,
      checkpoint.state,
      Array.isArray((checkpoint.routeRecord || {}).decisions) ? checkpoint.routeRecord.decisions : [],
      checkpoint.exactStateFingerprint,
      "initial-checkpoint",
      rounds.length,
    );
    childBranches.push({ branch: child, checkpoint });
  }

  // PR-5.27c: If round 0 opened children and commitment is enabled, seed preferred cohort
  // with those children so round 1 continues exploring the newly opened lineage.
  if (commitSuccessfulLineage && childBranches.length > 0) {
    preferredCohortBranchIds = new Set(childBranches.map((entry) => entry.branch.branchId));
  }

  const initialTerminalEntry = childBranches.find((entry) =>
    terminalGoalReached(project, entry.checkpoint.state, terminalGoal)) || null;
  reachedTerminal = Boolean(initialTerminalEntry);
  terminalBranchId = initialTerminalEntry ? initialTerminalEntry.branch.branchId : null;
  if (reachedTerminal) {
    terminationReason = "terminal-goal-reached-in-initial-execution";
    terminationClass = "TERMINAL_GOAL_REACHED";
  } else if (childBranches.length > 0) {
    frontierState = childBranches[0].branch.state;
    frontierStateKey = childBranches[0].branch.exactStateFingerprint;
    frontierOrigin = `initial-checkpoint:${childBranches[0].checkpoint.id}`;
  } else if (initialExecution.outcome.searchComplete === true) {
    ledger.exhaust(rootBranch.branchId, "initial-execution-proved-no-continuation");
    terminationReason = "initial-execution-proved-no-continuation";
    terminationClass = "GLOBAL_PORTFOLIO_EXHAUSTED";
  }
  writeJournalSnapshot();
  }

  const buildPortfolio = () => ledger.open().map(ledger.checkpoint);

  while (!reachedTerminal && terminationReason == null && roundIndex < maxRounds) {
    if (remainingGlobalBudget() <= 0) {
      terminationReason = "global-local-expansion-budget-exhausted";
      terminationClass = "LOCAL_BUDGET_LIMITED";
      break;
    }
    roundIndex += 1;

    // PR-5.27c: Commit-on-Success, Backtrack-on-Block.
    // When commitSuccessfulLineage is enabled and preferredCohortBranchIds contains
    // open branches, evaluate the preferred cohort first.
    // If any preferred child canAdvance, restrict selection to the cohort.
    // If all preferred children are blocked/exhausted, fall back to global historical open branches.
    let portfolio;
    let usingPreferredCohort = false;
    if (commitSuccessfulLineage && preferredCohortBranchIds.size > 0) {
      const cohortOpen = Array.from(preferredCohortBranchIds)
        .map((id) => ledger.get(id))
        .filter((branch) => branch && branch.status !== "exhausted");
      if (cohortOpen.length > 0) {
        portfolio = cohortOpen.map(ledger.checkpoint);
        usingPreferredCohort = true;
      } else {
        preferredCohortBranchIds.clear();
      }
    }

    if (!portfolio || portfolio.length === 0) {
      portfolio = buildPortfolio();
      usingPreferredCohort = false;
    }

    let feedback = runDependencyFeedback(project, projectRoot, terminalGoal, { checkpoints: portfolio }, {
      ...contextOptions,
      excludedExperimentKeys: attemptedExperimentKeys,
      maxExpansions: effectiveLocalBudget(),
      candidateLimit,
      simulatorFactory: config.simulatorFactory,
      failureConditionedResourceRepair,
      battleRelevantRepairOnly,
      // Forward the test seam so a synthetic world can drive the whole stack.
      buildDependencyContext: buildContext,
      executeLocalDependency: executeLocal,
    });

    // If preferred cohort was evaluated but none could advance, mark non-advancing branches
    // as exhausted under the monotonic contract, clear preferred cohort, and fall back to global portfolio.
    if (usingPreferredCohort && !feedback.selection) {
      ledger.collapseEvaluations(feedback.evaluations || []);
      preferredCohortBranchIds.clear();
      portfolio = buildPortfolio();
      usingPreferredCohort = false;
      feedback = runDependencyFeedback(project, projectRoot, terminalGoal, { checkpoints: portfolio }, {
        ...contextOptions,
        excludedExperimentKeys: attemptedExperimentKeys,
        maxExpansions: effectiveLocalBudget(),
        candidateLimit,
        simulatorFactory: config.simulatorFactory,
        failureConditionedResourceRepair,
        battleRelevantRepairOnly,
        buildDependencyContext: buildContext,
        executeLocalDependency: executeLocal,
      });
    }

    // Monotonic branch exhaustion: for all branches evaluated in this portfolio pass,
    // if canAdvance is false, mark exhausted under the current planner contract
    // (an immutable state's available experiments can only shrink as attemptedExperimentKeys grows).
    ledger.recordEvaluationPass(feedback.evaluations || []);

    const selection = feedback.selection;
    const nextExecution = feedback.nextExecution;
    const selectedBranch = selection ? ledger.get(selection.checkpointId) || null : null;
    const previousStepRound = rounds.filter((entry) => entry.kind === "dependency-feedback-step").slice(-1)[0];

    // Deduplication is the loop's own contract: an experimentKey is burned the
    // moment it is selected, whether or not the local execution produced anything.
    let experimentKeyReused = false;
    if (selection && selection.experimentKey) {
      experimentKeyReused = attemptedExperimentKeys.has(selection.experimentKey);
      attemptedExperimentKeys.add(selection.experimentKey);
    }

    const nextCheckpoints = (nextExecution && nextExecution.checkpoints) || [];
    const nextExpansions = nextExecution ? number(nextExecution.outcome.expansions, 0) : 0;
    totalLocalExpansions += nextExpansions;

    const localOutcome = !nextExecution
      ? "not-executed"
      : nextExecution.outcome.budgetExhausted === true
        ? "attempted-but-inconclusive"
        : nextCheckpoints.length > 0
          ? "produced-checkpoints"
          : nextExecution.outcome.searchComplete === true
            ? "exhausted"
            : "attempted-but-inconclusive";
    if (selection && selection.experimentKey) {
      attempts.push({
        experimentKey: selection.experimentKey,
        branchId: selectedBranch ? selectedBranch.branchId : null,
        round: roundIndex,
        expansions: nextExpansions,
        outcome: localOutcome,
      });
    }
    if (selectedBranch) {
      selectedBranch.attemptCount += 1;
      if (selection && selection.experimentKey) {
        selectedBranch.attemptedExperimentKeys.push(selection.experimentKey);
      }
    }

    // PR-5.27e telemetry: the repair mechanism is only meaningful if it actually
    // converts a previously blocked battle into a viable one after replanning.
    if (feedback.resourceRepair && feedback.resourceRepair.enabled) {
      repairTelemetry.generated += number(feedback.resourceRepair.generatedCount, 0);
      repairTelemetry.rejectedByRelevance += number(feedback.resourceRepair.rejectedByRelevance, 0);
      for (const entry of (feedback.resourceRepair.triggers || [])) {
        for (const kind of (entry.rejectedIntentIds || [])) {
          const label = String(kind).replace(/^cf-d\d+-/, "");
          repairTelemetry.rejectedIntentKinds[label] =
            (repairTelemetry.rejectedIntentKinds[label] || 0) + 1;
        }
      }
      for (const status of (selection && selection.blockedStatuses) || []) {
        repairTelemetry.blockedStatusesSeen[status] =
          (repairTelemetry.blockedStatusesSeen[status] || 0) + 1;
      }
    }
    const repairSelected = Boolean(selection && selection.resourceRepair);
    if (repairSelected) {
      repairTelemetry.selected += 1;
      if (nextCheckpoints.length > 0) repairTelemetry.checkpointsCreated += nextCheckpoints.length;
      repairTelemetry.attempts.push({
        round: roundIndex,
        originBranchId: selectedBranch ? selectedBranch.branchId : null,
        originCheckpointId: selection.checkpointId,
        intentId: selection.alternative.alternativeId,
        repairKind: selection.repairKind || null,
        blockedStatuses: (selection.blockedStatuses || []).slice(),
        blockedPrerequisiteIds: (selection.blockedPrerequisiteIds || []).slice(),
        experimentKey: selection.experimentKey,
        expansions: nextExpansions,
        checkpointCount: nextCheckpoints.length,
        childBranchIds: [],
      });
    }

    const terminalEntry = nextCheckpoints
      .map((checkpoint) => ({ checkpoint }))
      .find((entry) => terminalGoalReached(project, entry.checkpoint.state, terminalGoal)) || null;

    // Child branches inherit the parent's accumulated decisions and append this
    // local segment, so the lineage is explicit rather than relying on a
    // checkpoint's own route happening to contain the prefix.
    const openedChildren = [];
    for (const checkpoint of nextCheckpoints) {
      visitedExactCheckpointStates.add(checkpoint.exactStateFingerprint);
      const child = ledger.register(
        selectedBranch ? selectedBranch.branchId : rootBranch.branchId,
        checkpoint.state,
        (selectedBranch ? selectedBranch.cumulativeDecisions : [])
          .concat(Array.isArray((checkpoint.routeRecord || {}).decisions) ? checkpoint.routeRecord.decisions : []),
        checkpoint.exactStateFingerprint,
        "dependency-feedback-step",
        rounds.length,
      );
      openedChildren.push({ branch: child, checkpoint });
    }
    if (repairSelected && repairTelemetry.attempts.length > 0) {
      const entry = repairTelemetry.attempts[repairTelemetry.attempts.length - 1];
      entry.childBranchIds = openedChildren.map((child) => child.branch.branchId);
    }
    const accepted = terminalEntry
      ? openedChildren.find((entry) => entry.checkpoint === terminalEntry.checkpoint)
      : openedChildren[0] || null;

    // PR-5.27g: SAME-BLOCKER OUTCOME CLASSIFICATION, computed BEFORE the
    // commitment decision so the preferred cohort can be conditioned on what
    // the repair actually achieved against the identity that triggered it.
    // The 5.27f conversion accounting below is unchanged; the only additions are
    // the per-identity `outcome` field and the per-attempt aggregate.
    let repairOutcome = null;
    if (repairSelected && openedChildren.length > 0) {
      for (const child of openedChildren.slice(0, 1)) {
        let afterEvaluation = null;
        try {
          afterEvaluation = evaluateCheckpoint(
            project,
            terminalGoal,
            {
              id: child.branch.branchId,
              roles: [`branch-depth-${child.branch.depth}`],
              exactStateFingerprint: child.branch.exactStateFingerprint,
              state: child.branch.state,
            },
            {
              ...contextOptions,
              excludedExperimentKeys: attemptedExperimentKeys,
              contextBuilder: buildContext,
            },
          );
        } catch {
          afterEvaluation = null;
        }
        const replannedEvidence = collectReplannedPrerequisiteEvidence(afterEvaluation);
        const replanned = new Map(
          Array.from(replannedEvidence.entries()).map(([identity, entry]) => [identity, entry.status]),
        );
        const blockedBefore = (selection.blockedPrerequisites || []).length > 0
          ? (selection.blockedPrerequisites || [])
          : (selection.blockedPrerequisiteIds || []).map((identity) => ({
            identity,
            sourceNodeId: identity,
            floorId: null,
            x: null,
            y: null,
            statusBefore: null,
          }));
        const identityConversions = blockedBefore.map((blocked) => {
          const identity = blocked.identity || prerequisiteIdentityOf(blocked);
          const after = identity && replannedEvidence.has(identity)
            ? replannedEvidence.get(identity)
            : null;
          const afterStatus = after ? after.status : "NOT_PRESENT_IN_REPLANNED_ALTERNATIVES";
          const beforeStatus = blocked.statusBefore || null;
          const converted = RESOURCE_REPAIR_TRIGGER_STATUSES.has(beforeStatus)
            && afterStatus === "viable-at-current-state";
          const outcome = classifyRepairOutcome({
            beforeStatus,
            beforeEvidence: blocked.evidenceBefore || null,
            afterStatus,
            afterEvidence: after ? after.evidence : null,
          });
          return {
            blockedPrerequisiteId: identity,
            sourceNodeId: blocked.sourceNodeId || null,
            floorId: blocked.floorId || null,
            x: blocked.x == null ? null : blocked.x,
            y: blocked.y == null ? null : blocked.y,
            beforeStatus,
            afterStatus,
            sameIdentity: true,
            converted,
            outcome,
          };
        });
        // `convertedToViable` (broad) is retained only for backward comparison
        // with 5.27e; the causal counter is `exactSamePrerequisiteConversions`.
        const broadConverted = Array.from(replanned.values())
          .some((status) => status === "viable-at-current-state");
        const anyExact = identityConversions.some((entry) => entry.converted);
        repairOutcome = aggregateRepairOutcome(identityConversions.map((entry) => entry.outcome));
        repairTelemetry.conversions.push({
          round: roundIndex,
          originBranchId: selectedBranch ? selectedBranch.branchId : null,
          childBranchId: child.branch.branchId,
          intentId: selection.alternative.alternativeId,
          repairKind: selection.repairKind || null,
          blockedStatusesBefore: (selection.blockedStatuses || []).slice(),
          blockedPrerequisiteIds: identityConversions.map((entry) => entry.blockedPrerequisiteId),
          identityConversions,
          replannedPrerequisiteCount: replanned.size,
          statusesAfter: Array.from(new Set(replanned.values())),
          converted: anyExact,
          convertedBroad: broadConverted,
          outcome: repairOutcome,
        });
        if (anyExact) repairTelemetry.exactSamePrerequisiteConversions += 1;
        if (broadConverted) repairTelemetry.convertedToViable += 1;
        if (repairOutcome) {
          repairTelemetry.outcomeCounts[repairOutcome] =
            (repairTelemetry.outcomeCounts[repairOutcome] || 0) + 1;
        }
      }
    }

    ledger.applyLocalOutcome(selectedBranch ? selectedBranch.branchId : null, nextExecution, nextCheckpoints.length);

    // PR-5.27c/5.27g: preferred child cohort update for commitment.
    // Normal dependency success keeps the existing commitment contract. A
    // failure-conditioned resource repair earns automatic commitment only when
    // its outcome against the triggering blocker is CONVERTED or IMPROVED; a
    // NO_PROGRESS / NOT_PRESENT repair keeps its children in the historical
    // portfolio (no pruning, no invalidation) but does NOT set the preferred
    // cohort, so the next round falls back to ordinary portfolio selection.
    const withholdRepairCommitment = repairSelected
      && outcomeConditionedRepairCommitment
      && openedChildren.length > 0
      && repairOutcome !== "CONVERTED"
      && repairOutcome !== "IMPROVED";
    if (commitSuccessfulLineage) {
      if (openedChildren.length > 0 && !withholdRepairCommitment) {
        preferredCohortBranchIds = new Set(openedChildren.map((entry) => entry.branch.branchId));
      } else {
        preferredCohortBranchIds.clear();
      }
    }
    if (withholdRepairCommitment) repairTelemetry.commitmentsWithheld += 1;

    let roundVerdict;
    let selectedBranchParentIsPreviousRound = null;
    let backtrackedToOlderBranch = false;
    if (terminalEntry) {
      roundVerdict = "TERMINAL_GOAL_REACHED";
      frontierState = accepted.branch.state;
      frontierStateKey = accepted.branch.exactStateFingerprint;
      frontierOrigin = `round-${roundIndex}-terminal-checkpoint`;
      reachedTerminal = true;
      terminationReason = "terminal-goal-reached";
      terminationClass = "TERMINAL_GOAL_REACHED";
      terminalBranchId = accepted.branch.branchId;
    } else if (!selection) {
      // Distinguish "nothing in the current portfolio can advance" from "nothing
      // anywhere in the search tree can advance". The former is a property of the
      // attempted set at this moment; only the latter is exhaustion.
      const viable = feedback.evaluations.filter((entry) => entry.canAdvance === true);
      const openCount = ledger.open().length;
      roundVerdict = "CURRENT_PORTFOLIO_BLOCKED";
      if (openCount === 0) {
        terminationReason = "global-portfolio-exhausted";
        terminationClass = "GLOBAL_PORTFOLIO_EXHAUSTED";
      } else if (viable.length > 0) {
        terminationReason = "no-unattempted-executable-experiment";
        terminationClass = "GLOBAL_PORTFOLIO_EXHAUSTED";
      } else {
        terminationReason = "all-open-branches-currently-blocked";
        terminationClass = "CURRENT_BRANCH_BLOCKED";
      }
    } else if (nextExecution == null) {
      roundVerdict = "LOCAL_EXECUTION_NOT_RUN";
    } else if (nextCheckpoints.length === 0) {
      roundVerdict = "LOCAL_EXECUTION_PRODUCED_NO_CHECKPOINT";
    } else {
      roundVerdict = "ADVANCED_TO_NEW_CHECKPOINT_STATE";
      frontierState = accepted.branch.state;
      frontierStateKey = accepted.branch.exactStateFingerprint;
      frontierOrigin = `round-${roundIndex}-checkpoint:${accepted.checkpoint.id}`;
      if (selectedBranch) {
        // Backtracking = the branch we advanced from was NOT the branch the
        // immediately preceding round advanced into. That is the observable
        // difference between "switched alternative" and "returned to an older
        // state".
        selectedBranchParentIsPreviousRound = previousStepRound
          ? selectedBranch.branchId === previousStepRound.acceptedBranchId
          : selectedBranch.branchId === rootBranch.branchId;
        backtrackedToOlderBranch = selectedBranchParentIsPreviousRound === false;
      }
    }

    const selectedEvaluation = selection
      ? feedback.evaluations.find((entry) => entry.checkpointId === selection.checkpointId)
      : null;
    rounds.push({
      round: roundIndex,
      kind: "dependency-feedback-step",
      origin: frontierOrigin,
      feedbackVerdict: feedback.verdict,
      feedbackClass: selectedEvaluation ? selectedEvaluation.feedbackClass : null,
      portfolioSize: portfolio.length,
      selected: selection ? {
        branchId: selectedBranch ? selectedBranch.branchId : null,
        checkpointId: selection.checkpointId,
        alternativeId: selection.alternative.alternativeId,
        prerequisiteId: selection.alternative.leadingPrerequisiteId,
        experimentKey: selection.experimentKey,
        changedCheckpoint: selection.changedCheckpoint,
        changedAlternative: selection.changedAlternative,
      } : null,
      experimentKeyReused,
      localOutcome,
      outcome: nextExecution ? {
        goalFound: nextExecution.outcome.goalFound,
        expansions: nextExpansions,
        budgetExhausted: nextExecution.outcome.budgetExhausted,
        reason: nextExecution.outcome.reason || null,
      } : null,
      checkpointCount: nextCheckpoints.length,
      checkpointDiversity: nextExecution ? nextExecution.checkpointDiversity : null,
      acceptedCheckpointId: accepted ? accepted.checkpoint.id : null,
      acceptedBranchId: accepted ? accepted.branch.branchId : null,
      acceptedStateFingerprint: accepted ? accepted.branch.exactStateFingerprint : null,
      acceptedCheckpointLabel: accepted
        ? `${accepted.branch.branchId}:${accepted.checkpoint.id}` : null,
      acceptedStrictReplay: accepted ? accepted.checkpoint.replay.valid === true : null,
      openedBranchIds: openedChildren.map((entry) => entry.branch.branchId),
      selectedBranchParentIsPreviousRound,
      backtrackedToOlderBranch,
      repairOutcome,
      commitmentWithheld: withholdRepairCommitment,
      verdict: roundVerdict,
    });
    writeJournalSnapshot();
  }

  // Evaluate all remaining open branches against the final experiment universe;
  // the ledger owns collapse ordering, historical attribution and final counts.
  const finalSweep = ledger.finalize((branch) => evaluateBranchExperiments(
    project,
    terminalGoal,
    ledger.checkpoint(branch),
    {
      ...contextOptions,
      excludedExperimentKeys: attemptedExperimentKeys,
      contextBuilder: buildContext,
      failureConditionedResourceRepair,
      battleRelevantRepairOnly,
      candidateLimit,
      simulatorProvider: () => (typeof config.simulatorFactory === "function"
        ? config.simulatorFactory()
        : makeBlindSimulator(project)),
    },
  ));

  const completedAt = Date.now();
  if (!reachedTerminal && terminationReason == null) {
    if (remainingGlobalBudget() <= 0) {
      terminationReason = "global-local-expansion-budget-exhausted";
      terminationClass = "LOCAL_BUDGET_LIMITED";
    } else {
      terminationReason = "global-round-budget-exhausted";
      terminationClass = "ROUND_BUDGET_LIMITED";
    }
  }

  const stepRounds = rounds.filter((round) => round.kind === "dependency-feedback-step");
  const terminalBranch = terminalBranchId ? ledger.get(terminalBranchId) : null;
  const finalizedRoute = finalizeDependencyRoute({
    project,
    initialState,
    terminalGoal,
    reachedTerminal,
    terminalBranch,
    stepRounds,
    // Resolve lazily and keep method invocation on the original options object.
    // Extracting a bare function would change `this` for caller-owned factories.
    getSimulatorFactory: () => typeof config.simulatorFactory === "function"
      ? () => config.simulatorFactory()
      : null,
  });
  const branchSummary = ledger.summarize();

  return {
    schema: SCHEMA,
    loop: "runDependencyFeedbackLoop",
    inputContract: {
      inputs: ["tower-project", "route-free-initial-state", "one-terminal-goal", "global-budgets"],
      forbidden: [
        "route-fixture", "route-prefix", "authored-milestone", "authored-event-order",
        "authored-resource-threshold", "authored-floor-decomposition",
      ],
      knownRouteUsed: false,
      authoredMilestoneUsed: false,
      authoredEventOrderUsed: false,
      authoredResourceThresholdUsed: false,
    },
    controls: {
      maxRounds,
      maxTotalLocalExpansions,
      localMaxExpansions,
      candidateLimit,
      commitSuccessfulLineage,
      failureConditionedResourceRepair,
      battleRelevantRepairOnly,
      outcomeConditionedRepairCommitment,
      maxRuntimeMs: 0,
      towerId: config.towerId || null,
    },
    globalState: {
      roundCount: stepRounds.length,
      totalLocalExpansions,
      totalLocalExpansionsWithinBudget: totalLocalExpansions <= maxTotalLocalExpansions,
      attemptedExperimentKeyCount: attemptedExperimentKeys.size,
      attemptedExperimentKeys: Array.from(attemptedExperimentKeys).sort(),
      visitedExactCheckpointStateCount: visitedExactCheckpointStates.size,
      visitedExactCheckpointStates: Array.from(visitedExactCheckpointStates).sort(),
      uniqueExactStateCount: branchSummary.uniqueExactStateCount,
      experimentKeyReuseCount: rounds.filter((round) => round.experimentKeyReused === true).length,
      branchCount: branchSummary.branchCount,
      openBranchCount: branchSummary.openBranchCount,
      advanceableBranchCount: branchSummary.advanceableBranchCount,
      resourceRepair: {
        enabled: failureConditionedResourceRepair,
        generated: repairTelemetry.generated,
        selected: repairTelemetry.selected,
        checkpointsCreated: repairTelemetry.checkpointsCreated,
        convertedToViable: repairTelemetry.convertedToViable,
        exactSamePrerequisiteConversions: repairTelemetry.exactSamePrerequisiteConversions,
        rejectedByRelevance: repairTelemetry.rejectedByRelevance,
        rejectedIntentKinds: { ...repairTelemetry.rejectedIntentKinds },
        blockedStatusesSeen: { ...repairTelemetry.blockedStatusesSeen },
        outcomeCounts: { ...repairTelemetry.outcomeCounts },
        commitmentsWithheld: repairTelemetry.commitmentsWithheld,
      },
      resourceRepairAttempts: repairTelemetry.attempts,
      resourceRepairConversions: repairTelemetry.conversions,
      finalBranchLifecycleSweep: {
        evaluatedOpenBranchCount: finalSweep.evaluated,
        advanceableBranchIds: finalSweep.advanceable.slice(),
        newlyExhaustedBranchIds: finalSweep.newlyExhausted.slice(),
      },
      // PR-5.27d Phase 1 (opt-in, observation only): when the caller asks for it,
      // expose the final evaluation of each branch - including each alternative's
      // leading-prerequisite evidence - so a probe can attribute WHY the branch is
      // blocked instead of inferring it. Omitted by default.
      finalEvaluationDump: config.includeFinalEvaluations === true
        ? finalSweep.records.map((entry) => ({
          branchId: entry.branchId,
          depth: entry.depth,
          status: entry.status,
          exhaustedReason: entry.exhaustedReason,
          floorId: entry.floorId,
          canAdvance: entry.canAdvance,
          feedbackClass: entry.feedbackClass,
          alternatives: entry.alternatives,
        }))
        : null,
      exhaustedBranchCount: branchSummary.exhaustedBranchCount,
      backtrackCount: stepRounds.filter((round) => round.backtrackedToOlderBranch === true).length,
      branchIds: branchSummary.branchIds,
    },
    branches: branchSummary.branches,
    attempts,
    terminal: {
      goal: terminalGoal,
      goalType: terminalGoal.type,
      reached: reachedTerminal,
      reachedByRound: reachedTerminal
        ? (rounds.filter((round) => round.verdict === "TERMINAL_GOAL_REACHED").slice(-1)[0] || {}).round ?? 0
        : null,
      terminalBranchId,
      terminationReason,
      terminationClass,
      finalStateFingerprint: reachedTerminal && terminalBranch
        ? terminalBranch.exactStateFingerprint
        : frontierStateKey,
      finalFloorId: reachedTerminal
        ? (terminalBranch && terminalBranch.state ? terminalBranch.state.floorId || null : null)
        : (frontierState ? frontierState.floorId || null : null),
      frontierOrigin,
    },
    route: finalizedRoute.route,
    routeProvenance: finalizedRoute.routeProvenance,
    allAcceptedCheckpointsStrictReplay: finalizedRoute.allAcceptedCheckpointsStrictReplay,
    fullRouteStrictReplay: finalizedRoute.fullRouteStrictReplay,
    acceptedCheckpoints: finalizedRoute.acceptedCheckpoints,
    rounds,
    timing: { totalWallMs: completedAt - startedAt },
    verdict: finalizedRoute.verdict,
  };
}

module.exports = {
  SCHEMA,
  buildDependencyContext,
  evaluateCheckpoint,
  evaluateBranchExperiments,
  evaluateResourceRepairTrigger,
  isBattleRelevantRepairIntent,
  prerequisiteIdentityOf,
  normalizePrerequisiteIdentity,
  collectReplannedPrerequisiteStatuses,
  runDependencyFeedback,
  runDependencyFeedbackLoop,
  summarizeAlternative,
  terminalGoalReached,
};
