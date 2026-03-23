/**
 * OPTION 3: Dark Mode Professional
 * 
 * Trading terminal / developer tools aesthetic:
 * - Dark surfaces (charcoal, near-black)
 * - Bright accent color for active states (cyan/teal)
 * - High information density
 * - Monospace elements for timestamps
 * - Speaker labels as colored pills
 * - Three-column with collapsible panels
 * - Subtle glow effects on interactive elements
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
    confidence: 94,
    quote: "We are building a machine to manufacture investment grade credit at a scale the public markets can't match.",
  },
  {
    title: "The Athene Flywheel Effect",
    time: "22:45",
    confidence: 89,
    quote: "Permanent capital allows for longer-duration yield capture without liquidity premiums.",
  },
  {
    title: "Operational Alpha via Mid-Cap Lenders",
    time: "35:30",
    confidence: 87,
    quote: "Acquiring originators is better than participating in syndicates.",
  },
];

const mockTranscript = [
  {
    time: "22:45",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The misconception about Apollo is that we are simply an asset manager. In reality, we are a provider of retirement security services. The integration of Athene didn't just give us a balance sheet; it gave us a repeatable, low-cost capital engine that allows us to focus on the yield-generation side of the house without the volatility of constant fundraising.",
    entities: ["Apollo", "Athene"],
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
    entities: ["400 basis points", "20 years"],
  },
  {
    time: "25:55",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The market still thinks of private equity as \"leveraged buyouts.\" That's less than 20% of what we do now. The real story is the migration of investment grade credit from the public markets to private institutional hands.",
    entities: ["20%", "investment grade credit"],
  },
];

export default function DesignOption3() {
  return (
    <div className="h-screen flex flex-col bg-[#0d0d0d] text-[#e5e5e5] overflow-hidden">
      {/* Navigation */}
      <nav className="fixed top-4 left-4 z-50">
        <Link
          href="/design-options"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a]/90 backdrop-blur border border-[#2a2a2a] text-xs font-medium text-[#888] hover:text-[#0ff] hover:border-[#0ff]/30 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Options
        </Link>
      </nav>

      {/* Header */}
      <header className="flex-shrink-0 h-12 px-4 flex items-center justify-between bg-[#0d0d0d] border-b border-[#1f1f1f]">
        <div className="flex items-center gap-6">
          <span className="text-sm font-bold tracking-wider text-[#0ff]">
            ARCHIVIST
          </span>
          <div className="flex items-center gap-1 text-[11px] font-mono text-[#555]">
            <span className="text-[#888]">ILB-E542</span>
            <span>/</span>
            <span className="text-[#e5e5e5]">Marc Rowan on Apollo&apos;s Evolution</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-mono text-[#555]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>⌘K</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#0f0] animate-pulse" />
            <span className="text-[10px] font-mono text-[#555]">LIVE SYNC</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: '240px 1fr 320px' }}>
        {/* Left Sidebar - Sections */}
        <aside className="h-full bg-[#111] flex flex-col py-4 border-r border-[#1f1f1f] overflow-y-auto">
          {/* Speakers */}
          <div className="px-3 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#555]">Speakers</span>
              <div className="flex-1 h-px bg-[#1f1f1f]" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-0.5 text-[10px] font-mono bg-[#0ff]/10 text-[#0ff] border border-[#0ff]/20">
                Marc Rowan
              </span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-[#666]/20 text-[#888] border border-[#333]">
                Patrick O&apos;S
              </span>
            </div>
          </div>

          {/* Sections */}
          <div className="px-3 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#555]">Sections</span>
              <div className="flex-1 h-px bg-[#1f1f1f]" />
              <span className="text-[10px] font-mono text-[#555]">{mockSections.length}</span>
            </div>
            <div className="space-y-1">
              {mockSections.map((s, i) => (
                <button
                  key={i}
                  className={`w-full text-left p-2 transition-all ${
                    s.active
                      ? 'bg-[#0ff]/10 border-l-2 border-[#0ff]'
                      : 'hover:bg-[#1a1a1a] border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-[11px] leading-tight ${s.active ? 'text-[#0ff]' : 'text-[#aaa]'}`}>
                      {s.title}
                    </span>
                    <span className="text-[9px] font-mono text-[#555] whitespace-nowrap">
                      {s.time}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] font-mono text-[#444]">{s.turns} turns</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          <div className="px-3 pt-4 border-t border-[#1f1f1f]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-[#555]">Progress</span>
              <span className="text-[10px] font-mono text-[#0ff]">41%</span>
            </div>
            <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div className="h-full w-[41%] bg-gradient-to-r from-[#0ff] to-[#0ff]/50" />
            </div>
          </div>
        </aside>

        {/* Center: Transcript */}
        <section className="h-full bg-[#0d0d0d] overflow-y-auto flex flex-col">
          {/* Video Controls */}
          <div className="sticky top-0 z-40 bg-[#111]/95 backdrop-blur p-3 flex items-center gap-4 border-b border-[#1f1f1f]">
            <button className="w-10 h-10 bg-[#0ff] text-[#0d0d0d] flex items-center justify-center hover:shadow-[0_0_20px_rgba(0,255,255,0.3)] transition-shadow">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-[#0ff]">23:14</span>
                <div className="flex-1 h-1 bg-[#1f1f1f] relative rounded-full overflow-hidden">
                  <div className="absolute top-0 left-0 h-full w-[41%] bg-[#0ff]" />
                  <div className="absolute top-0 left-[41%] w-2 h-full bg-[#0ff] shadow-[0_0_10px_rgba(0,255,255,0.5)]" />
                </div>
                <span className="text-[11px] font-mono text-[#555]">56:42</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[#555]">
              <button className="text-[10px] font-mono hover:text-[#0ff] transition-colors">1.5x</button>
              <button className="hover:text-[#0ff] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Transcript */}
          <div className="flex-1 px-8 py-6 space-y-6">
            {mockTranscript.map((turn, i) => (
              <div
                key={i}
                className={`group relative p-4 transition-all ${
                  turn.active
                    ? 'bg-[#0ff]/5 border-l-2 border-[#0ff] shadow-[0_0_30px_rgba(0,255,255,0.05)]'
                    : 'hover:bg-[#111] border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[10px] font-mono text-[#555]">{turn.time}</span>
                  <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                    turn.role === 'host'
                      ? 'bg-[#333] text-[#888]'
                      : 'bg-[#0ff]/10 text-[#0ff]'
                  }`}>
                    {turn.speaker}
                  </span>
                  {turn.active && (
                    <span className="px-1.5 py-0.5 text-[9px] font-mono bg-[#0ff]/20 text-[#0ff] animate-pulse">
                      NOW PLAYING
                    </span>
                  )}
                </div>
                <p className={`text-[14px] leading-relaxed ${
                  turn.role === 'host' ? 'text-[#888] italic' : 'text-[#ccc]'
                }`}>
                  {turn.text}
                </p>
                {turn.entities && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {turn.entities.map((e, ei) => (
                      <span key={ei} className="px-1.5 py-0.5 text-[9px] font-mono bg-[#1a1a1a] text-[#666] border border-[#2a2a2a]">
                        {e}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Right Sidebar - AI Insights */}
        <aside className="h-full bg-[#111] flex flex-col border-l border-[#1f1f1f] overflow-y-auto">
          {/* Key Takeaways */}
          <div className="p-4 border-b border-[#1f1f1f]">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#0ff]">AI Insights</span>
              <div className="flex-1 h-px bg-[#1f1f1f]" />
              <span className="w-2 h-2 rounded-full bg-[#0ff] animate-pulse" />
            </div>
            <div className="space-y-4">
              {mockTakeaways.map((t, i) => (
                <div key={i} className="p-3 bg-[#0d0d0d] border border-[#1f1f1f] hover:border-[#0ff]/30 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[11px] font-medium text-[#e5e5e5] leading-tight">{t.title}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono text-[#0ff]">{t.confidence}%</span>
                      <button className="text-[9px] font-mono text-[#555] hover:text-[#0ff]">[{t.time}]</button>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#666] italic leading-relaxed">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Entity Graph */}
          <div className="p-4 flex-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#555]">Entity Graph</span>
              <div className="flex-1 h-px bg-[#1f1f1f]" />
            </div>
            <div className="h-48 bg-[#0d0d0d] border border-[#1f1f1f] flex items-center justify-center">
              <div className="text-center">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-2 border-[#0ff]/30 flex items-center justify-center mx-auto">
                    <span className="text-[10px] font-mono text-[#0ff]">Apollo</span>
                  </div>
                  <div className="absolute -top-2 -right-8 w-10 h-10 rounded-full border border-[#555] flex items-center justify-center">
                    <span className="text-[8px] font-mono text-[#555]">Athene</span>
                  </div>
                  <div className="absolute -bottom-2 -left-6 w-12 h-12 rounded-full border border-[#555] flex items-center justify-center">
                    <span className="text-[8px] font-mono text-[#555]">PE</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Export */}
          <div className="p-4 border-t border-[#1f1f1f]">
            <button className="w-full py-2.5 bg-[#0ff] text-[#0d0d0d] text-[10px] font-bold uppercase tracking-wider hover:shadow-[0_0_20px_rgba(0,255,255,0.3)] transition-all">
              Export Package
            </button>
          </div>
        </aside>
      </main>

      {/* Design Label */}
      <div className="fixed bottom-4 right-4 bg-[#0ff] text-[#0d0d0d] px-3 py-1.5 text-xs font-bold">
        Option 3: Dark Terminal
      </div>
    </div>
  );
}
