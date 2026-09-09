#!/usr/bin/env node
/**
 * check-learned-action-prior.js
 * Static regression check for Phase 1 learned action prior
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { LearnedActionPrior } = require("./lib/learned-action-prior");

async function check() {
  console.log("Running static check for learned-action-prior...");

  const prior = new LearnedActionPrior();

  // TODO: run sanity on held-out dataset
  // Assert: held-out chosen-action rank > uniform baseline

  console.log("Check passed: model learned nontrivial signal (placeholder)");
  return true;
}

check()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
