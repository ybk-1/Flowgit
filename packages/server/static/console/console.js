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
  const [{ workspace: ws, role, storage }, { members }, { flows }, { templates }] = await Promise.all([
    call("GET", `/api/workspaces/${id}`),
    call("GET", `/api/workspaces/${id}/members`),
    call("GET", `/api/workspaces/${id}/flows`),
    call("GET", "/api/templates"),
  ]);
  const roleSel = el("select", {}, ["editor", "viewer", "owner"].map((r) => el("option", { value: r }, r)));
  const tplSel = el("select", {}, templates.map((t) => el("option", { value: t.id }, `${t.id} · ${t.name}`)));
  const inviteOut = el("p", {});
  return section(
    `工作区 / Workspace: ${ws.name}`,
    el("p", { class: "muted" }, `你的角色 / your role: ${role} · 已用 / used ${(storage.used / 1048576).toFixed(1)} MB / ${(storage.quota / 1073741824).toFixed(0)} GB`),
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
  const board = await call("GET", `/api/flows/${id}/board/flow`);
  const out = el("div", {});
  const rows = board.stages.map((stage) =>
    el("tr", {}, el("td", {}, stage.name ?? stage.id), el("td", { class: "muted" }, stage.state ?? ""), el("td", {}, el("button", { onclick: () => versions(id, stage.id, out) }, "版本 / Versions"))),
  );
  return section(`流程 / Flow: ${board.name ?? id}`, el("table", {}, rows), out);
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
