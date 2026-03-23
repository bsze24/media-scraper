/**
 * OPTION 2: Ultra-Minimal Editorial
 * 
 * Stripped-back minimalism inspired by Bloomberg/The Information:
 * - Pure white backgrounds, high-contrast black typography
 * - Generous whitespace
 * - Two-column layout (transcript + collapsible sidebar)
 * - Subtle gray accents only
 * - Swiss/Helvetica-inspired typography hierarchy
 */

import Link from "next/link";

const mockSections = [
  { title: "Introduction & Context", time: "00:00" },
  { title: "The Private Credit Boom", time: "08:12" },
  { title: "Insurance as Capital Source", time: "22:45" },
  { title: "Operational Alpha", time: "35:30" },
  { title: "Building the Platform", time: "48:10" },
];

const mockTakeaways = [
  {
    title: "Transition to Asset-Light Origination",
    quote: "We are building a machine to manufacture investment grade credit at a scale the public markets can't match.",
  },
  {
    title: "The Athene Flywheel Effect",
    quote: "Permanent capital allows for longer-duration yield capture without liquidity premiums.",
  },
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
  },
  {
    time: "24:10",
    speaker: "Marc Rowan",
    role: "guest",
    text: "It changes everything. We are no longer chasing the \"hot\" trade to mark up a fund for a subsequent fundraise. We are looking for 400 basis points of spread over 20 years. That requires an industrialized approach to credit. You need people who understand the plumbing of originations—whether it's fleet leasing, mid-market lending, or infrastructure—at scale.",
  },
  {
    time: "25:55",
    speaker: "Marc Rowan",
    role: "guest",
    text: "The market still thinks of private equity as \"leveraged buyouts.\" That's less than 20% of what we do now. The real story is the migration of investment grade credit from the public markets to private institutional hands.",
  },
];

export default function DesignOption2() {
  return (
    <div className="min-h-screen bg-white text-[#111]">
      {/* Navigation */}
      <nav className="fixed top-6 left-6 z-50">
        <Link
          href="/design-options"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#666] hover:text-[#111] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
          All Options
        </Link>
      </nav>

      {/* Minimal Header */}
      <header className="max-w-5xl mx-auto px-8 pt-16 pb-12">
        <div className="flex items-baseline justify-between mb-8">
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-[#999]">
            Invest Like the Best
          </span>
          <span className="text-[11px] text-[#999]">
            March 15, 2024
          </span>
        </div>
        <h1 className="text-[42px] font-light tracking-tight leading-[1.1] text-[#111] mb-6">
          Marc Rowan on Apollo&apos;s Evolution
        </h1>
        <div className="flex items-center gap-6 text-[13px] text-[#666]">
          <span className="font-medium text-[#111]">Marc Rowan</span>
          <span className="text-[#ccc]">/</span>
          <span>CEO, Apollo Global Management</span>
          <span className="text-[#ccc]">|</span>
          <span className="italic text-[#999]">with Patrick O&apos;Shaughnessy</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-8 pb-24">
        <div className="grid grid-cols-[1fr_280px] gap-16">
          {/* Transcript */}
          <div>
            {/* Video Embed (minimal) */}
            <div className="mb-12 relative">
              <div className="aspect-video bg-[#f5f5f5] flex items-center justify-center group cursor-pointer">
                <div className="w-16 h-16 rounded-full bg-[#111] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              <div className="absolute bottom-4 right-4 text-[11px] font-mono text-[#999]">
                56:42
              </div>
            </div>

            {/* Sections */}
            <div className="mb-12 pb-12 border-b border-[#eee]">
              <div className="flex flex-wrap gap-3">
                {mockSections.map((s, i) => (
                  <button
                    key={i}
                    className="px-3 py-1.5 text-[11px] font-medium text-[#666] bg-[#f5f5f5] hover:bg-[#eee] transition-colors"
                  >
                    {s.title}
                    <span className="ml-2 text-[#aaa]">{s.time}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Transcript Turns */}
            <div className="space-y-10">
              {mockTranscript.map((turn, i) => (
                <div key={i} className="group">
                  <div className="flex items-baseline gap-4 mb-3">
                    <span className="text-[11px] font-mono text-[#bbb] w-12">
                      {turn.time}
                    </span>
                    <span className={`text-[12px] font-semibold uppercase tracking-wide ${
                      turn.role === 'host' ? 'text-[#999]' : 'text-[#111]'
                    }`}>
                      {turn.speaker}
                    </span>
                  </div>
                  <div className="ml-16">
                    <p className={`text-[17px] leading-[1.75] text-[#333] ${
                      turn.role === 'host' ? 'italic text-[#666]' : ''
                    }`}>
                      {turn.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-10">
            {/* Key Insights */}
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#999] mb-4">
                Key Insights
              </h3>
              <div className="space-y-6">
                {mockTakeaways.map((t, i) => (
                  <div key={i} className="pb-6 border-b border-[#f0f0f0] last:border-0">
                    <p className="text-[13px] font-semibold text-[#111] leading-snug mb-2">
                      {t.title}
                    </p>
                    <p className="text-[12px] text-[#777] leading-relaxed italic">
                      &ldquo;{t.quote}&rdquo;
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Speakers */}
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#999] mb-4">
                Speakers
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#111] flex items-center justify-center text-[11px] font-semibold text-white">
                    MR
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-[#111]">Marc Rowan</p>
                    <p className="text-[11px] text-[#999]">CEO, Apollo Global Management</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#ddd] flex items-center justify-center text-[11px] font-semibold text-[#666]">
                    PO
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#666]">Patrick O&apos;Shaughnessy</p>
                    <p className="text-[11px] text-[#aaa]">Host</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Search */}
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#999] mb-4">
                Search Transcript
              </h3>
              <input
                type="text"
                placeholder="Find..."
                className="w-full px-3 py-2 text-[13px] bg-[#f5f5f5] border-0 focus:outline-none focus:ring-1 focus:ring-[#111] placeholder:text-[#bbb]"
              />
            </div>

            {/* Export */}
            <button className="w-full py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#666] bg-[#f5f5f5] hover:bg-[#eee] transition-colors">
              Export Transcript
            </button>
          </aside>
        </div>
      </main>

      {/* Design Label */}
      <div className="fixed bottom-4 right-4 bg-[#111] text-white px-3 py-1.5 text-xs font-medium">
        Option 2: Ultra-Minimal
      </div>
    </div>
  );
}
