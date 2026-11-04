-- Cloud runs (#170): runs, the key vault, trust confirmations, notifications and usage.
-- Times are milliseconds since 1970 (UTC). Key values are stored only encrypted (AES-GCM).

-- One row per run. A run is a Cloudflare Workflows instance with the same id.
-- state: running, waiting (a person or a computer), done, failed, budget, cancelled, expired.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  stage TEXT NOT NULL,
  model TEXT,
  state TEXT NOT NULL,
  -- JSON: { stage, name, kind: "human" | "computer", missing?, instructions? } while waiting.
  waiting TEXT,
  error TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX runs_flow ON runs(flow_id, created_at);
CREATE INDEX runs_workspace ON runs(workspace_id, created_at);

-- Write-only keys: the value never leaves the server except into a run's environment.
CREATE TABLE vault_keys (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  last4 TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);

-- Every time a run read a key: which flow, run and stage, and the tokens that stage used.
CREATE TABLE key_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX key_uses_workspace ON key_uses(workspace_id, created_at);

-- A copied flow's confirmation: the fingerprint of the actions a person looked at.
CREATE TABLE trust (
  flow_id TEXT PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- In-app notifications. kind: run.waiting, run.computer, run.done, run.failed.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT,
  flow_id TEXT,
  run_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);

-- Web Push subscriptions (https://www.w3.org/TR/push-api/), one per browser or device.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_user ON push_subscriptions(user_id);

-- Tokens and runs per workspace per month ("2026-11", UTC).
CREATE TABLE usage (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, month)
);
