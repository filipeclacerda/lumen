CREATE TABLE recurring_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents != 0),
  day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 28),
  start_month TEXT NOT NULL CHECK(length(start_month)=7),
  end_month TEXT CHECK(end_month IS NULL OR length(end_month)=7),
  last_generated_month TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX recurring_transactions_active ON recurring_transactions(active) WHERE deleted_at IS NULL;

ALTER TABLE transactions ADD COLUMN recurring_transaction_id TEXT REFERENCES recurring_transactions(id);
CREATE INDEX transactions_recurring ON transactions(recurring_transaction_id) WHERE recurring_transaction_id IS NOT NULL;
