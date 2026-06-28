-- Integridade: corrige o sinal de credits_cents nas faturas e reforça
-- a regra de meta de economia única no nível do banco.

-- O commit de importação grava credits_cents como valor POSITIVO (módulo dos
-- estornos), mas o gatilho de 0006 recalculava como SOMA negativa, deixando o
-- mesmo campo com sinais diferentes dependendo do caminho. Recriamos o gatilho
-- para manter credits_cents sempre positivo, com total = compras - estornos.
DROP TRIGGER IF EXISTS update_invoice_totals_on_transaction_update;

CREATE TRIGGER update_invoice_totals_on_transaction_update
AFTER UPDATE OF amount_cents, deleted_at ON transactions
FOR EACH ROW
WHEN (NEW.amount_cents != OLD.amount_cents) OR ((NEW.deleted_at IS NULL) != (OLD.deleted_at IS NULL))
BEGIN
    UPDATE credit_card_invoices
    SET
        purchases_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents > 0), 0),
        credits_cents = -COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents < 0), 0),
        total_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL), 0)
    WHERE id IN (SELECT invoice_id FROM credit_card_invoice_items WHERE transaction_id = NEW.id);
END;

-- Recalcula as faturas existentes para o convênio corrigido (estornos positivos).
UPDATE credit_card_invoices
SET
    purchases_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents > 0), 0),
    credits_cents = -COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents < 0), 0),
    total_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL), 0);

-- Reforça, no banco, que só existe uma meta recorrente de economia ativa.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_savings_target
    ON financial_targets(kind) WHERE kind='savings' AND deleted_at IS NULL;
