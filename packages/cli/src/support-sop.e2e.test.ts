import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the built CLI (dist/) against the bundled support-sop template,
// with canned model replies instead of real model calls.
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");

let work: string;
let flowDir: string;

function flowgit(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, "-C", flowDir, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function textFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith(".")) continue;
      const child = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (fs.statSync(child).isDirectory()) walk(child, childRel);
      else if (/\.(md|txt)$/i.test(name)) out.push(childRel.split(path.sep).join("/"));
    }
  };
  walk(dir, "");
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

beforeAll(() => {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-sop-e2e-"));
  flowDir = path.join(work, "support");
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("flowgit CLI with the support-sop template", () => {
  it("creates a valid flow and stops at the knowledge stage", () => {
    const init = spawnSync(process.execPath, [cli, "init", flowDir, "-t", "support-sop"], { encoding: "utf8" });
    expect(init.status, init.stderr).toBe(0);
    expect(fs.existsSync(path.join(flowDir, "flow.json"))).toBe(true);
    expect(fs.existsSync(path.join(flowDir, "example-knowledge"))).toBe(true);
    expect(fs.existsSync(path.join(flowDir, "demo-replies"))).toBe(true);
    expect(flowgit(["validate"])).toMatchObject({ code: 0 });
    expect(flowgit(["status"]).out).toContain("flow inputs not set: product");

    expect(flowgit(["inputs", "set", "product=澄光台灯"]).code).toBe(0);
    const waiting = flowgit(["run", "all"]);
    expect(waiting.code, waiting.out).toBe(2);
    expect(waiting.out).toContain("waiting for you: knowledge");
    expect(waiting.out).toContain("example-knowledge");
    expect(fs.existsSync(path.join(flowDir, "knowledge"))).toBe(false);
  });

  it("merges knowledge, runs the demo replies, and writes a skill", () => {
    fs.cpSync(path.join(flowDir, "example-knowledge"), path.join(flowDir, "knowledge"), { recursive: true });
    const r = flowgit(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("knowledge.md：合并了");

    const knowledgeMd = fs.readFileSync(path.join(flowDir, "knowledge.md"), "utf8");
    const names = textFiles(path.join(flowDir, "example-knowledge"));
    expect(names.length).toBeGreaterThan(0);
    let cursor = -1;
    for (const name of names) {
      const heading = knowledgeMd.indexOf(`## ${name}`);
      expect(heading, name).toBeGreaterThan(cursor);
      cursor = heading;
      const body = fs.readFileSync(path.join(flowDir, "example-knowledge", ...name.split("/")), "utf8").trim();
      expect(knowledgeMd).toContain(body);
    }

    const sop = fs.readFileSync(path.join(flowDir, "sop.md"), "utf8").trim();
    expect(sop.length).toBeGreaterThan(0);
    const skill = fs.readFileSync(path.join(flowDir, "skill", "SKILL.md"), "utf8");
    const skillLines = skill.split(/\r?\n/);
    // Skill format: frontmatter whose first field is `name:`, then the SOP as the body.
    expect(skillLines[0]).toBe("---");
    expect(skillLines[1]).toMatch(/^name: \S/);
    expect(skillLines[2]).toMatch(/^description: /);
    expect(skillLines[3]).toBe("---");
    expect(skill).toContain(sop);
    expect(skill).toContain("澄光台灯");

    const cases = JSON.parse(fs.readFileSync(path.join(flowDir, "cases.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(typeof item.customer).toBe("string");
      expect(String(item.customer).length).toBeGreaterThan(0);
      expect(typeof item.intent).toBe("string");
      expect(String(item.intent).length).toBeGreaterThan(0);
      expect(typeof item.expected).toBe("string");
      expect(String(item.expected).length).toBeGreaterThan(0);
    }
    expect(JSON.parse(fs.readFileSync(path.join(flowDir, "skill", "cases.json"), "utf8"))).toEqual(cases);

    const report = fs.readFileSync(path.join(flowDir, "report.md"), "utf8");
    expect(report).toContain(String(cases[0].customer));
    expect(report.length).toBeGreaterThan(80);

    const status = JSON.parse(flowgit(["status", "--json"]).out) as { stages: { id: string; state: string }[] };
    expect(status.stages.map((s) => s.id)).toEqual(["knowledge", "collect", "sop", "cases", "check", "skill"]);
    expect(status.stages.map((s) => s.state)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });

  it("keeps a hand edit of sop.md and marks downstream stages stale", () => {
    const sopFile = path.join(flowDir, "sop.md");
    fs.appendFileSync(sopFile, "\n\n## 补充：发票\n\n电子发票在订单完成后 3 个工作日内发到下单邮箱。\n");
    const status = JSON.parse(flowgit(["status", "--json"]).out) as { stages: { state: string }[] };
    expect(status.stages.map((s) => s.state)).toEqual(["ok", "ok", "edited", "stale", "stale", "stale"]);

    const again = flowgit(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain("kept your manual edit as v2");
    const sop = fs.readFileSync(sopFile, "utf8");
    expect(sop).toContain("## 补充：发票");
    expect(fs.readFileSync(path.join(flowDir, "skill", "SKILL.md"), "utf8")).toContain("## 补充：发票");
    expect(flowgit(["log", "sop"]).out).toMatch(/v2\s+ok\s+\S+ \S+\s+manual/);
  });

  it("speaks the language input in script output and rejects other languages", () => {
    const en = flowgit(["run", "collect", "--input", "language=en"]);
    expect(en.code, en.out).toBe(0);
    expect(en.out).toContain("knowledge.md: merged");
    expect(fs.readFileSync(path.join(flowDir, "knowledge.md"), "utf8")).toContain("# Knowledge");

    const skill = flowgit(["run", "skill", "--input", "language=en"]);
    expect(skill.code, skill.out).toBe(0);
    expect(skill.out).toContain("skill/SKILL.md: wrote the support skill");
    const text = fs.readFileSync(path.join(flowDir, "skill", "SKILL.md"), "utf8");
    expect(text.split(/\r?\n/)[1]).toMatch(/^name: /);
    expect(text).toContain("support SOP");

    const bad = flowgit(["run", "collect", "--input", "language=fr"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('Input "language" must be one of "zh", "en"');
  });
});
