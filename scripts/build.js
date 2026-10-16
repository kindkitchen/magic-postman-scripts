import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

export function buildBundle() {
  return buildSync({
    absWorkingDir: root,
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "neutral",
    format: "iife",
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    write: false,
    logLevel: "silent",
  }).outputFiles[0].text;
}

if (import.meta.main) {
  const bundlePath = path.join(root, "magic-postman-scripts.js");
  if (process.argv.includes("--clean")) {
    fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
  } else {
    const bundle = buildBundle();
    if (process.argv.includes("--check")) {
      if (
        !fs.existsSync(bundlePath) ||
        fs.readFileSync(bundlePath, "utf8") !== bundle
      ) {
        console.error(
          "Bundle is stale. Run yarn build and commit magic-postman-scripts.js.",
        );
        process.exitCode = 1;
      } else {
        console.log("Copy-paste bundle is up to date.");
      }
    } else {
      fs.mkdirSync(path.join(root, "dist"), { recursive: true });
      fs.writeFileSync(path.join(root, "dist/index.js"), bundle);
      fs.writeFileSync(bundlePath, bundle);
      console.log("Built dist/index.js and magic-postman-scripts.js");
    }
  }
}
