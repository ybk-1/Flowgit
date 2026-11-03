import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { startBoard } from "../dist/index.js";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const templates = path.join(repoRoot, "packages", "cli", "templates");

export interface BoardSession {
  dir: string;
  url: string;
  close: () => Promise<void>;
}

/**
 * Copy a bundled template into a temp directory, point canned replies at that
 * copy, and start the board in-process on a random port. `close` stops the
 * server and deletes the temp directory.
 */
export async function openBoard(template: string): Promise<BoardSession> {
  const src = path.join(templates, template);
  if (!fs.existsSync(path.join(src, "flow.json"))) throw new Error(`找不到模板 / template not found: ${template}`);
  if (!fs.existsSync(path.join(webRoot, "dist", "index.js"))) {
    throw new Error("先编译看板 / build the board first: pnpm build");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `flowgit-e2e-${template}-`));
  fs.cpSync(src, dir, { recursive: true });
  const previousMock = process.env.FLOWGIT_LLM_MOCK_DIR;
  const hadTts = Object.prototype.hasOwnProperty.call(process.env, "FLOWGIT_TTS_API_KEY");
  const previousTts = process.env.FLOWGIT_TTS_API_KEY;
  process.env.FLOWGIT_LLM_MOCK_DIR = path.join(dir, "demo-replies");
  delete process.env.FLOWGIT_TTS_API_KEY;

  const restoreEnv = () => {
    if (previousMock === undefined) delete process.env.FLOWGIT_LLM_MOCK_DIR;
    else process.env.FLOWGIT_LLM_MOCK_DIR = previousMock;
    if (!hadTts) delete process.env.FLOWGIT_TTS_API_KEY;
    else process.env.FLOWGIT_TTS_API_KEY = previousTts;
  };

  try {
    const server = await startBoard({ dir, port: 0, open: false });
    let closed = false;
    return {
      dir,
      url: server.url,
      close: async () => {
        if (closed) return;
        closed = true;
        await server.close();
        restoreEnv();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    restoreEnv();
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

export function card(page: Page, id: string) {
  return page.locator("article.card").filter({ has: page.locator("p.stage-id", { hasText: new RegExp(`^${id}$`) }) });
}

export function runButton(page: Page, id: string) {
  return card(page, id).getByRole("button", { name: "运行这一步" });
}

/** Click a stage's Run button and wait until SSE reports it finished and the board is idle. */
export async function runStageUntilDone(page: Page, id: string, doneMark: string) {
  await runButton(page, id).click();
  await expect(page.locator("#log")).toContainText(doneMark);
  await expect(page.locator("#run-all")).toBeEnabled();
  await expect(card(page, id)).toHaveAttribute("data-state", "ok");
}

export async function saveInputs(page: Page) {
  await page.locator("#inputs-save").click();
  await expect(page.locator("#inputs-status")).toContainText("已保存");
}

export function readLocalInputs(dir: string): Record<string, unknown> {
  const file = path.join(dir, "flowgit.local.json");
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { inputs?: Record<string, unknown> };
  return parsed.inputs ?? {};
}

/** Full-page light and dark shots, kept as test attachments and under /tmp for the report. */
export async function shootThemes(page: Page, testInfo: TestInfo) {
  const dir = "/tmp/flowgit-board-e2e";
  fs.mkdirSync(dir, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe(scheme);
    const png = await page.screenshot({ fullPage: true });
    await testInfo.attach(`board-${scheme}.png`, { body: png, contentType: "image/png" });
    fs.writeFileSync(path.join(dir, `board-e2e-${scheme}.png`), png);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/**
 * The short-video export shells out to ffmpeg and renders a vertical video.
 * The board test only needs the stage to finish after the human upload, so the
 * copied template's script is replaced with one that writes the output file.
 */
export function stubFastExport(dir: string) {
  fs.writeFileSync(
    path.join(dir, "scripts", "render.mjs"),
    ["import fs from 'node:fs';", "fs.writeFileSync('final.mp4', 'e2e');", ""].join("\n"),
  );
}

/** Check stage that stays running until FLOWGIT_E2E_RELEASE appears, then writes check.json. */
export function installHeldCheck(dir: string) {
  fs.writeFileSync(
    path.join(dir, "scripts", "check-report.mjs"),
    [
      "import fs from 'node:fs';",
      "const release = process.env.FLOWGIT_E2E_RELEASE;",
      "if (!release) { console.error('FLOWGIT_E2E_RELEASE is not set'); process.exit(1); }",
      "const deadline = Date.now() + 60_000;",
      "while (!fs.existsSync(release)) {",
      "  if (Date.now() > deadline) { console.error('timed out waiting to continue'); process.exit(1); }",
      "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);",
      "}",
      "fs.writeFileSync('check.json', '{\"ok\":true}\\n');",
      "",
    ].join("\n"),
  );
}
