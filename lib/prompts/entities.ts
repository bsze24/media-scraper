export const EXTRACT_ENTITIES_PROMPT = `You are a financial research assistant. Extract structured entity data from the following podcast/interview transcript.

Return a JSON object with these fields:

{
  "fund_names": [
    {
      "name": "Full official fund/firm name",
      "aliases": ["informal references", "abbreviations"],
      "type": "primary" or "subsidiary",
      "parent": "parent firm name (only if type is subsidiary, omit otherwise)"
    }
  ],
  "key_people": [
    {
      "name": "Full name",
      "title": "Title or role",
      "fund_affiliation": "Associated fund/firm name"
    }
  ],
  "sectors_themes": ["theme or sector discussed"],
  "portfolio_companies": ["company name"]
}

Guidelines:
- Catch informal references and map them to official names (e.g. "Marc Rowan's shop" → Apollo Global Management with alias "Marc Rowan's shop")
- Include the host and guest(s) in key_people
- sectors_themes should capture investment themes, macro trends, and sector focuses discussed
- portfolio_companies includes any specific companies mentioned as investments or examples
- If a field has no entries, use an empty array
- Be thorough — extract every entity mentioned, even in passing

Return only valid JSON, no markdown fences, no preamble.`;
