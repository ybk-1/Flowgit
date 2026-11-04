-- Flowgit Cloud, first schema. Times are milliseconds since 1970 (UTC).
-- Secrets (session tokens, invite codes, device codes) are stored only as SHA-256 hashes.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

-- One row per sign-in method: ("github", numeric user id) or ("google", OpenID "sub").
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- kind: "web" (cookie) or "cli" (bearer token from the device code flow).
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- role: "owner", "editor" or "viewer".
CREATE TABLE members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX members_user ON members(user_id);

-- workspace_id NULL: a sign-up code (admins only). Otherwise it also adds the person to the workspace with role.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE INDEX invites_workspace ON invites(workspace_id);
CREATE INDEX invites_creator ON invites(created_by, created_at);

CREATE TABLE flows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX flows_workspace ON flows(workspace_id);

-- The device code flow for the CLI (RFC 8628 shape).
CREATE TABLE device_codes (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  approved_at INTEGER,
  used_at INTEGER
);

-- Who did what. detail is JSON and never holds secrets or file contents.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id TEXT,
  workspace_id TEXT,
  flow_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX audit_workspace ON audit(workspace_id, at);
