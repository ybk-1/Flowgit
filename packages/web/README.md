# @flowgit/web

Flowgit 的本机网页看板：一个只监听 `127.0.0.1` 的 `node:http` 服务器，加上 `public/` 里的静态页面（不需要网络，也不用 CDN）。一般通过命令行 [`flowgit board`](https://www.npmjs.com/package/flowgit) 打开。

The Flowgit local web board: a `node:http` server that listens on `127.0.0.1` only, plus a static page in `public/` (works offline, no CDN). Usually opened with the [`flowgit board`](https://www.npmjs.com/package/flowgit) command.

```js
import { startBoard } from "@flowgit/web";

const board = await startBoard({ dir: "my-flow", port: 0 });
console.log(board.url);
```

在看板上可以查看和修改产物、填写流程输入、运行阶段（同时只跑一个），也可以看历史版本、对比和回退（回退前会先保存手改），以及新增和删除阶段。顶部可以在卡片和流程图之间切换；流程图的布局来自 `GET /api/graph`（`layoutFlow`），浏览器自己用 SVG 画，不需要网络。「预演 / Preview」调用 `GET /api/plan`（`planRunAll`），只在日志里列出每个阶段会跳过、运行、等你还是不能运行，以及最多调用几次模型，什么都不运行。全部运行前如果会调用真实模型会先确认。`GET /api/usage`（`flowLog`，和 `flowgit log` 不写阶段是同一个函数）按阶段合计 token，卡片、流程图提示和页面顶部都会显示。`POST /api/stage` 调用 `addStage`，再按 `flowgit validate` 检查，不通过就返回双语错误列表并且什么都不写；llm 的提示词文件不存在时会建骨架。`DELETE /api/stage?id=<id>` 调用 `removeStage`，还有依赖且没有 `force=1` 时返回 409 并点名，不删产物和 `runs/`。运行中这两个接口返回 409。文件变化时 SSE 会推送 `flow:changed`，看板立刻刷新。每个 `/api/*` 请求都要带启动时生成的令牌（`X-Flowgit-Token`；运行日志和 `flow:changed` 的 SSE 流 `/api/events` 用查询参数 `token`），`Host` 也只能是 `127.0.0.1` 或 `localhost`。页面本身只在带 `?token=` 的链接里拿到令牌：`startBoard` 返回的 `url` 就是这个链接，直接打开 `/` 只会看到提示。

On the board you can view and edit outputs, fill in flow inputs, run stages (one run at a time), browse, compare and restore versions (a hand edit is saved before a restore), and add or remove stages. A toggle at the top switches between cards and a flow graph. `GET /api/graph` (`layoutFlow`) supplies the layout, and the page draws it with SVG, with no network. "预演 / Preview" calls `GET /api/plan` (`planRunAll`) and only lists in the log whether each stage would be skipped, run, wait for you or cannot run, and at most how many model calls, without running anything. Run all asks first when it would call a real model. `GET /api/usage` (`flowLog`, the same function as `flowgit log` with no stage) sums tokens per stage; cards, the graph tooltip and the top of the page show them. `POST /api/stage` calls `addStage`, then checks the flow the way `flowgit validate` does; errors return a bilingual list and write nothing, and a missing llm prompt file gets a skeleton. `DELETE /api/stage?id=<id>` calls `removeStage`; dependents without `force=1` return 409 and are named, and outputs and `runs/` stay. Both routes return 409 during a run. When files change, the SSE stream pushes `flow:changed` and the board refreshes at once. Every `/api/*` request must carry the token generated at startup (`X-Flowgit-Token`; the `/api/events` SSE stream for the run log and for `flow:changed` takes it as the `token` query parameter), and the `Host` must be `127.0.0.1` or `localhost`. The page itself only gets the token through the link with `?token=`: the `url` that `startBoard` returns is that link, and opening `/` by itself shows a note instead.

规范和文档见 / Spec and docs: https://github.com/cgold9820-dotcom/Flowgit

Apache-2.0
