import { expect, test, type Page } from "@playwright/test";

function card(page: Page, id: string) {
  return page.locator("article.card").filter({ has: page.locator("p.stage-id", { hasText: new RegExp(`^${id}$`) }) });
}

function runButton(page: Page, id: string) {
  return card(page, id).getByRole("button", { name: "运行这一步" });
}

/** Every file the page saved for a flow in the browser's private storage (OPFS). */
async function storedFiles(page: Page, id: string): Promise<string[]> {
  return page.evaluate(async (flowId) => {
    const out: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle, rel);
        else out.push(rel);
      }
    };
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("flows");
    await walk(await root.getDirectoryHandle(flowId), "");
    return out.sort();
  }, id);
}

test("weekly-report 在网页里跑：示例回复写草稿，检查一步说要在电脑上运行 / weekly-report in the browser: demo replies write the draft, and the check says to run it on a computer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("./");
  await expect(page.locator("#mine-empty")).toBeVisible();
  await page.locator('li[data-template="weekly-report"] button').click();
  await expect(page).toHaveURL(/board\.html\?flow=weekly-report$/);

  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  await expect(page.locator("#refresh-hint")).toContainText("实时更新");
  const cards = page.locator("article.card");
  await expect(cards.locator("p.stage-id")).toHaveText(["notes", "draft", "check"]);
  await expect(page.locator("#app-note")).toContainText("要在电脑上运行：检查");
  await expect(page.locator("#app-note")).toContainText("示例回复");

  // Flow input, saved to flowgit.local.json in the browser.
  await page.locator('[data-input="name"]').fill("小林");
  await page.locator("#inputs-save").click();
  await expect(page.locator("#inputs-status")).toContainText("已保存");

  // The person writes notes.md on the page.
  await card(page, "notes").locator("button.thumb", { hasText: "notes.md" }).click();
  const editor = page.locator("#panel textarea");
  await editor.fill("- 修好了导出\n- 补了测试\n");
  await page.locator("#panel button.save").click();
  await expect(page.locator("#panel .save-ok")).toHaveText("已保存");
  await page.locator("#panel-close").click();

  await runButton(page, "notes").click();
  await expect(page.locator("#log")).toContainText("✓ 随手记 → v1");
  await expect(card(page, "notes")).toHaveAttribute("data-state", "ok");

  await runButton(page, "draft").click();
  await expect(page.locator("#log")).toContainText("✓ 周报草稿 → v1");
  await expect(card(page, "draft")).toHaveAttribute("data-state", "ok");
  await expect(card(page, "draft").locator("button.thumb .thumb-text")).toContainText("本周完成");

  await runButton(page, "check").click();
  await expect(page.locator("#log")).toContainText("要在电脑上运行");
  await expect(page.locator("#log")).toContainText("node scripts/check-report.mjs");
  await expect(card(page, "check")).toHaveAttribute("data-state", "error");

  // Everything is kept: reload and the runs are still there.
  await page.reload();
  await expect(card(page, "draft")).toHaveAttribute("data-state", "ok");
  const files = await storedFiles(page, "weekly-report");
  expect(files).toEqual(expect.arrayContaining(["flow.json", "flowgit.local.json", "notes.md", "report.md", "runs/draft/1/run.json", "runs/draft/1/outputs/report.md"]));

  // A hand edit of the draft is kept as a manual version before a re-run.
  await card(page, "draft").locator("button.thumb", { hasText: "report.md" }).click();
  await page.locator("#panel textarea").fill("# 周报\n\n## 本周完成\n- 手改的一行\n");
  await page.locator("#panel button.save").click();
  await expect(page.locator("#panel .save-ok")).toHaveText("已保存");
  await page.locator("#panel-close").click();
  await expect(card(page, "draft")).toHaveAttribute("data-state", "edited");
  await runButton(page, "draft").click();
  // v2 is the hand edit, kept before the re-run writes v3.
  await expect(page.locator("#log")).toContainText("✓ 周报草稿 → v3");
  // "运行结束" comes only after the run's files are in browser storage.
  await expect(page.locator("#log")).toContainText("运行结束");
  await expect(card(page, "draft")).toHaveAttribute("data-state", "ok");
  expect(await storedFiles(page, "weekly-report")).toEqual(expect.arrayContaining(["runs/draft/2/run.json", "runs/draft/3/run.json"]));

  // Back home, the flow is listed.
  await page.locator(".app-home").click();
  await expect(page.locator('#mine li[data-flow="weekly-report"] h3')).toHaveText("周报（入门示例）");
  expect(errors.filter((text) => !/Failed to load resource.*404/.test(text))).toEqual([]);
});

test("key 默认不保存；勾选记住才存进浏览器，永远不写进流程文件 / keys are not saved by default; remember stores them in the browser, never in flow files", async ({ page }) => {
  await page.goto("./");
  await page.locator('li[data-template="weekly-report"] button').click();
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  await page.locator("#app-keys").click();
  await page.locator("#keys-vendor").selectOption("deepseek");
  await page.locator("#keys-key").fill("sk-test-not-a-real-key");
  await page.locator("#keys-save").click();
  expect(await page.evaluate(() => localStorage.getItem("flowgit.app.keys"))).toBeNull();
  await page.reload();
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  await page.locator("#app-keys").click();
  await expect(page.locator("#keys-dialog")).toBeVisible();
  await expect(page.locator("#keys-key")).toHaveValue("");
  await page.locator("#keys-key").fill("sk-test-not-a-real-key");
  await page.locator("#keys-remember").check();
  await page.locator("#keys-save").click();
  expect(await page.evaluate(() => localStorage.getItem("flowgit.app.keys"))).toContain("sk-test-not-a-real-key");
  const stored = await page.evaluate(async () => {
    const texts: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle) => {
      for await (const [, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle);
        else texts.push(await (await (handle as FileSystemFileHandle).getFile()).text());
      }
    };
    await walk(await navigator.storage.getDirectory());
    return texts.join("\n");
  });
  expect(stored).not.toContain("sk-test-not-a-real-key");
  await page.locator("#app-keys").click();
  await page.locator("#keys-forget").click();
  await page.locator("#keys-cancel").click();
  expect(await page.evaluate(() => localStorage.getItem("flowgit.app.keys"))).toBeNull();
});
