# 招聘流程 / Hiring

为一个岗位搭好结构化招聘：先从“这个人一年内要做成什么”倒推出能力项，再写招聘启事和面试题，最后生成面试官用的评分表。面试按结构化面试的做法：所有候选人问同样的题，以行为面试题（STAR 追问）为主，每题带 1、3、5 分的行为锚点（BARS），面试官先独立打分再讨论。检查脚本会找出启事和面试题里的就业歧视风险。

Set up structured hiring for one role: work backwards from what the person must achieve in a year to the competencies, then write the job ad and interview questions, and finish with the interviewer's scorecard. The interview follows structured-interviewing practice: the same questions for every candidate, mostly behavioral (probed with STAR), each with behavioral anchors for scores 1, 3 and 5 (BARS), and interviewers score on their own before discussing. The check flags discrimination risk in the ad and the questions.

## 阶段 / Stages

1. **岗位需求 need**（人）：`materials/role.md`。入职一年内要做成的事（带数字）、团队、必须会的、加分项、薪资、地点和工作方式。示例是虚构的社群运营岗位。
2. **岗位分析 analysis**（模型）：`competencies.json`。先写要做成的结果，再倒推 4 到 6 个能力项：每项写成可观察的行为，标出入职就必须具备还是可以学，以及最适合用面试、工作样本还是简历来评估。
3. **招聘启事 ad**（模型，和面试题并行）：`job-ad.md`。先写要做成什么，再写必须项、加分项、待遇和地点、怎么申请。只写和工作有关的要求。
4. **面试题 interview**（模型）：`interview.json`。用面试评估的能力项每项 2 道题、用工作样本评估的每项 1 道，行为题为主、情景题为辅，每题带追问和 1、3、5 分锚点；需要时附一个 60 分钟内能完成的工作样本任务。
5. **评分表 scorecard**（脚本）：`scorecard.md`（面试官打印出来用）和 `check-report.md`。检查：启事里有没有性别限制或优先、年龄限制、婚育状况、户籍、民族宗教、身高相貌、病原携带这类条件；面试题有没有问婚恋生育、年龄、户籍民族宗教、病史，有没有脑筋急转弯；每个能力项有没有题；每题有没有 1/3/5 分锚点和追问；能力定义是不是“有责任心”“抗压”这种看不见的词；行为题有没有过半。

1. **need** (person): `materials/role.md` with what must get done in the first year (with numbers), the team, must-haves, nice-to-haves, pay, location and way of working. The sample is a fictional community-manager role.
2. **analysis** (model): `competencies.json`. The outcomes first, then 4 to 6 competencies derived from them, each written as observable behavior, marked as needed on day one or learnable, and assessed by interview, work sample or resume.
3. **ad** (model, in parallel with the questions): `job-ad.md`. What the role must achieve first, then must-haves, nice-to-haves, pay and location, and how to apply. Job-related requirements only.
4. **interview** (model): `interview.json`, two questions per competency assessed in interview and one per competency assessed by work sample, mostly behavioral with some situational, each with probes and anchors for 1, 3 and 5; plus a work-sample task of 60 minutes or less when needed.
5. **scorecard** (script): `scorecard.md` (for interviewers to print) and `check-report.md`. It looks for gender limits or preferences, age limits, marriage or children, household registration, ethnicity or religion, height or looks, and pathogen-carrier exclusions in the ad; questions about relationships or children, age, origin, ethnicity, religion or medical history, and brainteasers; competencies with no questions; questions without 1/3/5 anchors or probes; definitions you can't observe ("responsible", "handles pressure"); and whether at least half the questions are behavioral.

## 怎么跑 / How to run

```bash
flowgit init ~/hire-community -t hiring
cd ~/hire-community
# 先把 materials/role.md 换成你的岗位需求 / first replace materials/role.md with your role
flowgit inputs set role=社群运营 company=转角咖啡
flowgit run all
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- 《就业促进法》：第三条，劳动者依法享有平等就业和自主择业的权利；第二十六条，用人单位招用人员应当提供平等的就业机会和公平的就业条件，不得实施就业歧视；第二十七条至第三十条，分别涉及性别、民族、残疾人和传染病病原携带者。[维基文库](https://zh.wikisource.org/wiki/%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E5%B0%B1%E4%B8%9A%E4%BF%83%E8%BF%9B%E6%B3%95_(2015%E5%B9%B4))。/ China's Employment Promotion Law.
- 《妇女权益保障法》（2022 年修订）第四十三条：招录时不得限定为男性或者规定男性优先，不得询问或者调查女性求职者的婚育情况，不得将妊娠测试作为入职体检项目。[法大大](https://www.fadada.com/article/Basics-015617)。/ The Women's Rights Protection Law (2022), art. 43.
- 人社部等九部门《关于进一步规范招聘行为促进妇女就业的通知》（2019）：招聘时不得限定性别或性别优先，不得询问妇女婚育情况；发布含性别歧视内容的招聘信息、拒不改正的可处 1 万元以上 5 万元以下罚款。[中新网](https://www.chinanews.com/gn/2019/02-22/8761768.shtml)。/ The 2019 nine-department notice on gender in hiring.
- 结构化面试：同一岗位用统一的方法评估候选人，问经过验证、和岗位相关的问题（不出脑筋急转弯），用评分标准打分，面试官要训练和校准。[Google re:Work](https://rework.withgoogle.com/en/guides/hiring-use-structured-interviewing)。/ Structured interviewing at Google.
- 行为面试和 STAR：用候选人过去真实的行为预测将来，追问情境、任务、行动、结果。[Ongig](https://blog.ongig.com/hr-content/star-recruitment-method/)。/ Behavioral interviewing and STAR.
- 行为锚定评分量表（BARS，Smith 和 Kendall，1963）：能力维度来自岗位分析，每个分数配一段具体行为描述，常用五级。[Jarvi](https://www.jarvi.tech/en/blog/advantages-of-bars-compared-to-other-recruitment-methods/)、[Aivy](https://www.aivy.app/en/lexicon/behaviorally-anchored-rating-scales-bars)。/ Behaviorally anchored rating scales.
