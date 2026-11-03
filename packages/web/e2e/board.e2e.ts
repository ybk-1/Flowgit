import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  card,
  installHeldCheck,
  openBoard,
  readLocalInputs,
  runButton,
  runStageUntilDone,
  saveInputs,
  shootThemes,
  stubFastExport,
  type BoardSession,
} from "./board.js";

async function useBoard(template: string, page: Page, run: (session: BoardSession) => Promise<void>) {
  const session = await openBoard(template);
  try {
    await run(session);
  } finally {
    await session.close();
  }
}

test("打开链接：卡片按阶段顺序、状态正确，没有令牌看不到数据 / open the link: cards in order with status; no token shows no data", async ({ page }, testInfo) => {
  await useBoard("weekly-report", page, async (session) => {
    const bareUrl = new URL(session.url);
    bareUrl.search = "";
    const bare = await page.goto(bareUrl.href);
    expect(bare?.status()).toBe(401);
    await expect(page.locator("#board")).toHaveCount(0);
    await expect(page.locator("article.card")).toHaveCount(0);
    await expect(page.locator("body")).toContainText("?token=");
    await expect(page.getByText("随手记")).toHaveCount(0);
    await expect(page.getByText("周报（入门示例）")).toHaveCount(0);

    await page.goto(session.url);
    await expect(page.locator("#flow-name")).toHaveText("周报（入门示例）");
    await expect(page.locator("#refresh-hint")).toContainText("实时更新");
    const cards = page.locator("article.card");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator("p.stage-id")).toHaveText(["notes", "draft", "check"]);
    await expect(cards.nth(0).locator("h2")).toHaveText("随手记");
    await expect(cards.nth(1).locator("h2")).toHaveText("周报草稿");
    await expect(cards.nth(2).locator("h2")).toHaveText("检查");
    await expect(cards.nth(0)).toHaveAttribute("data-state", "never-run");
    await expect(cards.nth(1)).toHaveAttribute("data-state", "waiting-upstream");
    await expect(cards.nth(2)).toHaveAttribute("data-state", "waiting-upstream");
    await expect(cards.nth(0).locator(".badge")).toContainText("可以运行");
    await expect(cards.nth(1).locator(".badge")).toContainText("等上游");
    await expect(cards.nth(2).locator(".badge")).toContainText("等上游");
    await expect(page.locator("#banner")).toContainText("name");

    await shootThemes(page, testInfo);
  });
});

test("流程输入：非法 enum 报错且不保存，合法值会保存 / flow inputs: an invalid enum errors and is not saved; a valid value is saved", async ({ page }) => {
  await useBoard("weekly-report", page, async (session) => {
    await page.goto(session.url);
    const language = page.locator('select[data-input="language"]');
    const name = page.locator('[data-input="name"]');
    await expect(language).toBeVisible();
    await expect(language).toHaveValue("zh");
    await name.fill("小林");
    await page.evaluate(() => {
      const select = document.querySelector('select[data-input="language"]') as HTMLSelectElement | null;
      if (!select) throw new Error("language select missing");
      select.add(new Option("fr", "fr"));
      select.value = "fr";
    });
    await page.locator("#inputs-save").click();
    await expect(page.locator("#inputs-status")).toContainText("只能是");
    expect(readLocalInputs(session.dir).language).not.toBe("fr");
    expect(readLocalInputs(session.dir).name).not.toBe("小林");

    await page.reload();
    await expect(language).toHaveValue("zh");
    await expect(name).toHaveValue("");

    await name.fill("小林");
    await language.selectOption("en");
    await saveInputs(page);
    await page.reload();
    await expect(language).toHaveValue("en");
    await expect(name).toHaveValue("小林");
    expect(readLocalInputs(session.dir)).toMatchObject({ name: "小林", language: "en" });
  });
});

test("运行一个阶段：状态经 SSE 实时更新，完成后显示产物 / run a stage: status updates live over SSE, and the output shows when done", async ({ page }) => {
  await useBoard("weekly-report", page, async (session) => {
    fs.writeFileSync(path.join(session.dir, "notes.md"), "- 修好了导出\n- 补了测试\n");
    await page.goto(session.url);
    await page.locator('[data-input="name"]').fill("小林");
    await saveInputs(page);
    await expect(page.locator("#refresh-hint")).toContainText("实时更新");

    await runStageUntilDone(page, "notes", "✓ 随手记 → v1");
    await expect(runButton(page, "draft")).toBeEnabled();

    await runButton(page, "draft").click();
    const log = page.locator("#log");
    await expect(log).toContainText("▶ 周报草稿 (draft)");
    await expect(log).toContainText("✓ 周报草稿 → v1");
    await expect(page.locator("#run-all")).toBeEnabled();
    const draft = card(page, "draft");
    await expect(draft).toHaveAttribute("data-state", "ok");
    await expect(draft.locator("button.thumb .thumb-text")).toContainText("本周完成");
  });
});

test("全部运行停在人工阶段，上传文件夹产物后可以继续 / run all stops at a human stage; uploading into its directory lets it continue", async ({ page }) => {
  await useBoard("short-video", page, async (session) => {
    stubFastExport(session.dir);
    let unexpected = "";
    page.on("dialog", (dialog) => {
      unexpected = dialog.message();
      void dialog.dismiss();
    });
    await page.goto(session.url);
    await page.locator('[data-input="topic"]').fill("为什么猫喜欢纸箱");
    await saveInputs(page);
    await expect(page.locator("#banner")).toBeHidden();

    await page.locator("#run-all").click();
    const log = page.locator("#log");
    await expect(log).toContainText("「素材」在等你");
    await expect(log).not.toContainText("▶ 剪辑");
    await expect(page.locator("#run-all")).toBeEnabled();
    expect(unexpected).toBe("");
    await expect(card(page, "assets")).toHaveAttribute("data-state", "never-run");
    await expect(card(page, "edit")).toHaveAttribute("data-state", "waiting-upstream");

    await card(page, "assets").locator('input[type="file"]').setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("一张素材\n"),
    });
    await expect(page.locator("#panel")).toContainText("note.txt");
    await page.locator("#panel-close").click();
    await expect(page.locator("#panel")).toBeHidden();

    await page.locator("#run-all").click();
    await expect(log).toContainText("▶ 剪辑 (edit)");
    await expect(log).toContainText("运行结束");
    await expect(page.locator("#run-all")).toBeEnabled();
    expect(unexpected).toBe("");
    await expect(card(page, "assets")).toHaveAttribute("data-state", "ok");
    await expect(card(page, "edit")).toHaveAttribute("data-state", "ok");
    await expect(card(page, "export")).toHaveAttribute("data-state", "ok");
    expect(fs.existsSync(path.join(session.dir, "final.mp4"))).toBe(true);
  });
});

test("手改产物并保存：卡片显示已修改，重跑会先存一个 manual 版本 / hand-edit an output: the card shows edited, and a re-run stores a manual run first", async ({ page }) => {
  await useBoard("weekly-report", page, async (session) => {
    fs.writeFileSync(path.join(session.dir, "notes.md"), "- 修好了导出\n");
    await page.goto(session.url);
    await page.locator('[data-input="name"]').fill("小林");
    await saveInputs(page);
    await runStageUntilDone(page, "notes", "✓ 随手记 → v1");
    await runStageUntilDone(page, "draft", "✓ 周报草稿 → v1");

    const draft = card(page, "draft");
    await draft.locator("button.thumb", { hasText: "report.md" }).click();
    const area = page.locator("#panel textarea");
    await expect(area).toBeVisible();
    await area.fill(`${await area.inputValue()}\n\n手改的一行。\n`);
    await page.locator("#panel button.save").click();
    await expect(page.locator("#panel .save-ok")).toContainText("已保存");
    await expect(draft).toHaveAttribute("data-state", "edited");
    await expect(draft).toContainText("已手动修改");
    await page.locator("#panel-close").click();

    await runButton(page, "draft").click();
    const log = page.locator("#log");
    await expect(log).toContainText("你的手动修改已存为 v2");
    await expect(log).toContainText("✓ 周报草稿 → v3");
    await expect(page.locator("#run-all")).toBeEnabled();
    await draft.getByRole("button", { name: "历史" }).click();
    const manual = page.locator('.deck .disc[data-kind="manual"]');
    await expect(manual).toHaveCount(1);
    await expect(manual).toContainText("v2");
    await expect(manual).toContainText("手改");
  });
});

test("历史：对比两个版本能看到差异，回退会写回当前文件 / history: comparing two runs shows a difference; restore puts the current files back", async ({ page }) => {
  await useBoard("weekly-report", page, async (session) => {
    fs.writeFileSync(path.join(session.dir, "notes.md"), "- 修好了导出\n");
    await page.goto(session.url);
    await page.locator('[data-input="name"]').fill("小林");
    await saveInputs(page);
    await runStageUntilDone(page, "notes", "✓ 随手记 → v1");
    await runStageUntilDone(page, "draft", "✓ 周报草稿 → v1");
    const report = path.join(session.dir, "report.md");
    const first = fs.readFileSync(report, "utf8");
    fs.writeFileSync(path.join(session.dir, "demo-replies", "draft.md"), `${first}\n第二版标记\n`);

    await runStageUntilDone(page, "draft", "✓ 周报草稿 → v2");
    expect(fs.readFileSync(report, "utf8")).toContain("第二版标记");

    await card(page, "draft").getByRole("button", { name: "历史" }).click();
    await page.locator('form.compare select[name="a"]').selectOption("1");
    await page.locator('form.compare select[name="b"]').selectOption("2");
    await page.locator("form.compare").getByRole("button", { name: "对比" }).click();
    await expect(page.locator(".diff-summary")).toHaveText("v1 → v2");
    await expect(page.locator(".diff-add, .diff-del").first()).toBeVisible();
    await expect(page.locator(".diff-block")).toContainText("第二版标记");

    await page.getByRole("button", { name: "返回历史" }).click();
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("v1");
      void dialog.accept();
    });
    // History is a stack of discs: bring v1 to the front, then restore it.
    await page.locator("#disc-draft-1").click();
    await expect(page.locator("#disc-draft-1")).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "回退到这个版本" }).click();
    await expect(page.locator("#panel")).toContainText("已回退到 v1");
    await expect.poll(() => fs.readFileSync(report, "utf8")).toBe(first);
  });
});

test("新增阶段，删除有下游的阶段时确认并断开依赖 / add a stage, then remove one that has dependents by confirming and detaching", async ({ page }) => {
  await useBoard("weekly-report", page, async (session) => {
    await page.goto(session.url);
    await expect(page.locator("article.card")).toHaveCount(3);
    await page.locator("#add-stage").click();
    const dialog = page.locator("#stage-dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#stage-id").fill("extra");
    await dialog.locator("#stage-name").fill("补充");
    await dialog.getByRole("button", { name: "添加" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("article.card p.stage-id")).toHaveText(["notes", "draft", "check", "extra"]);
    await expect(card(page, "extra").locator("h2")).toHaveText("补充");

    await card(page, "notes").getByRole("button", { name: "菜单 · notes" }).click();
    await page.getByRole("menuitem", { name: "删除阶段" }).click();
    const remove = page.locator("#remove-dialog");
    await expect(remove).toBeVisible();
    await expect(remove).toContainText("notes");
    await remove.getByRole("button", { name: "删除", exact: true }).click();
    await expect(remove.locator("#remove-deps")).toContainText("draft");
    await remove.getByRole("button", { name: "一起断开依赖" }).click();
    await expect(remove).toBeHidden();
    await expect(page.locator("article.card p.stage-id")).toHaveText(["draft", "check", "extra"]);

    const flow = JSON.parse(fs.readFileSync(path.join(session.dir, "flow.json"), "utf8")) as {
      stages: Array<{ id: string; inputs?: string[] }>;
    };
    expect(flow.stages.map((stage) => stage.id)).toEqual(["draft", "check", "extra"]);
    expect(flow.stages.find((stage) => stage.id === "draft")?.inputs).toBeUndefined();
  });
});

test("流程图、预演和用量打得开并且说得通 / the graph, dry-run and token usage open and look sensible", async ({ page }) => {
  await useBoard("weekly-report", page, async (session) => {
    await page.goto(session.url);
    await page.locator('[data-input="name"]').fill("小林");
    await saveInputs(page);

    await expect(page.locator("#usage-total")).toHaveText(/模型用量合计：输入 \d+ \+ 输出 \d+ tokens（\d+ 次模型调用）/);

    await page.locator("#view-graph").click();
    await expect(page.locator("#view-graph")).toHaveAttribute("aria-pressed", "true");
    // The graph opens as 2.5D blocks; the flat SVG is one click away. Both show the same nodes and edges.
    for (const style of ["depth", "flat"] as const) {
      const button = page.locator(`.graph-style [data-style="${style}"]`);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      const graph = style === "flat" ? page.locator("svg.flow-graph") : page.locator("#board");
      if (style === "flat") await expect(graph).toBeVisible();
      else await expect(page.locator(".iso-node")).toHaveCount(3);
      await expect(graph.locator(".flow-node")).toHaveCount(3);
      await expect(graph.locator('.flow-node[data-id="notes"]')).toHaveAttribute("data-state", "never-run");
      await expect(graph.locator('.flow-node[data-id="draft"]')).toHaveAttribute("data-state", "waiting-upstream");
      await expect(graph.locator('.flow-node[data-id="check"]')).toBeVisible();
      await expect(graph.locator(".flow-edge")).toHaveCount(2);
    }
    await expect(page.locator(".graph-legend")).toContainText("可以运行");
    await expect(page.locator(".graph-legend")).toContainText("等上游");

    await page.locator("#preview").click();
    const log = page.locator("#log");
    await expect(log).toContainText("预演 · 不会运行");
    await expect(log).toContainText("随手记 notes · 等你");
    await expect(log).toContainText("周报草稿 draft");
    await expect(log).toContainText("检查 check");
    await expect(log).toContainText("最多调用 0 次模型");

    await page.locator("#view-cards").click();
    await expect(page.locator("article.card")).toHaveCount(3);
    await expect(page.locator("#view-cards")).toHaveAttribute("aria-pressed", "true");
  });
});

test("两种语言在刷新后还在 / both languages survive a reload", async ({ page }) => {
  await useBoard("weekly-report", page, async (session) => {
    await page.goto(session.url);
    await expect(page.locator("article.card")).toHaveCount(3);

    const modes = [
      { lang: "en", runAll: "Run all", html: "en" },
      { lang: "zh", runAll: "全部运行", html: "zh-CN" },
    ] as const;
    for (const mode of modes) {
      await page.locator(`.lang-switch [data-lang="${mode.lang}"]`).click();
      await expect(page.locator(`.lang-switch [data-lang="${mode.lang}"]`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#run-all")).toHaveText(mode.runAll);
      await expect(page.locator("html")).toHaveAttribute("lang", mode.html);
      await page.reload();
      await expect(page.locator("article.card")).toHaveCount(3);
      await expect(page.locator(`.lang-switch [data-lang="${mode.lang}"]`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#run-all")).toHaveText(mode.runAll);
      await expect(page.locator("html")).toHaveAttribute("lang", mode.html);
    }
  });
});

test("运行中再点运行会看到忙碌（409） / clicking run while a run is in progress shows the busy message (409)", async ({ page, context }) => {
  const session = await openBoard("weekly-report");
  const release = path.join(session.dir, "e2e-release");
  let released = false;
  const releaseRun = () => {
    if (released) return;
    released = true;
    fs.writeFileSync(release, "go\n");
  };
  process.env.FLOWGIT_E2E_RELEASE = release;
  try {
    installHeldCheck(session.dir);
    fs.writeFileSync(path.join(session.dir, "notes.md"), "- 修好了导出\n");
    await page.goto(session.url);
    await page.locator('[data-input="name"]').fill("小林");
    await saveInputs(page);
    await runStageUntilDone(page, "notes", "✓ 随手记 → v1");
    await runStageUntilDone(page, "draft", "✓ 周报草稿 → v1");

    const other = await context.newPage();
    await other.goto(session.url);
    await expect(runButton(other, "check")).toBeEnabled();

    await runButton(page, "check").click();
    await expect(page.locator("#log")).toContainText("▶ 检查 (check)");
    await expect(page.locator("#run-all")).toBeDisabled();

    const pending = other.waitForResponse(
      (response) => response.url().includes("/api/run") && response.request().method() === "POST",
    );
    await runButton(other, "check").click();
    expect((await pending).status()).toBe(409);
    await expect(other.locator("#log")).toContainText("已有运行在进行");

    releaseRun();
    await expect(page.locator("#log")).toContainText("✓ 检查 → v1");
    await expect(page.locator("#run-all")).toBeEnabled();
    await expect(card(page, "check")).toHaveAttribute("data-state", "ok");
  } finally {
    releaseRun();
    delete process.env.FLOWGIT_E2E_RELEASE;
    await session.close();
  }
});
