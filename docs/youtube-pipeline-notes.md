# YouTube Pipeline — Session Notes

## What worked first try

- **yt-dlp for both metadata and captions.** Skipped the YouTube Data API entirely — `yt-dlp --dump-json` gives metadata (title, upload date, channel, description, duration) and `--write-auto-sub --sub-format json3` gives timestamped captions. No API key needed, no OAuth complexity. One dependency, two calls, done.
- **Registry + orchestrator routing.** Adding YouTube to `detectTranscriptSource()` and the scraper array was all that was needed — the orchestrator, clean, entities, and bullets steps all worked without modification.
- **Bullets prompt (YouTube variant).** `GENERATE_BULLETS_PROMPT_YOUTUBE` was already in place and produced 9 bullets with `timestamp_seconds` and `timestamp_display` populated correctly.
- **Entity extraction.** Source-agnostic as expected. Extracted 12 fund names, 5 key people, 36 sectors from the Yale/Tim Sullivan episode.
- **Speaker detection from metadata.** Known host map for "Capital Allocators with Ted Seides" and title pattern "Tim Sullivan - ..." correctly identified both speakers.

## What needed attention

- **Speaker attribution in cleaned transcript.** The clean step removed `>>` markers and fillers but did NOT add speaker labels (Ted Seides / Tim Sullivan). The single generic `CLEAN_TRANSCRIPT_PROMPT` doesn't instruct the LLM to attempt attribution from context. A YouTube-specific cleaning prompt that passes speaker names and instructs attribution would improve this. Low priority — bullets and entities still work fine without it.
- **Turns parsing.** `parseTurns()` expects `SpeakerName:\ntext` format. YouTube raw transcripts use `[MM:SS] text` format, so all content ends up in a single turn with empty speaker. Not a problem for the pipeline, but the transcript viewer UI won't show per-turn navigation. Fix: re-run `parseTurns` on cleaned transcript after speaker attribution is working.
- **Guest affiliation extraction.** The regex-based affiliation extractor couldn't parse "Tim Sullivan, who recently retired from overseeing Yale University's private market portfolios" — the sentence structure is too complex. Best-effort is fine; the LLM entity extraction step correctly identified Yale as the primary fund.
- **Entity extraction minor error.** LLM labeled Tim Sullivan as "Tim Reilly" in key_people (hallucination). Entity extraction is best-effort and this is a known ~20% failure rate per PRD.

## Test results

- **Test URL:** https://www.youtube.com/watch?v=Z6i-6DXsYe4
- **Video:** Tim Sullivan - Yale's Private Portfolio (EP.456), Capital Allocators
- **Caption segments:** 2,523
- **Raw transcript:** 92,739 chars
- **Cleaned transcript:** 85,048 chars
- **Processing time:** ~12 minutes (extract ~30s, clean ~5min, entities ~3min, bullets ~3min)
- **Fund names extracted:** Yale University Endowment, Sequoia Capital, Kleiner Perkins, Mayfield, KKR, and 7 others
- **Bullets generated:** 9 with timestamps, 1 Rowspace angle

## Follow-up items

1. **YouTube-specific clean prompt** — pass known speakers, instruct LLM to attribute from context
2. **Re-parse turns from cleaned transcript** — once speaker attribution works
3. **`generateSections()`** — synthetic sections for YouTube (no HTML sections)
4. **Timestamp → turn mapping** — `turns[].timestamp_seconds` after sections work
5. **Whisper/AssemblyAI fallback** — for videos without captions (not needed for this test URL)
