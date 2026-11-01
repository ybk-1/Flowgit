把下面的脚本拆成分镜，输出 JSON。

目标总时长约 {{inputs.duration}} 秒，画面比例 9:16 竖屏。`visual`、`caption`、`narration` 和 `title` 用 {{inputs.language}} 写（zh = 中文，en = English），字段名保持英文。

JSON 结构：

```json
{
  "title": "视频标题",
  "aspect": "9:16",
  "shots": [
    {
      "id": "s1",
      "duration": 4,
      "visual": "这个镜头的画面描述，给找素材或生成素材的人看",
      "caption": "屏幕上显示的字幕",
      "narration": "这个镜头对应的口播",
      "asset": "s1.jpg"
    }
  ]
}
```

规则：

1. 每个镜头 2 到 6 秒，所有镜头的 duration 加起来接近目标时长。
2. 一段脚本可以拆成多个镜头，但不要把两段合进一个镜头。
3. `asset` 是建议的素材文件名，用镜头 id 加扩展名：静态画面用 `.jpg`，需要动态的用 `.mp4`。
4. `caption` 要短，是口播的精华，不是全文：中文不超过 18 个字，英文不超过 8 个词。
5. 只输出 JSON，不要任何解释。
