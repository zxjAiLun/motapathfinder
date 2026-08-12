"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  compareSearchTraceReports,
  renderSearchTraceMarkdown,
} = require("./lib/search-trace-explainability");

function parseArgs(argv) {
  return argv.reduce((result, arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function write(filePath, content) {
  const output = path.resolve(filePath);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content, "utf8");
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (!args.before) throw new Error("--before=<blind report> is required");
  const comparison = compareSearchTraceReports(
    readJson(args.before),
    args.after ? readJson(args.after) : null,
  );
  if (args.out) write(args.out, `${JSON.stringify(comparison, null, 2)}\n`);
  const markdown = renderSearchTraceMarkdown(comparison);
  if (args.markdown) write(args.markdown, markdown);
  process.stdout.write(markdown);
  return comparison;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
