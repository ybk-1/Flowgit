# Flowgit 云端隐私政策（草稿）/ Flowgit Cloud Privacy Policy (draft)

> **草稿，不是法律意见，还没生效。** Cyrus 看过并同意、必要时请律师看过之后，才放到网站上。方括号里的内容要补。
> **Draft, not legal advice, not in force.** It goes on the website only after Cyrus has read and agreed to it, with a lawyer's review where needed. Fill in the brackets.

最后更新 / Last updated: [日期 / date] · 运营者 / Operator: [名称和联系方式 / name and contact]

这份政策只管 Flowgit 云端（登录后使用的服务）。命令行、本机看板和不登录的网页版不把你的流程发给我们。

This policy covers only Flowgit Cloud (the signed-in service). The CLI, the local board and the signed-out web app don't send your flows to us.

## 我们收集什么 / What we collect

- **账号 / Account**：登录方式给的资料。GitHub：数字用户 id、用户名、显示名、头像地址（不要任何额外权限）。Google：账号 id（sub）、名字、头像地址，以及验证过的邮箱。我们不存密码。/ What the sign-in provider gives us. GitHub: numeric user id, login, display name, avatar URL (no extra scopes). Google: account id (sub), name, avatar URL and a verified email. We store no passwords.
- **会话 / Sessions**：登录令牌的哈希、创建和过期时间、浏览器的 User-Agent（截短）。/ A hash of your sign-in token, when it was created and expires, and a shortened browser User-Agent.
- **你的内容 / Your content**：你放进云端的流程文件、产物和 `runs/` 版本。/ The flow files, outputs and `runs/` versions you put in the cloud.
- **工作区 / Workspaces**：工作区名字、成员和角色、邀请（邀请码只存哈希）。/ Workspace names, members and roles, and invites (codes are stored only as hashes).
- **操作记录 / Audit log**：谁在什么时候做了什么（例如改了哪个文件），不含文件内容和密钥；工作区的拥有者能看。/ Who did what and when (for example which file changed), without file contents or secrets; a workspace's owners can see it.
- **技术日志 / Technical logs**：Cloudflare 为了运行和防滥用处理的请求信息（IP 地址、时间、路径），以及用来限流的 IP。/ Request data Cloudflare processes to run the service and prevent abuse (IP address, time, path), and IPs used for rate limiting.

我们不用广告和第三方跟踪脚本，不卖数据，不拿你的内容训练模型。

We use no ads or third-party trackers, sell no data and don't train models on your content.

## 为什么用 / Why we use it

提供服务（登录、存流程、给你邀请的人看）、保护安全（权限检查、限流、操作记录）、修复问题。[按适用法律写明法律依据，例如 GDPR 的合同履行和正当利益 / state the legal bases under the governing law, e.g. contract and legitimate interests under the GDPR]

To run the service (sign-in, storing flows, showing them to people you invite), to keep it secure (permission checks, rate limits, the audit log) and to fix problems. [State the legal bases under the governing law, e.g. contract and legitimate interests under the GDPR.]

## 谁处理 / Who processes it

- **Cloudflare**：运行服务、数据库（D1）和文件存储（R2）。/ runs the service, the database (D1) and file storage (R2). [数据所在区域 / data location]
- **GitHub、Google**：只在你登录时。/ only when you sign in.
- 流程调用的模型和服务由你决定；调用时你的提示词和文件会发给它们。/ The models and services a flow calls are your choice; when called, your prompts and files go to them.

## 保存多久 / How long

账号和内容保存到你删除为止；删除账号后 [30] 天内删除，备份在 [期限 / period] 内滚动删除。会话最长 30 天（命令行 90 天）。操作记录保存 [期限 / period]。

Accounts and content are kept until you delete them; after an account is deleted, its data goes within [30] days and backups roll off within [period]. Sessions last at most 30 days (90 for the CLI). The audit log is kept for [period].

## 你的权利 / Your rights

你可以查看、导出、更正和删除你的数据，也可以反对某些处理。发邮件到 [邮箱 / email]。[按适用法律补充，例如 GDPR、CCPA、中国《个人信息保护法》/ add what the governing law requires, e.g. GDPR, CCPA, China's PIPL]

You can access, export, correct and delete your data, and object to some processing. Email [email]. [Add what the governing law requires, e.g. GDPR, CCPA, China's PIPL.]

## Cookie

只有一个登录用的 cookie（`__Host-flowgit_session`），和登录过程中 10 分钟的临时 cookie（`__Host-flowgit_oauth`）。没有统计和广告 cookie。

There is one sign-in cookie (`__Host-flowgit_session`) and a 10-minute cookie during sign-in (`__Host-flowgit_oauth`). No analytics or advertising cookies.

## 改动 / Changes

改动会提前在网站上公布。/ Changes are posted on the website in advance.
