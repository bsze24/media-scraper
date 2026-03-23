/**
 * OPTION 5: Soft Modern SaaS
 * 
 * Contemporary SaaS style:
 * - Soft shadows, generous border-radius
 * - Pastel accent colors (soft blue/indigo)
 * - Light gray backgrounds with white cards
 * - Friendly but professional
 * - Floating video player
 * - Pill-shaped tags
 * - Smooth transitions
 * - Emphasis on AI features with subtle gradients
 */

import Link from "next/link";

const mockSections = [
  { title: "Introduction", time: "0:00", duration: "8 min" },
  { title: "Private Credit Boom", time: "8:12", duration: "14 min" },
  { title: "Insurance as Capital", time: "22:45", duration: "12 min", active: true },
  { title: "Operational Alpha", time: "35:30", duration: "12 min" },
  { title: "Building Platform", time: "48:10", duration: "8 min" },
];

const mockTakeaways = [
  {
    title: "Asset-Light Origination Strategy",
    tag: "Strategy",
    confidence: 94,
    quote: "We are building a machine to manufacture investment grade credit at a scale the public markets can't match.",
  },
  {
    title: "Athene Flywheel Effect",
    tag: "Key Insight",
    confidence: 89,
    quote: "Permanent capital allows for longer-duration yield capture without liquidity premiums.",
  },
  {
    title: "Operational Alpha Sources",
    tag: "Alpha",
    confidence: 87,
    quote: "Acquiring originators is better than participating in syndicates.",
  },
];

const mockTranscript = [
  {
    time: "22:45",
    speaker: "Marc Rowan",
    role: "guest",
    avatar: "MR",
    text: "The misconception about Apollo is that we are simply an asset manager. In reality, we are a provider of retirement security services. The integration of Athene didn't just give us a balance sheet; it gave us a repeatable, low-cost capital engine that allows us to focus on the yield-generation side of the house without the volatility of constant fundraising.",
  },
  {
    time: "23:20",
    speaker: "Patrick O'Shaughnessy",
    role: "host",
    avatar: "PO",
    text: "How does that shift the internal culture? When you move from \"selling a fund\" to \"managing a permanent balance sheet,\" does the profile of the investment professional you hire change?",
    active: true,
  },
  {
    time: "24:10",
    speaker: "Marc Rowan",
    role: "guest",
    avatar: "MR",
    text: "It changes everything. We are no longer chasing the \"hot\" trade to mark up a fund for a subsequent fundraise. We are looking for 400 basis points of spread over 20 years. That requires an industrialized approach to credit.",
  },
  {
    time: "25:55",
    speaker: "Marc Rowan",
    role: "guest",
    avatar: "MR",
    text: "The market still thinks of private equity as \"leveraged buyouts.\" That's less than 20% of what we do now. The real story is the migration of investment grade credit from the public markets to private institutional hands.",
  },
];

export default function DesignOption5() {
  return (
    <div className="min-h-screen bg-[#f8f9fc]">
      {/* Navigation */}
      <nav className="fixed top-4 left-4 z-50">
        <Link
          href="/design-options"
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-white rounded-full shadow-sm text-sm font-medium text-[#64748b] hover:text-[#334155] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Options
        </Link>
      </nav>

      {/* Header */}
      <header className="bg-white border-b border-[#e2e8f0]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <span className="text-lg font-semibold text-[#0f172a]">Archivist</span>
            </div>
            <nav className="flex items-center gap-1">
              <button className="px-3 py-1.5 text-sm font-medium text-[#6366f1] bg-[#6366f1]/10 rounded-full">
                Transcripts
              </button>
              <button className="px-3 py-1.5 text-sm font-medium text-[#64748b] hover:text-[#334155] rounded-full">
                Library
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#f1f5f9] rounded-full">
              <svg className="w-4 h-4 text-[#94a3b8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-sm text-[#94a3b8]">Search...</span>
              <span className="text-xs text-[#94a3b8] bg-white px-1.5 py-0.5 rounded">⌘K</span>
            </div>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center text-white text-sm font-medium">
              JD
            </div>
          </div>
        </div>
      </header>

      {/* Episode Header */}
      <div className="bg-white border-b border-[#e2e8f0]">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2.5 py-1 text-xs font-medium text-[#6366f1] bg-[#6366f1]/10 rounded-full">
                  Invest Like the Best
                </span>
                <span className="text-sm text-[#94a3b8]">Episode #542</span>
              </div>
              <h1 className="text-2xl font-semibold text-[#0f172a] mb-3">
                Marc Rowan on Apollo&apos;s Evolution
              </h1>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[#0f172a] flex items-center justify-center text-white text-xs font-medium">
                    MR
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#0f172a]">Marc Rowan</p>
                    <p className="text-xs text-[#94a3b8]">CEO, Apollo</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[#e2e8f0] flex items-center justify-center text-[#64748b] text-xs font-medium">
                    PO
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#64748b]">Patrick O&apos;Shaughnessy</p>
                    <p className="text-xs text-[#94a3b8]">Host</p>
                  </div>
                </div>
              </div>
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#0f172a] text-white text-sm font-medium rounded-lg hover:bg-[#1e293b] transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-[1fr_360px] gap-8">
          {/* Left: Transcript */}
          <div className="space-y-6">
            {/* Video Player Card */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="aspect-video bg-gradient-to-br from-[#0f172a] to-[#1e293b] relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <button className="w-16 h-16 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors">
                    <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">23:14</span>
                    <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full w-[41%] bg-white rounded-full" />
                    </div>
                    <span className="text-sm text-white/60">56:42</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sections Pills */}
            <div className="flex flex-wrap gap-2">
              {mockSections.map((s, i) => (
                <button
                  key={i}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    s.active
                      ? 'bg-[#6366f1] text-white shadow-lg shadow-[#6366f1]/25'
                      : 'bg-white text-[#64748b] hover:bg-[#f1f5f9]'
                  }`}
                >
                  {s.title}
                  <span className={`ml-2 text-xs ${s.active ? 'text-white/70' : 'text-[#94a3b8]'}`}>
                    {s.time}
                  </span>
                </button>
              ))}
            </div>

            {/* Transcript */}
            <div className="bg-white rounded-2xl shadow-sm p-6 space-y-6">
              {mockTranscript.map((turn, i) => (
                <div
                  key={i}
                  className={`flex gap-4 p-4 rounded-xl transition-colors ${
                    turn.active ? 'bg-[#6366f1]/5' : 'hover:bg-[#f8fafc]'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium ${
                    turn.role === 'host'
                      ? 'bg-[#e2e8f0] text-[#64748b]'
                      : 'bg-[#0f172a] text-white'
                  }`}>
                    {turn.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-sm font-semibold ${
                        turn.role === 'host' ? 'text-[#64748b]' : 'text-[#0f172a]'
                      }`}>
                        {turn.speaker}
                      </span>
                      <span className="text-xs text-[#94a3b8] font-mono">{turn.time}</span>
                      {turn.active && (
                        <span className="px-2 py-0.5 text-[10px] font-medium text-[#6366f1] bg-[#6366f1]/10 rounded-full">
                          Now Playing
                        </span>
                      )}
                    </div>
                    <p className={`text-[15px] leading-relaxed ${
                      turn.role === 'host' ? 'text-[#64748b] italic' : 'text-[#334155]'
                    }`}>
                      {turn.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: AI Insights */}
          <aside className="space-y-6">
            {/* AI Insights Card */}
            <div className="bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-2xl p-6 text-white">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-sm font-semibold">AI-Generated Insights</span>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">
                3 key takeaways extracted from this conversation with 90%+ confidence scores.
              </p>
            </div>

            {/* Takeaways */}
            <div className="space-y-4">
              {mockTakeaways.map((t, i) => (
                <div key={i} className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <span className="px-2 py-0.5 text-[10px] font-semibold text-[#6366f1] bg-[#6366f1]/10 rounded-full">
                        {t.tag}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-8 h-1.5 bg-[#e2e8f0] rounded-full overflow-hidden">
                        <div className="h-full bg-[#22c55e] rounded-full" style={{ width: `${t.confidence}%` }} />
                      </div>
                      <span className="text-[10px] font-medium text-[#22c55e]">{t.confidence}%</span>
                    </div>
                  </div>
                  <h4 className="text-sm font-semibold text-[#0f172a] mb-2">{t.title}</h4>
                  <p className="text-xs text-[#64748b] italic leading-relaxed">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                </div>
              ))}
            </div>

            {/* Search */}
            <div className="bg-white rounded-xl p-5 shadow-sm">
              <h4 className="text-sm font-semibold text-[#0f172a] mb-3">Search Transcript</h4>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Find keywords..."
                  className="w-full px-4 py-2.5 bg-[#f1f5f9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6366f1]/30 placeholder:text-[#94a3b8]"
                />
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Design Label */}
      <div className="fixed bottom-4 right-4 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg">
        Option 5: Soft Modern
      </div>
    </div>
  );
}
