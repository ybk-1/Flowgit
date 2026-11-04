import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import {
  findFlowFile,
  loadFlow,
  outputAbs,
  outputRel,
  outputsHandEdited,
  readFlowFile,
  recordManualEdit,
  renderFlowText,
  resolveFlowInputs,
  writeFlowFile,
  type Flow,
  type Stage,
} from "@flowgit/core";
import { cloudOrigin, SERVER_OPTION } from "../cloud/origin.js";
import { cloudSession } from "../cloud/credentials.js";
import { cloudBytes, cloudJson } from "../cloud/http.js";
import { safeJoin } from "../cloud/files.js";
import { baseAfterPull, classifyPull, hashMap } from "../cloud/sync.js";
import { readBase, readLink, writeBase } from "../cloud/link.js";
import { askLine } from "./login.js";
import { listLocalFiles } from "../cloud/files.js";
import { c } from "../format.js";

interface CloudFiles {
  files?: { path?: string; sha256?: string }[];
}

export interface PullCommand {
  dir: string;
  server?: string;
  tty?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  ask?: (question: string) => Promise<string>;
  fetchImpl?: typeof fetch;
}

function fileMap(files: { path?: string; sha256?: string }[] | undefined): { path: string; sha256: string }[] {
  const out: { path: string; sha256: string }[] = [];
  for (const file of files ?? []) {
    if (typeof file.path === "string" && typeof file.sha256 === "string") out.push({ path: file.path, sha256: file.sha256 });
  }
  return out;
}

function stageOf(flow: Flow, rel: string): Stage | undefined {
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      const base = outputRel(output);
      if (rel === base || rel.startsWith(`${base}/`)) return stage;
    }
  }
  return undefined;
}

function canSnapshot(dir: string, stage: Stage): boolean {
  return stage.outputs.length > 0 && stage.outputs.every((output) => fs.existsSync(outputAbs(dir, output)));
}

/** Write cloud bytes. A flow file is read back through readFlowFile, and written with writeFlowFile when that would not change the bytes. */
export function writeCloudFile(dir: string, rel: string, bytes: Uint8Array): void {
  const abs = safeJoin(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  if (rel !== "flow.json" && rel !== "flow.md") return;
  const other = rel === "flow.json" ? "flow.md" : "flow.json";
  const otherAbs = path.join(dir, other);
  if (fs.existsSync(otherAbs) && fs.statSync(otherAbs).isFile()) fs.rmSync(otherAbs);
  const file = findFlowFile(dir);
  if (!file) throw new Error("写完之后找不到流程文件 / the flow file is missing after writing");
  const data = readFlowFile(file);
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const text = new TextDecoder().decode(bytes);
  if (renderFlowText(data as Flow, file) === text) writeFlowFile(file, data as Flow);
}

function aside(dir: string, stamp: string, rel: string, bytes: Uint8Array): string {
  const destRel = `.flowgit/conflicts/${stamp}/${rel}`;
  const dest = safeJoin(dir, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  return destRel;
}

function keepChoice(answer: string): "local" | "cloud" | undefined {
  const text = answer.trim().toLowerCase();
  if (text === "l" || text === "local" || answer.trim() === "本地") return "local";
  if (text === "c" || text === "cloud" || answer.trim() === "云端") return "cloud";
  return undefined;
}

export async function executePull(args: PullCommand): Promise<number> {
  const env = args.env ?? process.env;
  const log = args.log ?? ((line: string) => console.log(line));
  const origin = cloudOrigin(args.server, env);
  const session = cloudSession(origin, env);
  const flowFile = findFlowFile(args.dir);
  if (!flowFile) throw new Error(`${args.dir} 里没有 flow.json 或 flow.md / No flow.json or flow.md in ${args.dir}`);
  readFlowFile(flowFile);
  const loaded = loadFlow(args.dir);
  const link = readLink(loaded.dir);
  if (!link) throw new Error("这个流程还没连上云端，先 flowgit push / this flow is not linked to the cloud yet; push first");
  if (link.server !== origin) throw new Error(`这个流程连着 ${link.server}，和这次的 ${origin} 不一样 / this flow is linked to ${link.server}, not ${origin}`);

  const listed = await cloudJson<CloudFiles>({
    origin,
    token: session.token,
    method: "GET",
    path: `/api/flows/${encodeURIComponent(link.flow)}/files`,
    fetchImpl: args.fetchImpl,
  });
  const localFiles = listLocalFiles(loaded.dir);
  const local = hashMap(localFiles);
  const cloud = hashMap(fileMap(listed.files));
  const base = hashMap(Object.entries(readBase(loaded.dir)).map(([rel, sha256]) => ({ path: rel, sha256 })));
  const ops = classifyPull(local, cloud, base);
  const conflicts = ops.filter((op) => op.kind === "conflict");
  const tty = args.tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const choices = new Map<string, "local" | "cloud">();
  if (conflicts.length && !tty) {
    log("两边都改了这些文件，没有终端不能代选，所以什么都没改 / both sides changed these files, and there is no terminal to choose, so nothing was changed:");
    for (const conflict of conflicts) log(`  ${conflict.path}`);
    return 1;
  }
  for (const conflict of conflicts) {
    const answer = await (args.ask ?? askLine)(`两边都改了 ${conflict.path}。保留哪一边？输入 l 保留本地，c 用云端 / both sides changed ${conflict.path}. Keep which side? l local, c cloud: `);
    const choice = keepChoice(answer);
    if (!choice) {
      log("没有选择，什么都没改 / no choice; nothing was changed");
      return 1;
    }
    choices.set(conflict.path, choice);
  }

  const snapshotted = new Set<string>();
  const inputs = resolveFlowInputs(loaded.dir, loaded.flow);
  const snapshot = (stage: Stage) => {
    if (snapshotted.has(stage.id) || !canSnapshot(loaded.dir, stage)) return;
    const kept = recordManualEdit(loaded, stage.id, inputs);
    snapshotted.add(stage.id);
    log(`你的手动修改已存为 v${kept.n} / your manual edit was saved as v${kept.n}`);
  };
  for (const stage of loaded.flow.stages) {
    if (outputsHandEdited(loaded.dir, stage)) snapshot(stage);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const fetchRaw = async (rel: string) =>
    cloudBytes({
      origin,
      token: session.token,
      method: "GET",
      path: `/api/flows/${encodeURIComponent(link.flow)}/raw`,
      query: { path: rel },
      fetchImpl: args.fetchImpl,
    });

  for (const op of ops) {
    if (op.kind === "download") {
      const stage = stageOf(loaded.flow, op.path);
      if (stage && outputsHandEdited(loaded.dir, stage)) snapshot(stage);
      writeCloudFile(loaded.dir, op.path, await fetchRaw(op.path));
      log(`已更新 / updated: ${op.path}`);
    } else if (op.kind === "delete") {
      fs.rmSync(safeJoin(loaded.dir, op.path), { force: true });
      log(`已删除本地文件 / deleted the local file: ${op.path}`);
    }
  }
  for (const [rel, choice] of choices) {
    const cloudBytesFor = await fetchRaw(rel);
    if (choice === "local") {
      const saved = aside(loaded.dir, stamp, rel, cloudBytesFor);
      log(`保留了本地的 ${rel}，云端那份在 / kept the local ${rel}; the cloud copy is at ${saved}`);
      continue;
    }
    const stage = stageOf(loaded.flow, rel);
    const localAbs = safeJoin(loaded.dir, rel);
    if (stage && canSnapshot(loaded.dir, stage)) snapshot(stage);
    else if (fs.existsSync(localAbs)) {
      const saved = aside(loaded.dir, stamp, rel, fs.readFileSync(localAbs));
      log(`换上了云端的 ${rel}，本地那份在 / replaced ${rel} with the cloud copy; the local one is at ${saved}`);
    }
    writeCloudFile(loaded.dir, rel, cloudBytesFor);
    if (stage) log(`已用云端覆盖 / took the cloud copy: ${rel}`);
  }
  writeBase(loaded.dir, baseAfterPull(local, cloud, base, choices));
  if (!ops.length) log("已经和云端一致 / already matches the cloud");
  else log(`${c.green("✓")} 已拉取 / pulled: ${link.flow}`);
  return 0;
}

export function registerPull(program: Command, dirOf: () => string, fail: (err: unknown) => never): void {
  program
    .command("pull")
    .description("把云端的改动拉下来。两边都改了的文件不会自动合并 / pull cloud changes. A file both sides changed is not merged")
    .option(...SERVER_OPTION)
    .action(async (opts: { server?: string }) => {
      try {
        const code = await executePull({ dir: dirOf(), server: opts.server });
        if (code) process.exitCode = code;
      } catch (err) {
        fail(err);
      }
    });
}
