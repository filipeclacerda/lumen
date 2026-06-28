CREATE TRIGGER IF NOT EXISTS update_invoice_totals_on_transaction_update
AFTER UPDATE OF amount_cents, deleted_at ON transactions
FOR EACH ROW
WHEN (NEW.amount_cents != OLD.amount_cents) OR (NEW.deleted_at IS NULL) != (OLD.deleted_at IS NULL)
BEGIN
    UPDATE credit_card_invoices
    SET 
        purchases_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents > 0), 0),
        credits_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents < 0), 0),
        total_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL), 0)
    WHERE id IN (SELECT invoice_id FROM credit_card_invoice_items WHERE transaction_id = NEW.id);
END;

UPDATE credit_card_invoices
SET 
    purchases_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents > 0), 0),
    credits_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL AND t.amount_cents < 0), 0),
    total_cents = COALESCE((SELECT SUM(t.amount_cents) FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id WHERE x.invoice_id = credit_card_invoices.id AND t.deleted_at IS NULL), 0);
