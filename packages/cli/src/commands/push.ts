import type { Command } from "commander";
import { loadFlow } from "@flowgit/core";
import { cloudOrigin, SERVER_OPTION } from "../cloud/origin.js";
import { cloudSession } from "../cloud/credentials.js";
import { cloudJson } from "../cloud/http.js";
import { listLocalFiles, packCreate, readFileBytes, type LocalFile } from "../cloud/files.js";
import { chooseWorkspace, cloudChanges, hashMap, planPush, type WorkspaceChoice } from "../cloud/sync.js";
import { readBase, readLink, writeBase, writeLink } from "../cloud/link.js";
import { askLine } from "./login.js";
import { c } from "../format.js";

interface WorkspaceList {
  workspaces?: { id?: string; name?: string }[];
}

interface FlowCreated {
  flow?: { id?: string; workspace_id?: string; name?: string };
}

interface CloudFiles {
  files?: { path?: string; sha256?: string }[];
}

export interface PushCommand {
  dir: string;
  server?: string;
  workspace?: string;
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

async function putFile(origin: string, token: string, flowId: string, root: string, rel: string, fetchImpl?: typeof fetch): Promise<void> {
  await cloudJson({
    origin,
    token,
    method: "PUT",
    path: `/api/flows/${encodeURIComponent(flowId)}/raw`,
    query: { path: rel },
    body: readFileBytes(root, rel),
    fetchImpl,
  });
}

async function createFlow(origin: string, token: string, workspace: string, name: string, root: string, paths: string[], fetchImpl?: typeof fetch): Promise<string> {
  const files: Record<string, string> = {};
  for (const rel of paths) files[rel] = readFileBytes(root, rel).toString("base64");
  const created = await cloudJson<FlowCreated>({
    origin,
    token,
    method: "POST",
    path: `/api/workspaces/${encodeURIComponent(workspace)}/flows`,
    json: { name, files },
    fetchImpl,
  });
  const id = created.flow?.id;
  if (!id) throw new Error("云端没有返回流程编号 / the cloud did not return a flow id");
  return id;
}

export async function executePush(args: PushCommand): Promise<number> {
  const env = args.env ?? process.env;
  const log = args.log ?? ((line: string) => console.log(line));
  const origin = cloudOrigin(args.server, env);
  const session = cloudSession(origin, env);
  const loaded = loadFlow(args.dir);
  const localFiles = listLocalFiles(loaded.dir);
  const local = hashMap(localFiles);
  const link = readLink(loaded.dir);
  if (link && link.server !== origin) {
    throw new Error(`这个流程连着 ${link.server}，和这次的 ${origin} 不一样 / this flow is linked to ${link.server}, not ${origin}`);
  }

  if (!link) {
    await firstPush({ ...args, env, log, origin, token: session.token, dir: loaded.dir, name: loaded.flow.name, localFiles });
  } else {
    if (args.workspace && args.workspace !== link.workspace) {
      throw new Error(`这个流程已经在工作区 ${link.workspace} / this flow is already in workspace ${link.workspace}`);
    }
    await pushExisting({ origin, token: session.token, dir: loaded.dir, flowId: link.flow, local, localFiles, log, fetchImpl: args.fetchImpl });
  }
  return 0;
}

interface FirstPush extends PushCommand {
  origin: string;
  token: string;
  dir: string;
  name: string;
  localFiles: LocalFile[];
}

async function firstPush(args: FirstPush): Promise<string> {
  const listed = await cloudJson<WorkspaceList>({
    origin: args.origin,
    token: args.token,
    method: "GET",
    path: "/api/workspaces",
    fetchImpl: args.fetchImpl,
  });
  const workspaces: WorkspaceChoice[] = [];
  for (const workspace of listed.workspaces ?? []) {
    if (typeof workspace.id === "string") workspaces.push({ id: workspace.id, name: typeof workspace.name === "string" ? workspace.name : workspace.id });
  }
  const workspace = await chooseWorkspace({
    workspaces,
    explicit: args.workspace,
    tty: args.tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: args.ask ?? askLine,
  });
  const pack = packCreate(args.localFiles);
  const flowId = await createFlow(args.origin, args.token, workspace, args.name.slice(0, 120) || "flow", args.dir, pack.create, args.fetchImpl);
  // Link before the remaining uploads, and record each file as it lands, so a retry continues this flow.
  const shaOf = new Map(args.localFiles.map((file) => [file.path, file.sha256]));
  const base: Record<string, string> = {};
  for (const rel of pack.create) base[rel] = shaOf.get(rel) ?? "";
  writeLink(args.dir, { server: args.origin, workspace, flow: flowId });
  writeBase(args.dir, base);
  for (const rel of pack.rest) {
    await putFile(args.origin, args.token, flowId, args.dir, rel, args.fetchImpl);
    base[rel] = shaOf.get(rel) ?? "";
    writeBase(args.dir, base);
  }
  args.log?.(`${c.green("✓")} 已推送 / pushed: ${flowId}`);
  args.log?.(`工作区 / workspace: ${workspace}`);
  if (pack.rest.length) args.log?.(`先建了流程文件，又单独上传了 ${pack.rest.length} 个 / created the flow file, then uploaded ${pack.rest.length} more`);
  return flowId;
}

async function pushExisting(args: {
  origin: string;
  token: string;
  dir: string;
  flowId: string;
  local: Map<string, string>;
  localFiles: LocalFile[];
  log: (line: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const listed = await cloudJson<CloudFiles>({
    origin: args.origin,
    token: args.token,
    method: "GET",
    path: `/api/flows/${encodeURIComponent(args.flowId)}/files`,
    fetchImpl: args.fetchImpl,
  });
  const cloud = hashMap(fileMap(listed.files));
  const base = hashMap(Object.entries(readBase(args.dir)).map(([path, sha256]) => ({ path, sha256 })));
  const diverged = cloudChanges(cloud, base);
  if (diverged.length) {
    const shown = diverged.slice(0, 20).map((rel) => `  ${rel}`).join("\n");
    const more = diverged.length > 20 ? `\n  … ${diverged.length - 20}` : "";
    throw new Error(`云端在上次同步之后有改动，请先 flowgit pull / the cloud changed since the last sync; pull first:\n${shown}${more}`);
  }
  const plan = planPush(args.local, base);
  for (const rel of plan.upload) await putFile(args.origin, args.token, args.flowId, args.dir, rel, args.fetchImpl);
  for (const rel of plan.remove) {
    await cloudJson({
      origin: args.origin,
      token: args.token,
      method: "DELETE",
      path: `/api/flows/${encodeURIComponent(args.flowId)}/raw`,
      query: { path: rel },
      fetchImpl: args.fetchImpl,
    });
  }
  const next: Record<string, string> = {};
  for (const [rel, sha] of args.local) next[rel] = sha;
  writeBase(args.dir, next);
  args.log(`${c.green("✓")} 已推送 / pushed: ${args.flowId}`);
  args.log(`上传 ${plan.upload.length} 个，删除 ${plan.remove.length} 个 / uploaded ${plan.upload.length}, deleted ${plan.remove.length}`);
}

export function registerPush(program: Command, dirOf: () => string, fail: (err: unknown) => never): void {
  program
    .command("push")
    .description("把当前流程连同 runs/ 推上云端 / push this flow, including runs/, to the cloud")
    .option(...SERVER_OPTION)
    .option("--workspace <id>", "第一次推送放进这个工作区 / workspace id for the first push")
    .action(async (opts: { server?: string; workspace?: string }) => {
      try {
        await executePush({ dir: dirOf(), server: opts.server, workspace: opts.workspace });
      } catch (err) {
        fail(err);
      }
    });
}
