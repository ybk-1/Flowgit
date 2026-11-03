写课程介绍页（销售页）。只输出 Markdown，不要解释。

- 主题：{{inputs.topic}}
- 学员：{{inputs.audience}}
- 价格和退款：{{inputs.price}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the course page. Reply with Markdown only.

- Topic: {{inputs.topic}}
- Learners: {{inputs.audience}}
- Price and refunds: {{inputs.price}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

结构：`# 课程名`；一句话说清学完能做成什么；`## 适合谁`；`## 不适合谁`；`## 学完你能`（照学习成果）；`## 课程大纲`（每节课名和练习）；`## 价格和退款`（照输入写，没有就写“待定”）。

Structure: `# Course name`; one line on what learners will get done; `## Who it is for`; `## Who it is not for`; `## After the course you can` (the outcomes); `## Syllabus` (each lesson's title and practice); `## Price and refunds` (as given, or "to be announced").

合规 / Compliance:

- 不对学习效果、考试、升学、就业或收入作保证性承诺（不写“保过”“包会”“X 天速成”“学完月入过万”）。教育培训广告不得作这类承诺，也不得用受益者的名义或形象作推荐、证明（《广告法》第二十四条）。
- 不编学员证言、学员人数、好评率；不写没有真实成交过的“原价”。
- 不制造焦虑（“再不学就被淘汰”），也不用“仅剩 N 个名额”这类没有依据的紧迫感。

- Promise no results, exam passes, admissions, jobs or income ("guaranteed pass", "learn it in 3 days", "earn 10k a month"). Education and training ads may not make such promises or use learners' names or images as endorsements (China's Advertising Law, art. 24).
- Invent no testimonials, learner counts or ratings; show no "original price" that was never really charged.
- No anxiety marketing ("learn this or be left behind") and no unfounded urgency ("only N seats left").

输出语言是 {{inputs.language}}。是 en 时，介绍页的每一句全部写英文，即使主题、学员描述或上面的示例是中文；是 zh 时写中文。
The output language is {{inputs.language}}. If it is en, every line of the course page is in English, even when the topic, the learner description or the examples above are in Chinese; if it is zh, Chinese.
