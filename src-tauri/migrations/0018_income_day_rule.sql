ALTER TABLE user_profiles
ADD COLUMN income_day_rule TEXT
CHECK(income_day_rule IS NULL OR income_day_rule = 'fifth_business_day');
