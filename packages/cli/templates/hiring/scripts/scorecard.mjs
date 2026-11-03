// "scorecard" stage: the interviewer's scorecard, and a check report.
//
// What it checks and where the rules come from (see README "参考资料 / References"):
// - Discrimination risk in the ad and the questions: China's Employment Promotion Law (arts. 3, 26–30), the Women's
//   Rights Protection Law (2022, art. 43) and the 2019 nine-department notice on gender in hiring: no gender limits
//   or preferences, no questions about marriage or children, no pregnancy tests; no exclusion of carriers of
//   infectious pathogens (art. 30).
// - Structured interviewing (Google re:Work; behaviorally anchored rating scales): the same questions for everyone,
//   every competency covered, anchors for each score, no brainteasers.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "");
const json = (file) => JSON.parse(read(file) || "{}");
const analysis = json("competencies.json");
const competencies = Array.isArray(analysis.competencies) ? analysis.competencies : [];
const interview = json("interview.json");
const questions = Array.isArray(interview.questions) ? interview.questions : [];
const ad = read("job-ad.md");
const byId = new Map(competencies.map((c) => [String(c.id), c]));

// Discrimination risk. Each rule: [label, pattern].
const adRules = [
  [t("性别限制或优先", "Gender limits or preferences"), /限男|限女|仅限男|仅限女|只招男|只招女|男性优先|女性优先|男士优先|女士优先|男生优先|女生优先|性别\s*[:：]?\s*[男女]|\b(?:male|female|men|women)\s+(?:only|preferred)\b/gi],
  [t("年龄限制", "Age limits"), /\d{2}\s*周?岁(?:以下|以内|以上|之间)|年龄\s*(?:要求|限制|不超过|在)|年轻有活力|年轻化|\bunder\s+\d{2}\b|\baged?\s+\d{2}\s*(?:-|–|to)\s*\d{2}\b|\byoung\b|\bdigital native\b/gi],
  [t("婚育状况", "Marriage or children"), /已婚已育|已婚|未婚|已育|婚育|生育|怀孕|二胎|三胎|\bmarried\b|\bsingle\b|\bpregnan\w*|\bno (?:kids|children)\b/gi],
  [t("户籍和籍贯", "Household registration or origin"), /本地户口|本地户籍|户籍|户口|籍贯|\bnative[- ]born\b|\blocal residents? only\b/gi],
  [t("民族和宗教", "Ethnicity or religion"), /汉族|少数民族|民族|宗教|信仰|\bethnic\w*|\breligio\w*/gi],
  [t("身高相貌", "Height or looks"), /身高|体重|五官端正|形象好|气质佳|颜值|相貌|\bheight\b|\battractive\b|\bgood[- ]looking\b/gi],
  [t("健康状况（病原携带者不得拒录）", "Health status (carriers may not be refused)"), /乙肝|病原携带|无病史|\bhepatitis\b|\bmedical history\b/gi],
];
const questionRules = [
  [t("问婚恋和生育", "Marriage, partners or children"), /结婚|婚姻|孩子|小孩|生育|怀孕|二胎|三胎|男朋友|女朋友|对象|\bmarried\b|\bspouse\b|\bchildren\b|\bkids\b|\bpregnan\w*|\bboyfriend\b|\bgirlfriend\b/gi],
  [t("问年龄", "Age"), /多大了|几岁|年龄|属什么|\bhow old\b|\byour age\b/gi],
  [t("问户籍、民族、宗教", "Origin, ethnicity, religion"), /户口|户籍|老家|民族|宗教|信仰|\bwhere are you from\b|\bnationality\b|\bethnic\w*|\breligio\w*/gi],
  [t("问健康和病史", "Health or medical history"), /病史|乙肝|生过病|\bmedical\b|\bdisab\w*|\billness\b/gi],
  [t("脑筋急转弯", "Brainteasers"), /井盖|乒乓球|高尔夫球|钢琴调音师|\bmanhole\b|\bgolf balls?\b|\bpiano tuners?\b|\bping[- ]?pong balls?\b/gi],
];
const findAll = (rules, text) => rules.flatMap(([label, re]) => [...new Set([...text.matchAll(re)].map((m) => m[0]))].map((hit) => (en ? `${label}: "${hit}"` : `${label}：「${hit}」`)));
const adHits = findAll(adRules, ad);
const questionText = questions.map((q) => [q.question, ...(Array.isArray(q.probes) ? q.probes : [])].join("\n")).join("\n");
const questionHits = findAll(questionRules, questionText);

// Coverage.
// Every competency except resume-only ones gets interview questions (two for interview, one plus the work sample).
const interviewed = competencies.filter((c) => c.assess !== "resume");
const uncovered = interviewed.filter((c) => !questions.some((q) => String(q.competency) === String(c.id))).map((c) => `${c.id} ${c.name}`);
const orphan = questions.filter((q) => !byId.has(String(q.competency))).map((q) => `${q.id} → ${q.competency}`);
const noAnchors = questions.filter((q) => !["1", "3", "5"].every((k) => String(q.anchors?.[k] ?? "").trim())).map((q) => q.id);
const noProbes = questions.filter((q) => !Array.isArray(q.probes) || !q.probes.length).map((q) => q.id);
const behavioral = questions.filter((q) => q.type === "behavioral").length;
const needsSample = competencies.filter((c) => c.assess === "work-sample");
const sampleMissing = needsSample.length && !String(interview.workSample ?? "").trim();
const vague = /责任心|抗压|吃苦耐劳|积极主动|团队精神|沟通能力强|\bteam player\b|\bhard[- ]working\b|\bpassionate\b|\bself[- ]starter\b/i;
const vagueDefs = competencies.filter((c) => vague.test(String(c.definition ?? ""))).map((c) => `${c.id} ${c.name}`);

// The scorecard.
const title = ad.match(/^#\s+(.+)$/m)?.[1]?.trim() || String(flowInputs.role ?? "");
const scorecard = [
  `# ${title}${t(" 面试评分表", " — interview scorecard")}`,
  "",
  t("候选人：__________　面试官：__________　日期：__________", "Candidate: __________   Interviewer: __________   Date: __________"),
  "",
  t("每道题都问，按顺序问，用追问把情境、任务、行动、结果问清楚。先独立打分、写下证据，再和其他面试官讨论。", "Ask every question, in order, and use the probes to get the situation, task, action and result. Score on your own and note the evidence before talking with the other interviewers."),
  "",
  ...questions.flatMap((q, i) => {
    const c = byId.get(String(q.competency));
    return [
      `## ${i + 1}. ${c ? c.name : q.competency}${c?.must ? t("（必须）", " (must-have)") : ""}`,
      "",
      `**${q.question}**`,
      "",
      ...(Array.isArray(q.probes) && q.probes.length ? [t("追问：", "Probes:"), ...q.probes.map((p) => `- ${p}`), ""] : []),
      t("| 分数 | 什么样的回答 |", "| Score | What the answer looks like |"),
      "| --- | --- |",
      ...["1", "3", "5"].map((k) => `| ${k} | ${String(q.anchors?.[k] ?? "").replace(/\|/g, "\\|")} |`),
      "",
      t("得分（1–5）：____　证据：________________________________", "Score (1–5): ____   Evidence: ________________________________"),
      "",
    ];
  }),
  ...(String(interview.workSample ?? "").trim() ? [t("## 工作样本", "## Work sample"), "", String(interview.workSample).trim(), "", t("得分（1–5）：____　证据：________________________________", "Score (1–5): ____   Evidence: ________________________________"), ""] : []),
  t("## 结论", "## Decision"),
  "",
  t("- [ ] 强烈推荐　- [ ] 推荐　- [ ] 不推荐　- [ ] 强烈不推荐", "- [ ] Strong yes   - [ ] Yes   - [ ] No   - [ ] Strong no"),
  "",
  t("必须项里有一项低于 3 分时，写清理由：", "If any must-have scores below 3, say why:"),
  "",
];

const none = t("没有。", "None.");
const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 招聘启事里的歧视风险", "## Discrimination risk in the job ad"), adHits],
  [t("## 面试题里不该问的", "## Questions that should not be asked"), questionHits],
  [t("## 没有面试题的能力项", "## Competencies with no questions"), uncovered],
  [t("## 指向不存在能力项的题", "## Questions tied to an unknown competency"), orphan],
  [t("## 缺 1/3/5 分锚点的题", "## Questions missing 1/3/5 anchors"), noAnchors],
  [t("## 没有追问的题", "## Questions with no probes"), noProbes],
  [t("## 看不见的能力定义", "## Competency definitions you can't observe"), vagueDefs],
];
const report = [
  t("# 招聘检查", "# Hiring check"),
  "",
  t(`能力项 ${competencies.length} 个（面试或工作样本考察 ${interviewed.length} 个），面试题 ${questions.length} 道，其中行为题 ${behavioral} 道。`, `${competencies.length} competencies (${interviewed.length} assessed by interview or work sample), ${questions.length} questions, ${behavioral} of them behavioral.`),
  questions.length && behavioral * 2 < questions.length ? t("⚠️ 行为题不到一半。问过去做过什么，比问假设的情况更能预测表现。", "⚠️ Fewer than half the questions are behavioral. Past behavior predicts performance better than hypotheticals.") : t("行为题占一半以上。", "At least half the questions are behavioral."),
  sampleMissing ? t("⚠️ 有能力项要用工作样本评估，但没写工作样本任务。", "⚠️ A competency is assessed by work sample, but no task is written.") : "",
  "",
  ...sections.flatMap(([heading, xs]) => [heading, list(xs), ""]),
  t("命中的词不一定违法（比如“生育险”是福利），但都要人看一眼。这些检查不能代替法律意见。", "A hit is not always unlawful (\"maternity insurance\" is a benefit), but a person should look at each. These checks are not legal advice."),
  "",
];

const scorecardPath = outputs.find((o) => /scorecard/.test(o.path))?.path ?? "scorecard.md";
const reportPath = outputs.find((o) => /check/.test(o.path))?.path ?? "check-report.md";
fs.writeFileSync(scorecardPath, `${scorecard.join("\n")}\n`);
fs.writeFileSync(reportPath, `${report.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n")}\n`);
console.log(report.join("\n"));
const issues = sections.reduce((n, [, xs]) => n + xs.length, 0) + (sampleMissing ? 1 : 0) + (questions.length && behavioral * 2 < questions.length ? 1 : 0);
console.log(t(`已写入 ${scorecardPath}。`, `Wrote ${scorecardPath}.`));
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${reportPath}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${reportPath}.`) : t("检查通过。", "All checks passed."));
