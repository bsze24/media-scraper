-- Corrections audit log: every human edit to a turn (speaker or text)
CREATE TABLE IF NOT EXISTS corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appearance_id   UUID NOT NULL REFERENCES appearances(id) ON DELETE CASCADE,
  turn_index      INT NOT NULL,
  field           TEXT NOT NULL CHECK (field IN ('speaker', 'text')),
  old_value       TEXT NOT NULL,
  new_value       TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('corrected', 'undone')),
  corrected_by    TEXT,          -- user identifier (Phase 3: wire to auth)
  corrected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_corrections_appearance ON corrections(appearance_id);
