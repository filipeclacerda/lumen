-- Widen the recurring_transactions.day_of_month constraint from 1-28 to 1-31.
-- Days that don't exist in a given month (e.g. 29/30/31 in February) are clamped to the
-- last day of that month when occurrences are generated (see commands/recurring.rs).
CREATE TABLE recurring_transactions_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents != 0),
  day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
  start_month TEXT NOT NULL CHECK(length(start_month)=7),
  end_month TEXT CHECK(end_month IS NULL OR length(end_month)=7),
  last_generated_month TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

INSERT INTO recurring_transactions_new SELECT * FROM recurring_transactions;

DROP INDEX IF EXISTS recurring_transactions_active;
DROP TABLE recurring_transactions;
ALTER TABLE recurring_transactions_new RENAME TO recurring_transactions;

CREATE INDEX recurring_transactions_active ON recurring_transactions(active) WHERE deleted_at IS NULL;
