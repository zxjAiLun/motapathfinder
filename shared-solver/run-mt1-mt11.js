"use strict";

const runner = require("./run-search");

if (require.main === module) {
  runner.main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = runner;
