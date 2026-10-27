// Writes public/licenses.json: third-party crates (cargo metadata) and npm packages (package-lock.json) that ship in the app (W-004).
// Usage: node scripts/gen-licenses.mjs   (runs before every web build, see package.json and playwright.config.ts)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "public/licenses.json";
const NO_LICENSE = "UNKNOWN";
const OWN_CRATES = new Set(["hermodr", "hermod-core", "hermod-node"]);
const MAX_METADATA_BYTES = 256 * 1024 * 1024;

const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], { encoding: "utf8", maxBuffer: MAX_METADATA_BYTES }));
const crates = meta.packages
  .filter((p) => !OWN_CRATES.has(p.name))
  .map((p) => ({ name: p.name, version: p.version, license: p.license ?? NO_LICENSE }));

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const npm = Object.entries(lock.packages)
  .filter(([path, p]) => path.startsWith("node_modules/") && !p.dev)
  .map(([path, p]) => ({ name: path.replace(/^.*node_modules\//, ""), version: p.version, license: typeof p.license === "string" ? p.license : NO_LICENSE }));

const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
mkdirSync("public", { recursive: true });
writeFileSync(OUT, JSON.stringify({ cargo: crates.sort(byName), npm: npm.sort(byName) }));
console.log(`licenses: ${crates.length} crates, ${npm.length} npm packages`);
