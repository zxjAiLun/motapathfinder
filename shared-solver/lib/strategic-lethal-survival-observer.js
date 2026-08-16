"use strict";

const crypto = require("node:crypto");

const { buildStateKey } = require("./state-key");
const { analyzeBattleViabilityBlocker } = require("./strategic-battle-viability");

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * PR-5.19j observation-only observer for a lethal hierarchy child.
 *
 * It records every expanded connector state and derives battle-stage/survival
 * metrics. bestSurvivalMargin is attribution only and must never become a
 * search priority or completion predicate.
 */
function createLethalSurvivalObserver(options) {
  const config = options || {};
  const { simulator, sourceState, boundary, maxSamples } = config;
  const sourceAnalysis = analyzeBattleViabilityBlocker(simulator, sourceState, boundary);
  const sourceHero = (sourceState && sourceState.hero) || {};
  const sourceHp = number(sourceHero.hp, 0);
  const sourceAtk = number(sourceHero.atk, 0);
  const sourceDef = number(sourceHero.def, 0);
  const sourceMdef = number(sourceHero.mdef, 0);
  const sourceDamage = sourceAnalysis.damage;
  const sourceMargin = sourceAnalysis.survivalMargin;
  const observations = [];
  const stageCounts = {};
  let statesObserved = 0;
  let best = null;
  let maxHp = sourceHp;
  let minDamage = sourceDamage;
  let survivalMarginImprovedStateCount = 0;
  let damageReducedStateCount = 0;
  let hpImprovedStateCount = 0;
  let viableStateObserved = false;
  const depthHistogram = {};

  function observe(entry) {
    if (!entry || !entry.state) return;
    statesObserved += 1;
    const analysis = analyzeBattleViabilityBlocker(simulator, entry.state, boundary);
    const hero = (entry.state && entry.state.hero) || {};
    const hp = number(hero.hp, 0);
    const atk = number(hero.atk, 0);
    const def = number(hero.def, 0);
    const mdef = number(hero.mdef, 0);
    const margin = analysis.survivalMargin;
    const depth = Array.isArray(entry.chain) ? entry.chain.length : 0;
    stageCounts[analysis.stage] = number(stageCounts[analysis.stage], 0) + 1;
    depthHistogram[String(depth)] = number(depthHistogram[String(depth)], 0) + 1;
    if (margin != null) {
      if (sourceMargin == null || margin > sourceMargin) survivalMarginImprovedStateCount += 1;
      if (best == null || margin > best.margin ||
          (margin === best.margin && hp > best.hp)) {
        best = {
          margin,
          stage: analysis.stage,
          hp,
          atk,
          def,
          mdef,
          damage: analysis.damage,
          fingerprint: hash(buildStateKey(entry.state)),
          chain: (entry.chain || []).map((action) => action.summary || action.kind || "step"),
          resourceDelta: {
            hp: hp - sourceHp,
            atk: atk - sourceAtk,
            def: def - sourceDef,
            mdef: mdef - sourceMdef,
          },
        };
      }
    }
    if (analysis.damage != null &&
        (sourceDamage == null || analysis.damage < sourceDamage)) {
      damageReducedStateCount += 1;
    }
    if (hp > sourceHp) hpImprovedStateCount += 1;
    if (analysis.stage === "viable") viableStateObserved = true;
    if (hp > maxHp) maxHp = hp;
    if (analysis.damage != null && (minDamage == null || analysis.damage < minDamage)) {
      minDamage = analysis.damage;
    }
    if (observations.length < number(maxSamples, 50)) {
      observations.push({
        expansion: number(entry.expansions, observations.length + 1),
        depth,
        fingerprint: hash(buildStateKey(entry.state)),
        stage: analysis.stage,
        hp,
        atk,
        def,
        mdef,
        damage: analysis.damage,
        survivalMargin: margin,
        deltaFromConnectorSource: {
          hp: hp - sourceHp,
          atk: atk - sourceAtk,
          def: def - sourceDef,
          mdef: mdef - sourceMdef,
        },
        chainSummary: (entry.chain || []).map((action) => action.summary || action.kind || "step"),
        availablePrimitiveActionCount: Array.isArray(entry.actions) ? entry.actions.length : null,
      });
    }
  }

  return {
    observe,
    report() {
      return {
        source: {
          stage: sourceAnalysis.stage,
          hp: sourceHp,
          atk: sourceAtk,
          def: sourceDef,
          mdef: sourceMdef,
          damage: sourceDamage,
          survivalMargin: sourceMargin,
        },
        aggregate: {
          statesObserved,
          samplesStored: observations.length,
          stageCounts,
          bestSurvivalMargin: best ? best.margin : null,
          bestSurvivalStateFingerprint: best ? best.fingerprint : null,
          bestSurvivalChain: best ? best.chain : [],
          bestSurvivalResourceDelta: best ? best.resourceDelta : null,
          maxHP: maxHp,
          minDamage,
          survivalMarginImprovedStateCount,
          damageReducedStateCount,
          hpImprovedStateCount,
          viableStateObserved,
          maxDepthReached: Object.keys(depthHistogram).length > 0
            ? Math.max(...Object.keys(depthHistogram).map(Number))
            : 0,
          depthHistogram,
        },
        observations,
      };
    },
  };
}

module.exports = {
  createLethalSurvivalObserver,
};
