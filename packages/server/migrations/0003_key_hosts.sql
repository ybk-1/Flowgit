-- Where each vault key may be sent: a JSON array of hostnames (e.g. ["api.deepseek.com"]).
-- A run refuses any request that carries a key to a host not on its list.
ALTER TABLE vault_keys ADD COLUMN hosts TEXT NOT NULL DEFAULT '[]';
