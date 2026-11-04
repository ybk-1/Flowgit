import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const release = path.resolve(here, "..", "release");

function packagedBinary(): string {
  const candidates = [
    path.join(release, "win-unpacked", "Flowgit.exe"),
    path.join(release, "linux-unpacked", "flowgit"),
    path.join(release, "linux-unpacked", "Flowgit"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error(`找不到打包后的程序 / packaged app not found under ${release}. Run: node scripts/package.mjs`);
  return found;
}

async function launch(userData: string): Promise<ElectronApplication> {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, "language.json"), JSON.stringify({ lang: "zh" }));
  return electron.launch({
    executablePath: packagedBinary(),
    args: [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      FLOWGIT_HOME: userData,
    },
  });
}

async function home(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("不用命令行");
  return page;
}

test("首页、从模板新建、看到看板 / home, create from a template, see the board", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-desktop-e2e-"));
  const flows = path.join(userData, "flows");
  fs.mkdirSync(flows, { recursive: true });
  const app = await launch(userData);
  try {
    const page = await home(app);
    await app.evaluate(({ dialog }, parent) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] });
    }, flows);
    const boardPromise = app.waitForEvent("window");
    await page.getByRole("button", { name: /weekly-report/ }).click();
    const board = await boardPromise;
    await expect(board.locator("#flow-name")).toHaveText("周报（入门示例）");
    await expect(board.locator("article.card")).toHaveCount(3);
    expect(board.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+$/);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("窗口不会打开别的网站，外部链接走 shell.openExternal / windows stay in the app and external links use shell.openExternal", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-desktop-nav-"));
  const app = await launch(userData);
  try {
    const page = await home(app);
    await app.evaluate(({ shell }) => {
      (globalThis as { __opened?: string[] }).__opened = [];
      shell.openExternal = (url: string) => {
        ((globalThis as { __opened?: string[] }).__opened ??= []).push(url);
        return Promise.resolve();
      };
    });

    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "https://example.com/desktop-external";
      link.textContent = "out";
      document.body.append(link);
      link.click();
    });
    await expect.poll(async () => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])).toContain(
      "https://example.com/desktop-external",
    );
    expect(page.url()).toMatch(/^flowgit:\/\/app\//);

    await page.evaluate(() => {
      window.open("https://evil.test/new-window");
      window.open("file:///etc/passwd");
      window.open("javascript:alert(1)");
    });
    await expect.poll(async () => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])).toContain(
      "https://evil.test/new-window",
    );
    const opened = await app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []);
    expect(opened.some((url) => url.startsWith("file:"))).toBe(false);
    expect(opened.some((url) => url.startsWith("javascript:"))).toBe(false);
    expect(page.url()).toMatch(/^flowgit:\/\/app\//);
    expect(app.windows()).toHaveLength(1);

    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const settings = win.webContents.getLastWebPreferences();
      return {
        contextIsolation: settings.contextIsolation,
        nodeIntegration: settings.nodeIntegration,
        sandbox: settings.sandbox,
      };
    });
    expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    const bridge = await page.evaluate(() => {
      const api = (window as unknown as { flowgit?: Record<string, unknown> }).flowgit;
      return {
        keys: api ? Object.keys(api).sort() : [],
        node: typeof (window as unknown as { require?: unknown }).require,
      };
    });
    expect(bridge.node).toBe("undefined");
    expect(bridge.keys).toEqual(["createFromTemplate", "doctor", "openFolder", "openRecent", "recent", "templates"]);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
