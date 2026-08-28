"use strict";

const vm = require("vm");

const { addItem, getInventoryCount } = require("./state");

// ---------------------------------------------------------------------------
// Iteration 3 – deterministic item-effect interpreter (exact-state safe fast path)
//
// Profiling (PR-5.24b Iteration 3): pickupItemEffect is the #1 stabilization cost
// because every pickup builds a fresh effect core AND a fresh V8 context
// (vm.runInNewContext). PR-5.22f already established that caching the compiled
// script alone does not pay: the remaining cost is context creation itself.
//
// The OnlyUp project's 194 unique itemEffect programs are ALL simple statement
// sequences over the `core` interface:
//   core.status.hero.<field> <op> <arithmetic-expr>
//   core.addItem(id, n) / core.setFlag(name, v) / core.addFlag(name, v)
// where <arithmetic-expr> uses numeric literals, core.values.<name>,
// core.status.thisMap.ratio and + - * / ( ).
//
// For exactly those shapes we evaluate deterministically in-process with no VM
// context at all. Any other shape falls back to the VM (fail-closed). The
// arithmetic RHS is parsed once per unique source string and cached; parsing
// supports only numbers, identifiers from the core namespaces, parentheses and
// + - * / with standard precedence – anything else is a parse failure → fallback.
// ---------------------------------------------------------------------------

const EFFECT_INTERP_CACHE_MAX = 1024;
const effectInterpCache = new Map();

function parseEffectSource(source) {
  // Normalize whitespace to single spaces and split statement sequences.
  const normalized = String(source || "").replace(/\s+/g, " ").trim();
  if (!normalized) return { statements: [] };
  // Statements are separated by ';' but a few legacy sources omit separators
  // between addItem calls; normalize "core.addItem(...) core.addItem" with a
  // boundary insert so both forms parse identically.
  const withSeparators = normalized.replace(/\) core\./g, "); core.");
  const statementSources = withSeparators.split(";").map((s) => s.trim()).filter(Boolean);
  const statements = [];
  for (const stmtSource of statementSources) {
    const stmt = parseSingleStatement(stmtSource);
    if (!stmt) return null;
    statements.push(stmt);
  }
  return { statements };
}

function parseSingleStatement(stmtSource) {
  // Method calls: core.addItem(id, n) / core.setFlag(name, v) / core.addFlag(name, v)
  let match = /^core\.(addItem|setFlag|addFlag)\((.*)\)$/.exec(stmtSource);
  if (match) {
    const [, method, argSource] = match;
    const args = parseCallArguments(argSource);
    if (!args) return null;
    return { kind: "method", method, args };
  }
  // Compound/plain assignment: core.status.hero.<field> <op> <expr>
  match = /^core\.status\.hero\.([a-zA-Z][a-zA-Z0-9_]*) (\+=|-=|\*=|\/=|=) (.+)$/.exec(stmtSource);
  if (match) {
    const [, field, op, exprSource] = match;
    const expr = parseArithmeticExpression(exprSource.trim());
    if (!expr) return null;
    return { kind: "assign", field, op, expr };
  }
  return null;
}

function parseCallArguments(argSource) {
  const parts = splitTopLevel(argSource);
  if (parts == null) return null;
  const args = [];
  for (const part of parts) {
    const trimmed = part.trim();
    const str = /^'([^']*)'$/.exec(trimmed) || /^"([^"]*)"$/.exec(trimmed);
    if (str) {
      args.push({ type: "string", value: str[1] });
      continue;
    }
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) || /^-?\d+[eE][+-]?\d+$/.test(trimmed)) {
      args.push({ type: "number", value: Number(trimmed) });
      continue;
    }
    return null;
  }
  return args;
}

function splitTopLevel(source) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of source) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (depth !== 0) return null;
  parts.push(current);
  return parts;
}

// Recursive-descent arithmetic parser over a tiny token set:
//   number | core.values.<name> | core.status.thisMap.ratio |
//   core.status.hero.<field> | ( expr ) | expr op expr (with + - * / precedence)
const ARITH_TOKEN = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|core\.values\.[a-zA-Z][a-zA-Z0-9_]*|core\.status\.thisMap\.ratio|core\.status\.hero\.[a-zA-Z][a-zA-Z0-9_]*|[()+\-*/])/;

function tokenizeArithmetic(source) {
  const tokens = [];
  let rest = source;
  while (rest.length > 0) {
    if (rest[0] === " ") { rest = rest.slice(1); continue; }
    const match = ARITH_TOKEN.exec(rest);
    if (!match) return null;
    tokens.push(match[1]);
    rest = rest.slice(match[1].length);
  }
  return tokens;
}

function parseArithmeticExpression(source) {
  const tokens = tokenizeArithmetic(source);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const parsePrimary = () => {
    const token = peek();
    if (token == null) return null;
    if (token === "(") {
      pos += 1;
      const inner = parseAdditive();
      if (inner == null || peek() !== ")") return null;
      pos += 1;
      return inner;
    }
    if (/^(\d|\.)/.test(token)) {
      pos += 1;
      return { type: "number", value: Number(token) };
    }
    if (token.startsWith("core.values.")) {
      pos += 1;
      return { type: "value", name: token.slice("core.values.".length) };
    }
    if (token === "core.status.thisMap.ratio") {
      pos += 1;
      return { type: "ratio" };
    }
    if (token.startsWith("core.status.hero.")) {
      pos += 1;
      return { type: "hero", field: token.slice("core.status.hero.".length) };
    }
    return null;
  };
  const parseMultiplicative = () => {
    let left = parsePrimary();
    if (left == null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = peek();
      pos += 1;
      const right = parsePrimary();
      if (right == null) return null;
      left = { type: "binary", op, left, right };
    }
    return left;
  };
  const parseAdditive = () => {
    let left = parseMultiplicative();
    if (left == null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      pos += 1;
      const right = parseMultiplicative();
      if (right == null) return null;
      left = { type: "binary", op, left, right };
    }
    return left;
  };
  const expr = parseAdditive();
  if (expr == null || pos !== tokens.length) return null;
  return expr;
}

function getEffectInterpretation(source) {
  if (typeof source !== "string" || source.length === 0) return null;
  let parsed = effectInterpCache.get(source);
  if (parsed === undefined) {
    parsed = parseEffectSource(source);
    if (effectInterpCache.size >= EFFECT_INTERP_CACHE_MAX) {
      const firstKey = effectInterpCache.keys().next().value;
      effectInterpCache.delete(firstKey);
    }
    effectInterpCache.set(source, parsed);
  }
  return parsed;
}

// Read-only coverage probe for gates: does this itemEffect source parse into the
// interpreter subset (i.e. will the fast path be taken when enabled)?
function canInterpretItemEffect(source) {
  return getEffectInterpretation(source) != null;
}

function evaluateArithmetic(node, core) {
  switch (node.type) {
    case "number":
      return node.value;
    case "value":
      return core.values[node.name];
    case "ratio":
      return core.status.thisMap.ratio;
    case "hero":
      return core.status.hero[node.field];
    case "binary": {
      const left = evaluateArithmetic(node.left, core);
      const right = evaluateArithmetic(node.right, core);
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      if (node.op === "/") return left / right;
      return undefined;
    }
    default:
      return undefined;
  }
}

// The interpretation runs EXCLUSIVELY on the authoritative buildEffectCore object:
// ratio fallback (`floor.ratio || 1`), addItem/setFlag/addFlag defaults (`amount || 1`,
// raw undefined writes, `(flag || 0) + value`) all keep exactly ONE implementation.
// The interpreter only replaces the V8 context, never the core semantics.
function runEffectInterpretation(program, core) {
  for (const stmt of program.statements) {
    if (stmt.kind === "method") {
      // Call the authoritative core method with parsed argument expressions.
      // Missing arguments are passed exactly as the VM would see them: undefined.
      const args = stmt.args.map((arg) => arg.value);
      if (stmt.method === "addItem") {
        core.addItem(args[0], args[1]);
      } else if (stmt.method === "setFlag") {
        core.setFlag(args[0], args[1]);
      } else if (stmt.method === "addFlag") {
        core.addFlag(args[0], args[1]);
      }
      continue;
    }
    // assignment on core.status.hero
    const right = evaluateArithmetic(stmt.expr, core);
    const hero = core.status.hero;
    switch (stmt.op) {
      case "+=": hero[stmt.field] += right; break;
      case "-=": hero[stmt.field] -= right; break;
      case "*=": hero[stmt.field] *= right; break;
      case "/=": hero[stmt.field] /= right; break;
      case "=": hero[stmt.field] = right; break;
      default: return false;
    }
  }
  return true;
}

function buildEffectCore(project, state) {
  const floor = project.floorsById[state.floorId];

  return {
    status: {
      hero: state.hero,
      thisMap: {
        ratio: floor.ratio || 1,
      },
    },
    values: project.values,
    addItem(itemId, amount) {
      addItem(state, itemId, amount || 1);
    },
    itemCount(itemId) {
      return getInventoryCount(state, itemId);
    },
    hasItem(itemId) {
      return getInventoryCount(state, itemId) > 0;
    },
    getFlag(name, defaultValue) {
      return Object.prototype.hasOwnProperty.call(state.flags, name) ? state.flags[name] : defaultValue;
    },
    setFlag(name, value) {
      state.flags[name] = value;
    },
    addFlag(name, value) {
      state.flags[name] = (state.flags[name] || 0) + value;
    },
    hasEquip(itemId) {
      return (state.hero.equipment || []).includes(itemId);
    },
    getEquip(equipType) {
      return (state.hero.equipment || [])[equipType] || null;
    },
  };
}

const SCRIPT_CACHE_MAX_ENTRIES = 1024;
const COMPILED_SCRIPT_CACHE = new Map();

function clearCompiledScriptCache() {
  COMPILED_SCRIPT_CACHE.clear();
}

function getCompiledEffectScript(code) {
  if (typeof code !== "string") return null;
  let script = COMPILED_SCRIPT_CACHE.get(code);
  if (script === undefined) {
    try {
      script = new vm.Script(code);
    } catch (error) {
      script = null;
    }
    if (COMPILED_SCRIPT_CACHE.size >= SCRIPT_CACHE_MAX_ENTRIES) {
      const firstKey = COMPILED_SCRIPT_CACHE.keys().next().value;
      COMPILED_SCRIPT_CACHE.delete(firstKey);
    }
    COMPILED_SCRIPT_CACHE.set(code, script);
  }
  return script;
}

function executeItemEffect(project, state, item, options = {}) {
  if (!item || !item.itemEffect) return;
  const timeout = typeof options.timeoutMs === "number" ? options.timeoutMs : 1000;
  const useFastPath = Boolean(options.enableCompiledEffectCache);

  // Deterministic interpreter fast path (Iteration 3): the OnlyUp itemEffect
  // programs are simple core-interface statement sequences (see analysis above).
  // When the source parses into the supported subset we evaluate in-process with
  // no V8 context; anything else falls back to the VM exactly as before.
  // The program executes EXCLUSIVELY on the authoritative buildEffectCore object,
  // so ratio fallbacks, addItem/setFlag/addFlag defaults and every other core
  // semantic keep exactly one implementation. There is no second semantics to
  // drift. The interpreter replaces only the V8 context, never the core.
  const interpreterEnabled = options.enableItemEffectInterpreter !== false;
  const program = interpreterEnabled ? getEffectInterpretation(item.itemEffect) : null;
  if (program) {
    const core = buildEffectCore(project, state);
    runEffectInterpretation(program, core);
    return;
  }

  const context = {
    core: buildEffectCore(project, state),
    Math,
  };

  if (useFastPath) {
    const script = getCompiledEffectScript(item.itemEffect);
    if (script) {
      script.runInNewContext(context, { timeout });
      return;
    }
  }

  vm.runInNewContext(item.itemEffect, context, { timeout });
}

function applyPickup(project, state, itemId, options = {}) {
  const item = project.itemsById[itemId];
  if (!item) {
    state.notes.push(`Unknown item pickup: ${itemId}`);
    return;
  }

  if (item.cls === "items") {
    executeItemEffect(project, state, item, options);
    return;
  }

  addItem(state, itemId, 1);
}

module.exports = {
  applyPickup,
  buildEffectCore,
  canInterpretItemEffect,
  clearCompiledScriptCache,
  executeItemEffect,
  getCompiledEffectScript,
};
