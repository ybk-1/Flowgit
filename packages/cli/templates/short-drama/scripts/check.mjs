// "check" stage: episode count, estimated length from dialogue, unused characters, missing cliffhangers. Warns only.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const wanted = Number(flowInputs.episodes) > 0 ? Number(flowInputs.episodes) : 5;
const seconds = Number(flowInputs.episodeSeconds) > 0 ? Number(flowInputs.episodeSeconds) : 90;

const characters = JSON.parse(fs.readFileSync("characters.json", "utf8"));
const names = (Array.isArray(characters.characters) ? characters.characters : []).map((c) => String(c.name ?? "")).filter(Boolean);
const script = fs.readFileSync("script.md", "utf8").replace(/\r\n/g, "\n");

// Split into episodes at "## E<n>".
const parts = script.split(/^(?=##\s*E\d+)/m).filter((p) => /^##\s*E\d+/.test(p));
const episodes = parts.map((part) => {
  const n = Number(part.match(/^##\s*E(\d+)/)[1]);
  const lines = part.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  // Dialogue: "Name: line" / "名字：台词" (names may contain spaces), optionally with a parenthetical after the name.
  const dialogue = lines
    .filter((l) => !l.startsWith("△") && !/^【|^\[cliffhanger\]/i.test(l))
    .map((l) => l.match(/^[^：:△【\[]{1,30}?(?:\s*[（(][^）)]*[）)])?\s*[：:]\s*(.+)$/)?.[1])
    .filter(Boolean);
  const amount = en
    ? dialogue.join(" ").split(/\s+/).filter(Boolean).length / 2.5
    : [...dialogue.join("").replace(/[\s，。！？、…—“”‘’,.!?"']/g, "")].length / 4;
  // Each action line (△) adds about 3 seconds of screen time.
  const actions = lines.filter((l) => l.startsWith("△") && !/^△\s*(场景|scene)/i.test(l)).length;
  const last = lines[lines.length - 1] ?? "";
  return { n, estimate: Math.round(amount + actions * 3), cliffhanger: /^【悬念】|^\[cliffhanger\]/i.test(last) };
});
const tooShort = episodes.filter((e) => e.estimate < seconds * 0.6);
const tooLong = episodes.filter((e) => e.estimate > seconds * 1.4);
const noHook = episodes.filter((e) => !e.cliffhanger);
const unused = names.filter((name) => !script.includes(name));

const none = t("没有。", "None.");
const lines = [
  t("# 短剧剧本检查", "# Short drama check"),
  "",
  t(`写了 ${episodes.length} 集，要求 ${wanted} 集${episodes.length === wanted ? "，对得上" : "，对不上"}。`, `${episodes.length} episodes written, ${wanted} wanted${episodes.length === wanted ? ", matches" : ", does not match"}.`),
  "",
  t(`## 估算的时长（目标每集约 ${seconds} 秒）`, `## Estimated length (target about ${seconds} s each)`),
  ...episodes.map((e) => `- E${e.n}: ~${e.estimate}${t(" 秒", " s")}${e.estimate < seconds * 0.6 ? t("（偏短）", " (short)") : e.estimate > seconds * 1.4 ? t("（偏长）", " (long)") : ""}`),
  t("（台词按每秒 4 个汉字，每行动作约 3 秒；只是粗估。）", "(Dialogue at 2.5 English words a second, about 3 seconds per action line; a rough guess.)"),
  "",
  t("## 没有结尾悬念的集", "## Episodes without a cliffhanger"),
  noHook.length ? noHook.map((e) => `- E${e.n}`).join("\n") : none,
  "",
  t("## 没出场的人物", "## Characters who never appear"),
  unused.length ? unused.map((name) => `- ${name}`).join("\n") : none,
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = (episodes.length === wanted ? 0 : 1) + tooShort.length + tooLong.length + noHook.length + unused.length;
console.log(issues ? t(`有 ${issues} 处可以改，见 ${out}。`, `${issues} things to improve; see ${out}.`) : t("检查通过。", "All checks passed."));
