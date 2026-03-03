-- Tighten anon RLS policies — restrict write access to service role only.
-- Anon key retains read access; insert/update limited to appearances only
-- (URL submission and vote updates from UI).

-- Drop overly permissive anon write policies
DROP POLICY IF EXISTS "Anon insert on appearances" ON appearances;
DROP POLICY IF EXISTS "Anon update on appearances" ON appearances;
DROP POLICY IF EXISTS "Anon insert on fund_overview_cache" ON fund_overview_cache;
DROP POLICY IF EXISTS "Anon update on fund_overview_cache" ON fund_overview_cache;

-- Anon: insert appearances only with queued status (URL submission)
CREATE POLICY "Anon insert queued appearances"
  ON appearances FOR INSERT
  WITH CHECK (processing_status = 'queued');

-- Anon: update only vote-related fields (prep_bullets JSONB) — no status mutation.
-- PostgREST doesn't support column-level RLS, so we restrict to rows that are complete.
CREATE POLICY "Anon update complete appearances"
  ON appearances FOR UPDATE
  USING (processing_status = 'complete')
  WITH CHECK (processing_status = 'complete');

-- Fund overview cache: service role only (no anon writes)
-- Service role policy from 001 already covers this.
