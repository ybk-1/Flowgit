# 绘本 / 漫画 / Picture book or comic

做一本绘本或一篇短漫画，从创作说明到可以交给画家、交给印厂的文件。先排版式，再写故事和分页，出投稿稿、给画家的插画说明和样书；画完以后排成预览，再查一遍印刷要的尺寸、分辨率和出血。用 AI 画图的，再列出要做的标识和声明。

Make a picture book or a short comic, from a brief to files an illustrator and a printer can use. It lays out the pages first, then writes the story and the pagination, and produces a submission manuscript, an art brief for the illustrator and a dummy; once the art is in, it builds a preview and checks the size, resolution and bleed for print. For AI-generated art, it also lists the labels and disclosures to make.

## 阶段 / Stages

1. **创作说明 brief**（人）：`materials/brief.md`。给谁读、讲什么、想要的感觉、角色的样子、一定要有和不要有的东西。示例是虚构的《米粒的黄帽子》，中英两份写在一个文件里。
2. **版式 layout**（脚本）：`layout.md`。按页数和形式排好每个单元，算出每张图的像素。绘本：第 1 到 3 页是书名、版权和献词，故事从 4–5 页的跨页开始，到倒数第二页，最后一页单独一页（32 页就是 14 个跨页加 1 个单页）。漫画：一页一个单元，第 1 页在右边，标出每个奇数页之后的翻页。
3. **故事 story**（模型）：`story.json`。书名、一句话梗概、藏在故事下面的感觉、角色（外观写具体，好让每页画得一样）、开头—问题—三次尝试—转折—主角自己解决—结尾、重复句、画风。
4. **分页 storyboard**（模型）：`storyboard.json`。照版式一个单元一项。绘本写每个跨页的文字（只写图说不出来的）、插图说明（只写字里没说的）、图片描述和翻页钩子；漫画写每页的分格、每格的画面和对白框。
5. **文稿和插画说明 manuscript**（脚本）：`manuscript.md`（投稿稿和分页稿；漫画是按页分格的完整脚本）、`art-brief.md`（尺寸、出血、中缝、角色表、每张图画什么）、`dummy.html`（样书，每个方框是一页或一个跨页）。
6. **画前检查 precheck**（脚本）：`precheck-report.md`。单元和版式对不对得上、页数、总字数、插图说明是不是在重复文字、翻页钩子、图片描述的长度、像在讲道理的句子、主角是不是自己解决、重复句出现几次；漫画还查每个对白框和每格的字数、说话人是不是故事里的角色。只提醒，不拦。
7. **插图 art**（人）：`art/`。照 `art-brief.md` 画好放进来：`p04-05.png`、`p32.png`、`cover.png`。
8. **成书预览 book**（脚本）：`book.html`。图和文字按页排好，还没有的图显示插图说明。
9. **印刷检查 check**（脚本）：`check-report.md`。每张图在不在、像素够不够 300 DPI 加出血、宽高比对不对、认不了的格式、对不上任何一页的文件；打开 `aiArt` 时列出 KDP、《人工智能生成合成内容标识办法》和美国版权局要做的事。只提醒，不拦。

1. **brief** (person): `materials/brief.md`. Who it is for, what happens, the feeling, what the characters look like, and what must and must not be in it. The sample is a fictional book, Millie's Yellow Hat, in Chinese and English in one file.
2. **layout** (script): `layout.md`. Lays out every unit for the page count and format, with each image's pixel size. Picture book: pages 1 to 3 hold the title, copyright and dedication, the story runs in spreads from 4–5 to the second-to-last page, and the last page stands alone (14 spreads and one single page in 32 pages). Comic: one unit per page, page 1 on the right, with a page turn after every odd page.
3. **story** (model): `story.json`. Title, logline, the feeling underneath, characters (with concrete looks, so they are drawn the same on every page), the beats from opening and problem through three tries and a turn to the main character's own solution and the ending, a refrain and an art style.
4. **storyboard** (model): `storyboard.json`. One item per layout unit. For a picture book, each spread's words (only what the picture can't say), an art note (only what the words don't say), an image description and a page-turn hook; for a comic, each page's panels, the art in each and the balloons.
5. **manuscript** (script): `manuscript.md` (a submission manuscript and the paginated text; for a comic, a full script page by page and panel by panel), `art-brief.md` (sizes, bleed, gutter, character sheet, what each image shows) and `dummy.html` (a dummy, each box a page or a spread).
6. **precheck** (script): `precheck-report.md`. Whether the units match the layout, the page count, the word count, art notes that repeat the words, page-turn hooks, image description length, lines that preach, whether the main character solves the problem, and how often the refrain returns; for a comic, the words per balloon and per panel, and whether each speaker is a character in the story. Warnings only.
7. **art** (person): `art/`. Draw from `art-brief.md` and put the images here: `p04-05.png`, `p32.png`, `cover.png`.
8. **book** (script): `book.html`. The images and words page by page; a missing image shows its art note.
9. **check** (script): `check-report.md`. Whether every image is there, enough pixels for 300 DPI with bleed, the right proportions, formats it can't read and files that match no page; with `aiArt` on, what KDP, China's labeling measures for AI-generated content and the US Copyright Office ask for. Warnings only.

`demo-replies/` 里的固定回复按示例写好。第 20–21 页的插图说明把文字又说了一遍，画前检查会标出来，这是故意留的。示例没有附插图，所以印刷检查会列出缺的 16 张图。

The canned replies in `demo-replies/` follow the sample. The art note on pages 20–21 repeats the words on purpose, and the pre-art check flags it. The sample ships no art, so the print check lists the 16 missing images.

## 怎么跑 / How to run

```bash
flowgit init ~/my-book -t picture-book
cd ~/my-book
# 换成你的创作说明，或先用模板里的示例 / replace the brief, or try the sample first
flowgit inputs set format=picture-book age=3-6 pages=32 trim=8.5x8.5in language=zh
flowgit run all
```

没有 API key 时，用固定回复跑通。中文和英文各有一份：

Without an API key, the canned replies run the flow. Chinese and English each have a directory:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies/zh flowgit run all
# 英文示例 / English sample:
# flowgit inputs set language=en
# FLOWGIT_LLM_MOCK_DIR=demo-replies/en flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/zh"; flowgit run all
```

做漫画：`flowgit inputs set format=comic pages=8 age=8-12 trim=6.625x10.25in`（美式漫画的常见尺寸），再跑一遍。分页会一页一个单元，文稿会写成完整的漫画脚本。

For a comic: `flowgit inputs set format=comic pages=8 age=8-12 trim=6.625x10.25in` (a common US comic size), then run again. The pagination gets one unit per page and the manuscript becomes a full comic script.

`flowgit run all` 会在“插图”停下来等你放图。画好以后只要重跑后面两步：`flowgit run book`、`flowgit run check`。

`flowgit run all` waits at the art stage for your images. Once they are in, only the last two stages need to run: `flowgit run book`, `flowgit run check`.

## 用 AI 画图 / AI art

模板默认图是上传的。用 AI 生成插图时，把输入 `aiArt` 打开（`flowgit inputs set aiArt=true`）：`art-brief.md` 会给每张图加一行画图提示（画风、出场角色的外观、画面、比例、中缝），印刷检查会列出要做的标识和声明。AI 生成的图常常只有 1024 像素宽，印刷检查会算出现在相当于多少 DPI，要放大到多少像素。

The template expects uploaded art. When the art is AI-generated, turn on the `aiArt` input (`flowgit inputs set aiArt=true`): `art-brief.md` adds an image prompt for each picture (style, the looks of the characters in it, the scene, the aspect ratio and the gutter), and the print check lists the labels and disclosures to make. AI images are often only 1024 pixels wide; the print check works out the DPI that gives and the size to upscale to.

## 隐私 / Privacy

为真实的孩子写书时，说明里可能有孩子的名字、照片和生活细节。分享这个流程之前，先自己通读 `materials/brief.md`、`story.json`、`storyboard.json` 和 `art/`，去掉不想公开的，再运行 `flowgit share`。

A book for a real child may put the child's name, photos and life in the brief. Before you share this flow, read `materials/brief.md`, `story.json`, `storyboard.json` and `art/` yourself, remove what should stay private, then run `flowgit share`.

## 规则 / Rules

下面每条都对应文末的一条依据。

Each rule below maps to an entry under Sources.

1. 绘本常见 32 页，按 8 页一帖印（也有 24、40、48 页）；32 页里要放书名、版权和献词，能讲故事的大约是 14 个跨页。模板的排法：第 1 到 3 页前页，4–5 到 30–31 页 14 个跨页，第 32 页单页。出版社和印厂的排法会有出入，以他们的为准。依据：Tara Lazar《Picture Book Construction: Know Your Layout》《Every Picture Book Author Should Make a Storyboard》；Harold Underdown, The Purple Crayon Blog（2007 年 1 月）。
2. 文字要短：多数绘本 500 到 600 词，接近 1000 词编辑就会犹豫；SCBWI 的稿件点评活动只收 800 词以内的绘本。中文按约 1.6 字一词折算，按 1000 字提醒，这是模板自己的换算。依据：Writer's Digest《Word Count for Novels and Children's Books: The Definitive Post》；SCBWI《Critique Carousel》投稿说明。
3. 字说图说不出来的。插图说明只在字里看不出来时才写（整页没有字、翻页的惊喜、图和字唱反调），投稿稿里放在双括号里，表示不排印；插图说明不算字数。依据：Harold Underdown《Picture Book Manuscripts and Illustrations》；Margot Finke《Writing Picture Books: The Basics》；SCBWI《Critique Carousel》FAQ。
4. 投稿只交文字，不分页，不附图；出版社签下书以后自己找画家（作者自己是专业画家除外）。分页稿和插画说明是给自己出版、自己画或请画家的人用的。依据：Harold Underdown《Getting Started: Really Basic Information》《The How-Do-I-Get-It-Published Quiz》《Picture Book Manuscripts and Illustrations》。
5. 每次翻页都要紧：翻页能制造悬念、揭晓惊喜，所以每个单元写一个“为什么要翻”的钩子。漫画按印刷书的习惯把第 1 页放在右边，每个奇数页之后翻页，悬念放在奇数页最后一格，翻过去揭晓。依据：Writer's Digest《3 Big Tips for Writing a Children's Picture Book Like a Pro》；Harold Underdown《Picture Book Manuscripts and Illustrations》（翻页的惊喜可以加一句简短说明）。
6. 主角自己解决问题，书里不说教，也不要聪明的大人最后出来点题。依据：Jane Friedman《Writing Irresistible Picture Books with Mary Kole》；SCBWI 中部沿海加州分会《Checklist: Preparing Your Manuscript for Critique》。
7. 重复句一般在开头、中间、结尾附近各出现一次，太多会腻；重复让孩子能预测、跟着念，反复读能让孩子学到更多词。依据：Writer's Digest《5 Ways to Add a Refrain to Your Picture Books (and Why You Should)》；Reading Rockets《Repeated Interactive Read Alouds in Preschool and Kindergarten》。
8. 3 到 6 岁的书由大人读给孩子听：先让孩子喜欢听故事、看图书，再到能根据画面说出故事的大致内容；不要拿书逼孩子提前认字。依据：教育部《3-6岁儿童学习与发展指南》（语言领域：阅读与书写准备）。
9. 印刷：图至少 300 DPI；画到出血线，上、下和外侧各多 0.125 英寸（3.2 毫米）；有出血时文字离外侧裁切线至少 0.375 英寸；24 到 150 页的书中缝边距至少 0.375 英寸；KDP 平装书最少 24 页。依据：KDP《Paperback Submission Guidelines》《Set Trim Size, Bleed, and Margins》。
10. 每张有内容的图都要有图片描述，不超过 140 个字符；用这个年龄的孩子懂的词，年纪越小越短；图里不要画字，用真正的文字。依据：KDP《Accessibility for eBooks》；DIAGRAM Center《General Guidelines》《Specific Guidelines: Art, Photos & Cartoons》。
11. 漫画脚本一页一页、一格一格写：每格的画面一两句，脚本里没写的画家不会画；说话人单独标出；一个对白框大约不超过 25 个词，一格不超过 50 个词；喊叫、小声、画外音在脚本里标出来。中文按 40 字和 80 字提醒，是模板自己的换算。依据：Dark Horse《Script Format and Specifications》和示例脚本；Blambot《Comic Script Basics》《Comic Book Grammar & Tradition》。
12. AI 生成的插图：KDP 要求发布时说明 AI 生成的文字、图片和翻译，只用 AI 辅助的不用说明；在中国网上发布 AI 生成的图片，要主动声明并使用平台的标识功能，不得删除、篡改或隐匿标识；美国版权局只保护人创作的部分，登记时要说明 AI 生成的内容。依据：KDP《Content Guidelines》；《人工智能生成合成内容标识办法》第三、四、十条；美国版权局《Copyright Registration Guidance: Works Containing Material Generated by Artificial Intelligence》。

1. Picture books usually run 32 pages, printed in 8-page signatures (also 24, 40 or 48); the 32 pages also hold the title, copyright and dedication, leaving about 14 spreads for the story. The template's plan: pages 1 to 3 for front matter, 14 spreads from 4–5 to 30–31, and page 32 alone. Publishers and printers vary; theirs wins. Sources: Tara Lazar, "Picture Book Construction: Know Your Layout" and "Every Picture Book Author Should Make a Storyboard"; Harold Underdown, The Purple Crayon Blog (January 2007).
2. Keep it short: most picture books run 500 to 600 words, and editors shy away near 1,000; SCBWI's critique events take picture books of up to 800 words. Chinese is held to 1000 characters at about 1.6 characters a word, the template's own conversion. Sources: Writer's Digest, "Word Count for Novels and Children's Books: The Definitive Post"; SCBWI, Critique Carousel submission instructions.
3. The words say what the picture can't. An art note appears only where the words can't make something clear (a wordless spread, a page-turn surprise, pictures that contradict the words), in double parentheses in a manuscript, meaning "do not set"; art notes don't count as words. Sources: Harold Underdown, "Picture Book Manuscripts and Illustrations"; Margot Finke, "Writing Picture Books: The Basics"; SCBWI, Critique Carousel FAQ.
4. A submission is the words alone, without page breaks or pictures; once a publisher signs the book, it finds the illustrator (unless the author is a professional illustrator). The paginated text and art brief are for publishing yourself, illustrating yourself or hiring an illustrator. Sources: Harold Underdown, "Getting Started: Really Basic Information", "The How-Do-I-Get-It-Published Quiz" and "Picture Book Manuscripts and Illustrations".
5. Every page turn counts: it builds tension or reveals a surprise, so every unit has a reason to turn. A comic follows print books in putting page 1 on the right, so a turn follows every odd page: the hook goes in an odd page's last panel and pays off after the turn. Sources: Writer's Digest, "3 Big Tips for Writing a Children's Picture Book Like a Pro"; Harold Underdown, "Picture Book Manuscripts and Illustrations" (a short note for a page-turn surprise).
6. The main character solves the problem; the book doesn't preach, and no wise grown-up swoops in at the end with the message. Sources: Jane Friedman, "Writing Irresistible Picture Books with Mary Kole"; SCBWI Central-Coastal California, "Checklist: Preparing Your Manuscript for Critique".
7. A refrain usually comes back near the beginning, the middle and the end, and too many repeats wear it out; repetition lets children predict and join in, and rereading teaches them more words. Sources: Writer's Digest, "5 Ways to Add a Refrain to Your Picture Books (and Why You Should)"; Reading Rockets, "Repeated Interactive Read Alouds in Preschool and Kindergarten".
8. A book for ages 3 to 6 is read aloud by an adult: first the child learns to love hearing stories and looking at books, then to retell a story from its pictures; a book is no tool for drilling early reading. Source: China's Ministry of Education, Early Learning and Development Guidelines for Children Aged 3 to 6 (language: reading and writing readiness).
9. Print: images at 300 DPI or more; art runs to the bleed line, 0.125 in (3.2 mm) past the trim at the top, the bottom and the outside; with bleed, text stays at least 0.375 in inside the outside trim; a book of 24 to 150 pages needs a gutter margin of at least 0.375 in; a KDP paperback has at least 24 pages. Sources: KDP, "Paperback Submission Guidelines" and "Set Trim Size, Bleed, and Margins".
10. Every meaningful image has an image description of at most 140 characters, in words a child that age knows, shorter for younger readers; use real text, not text painted into the art. Sources: KDP, "Accessibility for eBooks"; DIAGRAM Center, "General Guidelines" and "Specific Guidelines: Art, Photos & Cartoons".
11. A comic script goes page by page and panel by panel: a sentence or two of art per panel, since the artist draws only what the script says; the speaker on each balloon; about 25 words at most in a balloon and 50 in a panel; shouts, whispers and off-panel voices marked in the script. Chinese is held to 40 and 80 characters, the template's own conversion. Sources: Dark Horse, "Script Format and Specifications" and its sample script; Blambot, "Comic Script Basics" and "Comic Book Grammar & Tradition".
12. AI-generated art: KDP asks publishers to disclose AI-generated text, images and translations, but not AI-assisted work; in China, whoever publishes AI-generated images online declares them and uses the platform's label, and must not remove, alter or hide the labels; the US Copyright Office protects only the human-authored parts and asks applicants to disclose AI-generated material. Sources: KDP, "Content Guidelines"; China's Measures for Labeling AI-Generated Synthetic Content, arts. 3, 4 and 10; US Copyright Office, "Copyright Registration Guidance: Works Containing Material Generated by Artificial Intelligence".

## 依据 / Sources

- Tara Lazar,《Picture Book Dummy, Picture Book Construction: Know Your Layout》（2009）：32 页里有几页给前页和环衬，自带环衬和另加环衬的区别，页数按 8 的倍数算。[链接](https://taralazar.com/2009/02/22/picture-book-construction-know-your-layout/)。/ How many of the 32 pages go to front matter and endpapers, self-ended versus separate endpapers, and page counts in multiples of 8.
- Tara Lazar,《Every Picture Book Author Should Make a Storyboard》（2016）：把稿子分成约 14 段，大致等于 32 页绘本的跨页数；用 8 张纸对折做一本 32 页的样书。[链接](https://taralazar.com/2016/10/06/every-picture-book-author-should-make-a-storyboard/)。/ About 14 sections, roughly the number of spreads in a 32-page picture book; a 32-page dummy from 8 folded sheets.
- Harold Underdown, The Purple Crayon Blog（2007 年 1 月）：样书的页数。[链接](https://www.underdown.org/blog_107.htm)。/ Pages in a picture book dummy.
- Harold Underdown,《Picture Book Manuscripts and Illustrations》：出版社一般不需要插图说明；画面的反讽或翻页的惊喜可以在附信里说明，实在必要时在稿子里加一句简短的方括号说明；定稿里的双括号表示“不排印”；出版社签约后自己选画家。[链接](https://www.underdown.org/picture-books-illustrations.htm)。/ Publishers rarely need art notes; visual irony or a page-turn surprise can go in the cover letter, or a short bracketed note if essential; double parentheses mean "do not set"; the publisher picks the illustrator after the contract.
- Harold Underdown,《Getting Started: Really Basic Information for Children's Writers and Illustrators》：作者投稿不需要附任何插图。[链接](https://www.underdown.org/basics.htm)。/ Writers need no illustrations with a manuscript.
- Harold Underdown,《The How-Do-I-Get-It-Published Quiz》：投稿不分页、不附图，作者自己画除外。[链接](https://www.underdown.org/quiz.htm)。/ Send the manuscript without page breaks or illustrations unless you are also the illustrator.
- Margot Finke,《Writing Picture Books: The Basics》（Harold Underdown 网站）：写得紧，给画家留线索，细节交给插图。[链接](https://www.underdown.org/mf-writing-picture-books.htm)。/ Write tight, leave clues for the artist, and let the pictures carry the details.
- Writer's Digest,《Word Count for Novels and Children's Books: The Definitive Post》：绘本以 500 到 600 词为好，接近 1000 词时编辑和经纪人会犹豫。[链接](https://www.writersdigest.com/whats-new/word-count-for-novels-and-childrens-books-the-definitive-post)。/ 500 to 600 words is a good target; near 1,000, editors and agents shy away.
- SCBWI,《Critique Carousel》投稿说明和 FAQ：绘本小说稿不超过 800 词；插图说明不算字数。[投稿说明](https://www.scbwi.org/events/critique-carousel/submission-instructions)；[FAQ](https://www.scbwi.org/events/critique-carousel/faq-s)。/ Picture book fiction up to 800 words; art notes don't count toward the word count.
- Writer's Digest,《3 Big Tips for Writing a Children's Picture Book Like a Pro》：每次翻页都非常重要，翻页能制造悬念或突出惊喜。[链接](https://www.writersdigest.com/write-better-fiction/3-big-tips-for-writing-a-childrens-picture-book-like-a-pro)。/ Every page turn matters; turns build tension or highlight surprises.
- Jane Friedman,《Writing Irresistible Picture Books with Mary Kole》：想写绘本的人最常见的错误是直接教育读者；让主角有力量，避免聪明的大人最后出来点题。[链接](https://janefriedman.com/writing-irresistible-picture-books-with-mary-kole/)。/ Overtly teaching the reader is the most common error; empower the protagonist and avoid the wise adult swooping in at the end.
- SCBWI 中部沿海加州分会,《Checklist: Preparing Your Manuscript for Critique》：主角有没有自己解决问题，避免说教。[链接](https://www.scbwi.org/regions/cencal/checklist-preparing-your-manuscript-for-critique)。/ Does the main character solve the problem; avoid being preachy.
- Writer's Digest,《5 Ways to Add a Refrain to Your Picture Books (and Why You Should)》：重复句常用三次，开头、中间、结尾附近；重复太多会让人腻；最后一次可以改一改。[链接](https://www.writersdigest.com/write-better-fiction/5-ways-to-add-a-refrain-to-your-picture-books-and-why-you-should)。/ A refrain often appears three times, near the beginning, middle and end; too many repeats grate; the last can change.
- Reading Rockets,《Repeated Interactive Read Alouds in Preschool and Kindergarten》：重复带来可预测性，孩子反复读同一本书能学到更多新词。[链接](https://www.readingrockets.org/article/repeated-interactive-read-alouds-preschool-and-kindergarten)。/ Repetition builds predictability, and children who reread books learn more new words.
- 教育部,《3-6岁儿童学习与发展指南》（教基二〔2012〕4号）：语言领域“阅读与书写准备”的目标是喜欢听故事、看图书，具有初步的阅读理解能力；用机械记忆和强化训练让幼儿过早识字不符合幼儿的学习特点。[链接](http://www.moe.gov.cn/srcsite/A06/s3327/201210/t20121009_143254.html)。/ China's Ministry of Education, Early Learning and Development Guidelines for Children Aged 3 to 6: in language, enjoying stories and picture books and early comprehension; drilling early reading doesn't suit how young children learn.
- Amazon KDP,《Paperback Submission Guidelines》：图片至少 300 DPI；出血的图要超出裁切线 0.125 英寸（3.2 毫米）；有出血的内页 PDF 比成书高 0.25 英寸、宽 0.125 英寸。[链接](https://kdp.amazon.com/en_US/help/topic/G201857950)。/ Images at 300 DPI or more; bleed extends 0.125 in (3.2 mm) past the trim; a bleed interior PDF is 0.25 in taller and 0.125 in wider than the trim.
- Amazon KDP,《Set Trim Size, Bleed, and Margins》：有出血时外侧边距至少 0.375 英寸；24 到 150 页的书中缝边距 0.375 英寸；最少 24 页。[链接](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6)。/ Outside margins of at least 0.375 in with bleed; a 0.375 in gutter for 24 to 150 pages; at least 24 pages.
- Amazon KDP,《Accessibility for eBooks》：提供信息的图都要有替代文字，最多 140 个字符；装饰性的图留空；尽量用真正的文字，不要用文字的图片。[链接](https://kdp.amazon.com/en_US/help/topic/GBPE3QVZ2J3HLQ4B)。/ Every informative image needs alt text of at most 140 characters; decorative images get an empty alt; use real text rather than images of text.
- Amazon KDP,《Content Guidelines》：发布新书或重新发布时要说明 AI 生成的文字、图片和翻译（封面和内页都算）；只用 AI 辅助的不用说明。[链接](https://kdp.amazon.com/en_US/help/topic/G200672390)。/ Disclose AI-generated text, images and translations (cover and interior) when publishing or republishing; AI-assisted work needs no disclosure.
- DIAGRAM Center,《General Guidelines》和《Specific Guidelines: Art, Photos & Cartoons》：了解读者的年龄，用读者懂的词；年级越低，描述越短，只说主要意思。[通用](http://diagramcenter.org/general-guidelines-final-draft.html)；[美术、照片和漫画](http://diagramcenter.org/specific-guidelines-final-draft.html)。/ Know the reader's age and use words they understand; lower grades need only a brief description of the main idea.
- Dark Horse Comics,《Script Format and Specifications》和示例脚本《Ghost》（Randy Stradley，8 页）：每格画面一般一两句就够，脚本里没写的画家不会画；说话人名字单独一行；每个对白框大约不超过 25 个词，每格大约不超过 50 个词。[格式说明](https://images.darkhorse.com/darkhorse08/company/submissions/scriptguide.pdf)；[示例脚本](https://images.darkhorse.com/darkhorse08/company/submissions/ghost_sample_comic_script.pdf)。/ A sentence or two per panel description, and the artist won't draw what isn't in the script; character names on their own line; about 25 words a balloon and 50 a panel at most.
- Blambot（Nate Piekos）,《Comic Script Basics》和《Comic Book Grammar & Tradition》：脚本里用 (OFF)、(WHISPER)、(BURST) 标出画外音、小声和喊叫；喊叫用爆炸框，小声用虚线框，心里话用小圆圈的尾巴。[脚本基础](https://blambot.com/pages/comic-script-basics)；[漫画语法](https://blambot.com/pages/comic-book-grammar-tradition)。/ (OFF), (WHISPER) and (BURST) call-outs in scripts; burst balloons for shouts, dashed for whispers, bubble tails for thoughts.
- 国家互联网信息办公室、工业和信息化部、公安部、国家广播电视总局,《人工智能生成合成内容标识办法》（国信办通字〔2025〕2号，2025 年 9 月 1 日施行）：第三条区分显式和隐式标识；第四条要求图片在适当位置添加显著的提示标识；第十条要求用户发布生成合成内容时主动声明并使用平台提供的标识功能，任何组织和个人不得恶意删除、篡改、伪造、隐匿标识。[链接](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)。/ China's Measures for Labeling AI-Generated Synthetic Content (in force 1 September 2025): explicit and implicit labels (art. 3), a prominent label on images (art. 4), and users who publish such content declare it and use the platform's labeling, with no removal, alteration, forgery or hiding of labels (art. 10).
- 美国版权局,《Copyright Registration Guidance: Works Containing Material Generated by Artificial Intelligence》（88 FR 16190，2023-03-16）：版权只保护人创作的部分；登记时要说明超过微量的 AI 生成内容，并简要说明人的贡献。[联邦公报](https://www.federalregister.gov/documents/2023/03/16/2023-05321/copyright-registration-guidance-works-containing-material-generated-by-artificial-intelligence)；[PDF](https://www.copyright.gov/ai/ai_policy_guidance.pdf)。/ Copyright protects only the human-authored parts; applicants disclose AI-generated material that is more than de minimis and briefly explain the human contribution.
