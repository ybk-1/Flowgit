# 竖屏短剧剧本 / Vertical micro-drama

从一句梗概写出竖屏微短剧的开篇集。做法按国内微短剧行业的常见打法：先定观众要的情绪，再定故事；每集按“钩子 → 压抑 → 爆发 → 悬念”走，前 3 秒就进冲突，付费卡点放在情绪最高点。写完后像平台审核和责编一样审读一遍，依据是国家广电总局对微短剧的管理提示。

Write the opening episodes of a vertical micro-drama from a one-line premise, the way China's micro-drama industry works: start from the emotion the audience comes for, then the story; each episode runs hook → suppression → payoff → cliffhanger, with conflict in the first three seconds and the paywall at an emotional peak. The scripts then get a reviewer's and script editor's read based on the NRTA's guidance on micro-dramas.

## 阶段 / Stages

1. **设定和人物 characters**（模型）：`characters.json`。一句话故事、观众来看的核心情绪（例如“被看不起的人扬眉吐气”）、前几集答应观众的爽点，以及 3 到 5 个人物（想要什么、被什么挡住、藏着什么）。
2. **分集节拍 outline**（模型）：`episodes.json`，正好 `episodes` 集，每集写前 3 秒的钩子、压抑、爆发（反转或打脸）和结尾悬念；第 `paywallAt` 集标成付费卡点。
3. **剧本 script**（模型）：`script.md`，每集一个 `## E1`，`△` 一行一个镜头（约 3 到 6 秒），`人物名：台词`，最后一行是 `【悬念】`，付费卡点那集是 `【付费卡点】`。
4. **审读 review**（模型）：`review.md`。内容导向逐项过：奢华拜金、低俗暴力、反智离谱的人设、对老人孩子的贬低；创作质量逐项过：前 3 秒、压抑和爆发、悬念、人物动机。列出最该先改的三处。
5. **检查 check**（脚本）：`check-report.md`。集数、估算时长（台词每秒约 4 个汉字，每个镜头约 3 秒）、哪集用旁白开头、哪集节拍里没有爆发点、哪集没有结尾悬念、付费卡点是否在对的那集、哪个人物没出场。只提醒，不拦。

1. **characters** (model): `characters.json` with the logline, the core emotion (for example "the underdog gets vindicated"), the promise of the opening episodes, and 3 to 5 characters (want, obstacle, secret).
2. **outline** (model): `episodes.json`, exactly `episodes` episodes, each with a 3-second hook, suppression, payoff (twist or comeback) and cliffhanger; episode `paywallAt` is marked as the paywall.
3. **script** (model): `script.md`, one `## E1` per episode, one `△` line per shot (about 3 to 6 seconds), `Name: line` dialogue, ending with `[Cliffhanger]`, or `[Paywall]` on the paywall episode.
4. **review** (model): `review.md`. Content guidance item by item (wealth worship, vulgarity and violence, absurd characters, disparaging the elderly or children) and craft item by item (first three seconds, suppression and payoff, cliffhangers, motivation), with the three fixes that matter most.
5. **check** (script): `check-report.md`. Episode count, estimated length (about 2.5 English words of dialogue a second, about 3 seconds a shot), voice-over openings, episodes without a payoff, missing cliffhangers, whether the paywall is on the right episode, and characters who never appear. It warns; it does not block.

想拍成视频：把一集的剧本交给短视频模板（`flowgit init -t short-video`）当主题，或者直接按剧本拍。

Want to shoot it? Use one episode as the topic for the short-video template (`flowgit init -t short-video`), or shoot straight from the script.

## 怎么跑 / How to run

```bash
flowgit init ~/my-drama -t short-drama
cd ~/my-drama
flowgit inputs set premise=被裁员的程序员回老家开面馆，前老板来应聘
flowgit inputs set episodes=10 paywallAt=10
flowgit run all
```

没有 API key 时，用固定回复跑通。示例只写了 3 集短的，所以先把集数和付费卡点设成 3，检查会提示每集偏短：

Without an API key, the canned replies run the flow. The sample has only 3 short episodes, so set the count and the paywall to 3; the check reports the short episodes:

```bash
flowgit inputs set episodes=3 paywallAt=3
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- 行业形态：小程序微短剧常见每集 1 到 2 分钟、一部 80 到 100 集，前 10 到 20 集免费，付费卡点设在关键剧情处。[21 经济网：2024 短剧行业研究报告](https://www.21jingji.com/article/20240710/herald/f3452d460dd7e6345226ac251e8ceb09.html)、[北京大学国家发展研究院：2025 年中国微短剧产业格局与就业发展报告](https://www.nsd.pku.edu.cn/docs/2026-02/48accc85b74f4939b8f4c4b612e610ec.pdf)、[搜狐：从本体特征看竖屏微短剧](https://www.sohu.com/a/830103280_121999067)。/ Industry shape: 1-to-2-minute episodes, 80 to 100 per series, the first 10 to 20 free, the paywall at a key plot point.
- 创作方法：先定情绪钩子，付费卡点放在情绪和悬念最高点、倒推节奏，黄金三秒，“期待—压抑—爆发”。[人人都是产品经理：小说改短剧](https://www.woshipm.com/operate/6260720.html)。这些是从业者经验，不是统一标准。/ Craft: emotion first, the paywall at the emotional peak, the three-second hook, build-up–suppression–payoff (practitioner experience, not a standard).
- 监管：国家广电总局落实微短剧“分类分层审核”，未取得许可或备案的微短剧不得上线（[新华网，2025-02-05](https://www.news.cn/politics/20250205/3fbf8abbfa344641b01f799ae42a6318/c.html)、[不得上线未标注备案号的微短剧](https://www.tvoao.com/a/220310.aspx)）；管理提示点名“霸总”类渲染奢华拜金（[整治“霸总”类短剧](https://www.tvoao.com/a/222542.aspx)），以及杜绝极端“反智”“雷人”“离谱”的人设和剧情（[杜绝过度娱乐化和反智化倾向](https://www.tvoao.com/a/221678.aspx)）。/ Regulation: NRTA's tiered review and filing of micro-dramas, and its notices on "domineering CEO" wealth worship and absurd, anti-intellectual plots.

审读阶段只是创作参考，不能代替平台审核和备案。 / The review stage is a writing aid; it does not replace platform review or filing.
