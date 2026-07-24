CREATE TABLE category_merge_log (
  id TEXT PRIMARY KEY,
  source_category_id TEXT NOT NULL,
  source_category_name TEXT NOT NULL,
  target_category_id TEXT NOT NULL REFERENCES categories(id),
  target_category_name TEXT NOT NULL,
  moved_transactions INTEGER NOT NULL DEFAULT 0,
  moved_rules INTEGER NOT NULL DEFAULT 0,
  moved_recurring INTEGER NOT NULL DEFAULT 0,
  moved_targets INTEGER NOT NULL DEFAULT 0,
  moved_children INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX category_merge_log_created_at
  ON category_merge_log(created_at DESC);
