import Link from "next/link";

const designs = [
  {
    id: 1,
    title: "Faithful Stitch",
    description: "Close adaptation of the Archivist Intelligence reference with three-column layout, warm cream backgrounds, and the full feature set.",
    tags: ["Three-Column", "Warm Neutrals", "Full Features"],
    color: "#5e5e62",
  },
  {
    id: 2,
    title: "Ultra-Minimal Editorial",
    description: "Stripped-back minimalism inspired by Bloomberg/The Information. Pure white, high-contrast black typography, generous whitespace.",
    tags: ["Two-Column", "High Contrast", "Minimal"],
    color: "#111",
  },
  {
    id: 3,
    title: "Dark Terminal",
    description: "Trading terminal aesthetic with dark surfaces, cyan accents, and monospace typography. High information density with glow effects.",
    tags: ["Dark Mode", "Cyan Accent", "Dense"],
    color: "#0ff",
  },
  {
    id: 4,
    title: "Bold Brutalist",
    description: "Professional brutalism per DESIGN.md: warm grays, bold condensed headings, amber accents. No borders, tonal hierarchy only.",
    tags: ["Brutalist", "Amber Accent", "No Borders"],
    color: "#c9a84c",
  },
  {
    id: 5,
    title: "Soft Modern SaaS",
    description: "Contemporary SaaS style with soft shadows, rounded corners, indigo accents, and friendly AI-focused interface patterns.",
    tags: ["Rounded", "Indigo", "Friendly"],
    color: "#6366f1",
  },
];

export default function DesignOptionsPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] py-16 px-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-[#888] hover:text-[#333] mb-6"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Home
          </Link>
          <h1 className="text-3xl font-bold text-[#111] mb-3">
            Transcript Viewer Designs
          </h1>
          <p className="text-[#666] text-lg">
            5 design directions ranging from faithful Stitch recreation to creative reinterpretations.
            Click any option to view the full prototype.
          </p>
        </div>

        <div className="space-y-4">
          {designs.map((d) => (
            <Link
              key={d.id}
              href={`/transcript/designs/${d.id}`}
              className="block bg-white border border-[#eee] p-6 hover:border-[#ccc] hover:shadow-lg transition-all group"
            >
              <div className="flex items-start gap-6">
                <div
                  className="w-12 h-12 flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
                  style={{ backgroundColor: d.color }}
                >
                  {d.id}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl font-semibold text-[#111] group-hover:text-[#000]">
                      {d.title}
                    </h2>
                    <svg className="w-5 h-5 text-[#ccc] group-hover:text-[#666] group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <p className="text-[#666] mb-3">
                    {d.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {d.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 text-xs font-medium text-[#666] bg-[#f5f5f5]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 p-6 bg-[#f5f5f5] border-l-4 border-[#333]">
          <h3 className="font-semibold text-[#111] mb-2">Next Steps</h3>
          <p className="text-[#666] text-sm">
            Review each option, then let me know which direction resonates most.
            I can also mix elements from multiple options (e.g., &quot;Option 1 layout with Option 3 colors&quot;).
          </p>
        </div>
      </div>
    </div>
  );
}
