ALTER TABLE transactions ADD COLUMN display_description TEXT;
ALTER TABLE transactions ADD COLUMN merchant_identification_status TEXT NOT NULL DEFAULT 'legacy'
  CHECK(merchant_identification_status IN ('legacy', 'identified', 'pending', 'confirmed'));

CREATE INDEX transactions_pending_merchant
  ON transactions(merchant_identification_status, date)
  WHERE deleted_at IS NULL AND merchant_identification_status = 'pending';

-- Classify the most common generic labels during the migration itself.
-- Startup maintenance applies the shared conservative classifier to other historical variants.
UPDATE transactions
SET merchant_key = NULL,
    merchant_identification_status = 'pending'
WHERE import_batch_id IS NOT NULL
  AND normalized_description IN (
    'PIX EMITIDO OUTRA IF',
    'PIX EMIT OUT IF',
    'PIX RECEBIDO OUTRA IF',
    'PIX RECEB OUT IF'
  );
