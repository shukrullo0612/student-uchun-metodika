ALTER TABLE wordwall_sets
ADD COLUMN IF NOT EXISTS clue_mode VARCHAR(20);

UPDATE wordwall_sets
SET clue_mode = 'without'
WHERE clue_mode IS NULL OR clue_mode = '';
