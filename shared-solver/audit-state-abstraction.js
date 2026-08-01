"use strict";

/**
 * PR-4.5a — State Abstraction Audit
 *
 * This is deliberately shadow-only. It reads the PR-4.4j/j2 artifacts,
 * replays the candidate-6/candidate-7 suffix, and compares the action and
 * successor relations exposed by the current primitive simulator. It does
 * not change any production key, dominance rule, agenda, capacity, or
 * default policy.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { FunctionBackedBattleResolver } = require("./lib/battle-resolver");
const { loadProject } = require("./lib/project-loader");
const { StaticSimulator } = require("./lib/simulator");
const { buildDominanceKey, buildStateKey } = require("./lib/state-key");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROJECT_ROOT = path.resolve(ROOT, "Only upV2.1", "Only upV2.1");
const DEFAULT_SOURCE_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j.json",
);
const DEFAULT_ANCESTRY_REPORT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "mt2-candidate2-capacity10-j2.json",
);
const DEFAULT_OUT = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5a-state-abstraction-audit.json",
);
const DEFAULT_OUT_MD = path.resolve(
  __dirname,
  "routes",
  "generated",
  "agenda-policy-evaluation",
  "pr-4.5a-state-abstraction-audit.md",
);

const CANDIDATE_IDS = {
  left: "mt2-local-3582:candidate-6",
  right: "mt2-local-3582:candidate-7",
};
const DECISION_START = 14;
const DECISION_END = 20;
const DIRECTIONAL_STATE_ITEMS = ["pickaxe", "bomb"];
const NOOP_EVENT_TYPES = new Set([
  "showStatusBar",
  "hideStatusBar",
  "setText",
  "text",
  "comment",
  "sleep",
  "wait",
  "function",
]);
const STATE_EFFECT_EVENT_TYPES = new Set([
  "setValue",
  "openDoor",
  "hide",
  "setBlock",
  "changeFloor",
  "win",
]);

function parseArgs(argv) {
  return argv.reduce((result, token) => {
    const match = /^--([^=]+)=(.*)$/.exec(token);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function gitCommit() {
  try {
    return require("node:child_process")
      .execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" })
      .trim();
  } catch (error) {
    return null;
  }
}

function makeSimulator(project) {
  return new StaticSimulator(project, {
    stopFloorId: "MT6",
    battleResolver: new FunctionBackedBattleResolver(project),
    autoPickupEnabled: true,
    autoBattleEnabled: true,
    enableFightToLevelUp: false,
    enableResourcePocket: false,
    enableResourceCluster: false,
    enableResourceChain: false,
    searchGraphMode: "primitive",
  });
}

function getLocalCheckpointReport(report) {
  const result = report && report.candidate2NaturalRun && report.candidate2NaturalRun.search &&
    report.candidate2NaturalRun.search.checkpointResults;
  return (result || []).find((entry) => entry.segmentId === "mt2-local-3582") || null;
}

function getHpCheckpointReport(report) {
  const result = report && report.candidate2NaturalRun && report.candidate2NaturalRun.search &&
    report.candidate2NaturalRun.search.checkpointResults;
  return (result || []).find((entry) => entry.segmentId === "mt2-hp3834") || null;
}

function getCandidate(report, id) {
  const local = getLocalCheckpointReport(report);
  return local && (local.candidates || []).find((candidate) => candidate.id === id) || null;
}

function safeStateKey(state) {
  try {
    return buildStateKey(state);
  } catch (error) {
    return null;
  }
}

function parseStateKey(key) {
  try {
    return JSON.parse(key);
  } catch (error) {
    return null;
  }
}

function shadowCanonicalProjection(state) {
  const exact = parseStateKey(safeStateKey(state)) || {};
  const currentFloor = exact.floorId;
  return {
    policy: "current-floor-mutation-only-v1-shadow",
    key: {
      ...exact,
      mutations: (exact.mutations || []).filter((entry) => entry.floorId === currentFloor),
    },
  };
}

function shadowProjectionKey(state) {
  return canonicalJson(shadowCanonicalProjection(state).key);
}

function mutationSignature(state) {
  return canonicalJson((state && state.floorStates) || {});
}

function actionSignature(simulator, action) {
  const fingerprint = typeof simulator.getActionFingerprint === "function"
    ? simulator.getActionFingerprint(action)
    : action.fingerprint || action.summary || action.kind || "unknown";
  return canonicalJson({
    fingerprint,
    kind: action.kind || null,
    summary: action.summary || null,
    path: Array.isArray(action.path) ? action.path : action.path || null,
    stance: action.stance || null,
    target: action.target || null,
    direction: action.direction || null,
    tool: action.tool || null,
    itemId: action.itemId || null,
    equipId: action.equipId || null,
    targetFloorId: action.targetFloorId || null,
    changeFloor: action.changeFloor || null,
  });
}

function displayAction(action) {
  return {
    fingerprint: action.fingerprint || null,
    kind: action.kind || null,
    summary: action.summary || null,
    target: action.target || null,
    stance: action.stance || null,
    direction: action.direction || null,
    pathLength: Array.isArray(action.path) ? action.path.length : null,
  };
}

function enumeratePrimitiveActions(simulator, state) {
  try {
    const result = simulator.enumeratePrimitiveActions(state) || {};
    const actions = (result.actions || []).filter(Boolean);
    return {
      actions,
      errors: [],
    };
  } catch (error) {
    return {
      actions: [],
      errors: [{ message: error.message || String(error), name: error.name || "Error" }],
    };
  }
}

function applyActionSuccessors(simulator, state, action) {
  try {
    const applied = simulator.applyAction(state, action, { storeRoute: false });
    const successors = Array.isArray(applied) ? applied : [applied];
    return {
      successors: successors.filter(Boolean),
      errors: [],
    };
  } catch (error) {
    return {
      successors: [],
      errors: [{ message: error.message || String(error), name: error.name || "Error" }],
    };
  }
}

function describeActionSet(simulator, state, successorCache) {
  const enumeration = enumeratePrimitiveActions(simulator, state);
  const actions = [];
  const byId = new Map();
  const actionErrors = [];
  for (const action of enumeration.actions) {
    const id = actionSignature(simulator, action);
    if (byId.has(id)) continue;
    byId.set(id, action);
    const cacheKey = `${safeStateKey(state)}|${id}`;
    let applied = successorCache.get(cacheKey);
    if (!applied) {
      applied = applyActionSuccessors(simulator, state, action);
      successorCache.set(cacheKey, applied);
    }
    const exactSuccessors = applied.successors.map(safeStateKey).filter(Boolean).sort();
    const projectedSuccessors = applied.successors.map(shadowProjectionKey).sort();
    if (applied.errors.length > 0) {
      actionErrors.push({ id, action: displayAction(action), errors: applied.errors });
    }
    actions.push({
      id,
      action: displayAction(action),
      exactSuccessors,
      projectedSuccessors,
    });
  }
  actions.sort((left, right) => left.id.localeCompare(right.id));
  return {
    actionCount: actions.length,
    actions,
    actionIds: actions.map((entry) => entry.id),
    enumerationErrors: enumeration.errors,
    actionErrors,
  };
}

function compareActionSets(left, right) {
  const leftMap = new Map((left.actions || []).map((entry) => [entry.id, entry]));
  const rightMap = new Map((right.actions || []).map((entry) => [entry.id, entry]));
  const leftOnly = Array.from(leftMap.keys()).filter((id) => !rightMap.has(id)).sort();
  const rightOnly = Array.from(rightMap.keys()).filter((id) => !leftMap.has(id)).sort();
  const common = Array.from(leftMap.keys()).filter((id) => rightMap.has(id)).sort();
  const successorMismatches = [];
  common.forEach((id) => {
    const a = leftMap.get(id);
    const b = rightMap.get(id);
    const exactEqual = canonicalJson(a.exactSuccessors) === canonicalJson(b.exactSuccessors);
    const projectedEqual = canonicalJson(a.projectedSuccessors) === canonicalJson(b.projectedSuccessors);
    if (!exactEqual || !projectedEqual) {
      successorMismatches.push({
        id,
        exactEqual,
        projectedEqual,
        leftExactSuccessors: a.exactSuccessors,
        rightExactSuccessors: b.exactSuccessors,
        leftProjectedSuccessors: a.projectedSuccessors,
        rightProjectedSuccessors: b.projectedSuccessors,
      });
    }
  });
  const leftSuccessors = Array.from(new Set(left.actions.flatMap((entry) => entry.exactSuccessors))).sort();
  const rightSuccessors = Array.from(new Set(right.actions.flatMap((entry) => entry.exactSuccessors))).sort();
  const leftProjectedSuccessors = Array.from(new Set(left.actions.flatMap((entry) => entry.projectedSuccessors))).sort();
  const rightProjectedSuccessors = Array.from(new Set(right.actions.flatMap((entry) => entry.projectedSuccessors))).sort();
  return {
    actionSetEquivalent: leftOnly.length === 0 && rightOnly.length === 0,
    leftOnlyActionCount: leftOnly.length,
    rightOnlyActionCount: rightOnly.length,
    leftOnlyActions: leftOnly.slice(0, 20),
    rightOnlyActions: rightOnly.slice(0, 20),
    commonActionCount: common.length,
    exactSuccessorSetEquivalent: canonicalJson(leftSuccessors) === canonicalJson(rightSuccessors),
    projectedSuccessorSetEquivalent: canonicalJson(leftProjectedSuccessors) === canonicalJson(rightProjectedSuccessors),
    exactSuccessorCount: { left: leftSuccessors.length, right: rightSuccessors.length },
    projectedSuccessorCount: { left: leftProjectedSuccessors.length, right: rightProjectedSuccessors.length },
    successorMismatches: successorMismatches.slice(0, 20),
    successorMismatchCount: successorMismatches.length,
  };
}

function resolveSuffixAction(simulator, state, routeEntry) {
  const enumeration = enumeratePrimitiveActions(simulator, state);
  const expectedFingerprint = routeEntry.fingerprint || null;
  const expectedSummary = routeEntry.summary || null;
  const matches = enumeration.actions.filter((action) => {
    const fingerprint = simulator.getActionFingerprint(action);
    return (expectedFingerprint && fingerprint === expectedFingerprint) ||
      (!expectedFingerprint && expectedSummary && action.summary === expectedSummary);
  });
  if (matches.length === 1) return { action: matches[0], errors: enumeration.errors };
  if (matches.length > 1 && expectedSummary) {
    const summaryMatches = matches.filter((action) => action.summary === expectedSummary);
    if (summaryMatches.length === 1) return { action: summaryMatches[0], errors: enumeration.errors };
  }
  return {
    action: null,
    errors: enumeration.errors.concat({
      message: matches.length === 0 ? "recorded suffix action not visible" : "recorded suffix action ambiguous",
      routeEntry: displayAction(routeEntry),
      matchCount: matches.length,
    }),
  };
}

function replayDecisionWindow(simulator, candidate, suffixRoute, startDecision, endDecision) {
  const states = new Map([[startDecision, candidate.state]]);
  const actions = [];
  const errors = [];
  let state = candidate.state;
  for (let decision = startDecision + 1; decision <= endDecision; decision += 1) {
    const routeIndex = decision - 2;
    const routeEntry = suffixRoute[routeIndex];
    if (!routeEntry) {
      errors.push({ decision, message: `missing route entry at route index ${routeIndex}` });
      break;
    }
    const resolved = resolveSuffixAction(simulator, state, routeEntry);
    if (!resolved.action) {
      errors.push({ decision, errors: resolved.errors });
      break;
    }
    const applied = applyActionSuccessors(simulator, state, resolved.action);
    if (applied.errors.length > 0 || applied.successors.length !== 1) {
      errors.push({ decision, errors: applied.errors, successorCount: applied.successors.length });
      break;
    }
    state = applied.successors[0];
    states.set(decision, state);
    actions.push({
      decision,
      routeIndex,
      fingerprint: simulator.getActionFingerprint(resolved.action),
      summary: resolved.action.summary || null,
    });
  }
  return { states, actions, errors };
}

function flatten(value, prefix, result) {
  const output = result || {};
  if (Array.isArray(value)) {
    output[prefix] = value;
    return output;
  }
  if (!value || typeof value !== "object") {
    output[prefix] = value;
    return output;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) output[prefix] = value;
  keys.forEach((key) => flatten(value[key], prefix ? `${prefix}.${key}` : key, output));
  return output;
}

function omitPath(value, pathParts) {
  if (pathParts.length === 0) return undefined;
  if (!value || typeof value !== "object") return value;
  const [head, ...tail] = pathParts;
  if (!(head in value)) return value;
  const clone = Array.isArray(value) ? value.slice() : { ...value };
  if (tail.length === 0) {
    if (Array.isArray(clone)) clone.splice(Number(head), 1);
    else delete clone[head];
  } else {
    clone[head] = omitPath(clone[head], tail);
  }
  return clone;
}

function keyFieldStats(states) {
  const records = states.map((record) => ({
    label: record.label,
    decision: record.decision,
    key: parseStateKey(record.exactKey) || {},
  }));
  const exactGroups = new Set(records.map((record) => canonicalJson(record.key))).size;
  const topLevelFields = ["floorId", "progressSig", "hero", "inventory", "flags", "visitedFloors", "mutations"];
  const buildStat = (field, pathParts) => {
    const values = records.map((record) => {
      const value = pathParts.length === 1 ? record.key[pathParts[0]] : pathParts.reduce((current, part) => current == null ? undefined : current[part], record.key);
      return canonicalJson(value);
    });
    const withoutValues = records.map((record) => {
      const omitted = pathParts.length === 1
        ? omitPath(record.key, pathParts)
        : omitPath(record.key, pathParts);
      return canonicalJson(omitted);
    });
    const distinctValues = new Set(values).size;
    const groupsWithoutField = new Set(withoutValues).size;
    let changedPairCount = 0;
    let exclusiveSplitPairCount = 0;
    for (let left = 0; left < records.length; left += 1) {
      for (let right = left + 1; right < records.length; right += 1) {
        if (values[left] === values[right]) continue;
        changedPairCount += 1;
        if (withoutValues[left] === withoutValues[right]) exclusiveSplitPairCount += 1;
      }
    }
    return {
      field,
      distinctValues,
      groupsWithoutField,
      collisionGainIfOmitted: exactGroups - groupsWithoutField,
      changedPairCount,
      exclusiveSplitPairCount,
    };
  };

  const stats = topLevelFields.map((field) => buildStat(field, [field]));
  const nestedPaths = new Set();
  records.forEach((record) => {
    Object.keys(flatten(record.key.hero || {}, "hero", {})).forEach((field) => nestedPaths.add(field));
    Object.keys(flatten(record.key.inventory || {}, "inventory", {})).forEach((field) => nestedPaths.add(field));
    Object.keys(flatten(record.key.flags || {}, "flags", {})).forEach((field) => nestedPaths.add(field));
    (record.key.mutations || []).forEach((mutation) => {
      nestedPaths.add(`mutations.${mutation.floorId}`);
    });
  });
  const nested = Array.from(nestedPaths)
    .sort()
    .map((field) => buildStat(field, field.split(".")))
    .filter((stat) => stat.changedPairCount > 0 || stat.collisionGainIfOmitted > 0);
  return {
    sampleStateCount: records.length,
    exactUniqueStateCount: exactGroups,
    topLevel: stats,
    nestedNonZero: nested,
  };
}

function collectTypes(value, result) {
  const types = result || new Set();
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTypes(entry, types));
  } else if (value && typeof value === "object") {
    if (value.type) types.add(value.type);
    Object.values(value).forEach((entry) => collectTypes(entry, types));
  }
  return types;
}

function collectDirectionRefs(value, location, result, limit) {
  const output = result || [];
  const max = limit || 40;
  if (output.length >= max) return output;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectDirectionRefs(entry, `${location}[${index}]`, output, max));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  Object.keys(value).forEach((key) => {
    if (output.length >= max) return;
    const nextLocation = `${location}.${key}`;
    if (key.toLowerCase().includes("direction")) output.push(nextLocation);
    collectDirectionRefs(value[key], nextLocation, output, max);
  });
  return output;
}

function collectAutoEventRegistry(project) {
  const events = [];
  Object.entries(project.floorsById || {}).forEach(([floorId, floor]) => {
    Object.entries(floor.autoEvent || {}).forEach(([locKey, entries]) => {
      Object.entries(entries || {}).forEach(([index, event]) => {
        if (!event || event.multiExecute) return;
        const types = Array.from(collectTypes(event.data || [])).sort();
        const effectTypes = types.filter((type) => STATE_EFFECT_EVENT_TYPES.has(type));
        const hasOpaqueBranch = types.includes("if") || types.includes("choices") || types.includes("function");
        events.push({
          uniqueKey: `${floorId}:${locKey}:${index}`,
          floorId,
          locKey,
          index,
          condition: event.condition || null,
          actionTypes: types,
          stateEffectTypes: effectTypes,
          observableStateEffect: effectTypes.length > 0,
          opaqueBranch: hasOpaqueBranch,
        });
      });
    });
  });
  return events;
}

function auditTriggeredAutoEvents(project, states) {
  const byExactKey = new Map();
  states.forEach((record) => {
    const signature = canonicalJson(record.state.triggeredAutoEvents || {});
    const key = record.exactKey;
    if (!byExactKey.has(key)) byExactKey.set(key, new Map());
    const signatures = byExactKey.get(key);
    if (!signatures.has(signature)) signatures.set(signature, []);
    signatures.get(signature).push(record.label);
  });
  const conflicts = [];
  byExactKey.forEach((signatures, exactKey) => {
    if (signatures.size > 1) {
      conflicts.push({
        exactStateKeyHash: hash(exactKey),
        triggeredVariants: Array.from(signatures.entries()).map(([signature, labels]) => ({
          signature,
          labels,
        })),
      });
    }
  });
  const registry = collectAutoEventRegistry(project);
  const staticRiskEvents = registry.filter((event) => !event.observableStateEffect);
  const nonEmptyStates = states.filter((record) => Object.keys(record.state.triggeredAutoEvents || {}).length > 0);
  let classification = "corpus-consistent-but-unproven";
  if (conflicts.length > 0) classification = "non-derivable-witness";
  else if (staticRiskEvents.length > 0) classification = "static-non-observable-risk";
  return {
    classification,
    corpus: {
      stateCount: states.length,
      nonEmptyTriggeredStateCount: nonEmptyStates.length,
      observedTriggeredEventKeys: Array.from(new Set(nonEmptyStates.flatMap((record) => Object.keys(record.state.triggeredAutoEvents || {})))).sort(),
      sameExactKeyDifferentTriggeredWitnessCount: conflicts.length,
      witnesses: conflicts.slice(0, 10),
    },
    static: {
      nonMultiAutoEventCount: registry.length,
      nonObservableRiskCount: staticRiskEvents.length,
      nonObservableRiskEvents: staticRiskEvents.slice(0, 30),
      registry: registry.slice(0, 100),
    },
    conclusion: conflicts.length > 0
      ? "triggeredAutoEvents is not derivable from the current exact-key fields for the observed witness."
      : "No corpus collision witness was found; static non-observable events or missing coverage still prevent a proof of derivability.",
  };
}

function buildDirectionDependencyRegistry(project) {
  const projectRefs = [];
  Object.entries(project.floorsById || {}).forEach(([floorId, floor]) => {
    projectRefs.push(...collectDirectionRefs(floor.firstArrive || [], `${floorId}.firstArrive`, [], 40));
    projectRefs.push(...collectDirectionRefs(floor.eachArrive || [], `${floorId}.eachArrive`, [], 40));
    projectRefs.push(...collectDirectionRefs(floor.autoEvent || {}, `${floorId}.autoEvent`, [], 40));
    Object.entries(floor.map || {}).forEach(([key, value]) => {
      projectRefs.push(...collectDirectionRefs(value, `${floorId}.map.${key}`, [], 40));
    });
  });
  return {
    currentStateKeyItems: DIRECTIONAL_STATE_ITEMS.slice(),
    registry: [
      {
        id: "state-key.conditional-hero-direction",
        source: "shared-solver/lib/state-key.js:31-34",
        dependency: "inventory.pickaxe > 0 OR inventory.bomb > 0 -> hero.loc.direction is retained in exact/dominance serialization",
        status: "production-keyed",
      },
      {
        id: "floor-transition.change-floor-fallback",
        source: "shared-solver/lib/floor-transitions.js:63",
        dependency: "changeFloor target direction falls back to current hero.loc.direction when changeData.direction is absent",
        status: "future-behavior",
      },
      {
        id: "simulator.floor-fly.saved-leave-location",
        source: "shared-solver/lib/simulator.js:242-260",
        dependency: "flyRecordPosition may use flags.__leaveLoc__[targetFloorId].direction; otherwise floor-fly landing falls back to current hero direction",
        status: "future-behavior",
      },
      {
        id: "simulator.action-approach-direction",
        source: "shared-solver/lib/simulator.js:2230-2237",
        dependency: "primitive action approach direction is applied before battle, door, tool, or interact-pickup effects",
        status: "action-local",
      },
    ],
    projectDirectionReferenceCount: projectRefs.length,
    projectDirectionReferences: Array.from(new Set(projectRefs)).slice(0, 40),
    conclusion: "Direction dependency is registered beyond the pickaxe/bomb heuristic; no production key expansion is proposed by this audit.",
  };
}

function buildProjectionCollisionAudit(simulator, sequences, successorCache) {
  const byDecision = [];
  for (let decision = DECISION_START; decision <= DECISION_END; decision += 1) {
    const left = sequences.left.states.get(decision);
    const right = sequences.right.states.get(decision);
    if (!left || !right) {
      byDecision.push({ decision, available: false, reason: "replay-state-missing" });
      continue;
    }
    const leftProjection = shadowProjectionKey(left);
    const rightProjection = shadowProjectionKey(right);
    if (leftProjection !== rightProjection) {
      byDecision.push({
        decision,
        available: true,
        projectedCollision: false,
        exactKeyEqual: safeStateKey(left) === safeStateKey(right),
      });
      continue;
    }
    const leftActions = describeActionSet(simulator, left, successorCache);
    const rightActions = describeActionSet(simulator, right, successorCache);
    const comparison = compareActionSets(leftActions, rightActions);
    byDecision.push({
      decision,
      available: true,
      projectedCollision: true,
      exactKeyEqual: safeStateKey(left) === safeStateKey(right),
      actionSet: comparison,
      enumeration: {
        leftErrors: leftActions.enumerationErrors,
        rightErrors: rightActions.enumerationErrors,
        leftActionErrors: leftActions.actionErrors.length,
        rightActionErrors: rightActions.actionErrors.length,
      },
    });
  }
  const collisions = byDecision.filter((entry) => entry.projectedCollision);
  return {
    projection: {
      name: "current-floor-mutation-only-v1-shadow",
      definition: "Build the existing exact state serialization, then retain only the current floor entry in mutations. This is an audit projection, never a production key.",
    },
    decisionChecks: byDecision,
    projectedCollisionCount: collisions.length,
    actionSetEquivalentAtAllCollisions: collisions.every((entry) => entry.actionSet && entry.actionSet.actionSetEquivalent),
    projectedSuccessorSetEquivalentAtAllCollisions: collisions.every((entry) => entry.actionSet && entry.actionSet.projectedSuccessorSetEquivalent),
    exactSuccessorSetEquivalentAtAllCollisions: collisions.every((entry) => entry.actionSet && entry.actionSet.exactSuccessorSetEquivalent),
  };
}

function buildMarkdown(report) {
  const checks = report.actionSuccessorAudit.decisionChecks || [];
  const fields = report.exactKeySplitContribution.topLevel || [];
  return [
    "# PR-4.5a State Abstraction Audit",
    "",
    `Status: **${report.status}**`,
    "",
    "## Scope",
    "",
    "This artifact is shadow-only. It does not modify the production DP key, dominance, agenda, capacity, or default strategy.",
    "",
    `- candidate pair: **${report.corpus.leftCandidateId}** / **${report.corpus.rightCandidateId}**`,
    `- decision window: **${DECISION_START}–${DECISION_END}**`,
    `- replay errors: **${report.replay.errors.length}**`,
    `- exact rejoin at decision 20: **${report.replay.exactRejoinAtDecision20}**`,
    "",
    "## Action / successor equivalence",
    "",
    "| Decision | Projection collision | Actions equal | Projected successors equal | Exact successors equal |",
    "|---:|---:|---:|---:|---:|",
    ...checks.map((entry) => `| ${entry.decision} | ${entry.projectedCollision === true} | ${entry.actionSet ? entry.actionSet.actionSetEquivalent : "n/a"} | ${entry.actionSet ? entry.actionSet.projectedSuccessorSetEquivalent : "n/a"} | ${entry.actionSet ? entry.actionSet.exactSuccessorSetEquivalent : "n/a"} |`),
    "",
    `Projection: **${report.actionSuccessorAudit.projection.name}** — ${report.actionSuccessorAudit.projection.definition}`,
    "",
    "## Exact-key split contribution",
    "",
    "| Field | Distinct values | Collision gain if omitted | Exclusive split pairs |",
    "|---|---:|---:|---:|",
    ...fields.map((field) => `| ${field.field} | ${field.distinctValues} | ${field.collisionGainIfOmitted} | ${field.exclusiveSplitPairCount} |`),
    "",
    `Nested non-zero fields: **${report.exactKeySplitContribution.nestedNonZero.length}**`,
    "",
    "## triggeredAutoEvents",
    "",
    `- classification: **${report.triggeredAutoEvents.classification}**`,
    `- observed non-empty state count: **${report.triggeredAutoEvents.corpus.nonEmptyTriggeredStateCount}**`,
    `- same-exact-key/different-trigger witness count: **${report.triggeredAutoEvents.corpus.sameExactKeyDifferentTriggeredWitnessCount}**`,
    `- static non-observable risk events: **${report.triggeredAutoEvents.static.nonObservableRiskCount}**`,
    `- conclusion: ${report.triggeredAutoEvents.conclusion}`,
    "",
    "## Direction dependency registry",
    "",
    `- currently keyed items: **${report.directionDependencyRegistry.currentStateKeyItems.join(", ")}**`,
    `- project direction references scanned: **${report.directionDependencyRegistry.projectDirectionReferenceCount}**`,
    ...report.directionDependencyRegistry.registry.map((entry) => `- **${entry.id}** (${entry.status}): ${entry.dependency}`),
    "",
    "## Verdict",
    "",
    `- action-set equivalent at all projection collisions: **${report.actionSuccessorAudit.actionSetEquivalentAtAllCollisions}**`,
    `- projected one-step successor equivalent at all projection collisions: **${report.actionSuccessorAudit.projectedSuccessorSetEquivalentAtAllCollisions}**`,
    `- exact one-step successor equivalent at all projection collisions: **${report.actionSuccessorAudit.exactSuccessorSetEquivalentAtAllCollisions}**`,
    `- production semantic change: **${report.scope.productionSemanticChange}**`,
    "",
    "The projection result is evidence for the audited local window only; it is not a proof that non-current-floor mutation history can be removed from a global key.",
    "",
    "## Provenance",
    "",
    "- source report: `" + report.provenance.sourceReport + "`",
    "- ancestry report: `" + report.provenance.ancestryReport + "`",
    "- generation commit: `" + report.provenance.generationCommit + "`",
  ].join("\n") + "\n";
}

function buildReport(options) {
  const config = options || {};
  const sourceReportPath = path.resolve(config.sourceReport || DEFAULT_SOURCE_REPORT);
  const ancestryReportPath = path.resolve(config.ancestryReport || DEFAULT_ANCESTRY_REPORT);
  const projectRoot = path.resolve(config.projectRoot || DEFAULT_PROJECT_ROOT);
  const sourceReport = readJson(sourceReportPath);
  const ancestryReport = readJson(ancestryReportPath);
  const project = loadProject(projectRoot);
  const simulator = makeSimulator(project);
  const leftCandidate = getCandidate(sourceReport, CANDIDATE_IDS.left);
  const rightCandidate = getCandidate(sourceReport, CANDIDATE_IDS.right);
  const hpCheckpoint = getHpCheckpointReport(sourceReport);
  const finalCandidate = hpCheckpoint && hpCheckpoint.candidates && hpCheckpoint.candidates[0];
  if (!leftCandidate || !rightCandidate || !finalCandidate) {
    throw new Error("PR-4.5a requires candidate-6, candidate-7, and the mt2-hp3834 checkpoint in the source report");
  }

  const finalRoute = finalCandidate.route || [];
  const sequences = {
    left: replayDecisionWindow(simulator, leftCandidate, finalRoute, DECISION_START, DECISION_END),
    right: replayDecisionWindow(simulator, rightCandidate, finalRoute, DECISION_START, DECISION_END),
  };
  const replayErrors = sequences.left.errors.concat(sequences.right.errors);
  const left20 = sequences.left.states.get(DECISION_END);
  const right20 = sequences.right.states.get(DECISION_END);
  const exactRejoinAtDecision20 = Boolean(left20 && right20 && safeStateKey(left20) === safeStateKey(right20));

  const stateRecords = [];
  Object.entries(sequences).forEach(([label, sequence]) => {
    sequence.states.forEach((state, decision) => {
      stateRecords.push({
        label,
        decision,
        state,
        exactKey: safeStateKey(state),
        shadowProjectionKey: shadowProjectionKey(state),
        mutationSignature: mutationSignature(state),
      });
    });
  });
  const successorCache = new Map();
  const actionSuccessorAudit = buildProjectionCollisionAudit(simulator, sequences, successorCache);
  const directionDependencyRegistry = buildDirectionDependencyRegistry(project);
  const triggeredAutoEvents = auditTriggeredAutoEvents(project, stateRecords);
  const exactKeySplitContribution = keyFieldStats(stateRecords);
  const candidateExactKeys = {
    left: safeStateKey(leftCandidate.state),
    right: safeStateKey(rightCandidate.state),
  };
  const candidateExactKeysMatchArtifact = Boolean(
    ancestryReport.ancestryComparison &&
    ancestryReport.ancestryComparison.winningBranch &&
    ancestryReport.ancestryComparison.teacherLocalBranch &&
    candidateExactKeys.left === ancestryReport.ancestryComparison.winningBranch.winningLocalExactStateKey &&
    candidateExactKeys.right === ancestryReport.ancestryComparison.teacherLocalBranch.teacherLocalExactStateKey,
  );

  return {
    schema: "motapathfinder.pr-4.5a-state-abstraction-audit.v1",
    generatedAt: new Date().toISOString(),
    status: replayErrors.length === 0 && candidateExactKeysMatchArtifact ? "completed" : "completed-with-evidence-gaps",
    scope: {
      shadowOnly: true,
      productionSemanticChange: false,
      productionChanges: [],
      productionDpKeyChanged: false,
      productionDominanceChanged: false,
      productionAgendaChanged: false,
      productionCapacityChanged: false,
      productionDefaultStrategyChanged: false,
    },
    corpus: {
      leftCandidateId: CANDIDATE_IDS.left,
      rightCandidateId: CANDIDATE_IDS.right,
      decisionStart: DECISION_START,
      decisionEnd: DECISION_END,
      sourceCandidateExactKeysMatchArtifact: candidateExactKeysMatchArtifact,
      candidateExactKeyHashes: {
        left: hash(candidateExactKeys.left),
        right: hash(candidateExactKeys.right),
      },
      stateCount: stateRecords.length,
      uniqueExactStateCount: new Set(stateRecords.map((record) => record.exactKey)).size,
      uniqueShadowProjectionCount: new Set(stateRecords.map((record) => record.shadowProjectionKey)).size,
    },
    replay: {
      exactRejoinAtDecision20,
      leftActionCount: sequences.left.actions.length,
      rightActionCount: sequences.right.actions.length,
      errors: replayErrors,
      decisionActions: {
        left: sequences.left.actions,
        right: sequences.right.actions,
      },
    },
    actionSuccessorAudit,
    exactKeySplitContribution,
    triggeredAutoEvents,
    directionDependencyRegistry,
    provenance: {
      projectRoot: relative(projectRoot),
      sourceReport: relative(sourceReportPath),
      sourceReportSha256: sha256(sourceReportPath),
      ancestryReport: relative(ancestryReportPath),
      ancestryReportSha256: sha256(ancestryReportPath),
      generationCommit: gitCommit(),
      productionStateKeyModule: "shared-solver/lib/state-key.js",
      productionStateKeySha256: sha256(path.resolve(__dirname, "lib", "state-key.js")),
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport({
    projectRoot: args["project-root"],
    sourceReport: args["source-report"],
    ancestryReport: args["ancestry-report"],
  });
  const out = path.resolve(args.out || DEFAULT_OUT);
  const outMd = path.resolve(args["out-md"] || DEFAULT_OUT_MD);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(outMd, buildMarkdown(report));
  console.log(JSON.stringify({
    status: report.status,
    out: relative(out),
    outMd: relative(outMd),
    exactRejoinAtDecision20: report.replay.exactRejoinAtDecision20,
    projectedCollisionCount: report.actionSuccessorAudit.projectedCollisionCount,
    actionSetEquivalentAtAllCollisions: report.actionSuccessorAudit.actionSetEquivalentAtAllCollisions,
    projectedSuccessorSetEquivalentAtAllCollisions: report.actionSuccessorAudit.projectedSuccessorSetEquivalentAtAllCollisions,
    triggeredAutoEvents: report.triggeredAutoEvents.classification,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildMarkdown,
  buildReport,
  shadowCanonicalProjection,
  shadowProjectionKey,
};
