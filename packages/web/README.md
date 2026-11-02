# @flowgit/web

Flowgit 的本机网页看板：一个只监听 `127.0.0.1` 的 `node:http` 服务器，加上 `public/` 里的静态页面（不需要网络，也不用 CDN）。一般通过命令行 [`flowgit board`](https://www.npmjs.com/package/flowgit) 打开。

The Flowgit local web board: a `node:http` server that listens on `127.0.0.1` only, plus a static page in `public/` (works offline, no CDN). Usually opened with the [`flowgit board`](https://www.npmjs.com/package/flowgit) command.

```js
import { startBoard } from "@flowgit/web";

const board = await startBoard({ dir: "my-flow", port: 0 });
console.log(board.url);
```

每个 `/api/*` 请求都要带启动时生成的令牌（`X-Flowgit-Token`），`Host` 也只能是 `127.0.0.1` 或 `localhost`。

Every `/api/*` request must carry the token generated at startup (`X-Flowgit-Token`), and the `Host` must be `127.0.0.1` or `localhost`.

规范和文档见 / Spec and docs: https://github.com/cgold9820-dotcom/Flowgit

Apache-2.0
