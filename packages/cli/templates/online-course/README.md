# 知识付费课程 / Online course

按教学设计的方法做一门线上课，而不是把一堆知识点录成视频。顺序参考 ADDIE 模型：先分析学员现在在哪、要去哪，定下用可观察动词写的学习成果；再设计大纲，每节课对应成果、每节课有练习；视频按 6 分钟以内的小段拆（大规模在线课程的数据显示，学员看 6 分钟以内的视频几乎看完，越长看得越少）。最后写试听课逐字稿和课程介绍页，介绍页按《广告法》对教育培训广告的要求检查：不承诺效果、不用学员证言作证明。

Build an online course with instructional design, not a pile of recorded topics. The order follows ADDIE: analyze where learners are and where they need to be, and set outcomes with observable verbs; design a syllabus where every lesson serves outcomes and has practice; cut video into segments of six minutes or less (data from large online courses shows learners watch nearly all of a video under six minutes and less the longer it runs). Then write the trial lesson script and the course page, which is checked against China's Advertising Law rules for education and training ads: no promised results and no learner endorsements.

## 阶段 / Stages

1. **学员和成果 analysis**（模型）：`analysis.json`。学员是谁、现在会什么、卡在哪；学完在真实场景里能做成的一件事；3 到 6 个学习成果（可观察的动词和布鲁姆层级，至少一半是应用及以上）；需要的基础和不适合谁。
2. **课程大纲 outline**（模型）：`outline.json`。每节课的课名（写成学完能做的事）、对应的成果、分段和每段分钟数、课后练习。第 1 节是试听课，要让学员当场做成一件小事。
3. **试听课逐字稿 trial**（模型，和介绍页并行）：`lesson-1.md`。从学员的真实问题开场，每段一件事、先例子后道理，画面提示用【画面：……】标出，最后是练习和三句话以内的小结。
4. **课程介绍页 page**（模型）：`course-page.md`。适合谁、不适合谁、学完你能、课程大纲、价格和退款。
5. **检查 check**（脚本）：`check-report.md`。每个学习成果有没有课讲到；每节课有没有练习；有没有超过 6 分钟的视频段（超过 9 分钟特别提醒）；成果动词是不是“了解”“掌握”这类看不见的词，应用及以上的成果有没有过半；试听课有没有练习和小结、分段和大纲对不对得上、逐字稿是不是比标的时长长很多；介绍页有没有“保过”“包会”“X 天速成”“月入”这类效果和收入承诺，有没有学员证言、学员人数和好评率，有没有原价、限时、名额有限这类价格比较和紧迫感，有没有制造焦虑。

1. **analysis** (model): `analysis.json` with who the learners are, what they can do now and where they get stuck; the one real-world thing they will get done; 3 to 6 outcomes (observable verbs with Bloom levels, at least half at apply or above); prerequisites and who it is not for.
2. **outline** (model): `outline.json`, each lesson's title (phrased as what learners can do after), outcomes, segments with minutes, and practice. Lesson 1 is the free trial, where learners get one small thing done.
3. **trial** (model, in parallel with the page): `lesson-1.md`. Opens on the learner's real problem, one idea per segment, example before explanation, on-screen cues marked [Screen: …], ending with practice and a recap of three sentences at most.
4. **page** (model): `course-page.md` with who it is for and not for, what you can do after, the syllabus, price and refunds.
5. **check** (script): `check-report.md`. Every outcome is taught; every lesson has practice; segments over six minutes (with a stronger warning over nine); outcome verbs you can't observe ("know", "understand"), and whether at least half the outcomes are at apply or above; the trial lesson's practice and recap, whether its segments match the syllabus, and scripts far longer than their stated time; and on the course page, promised results or income ("guaranteed pass", "learn it in 3 days", "earn…"), testimonials, learner counts and ratings, original prices, deadlines and limited seats, and anxiety marketing.

## 怎么跑 / How to run

```bash
flowgit init ~/my-course -t online-course
cd ~/my-course
flowgit inputs set topic=用表格做个人记账 audience=想管好自己钱的上班族 lessons=8
flowgit run all
```

没有 API key 时，用固定回复跑通（示例课程是 4 节）：

Without an API key, the canned replies run the flow (the sample course has 4 lessons):

```bash
flowgit inputs set lessons=4
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- ADDIE 模型（分析、设计、开发、实施、评估）：设计阶段把课程结构对准学习目标，测评要和学习目标对齐。[NC State EIT](https://eit.ces.ncsu.edu/2025/01/addie-design-model-design/)、[eLearning Industry](https://elearningindustry.com/getting-to-know-addie-design)。/ The ADDIE model.
- Guo、Kim 和 Rubin（2014）分析了 4 门 edX 课程约 690 万次视频观看：6 分钟以内的视频学员几乎看完，9 到 12 分钟的中位观看约一半，12 到 40 分钟的约两成；建议把视频剪成 6 分钟以内的小段。这项研究衡量的是观看投入，不是学习效果。[弗吉尼亚大学](https://teaching.virginia.edu/collections/considerations-for-creating-instructional-videos/412)、[UBC](https://flexible.learning.ubc.ca/?p=2852)。/ Guo, Kim and Rubin (2014) on video length and engagement.
- 布鲁姆修订版认知目标分类：可检验的学习成果要用可观察的动词。[Faculty Focus](https://www.facultyfocus.com/articles/course-design-ideas/designing-measurable-outcomes-with-backwards-design/print/)。/ Measurable outcomes with revised Bloom's taxonomy.
- 《广告法》第二十四条：教育、培训广告不得对升学、通过考试、获得学位学历或者合格证书，或者对教育、培训的效果作出明示或者暗示的保证性承诺，不得利用受益者的名义或者形象作推荐、证明；违反的按第五十八条处罚。[君合法评](https://junhe.com/legal-updates/2870)、[广州的处罚案例](https://tousu.sina.com.cn/articles/view/95301)。/ China's Advertising Law, art. 24 on education and training ads.
- 深圳市教育培训广告合规指引：宣传要理性客观，不得渲染紧张氛围、制造焦虑；使用他人名义或者形象要事先取得书面同意。[深圳市政府](https://www.sz.gov.cn/attachment/0/953/953592/9621128.docx)。/ Shenzhen's compliance guide for education ads.
- 《明码标价和禁止价格欺诈规定》（2022）第十九条：虚假折价、虚假价格比较属于价格欺诈。[司法部](https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/202305/t20230511_478601.html)。/ Price-fraud rules (2022), art. 19.
