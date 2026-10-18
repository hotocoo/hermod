// Moves the large static asset folders out of the Next export (out/) into src-tauri/web/, which Tauri ships as
// bundle resources instead of compiling into the binary (1 GB+ breaks the linker). src-tauri/src/web_assets.rs
// serves them back under the same URLs. Usage: node scripts/split-web-assets.mjs (runs after `next build`).
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";

const DIRS = ["assets", "basis"];
mkdirSync("src-tauri/web", { recursive: true });
for (const d of DIRS) {
  const from = `out/${d}`;
  const to = `src-tauri/web/${d}`;
  rmSync(to, { recursive: true, force: true });
  if (!existsSync(from)) throw new Error(`${from} missing: run next build first`);
  renameSync(from, to);
  console.log(`split-web-assets: ${from} -> ${to}`);
}
