"use client";

/**
 * OPTION 3: Light Mode Professional
 * 
 * High information density with warm neutral palette:
 * - Light surfaces (warm whites, subtle grays)
 * - Amber/gold accent color
 * - Monospace elements for timestamps
 * - Three-column with collapsible panels
 * - Right sidebar: Key Takeaways, Rowspace Angles, Related Content
 */

import Link from "next/link";
import { useState } from "react";

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
    text: "Target pension funds struggling with IG yield; emphasize the \"Industrialized Credit\" framework.",
  },
  {
    text: "Contrast Apollo's \"Fixed Income Replacement\" strategy vs Blackstone's \"Real Estate Heavy\" model.",
  },
];

// Empty array to show auto-collapse behavior
const mockRelated: { title: string; subtitle: string }[] = [
  { title: "Jon Gray (Blackstone) on Private Markets", subtitle: "ILB Episode #412" },
  { title: "The Evolution of Private Credit (Panel)", subtitle: "Mastering the Market Cycle" },
  { title: "Insurance as a Capital Weapon", subtitle: "Internal Research Memo" },
];

const mockTranscript = [
  {
    time: "22:45",
    speaker: "Marc Rowan",
    title: "CEO, Apollo Global Management",
    role: "guest",
    text: "The misconception about Apollo is that we are simply an asset manager. In reality, we are a provider of retirement security services. The integration of Athene didn't just give us a balance sheet; it gave us a repeatable, low-cost capital engine that allows us to focus on the yield-generation side of the house without the volatility of constant fundraising.",
  },
  {
    time: "23:20",
    speaker: "Patrick O'Shaughnessy",
    title: "Host, Invest Like the Best",
    role: "host",
    text: "How does that shift the internal culture? When you move from \"selling a fund\" to \"managing a permanent balance sheet,\" does the profile of the investment professional you hire change?",
    active: true,
  },
  {
    time: "24:10",
    speaker: "Marc Rowan",
    title: "CEO, Apollo Global Management",
    role: "guest",
    text: "It changes everything. We are no longer chasing the \"hot\" trade to mark up a fund for a subsequent fundraise. We are looking for 400 basis points of spread over 20 years. That requires an industrialized approach to credit. You need people who understand the plumbing of originations—whether it's fleet leasing, mid-market lending, or infrastructure—at scale.",
    cited: true,
  },
  {
    time: "25:55",
    speaker: "Marc Rowan",
    title: "CEO, Apollo Global Management",
    role: "guest",
    text: "The market still thinks of private equity as \"leveraged buyouts.\" That's less than 20% of what we do now. The real story is the migration of investment grade credit from the public markets to private institutional hands.",
  },
];

export default function DesignOption3() {
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [relatedExpanded, setRelatedExpanded] = useState(mockRelated.length > 0);

  return (
    <div className="h-screen flex flex-col bg-[#faf9f7] text-[#1a1a1a] overflow-hidden">
      {/* Navigation */}
      <nav className="fixed top-4 left-4 z-50">
        <Link
          href="/design-options"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur border border-[#e5e3df] text-xs font-medium text-[#666] hover:text-[#b8860b] hover:border-[#b8860b]/30 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Options
        </Link>
      </nav>

      {/* Header */}
      <header className="flex-shrink-0 h-12 px-4 flex items-center justify-between bg-white border-b border-[#e5e3df]">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-wide text-[#b8860b]">
            ARCHIVIST
          </span>
          <div className="flex items-center gap-2 text-[11px] text-[#888]">
            <span className="font-mono text-[#999]">ILB-E542</span>
            <span className="text-[#ccc]">/</span>
            <span className="text-[#555]">Marc Rowan on Apollo&apos;s Evolution</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f5f4f2] border border-[#e5e3df] text-xs text-[#888]">
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
        <aside className="h-full bg-[#faf9f7] flex flex-col border-r border-[#e5e3df] overflow-y-auto">
          {/* Episode Meta */}
          <div className="px-4 py-4 border-b border-[#e5e3df]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-1">Source Series</div>
            <div className="text-[13px] font-medium text-[#333] mb-3">Invest Like the Best</div>
            
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-1">Episode</div>
            <div className="text-[13px] font-medium text-[#333]">Marc Rowan on Apollo&apos;s Evolution</div>
          </div>

          {/* Speakers */}
          <div className="px-4 py-4 border-b border-[#e5e3df]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-3">Speakers</div>
            <div className="space-y-2">
              <button className="w-full flex items-center justify-between p-2 bg-white border border-[#e5e3df] hover:border-[#b8860b]/30 transition-colors">
                <div className="text-left">
                  <div className="text-[12px] font-medium text-[#b8860b]">Marc Rowan</div>
                  <div className="text-[10px] text-[#888]">CEO, Apollo Global Management</div>
                </div>
                <svg className="w-3.5 h-3.5 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button className="w-full flex items-center justify-between p-2 bg-[#f5f4f2] border border-[#e5e3df] hover:border-[#ccc] transition-colors">
                <div className="text-left">
                  <div className="text-[12px] text-[#555]">Patrick O&apos;Shaughnessy</div>
                  <div className="text-[10px] text-[#999]">Host, Invest Like the Best</div>
                </div>
                <svg className="w-3.5 h-3.5 text-[#bbb]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-[#e5e3df]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-2">Internal Search</div>
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#bbb]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input 
                type="text"
                placeholder="Find in transcript..."
                className="w-full bg-white border border-[#e5e3df] text-[12px] text-[#333] placeholder:text-[#bbb] py-2 pl-8 pr-3 focus:outline-none focus:border-[#b8860b]/50"
              />
            </div>
          </div>

          {/* Sections */}
          <div className="px-4 py-3 flex-1">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Sections</div>
              <div className="flex items-center gap-1">
                <button className="w-5 h-5 flex items-center justify-center text-[#999] hover:text-[#555] hover:bg-[#f0efed] transition-colors">
                  <span className="text-sm">+</span>
                </button>
                <button className="w-5 h-5 flex items-center justify-center text-[#999] hover:text-[#555] hover:bg-[#f0efed] transition-colors">
                  <span className="text-sm">-</span>
                </button>
              </div>
            </div>
            <div className="space-y-0.5">
              {mockSections.map((s, i) => (
                <button
                  key={i}
                  className={`w-full text-left p-2.5 transition-all ${
                    s.active
                      ? 'bg-white border-l-2 border-[#b8860b]'
                      : 'hover:bg-[#f5f4f2] border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-[12px] leading-snug ${s.active ? 'text-[#1a1a1a]' : 'text-[#666]'}`}>
                      {s.title}
                    </span>
                    <span className="text-[10px] font-mono text-[#999] whitespace-nowrap">
                      {s.time}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-[#e5e3df]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#b8860b]" />
              <span className="text-[10px] text-[#999]">Cited in Takeaways</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#5a8fc7]" />
              <span className="text-[10px] text-[#999]">Search Match</span>
            </div>
          </div>

          {/* Export */}
          <div className="px-4 py-3 border-t border-[#e5e3df]">
            <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-[#e5e3df] text-[11px] font-medium text-[#666] hover:text-[#b8860b] hover:border-[#b8860b]/30 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Archive
            </button>
          </div>
        </aside>

        {/* Center: Transcript */}
        <section className="h-full bg-white overflow-y-auto flex flex-col">
          {/* Video Controls - Collapsed */}
          {!videoExpanded && (
            <div className="sticky top-0 z-40 bg-[#faf9f7]/95 backdrop-blur p-3 flex items-center gap-4 border-b border-[#e5e3df]">
              <div className="w-20 h-12 bg-[#f0efed] border border-[#e5e3df] flex items-center justify-center">
                <svg className="w-6 h-6 text-[#999]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <button className="w-8 h-8 flex items-center justify-center text-[#666] hover:text-[#b8860b] transition-colors">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  </button>
                  <span className="text-[11px] font-mono text-[#b8860b]">23:14</span>
                  <div className="flex-1 h-1 bg-[#e5e3df] relative rounded-full overflow-hidden">
                    <div className="absolute top-0 left-0 h-full w-[41%] bg-[#b8860b]/40" />
                    <div className="absolute top-0 left-[41%] w-1.5 h-full bg-[#b8860b] rounded-full" />
                  </div>
                  <span className="text-[11px] font-mono text-[#999]">56:42</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[#888]">
                <button className="text-[10px] font-mono hover:text-[#b8860b] transition-colors px-2 py-1 bg-white border border-[#e5e3df]">1.25x</button>
                <button 
                  onClick={() => setVideoExpanded(true)}
                  className="hover:text-[#b8860b] transition-colors p-1.5 hover:bg-[#f5f4f2] rounded" 
                  title="Expand video"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Video Controls - Expanded */}
          {videoExpanded && (
            <div className="sticky top-0 z-40 bg-[#0a0a0a]">
              <div className="aspect-video max-h-[50vh] w-full bg-[#111] flex items-center justify-center relative">
                <svg className="w-16 h-16 text-[#333]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <button 
                  onClick={() => setVideoExpanded(false)}
                  className="absolute top-3 right-3 p-2 bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors rounded"
                  title="Collapse video"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="bg-[#faf9f7] p-3 flex items-center gap-4 border-b border-[#e5e3df]">
                <button className="w-8 h-8 flex items-center justify-center text-[#666] hover:text-[#b8860b] transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                </button>
                <span className="text-[11px] font-mono text-[#b8860b]">23:14</span>
                <div className="flex-1 h-1 bg-[#e5e3df] relative rounded-full overflow-hidden">
                  <div className="absolute top-0 left-0 h-full w-[41%] bg-[#b8860b]/40" />
                  <div className="absolute top-0 left-[41%] w-1.5 h-full bg-[#b8860b] rounded-full" />
                </div>
                <span className="text-[11px] font-mono text-[#999]">56:42</span>
                <button className="text-[10px] font-mono text-[#888] hover:text-[#b8860b] transition-colors px-2 py-1 bg-white border border-[#e5e3df]">1.25x</button>
              </div>
            </div>
          )}

          {/* Transcript */}
          <div className="flex-1 px-6 py-5 space-y-1">
            {mockTranscript.map((turn, i) => (
              <div
                key={i}
                className={`group relative p-4 transition-all ${
                  turn.active
                    ? 'bg-[#b8860b]/5 border-l-2 border-[#b8860b]'
                    : turn.cited
                    ? 'bg-[#faf9f7] border-l-2 border-[#b8860b]/40 hover:bg-[#f5f4f2]'
                    : 'hover:bg-[#faf9f7] border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-start gap-3 mb-2">
                  <button 
                    className="text-[10px] font-mono text-[#999] hover:text-[#b8860b] transition-colors mt-0.5"
                    title="Jump to timestamp"
                  >
                    {turn.time}
                  </button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] font-medium ${
                        turn.role === 'host' ? 'text-[#666]' : 'text-[#b8860b]'
                      }`}>
                        {turn.speaker}
                      </span>
                      {turn.cited && (
                        <span className="flex items-center gap-1 text-[9px] text-[#b8860b]/70">
                          <span className="w-1 h-1 rounded-full bg-[#b8860b]" />
                          cited
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#999]">{turn.title}</div>
                  </div>
                </div>
                <p className={`text-[14px] leading-[1.7] pl-[52px] ${
                  turn.role === 'host' ? 'text-[#555] italic' : 'text-[#333]'
                }`}>
                  {turn.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Right Sidebar */}
        <aside className="h-full bg-[#faf9f7] flex flex-col border-l border-[#e5e3df] overflow-y-auto">
          {/* Regenerate Button - applies to both Takeaways and Angles */}
          <div className="px-4 pt-4 pb-2 border-b border-[#e5e3df]">
            <button 
              className="w-full flex items-center justify-center gap-1.5 text-[10px] text-[#888] hover:text-[#b8860b] transition-colors px-2 py-2 border border-[#e5e3df] hover:border-[#b8860b]/30 bg-white"
              title="Regenerate takeaways and angles"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Regenerate Bullets
            </button>
          </div>

          {/* Key Takeaways */}
          <div className="p-4 border-b border-[#e5e3df]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Key Takeaways</span>
            </div>
            <div className="space-y-3">
              {mockTakeaways.map((t, i) => (
                <div key={i} className="p-3 bg-white border border-[#e5e3df] hover:border-[#d5d3cf] transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[12px] font-medium text-[#333] leading-snug">{t.title}</span>
                    <button className="text-[9px] font-mono text-[#999] hover:text-[#b8860b] whitespace-nowrap transition-colors">[{t.time}]</button>
                  </div>
                  <p className="text-[11px] text-[#666] italic leading-relaxed">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Rowspace Angles */}
          <div className="p-4 border-b border-[#e5e3df]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Rowspace Angles</span>
            </div>
            <div className="space-y-3">
              {mockAngles.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#b8860b] mt-1.5 flex-shrink-0" />
                  <p className="text-[12px] text-[#555] leading-relaxed">{a.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Related Content - Auto-collapse if empty */}
          <div className="p-4 flex-1">
            <button 
              onClick={() => setRelatedExpanded(!relatedExpanded)}
              className="w-full flex items-center justify-between mb-4"
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">
                Related Content
                {mockRelated.length === 0 && (
                  <span className="ml-2 text-[#bbb]">(none)</span>
                )}
              </span>
              <svg 
                className={`w-3.5 h-3.5 text-[#999] transition-transform ${relatedExpanded ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {relatedExpanded && mockRelated.length > 0 && (
              <div className="space-y-2">
                {mockRelated.map((r, i) => (
                  <button key={i} className="w-full text-left p-3 bg-white border border-[#e5e3df] hover:border-[#d5d3cf] transition-colors">
                    <div className="text-[12px] text-[#444] leading-snug mb-0.5">{r.title}</div>
                    <div className="text-[10px] text-[#999]">{r.subtitle}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
