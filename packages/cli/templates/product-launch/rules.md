# 发布规则 / Launch rules

下面这些数字和词表是 `kit` 和 `check` 两个脚本要读的规则。平台和法规会变，发布之前用 README「依据 / Sources」里的链接再核对一次。检查只把问题写进 `check-report.md`，不会让阶段失败；物料的格式不对（比如 `posts.json` 不是合法的 JSON）时，阶段才失败。

The `kit` and `check` scripts read the numbers and word lists below. Platforms and laws change; open the links in the README under "依据 / Sources" again before you launch. The check writes problems into `check-report.md` and does not fail the stage; the stage fails only when an asset has the wrong shape (for example, `posts.json` is not valid JSON).

JSON 块是脚本用的原文，改数字时改这里。 / The JSON block is what the scripts read; change the numbers here.

## 怎么数 / How to count

- **字符**：一个 Unicode 码位算 1。邮件标题、预览文字、Product Hunt 的标语和简介、LinkedIn 都用这个数。 / **Characters**: one Unicode code point counts as 1. Email subjects, preview text, the Product Hunt tagline and description, and LinkedIn use this.
- **X 加权**：X 的 `twitter-text` v3。展示长度 = 权重合计 / `scale`。权重 100 的码位算 1，其余（含汉字和全角标点）算 2。每个 `http(s)` 网址算 23。上限 280。组合表情在官方配置里按一个码位、权重 200 计；脚本按各个码位相加，组合表情可能比客户端显示的更长。 / **X weighted**: X `twitter-text` v3. Display length = total weight / `scale`. Code points of weight 100 count as 1; everything else (including Han and fullwidth punctuation) counts as 2. Each `http(s)` URL counts as 23. The cap is 280. The official config counts a joined emoji as one code point of weight 200; the script adds each code point, so a joined emoji can score higher than the app.
- **英文词数**：按空白分开的词。 / **English words**: words split on whitespace.
- **中文字数**：一个汉字算 1，一串连着的字母或数字算 1，标点不算。 / **Chinese length**: one Han character counts as 1, a run of letters or digits counts as 1, and punctuation does not count.

## 各物料 / Each asset

- **新闻稿**：英文 300 到 500 个词，标题不超过 70 个字符（PR Newswire）。中文 500 到 1000 个字是模板按英文换算的建议。「关于公司」英文约 100 个词（PR Newswire）；中文 200 个字以内是模板的换算。 / **Press release**: 300 to 500 words in English and a headline of at most 70 characters (PR Newswire). The 500 to 1,000 Chinese characters is the template's conversion. The boilerplate is about 100 English words (PR Newswire); 200 Chinese characters is the template's conversion.
- **邮件**：标题不超过 60 个字符（Mailchimp 的建议），预览文字不超过 150 个字符（Mailchimp）。 / **Email**: a subject of at most 60 characters (Mailchimp's advice) and preview text of at most 150 (Mailchimp).
- **Product Hunt**：标语不超过 60 个字符，简介不超过 260 个字符（Product Hunt 的发布指南；它的另一页写简介 500，这里按更严的 260）。只收英文。 / **Product Hunt**: a tagline of at most 60 characters and a description of at most 260 (Product Hunt's launch guide; another of its pages says 500 for the description, and this uses the stricter 260). English only.
- **X**：加权不超过 280。 / **X**: 280 on the weighted count.
- **LinkedIn**：一条帖子最多 3000 个字符。 / **LinkedIn**: at most 3,000 characters a post.

## 用词 / Wording

- **绝对化**：《广告法》第九条不允许「国家级」「最高级」「最佳」以及含义相同的说法；英文的对应说法一起查。 / **Absolute terms**: China's Advertising Law art. 9 bans "国家级", "最高级", "最佳" and equivalent wording; their English counterparts are checked too.
- **要证据**：「首款」「唯一」「100%」这类说法，在美国要有合理的依据才能说（FTC 广告证据政策），在中国很多连证据也救不了（第九条）。 / **Needs proof**: claims such as "world's first", "the only" or "100%" need a reasonable basis in the US (FTC substantiation policy), and in China many are banned even with proof (art. 9).
- **紧迫感**：没有真实的截止日期或库存，就不要说「限时」「仅剩」（欧盟 UCPD 附件一第 7 项）。资料里写了的不算。 / **Urgency**: no "limited time" or "only a few left" without a real deadline or stock level (EU UCPD annex I point 7). Words the facts use themselves don't count.
- **请人投票**：Product Hunt 不允许请人点赞或投票。 / **Asking for votes**: Product Hunt does not allow asking for upvotes.
- **占位符**：`{{`、`TODO`、`TBD`、`待补充`、`待填`、`[...]`、`[…]`、单独的 `XX` 表示还没写完。 / **Placeholders**: `{{`, `TODO`, `TBD`, `待补充`, `待填`, `[...]`, `[…]` and a bare `XX` mean the draft is unfinished.
- **待确认**：常见问题里资料答不了的问题，回答以「【待确认】」或「[To confirm]」开头，发布前要有人补上。 / **To confirm**: an FAQ answer the facts can't give starts with 「【待确认】」 or "[To confirm]", and someone fills it in before launch.

## 机器可读 / Machine-readable

```json
{
  "press": { "minWords": 300, "maxWords": 500, "minChars": 500, "maxChars": 1000, "headlineMax": 70, "boilerplateMaxWords": 100, "boilerplateMaxChars": 200 },
  "email": { "subjectMax": 60, "previewMax": 150 },
  "productHunt": { "taglineMax": 60, "descriptionMax": 260 },
  "linkedin": { "textMax": 3000 },
  "x": {
    "maxWeightedTweetLength": 280,
    "scale": 100,
    "defaultWeight": 200,
    "transformedURLLength": 23,
    "ranges": [
      { "start": 0, "end": 4351, "weight": 100 },
      { "start": 8192, "end": 8205, "weight": 100 },
      { "start": 8208, "end": 8223, "weight": 100 },
      { "start": 8242, "end": 8247, "weight": 100 }
    ]
  },
  "absolute": ["国家级", "世界级", "最高级", "最佳", "最好的", "最优", "最强", "顶级", "极品", "全网最低", "全网第一", "史上最", "独一无二", "销量第一", "排名第一", "行业第一", "革命性"],
  "absolutePhrases": ["the best", "best-in-class", "world's best", "number one", "no. 1", "#1", "unbeatable", "revolutionary"],
  "needsProof": ["首款", "首个", "首家", "第一款", "唯一", "独家", "100%", "零错误", "全自动"],
  "needsProofPhrases": ["world's first", "first-ever", "the only", "guaranteed", "zero errors", "fully automatic"],
  "urgency": ["限时", "仅剩", "只剩", "最后机会", "最后一天", "倒计时", "抢购", "手慢无", "售罄", "即将截止", "名额有限", "错过不再", "今天截止"],
  "urgencyPhrases": ["limited time", "last chance", "hurry", "act now", "ends soon", "while supplies last", "selling out", "almost gone", "only a few left", "don't miss out", "today only"],
  "votes": ["点赞", "投票", "投一票", "求赞", "帮忙顶"],
  "votePhrases": ["upvote", "upvotes", "vote for", "vote us", "give us a vote"],
  "placeholders": ["{{", "TODO", "TBD", "待补充", "待填", "[...]", "[…]"],
  "toConfirm": ["【待确认】", "[To confirm]"]
}
```
