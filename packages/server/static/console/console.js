// A small page on the cloud API (docs/cloud.md) for checking staging by hand. No framework, no
// third-party code; every request is same-origin with the session cookie.
const main = document.getElementById("main");
const state = { me: null, ws: null, flow: null };

async function call(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  const type = res.headers.get("Content-Type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof data === "object" && data.error ? data.error : `${res.status}`);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) node.append(child instanceof Node ? child : document.createTextNode(String(child ?? "")));
  return node;
}

function section(title, ...children) {
  return el("section", {}, el("h2", {}, title), ...children);
}

function fail(err) {
  main.prepend(el("p", { class: "error" }, err.message ?? String(err)));
}

const when = (ms) => new Date(ms).toLocaleString();

async function render() {
  main.replaceChildren();
  const params = new URLSearchParams(location.search);
  try {
    state.me = await call("GET", "/api/me");
  } catch {
    const providers = await call("GET", "/api/auth/providers").catch(() => ({}));
    const invite = params.get("invite") ?? "";
    const next = encodeURIComponent(location.pathname + location.search);
    const links = [];
    if (providers.github) links.push(el("a", { class: "button", href: `/api/auth/github?next=${next}&invite=${encodeURIComponent(invite)}` }, "用 GitHub 登录 / Sign in with GitHub"));
    if (providers.google) links.push(el("a", { class: "button", href: `/api/auth/google?next=${next}&invite=${encodeURIComponent(invite)}` }, "用 Google 登录 / Sign in with Google"));
    if (!links.length) links.push(el("p", { class: "muted" }, "还没有设置登录 / sign-in is not set up yet"));
    main.append(section("登录 / Sign in", ...links, invite ? el("p", { class: "muted" }, `邀请码 / invite: ${invite}`) : ""));
    return;
  }
  const invite = params.get("invite");
  if (invite) {
    try {
      const joined = await call("POST", "/api/invites/accept", { code: invite });
      state.me = await call("GET", "/api/me");
      state.ws = joined.workspaceId;
    } catch (err) {
      fail(err);
    }
    history.replaceState(null, "", location.pathname);
  }
  main.append(
    section(
      "我 / Me",
      el("p", {}, `${state.me.user.name}${state.me.admin ? "（管理员 / admin）" : ""}`),
      el("button", { onclick: () => call("POST", "/api/auth/logout").then(render, fail) }, "退出 / Sign out"),
      state.me.admin ? el("button", { onclick: signupCode }, "生成注册邀请码 / New sign-up code") : "",
    ),
  );
  main.append(await workspaces());
  if (state.ws) main.append(await workspace(state.ws));
  if (state.flow) main.append(await flow(state.flow));
}

async function signupCode() {
  try {
    const invite = await call("POST", "/api/invites", {});
    prompt("注册邀请码（只显示这一次）/ Sign-up code (shown once)", invite.code);
  } catch (err) {
    fail(err);
  }
}

async function workspaces() {
  const list = state.me.workspaces;
  const name = el("input", { placeholder: "新工作区名字 / New workspace name" });
  return section(
    "工作区 / Workspaces",
    el(
      "table",
      {},
      list.map((ws) =>
        el("tr", {}, el("td", {}, el("button", { onclick: () => ((state.ws = ws.id), (state.flow = null), render()) }, ws.name)), el("td", {}, ws.role), el("td", { class: "muted" }, `${ws.members} 人 / members · ${ws.flows} 个流程 / flows`)),
      ),
    ),
    name,
    el("button", { onclick: () => call("POST", "/api/workspaces", { name: name.value }).then((r) => ((state.ws = r.workspace.id), render()), fail) }, "建工作区 / Create"),
  );
}

async function workspace(id) {
  const [{ workspace: ws, role, storage }, { members }, { flows }, { templates }, { usage }] = await Promise.all([
    call("GET", `/api/workspaces/${id}`),
    call("GET", `/api/workspaces/${id}/members`),
    call("GET", `/api/workspaces/${id}/flows`),
    call("GET", "/api/templates"),
    call("GET", `/api/workspaces/${id}/usage`),
  ]);
  const roleSel = el("select", {}, ["editor", "viewer", "owner"].map((r) => el("option", { value: r }, r)));
  const tplSel = el("select", {}, templates.map((t) => el("option", { value: t.id }, `${t.id} · ${t.name}`)));
  const inviteOut = el("p", {});
  return section(
    `工作区 / Workspace: ${ws.name}`,
    el("p", { class: "muted" }, `你的角色 / your role: ${role} · 已用 / used ${(storage.used / 1048576).toFixed(1)} MB / ${(storage.quota / 1073741824).toFixed(0)} GB`),
    el("p", { class: "muted" }, `${usage.month}：${usage.tokens} / ${usage.tokenQuota} token · ${usage.runs} / ${usage.runQuota} 次运行 / runs`),
    role !== "viewer" ? await keys(id, role) : "",
    el("h2", {}, "成员 / Members"),
    el("table", {}, members.map((m) => el("tr", {}, el("td", {}, m.name), el("td", {}, m.role), el("td", { class: "muted" }, m.logins ?? "")))),
    role === "owner"
      ? el(
          "p",
          {},
          roleSel,
          el(
            "button",
            {
              onclick: () =>
                call("POST", `/api/workspaces/${id}/invites`, { role: roleSel.value }).then((r) => inviteOut.replaceChildren("邀请链接（只显示这一次）/ Invite link (shown once): ", el("code", {}, r.url.replace("/app/?", "/api/console/?"))), fail),
            },
            "邀请 / Invite",
          ),
          inviteOut,
        )
      : "",
    el("h2", {}, "流程 / Flows"),
    el("table", {}, flows.map((f) => el("tr", {}, el("td", {}, el("button", { onclick: () => ((state.flow = f.id), render()) }, f.name)), el("td", { class: "muted" }, when(f.updated_at))))),
    role !== "viewer" ? uploadFolder(id) : "",
    role !== "viewer"
      ? el("p", {}, tplSel, el("button", { onclick: () => call("POST", `/api/workspaces/${id}/flows`, { template: tplSel.value }).then((r) => ((state.flow = r.flow.id), render()), fail) }, "放一个模板上来 / Add a template"))
      : "",
  );
}

/** The workspace's keys: names and last four characters only. Owners add and delete. */
async function keys(wsId, role) {
  const { keys: list } = await call("GET", `/api/workspaces/${wsId}/keys`);
  const name = el("input", { placeholder: "DEEPSEEK_API_KEY", autocomplete: "off" });
  const value = el("input", { type: "password", placeholder: "key", autocomplete: "off" });
  // Where the key may be sent; empty means the preset's own host (DeepSeek, Anthropic, ...).
  const hosts = el("input", { placeholder: "api.example.com（可留空 / optional for presets）", autocomplete: "off" });
  const save = () => {
    const list = hosts.value.split(/[\s,]+/).filter(Boolean);
    return call("PUT", `/api/workspaces/${wsId}/keys/${encodeURIComponent(name.value.trim())}`, { value: value.value, ...(list.length ? { hosts: list } : {}) })
      .then(() => {
        value.value = "";
        render();
      }, fail);
  };
  return el(
    "div",
    {},
    el("h2", {}, "Key（只写不读）/ Keys (write-only)"),
    el(
      "table",
      {},
      list.map((k) =>
        el(
          "tr",
          {},
          el("td", {}, el("code", {}, k.name)),
          el("td", { class: "muted" }, k.last4 ? `…${k.last4}` : "…"),
          el("td", { class: "muted" }, `只发到 / only to ${(k.hosts ?? []).join(", ")}`),
          el("td", { class: "muted" }, `用过 / used ${k.uses} 次`),
          el("td", {}, role === "owner" ? el("button", { onclick: () => call("DELETE", `/api/workspaces/${wsId}/keys/${k.name}`).then(render, fail) }, "删除 / Delete") : ""),
        ),
      ),
    ),
    role === "owner" ? el("p", {}, name, value, hosts, el("button", { onclick: save }, "保存 / Save")) : "",
  );
}

/** Upload a flow folder from this computer (with its runs/ history), e.g. after `flowgit run`. */
function uploadFolder(wsId) {
  const input = el("input", { type: "file", webkitdirectory: "", multiple: "" });
  const skip = /(^|\/)(\.git|node_modules|\.flowgit)(\/|$)/;
  const go = async () => {
    const files = {};
    let root = "";
    for (const file of input.files) {
      const rel = file.webkitRelativePath.split("/").slice(1).join("/");
      root = file.webkitRelativePath.split("/")[0];
      if (!rel || skip.test(rel)) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      files[rel] = btoa(bin);
    }
    const r = await call("POST", `/api/workspaces/${wsId}/flows`, { name: root || "flow", files });
    state.flow = r.flow.id;
    render();
  };
  return el("p", {}, "上传电脑上的流程文件夹（连同 runs/ 版本）/ Upload a flow folder from this computer (with its runs/ versions): ", input, el("button", { onclick: () => go().catch(fail) }, "上传 / Upload"));
}

async function flow(id) {
  const [board, { inputs }, { run }] = await Promise.all([call("GET", `/api/flows/${id}/board/flow`), call("GET", `/api/flows/${id}/board/inputs`), call("GET", `/api/flows/${id}/run`)]);
  const out = el("div", {});
  const rows = board.stages.map((stage) =>
    el(
      "tr",
      {},
      el("td", {}, stage.name ?? stage.id),
      el("td", { class: "muted" }, `${stage.executor ?? ""} · ${stage.state ?? ""}`),
      el("td", {}, el("button", { onclick: () => versions(id, stage.id, out) }, "版本 / Versions")),
      el("td", {}, stage.executor === "human" ? el("button", { onclick: () => humanFiles(id, stage, out) }, "填写 / Fill in") : ""),
    ),
  );
  return section(`流程 / Flow: ${board.name ?? id}`, el("table", {}, rows), flowInputs(id, inputs), runPanel(id, run), out);
}

/** The flow's inputs, saved with PUT board/inputs. */
function flowInputs(flowId, inputs) {
  if (!inputs.length) return "";
  const fields = inputs.map((input) => ({ input, box: el("input", { value: input.value ?? input.default ?? "", placeholder: input.description ?? "" }) }));
  const save = () => call("PUT", `/api/flows/${flowId}/board/inputs`, Object.fromEntries(fields.map((f) => [f.input.name, f.box.value]))).then(render, fail);
  return el("div", {}, el("h2", {}, "流程输入 / Inputs"), el("table", {}, fields.map((f) => el("tr", {}, el("td", {}, el("code", {}, f.input.name), f.input.required ? " *" : ""), el("td", {}, f.box)))), el("button", { onclick: save }, "保存输入 / Save inputs"));
}

/** A human stage's text outputs, saved with PUT board/file (which resumes a run waiting for them). */
async function humanFiles(flowId, stage, out) {
  const boxes = [];
  for (const output of stage.outputs.filter((o) => o.text)) {
    const res = await fetch(`/api/flows/${flowId}/board/file?path=${encodeURIComponent(output.path)}`);
    const text = res.ok ? await res.text() : "";
    boxes.push({ output, box: el("textarea", { rows: "8", cols: "80" }, text) });
  }
  const save = async () => {
    for (const { output, box } of boxes) {
      const res = await fetch(`/api/flows/${flowId}/board/file?path=${encodeURIComponent(output.path)}`, { method: "PUT", body: box.value });
      if (!res.ok) throw new Error((await res.json()).error ?? `${res.status}`);
    }
    render();
  };
  out.replaceChildren(el("h2", {}, stage.name ?? stage.id), stage.instructions ? el("p", { class: "muted" }, stage.instructions) : "", ...boxes.flatMap((b) => [el("p", {}, el("code", {}, b.output.path)), b.box]), el("p", {}, el("button", { onclick: () => save().catch(fail) }, "保存 / Save")));
}

let socket;

/** Run the flow in the cloud, see where it stands, continue or cancel it, and watch the log. */
function runPanel(flowId, run) {
  const model = el("input", { placeholder: "deepseek/deepseek-chat", value: localStorage.getItem("flowgit.console.model") ?? "" });
  const log = el("pre", { class: "log" });
  const status = el("p", { class: "muted" }, run ? describe(run) : "没有在运行 / not running");
  const start = () => {
    localStorage.setItem("flowgit.console.model", model.value.trim());
    call("POST", `/api/flows/${flowId}/board/run`, { stage: "all", detach: true, ...(model.value.trim() ? { model: model.value.trim() } : {}) }).then(refresh, fail);
  };
  // Ask for the current state rather than trust the order answers and frames arrive in.
  const refresh = () =>
    call("GET", `/api/flows/${flowId}/run`).then((r) => {
      run = r.run;
      status.textContent = describe(run);
    }, fail);
  const act = (what) => () => run && call("POST", `/api/flows/${flowId}/runs/${run.id}/${what}`).then(render, fail);
  socket?.close();
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/flows/${flowId}/events`);
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string" || !event.data.startsWith("{")) return;
    const frame = JSON.parse(event.data);
    if (frame.event === "hello") return;
    const d = frame.data ?? {};
    const line = d.line ?? d.error ?? d.reason ?? (d.waiting ? `等待 / waiting: ${d.waiting.stage} ${d.waiting.missing?.join(", ") ?? ""}` : "");
    log.append(`${frame.event} ${d.stage ?? ""} ${line}`.trim(), "\n");
    if (frame.event.startsWith("run:")) refresh();
  });
  setInterval(() => socket.readyState === 1 && socket.send("ping"), 30000);
  return el(
    "div",
    {},
    el("h2", {}, "云端运行 / Cloud run"),
    status,
    el("p", {}, "模型 / model ", model, el("button", { onclick: start }, "全部运行 / Run all"), el("button", { onclick: act("continue") }, "继续 / Continue"), el("button", { onclick: act("cancel") }, "取消 / Cancel")),
    log,
  );
}

function describe(run) {
  if (!run) return "没有在运行 / not running";
  const waiting = run.waiting ? ` · ${run.waiting.kind === "computer" ? "要电脑 / needs a computer" : "等你 / waiting for you"}: ${run.waiting.stage}` : "";
  return `${run.id} · ${run.state}${waiting} · ${run.tokens} token`;
}

async function versions(flowId, stage, out) {
  try {
    const { runs } = await call("GET", `/api/flows/${flowId}/board/runs?stage=${encodeURIComponent(stage)}`);
    if (!runs.length) {
      out.replaceChildren(el("p", { class: "muted" }, "还没有版本：在电脑上运行后用命令行推上来 / No versions yet: run on a computer, then push with the CLI"));
      return;
    }
    const pick = (sel) => el("select", {}, runs.map((r) => el("option", { value: r.n, ...(sel === r.n ? { selected: "" } : {}) }, `v${r.n} ${r.status ?? ""}`)));
    const a = pick(runs[0].n);
    const b = el("select", {}, el("option", { value: "" }, "现在的文件 / current files"), runs.map((r) => el("option", { value: r.n }, `v${r.n}`)));
    const result = el("div", {});
    out.replaceChildren(
      el("h2", {}, `${stage} 的版本 / versions`),
      a,
      b,
      el("button", { onclick: () => diff(flowId, stage, a.value, b.value, result) }, "对比 / Compare"),
      result,
    );
  } catch (err) {
    fail(err);
  }
}

async function diff(flowId, stage, a, b, result) {
  try {
    const d = await call("GET", `/api/flows/${flowId}/board/diff?stage=${encodeURIComponent(stage)}&a=${a}${b ? `&b=${b}` : ""}`);
    result.replaceChildren(
      ...d.outputs.map((o) => {
        if (o.kind !== "text") return el("p", {}, `${o.path}: ${o.same ? "一样 / same" : "不一样 / different"}`);
        const pre = el("pre", {});
        for (const line of (o.diff || "（一样 / same）").split("\n")) pre.append(el("span", { class: line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "" }, line), "\n");
        return el("div", {}, el("p", {}, el("code", {}, o.path)), pre);
      }),
    );
  } catch (err) {
    fail(err);
  }
}

render().catch(fail);
