// Static files deployed with the Worker (public/, the ASSETS binding):
// - templates/<id>.json and templates/index.json: the bundled templates, same shape as the web app's;
// - console/: a small test page for the API, served at /api/console/.
// Deploying staging also copies the built web app into public/app/ (scripts/deploy.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "public", "templates");
const templatesDir = path.join(root, "..", "cli", "templates");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const index = [];
for (const id of fs.readdirSync(templatesDir).sort()) {
  const dir = path.join(templatesDir, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const flowFile = ["flow.json", "flow.md"].find((name) => fs.existsSync(path.join(dir, name)));
  if (!flowFile) continue;
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, abs).split(path.sep).join("/")] = fs.readFileSync(abs).toString("base64");
  }
  let name = id;
  let stages = 0;
  if (flowFile === "flow.json") {
    const flow = JSON.parse(fs.readFileSync(path.join(dir, flowFile), "utf8"));
    name = flow.name ?? id;
    stages = Array.isArray(flow.stages) ? flow.stages.length : 0;
  }
  index.push({ id, name, stages });
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({ id, files }));
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index));

// The test console (served at /api/console/).
fs.rmSync(path.join(root, "public", "console"), { recursive: true, force: true });
fs.cpSync(path.join(root, "static", "console"), path.join(root, "public", "console"), { recursive: true });
console.log(`云端静态文件：${index.length} 个模板 / cloud assets: ${index.length} templates`);
