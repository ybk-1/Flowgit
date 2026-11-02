按选中的角度，为每个平台写一条帖子。只输出 JSON，不要解释。数字以同目录的 `rules.md` 为准，检查脚本读的是那一份。

- 主题：{{inputs.topic}}
- 平台（逗号分隔，每条平台一条帖子，顺序照此）：{{inputs.platforms}}
- 受众：{{inputs.audience}}
- 语气：{{inputs.tone}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

`pick.md` 里的 `id:` 是要用的角度。钩子可以改措辞，角度不要换。上游会附上 `angles.json` 和 `pick.md`。

Write one post per platform from the chosen angle. Reply with JSON only. The numbers live in `rules.md` beside this file; the check script reads that file.

- Topic: {{inputs.topic}}
- Platforms (comma-separated; one post each, in this order): {{inputs.platforms}}
- Audience: {{inputs.audience}}
- Tone: {{inputs.tone}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

The `id:` line in `pick.md` is the angle to use. You may retune the hook. Do not switch angles. `angles.json` and `pick.md` are attached from upstream.

```json
{
  "posts": [
    {
      "platform": "xiaohongshu",
      "title": "标题；没有单独标题栏的平台留空字符串",
      "body": "正文",
      "hashtags": ["话题词，不要带 #"],
      "imageIdea": "一张画面：谁、在哪、什么光线",
      "suggestedTime": "一个具体时段，并写明是作者自己的估计"
    }
  ]
}
```

`platform` 只能是 `xiaohongshu`、`weibo`、`x`、`douyin`、`linkedin`、`wechat-moments`。 / `platform` is one of `xiaohongshu`, `weibo`, `x`, `douyin`, `linkedin`, `wechat-moments`.

长度和话题 / Length and hashtags（`rules.md`）:

- 小红书：标题 ≤ 20 个字符（一个汉字、一个标点、一个表情各算 1），正文 ≤ 1000 个字符。话题放在 `hashtags`，不要塞进正文去占那 1000。官方 `postNote` 没有写条数上限，写少量和内容相关的话题即可。
- 微博：正文 ≤ 5000 字。`hashtags` 最多 2 个，每个 4 到 32 字，词内不要有空格、`#`、`@`、`<`、`>`、`&`。在正文前 140 个字内写成 `#话题#`。
- X：标题、正文和话题合在一起，按加权长度 ≤ 280。汉字和全角标点算 2，英文和半角符号算 1，每条 http(s) 链接算 23。
- 抖音：标题、正文和话题合成一条视频文案，≤ 1000 字。话题不要做成站外导流。
- LinkedIn：标题、正文和话题合计 ≤ 3000 个字符。需要话题时给 3 到 5 个，不要多于 5 个。
- 微信朋友圈：正文按「汉字约 1500、两个英文字母或数字算 1 个汉字」。写成生活记录。不要放网址。
- Xiaohongshu: title ≤ 20 characters (one Han character, one punctuation mark, one emoji each count as 1), body ≤ 1,000. Put topics in `hashtags`; do not spend the 1,000 on them. `postNote` publishes no count cap; use a few topics that match the post.
- Weibo: body ≤ 5,000 characters. At most 2 `hashtags`, each 4 to 32 characters, with no space, `#`, `@`, `<`, `>` or `&` inside the word. Write them as `#topic#` inside the first 140 characters of the body.
- X: title, body and hashtags together, weighted length ≤ 280. Han and fullwidth punctuation count as 2, ASCII counts as 1, each http(s) URL counts as 23.
- Douyin: title, body and hashtags form one video caption, ≤ 1,000 characters. Do not turn a topic into an off-site funnel.
- LinkedIn: title, body and hashtags together ≤ 3,000 characters. When you use hashtags, use 3 to 5, and do not go past 5.
- WeChat Moments: about 1,500 Chinese characters, with two Latin letters or digits counting as one. Write it as a life note. Do not include a URL.

用词和画面 / Wording and the picture:

- 不要用「国家级」「最高级」「最佳」「最好」「最优」「最强」「顶级」「极品」「全网最低」「全网第一」「史上最」「独一无二」「销量第一」「排名第一」，也不要写 best、number one、world's best、#1。
- 不要写治疗、治愈、疗效、根治、消炎、杀菌、降血压、降血糖，也不要写 cures、treats、heals。
- 小红书、微博、抖音、朋友圈不要留手机号、微信号、邮箱、地址、网址或二维码。
- `imageIdea` 写一张能拍出来的画面。LinkedIn 的建议是帖子带图；小红书笔记带图或视频；朋友圈一次最多 9 张，这里只描述一张；抖音写封面那一帧。
- `suggestedTime` 写一个具体的本地时段，并说明这是作者自己的估计。LinkedIn 允许把帖子定时到某个日期和时间；这些平台都没有公布一个通用的「黄金小时」。不要在这一栏写「最佳」或 best。
- 不要留下 `{{`、`TODO`、`TBD`、`待补充`、`待填`、`[...]`。
- 示例材料是虚构的。用户没有给出的品牌、价格和数据不要编。
- Do not use 国家级, 最高级, 最佳, 最好, 最优, 最强, 顶级, 极品, 全网最低, 全网第一, 史上最, 独一无二, 销量第一, 排名第一, or "best", "number one", "world's best", "#1".
- Do not write 治疗, 治愈, 疗效, 根治, 消炎, 杀菌, 降血压, 降血糖, or "cures", "treats", "heals".
- On Xiaohongshu, Weibo, Douyin and WeChat Moments, leave out phone numbers, WeChat IDs, emails, street addresses, URLs and QR codes.
- `imageIdea` is one frame someone could photograph. LinkedIn recommends an image; a Xiaohongshu note carries images or a video; Moments allows up to 9 photos, and here you describe one; for Douyin describe the cover frame.
- `suggestedTime` is a concrete local window, labeled as the author's guess. LinkedIn lets you schedule a date and time; none of these platforms publishes a universal golden hour. Do not put 最佳 or "best" in this field.
- Leave no `{{`, `TODO`, `TBD`, `待补充`, `待填` or `[...]`.
- The sample material is fictional. Do not invent a brand, a price or a statistic the user did not give you.
