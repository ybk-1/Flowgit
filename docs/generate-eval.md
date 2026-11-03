# 一句话生成流程评测 / Flow generation evaluation

2026 年 11 月 3 日，我们用 DeepSeek（`deepseek/deepseek-chat`）评测了 `flowgit new`：一组 10 句描述，中英文各一半，每句生成一个流程，看它能不能通过 `flowgit validate` 和 `flowgit run all --dry-run`，再逐个读生成的流程。第一轮全部通过了校验和预演，但读下来大多不能用。我们按读到的问题改了读取回复的代码和三份生成提示词，再跑。这份报告记下方法、发现、改了什么和还没解决的问题。模板的评测在 [template-eval.md](template-eval.md)。

On 3 November 2026 we evaluated `flowgit new` on DeepSeek (`deepseek/deepseek-chat`): a set of 10 descriptions, half in Chinese and half in English, one flow generated from each, checked with `flowgit validate` and `flowgit run all --dry-run`, then read one by one. In round one every flow passed validation and the dry run, yet most of them could not do the job. We changed the code that reads the model's reply and the three generation prompts to fix what we read, and ran again. This report records the method, the findings, what changed and what is still open. The templates' evaluation is in [template-eval.md](template-eval.md).

## 测试集 / The test set

日常工作里常见的事，来自不同行业。“要求了”一栏是描述里明说要用的执行器；别的描述都不能生成脚本或 agent 阶段。

Everyday jobs from different fields. "Asks for" is the executor a description asks for in so many words; no other description may get a script or agent stage.

| id | 语言 Lang | 描述 Description | 要求了 Asks for |
| --- | --- | --- | --- |
| `xhs-note` | zh | 把我写的产品试用笔记改成一篇小红书种草笔记，配 5 个话题标签，发之前检查有没有夸大和违禁词。 | |
| `video` | zh | 做一条 60 秒的抖音口播视频脚本：先定选题和开头三秒的钩子，再写分镜和口播稿，最后列出要拍的镜头清单。 | |
| `sales-week` | zh | 每周一把上周的销售数据 CSV 做成周报：用脚本算出各区域的销售额和环比，再写结论和下周建议。 | script |
| `interviews` | zh | 整理 8 场用户访谈的记录：逐场提炼要点，归纳共同的痛点，最后给产品经理写一页结论和建议。 | |
| `contract` | zh | 帮法务审一份采购合同：标出风险条款并给出修改建议，再写一封发给对方的修订说明邮件。 | |
| `grant` | en | Write a grant proposal for a community garden: gather the facts, draft each section to the funder's guidelines, and score it against the funder's rubric before submitting. | |
| `support` | en | Answer a customer complaint email: sort out what the customer wants, check it against the refund policy I paste in, draft a polite reply, and flag anything a manager has to approve. | |
| `release` | en | Write release notes from the list of merged pull requests, with a coding agent that reads the repository to fill in the details, then a short announcement for our blog. | agent |
| `trip` | en | Plan a family trip with two young kids: take the city and the number of days as inputs, then write a day-by-day itinerary and a packing list. | |
| `interview-prep` | en | Help me prepare for a job interview: from the job ad and my resume, list the likely questions, draft answers in the STAR format, and make a one-page cheat sheet. | |

## 怎么跑 / How it runs

- `scripts/eval-generate.mjs` 调用 `generateFlow()`，就是 `flowgit new` 调用的那个函数，并记下每次模型调用的 token、耗时和是不是修复。每个流程写进自己的文件夹，模型的原始回复也留在里面（`.reply-<n>-<阶段>.txt`）。
- 然后在文件夹里跑命令行的 `flowgit validate` 和 `flowgit run all --dry-run`。必填的流程输入用 `flowgit new` 预演时的占位值。第二次预演之前，在每个人工阶段的产物位置放一个占位文件，这样后面的阶段也会排进计划。脚本阶段再在占位文件上真跑一次：占位文件不是真数据，好的脚本应该自己报错退出，打出调用栈就算崩溃。
- 规则能查出来的问题记在“发现”里：语言和描述不一致、英文流程里有中文；要求了脚本或 agent 却没有，或者没要求却有；阶段数不在 2 到 6 之间；流程输入没有进任何提示词、文档或数据被当成流程输入、可选输入没有默认值；人工阶段没有说明，或者排在最后只做审核；提示词点名了一个它不依赖的阶段的文件；模型阶段读一个文件夹（只看得到文件名）；脚本阶段要运行的文件不存在；提示词太短（中文少于 120 个字，英文少于 300 个字符）。
- 其余的靠人读：阶段是不是照这一行的做法拆的，材料是不是从人那里来，提示词有没有说清结构、标准和长度，有没有对照规则的检查。
- DeepSeek 忙碌（503）时，评测脚本等 30、60、120 秒再试，等待的时间不算进耗时。`--retry-failed` 只重跑生成失败的几次，`--rescore` 用现在的检查重查保存下来的流程，不调用模型。下面每一轮都用最后的检查重查过。

- `scripts/eval-generate.mjs` calls `generateFlow()`, the function `flowgit new` calls, and records every model call's tokens, time and whether it was a repair. Each flow is written into a folder of its own, with the model's raw replies beside it (`.reply-<n>-<stage>.txt`).
- Then the CLI runs `flowgit validate` and `flowgit run all --dry-run` in that folder, with the required flow inputs filled the way the `flowgit new` preview fills them. Before a second dry run, a placeholder file goes where each human stage's output belongs, so the stages after it are planned too. Script stages then really run once on those placeholders: a placeholder is not real data, so a good script stops with a message of its own, and a stack trace counts as a crash.
- Problems a rule can find are recorded as findings: a language that does not match the description, or Chinese in an English flow; a script or agent stage that was asked for and is missing, or was not asked for and is there; fewer than 2 or more than 6 stages; a flow input that no prompt uses, a document or data file taken as a flow input, an optional input without a default; a human stage without instructions, or at the end only to review; a prompt that names a file from a stage it does not depend on; a model stage that reads a folder (it sees only the file names); a script stage whose file does not exist; a thin prompt (under 120 Chinese characters, or 300 characters in English).
- The rest is done by reading: whether the stages follow how people in the field do the job, whether the material comes from the person, whether the prompts state the structure, the standard and the lengths, and whether there is a check against the rules.
- When DeepSeek is busy (503), the script waits 30, 60, then 120 seconds before trying again, and the wait is not counted in the time. `--retry-failed` reruns only the generations that failed, and `--rescore` checks saved flows again with today's checks, without calling the model. Every round below was checked again with the final checks.

## 第一轮发现了什么 / What round one found

10 个流程都通过了校验和预演，可是这个标准太低了。读下来的问题，按严重程度：

All 10 flows passed validation and the dry run, but that bar was too low. What reading them found, most serious first:

1. **人工、脚本和 agent 阶段被悄悄改成了模型阶段。** 10 份阶段计划里有 11 个人工阶段、1 个脚本阶段和 1 个 agent 阶段，写出来的流程只剩 1 个人工阶段，其余全是模型阶段。原因在读回复的代码：8 个回复把执行器的字段直接写在阶段上（`"type": "human"`、`"output": "a.md"`），代码只认 `"executor": { "type": ... }`，认不出就换成模型阶段，配一句“写出这一步的产物”当提示词（10 个提示词是这样来的）。结果是：要人提供的材料（试用笔记、花园的事实、合同、PR 列表、孩子的情况）变成由模型来编；要求的脚本和 agent 都没了。
2. **英文描述生成了中文流程。** 5 句英文描述里有 3 句（`grant`、`trip`、`interview-prep`）得到的流程名字、说明和提示词全是中文。提示词只说“match the description”，阶段计划回了 `"language": "zh"`，第二轮照抄。
3. **文档被当成流程输入，而且很多没进提示词。** 合同、投诉邮件、退款政策、简历、招聘启事、PR 列表、销售 CSV 共 8 个被写成 `text` 或 `file` 输入，其中 5 个没有出现在任何提示词里，模型根本看不到。
4. **依赖不全。** 5 个提示词点名了一个它不依赖的阶段的文件（比如定稿读 `facts.md`，却不依赖收集事实那一步），运行时模型拿不到那个文件。`support` 的回复用单数 `output` 写产物，被忽略后产物路径变成默认的 `<id>.md`，和提示词里写的文件名对不上。
5. **提示词太空。** 18 个提示词低于上面的长度线，除了那 10 个占位，还有只写一两句要求的。

1. **Human, script and agent stages were quietly turned into model stages.** The 10 stage plans had 11 human stages, 1 script stage and 1 agent stage; the flows written from them kept 1 human stage, and every other stage was a model stage. The cause was the code that reads the reply: 8 replies put the executor's fields straight on the stage (`"type": "human"`, `"output": "a.md"`), the code only understood `"executor": { "type": ... }`, and whatever it did not understand became a model stage with "Write the output for this step" as its prompt (10 prompts came from that). So the material a person was meant to supply (trial notes, the garden's facts, the contract, the list of pull requests, the children's needs) was made up by the model instead, and the requested script and agent were gone.
2. **English descriptions got Chinese flows.** 3 of the 5 English descriptions (`grant`, `trip`, `interview-prep`) got a flow whose name, descriptions and prompts were all Chinese. The prompt only said "match the description"; the stage plan came back with `"language": "zh"`, and round two copied it.
3. **Documents were taken as flow inputs, and many reached no prompt.** The contract, the complaint email, the refund policy, the resume, the job ad, the pull request list and the sales CSV, 8 in all, became `text` or `file` inputs, and 5 of them appeared in no prompt, so the model never saw them.
4. **Missing dependencies.** 5 prompts named a file from a stage they did not depend on (the final proposal reads `facts.md` but does not depend on the facts stage), so at run time the model would not get that file. `support`'s reply gave its outputs as a singular `output`, which was ignored, so the output paths fell back to `<id>.md` and no longer matched the file names in the prompts.
5. **Thin prompts.** 18 prompts were under the length line above: the 10 placeholders, and others with only a sentence or two of requirements.

## 改了什么 / What changed

### 读回复 / Reading the reply (`packages/core/src/generate.ts`)

- **阶段计划是骨架。** 第一轮的计划已经按允许的执行器定好了每个阶段的类型，所以计划里有的阶段，类型以计划为准。执行器的字段写在阶段上（`type`、`instructions`、`prompt`、`run`、`agent`）、产物写成单数 `output`（字符串或对象）也都认得。回复缺的东西（人工说明、命令、产物、名字、依赖）从计划补上；计划里的依赖和回复的依赖合在一起，合起来成环就只用回复的。回复漏掉了计划里的阶段，就交回模型修。
- **提示词点名的上游文件会加进依赖。** 提示词里出现一个更早阶段的产物文件名（按整个文件名匹配，`notes.md` 不会匹配 `meeting-notes.md`），而这个阶段没有依赖它，就加上依赖；会成环的不加。
- **语言由描述决定。** `--language` 没给时，汉字比英文单词多就是 `zh`，否则是 `en`（`descriptionLanguage`）。两轮提示词都明说用哪种语言，`flow.language` 也直接设成它，不再信计划里的 `language`。中文流程用繁体还是简体跟着描述。
- **脚本阶段带上脚本。** 回复多了 `scripts`，和 `prompts` 一样是“路径 → 内容”。脚本阶段的命令要运行一个文件：要么是回复写在 `scripts` 里的 Node.js 文件（用 `node` 运行），要么是文件夹里本来就有的文件；都不是就交回模型修。生成的脚本不能启动别的程序、联网或删除文件，查到就交回模型重写。这只是一道底线，不是沙箱：写入前文件清单里会列出脚本，人可以先读。
- **阶段计划出错也交回模型修**，最多 2 次（流程本身还是最多 3 次）。第二轮里有两句中文描述把流程输入的名字写成了中文（“产品品类”），以前这样会直接失败。

- **The stage plan is the skeleton.** Round one already chose each stage's type with the allowed executors, so for a stage in the plan, the plan's type wins. Executor fields on the stage itself (`type`, `instructions`, `prompt`, `run`, `agent`) and outputs given as a singular `output` (a string or an object) are understood. Whatever the reply leaves out (human instructions, the command, outputs, the name, dependencies) comes from the plan; the plan's dependencies are added to the reply's, unless together they form a cycle, in which case only the reply's are kept. A reply that leaves out a stage of the plan goes back to the model.
- **An upstream file that a prompt names becomes a dependency.** When a prompt names the output file of an earlier stage it does not depend on (matched as a whole file name, so `notes.md` does not match `meeting-notes.md`), the dependency is added, unless it would form a cycle.
- **The description decides the language.** Without `--language`, a description with more Han characters than English words is `zh`, otherwise `en` (`descriptionLanguage`). Both prompts state the language outright, and `flow.language` is set to it rather than taken from the plan. A Chinese flow uses Traditional or Simplified characters as the description does.
- **A script stage comes with its script.** The reply gains `scripts`, a map from path to text like `prompts`. A script stage's command must run a file: either a Node.js file the reply wrote under `scripts` (run with `node`), or a file already in the folder; anything else goes back to the model. A generated script may not start other programs, use the network or delete files; one that does goes back to the model to be rewritten. This is a floor, not a sandbox: the script is in the file list before anything is written, so the person can read it first.
- **A bad stage plan goes back to the model too**, at most twice (the flow itself still gets at most 3 repairs). In round two, two Chinese descriptions got input names written in Chinese ("产品品类"), which used to fail at once.

### 模型调用 / Model calls (`packages/core/src/executors/llm.ts`)

- **回复到一半断掉算错误。** DeepSeek 至少 3 次在停顿两到十一分钟以后结束了流，只回了一个 `{`，没有结束标记，也没有用量。以前 OpenAI 协议的调用会把这半截文字当成完整回复：生成流程时它被当成“不是 JSON”去修复，普通的模型阶段会直接把它写成产物。现在流结束时既没有结束标记也没有用量，就报错，并标成可重试，阶段写了 `retries` 会再试。
- **`flowgit new` 的每次调用会再试。** 遇到网络错误、429、5xx 或回复断掉，最多再试 2 次；模型答错了不算，那要走修复。

- **A reply that stops partway is an error.** At least 3 times DeepSeek ended a stream after stalling for two to eleven minutes, with only `{` as the text and no finish reason or usage. Before, a call on the OpenAI protocol took that fragment as the whole reply: flow generation sent it to a repair as "not JSON", and an ordinary model stage would write it as its output. Now a stream that ends with neither a finish reason nor usage is an error, marked retryable, so a stage with `retries` tries again.
- **Each call of `flowgit new` is tried again.** After a network error, a 429, a 5xx or a reply that stopped partway, it is tried up to 2 more times; a wrong answer is not one of these and goes to a repair.

### 提示词 / Prompts (`packages/core/prompts/`)

- `generate-plan.md`：用一个英文的完整例子（材料 → 写作 → 对照规则检查），讲清怎么拆：照这一行专业的人的步骤；人工阶段只放只有人有的材料或决定，说明里要把后面要用的东西都要齐（比如做环比要两周的数据）；有规则要守的工作最后加一个对照规则的检查阶段；不在最后放一个人审核、批准、定稿的阶段，因为人可以直接改任何产物，改动会保留；依赖要列全；模型阶段读文件，不读文件夹。流程输入只放每次要填的短值，名字用英文字母，可选的要有默认值，每个都要用上；文档和数据是人工阶段的文件。
- `generate-flow.md`：每种执行器的写法都写成 `"executor": { ... }`。提示词要写清：模型只看得到提示词和依赖阶段的文件；每个流程输入都用 `{{inputs.<key>}}` 放进至少一个提示词；结构、长度用词、句、条来说（不用字数）；这一行的标准是什么；只用材料里的事实，缺的就说缺；检查阶段逐条引用规则并给出通过或要改。脚本要写清读什么、怎么算，只读依赖的文件、只写自己的产物，能处理 BOM、Windows 换行、带引号的 CSV 字段和带千分位的数字；比较两个时期时先按时期（周一到周日）分组。
- `generate-repair.md`：计划和流程都用它，并提醒脚本阶段也要带上脚本。

- `generate-plan.md`: one complete English example (material → writing → a check against the rules) and the rules for splitting the job: follow the steps a professional in the field takes; a human stage holds only material or a decision only the person has, and its instructions ask for everything the later stages need (both weeks of data for a week-over-week comparison); work with rules to follow ends with a stage that checks it against them; no final stage where a person reviews, approves or finalizes, because the person can edit any output and the edits are kept; list every dependency; a model stage reads files, not folders. Flow inputs are only short values asked for on each run, named in English letters, with a default when optional, and every one is used; documents and data are a human stage's file.
- `generate-flow.md`: every executor is written as `"executor": { ... }`. A prompt states that the model sees only the prompt and the files of the stages it depends on; every flow input goes into at least one prompt as `{{inputs.<key>}}`; structure and lengths are in words, sentences or items (not characters); what the standard of the field is; only facts from the materials, with gaps said out loud; a check stage quotes each rule and gives pass or fix. A script says what it reads and computes, reads only the files it depends on and writes only its own outputs, copes with a BOM, Windows line endings, quoted CSV fields and numbers with thousands separators, and groups rows by period (Monday to Sunday) before comparing periods.
- `generate-repair.md`: used for both the plan and the flow, and reminds the model that a script stage keeps its script.

## 结果 / Results

### 各轮对比 / Rounds compared

第二轮是改完以后第一次复测。`xhs-note` 和 `contract` 的阶段计划把流程输入的名字写成了中文，当时会直接失败；加上计划修复以后，这两句各重跑了两次，算在第二轮里。第三轮加了脚本的规则，跑到一半 DeepSeek 一直返回 503（服务太忙），跑完的 19 次里有 8 次失败，我们就停了。它暴露的两个问题在最后一轮之前修好了：脚本把两个日期当成两周来比；提示词点名了一个它不依赖的阶段的文件。最后一轮每句描述生成两次。

Round two was the first run after the changes. The stage plans for `xhs-note` and `contract` named flow inputs in Chinese, which then failed at once; once the plan repair was in, each of the two was run twice more, counted in round two. Round three added the rules for scripts and was halfway through when DeepSeek kept answering 503 (service too busy): 8 of the 19 generations that finished failed, so we stopped it. The two problems it showed were fixed before the final round: a script compared two single days instead of two weeks, and a prompt named a file from a stage it did not depend on. The final round generated each description twice.

| | 第一轮 Round one | 第二轮 Round two | 最后一轮 Final round |
| --- | --- | --- | --- |
| 生成次数 Generations | 10 | 14 | 20 |
| 生成成功 Generated | 10 | 12 | 20 ¹ |
| 通过校验和预演 Passed validation and the dry run | 10 | 12 | 20 |
| 有发现的流程 Flows with findings | 9 | 0 | 0 |
| 发现 Findings | 46 | 0 | 0 |
| 每个流程的阶段数 Stages per flow | 3.7 | 4.4 | 4.3 |
| 人工 / 模型 / 脚本 / agent 阶段 Human / llm / script / agent stages | 1 / 36 / 0 / 0 | 12 / 39 / 1 / 1 | 21 / 61 / 2 / 2 |
| 模型调用 / 其中修复 Model calls / of them repairs | 20 / 0 | 28 / 2 | 44 / 4 |
| 平均 token（输入 / 输出）Average tokens (in / out) | 1,894 / 1,326 | 4,368 / 2,718 | 4,320 / 2,731 |
| 耗时中位数 Median time | 12.1 s | 14.0 s | 16.9 s |
| 读下来的平均分 Average grade (1–5) | 2.4 | 4.7 | 4.7 |

¹ `video-1` 第一次遇上 503 失败，用 `--retry-failed` 重跑后通过。/ `video-1` failed on a 503 the first time and passed when rerun with `--retry-failed`.

- 第二轮和最后一轮都没有规则查得出的问题，平均分也一样。最后一轮多修好了两样：脚本算得对不对，这是规则查不出来的（第二轮的销售周报因此只有 3 分）；提示词点名的文件一定在依赖里，第三轮查出过一次，现在由代码补上。
- token 多了一倍多，是因为两份提示词写进了完整的例子和规则，回复里的提示词也更完整。按每次生成算，大约是 4,300 个输入、2,700 个输出 token。
- 耗时的中位数在 12 到 17 秒。最慢的几次是 DeepSeek 停顿：第二轮一次 666 秒，最后一轮两次 134 和 145 秒。
- 最后一轮的 4 次修复：2 次阶段计划的回复停顿后断掉，只有一个 `{`（现在会当成断掉的回复再试，不再用掉一次修复）；1 次阶段计划的 `dependsOn` 写了文件名而不是阶段 id；1 次流程的 JSON 括号不对（`prompts` 对象提前关上了）。都是第一次修复就好了。

- Neither round two nor the final round had a finding a rule can catch, and the two have the same average grade. The final round fixed two more things: whether the script computes the right thing, which no rule can check (round two's sales report got a 3 for it), and that a file a prompt names is always a dependency, which round three caught once and the code now adds.
- Tokens more than doubled because both prompts now carry a full example and the rules, and the prompts in the reply are fuller. A generation costs about 4,300 input and 2,700 output tokens.
- Median times are 12 to 17 seconds. The slowest runs were DeepSeek stalling: one of 666 seconds in round two, and two of 134 and 145 seconds in the final round.
- The final round's 4 repairs: 2 stage plans whose reply stalled and ended with only `{` (now retried as a reply that stopped partway, without using up a repair); 1 stage plan whose `dependsOn` held file names instead of stage ids; 1 flow whose JSON had its braces wrong (the `prompts` object closed too early). Each was fixed by the first repair.

### 每句描述的分数 / Grades per description

5 = 这一行的人拿来就能用；4 = 好用，有一两处小问题；3 = 能用，但缺了东西；2 = 形状对了，做不成这件事（要人提供的材料由模型来编，或者语言不对）；1 = 不对。分数是一个人读出来的（就是做这些改动的 Claude），只能当粗略的参考。第二轮的 `xhs-note` 和 `contract` 按重跑的流程打分。

5 = someone in the field could use it as it is; 4 = good, with one or two small things to fix; 3 = usable, but something is missing; 2 = the right shape, but it cannot do the job (the model makes up material the person should supply, or the language is wrong); 1 = wrong. The grades are one reader's (Claude, who also made the changes), so take them as a rough guide. Round two's `xhs-note` and `contract` are graded on the reruns.

| id | 第一轮 R1 | 第二轮 R2 | 最后一轮 Final | 最后一轮还差的 What the final flows still miss |
| --- | --- | --- | --- | --- |
| `xhs-note` | 2 | 5 | 4, 4 | 一个的检查只对照规则，不对照原来的笔记看有没有夸大；另一个的草稿提示词开头说会收到 `draft.md`，那是它自己要写的文件。/ One check compares the note with the rules but not with the original notes; the other draft prompt opens by saying it receives `draft.md`, the file it is meant to write. |
| `video` | 4 | 4 | 4, 4 | 一个没有核对口播的字数配不配 60 秒；另一个的选题简报排在人的素材之前，用不上素材。/ One never checks the script's word count against 60 seconds; in the other, the brief comes before the person's material and cannot use it. |
| `sales-week` | 1 | 3 | 5, 5 | 脚本在真实形状的数据上算对了，见下面。/ The scripts computed correctly on realistic data; see below. |
| `interviews` | 4 | 5 | 5, 4 | 一个的提示词开头把自己的产物说成输入文件。/ One set of prompts opens by calling the stage's own output its input file. |
| `contract` | 3 | 5 | 5, 5 | |
| `grant` | 2 | 5 | 5, 5 | |
| `support` | 3 | 5 | 5, 5 | |
| `release` | 2 | 5 | 4, 5 | 一个把仓库路径做成流程输入，还让检查阶段去用仓库里的风格指南，可模型阶段看不到仓库。/ One takes the repository's path as a flow input and asks the check stage to apply a style guide from the repository, which a model stage cannot see. |
| `trip` | 2 | 5 | 5, 5 | |
| `interview-prep` | 1 | 5 | 5, 5 | |

### 脚本 / Scripts

最后一轮的两个 `sales-week` 流程都带了脚本（`scripts/totals.mjs` 和 `scripts/summary.mjs`）。我们用两份真实形状的 CSV 试跑：有 UTF-8 BOM 和 Windows 换行，金额写成 `12,500` 和 `¥15,800`，一份按 ISO 周次（`2026-W44`），一份按日期，还有一个区域只在本周有数据。两个脚本都把每一行放进了对的那一周（W44 是 2026-10-26 到 11-01），各区域的销售额和环比都和手算一致（比如华东从 16,700 到 15,800，−5.4%），只在本周出现的西南标成新增。第三轮的脚本把两个日期当成两周，也读不了 `12,500`；加上脚本的规则以后没有再出现。在占位文件上试跑时，所有脚本都自己报错退出，没有崩溃。

Both final `sales-week` flows came with a script (`scripts/totals.mjs` and `scripts/summary.mjs`). We ran them on two realistic CSV files: a UTF-8 BOM and Windows line endings, amounts written as `12,500` and `¥15,800`, one file by ISO week (`2026-W44`) and one by date, and a region with data only in the current week. Both scripts put every row in the right week (W44 is 26 October to 1 November 2026), and every region's sales and week-over-week change matched the figures worked out by hand (East China from 16,700 to 15,800, −5.4%); the region seen only this week was marked new. Round three's script compared two single days as if they were weeks and could not read `12,500`; that has not happened since the script rules went in. On the placeholder files every script stopped with a message of its own, and none crashed.

### 从头跑到尾 / End-to-end runs

- `sales-week-2`（中文）：用上面按日期的 CSV，`flowgit run all --model deepseek/deepseek-chat` 跑完。2 次模型调用，输入 1,563、输出 1,457 个 token。周报里的数字和脚本的汇总一致，检查阶段逐条核对后都通过。
- `support-2`（英文）：放进一封真实形状的投诉邮件（搅拌机买了不到六周就坏了，顾客要退全款加运费，还要赔 40 美元的食材，不要换新）和一份六条的退款政策，用同样的命令跑。前两个阶段各用 3 秒，判断都对：已经过了 30 天退货期，按保修只能修或换；用退款代替修理、金额又超过 150 美元，两处都要经理批准；食材是间接损失，不赔，最多可以给 20 美元的购物金。到了写回复这一步，DeepSeek 先后 5 次返回 503，2 次停了 45 和 71 秒后断掉；新的检查把断掉的两次都记成错误，没有把半截回复写成产物。14 分钟后再跑，回复和检查都跑完了，4 次模型调用一共输入 4,705、输出 2,556 个 token。回复没有答应政策之外的东西：退款要经理批准的两处都说了，食材不赔，给了 20 美元以内的购物金，也要了故障的照片。检查阶段找出两处真问题：没提顾客要退的 12.50 美元运费；“经理正在处理”这句话，没有真的交给经理之前不该写。它没发现的一处：食材既然不赔，就不用再要食材的凭证。

- `sales-week-2` (Chinese): with the by-date CSV above, `flowgit run all --model deepseek/deepseek-chat` ran to the end: 2 model calls, 1,563 tokens in and 1,457 out. The report's figures match the script's summary, and the check stage went through them one by one and passed them.
- `support-2` (English): with a realistic complaint (a blender that broke within six weeks; the customer wants the full price and the shipping back plus $40 for spoiled food, and no replacement) and a six-rule refund policy, the same command. The first two stages took 3 seconds each and got every call right: the 30-day return window has passed, so the warranty allows repair or replacement; a refund instead of a repair, and a refund over $150, both need a manager; the food is a consequential loss and is not paid, with at most $20 of goodwill credit. At the reply stage DeepSeek answered 503 five times and twice ended the stream, after 45 and 71 seconds; the new check recorded both cut-offs as errors, and no partial reply was written as an output. Run again 14 minutes later, the reply and the check finished: 4 model calls in all, 4,705 tokens in and 2,556 out. The reply promises nothing the policy does not allow: it says both refund points need a manager, declines the food, offers store credit within $20, and asks for a photo of the fault. The check found two real problems: the $12.50 shipping the customer asked about is not mentioned, and "a manager is checking" should not be said before a manager has been asked. One it missed: since the food is not paid, there is no need to ask for proof of it.

### 还没解决的 / Still open

1. **DeepSeek 不稳定。** 忙碌时返回 503（第三轮 19 次里 8 次，最后一轮 20 次里 1 次），有时停顿几分钟后断掉。断掉的回复现在会报错并再试，但 503 一直持续时，生成还是会失败，要过一会儿再跑。
2. **生成的脚本可能在细节上算错。** 最后一轮的两个脚本在我们的数据上是对的，但第三轮的就错了。第一次用真实数据跑脚本阶段时，要核对它的结果；脚本在写入前就列在文件清单里，可以先读。
3. **上面 4 分的那些小问题**，规则查不出来，也就不会交回模型修。
4. **只测了 DeepSeek**（项目规定真实模型测试都用 DeepSeek）。11 月 3 日这天我们记下的每次运行，`deepseek-chat` 都是由 `deepseek-flash` 回复的（看 `run.json` 里的 `model`）。换别的模型，拆法可能不一样。
5. **测试集只有 10 句**，而且同一句话每次生成的流程不一样（最后一轮是 3 到 6 个阶段）。
6. **中文的长度还有用字数的**（小红书标题不超过 20 字，60 秒口播 240 到 260 字）。中文写作本来就按字数算，平台的限制也是字数，所以没有改。

1. **DeepSeek is unreliable.** When busy it answers 503 (8 of 19 generations in round three, 1 of 20 in the final round), and at times it stalls for minutes and then ends the stream. A reply that ends partway is now an error and tried again, but while the 503s last, generation still fails and has to be run again later.
2. **A generated script can get details wrong.** Both final scripts were right on our data, but round three's was not. The first time a script stage runs on real data, check its result; the script is in the file list before anything is written, so it can be read first.
3. **The small problems behind the 4s above** are not something a rule can find, so they do not go back to the model.
4. **Only DeepSeek was tested** (the project runs every real model test on DeepSeek). On 3 November, every run we recorded asked for `deepseek-chat` and was answered by `deepseek-flash` (the `model` in `run.json`). Another model may split the jobs differently.
5. **The test set has only 10 descriptions**, and the same sentence gives a different flow on each run (3 to 6 stages in the final round).
6. **Some Chinese lengths are still in characters** (a Xiaohongshu title of at most 20 字, 240 to 260 字 for 60 seconds of speech). Chinese writing measures length that way and the platforms' own limits are in characters, so we left it.

### 复现 / Reproduce

```bash
pnpm build
# 环境变量里要有 DEEPSEEK_API_KEY / with DEEPSEEK_API_KEY set in the environment
node scripts/eval-generate.mjs --repeat 2 --concurrency 4 --out eval-generate
node scripts/eval-generate.mjs --retry-failed --out eval-generate   # 只重跑生成失败的 / rerun only the failed generations
node scripts/eval-generate.mjs --rescore --out eval-generate        # 用现在的检查重查，不调用模型 / check again, no model calls
```

每个流程在 `eval-generate/<描述>-<n>/`，模型的原始回复也在里面；数字在 `results.json` 和 `summary.md`。

Each flow is in `eval-generate/<case>-<n>/` with the model's raw replies beside it; the numbers are in `results.json` and `summary.md`.
