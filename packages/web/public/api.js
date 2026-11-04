/**
 * Board HTTP and the SSE connection. The only module that may call fetch or EventSource.
 * The web app (packages/app) sets globalThis.flowgitTransport before this module loads, and
 * then every request and the event stream are answered in the browser instead of by a server.
 */
const transport = globalThis.flowgitTransport;
/** True in the web app, where requests are answered in the page and there is no local server. */
export const inPage = Boolean(transport);
export const token = document.querySelector('meta[name="flowgit-token"]')?.getAttribute("content") ?? "";

export function headers() {
    return { "X-Flowgit-Token": token };
}

function request(url, init) {
  return transport ? transport.fetch(url, init) : fetch(url, init);
}

export function getFlow() {
  return request("/api/flow", { headers: headers(), cache: "no-store" });
}

export function getGraph() {
  return request("/api/graph", { headers: headers(), cache: "no-store" });
}

export function getPlan(model) {
  const planPath = model ? `/api/plan?model=${encodeURIComponent(model)}` : "/api/plan";
  return request(planPath, { headers: headers(), cache: "no-store" });
}

export function getUsage() {
  return request("/api/usage", { headers: headers(), cache: "no-store" });
}

export function getInputs() {
  return request("/api/inputs", { headers: headers(), cache: "no-store" });
}

export function putInputs(payload) {
  return request("/api/inputs", {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

export function getFile(rel) {
  return request(`/api/file?path=${encodeURIComponent(rel)}`, { headers: headers(), cache: "no-store" });
}

export function saveFile(rel, text) {
  return request(`/api/file?path=${encodeURIComponent(rel)}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "text/plain; charset=utf-8" },
    body: text,
    cache: "no-store",
  });
}

export function getThumb(stageId, index) {
  return request(`/api/thumb?stage=${encodeURIComponent(stageId)}&output=${index}`, {
    headers: headers(),
    cache: "no-store",
  });
}

export function getRuns(stageId) {
  return request(`/api/runs?stage=${encodeURIComponent(stageId)}`, { headers: headers(), cache: "no-store" });
}

export function getDiff(params) {
  return request(`/api/diff?${params}`, { headers: headers(), cache: "no-store" });
}

export function restoreRun(body) {
  return request("/api/restore", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export function runStage(body) {
  return request("/api/run", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export function postTrust(body) {
  return request("/api/trust", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export function postStage(payload) {
  return request("/api/stage", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

export function deleteStage(query) {
  return request(`/api/stage?${query}`, { method: "DELETE", headers: headers(), cache: "no-store" });
}

export function putStage(payload) {
  return request("/api/stage", {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

export function putFlow(payload) {
  return request("/api/flow", {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

export function uploadFile(stageId, name, file) {
  return request(`/api/upload?stage=${encodeURIComponent(stageId)}&name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: headers(),
    body: file,
    cache: "no-store",
  });
}

/** The board's SSE connection. The page passes the URL; this is the only EventSource. */
export function subscribe(url) {
  return transport ? transport.events(url) : new EventSource(url);
}


/** Generate a flow from one sentence (a dry run), or write the previewed one with `{ confirm: true, id }`. */
export function postGenerate(payload) {
  return request("/api/generate", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

/**
 * Cloud live collaboration (#173). `transport.cloud` is set by the web app.
 * When it is missing, this is a share link, or nobody is signed in, every helper no-ops.
 *
 * cloud: {
 *   flowId, role, share, me: { id, name, avatar_url },
 *   send(message), on(event, handler) => unsubscribe
 * }
 */
export function cloudInfo() {
    const cloud = transport?.cloud;
    if (!cloud || cloud.share || !cloud.me || !cloud.flowId) return null;
    return cloud;
}

export function sendLive(message) {
    const cloud = cloudInfo();
    if (!cloud || typeof cloud.send !== "function") return;
    cloud.send(message);
}

export function onLive(event, handler) {
    const cloud = cloudInfo();
    if (!cloud || typeof cloud.on !== "function") return () => {};
    const off = cloud.on(event, handler);
    return typeof off === "function" ? off : () => {};
}

function cloudPath(suffix) {
    const cloud = cloudInfo();
    if (!cloud) return "";
    return `/api/flows/${encodeURIComponent(cloud.flowId)}${suffix}`;
}

export function getComments() {
    const path = cloudPath("/comments");
    if (!path) return Promise.resolve(new Response(null, { status: 404 }));
    return request(path, { headers: headers(), cache: "no-store" });
}

export function postComment(payload) {
    const path = cloudPath("/comments");
    if (!path) return Promise.resolve(new Response(null, { status: 404 }));
    return request(path, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
    });
}

export function patchComment(id, payload) {
    const path = cloudPath(`/comments/${encodeURIComponent(id)}`);
    if (!path) return Promise.resolve(new Response(null, { status: 404 }));
    return request(path, {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
    });
}

export function deleteComment(id) {
    const path = cloudPath(`/comments/${encodeURIComponent(id)}`);
    if (!path) return Promise.resolve(new Response(null, { status: 404 }));
    return request(path, { method: "DELETE", headers: headers(), cache: "no-store" });
}

export function getNotifications() {
    if (!cloudInfo()) return Promise.resolve(new Response(null, { status: 404 }));
    return request("/api/notifications", { headers: headers(), cache: "no-store" });
}

export function readNotifications(ids) {
    if (!cloudInfo()) return Promise.resolve(new Response(null, { status: 404 }));
    return request("/api/notifications/read", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        cache: "no-store",
    });
}

/** Cloud flow record (`workspace_id`), not the board's `/api/flow`. */
export function getCloudFlow() {
    const path = cloudPath("");
    if (!path) return Promise.resolve(new Response(null, { status: 404 }));
    return request(path, { headers: headers(), cache: "no-store" });
}

export function getAudit(workspaceId, before) {
    if (!cloudInfo() || !workspaceId) return Promise.resolve(new Response(null, { status: 404 }));
    const query = before ? `?before=${encodeURIComponent(before)}` : "";
    return request(`/api/workspaces/${encodeURIComponent(workspaceId)}/audit${query}`, { headers: headers(), cache: "no-store" });
}
