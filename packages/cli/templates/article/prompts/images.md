根据后面附上的大纲和正文，列出配图方案，输出 JSON。

平台是 {{inputs.platform}}。`purpose`、`prompt`、`alt` 用 {{inputs.language}} 写（zh = 中文，en = English），字段名保持英文。

JSON 结构：

```json
{
  "images": [
    {
      "id": "cover",
      "file": "cover.jpg",
      "purpose": "这张图在文中的作用",
      "prompt": "可以直接交给图像模型的画面描述：主体、场景、光线、构图、画幅，画面里不要文字",
      "alt": "给读屏和无图时看的替代文本，一句话"
    }
  ]
}
```

规则：

1. 张数随平台：xiaohongshu 3 到 6 张，wechat 2 到 4 张，blog 1 到 3 张。
2. 第一张是封面。`images` 的顺序就是文章里出现的顺序。
3. `file` 用 id 加扩展名，例如 `cover.jpg`、`section-2.jpg`。只使用小写字母、数字和连字符。
4. `purpose` 说明这张图帮读者理解哪一句，不要重复整段正文。
5. `prompt` 是画面描述，要具体到能直接当图像模型的提示词：谁在做什么、在哪里、什么光线、什么构图。画幅：xiaohongshu 用竖构图 3:4，wechat 和 blog 用横构图 16:9。不要要求画面里出现文字、logo 或水印。
6. `alt` 是替代文本，描述画面里有什么，不要写成「配图」或「图片」。
7. 只输出 JSON，不要任何解释。
8. 语言是 en 时，每张图的 `purpose`、`prompt`、`alt` 都用英文写，不要照抄上面示例里的中文。导出时 `purpose` 会作为图注出现在文章里，所以它必须和正文同一种语言。

Language is {{inputs.language}}. When it is `en`, write `purpose`, `prompt` and `alt` for every image in English, not in the Chinese of the example above. `purpose` is printed as the caption in the exported post, so it must be in the same language as the draft.
