"use strict";

function buildExpressionContext(project, state, extra) {
  const floorId = (extra && extra.floorId) || state.floorId;
  const floor = project.floorsById[floorId];

  return {
    status: {
      hp: state.hero.hp,
      hpmax: state.hero.hpmax,
      atk: state.hero.atk,
      def: state.hero.def,
      mdef: state.hero.mdef,
      money: state.hero.money,
      exp: state.hero.exp,
      lv: state.hero.lv,
      steps: state.hero.steps,
    },
    items: state.inventory,
    flags: state.flags,
    hero: state.hero,
    floor,
    project,
  };
}

function translateExpression(expression) {
  let source = String(expression).trim();
  if (source === "") return "undefined";

  source = source.replace(/\bstatus:([A-Za-z0-9_]+)\b/g, 'status["$1"]');
  source = source.replace(/\bitem:([A-Za-z0-9_]+)\b/g, 'items["$1"]');
  source = source.replace(/\bflag:([A-Za-z0-9_]+)\b/g, 'flags["$1"]');
  source = source.replace(/core\.getHeroLoc\(\)\.x/g, "hero.loc.x");
  source = source.replace(/core\.getHeroLoc\(\)\.y/g, "hero.loc.y");
  source = source.replace(/core\.bigmap\.width/g, "floor.width");
  source = source.replace(/core\.bigmap\.height/g, "floor.height");

  return source;
}

function evaluateExpression(expression, project, state, extra) {
  if (expression == null) return expression;
  if (typeof expression !== "string") return expression;

  const context = buildExpressionContext(project, state, extra);
  const source = translateExpression(expression);

  try {
    // eslint-disable-next-line no-new-func
    const evaluator = new Function(
      "Math",
      "status",
      "items",
      "flags",
      "hero",
      "floor",
      "project",
      `return (${source});`
    );
    return evaluator(
      Math,
      context.status,
      context.items,
      context.flags,
      context.hero,
      context.floor,
      context.project
    );
  } catch (error) {
    throw new Error(`Failed to evaluate expression "${expression}": ${error.message}`);
  }
}

function evaluateCondition(condition, project, state, extra) {
  return Boolean(evaluateExpression(condition, project, state, extra));
}

module.exports = {
  buildExpressionContext,
  evaluateExpression,
  evaluateCondition,
};
