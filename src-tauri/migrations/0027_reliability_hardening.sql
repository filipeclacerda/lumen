-- Reliability hardening for reconciliation, profile savings identity, and account history reads.

-- Zero is the explicit mirror value when the canonical savings target is inactive.
CREATE TABLE user_profiles_0027 (
  id TEXT PRIMARY KEY CHECK(id = 'primary'),
  display_name TEXT NOT NULL,
  monthly_income_cents INTEGER,
  income_day INTEGER CHECK(income_day IS NULL OR (income_day BETWEEN 1 AND 31)),
  financial_goal TEXT CHECK(financial_goal IS NULL OR financial_goal IN (
    'organize','emergency_fund','pay_debt','save','invest'
  )),
  onboarding_completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  income_day_rule TEXT CHECK(income_day_rule IS NULL OR income_day_rule = 'fifth_business_day'),
  monthly_target_cents INTEGER CHECK(monthly_target_cents IS NULL OR monthly_target_cents >= 0),
  onboarding_start_mode TEXT CHECK(onboarding_start_mode IS NULL OR onboarding_start_mode IN ('import','manual','tour'))
);
INSERT INTO user_profiles_0027
SELECT id,display_name,monthly_income_cents,income_day,financial_goal,onboarding_completed_at,
       created_at,updated_at,income_day_rule,monthly_target_cents,onboarding_start_mode
FROM user_profiles;
DROP TABLE user_profiles;
ALTER TABLE user_profiles_0027 RENAME TO user_profiles;

-- Keep the most recently created checkpoint for each account/day before enforcing the upsert key.
DELETE FROM account_balance_checkpoints
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY account_id, as_of_date
      ORDER BY created_at DESC, id DESC
    ) AS position
    FROM account_balance_checkpoints
  ) ranked
  WHERE position > 1
);

DROP INDEX IF EXISTS account_balance_checkpoints_account_date;
CREATE UNIQUE INDEX account_balance_checkpoints_account_date_unique
  ON account_balance_checkpoints(account_id, as_of_date);
CREATE INDEX account_balance_checkpoints_latest
  ON account_balance_checkpoints(account_id, as_of_date DESC, created_at DESC, id DESC);

-- Reuse a durable savings identity in every legacy state: active first, then the
-- previously marked row, then any savings row (including disabled/archived).
CREATE TEMP TABLE profile_target_0027(id TEXT PRIMARY KEY);
INSERT INTO profile_target_0027(id)
SELECT id
FROM financial_targets
WHERE kind = 'savings'
ORDER BY CASE
           WHEN enabled = 1 AND deleted_at IS NULL THEN 0
           WHEN is_profile_target = 1 THEN 1
           ELSE 2
         END,
         created_at,
         id
LIMIT 1;

UPDATE financial_targets SET is_profile_target = 0 WHERE is_profile_target = 1;
UPDATE financial_targets
SET is_profile_target = 1
WHERE id = (SELECT id FROM profile_target_0027 LIMIT 1);
DROP TABLE profile_target_0027;

DROP INDEX IF EXISTS financial_targets_single_profile_target;
CREATE UNIQUE INDEX financial_targets_single_profile_target
  ON financial_targets(is_profile_target)
  WHERE is_profile_target = 1;

ALTER TABLE category_merge_log
  ADD COLUMN archived_targets INTEGER NOT NULL DEFAULT 0;

-- Used by checkpoint-based reconciliation and net-worth history scans.
CREATE INDEX transactions_account_cleared_date
  ON transactions(account_id, date)
  WHERE deleted_at IS NULL AND status = 'cleared';
