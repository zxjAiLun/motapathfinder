"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { loadProject } = require("../lib/project-loader");
const { buildProjectFingerprint } = require("../lib/region-entry-validator");
const { loadRegionSpec, normalizeRegionSpec } = require("../lib/region-spec");

class TowerRegistryError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "TowerRegistryError";
    this.code = code;
    this.details = details || null;
  }
}

function resolveFrom(baseDir, target) {
  const resolved = path.resolve(baseDir, target);
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
    throw new TowerRegistryError("REGISTRY_PATH_ESCAPE", `path escapes registry root: ${target}`);
  }
  return resolved;
}

class TowerRegistry {
  constructor({ configPath, baseDir }) {
    this.baseDir = path.resolve(baseDir || process.cwd());
    this.configPath = configPath ? path.resolve(configPath) : null;
    this.towers = new Map();
    this.fingerprints = new Map();
    this.regionCache = new Map();
    if (this.configPath) this.loadConfig(this.configPath);
  }

  loadConfig(configPath) {
    if (!fs.existsSync(configPath)) {
      throw new TowerRegistryError("REGISTRY_CONFIG_MISSING", `tower config not found: ${configPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const towers = Array.isArray(raw) ? raw : (raw.towers || []);
    towers.forEach((entry) => this.addTower(entry));
  }

  addTower(entry) {
    if (!entry || !entry.id || typeof entry.id !== "string") {
      throw new TowerRegistryError("REGISTRY_INVALID_TOWER", "tower entry must have an id");
    }
    const projectRoot = path.resolve(this.baseDir, entry.projectRoot || entry.root || "");
    if (!fs.existsSync(projectRoot)) {
      throw new TowerRegistryError("REGISTRY_PROJECT_MISSING", `tower project root not found: ${projectRoot}`, { towerId: entry.id });
    }
    let fingerprint = null;
    try {
      const project = loadProject(projectRoot);
      fingerprint = buildProjectFingerprint(project).fingerprintSha256;
    } catch (error) {
      throw new TowerRegistryError("REGISTRY_PROJECT_UNLOADABLE", `tower project could not be loaded: ${error.message}`, { towerId: entry.id });
    }
    const regionSpecRoot = entry.regionSpecRoot
      ? path.resolve(this.baseDir, entry.regionSpecRoot)
      : path.join(projectRoot, "region-specs");
    this.towers.set(entry.id, {
      id: entry.id,
      label: entry.label || entry.id,
      projectRoot,
      regionSpecRoot,
      rank: entry.rank || "chaos",
    });
    this.fingerprints.set(entry.id, fingerprint);
    this.regionCache.delete(entry.id);
  }

  listTowers() {
    return Array.from(this.towers.values()).map((tower) => ({
      id: tower.id,
      label: tower.label,
      projectRoot: tower.projectRoot,
      projectFingerprint: this.fingerprints.get(tower.id),
      rank: tower.rank,
      regionCount: this.listRegions(tower.id).length,
    }));
  }

  getTower(id) {
    const tower = this.towers.get(id);
    if (!tower) throw new TowerRegistryError("REGISTRY_TOWER_NOT_FOUND", `tower not found: ${id}`);
    return {
      ...tower,
      projectFingerprint: this.fingerprints.get(id),
    };
  }

  listRegions(towerId) {
    const tower = this.getTower(towerId);
    if (!fs.existsSync(tower.regionSpecRoot)) return [];
    return fs.readdirSync(tower.regionSpecRoot)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => ({
        id: file.replace(/\.json$/, ""),
        file,
        label: file.replace(/\.json$/, ""),
      }));
  }

  resolveRegionFile(towerId, regionId) {
    const tower = this.getTower(towerId);
    if (!/^[A-Za-z0-9._-]+$/.test(String(regionId))) {
      throw new TowerRegistryError("REGISTRY_INVALID_REGION_ID", `invalid region id: ${regionId}`);
    }
    const resolved = path.resolve(tower.regionSpecRoot, `${regionId}.json`);
    if (!resolved.startsWith(path.resolve(tower.regionSpecRoot) + path.sep)) {
      throw new TowerRegistryError("REGISTRY_PATH_ESCAPE", `region path escapes the tower region root: ${regionId}`);
    }
    if (!fs.existsSync(resolved)) {
      throw new TowerRegistryError("REGISTRY_REGION_NOT_FOUND", `region spec not found: ${regionId}`, { towerId });
    }
    return resolved;
  }

  loadRegion(towerId, regionId) {
    const file = this.resolveRegionFile(towerId, regionId);
    const spec = loadRegionSpec(file);
    const regionFingerprint = require("../lib/solve-task").fingerprintJson(
      (() => {
        const hashable = JSON.parse(JSON.stringify(spec));
        delete hashable.sourceFile;
        delete hashable.label;
        delete hashable.projectRoot;
        return hashable;
      })(),
    );
    return { spec, file, regionFingerprint };
  }

  // The Launcher must never expose arbitrary file reads; this only serves the
  // static UI bundle files that ship with the launcher.
  serveStatic(resourcePath) {
    const allowed = new Set(["index.html", "app.js", "style.css"]);
    if (!allowed.has(resourcePath)) return null;
    return path.join(__dirname, "ui", resourcePath);
  }
}

module.exports = { TowerRegistry, TowerRegistryError };
