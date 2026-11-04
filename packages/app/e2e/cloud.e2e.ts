import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const media = "/cursor/stores/bc-a1e62cfe-b318-47b6-a6d1-688f53360f71/media";

async function signIn(page: Page, subject: string, invite = ""): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#cloud-test-form")).toBeVisible();
  await page.locator("#cloud-test-subject").fill(subject);
  await page.locator("#cloud-test-name").fill(subject);
  if (invite) await page.locator("#cloud-test-invite").fill(invite);
  await page.locator("#cloud-test-form button").click();
  await expect(page.locator("#cloud-signed-in")).toBeVisible();
}

test("signs in, puts a flow in the cloud, shares it and copies it", async ({ page, browser }) => {
  fs.mkdirSync(media, { recursive: true });
  await signIn(page, "admin");
  await page.locator("#cloud-new-workspace").click();
  await page.locator("#workspace-name").fill("演示");
  await page.locator("#workspace-form button[type=submit]").click();
  await expect(page.locator("[data-workspace]")).toBeVisible();

  await page.locator("[data-template=weekly-report] button").click();
  // Cloudflare's asset handler drops ".html", so /app/board.html arrives as /app/board.
  await page.waitForURL(/\/board(\.html)?\?flow=weekly-report/, { waitUntil: "commit" });
  await page.goto("./");
  await page.locator("[data-put-cloud=weekly-report]").click();
  await page.waitForURL(/\/board(\.html)?\?flow=cloud-/, { waitUntil: "commit" });
  const cloudUrl = page.url();
  const flowMatch = /flow=cloud-([^&]+)/.exec(cloudUrl);
  expect(flowMatch).toBeTruthy();
  const flowId = decodeURIComponent(flowMatch![1]!);

  const wsPromise = page.waitForEvent("websocket", { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const ws = await wsPromise;
  const wsUrl = new URL(ws.url());
  expect(wsUrl.host).toBe(new URL(page.url()).host);
  expect(wsUrl.pathname).toBe(`/api/flows/${flowId}/events`);
  await expect(page.locator("#flow-name")).toBeVisible();

  await page.goto("./");
  await expect(page.locator(`[data-cloud-flow="${flowId}"]`)).toBeVisible();
  await page.screenshot({ path: path.join(media, "cloud-home-light.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(media, "cloud-home-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  await page.locator("[data-members]").click();
  await expect(page.locator("#members-dialog")).toBeVisible();
  await page.screenshot({ path: path.join(media, "cloud-members-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(media, "cloud-members-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator("#members-invite button").click();
  await expect(page.locator("#members-url")).toHaveValue(/invite=/);
  const invite = new URL(await page.locator("#members-url").inputValue()).searchParams.get("invite")!;
  await page.locator("#members-close").click();

  await page.locator(`[data-share-flow="${flowId}"]`).click();
  await page.locator("#share-create").click();
  await expect(page.locator("#share-url")).toHaveValue(/share=/);
  const share = new URL(await page.locator("#share-url").inputValue()).searchParams.get("share")!;

  const origin = new URL(page.url()).origin;
  const guestContext: BrowserContext = await browser.newContext({ baseURL: `${origin}/app/`, locale: "zh-CN" });
  const guest = await guestContext.newPage();
  await guest.goto(`./?invite=${encodeURIComponent(invite)}`);
  await guest.locator("#cloud-test-subject").fill("guest");
  await guest.locator("#cloud-test-name").fill("guest");
  await expect(guest.locator("#cloud-test-invite")).toHaveValue(invite);
  await guest.locator("#cloud-test-form button").click();
  await guest.waitForURL((url) => !url.search.includes("invite"));
  await expect(guest.locator("#cloud-signed-in")).toBeVisible();
  await guest.goto(`./board.html?share=${encodeURIComponent(share)}`);
  await expect(guest.locator("html")).toHaveAttribute("data-flowgit-readonly", "");
  await expect(guest.locator("#run-all")).toBeHidden();
  await guest.locator("#cloud-copy").click();
  await guest.waitForURL(/\/board(\.html)?\?flow=cloud-/, { waitUntil: "commit" });
  const copiedId = decodeURIComponent(/flow=cloud-([^&]+)/.exec(guest.url())![1]!);
  expect(copiedId).not.toBe(flowId);
  const raw = await guest.evaluate(async (id) => {
    const res = await fetch(`/api/flows/${id}/raw?path=flow.json`);
    return res.text();
  }, copiedId);
  const flow = JSON.parse(raw) as { forkedFrom?: { source?: string } };
  expect(flow.forkedFrom?.source).toBe(`flowgit:${flowId}`);
  expect(raw).not.toContain(share);
  const files = await guest.evaluate(async (id) => {
    const res = await fetch(`/api/flows/${id}/files`);
    return (await res.json()) as { files: { path: string }[] };
  }, copiedId);
  expect(files.files.some((file) => file.path.startsWith("runs/"))).toBe(false);
  await guestContext.close();
});
