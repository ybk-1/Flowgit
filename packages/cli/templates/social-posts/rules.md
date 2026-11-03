# 平台规则 / Platform rules

下面这些数字和词表是检查脚本要读的规则。平台会改规则，发出去之前用文末链接再核对一次。脚本只把内容问题写进 `check-report.md`；`posts.json` 的格式不对时，阶段才失败。

The check script reads the numbers and word lists below. Platforms change their rules; open the links again before you post. Content problems go into `check-report.md`. The stage fails when `posts.json` has the wrong shape.

出处和「哪一条规则约束哪一个阶段」写在 README 的「依据 / Sources」。JSON 块是脚本用的原文，改数字时改这里。

Names, URLs, and which stage each rule binds are in the README under "依据 / Sources". The JSON block is what the script reads; change the numbers here.

## 怎么数 / How to count

- **codepoints**：一个 Unicode 码位算 1。小红书标题、正文和微博正文字数用这个数。 / One Unicode code point counts as 1. Xiaohongshu titles, Xiaohongshu bodies and Weibo bodies use this.
- **x-weighted**：X 的 `twitter-text` v3。展示长度 = 权重合计 / `scale`。权重 100 的码位算 1，其余（含汉字和全角标点）算 2。每条 `http(s)` URL 算 23。上限 280。组合表情在官方配置里按一个码位、权重 200 计；本脚本按各个码位相加，组合表情可能比客户端显示的更长。 / X `twitter-text` v3. Display length = total weight / `scale`. Code points of weight 100 count as 1; everything else (including Han and fullwidth punctuation) counts as 2. Each `http(s)` URL counts as 23. The cap is 280. Official config counts a joined emoji as one code point of weight 200; this script adds each code point, so a joined emoji can score higher than the app.
- **wechat-units**：朋友圈「1500 个汉字左右」。1 个符号算 1，2 个数字或英文字母算 1，多出来的 1 个字母或数字算 1。 / Moments' "about 1,500 Chinese characters": one symbol counts as 1, two digits or Latin letters count as 1, and a leftover letter or digit counts as 1.

## 各平台 / Each platform

- **xiaohongshu**：标题最多 20 个字符，正文最多 1000 个字符。话题用单独的字段，不占这 1000。开放平台 `postNote` 没有写话题条数上限，检查只报条数。禁止标题党（钩子必须是正文做得到的事），要有真实体验，少用商家宣传腔。禁止导流到手机号、微信号、邮箱、地址、网址和二维码。 / Title at most 20 characters, body at most 1,000. Topics are a separate field and do not spend the 1,000. The `postNote` API publishes no topic-count cap, so the check only reports the count. No clickbait hook the body cannot deliver; write from a real experience, with little merchant-slogan wording. No diversion via phone, WeChat ID, email, address, URL or QR code.
- **weibo**：发布框最多 5000 汉字。话题写成 `#话题#`，词长 4 到 32 个字，词内不要有 `# @ < > &` 和空白。单条建议最多 2 个话题：第 3 个不计入贡献度，多于 3 个则全部不计入；话题要出现在正文前 140 个字里。站外链接算导流。 / The composer allows 5,000 Chinese characters. Topics are `#topic#`, 4 to 32 characters, with no `# @ < > &` or whitespace inside the word. Use at most 2 topics on one post: a third does not count toward contribution, and more than three means none do. Put topics inside the first 140 characters. An off-site link counts as diversion.
- **x**：整条帖（标题、正文、话题）按 x-weighted 不超过 280。 / The whole post (title, body, hashtags) stays within 280 on the x-weighted count.
- **douyin**：视频 `text` 含话题，总字数不超过 1000。话题不要做成站外导流；联系方式、二维码和链接按社区公约处理。 / Video `text` includes topics and stays within 1,000 characters. Do not make a topic an off-site funnel; contact details, QR codes and links follow the community convention.
- **linkedin**：一条 post 最多 3000 个字符，话题算在里面。需要话题时用 3 到 5 个；检查在多于 5 个时提醒。配一张图。时间写成一个可以放进定时发布的具体时段，并标明是作者自己的估计。 / One post is at most 3,000 characters, hashtags included. When you use hashtags, use 3 to 5; the check warns above 5. Include an image. Write a concrete window someone could schedule, and mark it as the author's guess.
- **wechat-moments**：正文按 wechat-units 约 1500。单次最多 9 张照片。朋友圈用来分享生活，不用来做带外链的推销。 / Body is about 1,500 wechat-units. Up to 9 photos at a time. Moments is for sharing daily life, not for a pitch that carries an external link.

## 用词 / Wording

- **绝对化**：广告不得使用「国家级」「最高级」「最佳」以及含义相同的说法。下面的词表是这些词和英文对应说法。脚本看到就提醒，因为它不能判断语境是否属于执法指南里的例外。 / Ads may not use "国家级", "最高级", "最佳" or equivalent wording. The list is those terms and their English counterparts. A hit is a warning: the script cannot tell whether a context is one of the enforcement guide's exceptions.
- **医疗**：非医疗、药品、医疗器械广告不得涉及疾病治疗或使用医疗用语。抖音未认证账号不得发布疾病诊疗内容。 / Ads other than medical, drug and device ads may not claim to treat disease or use medical wording. Uncertified Douyin accounts may not post diagnosis or treatment.
- **占位符**：`{{`、`TODO`、`TBD`、`待补充`、`待填`、`[...]`、`[…]` 表示还没写完。没写完的句子不能当成真实体验发出去。 / `{{`, `TODO`, `TBD`, `待补充`, `待填`, `[...]` and `[…]` mean the draft is unfinished. An unfinished sentence is not a real experience you can post.
- **角度数量**：并行准备至少 3 个、至多 5 个不同方案，再由人选定。这是 `angles` 的条数，写在 schema 里。 / Prepare at least 3 and at most 5 different options in parallel, then let a person choose. That is the `angles` count, enforced by the schema.

## 机器可读 / Machine-readable

```json
{
  "absolute": ["国家级", "最高级", "最佳", "最好", "最优", "最强", "顶级", "极品", "全网最低", "全网第一", "史上最", "独一无二", "销量第一", "排名第一"],
  "absolutePhrases": ["best", "number one", "world's best", "#1"],
  "medical": ["治疗", "治愈", "疗效", "根治", "消炎", "杀菌", "降血压", "降血糖"],
  "medicalPhrases": ["cures", "treats", "heals"],
  "placeholders": ["{{", "TODO", "TBD", "待补充", "待填", "[...]", "[…]"],
  "linkMarkers": ["http://", "https://", "二维码", "微信号", "加微信"],
  "phonePattern": "1[3-9]\\d{9}",
  "emailPattern": "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
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
  "platforms": {
    "xiaohongshu": { "count": "codepoints", "titleMax": 20, "bodyMax": 1000, "flagLinks": true },
    "weibo": {
      "count": "codepoints",
      "bodyMax": 5000,
      "hashtagMax": 2,
      "hashtagMinLen": 4,
      "hashtagMaxLen": 32,
      "hashtagWithin": 140,
      "hashtagForbidden": "#@<>& \t\r\n",
      "flagLinks": true
    },
    "x": { "count": "x-weighted" },
    "douyin": { "count": "codepoints", "textMax": 1000, "flagLinks": true },
    "linkedin": { "count": "codepoints", "textMax": 3000, "hashtagMax": 5 },
    "wechat-moments": { "count": "wechat-units", "textMax": 1500, "flagLinks": true }
  }
}
```
