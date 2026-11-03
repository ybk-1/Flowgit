import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "cli", "dist", "index.js");
const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "cli", "templates", "weekly-report");

/** `flowgit board` on a copy of weekly-report; resolves with the link it prints. */
async function localBoard(args: string[]): Promise<{ link: string; child: ChildProcess; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-app-e2e-board-"));
  fs.cpSync(template, dir, { recursive: true });
  const child = spawn(process.execPath, [cli, "board", "--no-open", "--port", "0", ...args], {
    cwd: dir,
    env: { ...process.env, FLOWGIT_HOME: dir, NO_COLOR: "1" },
  });
  const link = await new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+/.exec(out);
      if (found) resolve(found[0]);
    });
    child.on("exit", (code) => reject(new Error(`flowgit board exited (${code})`)));
  });
  return { link, child, dir };
}
/** The bundled weekly-report template, as the build wrote it: { files: { rel: base64 } }. */
function templateFiles(): Record<string, string> {
  return (JSON.parse(fs.readFileSync(path.join(dist, "templates", "weekly-report.json"), "utf8")) as { files: Record<string, string> }).files;
}

// Keep tests offline: GitHub answers from fixtures. A test can add its own routes on top.
test.beforeEach(async ({ page }) => {
  await page.route("https://flowgit.dev/registry.json", (route) =>
    route.fulfill({
      json: [
        {
          id: "weekly-copy",
          name: { zh: "周报（社区副本）", en: "Weekly report (community copy)" },
          description: { zh: "测试用", en: "for tests" },
          git: "https://github.com/someone/flows.git#path=weekly",
        },
      ],
    }),
  );
});

/** Answer GitHub's API and raw files for someone/flows with the weekly-report template under weekly/. */
async function fakeGitHub(page: Page): Promise<void> {
  const files = templateFiles();
  await page.route("https://api.github.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/repos/someone/flows") return route.fulfill({ json: { default_branch: "main" } });
    if (url.pathname === "/repos/someone/flows/commits/main") return route.fulfill({ json: { sha: "abc123" } });
    if (url.pathname === "/repos/someone/flows/git/trees/abc123") {
      return route.fulfill({ json: { tree: Object.keys(files).map((rel) => ({ path: `weekly/${rel}`, type: "blob", size: 100 })) } });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.route("https://raw.githubusercontent.com/someone/flows/abc123/**", (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace("/someone/flows/abc123/weekly/", ""));
    const b64 = files[rel];
    return b64 === undefined ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ body: Buffer.from(b64, "base64") });
  });
}

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

// The board side of folder mode (writes reach the folder, `flowgit status` sees page edits, CLI changes
// reach the page) is tested against a real folder and the real CLI in src/folder.test.ts. Here: the home
// page. (A stand-in folder from OPFS can't go further: reading an OPFS handle back from IndexedDB closes
// the page in headless Chromium, while handles from the real picker are meant to be kept there.)
test("首页打开文件夹：不是流程就说明；浏览器不支持就提示 / home: a folder that isn't a flow is explained, and browsers without folders are told so", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle("empty-folder", { create: true });
  });
  await page.goto("./");
  await expect(page.locator("#folders-unsupported")).toBeHidden();
  await page.locator("#open-folder").click();
  await expect(page.locator("#home-note")).toContainText("没有 flow.json 或 flow.md");
  await expect(page).toHaveURL(/index\.html$|\/$/);

  const other = await page.context().newPage();
  await other.addInitScript(() => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  await other.goto("./");
  await expect(other.locator("#folders-unsupported")).toBeVisible();
  await expect(other.locator("#open-folder")).toBeHidden();
});

test("导出 zip 再导入，版本都在 / export a zip and import it back, versions included", async ({ page }) => {
  await page.goto("./");
  await page.locator('li[data-template="weekly-report"] button').click();
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  await page.locator('[data-input="name"]').fill("小林");
  await page.locator("#inputs-save").click();
  await expect(page.locator("#inputs-status")).toContainText("已保存");
  await card(page, "notes").locator("button.thumb", { hasText: "notes.md" }).click();
  await page.locator("#panel textarea").fill("- 导出前写的\n");
  await page.locator("#panel button.save").click();
  await expect(page.locator("#panel .save-ok")).toHaveText("已保存");
  await page.locator("#panel-close").click();
  await runButton(page, "notes").click();
  await expect(page.locator("#log")).toContainText("运行结束");

  const download = page.waitForEvent("download");
  await page.locator("#app-export").click();
  const zip = await (await download).path();
  expect((await download).suggestedFilename()).toBe("weekly-report.zip");

  await page.goto("./");
  await page.locator("#zip-input").setInputFiles(zip);
  await expect(page).toHaveURL(/board\.html\?flow=weekly-report-2/);
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  await expect(card(page, "notes").locator("button.thumb .thumb-text")).toContainText("导出前写的");
  await card(page, "notes").getByRole("button", { name: "历史" }).click();
  await expect(page.locator("#panel")).toContainText("v1");
});

test("从 GitHub 和社区模板复制：记下来源，只复制流程文件 / copy from GitHub and the community list: the source is recorded and only flow files are copied", async ({ page }) => {
  await fakeGitHub(page);
  await page.goto("./");
  await page.locator("#github-url").fill("https://github.com/someone/flows/tree/main/weekly");
  await page.locator("#github-copy").click();
  await expect(page).toHaveURL(/board\.html\?flow=weekly-report$/);
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  const flowJson = await page.evaluate(async () => {
    const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("flows")).getDirectoryHandle("weekly-report");
    return (await (await root.getFileHandle("flow.json")).getFile()).text();
  });
  expect(JSON.parse(flowJson)).toMatchObject({ forkedFrom: { source: "https://github.com/someone/flows.git", ref: "main", commit: "abc123" } });

  await page.goto("./");
  await expect(page.locator('li[data-community="weekly-copy"] h3')).toHaveText("周报（社区副本）");
  await page.locator('li[data-community="weekly-copy"] button').click();
  await expect(page).toHaveURL(/board\.html\?flow=weekly-report-2$/);
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
});

// The whole handoff (a folder flow, the stage run by the local board, its files back on the page) is
// tested with the real CLI in src/folder.test.ts. Here: the browser really calls the local board across
// origins, and the board answers only the origins it allows.
test("连接本机看板：允许的网页能连上，其他网页连不上 / connecting the local board: an allowed page reaches it, others can't", async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL!).origin;
  const allowed = await localBoard(["--allow-origin", appOrigin]);
  const closed = await localBoard([]);
  try {
    await page.goto("./");
    await page.locator('li[data-template="weekly-report"] button').click();
    await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
    await expect(page.locator("#app-note")).toContainText("可以连接本机看板");

    // A board that only allows https://flowgit.dev: the browser blocks the answer.
    await page.locator("#app-local").click();
    await page.locator("#local-link").fill(closed.link);
    await page.locator("#local-connect").click();
    await expect(page.locator("#local-status")).toContainText("连不上本机看板");
    await expect(page.locator("#app-local")).not.toHaveClass(/\bon\b/);

    // Not a link to this computer: refused before anything is sent.
    await page.locator("#local-link").fill("http://192.168.1.5:4747/?token=0123456789abcdef");
    await page.locator("#local-connect").click();
    await expect(page.locator("#local-status")).toContainText("链接要指向这台电脑");

    // The board started with --allow-origin answers. This flow lives in the browser, so the page says
    // to save it to a folder first, and a run of the script stage says the same.
    await page.locator("#local-link").fill(allowed.link);
    await page.locator("#local-connect").click();
    await expect(page.locator("#local-status")).toContainText("存到文件夹");
    await expect(page.locator("#app-local")).toHaveClass(/\bon\b/);
    await page.locator("#local-cancel").click();
    await expect(page.locator("#app-note")).toContainText("交给本机看板运行：检查");
    // Get check's upstreams done in the browser (demo replies) so it can run.
    await page.locator('[data-input="name"]').fill("小林");
    await page.locator("#inputs-save").click();
    await expect(page.locator("#inputs-status")).toContainText("已保存");
    await card(page, "notes").locator("button.thumb", { hasText: "notes.md" }).click();
    await page.locator("#panel textarea").fill("- 修好了导出\n");
    await page.locator("#panel button.save").click();
    await expect(page.locator("#panel .save-ok")).toHaveText("已保存");
    await page.locator("#panel-close").click();
    await runButton(page, "notes").click();
    await expect(card(page, "notes")).toHaveAttribute("data-state", "ok");
    await runButton(page, "draft").click();
    await expect(card(page, "draft")).toHaveAttribute("data-state", "ok");
    await runButton(page, "check").click();
    await expect(page.locator("#log")).toContainText("交给电脑上的本机看板运行");
    await expect(page.locator("#log")).toContainText("先点“存到文件夹”");
    // Nothing ran on the computer.
    expect(fs.existsSync(path.join(allowed.dir, "runs", "check"))).toBe(false);

    await page.locator("#app-local").click();
    await page.locator("#local-forget").click();
    await page.locator("#local-cancel").click();
    await expect(page.locator("#app-note")).toContainText("可以连接本机看板");
  } finally {
    for (const board of [allowed, closed]) {
      const exited = new Promise((resolve) => (board.child.exitCode !== null ? resolve(null) : board.child.once("exit", resolve)));
      board.child.kill();
      await exited;
      fs.rmSync(board.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});
