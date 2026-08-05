-- Uma fatura parcial e uma versão posterior mais completa pertencem à mesma
-- fatura quando cartão e vencimento coincidem. Consolida duplicatas legadas
-- somente quando há no máximo um pagamento/uma conciliação no grupo; grupos
-- ambíguos são preservados para não descartar vínculos financeiros.
CREATE TEMP TABLE invoice_merge_groups_0030 AS
SELECT
  grouped.account_id,
  grouped.due_date,
  (
    SELECT candidate.id
    FROM credit_card_invoices candidate
    WHERE candidate.account_id = grouped.account_id
      AND candidate.due_date = grouped.due_date
      AND candidate.deleted_at IS NULL
    ORDER BY
      (candidate.payment_transaction_id IS NOT NULL) DESC,
      EXISTS(SELECT 1 FROM transaction_links links WHERE links.invoice_id = candidate.id) DESC,
      candidate.created_at,
      candidate.id
    LIMIT 1
  ) AS keeper_id,
  MAX(grouped.payment_transaction_id) AS payment_transaction_id,
  MAX(grouped.status = 'paid') AS was_paid
FROM credit_card_invoices grouped
WHERE grouped.deleted_at IS NULL
GROUP BY grouped.account_id, grouped.due_date
HAVING COUNT(*) > 1
   AND SUM(grouped.payment_transaction_id IS NOT NULL) <= 1
   AND (
     SELECT COUNT(*)
     FROM transaction_links links
     JOIN credit_card_invoices linked_invoice ON linked_invoice.id = links.invoice_id
     WHERE linked_invoice.account_id = grouped.account_id
       AND linked_invoice.due_date = grouped.due_date
       AND linked_invoice.deleted_at IS NULL
   ) <= 1;

CREATE TEMP TABLE invoice_merge_map_0030 AS
SELECT invoice.id AS duplicate_id, groups.keeper_id
FROM credit_card_invoices invoice
JOIN invoice_merge_groups_0030 groups
  ON groups.account_id = invoice.account_id
 AND groups.due_date = invoice.due_date
WHERE invoice.deleted_at IS NULL
  AND invoice.id <> groups.keeper_id;

-- Libera as constraints únicas antes de transferir pagamento e conciliação.
UPDATE credit_card_invoices
SET payment_transaction_id = NULL
WHERE id IN (SELECT duplicate_id FROM invoice_merge_map_0030)
   OR id IN (SELECT keeper_id FROM invoice_merge_groups_0030);

UPDATE transaction_links
SET invoice_id = (
  SELECT keeper_id
  FROM invoice_merge_map_0030 mapping
  WHERE mapping.duplicate_id = transaction_links.invoice_id
)
WHERE invoice_id IN (SELECT duplicate_id FROM invoice_merge_map_0030);

-- source_row identifica a linha dentro da fatura e precisa continuar único.
-- Os itens transferidos são anexados depois da maior linha do registro mantido.
CREATE TEMP TABLE invoice_item_move_0030 AS
SELECT
  items.transaction_id,
  mapping.keeper_id,
  COALESCE((
    SELECT MAX(kept.source_row)
    FROM credit_card_invoice_items kept
    WHERE kept.invoice_id = mapping.keeper_id
  ), 0) + ROW_NUMBER() OVER (
    PARTITION BY mapping.keeper_id
    ORDER BY transactions.date, items.source_row, items.transaction_id
  ) AS new_source_row
FROM credit_card_invoice_items items
JOIN invoice_merge_map_0030 mapping ON mapping.duplicate_id = items.invoice_id
JOIN transactions ON transactions.id = items.transaction_id;

UPDATE credit_card_invoice_items
SET invoice_id = (
      SELECT keeper_id
      FROM invoice_item_move_0030 moved
      WHERE moved.transaction_id = credit_card_invoice_items.transaction_id
    ),
    source_row = (
      SELECT new_source_row
      FROM invoice_item_move_0030 moved
      WHERE moved.transaction_id = credit_card_invoice_items.transaction_id
    )
WHERE transaction_id IN (SELECT transaction_id FROM invoice_item_move_0030);

DELETE FROM credit_card_invoices
WHERE id IN (SELECT duplicate_id FROM invoice_merge_map_0030);

UPDATE credit_card_invoices
SET payment_transaction_id = (
      SELECT payment_transaction_id
      FROM invoice_merge_groups_0030 groups
      WHERE groups.keeper_id = credit_card_invoices.id
    ),
    status = CASE
      WHEN (SELECT was_paid FROM invoice_merge_groups_0030 groups
            WHERE groups.keeper_id = credit_card_invoices.id) = 1 THEN 'paid'
      ELSE 'open'
    END
WHERE id IN (SELECT keeper_id FROM invoice_merge_groups_0030);

UPDATE credit_card_invoices
SET purchases_cents = COALESCE((
      SELECT SUM(-transactions.amount_cents)
      FROM credit_card_invoice_items items
      JOIN transactions ON transactions.id = items.transaction_id
      WHERE items.invoice_id = credit_card_invoices.id
        AND items.line_kind = 'purchase'
        AND transactions.deleted_at IS NULL
        AND transactions.amount_cents < 0
    ), 0),
    credits_cents = COALESCE((
      SELECT SUM(transactions.amount_cents)
      FROM credit_card_invoice_items items
      JOIN transactions ON transactions.id = items.transaction_id
      WHERE items.invoice_id = credit_card_invoices.id
        AND items.line_kind = 'refund'
        AND transactions.deleted_at IS NULL
        AND transactions.amount_cents > 0
    ), 0),
    payments_cents = COALESCE((
      SELECT SUM(transactions.amount_cents)
      FROM credit_card_invoice_items items
      JOIN transactions ON transactions.id = items.transaction_id
      WHERE items.invoice_id = credit_card_invoices.id
        AND items.line_kind = 'payment'
        AND transactions.deleted_at IS NULL
        AND transactions.amount_cents > 0
    ), 0),
    total_cents = COALESCE((
      SELECT SUM(CASE
        WHEN items.line_kind = 'purchase' AND transactions.amount_cents < 0
          THEN -transactions.amount_cents
        WHEN items.line_kind = 'refund' AND transactions.amount_cents > 0
          THEN -transactions.amount_cents
        ELSE 0
      END)
      FROM credit_card_invoice_items items
      JOIN transactions ON transactions.id = items.transaction_id
      WHERE items.invoice_id = credit_card_invoices.id
        AND transactions.deleted_at IS NULL
    ), 0)
WHERE id IN (SELECT keeper_id FROM invoice_merge_groups_0030);

DROP TABLE invoice_item_move_0030;
DROP TABLE invoice_merge_map_0030;
DROP TABLE invoice_merge_groups_0030;
