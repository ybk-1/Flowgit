// "build" stage: slides.json -> slides.html (one self-contained deck) + notes.md.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const dark = flowInputs.theme === "dark";

const deck = JSON.parse(fs.readFileSync("slides.json", "utf8"));
const slides = Array.isArray(deck.slides) ? deck.slides : [];
if (!slides.length) {
  console.error(t("slides.json 里没有幻灯片", "slides.json has no slides"));
  process.exit(1);
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function slideHtml(slide, i) {
  const layout = ["cover", "bullets", "statement", "section"].includes(slide.layout) ? slide.layout : "bullets";
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  let body = "";
  if (layout === "cover") {
    body = `<h1>${esc(slide.title)}</h1>${deck.subtitle ? `<p class="sub">${esc(deck.subtitle)}</p>` : ""}`;
  } else if (layout === "bullets") {
    body = `<h2>${esc(slide.title)}</h2><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  } else {
    body = `<h1>${esc(slide.title)}</h1>`;
  }
  return `<section class="slide ${layout}" data-n="${i + 1}"><div class="inner">${body}</div><span class="num">${i + 1} / ${slides.length}</span></section>`;
}

const colors = dark
  ? { bg: "#14161a", fg: "#eceef2", muted: "#9aa3b2", accent: "#7aa7ff", section: "#1f2a44" }
  : { bg: "#ffffff", fg: "#1b1f27", muted: "#5b6472", accent: "#2f5bd3", section: "#eef3ff" };

const html = `<!doctype html>
<html lang="${en ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deck.title)}</title>
<style>
  :root { --bg: ${colors.bg}; --fg: ${colors.fg}; --muted: ${colors.muted}; --accent: ${colors.accent}; --section: ${colors.section}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
  .slide { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; padding: 6vh 8vw; }
  .slide.on { display: flex; }
  .inner { width: 100%; max-width: 1100px; }
  h1 { font-size: clamp(32px, 6vw, 72px); line-height: 1.2; margin: 0; }
  h2 { font-size: clamp(26px, 4vw, 48px); margin: 0 0 4vh; color: var(--accent); }
  ul { margin: 0; padding-left: 1.2em; font-size: clamp(18px, 2.6vw, 32px); line-height: 1.7; }
  .sub { color: var(--muted); font-size: clamp(18px, 2.4vw, 28px); margin-top: 3vh; }
  .cover .inner, .statement .inner, .section .inner { text-align: center; }
  .section { background: var(--section); }
  .num { position: absolute; right: 3vw; bottom: 3vh; color: var(--muted); font-size: 14px; }
  .hint { position: fixed; left: 3vw; bottom: 3vh; color: var(--muted); font-size: 12px; }
  @media print {
    @page { size: 16in 9in; margin: 0; }
    .slide { position: relative; display: flex; width: 16in; height: 9in; page-break-after: always; break-after: page; }
    .hint { display: none; }
  }
</style>
</head>
<body>
${slides.map(slideHtml).join("\n")}
<div class="hint">${t("← → 翻页，F 全屏，Ctrl+P 打印成 PDF", "← → to move, F for full screen, Ctrl+P to print to PDF")}</div>
<script>
  const all = [...document.querySelectorAll(".slide")];
  let i = Math.min(Math.max(parseInt(location.hash.slice(1), 10) - 1 || 0, 0), all.length - 1);
  const show = () => { all.forEach((s, k) => s.classList.toggle("on", k === i)); history.replaceState(null, "", "#" + (i + 1)); };
  document.addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) i = Math.min(i + 1, all.length - 1);
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) i = Math.max(i - 1, 0);
    else if (e.key === "f" || e.key === "F") document.documentElement.requestFullscreen?.();
    else return;
    e.preventDefault(); show();
  });
  document.addEventListener("click", (e) => { i = e.clientX < innerWidth / 3 ? Math.max(i - 1, 0) : Math.min(i + 1, all.length - 1); show(); });
  show();
</script>
</body>
</html>
`;

const notes = [
  `# ${deck.title}${t("：讲稿", " — speaker notes")}`,
  "",
  ...slides.flatMap((slide, i) => [`## ${i + 1}. ${slide.title}`, "", slide.notes ? String(slide.notes) : t("（没有讲稿）", "(no notes)"), ""]),
].join("\n");

const htmlOut = outputs.find((o) => o.path.endsWith(".html"))?.path ?? "slides.html";
const notesOut = outputs.find((o) => o.path.endsWith(".md"))?.path ?? "notes.md";
fs.writeFileSync(htmlOut, html);
fs.writeFileSync(notesOut, notes);
console.log(t(`排好 ${slides.length} 页：${htmlOut}，讲稿 ${notesOut}`, `Laid out ${slides.length} slides: ${htmlOut}, notes in ${notesOut}`));
