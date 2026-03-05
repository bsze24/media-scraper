ALTER TABLE appearances
  ADD COLUMN IF NOT EXISTS prompt_context_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS bullets_generated_at TIMESTAMPTZ;
