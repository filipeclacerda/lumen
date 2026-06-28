CREATE TABLE csv_mapping_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('bank','credit_card')),
  delimiter TEXT NOT NULL,
  date_format TEXT,
  decimal_separator TEXT,
  signature TEXT NOT NULL UNIQUE,
  columns_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX csv_mapping_profiles_kind ON csv_mapping_profiles(source_kind);
