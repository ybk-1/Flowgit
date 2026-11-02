import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proxySupport } from "@flowgit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the built CLI with only HTTP_PROXY set, the way a VPN app's terminal setup leaves it, and
// checks that model and service requests reach a host that only the proxy can resolve.
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const HOST = "flowgit-proxy-test.invalid";

let proxy: http.Server;
let proxyUrl: string;
let work: string;
const seen: string[] = [];

/** A streamed Chat Completions reply. */
function chatReply(res: http.ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "# 经过代理 / via the proxy" }, finish_reason: "stop" }] };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end("data: [DONE]\n\n");
}

function flowgit(args: string[], extraEnv: Record<string, string>): Promise<{ code: number | null; out: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", FLOWGIT_HOME: path.join(work, "home"), FLOWGIT_LLM_MOCK_DIR: "", ...extraEnv };
  for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "NODE_USE_ENV_PROXY", "FLOWGIT_PROXY"]) {
    if (!(key in extraEnv)) delete env[key];
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "-C", path.join(work, "flow"), ...args], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

beforeAll(async () => {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  // One server plays both parts: requests sent to it as a proxy (absolute URLs, or tunnels after
  // CONNECT, which Node 22 uses even for http://) are answered as if it were the far host.
  proxy = http.createServer((req, res) => {
    seen.push(`${req.headers.host}${req.url?.replace(/^https?:\/\/[^/]+/, "")}`);
    if (req.url?.endsWith("/chat/completions")) return chatReply(res);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ viaProxy: true }));
  });
  proxy.on("connect", (req, socket, head) => {
    const upstream = net.connect((proxy.address() as AddressInfo).port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-proxy-"));
  fs.mkdirSync(path.join(work, "home"));
  fs.writeFileSync(path.join(work, "home", "providers.json"), JSON.stringify({ providers: { faraway: { protocol: "openai", baseUrl: `http://${HOST}/v1` } } }));
  const flow = path.join(work, "flow");
  fs.mkdirSync(flow);
  fs.writeFileSync(path.join(flow, "prompt.md"), "Say hello.");
  // Records what a script stage inherits: Flowgit's own proxy switches must not leak into it.
  fs.writeFileSync(
    path.join(flow, "env.mjs"),
    'import fs from "node:fs";\nconst pick = (k) => process.env[k] ?? null;\nfs.writeFileSync("env.json", JSON.stringify({ NODE_USE_ENV_PROXY: pick("NODE_USE_ENV_PROXY"), FLOWGIT_PROXY_CHILD: pick("FLOWGIT_PROXY_CHILD"), HTTP_PROXY: pick("HTTP_PROXY"), NO_PROXY: pick("NO_PROXY") }));\n',
  );
  fs.writeFileSync(
    path.join(flow, "flow.json"),
    JSON.stringify({
      format: "flowgit",
      version: "0.1",
      name: "proxy",
      stages: [
        { id: "draft", name: "draft", executor: { type: "llm", prompt: "prompt.md", model: "faraway/some-model" }, outputs: [{ type: "text/markdown", path: "draft.md" }] },
        { id: "fetch", name: "fetch", executor: { type: "service", method: "GET", url: `http://${HOST}/echo` }, outputs: [{ type: "application/json", path: "echo.json" }] },
        { id: "env", name: "env", executor: { type: "script", run: "node env.mjs" }, outputs: [{ type: "application/json", path: "env.json" }] },
      ],
    }),
  );
});

afterAll(() => {
  proxy?.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

describe.skipIf(proxySupport() === "none")("proxy", () => {
  it("sends model and service requests through HTTP_PROXY without NODE_USE_ENV_PROXY", async () => {
    const r = await flowgit(["run", "all"], { HTTP_PROXY: proxyUrl });
    expect(r.code, r.out).toBe(0);
    expect(seen).toEqual(expect.arrayContaining([`${HOST}/v1/chat/completions`, `${HOST}/echo`]));
    expect(fs.readFileSync(path.join(work, "flow", "draft.md"), "utf8")).toContain("via the proxy");
    expect(JSON.parse(fs.readFileSync(path.join(work, "flow", "echo.json"), "utf8"))).toEqual({ viaProxy: true });
    // Node 22's "EnvHttpProxyAgent is experimental" warning is not shown
    expect(r.out).not.toMatch(/experimental|UNDICI/);
    // the script stage sees the user's own environment, not Flowgit's switches
    expect(JSON.parse(fs.readFileSync(path.join(work, "flow", "env.json"), "utf8"))).toEqual({ NODE_USE_ENV_PROXY: null, FLOWGIT_PROXY_CHILD: null, HTTP_PROXY: proxyUrl, NO_PROXY: null });

    const doctor = await flowgit(["doctor"], { HTTP_PROXY: proxyUrl.replace("http://", "http://me:secret@") });
    expect(doctor.out).toContain(`模型和服务请求走代理 ${proxyUrl}（HTTP_PROXY）`);
    expect(doctor.out).not.toContain("secret");
  });

  it("says which proxy a failed request went through, and FLOWGIT_PROXY=off skips it", async () => {
    const down = await flowgit(["run", "fetch"], { HTTP_PROXY: "http://127.0.0.1:9" });
    expect(down.code, down.out).toBe(1);
    expect(down.out).toContain("This request went through the proxy http://127.0.0.1:9 (HTTP_PROXY)");

    const before = seen.length;
    const off = await flowgit(["run", "fetch"], { HTTP_PROXY: proxyUrl, FLOWGIT_PROXY: "off" });
    expect(off.code, off.out).toBe(1);
    expect(off.out).toContain("service call failed");
    expect(off.out).not.toContain("went through the proxy");
    expect(seen.length).toBe(before);
  });
});
