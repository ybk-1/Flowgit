-- Remote MCP (#171): a flow's MCP URL, OAuth for MCP clients (Claude, Cursor, ...), and a log of calls.
-- Times are milliseconds since 1970 (UTC). Secrets, codes and tokens are stored only as SHA-256.

-- A flow whose owner turned its MCP URL on. No row = off.
CREATE TABLE mcp_flows (
  flow_id TEXT PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
  enabled_by TEXT NOT NULL REFERENCES users(id),
  enabled_at INTEGER NOT NULL
);

-- MCP clients that registered themselves (OAuth Dynamic Client Registration, RFC 7591).
-- auth_method: none (public client, PKCE only), client_secret_post or client_secret_basic.
CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  secret_hash TEXT,
  name TEXT NOT NULL,
  -- JSON array of exact redirect URIs.
  redirect_uris TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- An authorization request waiting for the person to sign in and decide (10 minutes).
CREATE TABLE mcp_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  state TEXT,
  -- The flow named by the `resource` parameter; NULL lets the person pick one.
  flow_id TEXT,
  created_at INTEGER NOT NULL
);

-- Authorization codes: single use, 10 minutes, bound to the client, redirect URI, PKCE and flow.
CREATE TABLE mcp_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- What a person allowed: this client may use this flow's MCP URL as them. Revoking ends every token at once.
CREATE TABLE mcp_grants (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX mcp_grants_flow ON mcp_grants(flow_id);
CREATE INDEX mcp_grants_user ON mcp_grants(user_id);

-- Access tokens (1 hour) and refresh tokens (30 days, replaced on every use).
CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX mcp_tokens_grant ON mcp_tokens(grant_id);

-- Every tools/call: who, which client and tool, the run it started or continued, and its tokens.
CREATE TABLE mcp_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  client TEXT NOT NULL,
  tool TEXT NOT NULL,
  run_id TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX mcp_calls_workspace ON mcp_calls(workspace_id, created_at);

-- Runs started over MCP say so, like run.json's `via` and `client`.
ALTER TABLE runs ADD COLUMN via TEXT;
ALTER TABLE runs ADD COLUMN client TEXT;
