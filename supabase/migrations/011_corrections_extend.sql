-- Extend corrections table for speaker renames (turn_index nullable) and role changes
-- Deployed after 005_corrections.sql which created the table with turn_index NOT NULL
-- and field CHECK ('speaker', 'text') only.

-- 1. Allow turn_index to be null (speaker renames affect all turns, not a specific one)
ALTER TABLE corrections ALTER COLUMN turn_index DROP NOT NULL;

-- 2. Expand field CHECK to include 'role'
ALTER TABLE corrections DROP CONSTRAINT corrections_field_check;
ALTER TABLE corrections ADD CONSTRAINT corrections_field_check
  CHECK (field IN ('speaker', 'text', 'role'));
