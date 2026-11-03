// "check" stage: episode count, estimated length, opening hooks, cliffhangers, the paywall episode, unused characters. Warns only.
//
// Industry norms behind it (see README "参考资料 / References"): episodes of about 1 to 2 minutes, conflict in the
// first seconds, every episode ending on a cliffhanger, and the paywall placed at an emotional peak.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const wanted = Number(flowInputs.episodes) > 0 ? Number(flowInputs.episodes) : 5;
const seconds = Number(flowInputs.episodeSeconds) > 0 ? Number(flowInputs.episodeSeconds) : 60;
const paywallAt = Number(flowInputs.paywallAt) > 0 ? Number(flowInputs.paywallAt) : 0;

const characters = JSON.parse(fs.readFileSync("characters.json", "utf8"));
const names = (Array.isArray(characters.characters) ? characters.characters : []).map((c) => String(c.name ?? "")).filter(Boolean);
const script = fs.readFileSync("script.md", "utf8").replace(/\r\n/g, "\n");
const beats = fs.existsSync("episodes.json") ? JSON.parse(fs.readFileSync("episodes.json", "utf8")) : {};
const beatList = Array.isArray(beats.episodes) ? beats.episodes : [];
const ending = /^【悬念】|^【付费卡点】|^\[cliffhanger\]|^\[paywall\]/i;
const paywallLine = /^【付费卡点】|^\[paywall\]/i;

// Split into episodes at "## E<n>".
const parts = script.split(/^(?=##\s*E\d+)/m).filter((p) => /^##\s*E\d+/.test(p));
const episodes = parts.map((part) => {
  const n = Number(part.match(/^##\s*E(\d+)/)[1]);
  const lines = part.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  // Dialogue: "Name: line" / "名字：台词" (names may contain spaces), optionally with a parenthetical after the name.
  const dialogue = lines
    .filter((l) => !l.startsWith("△") && !/^【/.test(l) && !ending.test(l))
    .map((l) => l.match(/^[^：:△【\[]{1,30}?(?:\s*[（(][^）)]*[）)])?\s*[：:]\s*(.+)$/)?.[1])
    .filter(Boolean);
  const amount = en
    ? dialogue.join(" ").split(/\s+/).filter(Boolean).length / 2.5
    : [...dialogue.join("").replace(/[\s，。！？、…—“”‘’,.!?"']/g, "")].length / 4;
  // Each action line (△) adds about 3 seconds of screen time.
  const actions = lines.filter((l) => l.startsWith("△") && !/^△\s*(场景|scene)/i.test(l)).length;
  const last = lines[lines.length - 1] ?? "";
  // The opening line should be inside the conflict, not voice-over exposition.
  const first = lines.find((l) => !/^△\s*(场景|scene)/i.test(l)) ?? "";
  const narratedOpening = /旁白|画外音|\bV\.?O\.?\b|narrator/i.test(first);
  return { n, estimate: Math.round(amount + actions * 3), cliffhanger: ending.test(last), paywall: paywallLine.test(last), narratedOpening };
});
const tooShort = episodes.filter((e) => e.estimate < seconds * 0.6);
const tooLong = episodes.filter((e) => e.estimate > seconds * 1.4);
const noHook = episodes.filter((e) => !e.cliffhanger);
// "Lin Wen (林文)" counts as used when the script says "Lin Wen": a bracketed translation is not part of the name.
const unused = names.filter((name) => {
  const bare = name.replace(/\s*[（(][^）)]*[）)]\s*/g, " ").trim() || name;
  return !script.includes(name) && !script.includes(bare);
});
const narrated = episodes.filter((e) => e.narratedOpening);
const noPayoff = beatList.filter((b) => !String(b.payoff ?? "").trim()).map((b) => b.n);
const paywallEpisode = episodes.find((e) => e.n === paywallAt);
const paywallProblem = paywallAt
  ? !paywallEpisode
    ? t(`没写到付费卡点那一集（第 ${paywallAt} 集）。`, `Episode ${paywallAt}, the paywall episode, is not written.`)
    : !paywallEpisode.paywall
      ? t(`第 ${paywallAt} 集最后一行不是【付费卡点】。`, `Episode ${paywallAt} does not end with [Paywall].`)
      : ""
  : "";

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
  t("## 开头用旁白交代背景的集（应该一上来就是冲突）", "## Episodes opening on voice-over (should open on conflict)"),
  narrated.length ? narrated.map((e) => `- E${e.n}`).join("\n") : none,
  "",
  t("## 节拍里没有爆发点的集", "## Episodes with no payoff in the beats"),
  noPayoff.length ? noPayoff.map((n) => `- E${n}`).join("\n") : none,
  "",
  paywallAt ? (paywallProblem || t(`付费卡点在第 ${paywallAt} 集结尾。`, `The paywall is at the end of episode ${paywallAt}.`)) : t("没有设付费卡点。", "No paywall set."),
  "",
  t("## 没出场的人物", "## Characters who never appear"),
  unused.length ? unused.map((name) => `- ${name}`).join("\n") : none,
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = (episodes.length === wanted ? 0 : 1) + tooShort.length + tooLong.length + noHook.length + unused.length + narrated.length + noPayoff.length + (paywallProblem ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处可以改，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to improve; see ${out}.`) : t("检查通过。", "All checks passed."));
