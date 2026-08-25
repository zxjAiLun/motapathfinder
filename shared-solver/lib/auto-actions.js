"use strict";

const { runAutoEvents } = require("./events");
const { buildMovementHazards } = require("./movement-hazards");
const { DIRECTIONS, DIRECTION_DELTAS, coordinateKey, isDoorTile, isEnemyTile } = require("./reachability");
const { appendRouteStep, floorHasCoordinate, getTileDefinitionAt } = require("./state");

const AUTO_BATTLE_BLOCKED_SPECIALS = [
  25, 18, 85, 86, 88, 113, 114, 120, 121, 115, 116, 126, 89, 70, 67,
  141, 142, 143, 145, 146, 153, 154, 156, 157, 158, 159, 26, 81,
];

function hasSpecial(special, test) {
  if (special == null) return false;
  if (Array.isArray(special)) return special.includes(test);
  if (typeof special === "number") return special === test;
  if (typeof special === "object" && special.special != null) return hasSpecial(special.special, test);
  return false;
}

function hasAnySpecial(enemy, specials) {
  const target = enemy || {};
  return specials.some((special) => hasSpecial(target.special, special));
}

function hasHazardAt(hazards, x, y, options) {
  const key = coordinateKey(x, y);
  const flags = options || {};
  const damage = Number(hazards.damage[key] || 0);
  if (flags.damage !== false && damage > 0) return true;
  if (flags.repulse !== false && Array.isArray(hazards.repulse[key]) && hazards.repulse[key].length > 0) return true;
  if (flags.ambush !== false && Array.isArray(hazards.ambush[key]) && hazards.ambush[key].length > 0) return true;
  return false;
}

function isAutoTraverseGivenTile(floor, tile, x, y) {
  if (!floor) return false;
  if (floor.changeFloor && floor.changeFloor[coordinateKey(x, y)]) return false;
  if (tile == null) return true;
  if (isEnemyTile(tile)) return false;
  if (isDoorTile(tile)) return false;
  if (tile.cls === "items") return true;
  if (tile.trigger != null && tile.trigger !== "null" && tile.trigger !== "passNet") return false;
  return tile.canPass === true;
}

function isAutoPickupTile(tile) {
  return tile != null && tile.cls === "items" && (tile.trigger == null || tile.trigger === "getItem");
}

function isAutoBattleTile(tile) {
  return isEnemyTile(tile) && (tile.trigger == null || tile.trigger === "battle");
}

function collectTargets(project, state, options) {
  const floorId = state.floorId;
  const floor = project.floorsById[floorId];
  if (!floor) return [];

  const queue = [{ x: state.hero.loc.x, y: state.hero.loc.y, distance: 0 }];
  const visited = new Set([coordinateKey(state.hero.loc.x, state.hero.loc.y)]);
  const targets = [];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];

    for (let i = 0; i < DIRECTIONS.length; i++) {
      const delta = DIRECTION_DELTAS[DIRECTIONS[i]];
      const x = current.x + delta.x;
      const y = current.y + delta.y;
      const key = coordinateKey(x, y);
      if (visited.has(key)) continue;
      if (!floorHasCoordinate(project, floorId, x, y)) continue;

      const tile = getTileDefinitionAt(project, state, floorId, x, y);
      const target = options.evaluateTarget(project, state, tile, x, y);
      if (target) {
        targets.push({
          ...target,
          x,
          y,
          distance: current.distance + 1,
          approach: DIRECTIONS[i],
        });
        if (target.continuePast === true) {
          visited.add(key);
          queue.push({ x, y, distance: current.distance + 1 });
        }
        continue;
      }

      if (!isAutoTraverseGivenTile(floor, tile, x, y)) continue;
      if (typeof options.canTraverse === "function" && !options.canTraverse(project, state, tile, x, y)) continue;
      visited.add(key);
      queue.push({ x, y, distance: current.distance + 1 });
    }
  }

  return targets;
}

function collectNearTargets(project, state, options) {
  const floorId = state.floorId;
  const targets = [];
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const delta = DIRECTION_DELTAS[DIRECTIONS[i]];
    const x = state.hero.loc.x + delta.x;
    const y = state.hero.loc.y + delta.y;
    if (!floorHasCoordinate(project, floorId, x, y)) continue;
    const tile = getTileDefinitionAt(project, state, floorId, x, y);
    const target = options.evaluateTarget(project, state, tile, x, y);
    if (!target) continue;
    targets.push({
      ...target,
      x,
      y,
      distance: 1,
      approach: DIRECTIONS[i],
    });
  }
  return targets;
}

class AutoActionResolver {
  constructor(options) {
    const config = options || {};
    this.autoPickupEnabled = config.autoPickupEnabled !== false;
    this.autoBattleEnabled = config.autoBattleEnabled !== false;
    this.enableFastRejectSkip = config.enableFastRejectSkip === true;
    this.repeatUntilStable = config.repeatUntilStable === true;
    this.maxPasses = Number(config.maxPasses || 256);
  }

  initializeFlags(state) {
    state.flags.shiqu = this.autoPickupEnabled ? 1 : 0;
    state.flags.autoBattle = this.autoBattleEnabled ? 1 : 0;
  }

  canAutoPickup(state) {
    return this.autoPickupEnabled && Number(state.flags.shiqu == null ? 1 : state.flags.shiqu) !== 0;
  }

  canAutoBattle(state) {
    return this.autoBattleEnabled && Number(state.flags.autoBattle == null ? 1 : state.flags.autoBattle) !== 0;
  }

  buildHazards(project, state, battleResolver, perfTracker, reason) {
    if (perfTracker && typeof perfTracker.increment === "function") {
      perfTracker.increment("hazardBuildCalls", 1);
      if (reason) {
        perfTracker.increment(reason, 1);
      }
    }
    if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
      return perfTracker.timeStabilizationSubphase("hazardBuild", () => buildMovementHazards(project, state, {
        floorId: state.floorId,
        battleResolver,
      }));
    }
    return buildMovementHazards(project, state, {
      floorId: state.floorId,
      battleResolver,
    });
  }

  evaluateAutoBattleTarget(project, state, battleResolver, hazards, tile, x, y, perfTracker, isReverification) {
    if (!isAutoBattleTile(tile)) return null;
    const enemy = project.enemysById[tile.id];
    if (!enemy) return null;

    const prefix = isReverification ? "reverify" : "scan";

    if (perfTracker && typeof perfTracker.increment === "function") {
      perfTracker.increment("battleCandidateChecks", 1);
      perfTracker.increment(`${prefix}BattleCandidateChecks`, 1);
      if (isReverification) {
        perfTracker.increment("battleReverificationCalls", 1);
      }
    }

    if (hasAnySpecial(enemy, AUTO_BATTLE_BLOCKED_SPECIALS)) {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("battleRejectedBlockedSpecial", 1);
        perfTracker.increment(`${prefix}BattleRejectedBlockedSpecial`, 1);
        if (isReverification) perfTracker.increment("battleReverificationRejected", 1);
      }
      return null;
    }
    if (!battleResolver || typeof battleResolver.evaluateBattle !== "function") {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("battleRejectedNoResolver", 1);
        perfTracker.increment(`${prefix}BattleRejectedNoResolver`, 1);
        if (isReverification) perfTracker.increment("battleReverificationRejected", 1);
      }
      return null;
    }

    // PR-5.22e Production Safe Fast-Reject Bypass (strictly scan-only; reverify remains 100% authoritative)
    if (!isReverification && this.enableFastRejectSkip && battleResolver && typeof battleResolver.classifyAutoBattleFastReject === "function") {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("scanFastRejectChecks", 1);
      }

      let fastVerdict = null;
      if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
        fastVerdict = perfTracker.timeStabilizationSubphase("fastRejectPredicate", () => (
          battleResolver.classifyAutoBattleFastReject(state, state.floorId, x, y, tile.id)
        ));
      } else {
        fastVerdict = battleResolver.classifyAutoBattleFastReject(state, state.floorId, x, y, tile.id);
      }

      if (fastVerdict === "definitelyReject") {
        if (perfTracker && typeof perfTracker.increment === "function") {
          perfTracker.increment("scanFastRejectDefinitelyReject", 1);
          perfTracker.increment("scanFastRejectSkipped", 1);
          perfTracker.increment("scanBattleRejectedFastReject", 1);
          perfTracker.increment("battleRejectedFastReject", 1);
        }
        return null;
      }

      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("scanFastRejectUnknown", 1);
      }
    }

    // Shadow probe: active only when production skip is OFF and perfTracker is profiling
    let shadowVerdict = null;
    if (!isReverification && !this.enableFastRejectSkip && perfTracker && typeof perfTracker.increment === "function") {
      perfTracker.increment("scanShadowChecks", 1);
      perfTracker.increment("shadowChecks", 1);
      const runPredicate = () => {
        if (battleResolver && typeof battleResolver.classifyAutoBattleFastReject === "function") {
          return battleResolver.classifyAutoBattleFastReject(state, state.floorId, x, y, tile.id);
        }
        return "unknown";
      };

      if (typeof perfTracker.timeStabilizationSubphase === "function") {
        shadowVerdict = perfTracker.timeStabilizationSubphase("shadowPredicate", runPredicate);
      } else {
        shadowVerdict = runPredicate();
      }

      if (shadowVerdict === "definitelyReject") {
        perfTracker.increment("scanShadowDefinitelyReject", 1);
        perfTracker.increment("shadowDefinitelyReject", 1);
      } else {
        perfTracker.increment("scanShadowUnknown", 1);
        perfTracker.increment("shadowUnknown", 1);
      }
    }

    // Authoritative evaluateBattle call: counter increment strictly placed at the actual call site
    if (perfTracker && typeof perfTracker.increment === "function") {
      perfTracker.increment("battleResolverEvaluateCalls", 1);
      perfTracker.increment(`${prefix}BattleResolverEvaluateCalls`, 1);
    }

    const evalPhaseName = isReverification ? "reverifyBattleEvaluation" : "scanBattleEvaluation";
    let battle;
    if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
      battle = perfTracker.timeStabilizationSubphase(evalPhaseName, () => battleResolver.evaluateBattle(state, state.floorId, x, y, tile.id));
    } else {
      battle = battleResolver.evaluateBattle(state, state.floorId, x, y, tile.id);
    }

    const isAcceptedZeroDamage = Boolean(battle && battle.supported && battle.damageInfo && Number(battle.damageInfo.damage || 0) === 0);

    if (!isReverification && shadowVerdict != null && perfTracker && typeof perfTracker.increment === "function") {
      if (shadowVerdict === "definitelyReject") {
        if (isAcceptedZeroDamage) {
          perfTracker.increment("scanShadowFalseReject", 1);
          perfTracker.increment("shadowFalseReject", 1);
        } else {
          perfTracker.increment("scanShadowTrueReject", 1);
          perfTracker.increment("shadowTrueReject", 1);
          if (!battle.supported) {
            perfTracker.increment("scanShadowRejectedUnsupported", 1);
            perfTracker.increment("shadowRejectedUnsupported", 1);
          } else if (!battle.damageInfo || battle.damageInfo.damage == null) {
            perfTracker.increment("scanShadowRejectedNoDamageInfo", 1);
            perfTracker.increment("shadowRejectedNoDamageInfo", 1);
          } else if (Number(battle.damageInfo.damage || 0) !== 0) {
            perfTracker.increment("scanShadowRejectedNonZeroDamage", 1);
            perfTracker.increment("shadowRejectedNonZeroDamage", 1);
          }
        }
      } else if (shadowVerdict === "unknown") {
        if (!isAcceptedZeroDamage) {
          perfTracker.increment("scanShadowMissedReject", 1);
          perfTracker.increment("shadowMissedReject", 1);
        }
      }
    }

    if (!battle.supported) {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("battleRejectedUnsupported", 1);
        perfTracker.increment(`${prefix}BattleRejectedUnsupported`, 1);
        if (isReverification) perfTracker.increment("battleReverificationRejected", 1);
      }
      return null;
    }
    if (!battle.damageInfo || battle.damageInfo.damage == null) {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("battleRejectedNoDamageInfo", 1);
        perfTracker.increment(`${prefix}BattleRejectedNoDamageInfo`, 1);
        if (isReverification) perfTracker.increment("battleReverificationRejected", 1);
      }
      return null;
    }
    if (Number(battle.damageInfo.damage || 0) !== 0) {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("battleRejectedNonZeroDamage", 1);
        perfTracker.increment(`${prefix}BattleRejectedNonZeroDamage`, 1);
        if (isReverification) perfTracker.increment("battleReverificationRejected", 1);
      }
      return null;
    }

    if (perfTracker && typeof perfTracker.increment === "function") {
      perfTracker.increment("battleAcceptedZeroDamage", 1);
      perfTracker.increment(`${prefix}BattleAcceptedZeroDamage`, 1);
    }

    return {
      enemyId: tile.id,
      continuePast: !hasHazardAt(hazards, x, y, { damage: true, repulse: true, ambush: true }),
    };
  }

  collectAutoPickupTargets(project, state, battleResolver, perfTracker, existingHazards) {
    let hazards;
    if (existingHazards) {
      hazards = existingHazards;
      if (perfTracker && typeof perfTracker.increment === "function") perfTracker.increment("hazardReuses", 1);
    } else {
      hazards = this.buildHazards(project, state, battleResolver, perfTracker);
    }
    if (hasHazardAt(hazards, state.hero.loc.x, state.hero.loc.y, { damage: true, repulse: true, ambush: true })) {
      return { targets: [], hazards };
    }

    const runCollect = () => collectTargets(project, state, {
      evaluateTarget: (_, __, tile, x, y) => {
        if (!isAutoPickupTile(tile)) return null;
        return {
          itemId: tile.id,
          continuePast: !hasHazardAt(hazards, x, y, { damage: true, repulse: false, ambush: true }),
        };
      },
      canTraverse: (_, __, ___, x, y) => !hasHazardAt(hazards, x, y, { damage: true, repulse: true, ambush: true }),
    });

    const targets = (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function")
      ? perfTracker.timeStabilizationSubphase("pickupScan", runCollect)
      : runCollect();

    return { targets, hazards };
  }

  collectAutoBattleTargets(project, state, battleResolver, perfTracker, existingHazards) {
    let hazards;
    if (existingHazards) {
      hazards = existingHazards;
      if (perfTracker && typeof perfTracker.increment === "function") perfTracker.increment("hazardReuses", 1);
    } else {
      hazards = this.buildHazards(project, state, battleResolver, perfTracker);
    }
    const nearOnly = hasHazardAt(hazards, state.hero.loc.x, state.hero.loc.y, { damage: true, repulse: true, ambush: true });
    const collector = nearOnly ? collectNearTargets : collectTargets;

    const runCollect = () => {
      const traversalStarted = (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function")
        ? Date.now()
        : 0;
      const res = collector(project, state, {
        evaluateTarget: (currentProject, currentState, tile, x, y) =>
          this.evaluateAutoBattleTarget(currentProject, currentState, battleResolver, hazards, tile, x, y, perfTracker, false),
        canTraverse: (_, __, ___, x, y) => !hasHazardAt(hazards, x, y, { damage: true, repulse: true, ambush: true }),
      });
      return res;
    };

    let targets;
    if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
      const beforeScan = performance.now();
      targets = perfTracker.timeStabilizationSubphase("battleScan", runCollect);
      const scanElapsed = performance.now() - beforeScan;
      // battleTraversal is total battleScan minus battleEvaluation
      // recordStabilizationSubphase for battleTraversal is handled by subtraction in perf.js snapshot
    } else {
      targets = runCollect();
    }

    return { targets, hazards };
  }

  runAutoPickupPass(context, existingHazards) {
    const { project, state, battleResolver, resolvePickupAt, choiceResolver, perfTracker } = context;
    if (!this.canAutoPickup(state)) return { changed: false, hazards: existingHazards || null };

    const { targets, hazards } = this.collectAutoPickupTargets(project, state, battleResolver, perfTracker, existingHazards);
    if (targets.length === 0) return { changed: false, hazards };

    let changed = false;
    for (const target of targets) {
      if (state.floorId == null || state.hero.hp <= 0) break;
      const tile = getTileDefinitionAt(project, state, state.floorId, target.x, target.y);
      if (!isAutoPickupTile(tile)) continue;
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("pickupApplyCalls", 1);
      }
      if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
        perfTracker.timeStabilizationSubphase("applyStep", () => {
          perfTracker.timeStabilizationSubphase("pickupApply", () => resolvePickupAt(state, target.x, target.y));
        });
      } else {
        resolvePickupAt(state, target.x, target.y);
      }
      appendRouteStep(state, `auto:pickup:${tile.id}@${state.floorId}:${target.x},${target.y}`, {
        decision: false,
        auto: "pickup",
      });
      if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
        perfTracker.timeStabilizationSubphase("autoEvent", () => runAutoEvents(project, state, { choiceResolver }));
      } else {
        runAutoEvents(project, state, { choiceResolver });
      }
      changed = true;
    }
    if (changed && perfTracker && typeof perfTracker.increment === "function") {
      perfTracker.increment("hazardInvalidationsAfterPickup", 1);
    }
    return { changed, hazards: changed ? null : hazards };
  }

  runAutoBattlePass(context, existingHazards) {
    const { project, state, battleResolver, executeActionList, choiceResolver, perfTracker } = context;
    if (!this.canAutoBattle(state)) return false;
    if (!battleResolver || typeof battleResolver.applyBattleAt !== "function") return false;

    let { targets, hazards } = this.collectAutoBattleTargets(project, state, battleResolver, perfTracker, existingHazards);
    if (targets.length === 0) return false;

    let changed = false;
    let mutatedSinceHazardBuild = false;

    for (const target of targets) {
      if (state.floorId == null || state.hero.hp <= 0) break;
      const tile = getTileDefinitionAt(project, state, state.floorId, target.x, target.y);
      if (!isAutoBattleTile(tile)) continue;

      if (changed) {
        if (!mutatedSinceHazardBuild && perfTracker && typeof perfTracker.increment === "function") {
          perfTracker.increment("hazardRebuildWithoutInterveningMutation", 1);
        }
        hazards = this.buildHazards(project, state, battleResolver, perfTracker, "hazardRebuildForBattleReverify");
        mutatedSinceHazardBuild = false;
        const verified = this.evaluateAutoBattleTarget(project, state, battleResolver, hazards, tile, target.x, target.y, perfTracker, true);
        if (!verified) continue;
      }

      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("battleApplyCalls", 1);
      }
      if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
        perfTracker.timeStabilizationSubphase("applyStep", () => {
          perfTracker.timeStabilizationSubphase("battleApply", () => {
            battleResolver.applyBattleAt({
              project,
              state,
              floorId: state.floorId,
              x: target.x,
              y: target.y,
              enemyId: tile.id,
              executeActionList,
              choiceResolver,
            });
          });
        });
      } else {
        battleResolver.applyBattleAt({
          project,
          state,
          floorId: state.floorId,
          x: target.x,
          y: target.y,
          enemyId: tile.id,
          executeActionList,
          choiceResolver,
        });
      }
      appendRouteStep(state, `auto:battle:${tile.id}@${state.floorId}:${target.x},${target.y}`, {
        decision: false,
        auto: "battle",
      });
      if (perfTracker && typeof perfTracker.timeStabilizationSubphase === "function") {
        perfTracker.timeStabilizationSubphase("autoEvent", () => runAutoEvents(project, state, { choiceResolver }));
      } else {
        runAutoEvents(project, state, { choiceResolver });
      }
      changed = true;
      mutatedSinceHazardBuild = true;
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("hazardInvalidationsAfterBattle", 1);
      }
    }
    return changed;
  }

  stabilizeState(context) {
    const { state, perfTracker } = context;
    if (!this.repeatUntilStable) {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("stabilizationPasses", 1);
      }
      const pickupResult = this.runAutoPickupPass(context, null);
      if (state.floorId == null || state.hero.hp <= 0) return state;
      this.runAutoBattlePass(context, pickupResult ? pickupResult.hazards : null);
      return state;
    }

    let passes = 0;
    while (passes < this.maxPasses) {
      if (perfTracker && typeof perfTracker.increment === "function") {
        perfTracker.increment("stabilizationPasses", 1);
      }
      let changed = false;
      const pickupResult = this.runAutoPickupPass(context, null);
      changed = (pickupResult && pickupResult.changed) || changed;
      if (state.floorId == null || state.hero.hp <= 0) return state;

      const reusableHazards = (pickupResult && !pickupResult.changed) ? pickupResult.hazards : null;
      const battleChanged = this.runAutoBattlePass(context, reusableHazards);
      changed = battleChanged || changed;
      if (!changed) return state;
      passes += 1;
    }
    state.notes.push(`Auto action pass limit (${this.maxPasses}) reached at ${state.floorId}.`);
    return state;
  }
}

module.exports = {
  AUTO_BATTLE_BLOCKED_SPECIALS,
  AutoActionResolver,
};
