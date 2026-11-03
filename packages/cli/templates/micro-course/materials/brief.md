# 10 分钟做出你的第一张记账表 / Make your first budget spreadsheet in 10 minutes

虚构的讲师和课程，用来演示这个模板，是「知识付费课程」模板第 1 节的视频版。用之前换成你自己的，标题照原样留着：后面的阶段按标题找内容。每行斜杠前是中文，后面是英文；只写一种语言也可以。 / A fictional instructor and course for this template, the video version of lesson 1 in the online-course template. Replace them before you use it, and keep the headings: later stages find content by heading. Each line has the Chinese before the slash and the English after it; one language is fine too.

## 这节课教什么 / What this lesson teaches

- 用 Excel 或 WPS 表格做一张记账表：四列（日期、金额、分类、备注），再用 SUMIF 让表格自己算每个分类花了多少。 / Build a budget sheet in Excel or Google Sheets: four columns (date, amount, category, note), then SUMIF so the sheet totals each category by itself.
- 这是《用表格做个人记账》的第 1 节，一共 4 节。 / Lesson 1 of 4 in the course "Personal budgeting in a spreadsheet".

## 学员 / Learners

- 刚工作两三年、想管好自己钱的上班族。 / Office workers two or three years into their first job who want to manage their money.
- 现在：用手机记账 App 记过几次，坚持不下来；月底不知道钱花哪了。 / Now: they tried a budgeting app a few times and gave up; at month end they don't know where the money went.
- 卡在：每花一笔就记一笔太累；记了也不会看。 / Stuck on: logging every purchase is tiring, and the records never get read.
- 会打开 Excel 或 WPS 表格，会输入数字，没写过公式。 / They can open Excel or Google Sheets and type numbers, but have never written a formula.

## 学完能做成的一件事 / The one thing they can do after

- 做出一张能按分类自动汇总支出的记账表，里面填着自己这周的 5 笔花费。 / Build a budget sheet that totals spending by category on its own, with five of their own purchases from this week in it.

## 要讲的内容和例子 / Content and examples

- 为什么记账 App 坚持不下去：它要你每花一笔就记一笔。这门课改成每个月花 10 分钟整理一次。 / Why budgeting apps don't stick: they ask you to log every purchase. This course has you spend 10 minutes a month instead.
- 四列就够：日期（帮你找到这笔账）、金额（花了多少）、分类（花在哪）、备注（写给以后的自己）。 / Four columns are enough: date (to find the entry), amount (how much), category (on what), note (for your future self).
- 分类先用 5 个：吃饭、交通、购物、娱乐、其他。分得太细，记的时候犹豫，看的时候也看不出重点。 / Start with five categories: food, transport, shopping, fun, other. With too many, you hesitate when logging and can't see the pattern later.
- 示例三笔：11 月 1 日，18 元，吃饭，公司楼下的面；11 月 1 日，6 元，交通，地铁；11 月 2 日，45 元，娱乐，看电影。 / Three sample entries: 1 November, 18 dollars, food, noodles near the office; 1 November, 6 dollars, transport, the subway; 2 November, 45 dollars, fun, a movie.
- 列的位置：A 列日期，B 列金额，C 列分类，D 列备注；F 列写五个分类名，G 列放合计。 / Column layout: A date, B amount, C category, D note; the five category names in column F, the totals in column G.
- SUMIF：在 G2 输入 =SUMIF(C:C, F2, B:B)，意思是「在分类那一列找和 F2 一样的分类，把这些行的金额加起来」。往下拖到 G6，五个分类的合计就都有了；以后每填一笔，合计自己变。 / SUMIF: in G2, type =SUMIF(C:C, F2, B:B), which means "find the rows whose category matches F2 and add up their amounts". Drag it down to G6 for all five totals; every new entry updates them by itself.

## 练习 / Practice

- 把这周你记得的 5 笔花费填进表格，看看哪一类最多。数不用很准。 / Enter five purchases you remember from this week and see which category is largest. The amounts don't need to be exact.

## 常见错误 / Common mistakes

- 分类名写得不一样（「吃饭」和「餐饮」混着用）：SUMIF 只认一模一样的字，合计会漏掉。 / Category names that don't match ("food" in one row, "meals" in another): SUMIF only matches identical text, so the totals miss entries.
- 金额里带单位，写成「18元」：表格把它当成文字，不会加。 / Typing the unit with the amount, such as "18 dollars": the sheet treats it as text and won't add it.
- 把两个范围写反：=SUMIF(B:B, F2, C:C)。 / Swapping the two ranges: =SUMIF(B:B, F2, C:C).
- 一开始就分二三十个类。 / Starting with twenty or thirty categories.

## 讲师 / Instructor

- 林夏，做了 6 年家庭理财咨询，自己用表格记账 8 年。 / Lin Xia, a household budgeting consultant for six years, who has kept her own books in a spreadsheet for eight.

## 素材 / Assets

- 录屏：在 WPS 表格里从一张空白表做起。 / Screen recording: building the sheet in Google Sheets from a blank file.
- 截图：一个记账 App 的日历，只有前三天记了账。 / Screenshot: a budgeting app's calendar with only the first three days logged.

## 不要说的话 / Do not say

- 不说「坚持记账就能存下钱」：存不存得下看各人情况，这门课不承诺效果。 / Don't say "keeping a budget will make you save money": whether anyone saves depends on them, and the course promises no results.
- 不点名批评哪一个记账 App。 / Don't name and criticize any particular budgeting app.
