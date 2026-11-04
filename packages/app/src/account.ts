// Account view: the person's own sessions. A CLI sign-in can be revoked from here.
import { cloudError, i18n, readJson } from "./cloud.js";

interface SessionRow {
  id: string;
  kind: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
  current: boolean;
}

function when(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export function bindAccount(): void {
  document.getElementById("cloud-account")?.addEventListener("click", () => {
    void openAccount();
  });
  document.getElementById("account-close")?.addEventListener("click", () => {
    (document.getElementById("account-dialog") as HTMLDialogElement | null)?.close();
  });
}

export async function openAccount(): Promise<void> {
  const dialog = document.getElementById("account-dialog") as HTMLDialogElement | null;
  const list = document.getElementById("account-sessions");
  const note = document.getElementById("account-note");
  if (!dialog || !list || !note) return;
  note.hidden = true;
  list.replaceChildren();
  dialog.showModal();
  const res = await fetch("/api/auth/sessions", { credentials: "same-origin" });
  const body = await readJson<{ sessions?: SessionRow[]; error?: string }>(res);
  if (!res.ok || !body.sessions) {
    note.hidden = false;
    i18n.raw(note, cloudError(body, res.status));
    return;
  }
  if (!body.sessions.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    i18n.text(empty, "cloud.sessionsEmpty");
    list.append(empty);
    return;
  }
  for (const session of body.sessions) {
    const row = document.createElement("li");
    row.className = "member-row";
    row.dataset.session = session.id;
    const text = document.createElement("div");
    const title = document.createElement("p");
    title.className = "member-name";
    i18n.text(title, session.kind === "cli" ? "cloud.sessionCli" : "cloud.sessionWeb");
    if (session.current) {
      const badge = document.createElement("span");
      badge.className = "cloud-badge";
      i18n.text(badge, "cloud.sessionCurrent");
      title.append(" ", badge);
    }
    const meta = document.createElement("p");
    meta.className = "hint";
    meta.textContent = `${when(session.created_at)}${session.user_agent ? ` · ${session.user_agent}` : ""}`;
    text.append(title, meta);
    row.append(text);
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "btn quiet";
    i18n.text(revoke, "cloud.sessionRevoke");
    revoke.addEventListener("click", () => {
      void (async () => {
        revoke.setAttribute("disabled", "");
        const gone = await fetch(`/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE", credentials: "same-origin" });
        if (!gone.ok) {
          const err = await readJson<{ error?: string }>(gone);
          note.hidden = false;
          i18n.raw(note, cloudError(err, gone.status));
          revoke.removeAttribute("disabled");
          return;
        }
        if (session.current) location.reload();
        else row.remove();
      })();
    });
    row.append(revoke);
    list.append(row);
  }
}
