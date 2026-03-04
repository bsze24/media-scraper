import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Scraper, ScraperResult, SectionHeading } from "@/types/scraper";
import type { Speaker, SpeakerRole } from "@/types/appearance";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COLOSSUS_DELAY_MS = 3000;
const JITTER_MS = 2000;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export function colossusDelay(): Promise<void> {
  const jitter = Math.random() * JITTER_MS * 2 - JITTER_MS; // ±2s
  const ms = COLOSSUS_DELAY_MS + jitter; // range: 1s–5s centered on 3s
  return new Promise((resolve) => setTimeout(resolve, Math.max(1000, ms)));
}

// ---------------------------------------------------------------------------
// Cheerio parsing (exported for testing)
// ---------------------------------------------------------------------------

export function parseColossusDate(raw: string): string | null {
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month}-${day}`;
}

function extractParagraphText($: cheerio.CheerioAPI, el: Element): string {
  const p = $(el).clone();
  p.find("span.transcript__speaker").remove();
  return p.text().trim();
}

export function parseColossusHtml(html: string, sourceUrl: string): ScraperResult {
  const $ = cheerio.load(html);

  // Content gate check — must come first
  if ($("div.content-gate-obscure").length > 0) {
    throw new Error(
      "Content gate detected — transcript is truncated. Auth may have failed."
    );
  }

  // Title
  const title = $("h1.single-podcast-episode-header__title").text().trim();

  // Date (appears twice — mobile + desktop; grab first)
  const rawDate = $("p.single-podcast-episode-header__date").first().text().trim();
  const appearanceDate = parseColossusDate(rawDate);

  // Episode number
  const epText = $(
    "p.single-podcast-episode-header__podcast-episode-number"
  )
    .text()
    .trim();
  const epMatch = epText.match(/Episode\s+(\d+)/);
  const episodeNumber = epMatch ? parseInt(epMatch[1], 10) : null;

  // Source / podcast name
  const sourceName =
    $("p.single-podcast-episode-header__podcast-name a").first().text().trim() ||
    "Invest Like the Best";

  // Section headings
  const sections: SectionHeading[] = [];
  $("div.transcript__content h2").each((_, el) => {
    const h2 = $(el);
    const anchor = h2.find("a[id]").attr("id") ?? "";
    const heading = h2.text().trim();
    if (heading) {
      sections.push({ heading, anchor });
    }
  });

  // Transcript — speaker blocks
  const speakerMap = new Map<string, SpeakerRole>();
  let currentSpeaker = "";
  const blocks: string[] = [];
  let currentLines: string[] = [];

  $("div.transcript__content > p").each((_, el) => {
    const p = $(el);

    if (p.attr("data-transcript-speaker-changed") !== undefined) {
      // Flush previous block
      if (currentSpeaker && currentLines.length > 0) {
        blocks.push(`${currentSpeaker}:\n${currentLines.join("\n")}`);
      }

      // New speaker
      const speakerSpan = p.find("span.transcript__speaker");
      if (speakerSpan.length) {
        currentSpeaker = speakerSpan.text().trim();
      }

      const role: SpeakerRole =
        p.attr("data-transcript-host") !== undefined ? "host" : "guest";
      if (currentSpeaker && !speakerMap.has(currentSpeaker)) {
        speakerMap.set(currentSpeaker, role);
      }

      currentLines = [extractParagraphText($, el)];
    } else {
      // Continuation paragraph under same speaker
      const text = extractParagraphText($, el);
      if (text) {
        currentLines.push(text);
      }
    }
  });

  // Flush last block
  if (currentSpeaker && currentLines.length > 0) {
    blocks.push(`${currentSpeaker}:\n${currentLines.join("\n")}`);
  }

  const rawTranscript = blocks.join("\n\n");

  // Build speakers array
  const speakers: Speaker[] = Array.from(speakerMap.entries()).map(
    ([name, role]) => ({ name, role })
  );

  return {
    title,
    appearanceDate,
    sourceName,
    transcriptSource: "colossus",
    speakers,
    rawTranscript,
    captionData: {
      ...(episodeNumber != null ? { episodeNumber } : {}),
      sections,
    },
    sections,
    sourceUrl,
  };
}

// ---------------------------------------------------------------------------
// Playwright auth + fetch
// ---------------------------------------------------------------------------

const LOGIN_URL = "https://colossus.com/login/";

async function fetchAuthenticatedHtml(url: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const email = process.env.COLOSSUS_EMAIL;
    const password = process.env.COLOSSUS_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "COLOSSUS_EMAIL and COLOSSUS_PASSWORD env vars are required for authenticated scraping"
      );
    }

    const page = await browser.newPage();

    // Login via the dedicated login page (the embedded content-gate form
    // doesn't reliably set cookies in headless mode)
    await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
    await page.fill('input[name="username"]', email);
    await page.fill('input[name="password"]', password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      page.click('input[name="uwp_login_submit"]'),
    ]);

    // Navigate to the episode page with auth cookies
    await page.goto(url, { waitUntil: "networkidle" });

    return await page.content();
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scrapeColossusPage(
  url: string
): Promise<ScraperResult> {
  const html = await fetchAuthenticatedHtml(url);
  return parseColossusHtml(html, url);
}

export const colossusScraper: Scraper = {
  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname === "www.colossus.com" ||
        parsed.hostname === "colossus.com"
      );
    } catch {
      return false;
    }
  },

  extract(url: string): Promise<ScraperResult> {
    return scrapeColossusPage(url);
  },
};

// ---------------------------------------------------------------------------
// CLI entry point: npx tsx lib/scrapers/colossus.ts <url>
// ---------------------------------------------------------------------------

const isCLI =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].includes("colossus");

if (isCLI) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx lib/scrapers/colossus.ts <episode-url>");
    process.exit(1);
  }

  scrapeColossusPage(url)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err: unknown) => {
      console.error("Scrape failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
