"use strict";

const { runIsolatedAudit } = require("./audit-hp3834-mt2-candidate2-natural-search");

runIsolatedAudit([
  ...process.argv.slice(2),
  "--counterfactual=1",
]);
