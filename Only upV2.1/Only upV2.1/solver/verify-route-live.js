"use strict";

const { main } = require("./verify-mt1-mt3-live");

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
