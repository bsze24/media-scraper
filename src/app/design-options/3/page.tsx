/**
 * OPTION 3: Dark Mode Professional (Refined)
 * 
 * Trading terminal / developer tools aesthetic with softer accents:
 * - Dark surfaces (charcoal, near-black)
 * - Warm amber/gold accent color (less aggressive than cyan)
 * - High information density
 * - Monospace elements for timestamps
 * - Speaker labels as colored pills
 * - Three-column with collapsible panels
 * - Right sidebar: Key Takeaways, Rowspace Angles, Related Content
 */

import Link from "next/link";

const mockSections = [
  { title: "Introduction & Context", time: "00:00", turns: 4 },
  { title: "The Private Credit Boom", time: "08:12", turns: 12, active: true },
  { title: "Insurance as Capital Source", time: "22:45", turns: 8 },
  { title: "Operational Alpha", time: "35:30", turns: 6 },
  { title: "Building the Platform", time: "48:10", turns: 5 },
];

const mockTakeaways = [
  {
    title: "Transition to Asset-Light Origination",
    time: "23:20",
    quote: "We are building a machine to manufacture investment grade credit at a scale the public markets can't match.",
  },
  {
    title: "The Athene Flywheel Effect",
    time: "22:45",
    quote: "Permanent capital allows for longer-duration yield capture without liquidity premiums.",
  },
  {
    title: "Operational Alpha via Mid-Cap Lenders",
    time: "35:30",
    quote: "Acquiring originators is better than participating in syndicates.",
  },
];

const mockAngles = [
  {
    tag: "PITCH HOOK",
    category: "INSTITUTIONAL",
    text: "Target pension funds struggling with IG yield; emphasize the \"Industrialized Credit\" framework.",
  },
  {
    tag: "REFRAMING",
    category: "COMPETITOR ANALYSIS",
    text: "Contrast Apollo's \"Fixed Income Replacement\" strategy vs Blackstone's \"Real Estate Heavy\" model.",
  },
];

const mockRelated = [
  { title: "Jon Gray (Blackstone) on Private Markets", subtitle: "ILB Episode #412" },
  { title: "The Evolution of Private Credit (Panel)", subtitle: "Mastering the Market Cycle" },
  { title: "Insurance as a Capital Weapon", subtitle: "Internal Research Memo" },
];

const mockTranscript = [
  {
    time: "22:45",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The misconception about Apollo is that we are simply an asset manager. In reality, we are a provider of retirement security services. The integration of Athene didn't just give us a balance sheet; it gave us a repeatable, low-cost capital engine that allows us to focus on the yield-generation side of the house without the volatility of constant fundraising.",
  },
  {
    time: "23:20",
    speaker: "Patrick O'Shaughnessy",
    role: "host",
    text: "How does that shift the internal culture? When you move from \"selling a fund\" to \"managing a permanent balance sheet,\" does the profile of the investment professional you hire change?",
    active: true,
  },
  {
    time: "24:10",
    speaker: "Marc Rowan",
    role: "guest",
    text: "It changes everything. We are no longer chasing the \"hot\" trade to mark up a fund for a subsequent fundraise. We are looking for 400 basis points of spread over 20 years. That requires an industrialized approach to credit. You need people who understand the plumbing of originations—whether it's fleet leasing, mid-market lending, or infrastructure—at scale.",
    cited: true,
  },
  {
    time: "25:55",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The market still thinks of private equity as \"leveraged buyouts.\" That's less than 20% of what we do now. The real story is the migration of investment grade credit from the public markets to private institutional hands.",
  },
];

export default function DesignOption3() {
  return (
    <div className="h-screen flex flex-col bg-[#0f0f0f] text-[#e5e5e5] overflow-hidden">
      {/* Navigation */}
      <nav className="fixed top-4 left-4 z-50">
        <Link
          href="/design-options"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a]/90 backdrop-blur border border-[#2a2a2a] text-xs font-medium text-[#888] hover:text-[#d4a853] hover:border-[#d4a853]/30 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Options
        </Link>
      </nav>

      {/* Header */}
      <header className="flex-shrink-0 h-12 px-4 flex items-center justify-between bg-[#0f0f0f] border-b border-[#1f1f1f]">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-wide text-[#d4a853]">
            ARCHIVIST
          </span>
          <div className="flex items-center gap-2 text-[11px] text-[#666]">
            <span className="font-mono text-[#555]">ILB-E542</span>
            <span className="text-[#333]">/</span>
            <span className="text-[#999]">Marc Rowan on Apollo&apos;s Evolution</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] border border-[#252525] text-xs text-[#666]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="font-mono text-[10px]">Search transcript</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: '220px 1fr 300px' }}>
        {/* Left Sidebar - Navigation */}
        <aside className="h-full bg-[#0f0f0f] flex flex-col border-r border-[#1a1a1a] overflow-y-auto">
          {/* Episode Meta */}
          <div className="px-4 py-4 border-b border-[#1a1a1a]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#555] mb-1">Source Series</div>
            <div className="text-[13px] font-medium text-[#ccc] mb-3">Invest Like the Best</div>
            
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#555] mb-1">Episode</div>
            <div className="text-[13px] font-medium text-[#ccc]">Marc Rowan on Apollo&apos;s Evolution</div>
          </div>

          {/* Speakers */}
          <div className="px-4 py-4 border-b border-[#1a1a1a]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#555] mb-3">Speakers</div>
            <div className="space-y-2">
              <button className="w-full flex items-center justify-between p-2 bg-[#1a1a1a] border border-[#252525] hover:border-[#d4a853]/30 transition-colors">
                <div>
                  <div className="text-[12px] font-medium text-[#d4a853]">Marc Rowan</div>
                  <div className="text-[10px] text-[#555]">CEO, Apollo Global Management</div>
                </div>
                <svg className="w-3.5 h-3.5 text-[#555]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button className="w-full flex items-center justify-between p-2 bg-[#141414] border border-[#1f1f1f] hover:border-[#333] transition-colors">
                <div>
                  <div className="text-[12px] text-[#888]">Patrick O&apos;Shaughnessy</div>
                  <div className="text-[10px] text-[#444]">Host</div>
                </div>
                <svg className="w-3.5 h-3.5 text-[#444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-[#1a1a1a]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#555] mb-2">Internal Search</div>
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input 
                type="text"
                placeholder="Find in transcript..."
                className="w-full bg-[#141414] border border-[#1f1f1f] text-[12px] text-[#999] placeholder:text-[#444] py-2 pl-8 pr-3 focus:outline-none focus:border-[#d4a853]/30"
              />
            </div>
          </div>

          {/* Sections */}
          <div className="px-4 py-3 flex-1">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[#555]">Sections</div>
              <div className="flex items-center gap-1">
                <button className="w-5 h-5 flex items-center justify-center text-[#555] hover:text-[#999] hover:bg-[#1a1a1a] transition-colors">
                  <span className="text-sm">+</span>
                </button>
                <button className="w-5 h-5 flex items-center justify-center text-[#555] hover:text-[#999] hover:bg-[#1a1a1a] transition-colors">
                  <span className="text-sm">−</span>
                </button>
              </div>
            </div>
            <div className="space-y-0.5">
              {mockSections.map((s, i) => (
                <button
                  key={i}
                  className={`w-full text-left p-2.5 transition-all ${
                    s.active
                      ? 'bg-[#1a1a1a] border-l-2 border-[#d4a853]'
                      : 'hover:bg-[#141414] border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-[12px] leading-snug ${s.active ? 'text-[#e5e5e5]' : 'text-[#888]'}`}>
                      {s.title}
                    </span>
                    <span className="text-[10px] font-mono text-[#555] whitespace-nowrap">
                      {s.time}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-[#1a1a1a]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#d4a853]" />
              <span className="text-[10px] text-[#555]">Cited in Takeaways</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6b9dc8]" />
              <span className="text-[10px] text-[#555]">Search Match</span>
            </div>
          </div>

          {/* Export */}
          <div className="px-4 py-3 border-t border-[#1a1a1a]">
            <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#1a1a1a] border border-[#252525] text-[11px] font-medium text-[#888] hover:text-[#d4a853] hover:border-[#d4a853]/30 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Archive
            </button>
          </div>
        </aside>

        {/* Center: Transcript */}
        <section className="h-full bg-[#0a0a0a] overflow-y-auto flex flex-col">
          {/* Video Controls */}
          <div className="sticky top-0 z-40 bg-[#0f0f0f]/95 backdrop-blur p-3 flex items-center gap-4 border-b border-[#1a1a1a]">
            <div className="w-20 h-12 bg-[#141414] border border-[#1f1f1f] flex items-center justify-center">
              <svg className="w-6 h-6 text-[#555]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <button className="w-8 h-8 flex items-center justify-center text-[#888] hover:text-[#d4a853] transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                </button>
                <span className="text-[11px] font-mono text-[#d4a853]">23:14</span>
                <div className="flex-1 h-1 bg-[#1a1a1a] relative rounded-full overflow-hidden">
                  <div className="absolute top-0 left-0 h-full w-[41%] bg-[#d4a853]/60" />
                  <div className="absolute top-0 left-[41%] w-1.5 h-full bg-[#d4a853] rounded-full" />
                </div>
                <span className="text-[11px] font-mono text-[#555]">56:42</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[#555]">
              <button className="text-[10px] font-mono hover:text-[#d4a853] transition-colors px-2 py-1 bg-[#141414] border border-[#1f1f1f]">1.25x</button>
              <button className="hover:text-[#d4a853] transition-colors" title="Expand video">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Transcript */}
          <div className="flex-1 px-6 py-5 space-y-1">
            {mockTranscript.map((turn, i) => (
              <div
                key={i}
                className={`group relative p-4 transition-all ${
                  turn.active
                    ? 'bg-[#d4a853]/5 border-l-2 border-[#d4a853]'
                    : turn.cited
                    ? 'bg-[#141414] border-l-2 border-[#d4a853]/40 hover:bg-[#1a1a1a]'
                    : 'hover:bg-[#111] border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <button 
                    className="text-[10px] font-mono text-[#555] hover:text-[#d4a853] transition-colors"
                    title="Jump to timestamp"
                  >
                    {turn.time}
                  </button>
                  <span className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    turn.role === 'host'
                      ? 'bg-[#1a1a1a] text-[#666]'
                      : 'bg-[#d4a853]/10 text-[#d4a853]'
                  }`}>
                    {turn.speaker}
                  </span>
                  {turn.cited && (
                    <span className="flex items-center gap-1 text-[9px] text-[#d4a853]/60">
                      <span className="w-1 h-1 rounded-full bg-[#d4a853]" />
                      cited
                    </span>
                  )}
                </div>
                <p className={`text-[14px] leading-[1.7] ${
                  turn.role === 'host' ? 'text-[#777] italic' : 'text-[#bbb]'
                }`}>
                  {turn.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Right Sidebar */}
        <aside className="h-full bg-[#0f0f0f] flex flex-col border-l border-[#1a1a1a] overflow-y-auto">
          {/* Key Takeaways */}
          <div className="p-4 border-b border-[#1a1a1a]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#555]">Key Takeaways</span>
              <button className="text-[10px] text-[#555] hover:text-[#d4a853] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              {mockTakeaways.map((t, i) => (
                <div key={i} className="p-3 bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#252525] transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[12px] font-medium text-[#ccc] leading-snug">{t.title}</span>
                    <button className="text-[9px] font-mono text-[#555] hover:text-[#d4a853] whitespace-nowrap transition-colors">[{t.time}]</button>
                  </div>
                  <p className="text-[11px] text-[#666] italic leading-relaxed">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Rowspace Angles */}
          <div className="p-4 border-b border-[#1a1a1a]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#555]">Rowspace Angles</span>
              <button className="text-[#555] hover:text-[#d4a853] transition-colors" title="Audio summary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              {mockAngles.map((a, i) => (
                <div key={i} className="p-3 bg-[#0a0a0a] border border-[#1a1a1a]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-1.5 py-0.5 text-[9px] font-medium bg-[#d4a853]/10 text-[#d4a853]">{a.tag}</span>
                    <span className="text-[9px] text-[#555]">{a.category}</span>
                  </div>
                  <p className="text-[11px] text-[#888] leading-relaxed">{a.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Related Content */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#555]">Related Content</span>
              <button className="text-[#555] hover:text-[#d4a853] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>
            </div>
            <div className="space-y-2">
              {mockRelated.map((r, i) => (
                <button key={i} className="w-full text-left p-3 bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#252525] transition-colors">
                  <div className="text-[12px] text-[#999] leading-snug mb-0.5">{r.title}</div>
                  <div className="text-[10px] text-[#555]">{r.subtitle}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>

      {/* Design Label */}
      <div className="fixed bottom-4 right-4 bg-[#d4a853] text-[#0f0f0f] px-3 py-1.5 text-xs font-semibold">
        Option 3: Dark Professional
      </div>
    </div>
  );
}
