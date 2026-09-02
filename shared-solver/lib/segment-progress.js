"use strict";

/**
 * PR-5.24c Iteration 2 Repair 1 – shared compact segment-progress projection.
 *
 * Pure helper: projects a solver state against a segment's goal into a
 * compact, IPC-safe record (no route, no floorStates, no raw state). Used by
 * both the local scheduler path and the isolated worker (which serializes the
 * projection across the child/parent boundary instead of full states).
 */

function compactProgressProjection(progress) {
  if (!progress) return null;
  return {
    feasible: progress.feasible === true,
    floorMatch: progress.floorMatch === true,
    completion: Number(progress.completion || 0),
    requirementsMet: Number(progress.requirementsMet || 0),
    requirementsTotal: Number(progress.requirementsTotal || 0),
    downstreamCompletion: Number(progress.downstreamCompletion || 0),
    downstreamRequirementsMet: Number(progress.downstreamRequirementsMet || 0),
    irreversibleLandmarksMet: Number(progress.irreversibleLandmarksMet || 0),
    nextLandmarkReachable: progress.nextLandmarkReachable === true,
    nextLandmarkDistance: Number.isFinite(Number(progress.nextLandmarkDistance))
      ? Number(progress.nextLandmarkDistance)
      : null,
    statDeficit: Number(progress.statDeficit || 0),
  };
}

/**
 * Weightless, fixed lexicographic comparison over compact projections.
 * Returns >0 when `after` is strictly better, 0 when equal, null when the
 * comparison is unavailable.
 */
function compareProgressProjections(before, after) {
  if (!before || !after) return null;
  const feasibleDiff = Number(after.feasible === true) - Number(before.feasible === true);
  if (feasibleDiff !== 0) return feasibleDiff;
  const floorDiff = Number(after.floorMatch === true) - Number(before.floorMatch === true);
  if (floorDiff !== 0) return floorDiff;
  const completionDiff = Number(after.completion || 0) - Number(before.completion || 0);
  if (completionDiff !== 0) return completionDiff > 0 ? 1 : -1;
  const reqDiff = Number(after.requirementsMet || 0) - Number(before.requirementsMet || 0);
  if (reqDiff !== 0) return reqDiff;
  const dsDiff = Number(after.downstreamCompletion || 0) - Number(before.downstreamCompletion || 0);
  if (dsDiff !== 0) return dsDiff > 0 ? 1 : -1;
  const lmDiff = Number(after.irreversibleLandmarksMet || 0) -
    Number(before.irreversibleLandmarksMet || 0);
  if (lmDiff !== 0) return lmDiff;
  const reachDiff = Number(after.nextLandmarkReachable === true) -
    Number(before.nextLandmarkReachable === true);
  if (reachDiff !== 0) return reachDiff;
  if (before.nextLandmarkReachable && after.nextLandmarkReachable) {
    const distDiff = Number(before.nextLandmarkDistance || 0) -
      Number(after.nextLandmarkDistance || 0);
    if (distDiff !== 0) return distDiff > 0 ? 1 : -1;
  }
  const deficitDiff = Number(before.statDeficit || 0) - Number(after.statDeficit || 0);
  if (deficitDiff !== 0) return deficitDiff > 0 ? 1 : -1;
  return 0;
}

module.exports = {
  compactProgressProjection,
  compareProgressProjections,
};
