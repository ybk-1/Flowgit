import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { cloudOrigin, SERVER_OPTION } from "../cloud/origin.js";
import { cloudSession } from "../cloud/credentials.js";
import { cloudBytes, cloudJson } from "../cloud/http.js";
import { ignoredSyncPath } from "../cloud/files.js";
import { parseCloneTarget } from "../cloud/sync.js";
import { writeBase, writeLink } from "../cloud/link.js";
import { writeCloudFile } from "./pull.js";
import { c } from "../format.js";

interface FlowInfo {
  flow?: { id?: string; name?: string; workspace_id?: string };
}

interface CloudFiles {
  files?: { path?: string; size?: number; sha256?: string }[];
}

export interface CloneCommand {
  target: string;
  dir?: string;
  server?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
}

function emptyDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  if (!fs.statSync(dir).isDirectory()) throw new Error(`不是文件夹 / not a directory: ${dir}`);
  if (fs.readdirSync(dir).length) throw new Error(`目录不是空的，拒绝写入 / the directory is not empty, nothing was written: ${dir}`);
}

function folderName(name: string, id: string): string {
  const cleaned = name.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return cleaned || id;
}

export async function executeClone(args: CloneCommand): Promise<number> {
  const env = args.env ?? process.env;
  const log = args.log ?? ((line: string) => console.log(line));
  const fallback = cloudOrigin(args.server, env);
  const parsed = parseCloneTarget(args.target, fallback, (server) => cloudOrigin(server, env));
  const session = cloudSession(parsed.origin, env);
  const info = await cloudJson<FlowInfo>({
    origin: parsed.origin,
    token: session.token,
    method: "GET",
    path: `/api/flows/${encodeURIComponent(parsed.flowId)}`,
    fetchImpl: args.fetchImpl,
  });
  const name = typeof info.flow?.name === "string" ? info.flow.name : parsed.flowId;
  const dir = path.resolve(args.dir ?? folderName(name, parsed.flowId));
  emptyDir(dir);
  const listed = await cloudJson<CloudFiles>({
    origin: parsed.origin,
    token: session.token,
    method: "GET",
    path: `/api/flows/${encodeURIComponent(parsed.flowId)}/files`,
    fetchImpl: args.fetchImpl,
  });
  const files = (listed.files ?? []).filter((file): file is { path: string; sha256: string } => typeof file.path === "string" && typeof file.sha256 === "string" && !ignoredSyncPath(file.path));
  const base: Record<string, string> = {};
  for (const file of files) {
    const bytes = await cloudBytes({
      origin: parsed.origin,
      token: session.token,
      method: "GET",
      path: `/api/flows/${encodeURIComponent(parsed.flowId)}/raw`,
      query: { path: file.path },
      fetchImpl: args.fetchImpl,
    });
    writeCloudFile(dir, file.path, bytes);
    base[file.path] = file.sha256;
  }
  const workspace = typeof info.flow?.workspace_id === "string" ? info.flow.workspace_id : "";
  writeLink(dir, { server: parsed.origin, workspace, flow: parsed.flowId });
  writeBase(dir, base);
  log(`${c.green("✓")} 已克隆 / cloned: ${dir}`);
  log(`流程 / flow: ${parsed.flowId}`);
  return 0;
}

export function registerClone(program: Command, fail: (err: unknown) => never): void {
  program
    .command("clone")
    .description("把一个云端流程下载到新文件夹 / download a cloud flow into a new directory")
    .argument("<target>", "云端网址或流程 id / cloud URL or flow id")
    .argument("[dir]", "新文件夹，必须是空的或不存在 / new directory, empty or absent")
    .option(...SERVER_OPTION)
    .action(async (target: string, dir: string | undefined, opts: { server?: string }) => {
      try {
        await executeClone({ target, dir, server: opts.server });
      } catch (err) {
        fail(err);
      }
    });
}
