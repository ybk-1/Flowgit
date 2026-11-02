按卖点和关键词写 3 个候选商品标题。只输出 JSON，不要解释。

- 商品：{{inputs.product}}
- 平台：{{inputs.platform}}
- 标题长度上限：{{inputs.titleMax}}（0 表示按平台常用上限：淘宝、拼多多、抖店 60 个字符，一个汉字算 2 个，也就是约 30 个汉字；亚马逊 75 个字符）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write 3 candidate product titles from the points and keywords. Reply with JSON only.

- Product: {{inputs.product}}
- Platform: {{inputs.platform}}
- Title limit: {{inputs.titleMax}} (0 means the platform's usual limit: 60 characters on Taobao, Pinduoduo and Douyin, with a Chinese character counting as 2, so about 30 Chinese characters; 75 characters on Amazon)
- Output language: {{inputs.language}} (zh = Chinese, en = English)

```json
{ "titles": [ { "text": "标题", "length": 0, "angle": "这个标题主打什么" } ], "highlights": "亚马逊才写：放不进标题的次要信息" }
```

写完每个标题先数长度，填进 `length`，超过上限就删掉次要的词再写一遍。亚马逊的上限很紧（75 个字符，含空格），一个标题只放品牌、商品类型和两三个最关键的属性，其余放进 `highlights`（亚马逊的 Item Highlights，最多 125 个字符）。

Count each title and put the count in `length`; if it is over the limit, cut the minor words and rewrite. Amazon's limit is tight (75 characters including spaces): brand, product type and two or three key attributes only, the rest in `highlights` (Amazon's Item Highlights, at most 125 characters).

规则 / Rules:

- 中文平台按「品牌（资料里有才写）+ 核心词 + 属性词 + 卖点词」组织，最重要的词放在最前面（拼多多搜索页常只显示前十几个字）。3 个标题合起来要用上每个关键词，原样写出。
- 亚马逊按「品牌 + 商品类型 + 关键属性（尺寸、容量、颜色、数量）」写，首字母大写，不要全大写，不要 free shipping、best seller、sale 这类促销语，不要 !、$、? 这类符号。
- 同一个词在一个标题里最多出现两次；不要堆砌意思重复的词；不要写别的品牌名；不要写绝对化说法。
- Chinese platforms: brand (only if the facts name one) + core term + attributes + selling point, most important words first. Together the 3 titles use every keyword, spelled exactly as given.
- Amazon: brand + product type + key attributes (size, capacity, color, count), title case, never all caps, no promotional phrases such as "free shipping", "best seller" or "sale", no symbols such as !, $ or ?.
- No word more than twice in one title, no stacked synonyms, no other brands' names, no absolute claims.
