ALTER TABLE user_profiles
ADD COLUMN monthly_target_cents INTEGER
CHECK(monthly_target_cents IS NULL OR monthly_target_cents > 0);

ALTER TABLE user_profiles
ADD COLUMN onboarding_start_mode TEXT
CHECK(onboarding_start_mode IS NULL OR onboarding_start_mode IN ('import','manual','tour'));
