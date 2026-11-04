-- Comments on a cloud flow (#173). The text stays in this table: it is never copied
-- into the flow directory, a zip, or the audit log. Mentions are notifications
-- with kind 'comment.mention' (src/notify/notify.ts), not a copy of the text.
-- https://developers.cloudflare.com/d1/reference/migrations/

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  path TEXT NOT NULL,
  start INTEGER,
  end INTEGER,
  quote TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
CREATE INDEX comments_flow ON comments(flow_id, created_at);
