ALTER TABLE financial_targets
ADD COLUMN include_descendants INTEGER NOT NULL DEFAULT 0
CHECK(include_descendants IN (0, 1));
