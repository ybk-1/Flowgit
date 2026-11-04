// Sharing a cloud flow: a public read-only link, shown once, and a one-click copy into your workspace.
import { cloudError, i18n, loadMe, readJson, type CloudRole } from "./cloud.js";

interface ShareRow {
  id: string;
  created_at: number;
}

export function bindShareCopy(button: HTMLButtonElement, token: string): void {
  button.addEventListener("click", () => {
    void (async () => {
      button.setAttribute("disabled", "");
      try {
        const me = await loadMe();
        const target = me?.workspaces.find((ws) => ws.role === "owner" || ws.role === "editor");
        if (!target) {
          location.href = "./index.html";
          return;
        }
        const id = await copySharedFlow(token, target.id);
        location.href = `./board.html?flow=${encodeURIComponent(`cloud-${id}`)}`;
      } catch (err) {
        button.removeAttribute("disabled");
        alert(err instanceof Error ? err.message : String(err));
      }
    })();
  });
}

export async function copySharedFlow(token: string, workspaceId: string, name?: string): Promise<string> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}/copy`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { workspace: workspaceId, name } : { workspace: workspaceId }),
  });
  const body = await readJson<{ flow?: { id: string }; error?: string }>(res);
  if (!res.ok || !body.flow) throw new Error(cloudError(body, res.status));
  return body.flow.id;
}

export async function openShares(flowId: string, role: CloudRole): Promise<void> {
  const dialog = document.getElementById("share-dialog") as HTMLDialogElement | null;
  const list = document.getElementById("share-list");
  const note = document.getElementById("share-note");
  const once = document.getElementById("share-once");
  const urlBox = document.getElementById("share-url") as HTMLInputElement | null;
  const create = document.getElementById("share-create") as HTMLButtonElement | null;
  if (!dialog || !list || !note || !once || !urlBox || !create) return;
  note.hidden = true;
  once.hidden = true;
  urlBox.hidden = true;
  create.hidden = role === "viewer";
  dialog.showModal();
  const say = (message: string) => {
    note.hidden = false;
    i18n.raw(note, message);
  };
  const paint = async () => {
    list.replaceChildren();
    const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}/shares`, { credentials: "same-origin" });
    const body = await readJson<{ shares?: ShareRow[]; error?: string }>(res);
    if (!res.ok || !body.shares) {
      say(cloudError(body, res.status));
      return;
    }
    if (!body.shares.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      i18n.text(empty, "cloud.shareEmpty");
      list.append(empty);
      return;
    }
    for (const share of body.shares) {
      const row = document.createElement("li");
      row.className = "member-row";
      const label = document.createElement("p");
      label.className = "member-name";
      label.textContent = new Date(share.created_at).toLocaleString();
      row.append(label);
      if (role !== "viewer") {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "btn quiet";
        i18n.text(revoke, "cloud.shareRevoke");
        revoke.addEventListener("click", () => {
          void (async () => {
            const gone = await fetch(`/api/flows/${encodeURIComponent(flowId)}/shares/${encodeURIComponent(share.id)}`, { method: "DELETE", credentials: "same-origin" });
            if (!gone.ok) {
              say(cloudError(await readJson<{ error?: string }>(gone), gone.status));
              return;
            }
            await paint();
          })();
        });
        row.append(revoke);
      }
      list.append(row);
    }
  };
  create.onclick = () => {
    void (async () => {
      create.setAttribute("disabled", "");
      const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}/shares`, { method: "POST", credentials: "same-origin" });
      const body = await readJson<{ url?: string; error?: string }>(res);
      create.removeAttribute("disabled");
      if (!res.ok || !body.url) {
        say(cloudError(body, res.status));
        return;
      }
      const absolute = new URL(body.url, location.origin).href;
      once.hidden = false;
      urlBox.hidden = false;
      urlBox.value = absolute;
      urlBox.focus();
      urlBox.select();
      try {
        await navigator.clipboard.writeText(absolute);
      } catch {
        // the field stays selected
      }
      await paint();
    })();
  };
  document.getElementById("share-close")!.onclick = () => dialog.close();
  await paint();
}
