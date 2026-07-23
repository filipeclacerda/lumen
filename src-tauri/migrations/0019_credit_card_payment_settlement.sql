-- Pagamentos de fatura liquidam uma dívida anterior. Eles permanecem como
-- transações positivas no cartão, mas não são créditos da fatura importada.
ALTER TABLE credit_card_invoices
ADD COLUMN payments_cents INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS update_invoice_totals_on_transaction_update;

CREATE TRIGGER update_invoice_totals_on_transaction_update
AFTER UPDATE OF amount_cents, deleted_at ON transactions
FOR EACH ROW
WHEN (NEW.amount_cents != OLD.amount_cents) OR ((NEW.deleted_at IS NULL) != (OLD.deleted_at IS NULL))
BEGIN
    UPDATE credit_card_invoices
    SET
        purchases_cents = COALESCE((
            SELECT SUM(-t.amount_cents)
            FROM credit_card_invoice_items x
            JOIN transactions t ON t.id = x.transaction_id
            WHERE x.invoice_id = credit_card_invoices.id
              AND x.line_kind = 'purchase'
              AND t.deleted_at IS NULL
              AND t.amount_cents < 0
        ), 0),
        credits_cents = COALESCE((
            SELECT SUM(t.amount_cents)
            FROM credit_card_invoice_items x
            JOIN transactions t ON t.id = x.transaction_id
            WHERE x.invoice_id = credit_card_invoices.id
              AND x.line_kind = 'refund'
              AND t.deleted_at IS NULL
              AND t.amount_cents > 0
        ), 0),
        payments_cents = COALESCE((
            SELECT SUM(t.amount_cents)
            FROM credit_card_invoice_items x
            JOIN transactions t ON t.id = x.transaction_id
            WHERE x.invoice_id = credit_card_invoices.id
              AND x.line_kind = 'payment'
              AND t.deleted_at IS NULL
              AND t.amount_cents > 0
        ), 0),
        total_cents = COALESCE((
            SELECT SUM(CASE
                WHEN x.line_kind = 'purchase' AND t.amount_cents < 0 THEN -t.amount_cents
                WHEN x.line_kind = 'refund' AND t.amount_cents > 0 THEN -t.amount_cents
                ELSE 0
            END)
            FROM credit_card_invoice_items x
            JOIN transactions t ON t.id = x.transaction_id
            WHERE x.invoice_id = credit_card_invoices.id
              AND t.deleted_at IS NULL
        ), 0)
    WHERE id IN (
        SELECT invoice_id
        FROM credit_card_invoice_items
        WHERE transaction_id = NEW.id
    );
END;

-- Corrige também faturas já importadas. O status existente é mantido: a
-- conciliação posterior decide quando uma fatura deve passar a paga.
UPDATE credit_card_invoices
SET
    purchases_cents = COALESCE((
        SELECT SUM(-t.amount_cents)
        FROM credit_card_invoice_items x
        JOIN transactions t ON t.id = x.transaction_id
        WHERE x.invoice_id = credit_card_invoices.id
          AND x.line_kind = 'purchase'
          AND t.deleted_at IS NULL
          AND t.amount_cents < 0
    ), 0),
    credits_cents = COALESCE((
        SELECT SUM(t.amount_cents)
        FROM credit_card_invoice_items x
        JOIN transactions t ON t.id = x.transaction_id
        WHERE x.invoice_id = credit_card_invoices.id
          AND x.line_kind = 'refund'
          AND t.deleted_at IS NULL
          AND t.amount_cents > 0
    ), 0),
    payments_cents = COALESCE((
        SELECT SUM(t.amount_cents)
        FROM credit_card_invoice_items x
        JOIN transactions t ON t.id = x.transaction_id
        WHERE x.invoice_id = credit_card_invoices.id
          AND x.line_kind = 'payment'
          AND t.deleted_at IS NULL
          AND t.amount_cents > 0
    ), 0),
    total_cents = COALESCE((
        SELECT SUM(CASE
            WHEN x.line_kind = 'purchase' AND t.amount_cents < 0 THEN -t.amount_cents
            WHEN x.line_kind = 'refund' AND t.amount_cents > 0 THEN -t.amount_cents
            ELSE 0
        END)
        FROM credit_card_invoice_items x
        JOIN transactions t ON t.id = x.transaction_id
        WHERE x.invoice_id = credit_card_invoices.id
          AND t.deleted_at IS NULL
    ), 0);

-- Uma conciliação de pagamento pode ser formada progressivamente com quaisquer
-- dois dos três lados (débito bancário, crédito no cartão e fatura). Uma
-- transferência continua exigindo obrigatoriamente as duas transações.
CREATE TABLE transaction_links_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('credit_card_payment','transfer')),
  debit_transaction_id TEXT UNIQUE REFERENCES transactions(id),
  credit_transaction_id TEXT UNIQUE REFERENCES transactions(id),
  invoice_id TEXT UNIQUE REFERENCES credit_card_invoices(id),
  previous_category_id TEXT REFERENCES categories(id),
  previous_category_source TEXT,
  previous_rule_id TEXT REFERENCES categorization_rules(id),
  previous_invoice_status TEXT CHECK(previous_invoice_status IN ('open','paid')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(debit_transaction_id IS NULL OR credit_transaction_id IS NULL OR debit_transaction_id != credit_transaction_id),
  CHECK(previous_invoice_status IS NULL OR (kind = 'credit_card_payment' AND invoice_id IS NOT NULL)),
  CHECK(
    (
      kind = 'transfer'
      AND debit_transaction_id IS NOT NULL
      AND credit_transaction_id IS NOT NULL
      AND invoice_id IS NULL
    )
    OR
    (
      kind = 'credit_card_payment'
      AND (
        (debit_transaction_id IS NOT NULL)
        + (credit_transaction_id IS NOT NULL)
        + (invoice_id IS NOT NULL)
      ) >= 2
    )
  )
);

INSERT INTO transaction_links_new (
  id,
  kind,
  debit_transaction_id,
  credit_transaction_id,
  invoice_id,
  previous_category_id,
  previous_category_source,
  previous_rule_id,
  previous_invoice_status,
  created_at
)
SELECT
  links.id,
  links.kind,
  links.debit_transaction_id,
  links.credit_transaction_id,
  links.invoice_id,
  links.previous_category_id,
  links.previous_category_source,
  links.previous_rule_id,
  CASE
    -- A implementação anterior restaurava o status a partir do total no
    -- desvínculo. Reproduz aqui o total antigo (que incluía pagamentos) para
    -- registrar exatamente o mesmo resultado nos vínculos legados.
    WHEN links.kind = 'credit_card_payment' AND links.invoice_id IS NOT NULL
      THEN CASE WHEN COALESCE((
        SELECT SUM(CASE
          WHEN items.line_kind = 'purchase' AND transactions.amount_cents < 0
            THEN -transactions.amount_cents
          WHEN items.line_kind IN ('refund','payment') AND transactions.amount_cents > 0
            THEN -transactions.amount_cents
          ELSE 0
        END)
        FROM credit_card_invoice_items items
        JOIN transactions ON transactions.id = items.transaction_id
        WHERE items.invoice_id = links.invoice_id
          AND transactions.deleted_at IS NULL
      ), 0) <= 0 THEN 'paid' ELSE 'open' END
    ELSE NULL
  END,
  links.created_at
FROM transaction_links links;

DROP INDEX IF EXISTS transaction_links_invoice;
DROP TABLE transaction_links;
ALTER TABLE transaction_links_new RENAME TO transaction_links;

CREATE INDEX transaction_links_invoice ON transaction_links(invoice_id);
