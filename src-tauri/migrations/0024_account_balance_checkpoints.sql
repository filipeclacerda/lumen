-- Saldos informados são âncoras de reconciliação e não movimentações financeiras.
-- A diferença para o razão nunca é persistida como receita ou despesa.
CREATE TABLE account_balance_checkpoints (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    as_of_date TEXT NOT NULL,
    balance_cents INTEGER NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('manual', 'import', 'reconciliation')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX account_balance_checkpoints_account_date
    ON account_balance_checkpoints(account_id, as_of_date DESC, created_at DESC);
