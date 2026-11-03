import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flowToMermaid } from "@flowgit/core";
import { mermaidToSvg, splitBilingual } from "./gallery.js";
import { COMMUNITY_LIST_NOTE } from "./registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const repo = path.resolve(here, "../../..");
const templatesDir = path.join(here, "..", "templates");
const hasGit = spawnSync("git", ["--version"]).status === 0;

function run(args: string[], env: Record<string, string> = {}, cwd?: string) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0", ...env },
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function bundledIds(): string[] {
  return fs
    .readdirSync(templatesDir)
    .filter((id) => fs.existsSync(path.join(templatesDir, id, "flow.json")) || fs.existsSync(path.join(templatesDir, id, "flow.md")))
    .sort();
}

describe("gallery and community templates", () => {
  let root: string;

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-gallery-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("draws the stage graph as inline SVG from mermaid.ts", () => {
    const diagram = flowToMermaid({
      format: "flowgit",
      version: "0.1",
      name: "demo",
      stages: [
        { id: "a", name: "大纲", executor: { type: "agent", agent: "claude-code", prompt: "prompts/outline.md" }, outputs: [{ type: "text/markdown", path: "outline.md" }] },
        { id: "b", name: "网页", inputs: ["a"], executor: { type: "script", run: "node scripts/check-page.mjs" }, outputs: [{ type: "text/html", path: "index.html" }] },
      ],
    });
    const svg = mermaidToSvg(diagram);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("大纲");
    expect(svg).toContain("网页");
    expect(svg).not.toMatch(/cdn\.|unpkg|jsdelivr|mermaid/i);
    expect(splitBilingual("周报（入门示例）/ Weekly report (starter example)")).toEqual({
      zh: "周报（入门示例）",
      en: "Weekly report (starter example)",
    });
    expect(splitBilingual("短视频制作 / Short video")).toEqual({ zh: "短视频制作", en: "Short video" });
  });

  it("templates --all reads a local registry and falls back to one note when it cannot", () => {
    const registry = path.join(root, "community.json");
    fs.writeFileSync(
      registry,
      JSON.stringify([
        {
          id: "page-demo",
          name: { zh: "示例页", en: "Demo page" },
          description: { zh: "从本地文件来。", en: "From a local file." },
          git: "https://example.com/demo.git",
          author: "Test",
          tags: ["demo"],
          language: ["en"],
          license: "MIT",
        },
      ]),
    );
    const listed = run(["templates", "--all", "--json"], { FLOWGIT_REGISTRY: registry });
    expect(listed.code, listed.out).toBe(0);
    const json = JSON.parse(listed.stdout) as { bundled: { id: string; source: string }[]; community: { id: string; source: string; git: string }[]; note?: string };
    expect(json.bundled.map((item) => item.id)).toContain("short-video");
    expect(json.bundled.every((item) => item.source === "bundled")).toBe(true);
    expect(json.community).toEqual([expect.objectContaining({ id: "page-demo", source: "community", git: "https://example.com/demo.git" })]);
    expect(json.note).toBeUndefined();

    const text = run(["templates", "--all"], { FLOWGIT_REGISTRY: registry });
    expect(text.code, text.out).toBe(0);
    expect(text.stdout).toContain("page-demo");
    expect(text.stdout).toContain("short-video");

    const missing = path.join(root, "missing", "community.json");
    const fallback = run(["templates", "--all", "--json"], { FLOWGIT_REGISTRY: missing });
    expect(fallback.code, fallback.out).toBe(0);
    const body = JSON.parse(fallback.stdout) as { bundled: { id: string }[]; community: unknown[]; note?: string };
    expect(body.bundled.map((item) => item.id)).toContain("weekly-report");
    expect(body.community).toEqual([]);
    expect(body.note).toBe(COMMUNITY_LIST_NOTE);

    const plain = run(["templates", "--all"], { FLOWGIT_REGISTRY: missing });
    expect(plain.code, plain.out).toBe(0);
    expect(plain.stdout.split("社区模板列表暂时读不到").length - 1).toBe(1);
    expect(plain.stdout).toContain("short-video");
    expect(plain.stdout).not.toContain("page-demo");
  });

  it.skipIf(!hasGit)("init -t a community id clones the registered Git URL, including #path=", () => {
    const repoDir = path.join(root, "src-repo");
    const sub = path.join(repoDir, "examples", "mini");
    const seeded = run(["init", sub, "-t", "weekly-report"]);
    expect(seeded.code, seeded.out).toBe(0);
    const git = (args: string[], cwd: string) => {
      const r = spawnSync("git", ["-c", "user.email=dev@example.com", "-c", "user.name=Flowgit", ...args], { cwd, encoding: "utf8" });
      expect(r.status, `${args.join(" ")}\n${r.stdout}${r.stderr}`).toBe(0);
    };
    git(["init", "-b", "main"], repoDir);
    git(["add", "-A"], repoDir);
    git(["commit", "-m", "init flow"], repoDir);
    const bare = path.join(root, "bare.git");
    git(["clone", "--bare", repoDir, bare], root);
    const url = pathToFileURL(bare).href;
    const registry = path.join(root, "bare-registry.json");
    fs.writeFileSync(
      registry,
      JSON.stringify([
        {
          id: "page-demo",
          name: { zh: "示例页", en: "Demo page" },
          description: { zh: "从本地裸仓库来。", en: "From a local bare repository." },
          git: `${url}#path=examples/mini`,
          author: "Test",
          tags: ["demo"],
          language: ["zh"],
          license: "Apache-2.0",
        },
      ]),
    );

    const direct = path.join(root, "from-fragment");
    const cloned = run(["init", direct, "-t", `${url}#path=examples/mini`]);
    expect(cloned.code, cloned.out).toBe(0);
    expect(cloned.out).toContain(url);
    expect(cloned.out).toContain("examples/mini");
    expect(cloned.out).toContain("node scripts/check-report.mjs");
    expect(fs.existsSync(path.join(direct, "prompts", "draft.md"))).toBe(true);
    const directFlow = JSON.parse(fs.readFileSync(path.join(direct, "flow.json"), "utf8")) as { forkedFrom: { source: string; commit: string } };
    expect(directFlow.forkedFrom.source).toBe(url);
    expect(directFlow.forkedFrom.commit).toMatch(/^[0-9a-f]{40}$/);

    const dest = path.join(root, "from-community");
    const viaId = run(["init", dest, "-t", "page-demo"], { FLOWGIT_REGISTRY: registry });
    expect(viaId.code, viaId.out).toBe(0);
    expect(viaId.out).toContain(url);
    expect(viaId.out).toContain("examples/mini");
    expect(viaId.out).toContain("community template: page-demo");
    expect(viaId.out).toContain("Before you run it, look at what this flow does on your computer:");
    expect(viaId.out).toMatch(/script\s+check\s+node scripts\/check-report\.mjs/);
    expect(fs.existsSync(path.join(dest, "flow.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "prompts", "draft.md"))).toBe(true);
    const flow = JSON.parse(fs.readFileSync(path.join(dest, "flow.json"), "utf8")) as { forkedFrom: { source: string; commit: string } };
    expect(flow.forkedFrom.source).toBe(url);
    expect(flow.forkedFrom.commit).toBe(directFlow.forkedFrom.commit);

    const escape = run(["init", path.join(root, "escape"), "-t", `${url}#path=..`]);
    expect(escape.code).toBe(1);
    expect(escape.out).toContain("must stay inside the repository");
    expect(fs.existsSync(path.join(root, "escape", "flow.json"))).toBe(false);
  });

  it("gallery build writes a home page and a page per bundled template", () => {
    const out = path.join(root, "site");
    const registry = path.join(repo, "registry", "community.json");
    const built = run(["gallery", "build", "--out", out], { FLOWGIT_REGISTRY: registry });
    expect(built.code, built.out).toBe(0);
    const home = fs.readFileSync(path.join(out, "index.html"), "utf8");
    expect(home).toContain('id="q"');
    expect(home).toContain("data-tag=");
    expect(home).toContain("short-video");
    expect(home).toContain("agent-page");
    expect(home).not.toMatch(/<script[^>]+src="https?:/);
    const css = fs.readFileSync(path.join(out, "assets", "gallery.css"), "utf8");
    expect(css).toContain("--ink");
    expect(css).toContain("--accent");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).not.toMatch(/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com/i);

    for (const id of bundledIds()) {
      const html = fs.readFileSync(path.join(out, "templates", id, "index.html"), "utf8");
      expect(html, id).toContain(`flowgit init my-${id} -t ${id}`);
      expect(html, id).toContain("Sources");
      expect(html, id).toContain("<svg");
      expect(html, id).not.toMatch(/cdn\.jsdelivr\.net|unpkg\.com|mermaid\.min\.js/i);
      const skill = fs.readFileSync(path.join(out, "templates", id, "SKILL.md"), "utf8");
      expect(skill, id).toContain("这是一个 Flowgit 流程");
    }
    const slides = fs.readFileSync(path.join(out, "templates", "slides", "index.html"), "utf8");
    const sources = slides.slice(slides.indexOf('id="sources"'));
    expect(sources).toContain("Barbara Minto");
    const agent = fs.readFileSync(path.join(out, "templates", "agent-page", "index.html"), "utf8");
    expect(agent).toContain("flowgit init my-agent-page -t agent-page");
    expect(agent.slice(agent.indexOf('id="sources"'))).toContain("agent 执行器");
    // a relative README link points at the repository, not at a file the static site doesn't have
    expect(agent).toContain('href="https://github.com/cgold9820-dotcom/Flowgit/tree/main/docs/spec.md"');
    expect(agent).not.toContain('href="../../docs/spec.md"');
    // the page shows the title once; the README's own "# title" is left out
    const weekly = fs.readFileSync(path.join(out, "templates", "weekly-report", "index.html"), "utf8");
    expect(weekly).not.toContain('<article class="readme"><h1>');
    // a wide table scrolls inside its wrapper instead of widening a phone screen
    const video = fs.readFileSync(path.join(out, "templates", "short-video", "index.html"), "utf8");
    expect(video).toContain('<div class="table-wrap"><table>');

    const bad = path.join(root, "bad.json");
    fs.writeFileSync(bad, JSON.stringify([{ id: "nope" }]));
    const failed = run(["gallery", "build", "--out", path.join(root, "bad-site")], { FLOWGIT_REGISTRY: bad });
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(/不合法|invalid/);
  });
});
