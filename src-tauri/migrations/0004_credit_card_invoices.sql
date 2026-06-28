CREATE TABLE credit_card_invoices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  due_date TEXT NOT NULL,
  purchases_cents INTEGER NOT NULL,
  credits_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid')),
  import_batch_id TEXT NOT NULL UNIQUE REFERENCES import_batches(id),
  payment_transaction_id TEXT UNIQUE REFERENCES transactions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE credit_card_invoice_items (
  invoice_id TEXT NOT NULL REFERENCES credit_card_invoices(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  holder TEXT,
  installment TEXT,
  source_row INTEGER NOT NULL,
  raw_amount_cents INTEGER NOT NULL,
  PRIMARY KEY(invoice_id, source_row)
);

CREATE TABLE transaction_links (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind = 'credit_card_payment'),
  debit_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  credit_transaction_id TEXT UNIQUE REFERENCES transactions(id),
  invoice_id TEXT REFERENCES credit_card_invoices(id),
  previous_category_id TEXT REFERENCES categories(id),
  previous_category_source TEXT,
  previous_rule_id TEXT REFERENCES categorization_rules(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(debit_transaction_id != credit_transaction_id)
);

CREATE INDEX credit_card_invoices_account_due ON credit_card_invoices(account_id, due_date);
CREATE INDEX transaction_links_invoice ON transaction_links(invoice_id);
