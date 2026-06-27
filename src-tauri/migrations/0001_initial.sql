CREATE TABLE accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('checking','savings','cash','credit_card')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
);
CREATE TABLE categories (
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES categories(id), name TEXT NOT NULL, color TEXT, icon TEXT
);
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_hash TEXT, created_at TEXT NOT NULL, undone_at TEXT
);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), date TEXT NOT NULL,
  description TEXT NOT NULL, normalized_description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  external_id TEXT, fingerprint TEXT NOT NULL, category_id TEXT REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'cleared', import_batch_id TEXT REFERENCES import_batches(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
);
CREATE UNIQUE INDEX unique_external_id ON transactions(account_id, external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX transaction_fingerprint ON transactions(account_id, fingerprint);
CREATE INDEX transaction_date ON transactions(date);
INSERT INTO accounts(id,name,kind) VALUES('default-account','Conta principal','checking');
INSERT INTO categories(id,name,color) VALUES
 ('income','Receitas','#22835f'),('food','Alimentação','#e5a142'),('housing','Moradia','#728bba'),
 ('transport','Transporte','#a778ba'),('health','Saúde','#d66d68'),('leisure','Lazer','#4c94a8');
