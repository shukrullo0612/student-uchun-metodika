ALTER TABLE wordwall_sets
ADD COLUMN IF NOT EXISTS pin VARCHAR(5);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wordwall_sets_pin ON wordwall_sets(pin);
