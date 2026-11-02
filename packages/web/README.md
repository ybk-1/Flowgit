# @flowgit/web

Flowgit 的本机网页看板：一个只监听 `127.0.0.1` 的 `node:http` 服务器，加上 `public/` 里的静态页面（不需要网络，也不用 CDN）。一般通过命令行 [`flowgit board`](https://www.npmjs.com/package/flowgit) 打开。

The Flowgit local web board: a `node:http` server that listens on `127.0.0.1` only, plus a static page in `public/` (works offline, no CDN). Usually opened with the [`flowgit board`](https://www.npmjs.com/package/flowgit) command.

```js
import { startBoard } from "@flowgit/web";

const board = await startBoard({ dir: "my-flow", port: 0 });
console.log(board.url);
```

在看板上可以查看和修改产物、填写流程输入、运行阶段（同时只跑一个），也可以看历史版本、对比和回退（回退前会先保存手改）。每个 `/api/*` 请求都要带启动时生成的令牌（`X-Flowgit-Token`；运行日志的 SSE 流 `/api/events` 用查询参数 `token`），`Host` 也只能是 `127.0.0.1` 或 `localhost`。页面本身只在带 `?token=` 的链接里拿到令牌：`startBoard` 返回的 `url` 就是这个链接，直接打开 `/` 只会看到提示。

On the board you can view and edit outputs, fill in flow inputs, run stages (one run at a time), and browse, compare and restore versions (a hand edit is saved before a restore). Every `/api/*` request must carry the token generated at startup (`X-Flowgit-Token`; the `/api/events` SSE stream for the run log takes it as the `token` query parameter), and the `Host` must be `127.0.0.1` or `localhost`. The page itself only gets the token through the link with `?token=`: the `url` that `startBoard` returns is that link, and opening `/` by itself shows a note instead.

规范和文档见 / Spec and docs: https://github.com/cgold9820-dotcom/Flowgit

Apache-2.0
