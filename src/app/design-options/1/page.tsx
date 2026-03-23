/**
 * OPTION 1: Faithful Stitch Recreation
 * 
 * Close adaptation of the Archivist Intelligence reference:
 * - Three-column layout (metadata | transcript | AI insights)
 * - Warm cream/paper backgrounds
 * - Clean sans-serif typography (Manrope + Inter)
 * - Sticky video player bar
 * - Timestamped transcript with speaker turns
 * - "No-line rule" - uses tonal shifts instead of borders
 */

import Link from "next/link";

const mockSections = [
  { title: "Introduction & Context", time: "00:00", active: true },
  { title: "The Private Credit Boom", time: "08:12" },
  { title: "Insurance as Capital Source", time: "22:45" },
  { title: "Operational Alpha", time: "35:30" },
  { title: "Building the Platform", time: "48:10" },
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

const mockTranscript = [
  {
    time: "00:22:45",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The misconception about Apollo is that we are simply an asset manager. In reality, we are a provider of retirement security services. The integration of Athene didn't just give us a balance sheet; it gave us a repeatable, low-cost capital engine that allows us to focus on the yield-generation side of the house without the volatility of constant fundraising.",
    highlighted: "retirement security services",
    cited: true,
  },
  {
    time: "00:23:20",
    speaker: "Patrick O'Shaughnessy",
    role: "host",
    text: "How does that shift the internal culture? When you move from \"selling a fund\" to \"managing a permanent balance sheet,\" does the profile of the investment professional you hire change?",
    active: true,
    cited: true,
  },
  {
    time: "00:24:10",
    speaker: "Marc Rowan",
    role: "guest",
    text: "It changes everything. We are no longer chasing the \"hot\" trade to mark up a fund for a subsequent fundraise. We are looking for 400 basis points of spread over 20 years. That requires an industrialized approach to credit. You need people who understand the plumbing of originations—whether it's fleet leasing, mid-market lending, or infrastructure—at scale.",
    highlighted: "industrialized approach",
  },
  {
    time: "00:25:55",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The market still thinks of private equity as \"leveraged buyouts.\" That's less than 20% of what we do now. The real story is the migration of investment grade credit from the public markets to private institutional hands.",
  },
];

export default function DesignOption1() {
  return (
    <div className="h-screen flex flex-col bg-[#f8f9fa] text-[#2b3437] overflow-hidden">
      {/* Navigation */}
      <nav className="fixed top-4 left-4 z-50">
        <Link
          href="/design-options"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur text-xs font-medium text-[#5e5e62] hover:bg-white transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Options
        </Link>
      </nav>

      {/* Header */}
      <header className="flex-shrink-0 h-14 px-6 flex items-center justify-between bg-[#f8f9fa] border-b border-[#abb3b7]/10">
        <div className="flex items-center gap-8">
          <span className="text-lg font-black uppercase tracking-widest text-[#2b3437]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Archivist Intelligence
          </span>
          <nav className="flex gap-6">
            <span className="text-sm font-bold tracking-tight text-[#5e5e62] border-b-2 border-[#5e5e62] pb-px" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Transcripts
            </span>
            <span className="text-sm font-bold tracking-tight text-[#586064] hover:text-[#5e5e62] cursor-pointer" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Library
            </span>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f1f4f6] text-xs text-[#586064]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-[#abb3b7]">Global search...</span>
          </div>
          <div className="w-8 h-8 bg-[#dbe4e7] flex items-center justify-center text-xs font-bold text-[#586064]">
            JD
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: '280px 1fr 340px' }}>
        {/* Left Sidebar */}
        <aside className="h-full bg-[#f1f4f6] flex flex-col py-6 px-4 gap-6 overflow-y-auto">
          {/* Podcast Info */}
          <div className="space-y-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#737c7f] block mb-1">Source Series</span>
              <span className="text-sm font-bold text-[#2b3437]" style={{ fontFamily: 'Manrope, sans-serif' }}>Invest Like the Best</span>
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#737c7f] block mb-1">Episode Title</span>
              <span className="text-base font-bold text-[#2b3437] leading-tight block" style={{ fontFamily: 'Manrope, sans-serif' }}>Marc Rowan on Apollo&apos;s Evolution</span>
              <span className="text-[9px] uppercase tracking-tight text-[#586064] font-bold mt-1 block">ID: ILB-E542-RWN</span>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#737c7f] block">Speakers</span>
              <div className="flex flex-col gap-1.5">
                <button className="flex items-center justify-between p-2 bg-white hover:bg-[#dbe4e7] transition-colors text-left group">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#2b3437]">Marc Rowan</span>
                    <span className="text-[9px] text-[#737c7f] uppercase">CEO, Apollo Global Management</span>
                  </div>
                  <svg className="w-4 h-4 text-[#737c7f] group-hover:text-[#5e5e62]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button className="flex items-center justify-between p-2 bg-white hover:bg-[#dbe4e7] transition-colors text-left group">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#2b3437]">Patrick O&apos;Shaughnessy</span>
                    <span className="text-[9px] text-[#737c7f] uppercase">CEO, O&apos;Shaughnessy Ventures</span>
                  </div>
                  <svg className="w-4 h-4 text-[#737c7f] group-hover:text-[#5e5e62]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Search */}
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#737c7f] block mb-2">Internal Search</span>
            <div className="relative">
              <input
                type="text"
                placeholder="Find in transcript..."
                className="w-full bg-white text-xs py-2 pl-8 pr-3 focus:outline-none placeholder:text-[#abb3b7]"
              />
              <svg className="absolute left-2 top-2 w-4 h-4 text-[#737c7f]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Sections TOC */}
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#737c7f]">Sections</span>
              <div className="flex gap-1">
                <button className="p-1 hover:bg-[#dbe4e7] text-[#737c7f]">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button className="p-1 hover:bg-[#dbe4e7] text-[#737c7f]">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
              </div>
            </div>
            {mockSections.map((s, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-2 cursor-pointer transition-all ${
                  s.active
                    ? 'bg-[#dbe4e7] border-l-2 border-[#5e5e62]'
                    : 'hover:bg-[#dbe4e7] border-l-2 border-transparent'
                }`}
              >
                <span className={`text-xs ${s.active ? 'font-bold text-[#2b3437]' : 'font-medium text-[#586064]'}`}>
                  {s.title}
                </span>
                <span className={`text-[10px] font-mono ${s.active ? 'text-[#5e5e62] font-bold' : 'text-[#737c7f]'}`}>
                  {s.time}
                </span>
              </div>
            ))}
            <div className="mt-6 pt-4 border-t border-[#abb3b7]/15 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#5e5e62]/40" />
                <span className="text-[10px] uppercase font-bold text-[#737c7f]">cited in takeaways</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                <span className="text-[10px] uppercase font-bold text-[#737c7f]">search match</span>
              </div>
            </div>
          </div>

          {/* Export Button */}
          <button className="w-full py-2.5 bg-[#5e5e62] text-white text-[10px] font-black tracking-widest uppercase hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Archive
          </button>
        </aside>

        {/* Center: Transcript */}
        <section className="h-full bg-[#f8f9fa] overflow-y-auto flex flex-col">
          {/* Video Player Bar */}
          <div className="sticky top-0 z-40 bg-white p-3 flex items-center gap-4 border-b border-[#abb3b7]/10">
            <div className="w-24 h-14 bg-black relative flex-shrink-0 cursor-pointer overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-[#5e5e62] to-[#2b3437] opacity-60 group-hover:opacity-80 transition-opacity" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div className="absolute bottom-1 right-1 bg-black/60 px-1 text-[8px] font-mono text-white">4K</div>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <button className="w-7 h-7 bg-[#5e5e62] text-white flex items-center justify-center">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                </button>
                <div className="flex-1 h-1.5 bg-[#e3e9ec] relative">
                  <div className="absolute top-0 left-0 h-full w-[42%] bg-[#5e5e62]" />
                </div>
                <span className="text-[10px] font-mono font-bold text-[#2b3437] whitespace-nowrap">23:14 / 56:42</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-[#737c7f]">
                  <svg className="w-4 h-4 cursor-pointer hover:text-[#5e5e62]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  <span className="text-[10px] font-bold cursor-pointer hover:text-[#5e5e62]">1.25x</span>
                </div>
                <button className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#5e5e62] hover:underline">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                  </svg>
                  Expand Video
                </button>
              </div>
            </div>
          </div>

          {/* Transcript Content */}
          <div className="max-w-3xl mx-auto py-12 px-10 space-y-12">
            {mockTranscript.map((turn, i) => (
              <div
                key={i}
                className={`flex gap-8 group relative ${
                  turn.active
                    ? 'p-6 bg-white shadow-[0_12px_32px_rgba(43,52,55,0.06)]'
                    : ''
                }`}
              >
                {turn.active && <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#5e5e62]" />}
                <div className="w-16 flex-shrink-0 pt-1">
                  <span className={`text-[10px] font-mono font-bold tracking-tighter ${
                    turn.active ? 'text-[#5e5e62]' : 'text-[#737c7f]'
                  }`}>
                    {turn.time}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-extrabold uppercase tracking-widest text-[#5e5e62]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                      {turn.speaker}
                    </span>
                    {turn.cited && (
                      <div className={`w-1.5 h-1.5 rounded-full ${turn.active ? 'bg-[#5e5e62]' : 'bg-[#5e5e62]/60'}`} title="Cited in takeaway" />
                    )}
                  </div>
                  <p className={`text-[0.9375rem] leading-relaxed text-[#2b3437] ${turn.role === 'host' ? 'italic' : ''}`}>
                    {turn.highlighted ? (
                      <>
                        {turn.text.split(turn.highlighted)[0]}
                        <span className="bg-[#5e5e62]/10 border-b border-[#5e5e62]/40 px-0.5 font-bold">
                          {turn.highlighted}
                        </span>
                        {turn.text.split(turn.highlighted)[1]}
                      </>
                    ) : (
                      turn.text
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right Sidebar: AI Insights */}
        <aside className="h-full bg-[#f1f4f6] flex flex-col py-6 px-5 gap-8 overflow-y-auto">
          {/* Key Takeaways */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#abb3b7]/15 pb-2">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2b3437]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Key Takeaways
              </h3>
              <svg className="w-4 h-4 text-[#5e5e62]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-4">
              {mockTakeaways.map((t, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] font-bold text-[#2b3437] leading-tight">{t.title}</span>
                    <a href="#" className="text-[9px] font-mono text-[#5e5e62] hover:underline">[{t.time}]</a>
                  </div>
                  <p className="text-[11px] text-[#586064] italic border-l border-[#abb3b7]/30 pl-3">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Rowspace Angles */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#abb3b7]/15 pb-2">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2b3437]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Rowspace Angles
              </h3>
              <svg className="w-4 h-4 text-[#5e5e62]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <span className="text-[9px] font-bold text-[#5e5e62] uppercase">Pitch Hook</span>
                  <span className="text-[9px] text-[#737c7f] uppercase">Institutional</span>
                </div>
                <p className="text-[11px] text-[#586064]">
                  Target pension funds struggling with IG yield; emphasize the &quot;Industrialized Credit&quot; framework.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <span className="text-[9px] font-bold text-[#5e5e62] uppercase">Reframing</span>
                  <span className="text-[9px] text-[#737c7f] uppercase">Competitor Analysis</span>
                </div>
                <p className="text-[11px] text-[#586064]">
                  Contrast Apollo&apos;s &quot;Fixed Income Replacement&quot; strategy vs Blackstone&apos;s &quot;Real Estate Heavy&quot; model.
                </p>
              </div>
            </div>
          </section>

          {/* Related Archive */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#abb3b7]/15 pb-2">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2b3437]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Related Archive
              </h3>
              <svg className="w-4 h-4 text-[#5e5e62]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <div className="space-y-3">
              <div className="cursor-pointer hover:bg-[#dbe4e7] p-2 -mx-2 transition-colors">
                <p className="text-[11px] font-bold text-[#2b3437]">Jon Gray (Blackstone) on Private Markets</p>
                <p className="text-[9px] text-[#737c7f] uppercase">ILB Episode #412</p>
              </div>
              <div className="cursor-pointer hover:bg-[#dbe4e7] p-2 -mx-2 transition-colors">
                <p className="text-[11px] font-bold text-[#2b3437]">The Evolution of Private Credit (Panel)</p>
                <p className="text-[9px] text-[#737c7f] uppercase">Mastering the Market Cycle</p>
              </div>
              <div className="cursor-pointer hover:bg-[#dbe4e7] p-2 -mx-2 transition-colors">
                <p className="text-[11px] font-bold text-[#2b3437]">Insurance as a Capital Weapon</p>
                <p className="text-[9px] text-[#737c7f] uppercase">Internal Research Memo</p>
              </div>
            </div>
          </section>
        </aside>
      </main>

      {/* Design Label */}
      <div className="fixed bottom-4 right-4 bg-[#2b3437] text-white px-3 py-1.5 text-xs font-bold">
        Option 1: Faithful Stitch
      </div>
    </div>
  );
}
