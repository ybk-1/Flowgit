import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { card, openBoard, saveInputs, stubFastExport, type BoardSession } from "./board.js";

const mediaDir = "/cursor/stores/bc-a1e62cfe-b318-47b6-a6d1-688f53360f71/media";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let bit = 0; bit < 8; bit += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A small solid PNG so the preview has a real picture without extra tools. */
function solidPng(w: number, h: number, r: number, g: number, b: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x += 1) {
      const i = row + 1 + x * 3;
      raw[i] = (r + Math.floor((x / w) * 40)) & 255;
      raw[i + 1] = (g + Math.floor((y / h) * 30)) & 255;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function wav(seconds: number, sampleRate: number, hz: number): Buffer {
  const n = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    const v = Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.2;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function writeAssets(dir: string) {
  const assets = path.join(dir, "assets");
  fs.mkdirSync(assets, { recursive: true });
  const colors: Array<[string, number, number, number]> = [
    ["s1", 40, 90, 180],
    ["s2", 180, 90, 40],
    ["s4", 140, 50, 120],
    ["s5", 200, 160, 50],
  ];
  for (const [id, r, g, b] of colors) fs.writeFileSync(path.join(assets, `${id}.png`), solidPng(90, 160, r, g, b));
  fs.writeFileSync(path.join(assets, "voice.wav"), wav(4, 8000, 330));
  fs.writeFileSync(path.join(assets, "music.wav"), wav(2, 8000, 220));
  const video = path.join(assets, "s3.mp4");
  const made = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x2244aa:s=90x160:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", video],
    { encoding: "utf8" },
  );
  if (made.status !== 0) fs.writeFileSync(path.join(assets, "s3.png"), solidPng(90, 160, 40, 140, 90));
}

async function clips(page: Page) {
  return page.locator(".tl-clip").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-id"),
      duration: Number(node.getAttribute("data-duration")),
    })),
  );
}

async function captions(page: Page) {
  return page.locator(".tl-cap").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-caption") || ""));
}

function sameAs(current: { id: string | null; duration: number }[], original: { id: string; duration: number }[], caps: string[], originalCaps: string[]) {
  if (current.length !== original.length || caps.length !== originalCaps.length) return false;
  return current.every((clip, i) => clip.id === original[i].id && Math.abs(clip.duration - original[i].duration) < 0.001) && caps.every((cap, i) => cap === originalCaps[i]);
}

async function shoot(page: Page, scheme: "light" | "dark", file: string) {
  await page.emulateMedia({ colorScheme: scheme });
  const want = scheme === "dark" ? "#12161c" : "#f4f0e6";
  await expect.poll(() => page.locator(".timeline").evaluate((node) => getComputedStyle(node).getPropertyValue("--tl-bg").trim())).toBe(want);
  if (fs.existsSync("/cursor/stores")) {
    fs.mkdirSync(mediaDir, { recursive: true });
    await page.screenshot({ path: path.join(mediaDir, file) });
    expect(fs.existsSync(path.join(mediaDir, file))).toBe(true);
  }
}

test("时间线：拖动、裁时长、改字幕、保存、撤销 / timeline: drag, trim, edit a caption, save, undo", async ({ page }) => {
  const session: BoardSession = await openBoard("short-video");
  try {
    writeAssets(session.dir);
    stubFastExport(session.dir);
    let unexpected = "";
    page.on("dialog", (dialog) => {
      unexpected = dialog.message();
      void dialog.dismiss();
    });
    await page.goto(session.url);
    await page.locator('[data-input="topic"]').fill("为什么猫喜欢纸箱");
    await saveInputs(page);

    await page.locator("#run-all").click();
    const log = page.locator("#log");
    await expect(log).toContainText("运行结束", { timeout: 60_000 });
    await expect(page.locator("#run-all")).toBeEnabled();
    expect(unexpected).toBe("");
    await expect(card(page, "edit")).toHaveAttribute("data-state", "ok");

    await card(page, "storyboard").locator("button.thumb", { hasText: "storyboard.json" }).click();
    await expect(page.locator(".shot-card")).toHaveCount(5);
    await expect(page.locator('.shot-card[data-id="s1"]')).toHaveAttribute("data-uploaded", "yes");
    await expect(page.locator('.shot-card[data-id="s1"] .shot-line')).toContainText("你家猫");
    await expect(page.locator('.shot-card[data-id="s1"]')).toContainText("已上传");
    await page.locator("#panel-close").click();
    await expect(page.locator("#panel")).toBeHidden();

    await card(page, "edit").locator("button.thumb", { hasText: "timeline.json" }).click();
    const timeline = page.locator(".timeline");
    await expect(timeline).toHaveAttribute("data-ready", "1");
    await expect(page.locator('.tl-row[data-track="picture"]')).toBeVisible();
    await expect(page.locator('.tl-row[data-track="caption"]')).toBeVisible();
    await expect(page.locator('.tl-row[data-track="voice"]')).toBeVisible();
    await expect(page.locator('.tl-row[data-track="music"]')).toBeVisible();
    await expect(page.locator(".tl-reexport")).toBeVisible();
    await expect(page.locator(".tl-still")).toBeVisible();
    await expect.poll(() => page.locator(".tl-still").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await page.waitForTimeout(700);
    await shoot(page, "light", "timeline-light.png");
    await shoot(page, "dark", "timeline-dark.png");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await shoot(page, "light", "timeline-phone.png");
    await page.setViewportSize({ width: 1440, height: 900 });

    const file = path.join(session.dir, "timeline.json");
    const before = JSON.parse(fs.readFileSync(file, "utf8")) as { clips: { id: string; duration: number; caption?: string }[] };
    const original = before.clips.map((clip) => ({ id: clip.id, duration: clip.duration }));
    const originalCaps = before.clips.map((clip) => clip.caption || "");

    const first = page.locator(".tl-clip").first();
    await first.scrollIntoViewIfNeeded();
    const box = await first.boundingBox();
    const lastBox = await page.locator(".tl-clip").last().boundingBox();
    if (!box || !lastBox) throw new Error("clip has no box");
    await page.mouse.move(box.x + Math.min(box.width / 2, 14), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(lastBox.x + lastBox.width - 4, box.y + box.height / 2, { steps: 16 });
    await page.mouse.up();
    await expect.poll(async () => (await clips(page)).map((clip) => clip.id)).not.toEqual(original.map((clip) => clip.id));

    const edge = page.locator(".tl-clip").first().locator(".tl-edge-right");
    await edge.scrollIntoViewIfNeeded();
    const edgeBox = await edge.boundingBox();
    if (!edgeBox) throw new Error("edge has no box");
    const durBefore = Number(await page.locator(".tl-clip").first().getAttribute("data-duration"));
    await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(edgeBox.x + 80, edgeBox.y + edgeBox.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.locator(".tl-clip").first().getAttribute("data-duration")).not.toBe(String(durBefore));

    await page.locator(".tl-cap").first().dblclick();
    const input = page.locator(".tl-caption-input");
    await expect(input).toBeVisible();
    await input.fill("剪辑后的字幕");
    await input.press("Enter");
    await expect(page.locator(".tl-cap").first()).toHaveAttribute("data-caption", "剪辑后的字幕");

    await page.locator("#panel button.save").click();
    await expect(page.locator("#panel .save-ok")).toContainText("已保存");
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { clips: { caption?: string }[] };
    expect(saved.clips.some((clip) => clip.caption === "剪辑后的字幕")).toBe(true);
    await expect(card(page, "edit")).toHaveAttribute("data-state", "edited");
    await expect(card(page, "export")).toHaveAttribute("data-state", "stale");
    await expect(page.locator(".tl-export-note")).toBeVisible();

    const undo = page.getByRole("button", { name: "撤销" });
    for (let i = 0; i < 8; i += 1) {
      if (sameAs(await clips(page), original, await captions(page), originalCaps)) break;
      await undo.click();
    }
    expect(sameAs(await clips(page), original, await captions(page), originalCaps)).toBe(true);

    await page.locator(".tl-clip").first().focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".tl-clip").nth(1)).toBeFocused();
    const beforeKey = await clips(page);
    await page.keyboard.press("]");
    await expect.poll(async () => (await clips(page))[1].duration).toBeGreaterThan(beforeKey[1].duration);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await clips(page)).map((clip) => clip.id)).not.toEqual(beforeKey.map((clip) => clip.id));
    await undo.click();
    await undo.click();
    expect(sameAs(await clips(page), original, await captions(page), originalCaps)).toBe(true);

    await page.locator("#panel-close").click();
    await expect(page.locator("#panel")).toBeHidden();
    await page.locator("#run-all").click();
    await expect(log).toContainText("手动修改", { timeout: 60_000 });
    await expect(log).toContainText("运行结束");
    await expect(page.locator("#run-all")).toBeEnabled();
    expect(unexpected).toBe("");
    await card(page, "edit").getByRole("button", { name: "历史" }).click();
    const manual = page.locator('.deck .disc[data-kind="manual"]');
    await expect(manual).toHaveCount(1);
    await expect(manual).toContainText("手改");
  } finally {
    await session.close();
  }
});
