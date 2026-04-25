"use strict";

const path = require("path");

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cloneSmall(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function sortedKeys(...objects) {
  return Array.from(new Set(objects.flatMap((object) => Object.keys(asObject(object))))).sort();
}

function numberDelta(preValue, postValue) {
  const before = Number(preValue || 0);
  const after = Number(postValue || 0);
  return after - before;
}

function formatTarget(target) {
  if (!target || target.x == null || target.y == null) return "";
  return `${target.floorId || ""} ${target.x},${target.y}`.trim();
}

function decisionFloor(decision) {
  return (decision.target && decision.target.floorId) || (decision.stance && decision.stance.floorId) || decision.floorId || "";
}

function buildRouteSummary(routeRecord, routeFile) {
  const startSnapshot = asObject((routeRecord.start || {}).snapshot);
  const finalSnapshot = asObject((routeRecord.final || {}).snapshot);
  const decisions = routeRecord.decisions || [];
  return {
    schema: routeRecord.schema,
    routeFile: routeFile ? path.basename(routeFile) : null,
    routePath: routeFile || null,
    createdAt: routeRecord.createdAt || null,
    source: cloneSmall(routeRecord.source || {}),
    goal: cloneSmall(routeRecord.goal || {}),
    stats: cloneSmall(routeRecord.stats || {}),
    start: {
      floorId: startSnapshot.floorId || (routeRecord.start || {}).floorId || null,
      hero: cloneSmall(startSnapshot.hero || {}),
      stateKey: (routeRecord.start || {}).stateKey || null,
    },
    final: {
      floorId: (routeRecord.final || {}).floorId || finalSnapshot.floorId || null,
      hero: cloneSmall(finalSnapshot.hero || {}),
      stateKey: (routeRecord.final || {}).stateKey || null,
    },
    decisionCount: decisions.length,
    decisions: buildDecisionRows(routeRecord),
    notes: cloneSmall(routeRecord.notes || []),
  };
}

function buildDecisionRows(routeRecord) {
  return (routeRecord.decisions || []).map((decision, offset) => {
    const preHero = asObject((decision.preSnapshot || {}).hero);
    const postHero = asObject((decision.postSnapshot || {}).hero);
    return {
      index: decision.index || offset + 1,
      kind: decision.kind || "unknown",
      summary: decision.summary || "",
      fingerprint: decision.fingerprint || "",
      floorId: decisionFloor(decision),
      target: cloneSmall(decision.target || null),
      targetLabel: formatTarget(decision.target),
      path: Array.isArray(decision.path) ? decision.path.slice() : [],
      pathLabel: Array.isArray(decision.path) ? decision.path.join(",") : "",
      pathLength: Array.isArray(decision.path) ? decision.path.length : 0,
      itemId: decision.itemId || null,
      enemyId: decision.enemyId || null,
      doorId: decision.doorId || null,
      tool: decision.tool || null,
      equipId: decision.equipId || null,
      estimate: cloneSmall(decision.estimate || {}),
      scoreBreakdown: cloneSmall(decision.scoreBreakdown || null),
      damage: decision.estimate && decision.estimate.damage != null ? decision.estimate.damage : null,
      exp: decision.estimate && decision.estimate.exp != null ? decision.estimate.exp : null,
      hpDelta: postHero.hp != null || preHero.hp != null ? numberDelta(preHero.hp, postHero.hp) : null,
      score: decision.estimate && decision.estimate.score != null ? decision.estimate.score : null,
    };
  });
}

function diffPrimitiveMap(pre, post, category) {
  const before = asObject(pre);
  const after = asObject(post);
  return sortedKeys(before, after).reduce((rows, key) => {
    const oldValue = before[key];
    const newValue = after[key];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return rows;
    rows.push({ category, key, before: oldValue == null ? null : oldValue, after: newValue == null ? null : newValue });
    return rows;
  }, []);
}

function diffHero(preSnapshot, postSnapshot) {
  const preHero = asObject((preSnapshot || {}).hero);
  const postHero = asObject((postSnapshot || {}).hero);
  const fields = ["hp", "hpmax", "mana", "manamax", "atk", "def", "mdef", "money", "exp", "lv"];
  const rows = [];
  fields.forEach((field) => {
    if (JSON.stringify(preHero[field]) !== JSON.stringify(postHero[field])) {
      rows.push({ category: "hero", key: field, before: preHero[field] == null ? null : preHero[field], after: postHero[field] == null ? null : postHero[field], delta: numberDelta(preHero[field], postHero[field]) });
    }
  });
  if (JSON.stringify(preHero.loc || null) !== JSON.stringify(postHero.loc || null)) {
    rows.push({ category: "hero", key: "loc", before: cloneSmall(preHero.loc || null), after: cloneSmall(postHero.loc || null) });
  }
  if (JSON.stringify(preHero.equipment || []) !== JSON.stringify(postHero.equipment || [])) {
    rows.push({ category: "hero", key: "equipment", before: cloneSmall(preHero.equipment || []), after: cloneSmall(postHero.equipment || []) });
  }
  return rows;
}

function diffInventory(preSnapshot, postSnapshot) {
  const rows = diffPrimitiveMap((preSnapshot || {}).inventory, (postSnapshot || {}).inventory, "inventory");
  rows.forEach((row) => { row.delta = numberDelta(row.before, row.after); });
  return rows;
}

function diffFlags(preSnapshot, postSnapshot) {
  return diffPrimitiveMap((preSnapshot || {}).flags, (postSnapshot || {}).flags, "flags");
}

function toSet(items) {
  return new Set(Array.isArray(items) ? items : []);
}

function setAdded(beforeSet, afterSet) {
  return Array.from(afterSet).filter((item) => !beforeSet.has(item)).sort();
}

function setRemoved(beforeSet, afterSet) {
  return Array.from(beforeSet).filter((item) => !afterSet.has(item)).sort();
}

function diffFloors(preSnapshot, postSnapshot) {
  const preFloors = asObject((preSnapshot || {}).floors);
  const postFloors = asObject((postSnapshot || {}).floors);
  const rows = [];
  sortedKeys(preFloors, postFloors).forEach((floorId) => {
    const before = asObject(preFloors[floorId]);
    const after = asObject(postFloors[floorId]);
    ["removed", "replaced"].forEach((field) => {
      const beforeSet = toSet(before[field]);
      const afterSet = toSet(after[field]);
      const added = setAdded(beforeSet, afterSet);
      const removed = setRemoved(beforeSet, afterSet);
      if (added.length || removed.length || beforeSet.size !== afterSet.size) {
        rows.push({
          category: "floors",
          floorId,
          key: field,
          beforeCount: beforeSet.size,
          afterCount: afterSet.size,
          delta: afterSet.size - beforeSet.size,
          added,
          removed,
        });
      }
    });
  });
  return rows;
}

function buildSnapshotDiff(preSnapshot, postSnapshot) {
  return {
    hero: diffHero(preSnapshot, postSnapshot),
    inventory: diffInventory(preSnapshot, postSnapshot),
    flags: diffFlags(preSnapshot, postSnapshot),
    floors: diffFloors(preSnapshot, postSnapshot),
  };
}

function rowKindFor(label, value) {
  const numeric = Number(value || 0);
  if (/damage|cost|hpDelta/i.test(label) && numeric < 0) return "cost";
  if (/damage|cost/i.test(label) && numeric > 0) return "cost";
  if (/exp|money|atkDelta|defDelta|mdefDelta|lvDelta|gain/i.test(label) && numeric > 0) return "gain";
  if (/removed|replaced|mutation/i.test(label)) return "mutation";
  return "neutral";
}

function pushScoreRow(rows, label, value, kind) {
  if (value == null || value === "") return;
  rows.push({ label, value, kind: kind || rowKindFor(label, value) });
}

function buildScore(decision, diff) {
  const estimate = cloneSmall(decision.estimate || {});
  const scoreBreakdown = cloneSmall(decision.scoreBreakdown || null);
  const rows = [];
  if (scoreBreakdown) {
    Object.keys(scoreBreakdown).sort().forEach((key) => pushScoreRow(rows, key, scoreBreakdown[key], rowKindFor(key, scoreBreakdown[key])));
  }
  Object.keys(estimate || {}).sort().forEach((key) => {
    const value = estimate[key];
    if (Array.isArray(value) || (value && typeof value === "object")) {
      pushScoreRow(rows, key, JSON.stringify(value), "neutral");
    } else {
      pushScoreRow(rows, key, value, rowKindFor(key, value));
    }
  });
  const heroDeltas = {};
  (diff.hero || []).forEach((row) => {
    if (row.delta != null) heroDeltas[`${row.key}Delta`] = row.delta;
  });
  ["hpDelta", "atkDelta", "defDelta", "mdefDelta", "expDelta", "lvDelta", "moneyDelta"].forEach((key) => pushScoreRow(rows, key, heroDeltas[key], rowKindFor(key, heroDeltas[key])));
  const removedTiles = (diff.floors || []).filter((row) => row.key === "removed").reduce((sum, row) => sum + Math.max(0, Number(row.delta || 0)), 0);
  const replacedTiles = (diff.floors || []).filter((row) => row.key === "replaced").reduce((sum, row) => sum + Math.max(0, Number(row.delta || 0)), 0);
  pushScoreRow(rows, "removedTiles", removedTiles || null, "mutation");
  pushScoreRow(rows, "replacedTiles", replacedTiles || null, "mutation");
  return { estimate, scoreBreakdown, displayRows: rows };
}

function buildStepDetail(routeRecord, index) {
  const stepIndex = Number(index);
  if (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > (routeRecord.decisions || []).length) {
    const error = new Error(`Step index out of range: ${index}`);
    error.statusCode = 404;
    throw error;
  }
  const decision = routeRecord.decisions[stepIndex - 1];
  const diff = buildSnapshotDiff(decision.preSnapshot || {}, decision.postSnapshot || {});
  return {
    decision: cloneSmall(decision),
    preSnapshot: cloneSmall(decision.preSnapshot || {}),
    postSnapshot: cloneSmall(decision.postSnapshot || {}),
    diff,
    score: buildScore(decision, diff),
  };
}

module.exports = {
  buildDecisionRows,
  buildRouteSummary,
  buildSnapshotDiff,
  buildStepDetail,
};
