-- Passages: topic-coherent segments within speaker turns.
-- Powers highlight reels (timestamp-based playback) and cross-call topic search.

CREATE TABLE IF NOT EXISTS passages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appearance_id UUID NOT NULL REFERENCES appearances(id) ON DELETE CASCADE,

  -- Position within appearance
  passage_index INTEGER NOT NULL,
  turn_index INTEGER,

  -- Timestamps (inherited from caption segments, never LLM-generated)
  start_time DOUBLE PRECISION NOT NULL,
  end_time DOUBLE PRECISION NOT NULL,

  -- Content
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  cleaned_text TEXT,

  -- Classification
  topic_tags TEXT[] NOT NULL DEFAULT '{}',
  signal_score TEXT NOT NULL DEFAULT 'context'
    CHECK (signal_score IN ('filler', 'context', 'insight')),

  -- Source reference (for debugging / reprocessing)
  start_segment INTEGER NOT NULL,
  end_segment INTEGER NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (appearance_id, passage_index)
);

-- Cross-call topic search: "find all passages tagged 'data integration'"
CREATE INDEX idx_passages_topic_tags ON passages USING GIN (topic_tags);

-- Per-appearance lookup: "get all passages for this appearance, ordered"
CREATE INDEX idx_passages_appearance ON passages (appearance_id, passage_index);

-- Signal filtering: "get only insight-level passages"
CREATE INDEX idx_passages_signal ON passages (appearance_id, signal_score);

-- Enable RLS
ALTER TABLE passages ENABLE ROW LEVEL SECURITY;

-- Service role: full access (mirrors "Service role full access on appearances")
CREATE POLICY "Service role full access on passages"
  ON passages FOR ALL
  USING (true)
  WITH CHECK (true);

-- Anon key: read access only (mirrors "Anon read access on appearances")
-- Passages are service-role write only — no anon insert/update needed
CREATE POLICY "Anon read access on passages"
  ON passages FOR SELECT
  USING (true);

-- Auto-update updated_at on row changes
CREATE TRIGGER passages_updated_at
  BEFORE UPDATE ON passages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
