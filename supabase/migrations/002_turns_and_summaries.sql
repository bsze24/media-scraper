-- Meeting Prep Tool — Turns & Summaries
-- Phase 0: Add structured turns and turn summaries to appearances

ALTER TABLE appearances ADD COLUMN turns JSONB;
ALTER TABLE appearances ADD COLUMN turn_summaries JSONB;

CREATE INDEX idx_appearances_turns ON appearances
  USING GIN (turns jsonb_path_ops);
