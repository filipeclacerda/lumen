CREATE TABLE installment_plans (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  first_date TEXT NOT NULL,
  description TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK(total_cents > 0),
  installment_count INTEGER NOT NULL CHECK(installment_count BETWEEN 2 AND 48),
  category_id TEXT REFERENCES categories(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transaction_installments (
  plan_id TEXT NOT NULL REFERENCES installment_plans(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  installment_number INTEGER NOT NULL,
  installment_count INTEGER NOT NULL,
  PRIMARY KEY(plan_id, installment_number),
  CHECK(installment_number BETWEEN 1 AND installment_count),
  CHECK(installment_count BETWEEN 2 AND 48)
);

CREATE INDEX installment_plans_account_date
  ON installment_plans(account_id, first_date);

CREATE INDEX transaction_installments_plan
  ON transaction_installments(plan_id);
