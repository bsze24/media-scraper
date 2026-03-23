# Session Summary: Transcript Viewer Redesign

**Date:** March 23, 2026  
**Branch:** `transcript-viewer-design`  
**PR:** #36  
**Participants:** User (bsze24), v0, Claude Code (briefly)

---

## Entry Point

User shared two design reference files:
1. **HTML mockup** from Google Stitch - a transcript viewer with 3-column layout
2. **DESIGN.md** - "Professional Brutalism" design spec with warm neutrals, Manrope/Inter fonts, "no-line rule" (tonal shifts vs borders)
3. **Screenshot** of "Archivist Intelligence" interface showing the target UX

User asked: *"Is there a formal place for me to drop files like this?"*

**Decision:** Chat window is fine for sharing; suggested `docs/` folder for persistent design docs.

---

## Workflow Discussion

User asked about the best workflow for design iteration.

**Options Presented:**
- **A.** Build 5 quick prototype versions (real pages)
- **B.** Describe 5 directions in detail (text-based)
- **C.** Build one strong interpretation and iterate

**Decision:** Option A - build 5 real prototype pages to click through.

---

## Design Exploration (5 Prototypes)

Created 5 distinct design directions at `/design-options/[1-5]`:

| # | Name | Direction |
|---|------|-----------|
| 1 | Faithful Stitch | Closest to reference - 3 columns, warm cream, full features |
| 2 | Ultra-Minimal | Bloomberg-inspired, pure white, two columns |
| 3 | Dark Terminal | Trading terminal aesthetic, dark mode, cyan accents |
| 4 | Bold Brutalist | DESIGN.md aligned - warm grays, amber accents, no borders |
| 5 | Soft Modern SaaS | Contemporary rounded style, indigo accents |

**Issue:** Initial route `/transcript/designs` 404'd because the `[id]` dynamic route was catching "designs" as an ID.

**Fix:** Moved prototypes to `/design-options/[1-5]`.

---

## Design Selection & Iteration

**User Choice:** Option 3 (Dark Terminal) - loved the information density.

### Iteration 1: Initial Feedback
User feedback on Option 3:
- Kill the Entity Graph
- Hate "AI Insights" as section title
- Keep: Key Takeaways, Rowspace Angles, Related Content
- Neon coloring is grating

**Changes Made:**
- Removed Entity Graph
- Renamed sections properly
- Softened palette: cyan (`#0ff`) → amber/gold (`#d4a853`)

### Iteration 2: Light Mode + Alignment
User feedback:
- Switch to light mode
- Speaker name/title alignment is off
- Rowspace Angles doesn't have tags yet - use bullet-quote format
- Related Content should auto-collapse if empty
- Where's the regenerate bullets button?

**Changes Made:**
- Light mode: warm whites (`#faf9f7`), amber accent (`#b8860b`)
- Fixed speaker alignment (name + title stack properly)
- Simplified Rowspace Angles to bullet-quote format
- Added collapsible Related Content
- Added regenerate button to both sections

### Iteration 3: Single Regenerate Button
User clarification: Only one regenerate button exists that does both takeaways and angles.

**Change:** Consolidated to single "Regenerate Bullets" button at top of right sidebar.

---

## Implementation

User approved Option 3 (light mode variant). Implementation scope:

1. Update `globals.css` with design tokens
2. Refactor `TranscriptViewer.tsx` - 3-column layout
3. Restyle all components to match Option 3

**Key Implementation Details:**
- 3-column grid: 220px | 1fr | 300px
- Color palette: cream backgrounds, amber accents, warm grays
- Typography: clean hierarchy with uppercase labels
- Video expand pushes content down (not overlay)

---

## Post-Implementation Refinements

### Turn Alignment Issues
User feedback: Too much vertical space, horizontal alignment weird with name/title/quote/button all misaligned.

**Fix:** 
- Changed `p-4` to `py-3 px-4` (tighter vertical)
- Changed `mb-2` to `mb-1`
- Removed `pl-[52px]` indent on text
- Put timestamp, name, title all on one baseline

### "Full Text" Button UX
User: The button is unclear and takes up vertical space.

**Options Presented:**
| Option | Description | Bug Risk |
|--------|-------------|----------|
| A | Ellipsis inline (`...`) | Medium |
| B | Hover reveal | Low (but bad mobile UX) |
| C | Small icon (chevron) | Low |
| D | Click-to-expand text | Medium (text selection conflict) |

**Decision:** Option A (inline ellipsis)

**Later Feedback:** `...` too subtle.

**Options for Prominence:**
| Option | Description |
|--------|-------------|
| A | Bracketed: `[...]` or `[more]` |
| B | Always colored (amber) |
| C | Pill/badge style |
| D | Arrow icon |
| E | Underlined |
| F | Bracketed + colored |

**Final Decision:** `[more]`/`[less]` in amber with underline on hover (implemented via Claude Code).

### Terminology Alignment
User: "(AI)" for sections and "(inferred)" for speakers is inconsistent.

**Decision:** Unified to `(auto)` for both.

### Logo
User requested Rowspace logo for top left.

**Change:** Replaced "ARCHIVIST" with "ROWSPACE" text wordmark.

### "(inferred speakers)" Placement
User: Too ambiguous and in weird place.

**Fix:** Moved from episode header to directly under "Speakers" label as `(auto)`.

---

## Build Issues

### Type Error: `category` Property
Vercel deployment failed:
```
Property 'category' does not exist on type '{ text: string; supporting_quotes: ... }'
```

**Cause:** Design prototype assumed `prep_bullets` had a `category` field to distinguish takeaways vs angles. The actual type doesn't have this.

**Fix:** Replaced Rowspace Angles filtering with "Coming soon" placeholder.

---

## Final Fix: Video Expand Behavior
User: Video overlay blocks content underneath.

**Fix:** Changed from `sticky top-0 z-40` to `flex-shrink-0` so video pushes transcript down in normal document flow.

---

## Cleanup

Deleted all prototype files before PR:
- `/src/app/design-options/page.tsx`
- `/src/app/design-options/[1-5]/page.tsx`

---

## Files Changed

| File | Change Type |
|------|-------------|
| `src/app/globals.css` | Modified - new design tokens |
| `src/app/transcript/[id]/TranscriptViewer.tsx` | Major rewrite - 3-column layout, new styling |
| `src/app/design-options/**` | Created then deleted (prototypes) |

---

## Key Design Decisions Summary

| Decision | Choice |
|----------|--------|
| Layout | 3-column (sidebar / transcript / insights) |
| Color mode | Light with warm cream backgrounds |
| Accent color | Amber/gold (`#b8860b`) |
| Expand indicator | `[more]`/`[less]` in amber |
| Auto-generated label | `(auto)` for both sections and speakers |
| Video expand | Pushes content down (not overlay) |
| Regenerate button | Single button for both takeaways + angles |
| Rowspace Angles | "Coming soon" (needs `category` field in data model) |

---

## Future Work

1. **Rowspace Angles** - Requires adding `category` field to `prep_bullets` type to distinguish takeaways from angles
2. **Logo** - Currently text wordmark; could add actual logo asset
3. **ICP-specific tags** - User mentioned targeting multiple ICPs for angles "some day"

---

## Visual References

*Note: Screenshots and HTML mockups were shared in chat but cannot be embedded in markdown.*

- **Reference:** Google Stitch / "Archivist Intelligence" transcript viewer
- **Chosen Direction:** Option 3 (Dark Terminal) converted to light mode
- **Final Aesthetic:** Professional, information-dense, warm neutral palette with amber accents
