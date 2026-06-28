CREATE TABLE user_profiles (
  id TEXT PRIMARY KEY CHECK(id = 'primary'),
  display_name TEXT NOT NULL,
  monthly_income_cents INTEGER,
  income_day INTEGER CHECK(income_day IS NULL OR (income_day BETWEEN 1 AND 31)),
  financial_goal TEXT CHECK(financial_goal IS NULL OR financial_goal IN (
    'organize','emergency_fund','pay_debt','save','invest'
  )),
  onboarding_completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO categories(id,parent_id,name,color,icon,kind,sort_order,is_system)
VALUES('opening-balance','transfers','Ajuste de saldo inicial','#789189','scale','transfer',145,1);
