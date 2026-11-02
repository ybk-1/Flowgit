# 网文连载 / Web novel serial

从一句话点子开一本连载网文。网文读者在手机上按章追更，一章不好看就可能弃书，所以这个流程按行业里常说的几条经验来搭：开头的“黄金三章”要尽快进入冲突、亮出主角的金手指；每章有一个爽点和一个章末钩子；设定阶段先列出读者会追着看的几件“期待”，后面每章都要推进其中一件。

Start a serialized web novel from a one-line idea. Serial readers follow a book chapter by chapter on their phones and drop it after a dull chapter, so the flow is built on the craft rules the industry repeats: the "golden first three chapters" get into conflict fast and show the hero's edge; every chapter has a payoff and a closing hook; and the setting lists the few expectations readers will follow the book for, which the chapters keep moving forward.

## 阶段 / Stages

1. **设定和卖点 setting**（模型）：`setting.json`。一句话卖点、和同类书最不一样的一点、主角（目标、缺点、金手指和它的代价）、对手、写成限制的世界规则、3 到 5 件“期待”和大概在哪兑现、第一卷的起点和终点。
2. **分章细纲 outline**（模型）：`outline.json`。每章的目标、冲突、爽点、章末钩子、推进了哪件期待，以及金手指在哪一章亮出来。
3. **黄金三章 chapters**（模型）：`chapters.md`。按细纲写前三章正文：开头就是动作或对话，设定在冲突里一点点带出来，每章停在钩子上，段落短，适合手机读。
4. **检查 check**（脚本）：`check-report.md`。每章字数和目标差多少；细纲有没有缺目标、冲突或钩子；有没有连续三章以上没有爽点；有没有从没推进的期待；金手指是不是在前三章出现；第一段是不是没有对话的大段背景；有没有手机上读太长的段落。

1. **setting** (model): `setting.json` with the one-line hook, what sets the book apart, the hero (goal, flaw, edge and its cost), rivals, world rules written as limits, 3 to 5 expectations with roughly where each pays off, and the arc of volume one.
2. **outline** (model): `outline.json`, each chapter's goal, conflict, payoff, closing hook and the expectations it moves, plus the chapter where the edge first shows.
3. **chapters** (model): `chapters.md`, the first three chapters in full, opening on action or dialogue, with the setting revealed inside the conflict, each ending on its hook, in short paragraphs for phone reading.
4. **check** (script): `check-report.md`. Length against the target; outline chapters missing a goal, conflict or hook; runs of three or more chapters with no payoff; expectations never moved forward; whether the edge shows in the first three chapters; first paragraphs that are long background with no dialogue; paragraphs too long for a phone.

正文写好以后，接着在 `outline.json` 里加章节、改 `chapters.md` 往下写就行；改了细纲，正文阶段会提示需要重跑。手动改过的正文不会被覆盖。

To keep going, add chapters to `outline.json` and continue in `chapters.md`. Editing the outline marks the chapters stage as needing a re-run; your hand edits to the text are never overwritten.

## 怎么跑 / How to run

```bash
flowgit init ~/my-novel -t novel-serial
cd ~/my-novel
flowgit inputs set premise=外卖员捡到能看见别人好感度的眼镜 genre=都市
flowgit run all
```

没有 API key 时，用固定回复跑通（示例正文很短，所以把每章字数设小）：

Without an API key, the canned replies run the flow (the sample chapters are short, so set a small chapter length):

```bash
flowgit inputs set chapterWords=160
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

模型一次写三章时常常写不到目标字数，检查会标出来。可以重跑正文阶段（`flowgit run chapters`），或者直接在 `chapters.md` 里扩写；手动改过的正文不会被覆盖。

Models writing three chapters in one go often fall short of the target length, and the check flags it. Re-run the chapters stage (`flowgit run chapters`) or expand `chapters.md` by hand; hand edits are never overwritten.

## 参考资料 / References

- “黄金三章”：网文行业的共识是前三章要写出足够的冲突、悬念或其他吸引人的内容，让读者愿意追下去，全书则是不断抛出新矛盾、制造新高潮；也有评论批评平台把它做成公式化模板（例如每 500 字一个情绪刺激点）。[中国作家网：网络文学不应止于“爽”还要求深](https://www.chinawriter.com.cn/n1/2025/0816/c404027-40543716.html)、[中国作家网：江月年年访谈](https://www.chinawriter.com.cn/n1/2024/0327/c404024-40204446.html)、[中国作家网：跨媒介写作与新人文趋向](https://www.chinawriter.com.cn/n1/2025/0219/c419351-40421455.html)。/ The "golden first three chapters" and the critique of formula.
- 爽感和金手指：金手指是制造爽感的工具，现在多在开头几章就出现，读者把它当成“爽”成立的保证；情节要“曲折再三”，有波折也有节奏；爽感模式过度复制会带来同质化。[中国作家网：“爽”及其完成](https://www.chinawriter.com.cn/n1/2024/1128/c404027-40370888.html)、[中国作家网：从经验创作角度谈网络文学爽感现象](https://www.chinawriter.com.cn/n1/2026/0807/c404027-40775670.html)、[中国作家网：网络小说的读者心理机制](https://www.chinawriter.com.cn/n1/2026/0921/c404027-40802996.html)。/ Payoff ("shuang"), the hero's edge, and pacing.
- 细纲写法：每章记目标情绪、章首钩子和爽点，分批建纲；写作指南常说每 3000 到 5000 字要有一个让读者爽的情绪节点（这是经验数字，没有统计依据；这个流程按“最多连续两章没有爽点”来检查）。[story-long-write 写作流程](https://clawhub.ai/worldwonderer/story-long-write)。/ Chapter-level outlines and a practitioner rule of thumb on payoff density.
- 平台签约：番茄小说改为完本后申请签约，并收紧门槛、打击刷量和 AI 粗制滥造内容。[界面新闻](https://m.jiemian.com/article/15182681.html)、[界面新闻](https://m.jiemian.com/article/15200652.html)。/ Fanqie's completed-book contracts and its crackdown on low-quality AI content.
- 国家新闻出版署《关于进一步加强网络文学出版管理的通知》（国新出发〔2020〕11 号）：内容导向正确、格调健康向上，抵制模式化、同质化，创作者实名注册。[中国作家网](https://www.chinawriter.com.cn/n1/2020/0615/c403994-31747637.html)、[China Law Translate](https://www.chinalawtranslate.com/online-literature-regulation/)。/ The 2020 NPPA notice on online literature.
