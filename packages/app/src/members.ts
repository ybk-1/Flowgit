// Members view: invite, change a role, remove. Only an owner can change anything; the server checks too.
import { cloudError, i18n, readJson, type CloudRole } from "./cloud.js";

interface MemberRow {
  id: string;
  name: string;
  avatar_url: string | null;
  role: CloudRole;
  created_at: number;
}

const ROLES: CloudRole[] = ["owner", "editor", "viewer"];

export async function openMembers(workspaceId: string, role: CloudRole): Promise<void> {
  const dialog = document.getElementById("members-dialog") as HTMLDialogElement | null;
  const list = document.getElementById("members-list");
  const note = document.getElementById("members-note");
  const invite = document.getElementById("members-invite") as HTMLFormElement | null;
  const urlBox = document.getElementById("members-url") as HTMLInputElement | null;
  if (!dialog || !list || !note || !invite || !urlBox) return;
  note.hidden = true;
  urlBox.hidden = true;
  invite.hidden = role !== "owner";
  dialog.showModal();
  const say = (message: string) => {
    note.hidden = false;
    i18n.raw(note, message);
  };
  const paint = async () => {
    list.replaceChildren();
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`, { credentials: "same-origin" });
    const body = await readJson<{ members?: MemberRow[]; error?: string }>(res);
    if (!res.ok || !body.members) {
      say(cloudError(body, res.status));
      return;
    }
    for (const member of body.members) {
      const row = document.createElement("li");
      row.className = "member-row";
      const who = document.createElement("p");
      who.className = "member-name";
      who.textContent = member.name;
      const select = document.createElement("select");
      select.disabled = role !== "owner";
      for (const value of ROLES) {
        const option = document.createElement("option");
        option.value = value;
        i18n.text(option, `cloud.role.${value}`);
        if (value === member.role) option.selected = true;
        select.append(option);
      }
      select.addEventListener("change", () => {
        void (async () => {
          const next = select.value;
          const updated = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.id)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: next }),
          });
          if (!updated.ok) {
            say(cloudError(await readJson<{ error?: string }>(updated), updated.status));
            select.value = member.role;
            return;
          }
          note.hidden = true;
        })();
      });
      row.append(who, select);
      if (role === "owner") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn quiet";
        i18n.text(remove, "cloud.remove");
        remove.addEventListener("click", () => {
          void (async () => {
            const gone = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.id)}`, {
              method: "DELETE",
              credentials: "same-origin",
            });
            if (!gone.ok) {
              say(cloudError(await readJson<{ error?: string }>(gone), gone.status));
              return;
            }
            row.remove();
          })();
        });
        row.append(remove);
      }
      list.append(row);
    }
  };
  invite.onsubmit = (event) => {
    event.preventDefault();
    void (async () => {
      const picked = (document.getElementById("members-role") as HTMLSelectElement | null)?.value ?? "editor";
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: picked }),
      });
      const body = await readJson<{ url?: string; error?: string }>(res);
      if (!res.ok || !body.url) {
        say(cloudError(body, res.status));
        return;
      }
      urlBox.hidden = false;
      urlBox.value = body.url;
      urlBox.focus();
      urlBox.select();
      try {
        await navigator.clipboard.writeText(body.url);
      } catch {
        // the field stays selected so it can be copied by hand
      }
      note.hidden = true;
    })();
  };
  document.getElementById("members-close")!.onclick = () => dialog.close();
  await paint();
}
