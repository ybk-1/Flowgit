import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_PLACEHOLDER_LINE,
  buildSite,
  findDeadLinks,
  headersFor,
  mergeAppHeaders,
  parseHeadersFile,
} from "./commands/site.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const cli = path.join(here, "..", "dist", "index.js");
const appDist = path.join(repo, "packages", "app", "dist");
const appHeadersPath = path.join(appDist, "_headers");

function cspOf(text: string, requestPath: string): string | undefined {
  return headersFor(text, requestPath).get("content-security-policy");
}

describe("site headers", () => {
  it("gives /app/* the app policy alone, and does not repeat the headers /* already sends", () => {
    const app = [
      "/*",
      "  Content-Security-Policy: default-src 'none'; connect-src https://api.example.com",
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: no-referrer",
      "",
    ].join("\n");
    const merged = mergeAppHeaders(app);
    const rules = parseHeadersFile(merged);
    const site = rules.find((rule) => rule.path === "/*");
    const appRule = rules.find((rule) => rule.path === "/app/*");
    expect(site?.lines.some((line) => line.name === "Content-Security-Policy")).toBe(false);
    expect(appRule?.lines).toEqual([
      { name: "Content-Security-Policy", value: "default-src 'none'; connect-src https://api.example.com", unset: false },
    ]);
    expect(cspOf(merged, "/app/index.html")).toBe("default-src 'none'; connect-src https://api.example.com");
    expect(cspOf(merged, "/index.html")).toBeUndefined();
    // Nothing is comma-joined on the app's pages.
    const onApp = headersFor(merged, "/app/board.html");
    expect(onApp.get("x-content-type-options")).toBe("nosniff");
    expect(onApp.get("referrer-policy")).toBe("no-referrer");
  });

  it("fails when the app sets a site header to another value, which Pages would join", () => {
    const app = ["/*", "  Content-Security-Policy: default-src 'none'", "  Referrer-Policy: same-origin", ""].join("\n");
    expect(() => mergeAppHeaders(app)).toThrow(/Referrer-Policy.*would join/s);
  });
});

describe("flowgit site build", () => {
  it("writes the home page, gallery, a doc, the schema, and no dead internal links", async () => {
    if (!fs.existsSync(appHeadersPath)) throw new Error("Build the web app first: pnpm build");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-site-"));
    const lines: string[] = [];
    try {
      const result = await buildSite({ outDir: out, cwd: repo, repoRoot: repo, log: (line) => lines.push(line) });
      expect(result.placeholder).toBe(false);
      expect(lines).not.toContain(APP_PLACEHOLDER_LINE);

      const home = fs.readFileSync(path.join(out, "index.html"), "utf8");
      expect(home).toContain('data-site-lang-btn="zh"');
      expect(home).toContain('data-site-lang-btn="en"');
      expect(home).toContain('href="/docs/"');
      expect(home).toContain('href="/gallery/"');
      expect(home).toContain('href="/app/"');
      expect(home).toContain('data-copy="flowgit init"');

      const gallery = fs.readFileSync(path.join(out, "gallery", "index.html"), "utf8");
      expect(gallery).toContain('id="q"');
      expect(gallery).toContain("short-video");
      expect(fs.existsSync(path.join(out, "gallery", "templates", "weekly-report", "index.html"))).toBe(true);

      const guide = fs.readFileSync(path.join(out, "docs", "guide", "index.html"), "utf8");
      expect(guide).toContain("周报");
      expect(guide).toContain('aria-label="目录"');
      expect(guide).toContain('href="/docs/spec/"');
      expect(guide).not.toContain('href="../');
      expect(guide).toContain('href="/assets/site.css"');

      const schema = fs.readFileSync(path.join(out, "schema", "flow", "0.1.json"), "utf8");
      expect(schema).toBe(fs.readFileSync(path.join(repo, "packages", "core", "schema", "flow.schema.json"), "utf8"));

      const spec = fs.readFileSync(path.join(out, "docs", "spec", "index.html"), "utf8");
      expect(spec).toContain('href="/schema/flow/0.1.json"');

      const css = fs.readFileSync(path.join(out, "assets", "site.css"), "utf8");
      expect(css).toContain("prefers-color-scheme: dark");
      expect(css).toContain("max-width: 720px");

      const appHeaders = fs.readFileSync(appHeadersPath, "utf8");
      const appCsp = cspOf(appHeaders, "/index.html");
      expect(appCsp).toBeTruthy();
      const siteHeaders = fs.readFileSync(path.join(out, "_headers"), "utf8");
      expect(cspOf(siteHeaders, "/app/index.html")).toBe(appCsp);
      expect(cspOf(siteHeaders, "/index.html")).toBeUndefined();
      for (const [name, value] of headersFor(siteHeaders, "/app/index.html")) expect(value, name).not.toContain(",");
      expect(fs.existsSync(path.join(out, "app", "_headers"))).toBe(false);

      const appHome = fs.readFileSync(path.join(out, "app", "index.html"), "utf8");
      const refs = [...appHome.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1] ?? "");
      const local = refs.filter((ref) => ref && !ref.startsWith("#") && !/^(https?:|mailto:|data:)/i.test(ref));
      expect(local.length).toBeGreaterThan(0);
      for (const ref of local) {
        expect(ref.startsWith("/"), ref).toBe(false);
        const file = path.resolve(path.join(out, "app"), (ref.split("#")[0] ?? ref).split("?")[0] ?? ref);
        expect(fs.existsSync(file), ref).toBe(true);
      }

      const published = JSON.parse(fs.readFileSync(path.join(out, "registry.json"), "utf8")) as { id: string }[];
      expect(published.map((item) => item.id)).toContain("agent-page");
      expect(findDeadLinks(out)).toEqual([]);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("writes a bilingual /app/ placeholder when the web app build is missing", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-site-ph-"));
    const lines: string[] = [];
    try {
      const result = await buildSite({
        outDir: out,
        cwd: repo,
        repoRoot: repo,
        appDist: path.join(out, "missing-app-dist"),
        log: (line) => lines.push(line),
      });
      expect(result.placeholder).toBe(true);
      expect(lines).toEqual([APP_PLACEHOLDER_LINE]);
      const page = fs.readFileSync(path.join(out, "app", "index.html"), "utf8");
      expect(page).toContain("网页版即将上线");
      expect(page).toContain("The web app is coming soon");
      expect(findDeadLinks(out)).toEqual([]);
      // An earlier site build may be replaced.
      await buildSite({ outDir: out, cwd: repo, repoRoot: repo, appDist: path.join(out, "missing-app-dist") });
      expect(fs.existsSync(path.join(out, "app", "index.html"))).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses to replace a directory that is not an earlier site build, or one that holds the repo", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-site-keep-"));
    try {
      fs.writeFileSync(path.join(out, "notes.md"), "keep me");
      await expect(buildSite({ outDir: out, cwd: repo, repoRoot: repo })).rejects.toThrow(/nothing was deleted/);
      expect(fs.readFileSync(path.join(out, "notes.md"), "utf8")).toBe("keep me");
      await expect(buildSite({ outDir: path.dirname(repo), cwd: repo, repoRoot: repo })).rejects.toThrow(/cannot contain the repository/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("the site command is registered", () => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-site-cli-"));
    try {
      const ran = spawnSync(process.execPath, [cli, "site", "build", "--out", out], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      });
      expect(ran.status, `${ran.stdout}${ran.stderr}`).toBe(0);
      expect(`${ran.stdout}${ran.stderr}`).toContain("已生成官网");
      expect(fs.existsSync(path.join(out, "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(out, "gallery", "index.html"))).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
