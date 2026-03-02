-- Meeting Prep Tool — Initial Schema
-- Phase 0: appearances, fund_overview_cache, domain_mapping

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- APPEARANCES TABLE
-- ============================================
CREATE TABLE appearances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL UNIQUE,
  transcript_source TEXT NOT NULL CHECK (transcript_source IN (
    'colossus', 'capital_allocators', 'acquired', 'odd_lots',
    'youtube_captions', 'youtube_whisper', 'manual', 'other'
  )),
  source_name TEXT,
  title TEXT,
  appearance_date DATE,
  speakers JSONB DEFAULT '[]',
  raw_transcript TEXT,
  raw_caption_data JSONB,
  cleaned_transcript TEXT,
  entity_tags JSONB DEFAULT '{}',
  prep_bullets JSONB DEFAULT '{}',
  processing_status TEXT NOT NULL DEFAULT 'queued' CHECK (processing_status IN (
    'queued', 'extracting', 'cleaning', 'analyzing', 'complete', 'failed'
  )),
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Full-text search vector, auto-generated from cleaned_transcript
  transcript_search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', COALESCE(cleaned_transcript, ''))
    ) STORED
);

-- Indexes
CREATE INDEX idx_appearances_source_url ON appearances (source_url);
CREATE INDEX idx_appearances_transcript_source ON appearances (transcript_source);
CREATE INDEX idx_appearances_processing_status ON appearances (processing_status);
CREATE INDEX idx_appearances_appearance_date ON appearances (appearance_date DESC NULLS LAST);
CREATE INDEX idx_appearances_created_at ON appearances (created_at DESC);

-- GIN index for full-text search
CREATE INDEX idx_appearances_transcript_search ON appearances
  USING GIN (transcript_search_vector);

-- GIN index for JSONB entity_tags (supports @> containment queries)
CREATE INDEX idx_appearances_entity_tags ON appearances
  USING GIN (entity_tags jsonb_path_ops);

-- GIN index for speakers JSONB (supports @> containment queries)
CREATE INDEX idx_appearances_speakers ON appearances
  USING GIN (speakers jsonb_path_ops);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appearances_updated_at
  BEFORE UPDATE ON appearances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


-- ============================================
-- FUND OVERVIEW CACHE TABLE
-- ============================================
CREATE TABLE fund_overview_cache (
  fund_name TEXT PRIMARY KEY,
  overview_text TEXT NOT NULL,
  appearance_ids UUID[] DEFAULT '{}',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fund_overview_cache_generated_at
  ON fund_overview_cache (generated_at DESC);


-- ============================================
-- DOMAIN MAPPING TABLE (for future calendar integration)
-- ============================================
CREATE TABLE domain_mapping (
  domain TEXT PRIMARY KEY,
  fund_name TEXT NOT NULL,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_domain_mapping_fund_name
  ON domain_mapping (fund_name);


-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
-- v1 is internal. RLS structured for future multi-tenant tightening.

ALTER TABLE appearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_overview_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_mapping ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "Service role full access on appearances"
  ON appearances FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on fund_overview_cache"
  ON fund_overview_cache FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on domain_mapping"
  ON domain_mapping FOR ALL
  USING (true)
  WITH CHECK (true);

-- Anon key: read access
CREATE POLICY "Anon read access on appearances"
  ON appearances FOR SELECT
  USING (true);

CREATE POLICY "Anon read access on fund_overview_cache"
  ON fund_overview_cache FOR SELECT
  USING (true);

CREATE POLICY "Anon read access on domain_mapping"
  ON domain_mapping FOR SELECT
  USING (true);

-- Anon key: insert appearances (URL submission from UI)
CREATE POLICY "Anon insert on appearances"
  ON appearances FOR INSERT
  WITH CHECK (true);

-- Anon key: update appearances (vote fields, processing status)
CREATE POLICY "Anon update on appearances"
  ON appearances FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Anon key: fund overview cache writes
CREATE POLICY "Anon insert on fund_overview_cache"
  ON fund_overview_cache FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anon update on fund_overview_cache"
  ON fund_overview_cache FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- ============================================
-- ENABLE REALTIME (for processing status updates)
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE appearances;
