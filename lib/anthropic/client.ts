import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function createAnthropicClient(): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  client = new Anthropic({ apiKey });
  return client;
}
