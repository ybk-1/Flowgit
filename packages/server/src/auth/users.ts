import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { HttpError, newId } from "../http.js";
import { adminList, findInvite, useInvite } from "../invites.js";
import { addMember } from "../workspaces.js";
import type { User } from "./session.js";

/** What a sign-in provider tells us about a person. */
export interface Identity {
  provider: "github" | "google" | "test";
  /** Stable id at the provider: GitHub's numeric user id, Google's "sub". Never the login or email. */
  subject: string;
  login?: string | null;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export class InviteNeededError extends HttpError {
  constructor() {
    super(403, "测试版只能凭邀请码注册 / the beta is invite-only: sign up with an invite code", { code: "invite_needed" });
  }
}

/**
 * Find or create the account for this identity. A new account needs a usable invite code, or the
 * identity must be in ADMINS. With a workspace invite, the person also joins that workspace.
 */
export async function signIn(env: Env, identity: Identity, inviteCode?: string): Promise<{ user: User; created: boolean; joined?: string }> {
  const now = Date.now();
  const existing = await env.DB.prepare(
    "SELECT u.* FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?",
  )
    .bind(identity.provider, identity.subject)
    .first<User>();
  const invite = inviteCode ? await findInvite(env, inviteCode) : undefined;

  if (existing) {
    // Keep the profile fresh; login names can change at the provider.
    await env.DB.batch([
      env.DB.prepare("UPDATE identities SET login = ? WHERE provider = ? AND subject = ?").bind(identity.login ?? null, identity.provider, identity.subject),
      env.DB.prepare("UPDATE users SET avatar_url = COALESCE(?, avatar_url), email = COALESCE(?, email) WHERE id = ?").bind(
        identity.avatarUrl ?? null,
        identity.email ?? null,
        existing.id,
      ),
    ]);
    let joined: string | undefined;
    if (invite?.workspace_id && invite.role && (await useInvite(env, invite))) {
      await addMember(env, invite.workspace_id, existing.id, invite.role);
      joined = invite.workspace_id;
      await audit(env, { userId: existing.id, workspaceId: joined, action: "invite.accept", detail: { invite: invite.id, role: invite.role } });
    }
    await audit(env, { userId: existing.id, action: "auth.signin", detail: { provider: identity.provider } });
    return { user: existing, created: false, joined };
  }

  const admin = adminList(env).includes(`${identity.provider}:${identity.subject}`);
  if (!admin) {
    if (!invite) throw new InviteNeededError();
    if (!(await useInvite(env, invite))) throw new InviteNeededError();
  }
  const user: User = {
    id: newId("usr"),
    name: (identity.name || identity.login || "Flowgit user").slice(0, 100),
    email: identity.email ?? null,
    avatar_url: identity.avatarUrl ?? null,
    created_at: now,
  };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, name, email, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)").bind(user.id, user.name, user.email, user.avatar_url, now),
    env.DB.prepare("INSERT INTO identities (provider, subject, user_id, login, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      identity.provider,
      identity.subject,
      user.id,
      identity.login ?? null,
      now,
    ),
  ]);
  let joined: string | undefined;
  if (invite?.workspace_id && invite.role) {
    await addMember(env, invite.workspace_id, user.id, invite.role);
    joined = invite.workspace_id;
  }
  await audit(env, {
    userId: user.id,
    workspaceId: joined,
    action: "auth.signup",
    detail: { provider: identity.provider, invite: invite?.id ?? null, admin },
  });
  return { user, created: true, joined };
}
