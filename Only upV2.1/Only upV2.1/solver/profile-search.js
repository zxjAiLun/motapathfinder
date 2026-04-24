"use strict";

const fs = require("fs");
const path = require("path");

function findLatestProfile(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".cpuprofile") || name.endsWith(".json"))
    .map((name) => ({ name, file: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)[0] || null;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const profileDir = path.resolve(__dirname, "profiles");
  const latest = args.has("--last") ? findLatestProfile(profileDir) : null;
  if (!latest) {
    console.log(`No profile found in ${profileDir}`);
    return;
  }
  const stat = fs.statSync(latest.file);
  let summary = { file: path.relative(__dirname, latest.file), sizeMb: stat.size / 1024 / 1024, modifiedAt: stat.mtime.toISOString() };
  if (latest.name.endsWith(".json")) {
    try {
      const parsed = JSON.parse(fs.readFileSync(latest.file, "utf8"));
      summary = { ...summary, ...parsed };
    } catch (error) {
      summary.parseError = String(error.message || error);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();
