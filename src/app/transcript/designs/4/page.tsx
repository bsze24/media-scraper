/**
 * OPTION 4: Bold Brutalist (DESIGN.md Aligned)
 * 
 * Professional brutalism per the DESIGN.md spec:
 * - Off-white/warm gray backgrounds
 * - Bold condensed headings
 * - Clear surface hierarchy using tonal shifts (no borders)
 * - Understated accent (amber/gold)
 * - Card-based sections
 * - Strong visual rhythm
 * - Manrope for headings, Inter for body
 */

import Link from "next/link";

const mockSections = [
  { title: "Introduction & Context", time: "00:00", cited: true },
  { title: "The Private Credit Boom", time: "08:12" },
  { title: "Insurance as Capital Source", time: "22:45", cited: true, active: true },
  { title: "Operational Alpha", time: "35:30", cited: true },
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
    time: "22:45",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The misconception about Apollo is that we are simply an asset manager. In reality, we are a provider of retirement security services. The integration of Athene didn't just give us a balance sheet; it gave us a repeatable, low-cost capital engine that allows us to focus on the yield-generation side of the house without the volatility of constant fundraising.",
    highlight: "retirement security services",
    cited: true,
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
    highlight: "industrialized approach",
  },
  {
    time: "25:55",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The market still thinks of private equity as \"leveraged buyouts.\" That's less than 20% of what we do now. The real story is the migration of investment grade credit from the public markets to private institutional hands.",
  },
];

export default function DesignOption4() {
  return (
    <div className="min-h-screen bg-[#f5f4f0] text-[#1a1a1a]">
      {/* Navigation */}
      <nav className="fixed top-5 left-6 z-50">
        <Link
          href="/transcript/designs"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#eae8e3] text-xs font-semibold text-[#666] hover:text-[#1a1a1a] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Options
        </Link>
      </nav>

      {/* Header */}
      <header className="pt-6 pb-8 px-8 bg-[#eae8e3]">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <span className="text-[11px] font-black uppercase tracking-[0.25em] text-[#999]" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Invest Like the Best / Episode #542
            </span>
            <span className="text-[11px] font-medium text-[#999]">
              March 15, 2024
            </span>
          </div>
          <h1 className="text-[38px] font-black leading-[1.05] tracking-tight text-[#1a1a1a] mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Marc Rowan on Apollo&apos;s Evolution
          </h1>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#c9a84c] flex items-center justify-center text-white text-sm font-bold">
                MR
              </div>
              <div>
                <p className="text-[13px] font-bold text-[#1a1a1a]">Marc Rowan</p>
                <p className="text-[11px] text-[#888]">CEO, Apollo Global Management</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#ddd] flex items-center justify-center text-[#888] text-sm font-bold">
                PO
              </div>
              <div>
                <p className="text-[13px] font-medium text-[#888]">Patrick O&apos;Shaughnessy</p>
                <p className="text-[11px] text-[#aaa]">Host</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-10">
        <div className="grid grid-cols-[280px_1fr_300px] gap-8">
          {/* Left Sidebar */}
          <aside className="space-y-8">
            {/* Video */}
            <div className="bg-[#1a1a1a] aspect-video relative group cursor-pointer">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 bg-[#c9a84c] flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              <div className="absolute bottom-3 right-3 text-[10px] font-mono text-white/70 bg-black/50 px-1.5 py-0.5">
                23:14 / 56:42
              </div>
            </div>

            {/* Sections */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#999] mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Sections
              </h3>
              <div className="space-y-1">
                {mockSections.map((s, i) => (
                  <button
                    key={i}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${
                      s.active
                        ? 'bg-[#c9a84c]/10'
                        : 'hover:bg-[#eae8e3]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {s.cited && (
                        <div className="w-1.5 h-1.5 rounded-full bg-[#c9a84c]" />
                      )}
                      <span className={`text-[12px] flex-1 ${
                        s.active ? 'font-bold text-[#c9a84c]' : 'font-medium text-[#555]'
                      }`}>
                        {s.title}
                      </span>
                      <span className={`text-[10px] font-mono ${
                        s.active ? 'text-[#c9a84c]' : 'text-[#aaa]'
                      }`}>
                        {s.time}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#999] mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Search
              </h3>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Find in transcript..."
                  className="w-full bg-[#eae8e3] text-[13px] py-2.5 px-3 focus:outline-none placeholder:text-[#bbb]"
                />
              </div>
            </div>

            {/* Export */}
            <button className="w-full py-3 bg-[#1a1a1a] text-white text-[11px] font-black uppercase tracking-widest hover:bg-[#333] transition-colors" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Export Archive
            </button>
          </aside>

          {/* Center: Transcript */}
          <div className="space-y-8">
            {mockTranscript.map((turn, i) => (
              <div
                key={i}
                className={`p-6 transition-colors ${
                  turn.active
                    ? 'bg-white shadow-[0_8px_32px_rgba(0,0,0,0.04)]'
                    : 'bg-[#eae8e3]/50'
                }`}
              >
                <div className="flex items-center gap-4 mb-4">
                  <span className="text-[10px] font-mono text-[#999]">{turn.time}</span>
                  <span className={`text-[11px] font-black uppercase tracking-widest ${
                    turn.role === 'host' ? 'text-[#999]' : 'text-[#c9a84c]'
                  }`} style={{ fontFamily: 'Manrope, sans-serif' }}>
                    {turn.speaker}
                  </span>
                  {turn.cited && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#c9a84c]" title="Cited in takeaways" />
                  )}
                </div>
                <p className={`text-[15px] leading-[1.8] ${
                  turn.role === 'host' ? 'italic text-[#666]' : 'text-[#333]'
                }`}>
                  {turn.highlight ? (
                    <>
                      {turn.text.split(turn.highlight)[0]}
                      <span className="bg-[#c9a84c]/15 px-1 font-semibold border-b-2 border-[#c9a84c]/30">
                        {turn.highlight}
                      </span>
                      {turn.text.split(turn.highlight)[1]}
                    </>
                  ) : (
                    turn.text
                  )}
                </p>
              </div>
            ))}
          </div>

          {/* Right Sidebar: AI Takeaways */}
          <aside className="space-y-8">
            <div className="bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#c9a84c] mb-5" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Key Takeaways
              </h3>
              <div className="space-y-5">
                {mockTakeaways.map((t, i) => (
                  <div key={i} className="pb-5 border-b border-[#f0efe8] last:border-0 last:pb-0">
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <span className="text-[12px] font-bold text-[#1a1a1a] leading-snug">{t.title}</span>
                      <button className="text-[9px] font-mono text-[#c9a84c] hover:underline whitespace-nowrap">
                        [{t.time}]
                      </button>
                    </div>
                    <p className="text-[11px] text-[#888] italic leading-relaxed pl-3 border-l-2 border-[#eae8e3]">
                      &ldquo;{t.quote}&rdquo;
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Related */}
            <div className="bg-[#eae8e3]/70 p-5">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#999] mb-5" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Related Episodes
              </h3>
              <div className="space-y-4">
                <div className="cursor-pointer group">
                  <p className="text-[12px] font-bold text-[#555] group-hover:text-[#1a1a1a] transition-colors">Jon Gray on Private Markets</p>
                  <p className="text-[10px] text-[#aaa]">Blackstone CEO / ILB #412</p>
                </div>
                <div className="cursor-pointer group">
                  <p className="text-[12px] font-bold text-[#555] group-hover:text-[#1a1a1a] transition-colors">The Evolution of Private Credit</p>
                  <p className="text-[10px] text-[#aaa]">Panel Discussion / 2023</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Design Label */}
      <div className="fixed bottom-4 right-4 bg-[#c9a84c] text-white px-3 py-1.5 text-xs font-bold">
        Option 4: Bold Brutalist
      </div>
    </div>
  );
}
