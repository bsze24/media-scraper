import type { Scraper } from "@/types/scraper";
import type { TranscriptSource } from "@/types/appearance";
import { colossusScraper } from "./colossus";
import { youtubeScraper } from "./youtube";

const scrapers: Scraper[] = [colossusScraper, youtubeScraper];

export function getScraperForUrl(url: string): Scraper {
  const match = scrapers.find((s) => s.canHandle(url));
  if (!match) {
    throw new Error(`No scraper available for URL: ${url}`);
  }
  return match;
}

export function detectTranscriptSource(url: string): TranscriptSource {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (hostname === "www.colossus.com" || hostname === "colossus.com") {
    return "colossus";
  }

  if (
    hostname === "www.youtube.com" ||
    hostname === "youtube.com" ||
    hostname === "youtu.be" ||
    hostname === "m.youtube.com"
  ) {
    return "youtube_captions";
  }

  throw new Error(`Unknown transcript source for URL: ${url}`);
}
