ALTER TABLE transactions ADD COLUMN merchant_key TEXT;
CREATE INDEX transactions_merchant ON transactions(merchant_key) WHERE merchant_key IS NOT NULL;

-- Dicionário editável de apelidos: merchant_key bruto -> nome amigável
CREATE TABLE merchant_aliases (
  id TEXT PRIMARY KEY,
  merchant_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
