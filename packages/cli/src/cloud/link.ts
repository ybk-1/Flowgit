import fs from "node:fs";
import path from "node:path";

/** `.flowgit/cloud.json` is only these three ids. Never a token. */
export interface CloudLink {
  server: string;
  workspace: string;
  flow: string;
}

const LINK_NAME = "cloud.json";
const BASE_NAME = "cloud-base.json";

function flowgitDir(dir: string): string {
  return path.join(dir, ".flowgit");
}

export function readLink(dir: string): CloudLink | undefined {
  const file = path.join(flowgitDir(dir), LINK_NAME);
  if (!fs.existsSync(file)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} 不是有效的 JSON，修好或删掉它再试 / ${file} is not valid JSON; fix or delete it and try again`);
  }
  const rec = data as Partial<CloudLink> | null;
  if (!rec || typeof rec.server !== "string" || typeof rec.workspace !== "string" || typeof rec.flow !== "string") {
    throw new Error(`${file} 里要有 server、workspace 和 flow / ${file} needs server, workspace and flow`);
  }
  return { server: rec.server, workspace: rec.workspace, flow: rec.flow };
}

export function writeLink(dir: string, link: CloudLink): void {
  const folder = flowgitDir(dir);
  fs.mkdirSync(folder, { recursive: true });
  const body = { server: link.server, workspace: link.workspace, flow: link.flow };
  fs.writeFileSync(path.join(folder, LINK_NAME), `${JSON.stringify(body, null, 2)}\n`);
}

/** Last synced sha256 of each path. No credentials. */
export function readBase(dir: string): Record<string, string> {
  const file = path.join(flowgitDir(dir), BASE_NAME);
  if (!fs.existsSync(file)) return {};
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} 不是有效的 JSON，修好或删掉它再试 / ${file} is not valid JSON; fix or delete it and try again`);
  }
  const files = (data as { files?: unknown } | null)?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return {};
  const out: Record<string, string> = {};
  for (const [rel, sha] of Object.entries(files)) {
    if (typeof sha === "string") out[rel] = sha;
  }
  return out;
}

export function writeBase(dir: string, files: Record<string, string>): void {
  const folder = flowgitDir(dir);
  fs.mkdirSync(folder, { recursive: true });
  const sorted: Record<string, string> = {};
  for (const rel of Object.keys(files).sort()) sorted[rel] = files[rel]!;
  fs.writeFileSync(path.join(folder, BASE_NAME), `${JSON.stringify({ files: sorted }, null, 2)}\n`);
}

export function appUrl(origin: string, flowId: string): string {
  return `${origin}/app/?flow=${encodeURIComponent(flowId)}`;
}
