# Session Log: 2026-03-27 — Transcript Viewer Polish + Keyboard Remapping

**Date:** March 27, 2026
**Branch:** `feat/shortcut-affordances`
**Commit:** `9f55b3f` — `feat: spatial shortcut badges, remove shortcuts bar, video mode toggles`
**Type:** Implementation + Chrome MCP QA
**Tag:** #Session

---

## Context

Entered with Phase 1E shipped, all PRs merged through #57. Two UX bugs fixed at session start (reelInfoBlock not rendering in normal mode, speaker filter not entering highlight mode), then moved into a prompted shortcut discoverability redesign.

---

## What Was Built

### Bug fixes (pre-feature, included in commit)

1. **reelInfoBlock always renders** — was gated behind `isHighlightMode`, now shows `fullCallLabel` (e.g. "54 min full call") in normal mode too.
2. **Speaker filter sets highlight mode** — clicking a speaker now calls `setIsHighlightMode(true)`, enabling duration display, save/reset controls.
3. **fullCallLabel separator** — removed hardcoded leading ` · ` from the memo; separator added inline only when both highlight and full-call labels are present.

### Shortcut affordances (main feature)

**Prompt:** `/Users/briansze/Downloads/next-session-ui-shortcuts-redesign.md`

#### 1. Universal badge class (`KBD_CLASS` in helpers.tsx)
- Single Tailwind class string for all keyboard shortcut badges
- `hidden md:inline-flex` — no badges on mobile
- Warmer/more visible than old `text-[#bbb]` speaker badges

#### 2. Shortcuts bar removed
- Deleted: `shortcutsBarVisible` state, localStorage effect, `contextBarShortcuts` useMemo, bar JSX, re-show `?` button, `md:pb-14` padding conditional
- Zero trace of the old bottom bar

#### 3. Inline turn badges (onboarding)
- `[m] expand/collapse`, `[x] hide`, `[t] jump` — right-aligned on active turn header
- j/k only (not clicks, not auto-follow) — `lastNavWasKeyboardRef` tracks source
- 5-activation limit via `kbdNavCount` in localStorage
- `[m]` label dynamic: "expand" when collapsed, "collapse" when expanded
- `[t]` conditional on `turn.timestamp_seconds != null`
- Decision: no `[j]`/`[k]` badges (implicit vim convention), no `[e]` (rare/admin)
- Label: `[t] jump` not "seek" (user feedback: "seek" is jargon)

#### 4. Section badges
- `[n] next` / `[p] prev` in sidebar SECTIONS header (permanent, next to +/- buttons)
- Also on active section heading in transcript area (only on section containing active turn)

#### 5. Video control strip badges
- Speed: `1.5x [</>]` — compact layout
- Follow: `[F] Follow ON/OFF` with proper kbd badge
- Mode switches: **rewritten as consistent toggles**
  - `[w]` = toggle collapsed ↔ full (arrow icon + kbd badge, gold highlight when active)
  - `[q]` = toggle off ↔ pip (arrow icon + kbd badge, gold highlight when active)
  - Both always visible in fixed positions (old behavior hid/showed different buttons per mode)
  - Keyboard handler updated: pure toggles, not cycling

#### 6. Reset/Save view badges
- Grouped together with `·` separator
- `[⇧R] Reset` and `[⌘S] Save/Update` (platform-aware modifier symbol)
- Shortened labels (was "Reset view" / "Save view")
- `text-[#666]` instead of `text-[#999]` — more prominent

#### 7. Help button moved to header
- `[?]` in top-right header bar next to date
- Visible on ALL pages (video and non-video)
- Removed from video control strip

#### 8. Highlight duration in header bar
- Gold `~41 min highlight` + muted `· 1 hr 28 min full call` in header
- Only shows in highlight mode
- Duration also stays in the video control strip reel info block

#### 9. Speaker panel badges unified
- `[1]`-`[9]` now use `KBD_CLASS` instead of old `text-[#bbb]` styling

---

## Key Decisions

### 1. No j/k in inline badges
**Decision:** Skip `[j]`/`[k]` from the onboarding badges.
**Why:** j/k for nav is a well-known vim/YouTube convention. Badge space better used for non-obvious turn actions.

### 2. "jump" not "seek"
**Decision:** `[t] jump` label.
**Why:** User feedback — "seek" is video-editor jargon. "jump" is plain language.

### 3. Video mode toggles, not cycling
**Decision:** `w` = pure toggle collapsed↔full, `q` = pure toggle off↔pip. Both buttons always visible.
**Why:** Old behavior showed/hid different buttons per mode (confusing — "both say q"). New toggle model: each button is a consistent on/off switch for its mode. Old arrow icons retained per user preference.

### 4. [?] in header, not video bar
**Decision:** Help button lives in the page header, not the video control strip.
**Why:** Help should be accessible on every page type (video, audio-only, no-video). The video bar is already crowded.

### 5. Highlight duration in header bar
**Decision:** Gold highlight duration in the top header next to the date.
**Why:** It's the most important info about the reel — what you've built. Shouldn't be buried in a crowded control strip. Duration also stays in the control strip for context.

---

## Chrome MCP QA Results

Full 11-test suite run against Apollo Eclipse (5 speakers, 15 sections), Sixth Street Demo (4 speakers), Capital Allocators (audio-first). All tests passed before the final round of nit fixes.

```
Test 1 (Badge consistency):     PASS
Test 2 (Bar removed):           PASS
Test 3 (Onboarding lifecycle):  PASS — 5 activations, localStorage persists
Test 4 (Trigger specificity):   PASS — click/auto-follow don't trigger
Test 5 (Dynamic [m] label):     PASS — expand/collapse flips correctly
Test 6 (Section badges):        PASS — permanent, not onboarding-gated
Test 7 (Video bar badges):      PASS
Test 8 (Reset/Save prominence): PASS
Test 9 (No-video appearance):   PASS
Test 10 (Mobile):               PASS — zero badge clutter
Test 11 (Adversarial):          PASS — rapid j/k/m/x clean
```

---

## Post-QA Nit Fixes (in same commit)

After QA, user requested 5 changes:
1. `[n]`/`[p]` badges added to sidebar SECTIONS header (not just transcript section headings)
2. Fixed duplicate `[q]` badges — close button was `[q]` when it should have been `[w]`; rewritten as toggle model
3. Video mode buttons: consistent toggle positioning (both always visible), active state highlight
4. Arrow icons restored (user preferred old icons over text labels)
5. `[?]` moved from video bar to header bar (more prominent, works on all pages)
6. Section badges got labels: `[n] next` / `[p] prev`
7. Reset/Save grouped together with `·` separator
8. Highlight duration added to header bar

**These changes have NOT been visually verified yet** — user hasn't seen the latest round in browser.

---

## Outstanding / Next Session

| Priority | Task | Status |
|----------|------|--------|
| 1 | Visual review of latest nit fixes | Need to check in browser |
| 2 | Verify highlight duration in header at different viewport widths | Untested |
| 3 | Check section badge crowding in narrow sidebar | Untested |
| 4 | PR creation | After visual review |
| 5 | CLAUDE.md update | After PR merge |

---

## Files Modified

- `src/app/transcript/[id]/helpers.tsx` — KBD_CLASS constant
- `src/app/transcript/[id]/TranscriptViewer.tsx` — bulk of changes (316 lines delta)
- `src/app/transcript/[id]/TurnRenderer.tsx` — showShortcutBadges prop + badge rendering
- `src/app/transcript/[id]/SpeakerPanel.tsx` — unified badge styling
- `src/app/transcript/[id]/page.tsx` — linter fix only

---

## Memory Updates

- Saved `project_passage_architecture.md` — pipeline direction shift
- Saved `project_product_leads.md` — Fay + sales person feedback
- Updated MEMORY.md current state (PRs merged through #57, passage pipeline next)

---

## Session 2: UI Polish + Keyboard Remapping (same day, continued)

**Branch:** `feat/shortcut-affordances` (continued)
**Type:** Polish, keyboard remapping, Chrome MCP QA

---

### Changes Made

#### Terminology
- **"full call" → "full video"** globally — `fullCallLabel`, control strip, header, help overlay
- **"Follow" → "Auto-Scroll"** — button text, tooltips, help overlay, comments

#### Sidebar Polish
- **Removed +/- buttons** from SECTIONS header (expand/collapse all sections)
- **SPEAKERS/SECTIONS headers** bumped from `text-[10px] font-medium` to `text-[11px] font-semibold` with more vertical spacing
- **Active section highlight** — section containing active turn gets warm tint (`bg-[#b8860b]/5`) with solid gold left border; other expanded sections get lighter border (`border-[#b8860b]/30`)

#### Header Bar Restructure
- **Reset/Save moved to header** next to `?` — extracted `headerActions` block with Reset, Save, Help grouped right of a `|` divider
- **Removed floating `·`** separator between Reset and Save
- **Tightened spacing** — `gap-0`, `px-1.5` on header action buttons
- **Highlight info** (gold duration + muted full video) left of divider; action buttons right
- **Non-highlight mode** — only `?` visible, Reset/Save absent

#### Control Strip Polish
- **Gold highlight text** in control strip matches header treatment (`font-medium text-[#b8860b]` for highlight, `text-[#bbb]` for full video)
- **Speed badges** — `[<] 1.5x [>]` layout (split into two flanking clickable badges)
- **Tighter spacing** — outer `gap-1.5`, inner icon buttons `gap-0.5`

#### Keyboard Shortcut Remapping

| Key | New Action | Was |
|-----|-----------|-----|
| `a` | Auto-scroll toggle | `f` |
| `⇧T` | Edit turn text | `e` |
| `⇧S` | Change turn speaker (re-attribute) | `a` |
| `⇧1-9` | Edit speaker name | `⇧A` |
| `⇧M` | Toggle all turns in current section | new |
| `⌘S` | Save view (unchanged) | `⌘S` |
| `⇧R` | Reset view (unchanged) | `⇧R` |

**Removed:** `f` (→ `a`), `e` (→ `⇧T`), `⇧A` (→ `⇧1-9`), `⇧E` (→ `⇧1-9`), `⇧X` (unhide all — `⇧R` covers it)

**Shift+number symbols:** Added explicit `case "!"` through `case "("` mapping since Shift+1-9 produces symbols on US keyboards.

#### Speaker Number Keys — Per-Speaker Toggle
- **1-9 = expand/collapse toggle** for that speaker's turns (majority-check: if >50% expanded, collapse all; else expand all)
- **Speaker highlight** (`activeSpeaker`) always set to toggled speaker; clears via Escape
- **Replaced old speaker filter** behavior (which hid/expanded turns and collapsed sections)
- Uses refs (`turnsRef`, `expandedTurnsRef`, `turnsBySectionRef`) to avoid changing useEffect dep array size

#### Section Navigation
- **Clicking sidebar section** now activates first visible turn in that section (sets `activeTurnIndex`, disables auto-follow)
- **`⇧M`** toggles expand/collapse all turns in active section — keyboard only, no visual badge (discoverable via `?` help)

#### Clear Saved View UX
- Shows "Cleared" text for 1 second before resetting view (less jarring than instant disappear)

#### Escape Priority Chain
- Added step 6: clears `activeSpeaker` highlight before clearing `activeTurnIndex`

---

### Key Decisions

#### 1. Shift = "edit" for text, "bulk" for toggle
`⇧T`/`⇧S`/`⇧1-9` are editing. `⇧M`/`⇧R` are bulk view actions. Shift consistently means "do more."

#### 2. `a` for auto-scroll, not `f`
`a` = **a**uto-scroll is more mnemonic. `f` freed up entirely. `a` was taken by re-attribute → moved to `⇧S`.

#### 3. ⌘S for save (not ⇧S)
Universal muscle memory. `⇧S` freed for change-speaker-on-turn. `⌘R` considered for reset but conflicts with browser reload.

#### 4. Section accordion kept, ⇧M has no visual badge
Tried putting `[⇧M] expand/collapse` on section headers — too crowded in all positions (inline with n/p, below heading). Chevron accordion is clean and useful. `⇧M` lives in `?` help overlay only.

#### 5. Dropped ⇧X (unhide all)
`⇧R` reset already unhides all turns. `⇧X` was redundant — one less shortcut to remember.

---

### Chrome MCP QA Results

Tested across 4 appearances: TA Associates (4 named speakers, YouTube), Charlie Puth (2 generic speakers, YouTube), Gavin Baker/Capital Allocators (Colossus, audio-only), Stanford Catchup (9 speakers, stress test).

```
Test 1  (New bindings work):         PASS — a, ⇧T, ⇧S, 1-9, ⇧1-9 all confirmed
Test 2  (Old bindings dead):         PASS — f, e, ⇧A, ⇧E all inert
Test 3  (Shift+number symbols):      PASS — ! through ( map correctly
Test 4  (Speaker toggle logic):      PASS — host/guest collapse/expand, majority logic
Test 5  (Escape chain order):        PASS — partial (speaker panel → highlight → active turn)
Test 6  (Section activates turn):    PASS — sidebar click scrolls + activates first turn
Test 7  (Terminology rename):        PASS — Auto-Scroll [A], full video everywhere
Test 8  (Header restructure):        PASS — Reset/Save/? grouped, divider, non-highlight clean
Test 9  (Sidebar buttons removed):   PASS — no +/-, bolder headers
Test 10 (Gold highlight text):       PASS — two-tone in header and control strip
Test 11 (Dep array performance):     PASS — build clean, no lag
```

**Note:** `⇧T` and `⇧S` couldn't be verified via Chrome MCP (YouTube iframe captures Shift+key). Code logic correct per source review.

---

### Files Modified (Session 2)

- `src/app/transcript/[id]/TranscriptViewer.tsx` — bulk of changes (keyboard handler, header, control strip, section highlight, clear view, ⇧M)
- `src/app/transcript/[id]/SpeakerPanel.tsx` — header styling (11px semibold, mb-3)

---

### Explored but Reverted

- **Section accordion replacement** — tried replacing chevron with `⇧M` expand/collapse button. Collapsing to summaries was noisier than hiding the section. Reverted to original chevron accordion.
- **`⇧M` visual badge on section header** — tried inline with `[n]`/`[p]` (too crowded), tried row below heading (too noisy). Settled on no visual badge — keyboard only, discoverable via `?`.
- **Speaker filter hiding non-matching turns** — tried hiding turns entirely when speaker filter active. User wanted per-speaker expand/collapse toggle instead.

---

### Outstanding / Next Session

| Priority | Task | Status |
|----------|------|--------|
| 1 | PR creation for this branch | Committed and pushed |
| 2 | Run migration `012_default_view_params.sql` on dev DB | Needed for save view |
| 3 | Tab cycling between speaker fields (name → title → role) for ⇧1-9 | Deferred |
| 4 | Playwright e2e tests before next refactor | Deferred |
