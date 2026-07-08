-- Widen transaction_links.kind to also allow 'transfer', so manual and detected
-- account-to-account transfers can be linked the same way credit-card payments are
-- (see commands/mod.rs create_transfer / link_transfer_pair).
CREATE TABLE transaction_links_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('credit_card_payment','transfer')),
  debit_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  credit_transaction_id TEXT UNIQUE REFERENCES transactions(id),
  invoice_id TEXT REFERENCES credit_card_invoices(id),
  previous_category_id TEXT REFERENCES categories(id),
  previous_category_source TEXT,
  previous_rule_id TEXT REFERENCES categorization_rules(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(debit_transaction_id != credit_transaction_id)
);

INSERT INTO transaction_links_new SELECT * FROM transaction_links;

DROP INDEX IF EXISTS transaction_links_invoice;
DROP TABLE transaction_links;
ALTER TABLE transaction_links_new RENAME TO transaction_links;

CREATE INDEX transaction_links_invoice ON transaction_links(invoice_id);
