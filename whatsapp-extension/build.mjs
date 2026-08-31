/**
 * Build script: bundles the three extension entry points with esbuild and
 * copies static assets into dist/ (the folder loaded in chrome://extensions).
 */
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content/content.ts",
    popup: "src/popup/popup.ts",
  },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir,
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

await cp("manifest.json", `${outdir}/manifest.json`);
await cp("src/popup/popup.html", `${outdir}/popup.html`);

console.log("Build complete. Load the dist/ folder in chrome://extensions.");
