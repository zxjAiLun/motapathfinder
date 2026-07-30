"use strict";

const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "run-windows-route-gui-smoke.ps1");
const TIMEOUT_MS = 210000;

function runSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pwsh.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        SCRIPT,
        "-Headless",
        "-StepDelayMs",
        "0",
        "-CloseWhenDone",
      ],
      { cwd: REPO_ROOT, windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CloseWhenDone smoke timed out after ${TIMEOUT_MS}ms\n${stdout}\n${stderr}`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`CloseWhenDone smoke exited with code ${code}, signal ${signal}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function main() {
  const result = await runSmoke();
  assert.match(result.stdout, /Live route completed and Route GUI exited\./);
  console.log("windows route gui CloseWhenDone: 1/1 passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
