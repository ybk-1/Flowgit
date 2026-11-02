import fs from "node:fs";
import path from "node:path";
import { resolveSubflowFile } from "./subflow.js";
import type { Flow, LoadedFlow } from "./types.js";
import { isDirOutput, outputRel } from "./util.js";

const SKIP_DIRS = new Set(["runs", "node_modules", ".git"]);

function isEnvFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

/**
 * Declared output paths (no trailing slash) and which of them are directories.
 * With `dir`, the outputs of flowgit sub-flows count too, relative to `dir`.
 */
function outputSets(flow: Flow, dir?: string): { files: Set<string>; dirs: string[] } {
  const files = new Set<string>();
  const dirs: string[] = [];
  let root: string | undefined;
  try {
    root = dir ? fs.realpathSync(dir) : undefined;
  } catch {
    root = undefined;
  }
  const add = (current: Flow, base: string, at: string | undefined, seen: Set<string>) => {
    for (const stage of current.stages ?? []) {
      for (const out of stage.outputs ?? []) {
        const rel = path.posix.join(base, outputRel(out).split(path.sep).join("/"));
        if (isDirOutput(out)) dirs.push(rel);
        else files.add(rel);
      }
      const ex = stage.executor;
      if (!root || !at || ex.type !== "workflow" || ex.engine !== "flowgit") continue;
      const resolved = resolveSubflowFile(at, ex.file);
      if ("error" in resolved || seen.has(resolved.abs) || !fs.existsSync(resolved.abs)) continue;
      let sub: Flow;
      try {
        sub = JSON.parse(fs.readFileSync(resolved.abs, "utf8")) as Flow;
      } catch {
        continue;
      }
      const subDir = path.dirname(resolved.abs);
      add(sub, path.relative(root, subDir).split(path.sep).join("/"), subDir, new Set([...seen, resolved.abs]));
    }
  };
  add(flow, "", root, new Set());
  return { files, dirs };
}

function isOutput(rel: string, files: Set<string>, dirs: string[]): boolean {
  if (files.has(rel)) return true;
  return dirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

/**
 * Files that belong to a flow, as sorted relative paths with "/" separators.
 * Always leaves out runs/, flowgit.local.json, node_modules/, .git/ and .env*.
 * When withOutputs is false, also leaves out each stage's declared outputs, sub-flows' included.
 */
export function flowFiles(loaded: LoadedFlow, opts: { withOutputs: boolean }): string[] {
  const outputs = opts.withOutputs ? undefined : outputSets(loaded.flow, loaded.dir);
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name === "flowgit.local.json" || isEnvFile(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, child);
      } else if (entry.isFile()) {
        if (outputs && isOutput(child, outputs.files, outputs.dirs)) continue;
        files.push(child);
      }
    }
  };
  walk(loaded.dir, "");
  return files;
}
