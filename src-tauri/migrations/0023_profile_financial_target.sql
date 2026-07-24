-- Mantém uma única meta de economia como fonte canônica do objetivo mensal do perfil.
ALTER TABLE financial_targets
ADD COLUMN is_profile_target INTEGER NOT NULL DEFAULT 0
CHECK(is_profile_target IN (0, 1));

UPDATE financial_targets
SET is_profile_target = 1
WHERE id = (
    SELECT id
    FROM financial_targets
    WHERE kind = 'savings' AND enabled = 1 AND deleted_at IS NULL
    ORDER BY created_at, id
    LIMIT 1
);

INSERT INTO financial_targets(
    id, kind, category_id, amount_cents, enabled, is_profile_target
)
SELECT
    'profile-monthly-savings',
    'savings',
    NULL,
    monthly_target_cents,
    1,
    1
FROM user_profiles
WHERE id = 'primary'
  AND monthly_target_cents IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM financial_targets WHERE is_profile_target = 1
  );

UPDATE user_profiles
SET monthly_target_cents = (
    SELECT amount_cents
    FROM financial_targets
    WHERE is_profile_target = 1 AND deleted_at IS NULL
    LIMIT 1
)
WHERE id = 'primary'
  AND EXISTS (
      SELECT 1 FROM financial_targets
      WHERE is_profile_target = 1 AND deleted_at IS NULL
  );

CREATE UNIQUE INDEX financial_targets_single_profile_target
ON financial_targets(is_profile_target)
WHERE is_profile_target = 1 AND deleted_at IS NULL;
