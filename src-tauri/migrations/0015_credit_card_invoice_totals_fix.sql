-- Corrige a convenção de sinal das faturas de cartão:
-- compras são transações negativas, mas aparecem em purchases_cents como valor positivo;
-- estornos/pagamentos são transações positivas e aparecem em credits_cents como valor positivo.

ALTER TABLE credit_card_invoice_items ADD COLUMN line_kind TEXT NOT NULL DEFAULT 'purchase'
    CHECK(line_kind IN ('purchase','refund','payment'));

UPDATE credit_card_invoice_items
SET line_kind = CASE
    WHEN EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.id = credit_card_invoice_items.transaction_id
          AND t.amount_cents < 0
    ) THEN 'purchase'
    WHEN EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.id = credit_card_invoice_items.transaction_id
          AND t.amount_cents > 0
          AND t.category_id = 'credit-card-payment'
    ) THEN 'payment'
    WHEN EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.id = credit_card_invoice_items.transaction_id
          AND t.amount_cents > 0
    ) THEN 'refund'
    ELSE 'purchase'
END;

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
              AND x.line_kind IN ('refund','payment')
              AND t.deleted_at IS NULL
              AND t.amount_cents > 0
        ), 0),
        total_cents = COALESCE((
            SELECT SUM(CASE
                WHEN x.line_kind = 'purchase' AND t.amount_cents < 0 THEN -t.amount_cents
                WHEN x.line_kind IN ('refund','payment') AND t.amount_cents > 0 THEN -t.amount_cents
                ELSE 0
            END)
            FROM credit_card_invoice_items x
            JOIN transactions t ON t.id = x.transaction_id
            WHERE x.invoice_id = credit_card_invoices.id
              AND t.deleted_at IS NULL
        ), 0)
    WHERE id IN (SELECT invoice_id FROM credit_card_invoice_items WHERE transaction_id = NEW.id);
END;

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
          AND x.line_kind IN ('refund','payment')
          AND t.deleted_at IS NULL
          AND t.amount_cents > 0
    ), 0),
    total_cents = COALESCE((
        SELECT SUM(CASE
            WHEN x.line_kind = 'purchase' AND t.amount_cents < 0 THEN -t.amount_cents
            WHEN x.line_kind IN ('refund','payment') AND t.amount_cents > 0 THEN -t.amount_cents
            ELSE 0
        END)
        FROM credit_card_invoice_items x
        JOIN transactions t ON t.id = x.transaction_id
        WHERE x.invoice_id = credit_card_invoices.id
          AND t.deleted_at IS NULL
    ), 0);
