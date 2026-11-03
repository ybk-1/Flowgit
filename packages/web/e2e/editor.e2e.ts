import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlowMd, type Flow } from "@flowgit/core";
import { expect, test, type Page } from "@playwright/test";
import { openBoard } from "./board.js";
import { startBoard } from "../dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const shots = "/cursor/stores/bc-a1e62cfe-b318-47b6-a6d1-688f53360f71/media";

async function drag(page: Page, fromId: string, toId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const from = page.locator(`.flow-node[data-id="${fromId}"]`);
    const to = page.locator(`.flow-node[data-id="${toId}"]`);
    await expect(from).toBeVisible();
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) continue;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
    await page.mouse.up();
    return;
  }
  throw new Error(`could not drag ${fromId} -> ${toId}`);
}

test("流程图上编辑：加依赖、改提示词、加 enum，环被拒绝，flow.md 还是 flow.md / edit on the graph: add an edge, edit a prompt, add an enum; a cycle is refused; flow.md stays flow.md", async ({ page }) => {
  const session = await openBoard("weekly-report", { markdown: true });
  try {
    expect(fs.existsSync(path.join(session.dir, "flow.md"))).toBe(true);
    expect(fs.existsSync(path.join(session.dir, "flow.json"))).toBe(false);
    await page.goto(session.url);
    await page.locator("#view-graph").click();
    await page.locator('button[data-style="flat"]').click();
    await page.locator("#graph-edit").click();
    await expect(page.locator("#graph-edit")).toHaveAttribute("aria-pressed", "true");

    await drag(page, "notes", "check");
    await expect(page.locator("#graph-edit-status")).toContainText("已加上依赖");

    await page.locator("#board").scrollIntoViewIfNeeded();
    const notes = page.locator('.flow-node[data-id="notes"]');
    await expect(notes).toBeVisible();
    const notesBox = await notes.boundingBox();
    if (!notesBox) throw new Error("notes box missing");
    const beforeMove = fs.readFileSync(path.join(session.dir, "flow.md"));
    await page.mouse.move(notesBox.x + 30, notesBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(notesBox.x + 30, Math.max(8, notesBox.y - 90), { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("flowgit.board.nodePos")))).toBe(true);
    expect(fs.readFileSync(path.join(session.dir, "flow.md"))).toEqual(beforeMove);

    await page.locator('.flow-node[data-id="draft"]').click();
    const prompt = page.locator("#edit-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).not.toHaveValue("");
    await prompt.fill("看板改过 {{");
    await prompt.dispatchEvent("input");
    await expect(page.locator(".prompt-option", { hasText: "{{inputs.name}}" })).toBeVisible();
    await page.locator(".prompt-option", { hasText: "{{inputs.name}}" }).click();
    await expect(prompt).toHaveValue("看板改过 {{inputs.name}}");
    await page.locator("#edit-save").click();
    await expect(page.locator("#edit-status")).toContainText("已保存");
    expect(fs.readFileSync(path.join(session.dir, "prompts", "draft.md"), "utf8")).toBe("看板改过 {{inputs.name}}");

    await page.locator("#board").scrollIntoViewIfNeeded();
    fs.mkdirSync(shots, { recursive: true });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(scheme);
      await page.screenshot({ path: path.join(shots, `flow-editor-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });

    await page.locator("#edit-flow").click();
    await page.locator("#edit-add-input").click();
    const row = page.locator("[data-input-row]").last();
    await row.locator("[data-field=name]").fill("tone");
    await row.locator("[data-field=type]").selectOption("string");
    await row.locator("[data-field=enum]").fill("calm, bold");
    await row.locator("[data-field=default]").fill("calm");
    await row.locator("[data-field=description]").fill("语气");
    await page.locator("#edit-flow-save").click();
    await expect(page.locator("#edit-status")).toContainText("已保存");

    const validated = spawnSync(process.execPath, [cli, "-C", session.dir, "validate"], { encoding: "utf8" });
    expect(validated.status, `${validated.stdout}\n${validated.stderr}`).toBe(0);

    await page.locator("#panel-close").click();
    await expect(page.locator("#panel")).toBeHidden();
    await expect(page.locator(".flow-node")).toHaveCount(3);
    await drag(page, "check", "notes");
    await expect(page.locator("#graph-edit-status")).toContainText("会形成环");

    expect(fs.existsSync(path.join(session.dir, "flow.json"))).toBe(false);
    const text = fs.readFileSync(path.join(session.dir, "flow.md"), "utf8");
    const saved = parseFlowMd(text) as unknown as Flow;
    expect(text.startsWith("---")).toBe(true);
    expect(saved.inputs?.tone).toMatchObject({ type: "string", enum: ["calm", "bold"], default: "calm" });
    expect(saved.stages.find((stage) => stage.id === "check")?.inputs).toEqual(["draft", "notes"]);
    expect(saved.stages.find((stage) => stage.id === "notes")?.inputs).toBeUndefined();
    expect(saved.stages.find((stage) => stage.id === "draft")?.executor).toMatchObject({
      type: "llm",
      prompt: "prompts/draft.md",
      effort: "low",
    });
    expect(fs.existsSync(path.join(shots, "flow-editor-light.png"))).toBe(true);
    expect(fs.existsSync(path.join(shots, "flow-editor-dark.png"))).toBe(true);
  } finally {
    await session.close();
  }
});

test("运行中保存会说明要等运行结束 / saving during a run says to wait until it finishes", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-e2e-edit-busy-"));
  fs.writeFileSync(
    path.join(dir, "flow.json"),
    JSON.stringify(
      {
        format: "flowgit",
        version: "0.1",
        name: "slow",
        stages: [
          {
            id: "slow",
            name: "慢",
            executor: { type: "script", run: "node slow.cjs" },
            outputs: [{ type: "text/plain", path: "out.txt" }],
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "slow.cjs"),
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync("started", "1");',
      "const timer = setInterval(() => {",
      '  if (!fs.existsSync("go")) return;',
      "  clearInterval(timer);",
      '  fs.writeFileSync("out.txt", "ok\\n");',
      "  process.exit(0);",
      "}, 50);",
      "",
    ].join("\n"),
  );
  const server = await startBoard({ dir, port: 0, open: false });
  try {
    await page.goto(server.url);
    await page.locator("#view-graph").click();
    await page.locator('button[data-style="flat"]').click();
    await page.locator("#graph-edit").click();
    await page.locator("#run-all").click();
    await expect.poll(() => fs.existsSync(path.join(dir, "started")), { timeout: 15000 }).toBe(true);
    await page.locator('.flow-node[data-id="slow"]').click({ force: true });
    await page.locator("#edit-name").fill("更慢");
    await page.locator("#edit-save").click();
    await expect(page.locator("#edit-status")).toContainText("正在运行");
    const flow = JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")) as { stages: Array<{ name: string }> };
    expect(flow.stages[0]?.name).toBe("慢");
    fs.writeFileSync(path.join(dir, "go"), "1");
    await expect(page.locator("#log")).toContainText("运行结束");
  } finally {
    try {
      fs.writeFileSync(path.join(dir, "go"), "1");
    } catch {
      // already written
    }
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
