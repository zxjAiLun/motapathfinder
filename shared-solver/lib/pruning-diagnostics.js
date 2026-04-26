"use strict";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickReasons(source, names) {
  return names.reduce((result, name) => {
    const value = number(source && source[name]);
    if (value) result[name] = value;
    return result;
  }, {});
}

function sumReasons(reasons) {
  return Object.values(reasons || {}).reduce((sum, value) => sum + number(value), 0);
}

function summarizeQuota(stats) {
  const quota = (stats || {}).quota || {};
  const byActionType = quota.byActionType || {};
  return {
    dropped: number(quota.dropped),
    byActionType,
  };
}

function summarizePruning(diagnostics) {
  const stats = diagnostics || {};
  const pruneReasons = stats.pruneReasons || {};
  const exactReasons = pickReasons(pruneReasons, ["same-state", "safe-exact-same-state"]);
  const dominanceReasons = pickReasons(pruneReasons, ["best-dominates", "bucket-dominates"]);
  const confluence = stats.confluenceDominance || {};
  const beamDropped = number((stats.frontier || {}).beamDropped) || number(pruneReasons.beamDropped);
  const quota = summarizeQuota(stats);
  const confluenceHp = {
    enabled: Boolean(confluence.enabled),
    routePolicy: confluence.routePolicy || "slack",
    rejectedByHigherHp: number(confluence.rejectedByHigherHp),
    replacedLowerHp: number(confluence.replacedLowerHp),
    ignoredRouteLengthRejects: number(confluence.ignoredRouteLengthRejects),
    ignoredRouteLengthReplacements: number(confluence.ignoredRouteLengthReplacements),
    unsafeFloorDowngrades: number(confluence.unsafeFloorDowngrades),
    nonWhitelistedFloorDowngrades: number(confluence.nonWhitelistedFloorDowngrades),
    representativesByKeyMax: number(confluence.representativesByKeyMax),
    byFloor: confluence.byFloor || {},
    examples: Array.isArray(confluence.examples) ? confluence.examples.slice(0, 8) : [],
  };
  const totalDropped =
    sumReasons(exactReasons) +
    sumReasons(dominanceReasons) +
    confluenceHp.rejectedByHigherHp +
    beamDropped +
    quota.dropped;
  return {
    exactDuplicate: {
      dropped: sumReasons(exactReasons),
      reasons: exactReasons,
    },
    dominance: {
      dropped: sumReasons(dominanceReasons),
      reasons: dominanceReasons,
    },
    confluenceHp,
    beam: {
      dropped: beamDropped,
    },
    quota,
    totalDropped,
  };
}

function summarizeConfluence(diagnostics) {
  const confluence = ((diagnostics || {}).confluenceDominance) || {};
  return {
    enabled: Boolean(confluence.enabled),
    routePolicy: confluence.routePolicy || "slack",
    rejectedByHigherHp: number(confluence.rejectedByHigherHp),
    replacedLowerHp: number(confluence.replacedLowerHp),
    unsafeFloorDowngrades: number(confluence.unsafeFloorDowngrades),
    nonWhitelistedFloorDowngrades: number(confluence.nonWhitelistedFloorDowngrades),
    representativesByKeyMax: number(confluence.representativesByKeyMax),
    byFloor: confluence.byFloor || {},
  };
}

module.exports = {
  summarizeConfluence,
  summarizePruning,
};
