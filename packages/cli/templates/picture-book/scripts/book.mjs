#!/usr/bin/env node
// "manuscript" and "book" stages: node scripts/book.mjs manuscript | book
//
// manuscript: manuscript.md, art-brief.md and dummy.html from story.json and
// storyboard.json.
// - A picture book's submission manuscript is the words alone, the way
//   editors read it; an art note stays only where a spread has no words, in
//   double parentheses, which in a manuscript mean "do not set". The
//   paginated text follows, spread by spread.
// - A comic becomes a full script: page by page, panel by panel, with the
//   balloons numbered and the speaker in capitals (Dark Horse's format).
// - The art brief gives the illustrator the sizes (300 DPI, 0.125 in bleed
//   at the top, the bottom and the outside, as KDP asks), the safe zones,
//   the character sheet and what each image shows.
// book: book.html, the same pages with the images from art/.
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] === "book" ? "book" : "manuscript";
const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const author = String(flowInputs.author ?? "").trim();
const aiArt = flowInputs.aiArt === true || flowInputs.aiArt === "true";

const DPI = 300;
const BLEED = 0.125;
const SAFE = 0.375;

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
const story = readJson("story.json") ?? {};
const board = readJson("storyboard.json");
if (!board || !Array.isArray(board.units)) {
  console.error("storyboard.json 不存在或缺少 units / storyboard.json is missing or has no units");
  process.exit(1);
}
const comic = (board.format ?? flowInputs.format) === "comic";
const pages = Number(flowInputs.pages ?? 32);

/** "8.5x8.5in", "210x285mm" → { w, h } in inches, or null. */
function parseTrim(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*(in|inch|inches|"|mm|cm|英寸|毫米|厘米)?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const unit = (m[3] ?? (Number(m[1]) > 30 ? "mm" : "in")).toLowerCase();
  const scale = /mm|毫米/.test(unit) ? 1 / 25.4 : /cm|厘米/.test(unit) ? 1 / 2.54 : 1;
  return { w: Number(m[1]) * scale, h: Number(m[2]) * scale };
}
const trim = parseTrim(flowInputs.trim ?? "8.5x8.5in") ?? { w: 8.5, h: 8.5 };
const px = (inches) => Math.ceil(Math.round(inches * DPI * 1000) / 1000);
const sizeOf = (unitPages) =>
  unitPages.length === 2 ? { w: px(2 * trim.w + 2 * BLEED), h: px(trim.h + 2 * BLEED) } : { w: px(trim.w + BLEED), h: px(trim.h + 2 * BLEED) };
const baseName = (unitPages) => `p${unitPages.map((n) => String(n).padStart(2, "0")).join("-")}`;
const pageLabel = (unitPages) =>
  unitPages.length === 2 ? t(`第 ${unitPages[0]}–${unitPages[1]} 页`, `Pages ${unitPages[0]}–${unitPages[1]}`) : t(`第 ${unitPages[0]} 页`, `Page ${unitPages[0]}`);
const units = board.units.filter((u) => Array.isArray(u?.pages) && u.pages.length);
const title = String(story.title ?? "").trim() || t("（书名）", "(Title)");
const characters = Array.isArray(story.characters) ? story.characters : [];

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hardBreaks = (text) => String(text ?? "").trim().split("\n").map((line) => line.trim()).filter(Boolean).join("  \n");
const zhChars = (text) => (String(text).match(/[㐀-鿿]/g) ?? []).length;
const enWords = (text) => (String(text).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;
const count = (text) => (en ? enWords(text) : zhChars(text));
const allText = comic
  ? units.flatMap((u) => (u.panels ?? []).flatMap((p) => (p.lines ?? []).map((l) => l.text ?? ""))).join("\n")
  : units.map((u) => u.text ?? "").join("\n");
const total = count(allText);

const lineLabel = (line) => {
  const who = String(line.who ?? "").trim();
  const labels = en
    ? { speech: "", thought: " (THOUGHT)", whisper: " (WHISPER)", shout: " (BURST)" }
    : { speech: "", thought: "（心想）", whisper: "（小声）", shout: "（喊）" };
  if (line.kind === "caption") return t("旁白", "CAPTION");
  if (line.kind === "sfx") return t("音效", "SFX");
  const name = en ? (who || "?").toUpperCase() : who || "？";
  return `${name}${labels[line.kind] ?? ""}`;
};

/** An image in art/ for these pages: p04-05.png, p4-5.jpg, … */
function findArt(unitPages) {
  const dir = "art";
  if (!fs.existsSync(dir)) return null;
  const names = new Set([baseName(unitPages), `p${unitPages.join("-")}`]);
  for (const file of fs.readdirSync(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (![".png", ".jpg", ".jpeg"].includes(ext)) continue;
    if (names.has(path.basename(file, path.extname(file)).toLowerCase())) return `art/${file}`;
  }
  return null;
}
function findCover() {
  if (!fs.existsSync("art")) return null;
  const file = fs.readdirSync("art").find((f) => /^cover\.(png|jpe?g)$/i.test(f));
  return file ? `art/${file}` : null;
}

function writeOut(index, fallback, text) {
  const out = outputs[index]?.path ?? fallback;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  return out;
}

// ---------- manuscript.md ----------
function manuscript() {
  const lines = [`# ${title}`, ""];
  const credit = author ? t(`文：${author}`, `By ${author}`) : t("文：（作者）", "By (author)");
  const length = comic
    ? t(`${pages} 页漫画 · 对白 ${total} 字`, `A ${pages}-page comic · ${total} words in balloons`)
    : t(`${pages} 页绘本 · 约 ${total} 字 · ${flowInputs.age ?? "3-6"} 岁`, `A ${pages}-page picture book · ${total} words · ages ${flowInputs.age ?? "3-6"}`);
  lines.push(`${credit}  \n${length}`, "");
  if (comic) {
    lines.push(t("## 脚本", "## Script"), "");
    for (const unit of units) {
      const n = unit.pages[0];
      const panels = Array.isArray(unit.panels) ? unit.panels : [];
      const side = n % 2 ? t("右页", "right") : t("左页", "left");
      lines.push(t(`### 第 ${n} 页（${side}，${panels.length} 格）`, `### PAGE ${n} (${side}, ${panels.length} ${panels.length === 1 ? "panel" : "panels"})`), "");
      if (unit.art) lines.push(t(`这一页：${unit.art}`, `This page: ${unit.art}`), "");
      panels.forEach((panel, i) => {
        lines.push(t(`**第 ${i + 1} 格**  `, `**Panel ${i + 1}**  `), t(`画面：${panel.art ?? ""}`, `Art: ${panel.art ?? ""}`), "");
        (panel.lines ?? []).forEach((line, j) => lines.push(`${j + 1}. ${lineLabel(line)}${t("：", ": ")}${line.text ?? ""}`));
        if ((panel.lines ?? []).length) lines.push("");
      });
      if (String(unit.turn ?? "").trim()) lines.push(t(`（翻页：${unit.turn}）`, `(Page turn: ${unit.turn})`), "");
    }
    return lines.join("\n");
  }
  lines.push(t("## 投稿稿", "## Submission manuscript"), "");
  lines.push(
    t(
      "> 编辑读的是文字：不分页，不附图。插图说明只留在没有字的跨页，放在双括号里（双括号表示“不排印”）。",
      "> Editors read the words: no page breaks and no pictures. Art notes stay only where a spread has no words, in double parentheses (meaning “do not set”).",
    ),
    "",
  );
  for (const unit of units) {
    const text = String(unit.text ?? "").trim();
    lines.push(text ? hardBreaks(text) : t(`（（插图：${unit.art ?? ""}））`, `((Art: ${unit.art ?? ""}))`), "");
  }
  lines.push(t("## 分页稿", "## Paginated text"), "");
  for (const unit of units) {
    lines.push(`### ${pageLabel(unit.pages)}`, "");
    const text = String(unit.text ?? "").trim();
    lines.push(text ? hardBreaks(text) : t("（没有字）", "(No words)"), "");
    lines.push(t(`插图：${unit.art ?? ""}`, `Art: ${unit.art ?? ""}`), "");
    if (String(unit.turn ?? "").trim()) lines.push(t(`翻页：${unit.turn}`, `Page turn: ${unit.turn}`), "");
  }
  return lines.join("\n");
}

// ---------- art-brief.md ----------
function artBrief() {
  const single = sizeOf([1]);
  const spread = sizeOf([2, 3]);
  const mm = (inches) => Math.round(inches * 25.4);
  const inch = (n) => String(Math.round(n * 1000) / 1000);
  const safePx = px(SAFE);
  const lines = [t(`# 插画说明：${title}`, `# Art brief: ${title}`), ""];
  lines.push(
    t("## 规格", "## Specs"),
    "",
    t(
      `- 成书 ${inch(trim.w)}×${inch(trim.h)} 英寸（${mm(trim.w)}×${mm(trim.h)} 毫米），${pages} 页${comic ? "漫画" : "绘本"}。`,
      `- Trim ${inch(trim.w)} × ${inch(trim.h)} in (${mm(trim.w)} × ${mm(trim.h)} mm), a ${pages}-page ${comic ? "comic" : "picture book"}.`,
    ),
    t(
      "- 300 DPI。画面画到出血线：上、下和外侧各多画 0.125 英寸（3.2 毫米），裁切时会切掉。",
      "- 300 DPI. Run the art to the bleed line: 0.125 in (3.2 mm) extra at the top, the bottom and the outside, which the trim cuts off.",
    ),
    t(
      `- 单页 ${single.w}×${single.h} 像素${comic ? "" : `，跨页 ${spread.w}×${spread.h} 像素`}，封面正面 ${single.w}×${single.h} 像素。带书脊和封底的完整封面，用印厂或 KDP 的封面模板另做。`,
      `- ${single.w} × ${single.h} px for a page${comic ? "" : `, ${spread.w} × ${spread.h} px for a spread`}, and ${single.w} × ${single.h} px for the front cover. A full cover with spine and back is made from the printer's or KDP's cover template.`,
    ),
    t(
      `- 文字和脸离裁切线至少 0.375 英寸（约 ${safePx} 像素）。${comic ? "" : `跨页正中是中缝，书会在这里折进去：脸、文字和要紧的东西离中缝两边各至少 0.375 英寸（约 ${safePx} 像素）。`}`,
      `- Keep text and faces at least 0.375 in (about ${safePx} px) inside the trim.${comic ? "" : ` The middle of a spread is the gutter, where the book folds in: keep faces, text and anything that matters at least 0.375 in (about ${safePx} px) from it on both sides.`}`,
    ),
    comic
      ? t("- 漫画的图是画好、写好字的整页。", "- A comic image is the finished page, lettered.")
      : t("- 图里不要画字，文字在排版时另外放上去，所以要给文字留出位置。", "- Don't paint the words into the art; they are set in type later, so leave room for them."),
    t("- PNG 或 JPEG，放进 art/，文件名照下面写。", "- PNG or JPEG in art/, named as below."),
    t(`- 画风：${story.style ?? "（见故事设计）"}`, `- Style: ${story.style ?? "(see the story design)"}`),
    "",
    t("## 角色（每一页都画得一样）", "## Characters (drawn the same on every page)"),
    "",
    ...characters.map((c) => `- ${c.name}${c.role === "main" ? t("（主角）", " (main character)") : ""}${t("：", ": ")}${c.look ?? ""}`),
    "",
    t("## 每张图", "## Every image"),
    "",
  );
  const named = (text) => characters.filter((c) => c.name && String(text).toLowerCase().includes(String(c.name).toLowerCase()));
  const prompt = (unit, size) => {
    const who = named(`${unit.text ?? ""} ${unit.art ?? ""}`).map((c) => `${c.name}${t("：", ": ")}${c.look}`);
    const ratio = `${Math.round((size.w / size.h) * 100) / 100}:1`;
    return t(
      `画图提示：${story.style ?? ""}${who.length ? `；${who.join("；")}` : ""}；${unit.art ?? ""}；比例 ${ratio}${unit.pages?.length === 2 ? "，中间是中缝，主体不要放在正中" : ""}；画面里不要文字。`,
      `Image prompt: ${story.style ?? ""}${who.length ? `; ${who.join("; ")}` : ""}; ${unit.art ?? ""}; aspect ratio ${ratio}${unit.pages?.length === 2 ? ", a gutter down the middle, so keep the subject off centre" : ""}; no text in the image.`,
    );
  };
  const cover = board.cover ?? {};
  lines.push(`### ${t("封面", "Cover")} · cover.png · ${single.w}×${single.h}`, "");
  lines.push(t(`书名：${title}`, `Title: ${title}`), "", t(`画面：${cover.art ?? ""}`, `Art: ${cover.art ?? ""}`), "", t(`图片描述：${cover.alt ?? ""}`, `Image description: ${cover.alt ?? ""}`), "");
  if (aiArt) lines.push(prompt({ art: cover.art, pages: [1] }, single), "");
  for (const unit of units) {
    const size = sizeOf(unit.pages);
    lines.push(`### ${pageLabel(unit.pages)} · ${baseName(unit.pages)}.png · ${size.w}×${size.h}`, "");
    if (!comic) {
      const text = String(unit.text ?? "").trim();
      lines.push(t(`文字（留出位置）：${text ? text.split("\n").join(" / ") : "没有字"}`, `Words (leave room): ${text ? text.split("\n").join(" / ") : "none"}`), "");
    }
    lines.push(t(`画面：${unit.art ?? ""}`, `Art: ${unit.art ?? ""}`), "");
    if (comic) {
      (unit.panels ?? []).forEach((panel, i) => {
        lines.push(t(`- 第 ${i + 1} 格：${panel.art ?? ""}`, `- Panel ${i + 1}: ${panel.art ?? ""}`));
        (panel.lines ?? []).forEach((line) => lines.push(`  - ${lineLabel(line)}${t("：", ": ")}${line.text ?? ""}`));
      });
      if ((unit.panels ?? []).length) lines.push("");
    }
    lines.push(t(`图片描述：${unit.alt ?? ""}`, `Image description: ${unit.alt ?? ""}`), "");
    if (aiArt) lines.push(prompt(unit, size), "");
  }
  return lines.join("\n");
}

// ---------- dummy.html / book.html ----------
function html(withArt) {
  const docTitle = withArt ? t(`${title}：成书预览`, `${title}: book preview`) : t(`${title}：样书`, `${title}: dummy`);
  const box = (unitPages, inner, cls = "") => {
    const ratio = unitPages.length === 2 ? `${2 * trim.w} / ${trim.h}` : `${trim.w} / ${trim.h}`;
    return `<div class="page ${unitPages.length === 2 ? "spread" : "single"} ${cls}" style="aspect-ratio: ${ratio}">${inner}</div>`;
  };
  const placeholder = (note) => `<div class="placeholder"><span>${escapeHtml(note)}</span></div>`;
  const picture = (unitPages, note, alt) => {
    const file = withArt ? findArt(unitPages) : null;
    return file ? `<img src="${escapeHtml(file)}" alt="${escapeHtml(alt)}">` : placeholder(note);
  };
  const parts = [];
  const cover = board.cover ?? {};
  const coverFile = withArt ? findCover() : null;
  parts.push(
    `<section class="one"><h2>${t("封面", "Cover")}</h2>${box([1], coverFile ? `<img src="${escapeHtml(coverFile)}" alt="${escapeHtml(cover.alt ?? "")}">` : placeholder(cover.art ?? ""), "cover")}</section>`,
  );
  if (!comic) {
    parts.push(
      `<section class="one"><h2>${t("第 1 页", "Page 1")}</h2>${box([1], `<div class="front"><p class="title">${escapeHtml(title)}</p><p>${escapeHtml(author ? t(`文：${author}`, `By ${author}`) : "")}</p></div>`)}</section>`,
      `<section class="one"><h2>${t("第 2 页", "Page 2")}</h2>${box([2], `<div class="front small"><p>${escapeHtml(t("版权页：书号、版次、版权声明。用了 AI 生成的插图，在这里写明。", "Copyright page: ISBN, edition and rights. If any art is AI-generated, say so here."))}</p></div>`)}</section>`,
      `<section class="one"><h2>${t("第 3 页", "Page 3")}</h2>${box([3], `<div class="front"><p>${escapeHtml(board.dedication ?? "")}</p></div>`)}</section>`,
    );
  }
  units.forEach((unit, index) => {
    const head = `<h2>${escapeHtml(pageLabel(unit.pages))}</h2>`;
    let body = box(unit.pages, picture(unit.pages, unit.art ?? "", unit.alt ?? ""));
    if (comic) {
      const panelList = (unit.panels ?? [])
        .map(
          (panel, i) =>
            `<li><b>${escapeHtml(t(`第 ${i + 1} 格`, `Panel ${i + 1}`))}</b> ${escapeHtml(panel.art ?? "")}${(panel.lines ?? [])
              .map((line) => `<br><span class="line">${escapeHtml(lineLabel(line))}${t("：", ": ")}${escapeHtml(line.text ?? "")}</span>`)
              .join("")}</li>`,
        )
        .join("");
      body += `<details${withArt ? "" : " open"}><summary>${escapeHtml(t("分格和对白", "Panels and balloons"))}</summary><ol>${panelList}</ol></details>`;
    } else {
      const text = String(unit.text ?? "").trim();
      body += `<p class="text">${text ? escapeHtml(text).split("\n").join("<br>") : `<i>${escapeHtml(t("（没有字）", "(No words)"))}</i>`}</p>`;
    }
    const turn = String(unit.turn ?? "").trim();
    if (turn && index < units.length - 1) body += `<p class="turn">↷ ${escapeHtml(t(`翻页：${turn}`, `Page turn: ${turn}`))}</p>`;
    parts.push(`<section${unit.pages.length === 2 ? "" : ' class="one"'}>${head}${body}</section>`);
  });
  const note = withArt
    ? t("还没有图的地方显示插图说明。图放进 art/ 以后，重跑“成书预览”。", "Where an image is missing, its art note shows. Put the image in art/ and run the book preview again.")
    : t("样书：每个方框是一页或一个跨页，里面是插图说明。翻一遍，看看节奏和翻页。", "A dummy: each box is a page or a spread, holding its art note. Page through it to check the pacing and the page turns.");
  return `<!doctype html>
<html lang="${en ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<style>
  :root { --spread: ${withArt ? "1100px" : "520px"}; }
  body { margin: 0; padding: 24px 16px 64px; background: #f4f1ea; color: #222; font: 16px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  .pages { display: flex; flex-wrap: wrap; gap: 28px 24px; align-items: flex-start; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .note { color: #555; margin: 0 0 24px; }
  section { break-inside: avoid; width: var(--spread); max-width: 100%; }
  section.one { width: calc(var(--spread) / 2); }
  h2 { font-size: 13px; font-weight: 600; color: #666; margin: 0 0 6px; letter-spacing: .02em; }
  .page { position: relative; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.15); overflow: hidden; max-height: 80vh; }
  .single, .spread { width: 100%; }
  .spread::after { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; border-left: 1px dashed rgba(0,0,0,.25); }
  .page img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .placeholder { position: absolute; inset: 8px; border: 2px dashed #c9c2b2; display: flex; align-items: center; justify-content: center; padding: 16px; text-align: center; color: #6b6355; font-size: 14px; }
  .front { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; }
  .front.small { font-size: 13px; color: #555; }
  .title { font-size: 20px; font-weight: 700; }
  .text { font-size: 18px; margin: 10px 0 0; }
  .turn { color: #8a6d3b; font-size: 14px; margin: 6px 0 0; }
  details { margin-top: 8px; font-size: 14px; }
  .line { color: #444; }
  @media print { body { background: #fff; padding: 0; } .pages { display: block; } section, section.one { width: 100%; break-after: page; } .page { box-shadow: none; max-height: none; } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="note">${escapeHtml(note)}</p>
<div class="pages">
${parts.join("\n")}
</div>
</main>
</body>
</html>
`;
}

if (mode === "manuscript") {
  const m = writeOut(0, "manuscript.md", `${manuscript()}\n`);
  const b = writeOut(1, "art-brief.md", `${artBrief()}\n`);
  const d = writeOut(2, "dummy.html", html(false));
  console.log(
    t(
      `写好了 ${m}（${comic ? `对白 ${total} 字` : `约 ${total} 字`}）、${b} 和 ${d}，共 ${units.length} 个单元。`,
      `Wrote ${m} (${total} ${total === 1 ? "word" : "words"}${comic ? " in balloons" : ""}), ${b} and ${d}: ${units.length} ${units.length === 1 ? "unit" : "units"}.`,
    ),
  );
} else {
  const found = units.filter((u) => findArt(u.pages)).length + (findCover() ? 1 : 0);
  const out = writeOut(0, "book.html", html(true));
  console.log(
    t(`排好了 ${out}：${units.length + 1} 张图里有 ${found} 张。`, `Wrote ${out}: ${found} of ${units.length + 1} images in place.`),
  );
}
