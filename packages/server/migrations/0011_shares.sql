-- Public read-only links for one flow (#172). The token is returned once;
-- the server stores only its SHA-256. Deleting the flow deletes its shares.
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX shares_flow ON shares(flow_id);
