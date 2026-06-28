CREATE TABLE financial_targets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('savings','category')),
  category_id TEXT REFERENCES categories(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK((kind='category' AND category_id IS NOT NULL) OR (kind='savings' AND category_id IS NULL))
);

CREATE TABLE financial_target_overrides (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES financial_targets(id),
  month TEXT NOT NULL CHECK(length(month)=7),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(target_id, month)
);

CREATE INDEX financial_targets_active ON financial_targets(enabled) WHERE deleted_at IS NULL;
CREATE INDEX financial_target_overrides_month ON financial_target_overrides(month);

