按产品资料和定位，写发布当天的邮件。只输出邮件本身，不要解释，不要放进代码块。

- 产品：{{inputs.product}}
- 收件人：在资料「发件信息」里同意接收的人
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write the launch-day email from the product facts and the messaging. Reply with the email only: no commentary and no code fence.

- Product: {{inputs.product}}
- Recipients: the people who agreed to it, as the facts' "Sender details" say
- Output language: {{inputs.language}} (zh = Chinese, en = English)

格式，照这个写（检查脚本按这几行找内容）：

```
主题：……
预览文字：……

正文的几个短段落

按钮：按钮上的字 → 链接

---
页脚
```

1. `主题：` 不超过 60 个字符（Mailchimp 的建议），说清楚这封信讲什么，可以用 messaging.json 的 `headline`。不要写「RE:」「FW:」「回复：」这类假装是回信的开头：CAN-SPAM 不允许误导人的主题。
2. `预览文字：` 收件箱里跟在主题后面的那句，不超过 150 个字符，补充主题没说的事，不要重复主题。
3. 正文三到五个短段落：先说有什么新东西，再用 `pillars` 讲两三个好处，然后照资料「价格和购买方式」写价格和怎么用上。开头写「你好，」就行，不用写收件人名字的合并标签。
4. `按钮：` 只有一个，一封信只请人做一件事。按钮上的字说点了会怎样（例如「更新到 3.2 版」），不要写「点击这里」。链接只用资料里出现过的网址，资料里没有就写要去的地方（例如「App Store 和应用商店里的店小算」），不要编网址。
5. 最后一行 `---` 下面是页脚，三件事都要有：
   - 为什么收到这封信：照资料「发件信息」写（例如在 App 里勾选了接收产品更新）。
   - 发件人和地址：照抄资料「发件信息」里的发件人和地址（CAN-SPAM 要求写有效的邮寄地址；《广告法》第四十三条要求写明发送者的真实身份和联系方式）。
   - 怎么退订：照抄资料「发件信息」里的退订方式。真正的退订链接由你用的邮件平台加上，不要自己编网址。

规则：

- 只用资料里的事实，每个数字都要在资料里找得到。资料「不要说的话」一句都不写。
- 引用资料「证据」里的客户原话时一字不改，并在同一句写明这个人和你的关系（例如内测期间免费使用 Pro）；没有原话就不引。
- 不写「最好」「第一」「首款」「唯一」，不写「限时」「仅剩」「最后机会」这类紧迫感。
- 不要写 `{{`、`TODO`、`待补充` 这类占位符。

交之前查一遍：主题不超过 60 个字符；只有一个 `按钮：`；页脚有发件人、地址和退订方式。
语言：全部用输出语言写（zh = 中文，en = English），开头几行的标签也用这个语言（zh 写 `主题：`、`预览文字：`、`按钮：`，en 写 `Subject:`、`Preview text:`、`Button:`）。

Format, as below (the check script finds content by these lines):

```
Subject: …
Preview text: …

A few short body paragraphs

Button: the button's words → link

---
Footer
```

1. `Subject:` at most 60 characters (Mailchimp's advice), saying what the email is about; you may use the `headline` from messaging.json. Don't start with "RE:" or "FW:" to look like a reply: CAN-SPAM bans misleading subject lines.
2. `Preview text:` the line the inbox shows after the subject, at most 150 characters, adding what the subject didn't say rather than repeating it.
3. Three to five short body paragraphs: what is new, then two or three benefits from `pillars`, then the price and how to get it, as the facts' "Price and availability" says. Open with "Hi," and no merge tag for the name.
4. One `Button:` only: one email asks for one thing. The button's words say what happens (for example "Update to version 3.2"), never "Click here". Link only to a URL that appears in the facts; when there is none, name where it goes (for example "ShopTally in the App Store and Google Play") and don't invent a URL.
5. Below the last `---` is the footer, with all three:
   - Why they got it: as the facts' "Sender details" say (for example, they ticked product updates in the app).
   - Sender and address: the sender and postal address from the facts' "Sender details", copied (CAN-SPAM requires a valid postal address; China's Advertising Law art. 43 requires the sender's real identity and contact details).
   - How to unsubscribe: copy the facts' unsubscribe line. Your email platform adds the real unsubscribe link; don't invent one.

Rules:

- Facts from the fact file only; every number must be in the facts. Nothing from the facts' "Do not say".
- If you quote a customer from the facts' "Proof", use their words exactly and say in the same sentence how they are tied to you (for example, free Pro during the beta); with no quote in the facts, quote no one.
- No "best", "number one", "world's first" or "the only", and no urgency such as "limited time", "only a few left" or "last chance".
- No placeholders such as `{{`, `TODO` or `TBD`.

Before you reply, check: the subject is 60 characters or fewer; there is exactly one `Button:`; the footer has the sender, the address and how to unsubscribe.
Language: write everything in the output language (zh = Chinese, en = English), including the labels at the start of the lines (zh: `主题：`, `预览文字：`, `按钮：`; en: `Subject:`, `Preview text:`, `Button:`).
