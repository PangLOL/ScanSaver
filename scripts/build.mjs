import esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function dataUri(path) {
  const bytes = readFileSync(path);
  return "data:font/woff2;base64," + bytes.toString("base64");
}

const worker = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/worker.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  legalComments: "none",
});

const app = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  legalComments: "none",
  define: {
    SCAN_SAVER_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text),
  },
});

const css = readFileSync(resolve(root, "src/styles.css"), "utf8")
  .replace("__FONT_FRAUNCES__", dataUri(resolve(root, "node_modules/@fontsource/fraunces/files/fraunces-latin-500-italic.woff2")))
  .replace("__FONT_SANS__", dataUri(resolve(root, "node_modules/@fontsource/public-sans/files/public-sans-latin-400-normal.woff2")))
  .replace("__FONT_SANS_BOLD__", dataUri(resolve(root, "node_modules/@fontsource/public-sans/files/public-sans-latin-600-normal.woff2")));

const js = app.outputFiles[0].text.replace(/<\/(script)/gi, "<\\/$1");
const html = readFileSync(resolve(root, "src/index.html"), "utf8").replace("__CSS__", css).replace("__JS__", js);
writeFileSync(resolve(root, "vacform.html"), html);
console.log(`wrote vacform.html (${html.length} bytes)`);
