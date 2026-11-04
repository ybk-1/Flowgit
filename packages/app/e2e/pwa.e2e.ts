import { expect, test } from "@playwright/test";

test("装到主屏幕的外壳：manifest、service worker，离线仍能打开存着的流程 / home-screen shell: manifest, service worker, a stored flow still opens offline", async ({ page, context }) => {
  const response = await page.goto("./");
  const header = response?.headers()["content-security-policy"] ?? "";
  expect(header).toContain("default-src 'none'");
  expect(header).toContain("manifest-src 'self'");
  expect(header).toContain("worker-src 'self'");
  expect(header).not.toContain("default-src 'self'");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "./manifest.webmanifest");
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? "";
    const body = await (await fetch(new URL(href, location.href))).json();
    return { href, body };
  });
  expect(manifest.href).toBe("./manifest.webmanifest");
  expect(manifest.body.scope).toBe("./");
  expect(manifest.body.start_url).toBe("./");
  expect(manifest.body.display).toBe("standalone");
  expect(manifest.body.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ sizes: "192x192", purpose: "maskable" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  );

  const meta = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(meta).toContain("default-src 'none'");
  expect(meta).toContain("manifest-src 'self'");
  expect(meta).toContain("worker-src 'self'");

  await expect
    .poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? ""))
    .toBe("activated");
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);

  await page.locator('li[data-template="weekly-report"] button').click();
  await expect(page).toHaveURL(/board\.html\?flow=weekly-report$/);
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  await page.locator("a.app-home").click();
  await expect(page.locator('[data-flow="weekly-report"]')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-flow="weekly-report"]')).toBeVisible();
  await page.locator('[data-flow="weekly-report"] a').click();
  await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
  await page.locator("#run-all").click();
  await expect(page.locator("#notice")).toHaveText("需要网络");
});
