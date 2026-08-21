import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BENCHMARK_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(BENCHMARK_ROOT, "..");
export const CONFIG_DIR = path.join(BENCHMARK_ROOT, "config");
export const CONTRACTS_DIR = path.join(REPO_ROOT, "contracts");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function getExperimentConfigPath(benchmarkVersion = null) {
  const activePath = path.join(CONFIG_DIR, "experiment.json");
  if (benchmarkVersion === null) return activePath;
  if (!/^[a-zA-Z0-9._-]+$/.test(benchmarkVersion)) {
    throw new Error(`Invalid benchmark version: ${benchmarkVersion}`);
  }
  const activeConfig = readJson(activePath);
  return activeConfig.benchmarkVersion === benchmarkVersion
    ? activePath
    : path.join(CONFIG_DIR, "versions", `${benchmarkVersion}.json`);
}

export function loadExperimentConfig(benchmarkVersion = null) {
  return readJson(getExperimentConfigPath(benchmarkVersion));
}

export function loadScoringConfig() {
  return readJson(path.join(CONFIG_DIR, "scoring.json"));
}

export function loadCostsConfig() {
  return readJson(path.join(CONFIG_DIR, "costs.json"));
}

export function loadRunSchema() {
  return readJson(path.join(CONTRACTS_DIR, "run.schema.json"));
}

export function loadReportSchema() {
  return readJson(path.join(CONTRACTS_DIR, "report.schema.json"));
}
