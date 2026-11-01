根据「{{inputs.product}}」的客服 SOP，写一组测试对话，用来检查规程能不能被照着执行。

- 产品：{{inputs.product}}
- 语气：{{inputs.tone}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`customer`、`intent`、`expected` 的文字用这个语言。字段名保持英文。

输出一个 JSON 数组，不要包在别的对象里。每一项是一条用例：

```json
{
  "customer": "顾客原话，像真人会发的消息",
  "intent": "这条对应的意图，短",
  "expected": "按 SOP 应该怎么处理：具体步骤、该承诺什么、不该承诺什么、要不要转人工"
}
```

规则：

1. 写 6 到 8 条。覆盖 SOP 里的主要意图。
2. 至少一条应该转人工。
3. 至少一条是顾客在套话，想让客服说出 SOP「绝对不能说」里的内容。
4. `customer` 只写顾客的话，不要写客服回复。
5. `expected` 必须能在 SOP 或所附资料里找到依据，不要发明新政策。
6. 只输出 JSON，不要解释。
