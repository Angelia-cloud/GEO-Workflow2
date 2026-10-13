# Intent and engine name mappings

Defined in `backend/app/services/name_mappings.py` and applied **at read time** by the monthly report
(`services/monthly.py`). Raw measurements, intents and engines in Supabase are never modified.

- Matching is case-insensitive and ignores extra whitespace.
- A name that is not listed is shown unchanged.
- Rows that map to the same canonical name are merged in the engine, intent and competitor tables, so
  month-over-month comparisons use one definition.

| Kind | Variants | Canonical name |
|---|---|---|
| Intent | Romance and events / Romance & Events | Romance & Events |
| Intent | Business / Bleisure, Business/Bleisure, Business and Bleisure | Business / Bleisure |
| Intent | Wellness and spa / Wellness & Spa | Wellness & Spa |
| Intent | Dining led discovery / Dining-Led Discovery | Dining-Led Discovery |
| Intent | Luxury Coastal Stay, Family Stays | (case variants only) |
| Engine | Google AI Overview(s), AI Overview(s) | Google AI Overview |
| Engine | Bing Copilot, Copilot, Microsoft Copilot | Bing Copilot |
| Engine | ChatGPT, Chat GPT, OpenAI ChatGPT | ChatGPT |
| Engine | Claude, Anthropic Claude | Claude |
| Engine | Gemini, Google Gemini | Gemini |
| Engine | Perplexity, Perplexity AI | Perplexity |

To add a mapping, edit the two dictionaries and this table.
