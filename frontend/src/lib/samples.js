const SAMPLE_TRANSCRIPT = `SYNTHETIC EXAMPLE ONLY \u2014 NOT A REAL CLIENT
Prompt kickoff transcript: Harbour Lantern Hotel (fictional)
Prepared for testing the Prompt import flow.

Facilitator: Tell us about the property.
Client: Harbour Lantern Hotel is a fictional independent coastal hotel in the
imaginary town of Lantern Bay. Our example website is harbour-lantern.example.
We have 60 rooms, family suites, a small spa, a restaurant and two meeting rooms.

Facilitator: What do you want guests to discover?
Client: We want to be considered for family coastal breaks, relaxing couples'
weekends and small business retreats. Help guests compare the stay with their
needs, including room layout, dining choices and access to the beach.

Facilitator: Who are the main audiences?
Client: Families seeking connecting rooms; couples planning a quiet weekend;
and organisers arranging a two-day team retreat for 10 to 20 people.

Facilitator: Which questions should the prompts explore?
Client: Where can a family stay near Lantern Bay beach with connecting rooms?
Which Lantern Bay hotel suits a relaxing couples' weekend with spa and dining?
Where can a small team stay and meet together in Lantern Bay?

Facilitator: What makes each offer useful?
Client: Family suites have a kitchenette. The spa offers pre-booked treatments.
Meeting rooms have screens and a shared lunch option. These are invented details
for a UI example; they must not be presented as facts about a real property.

Facilitator: What should the content avoid?
Client: Do not claim awards, verified accessibility, lowest prices or rankings.
Use clear language, focus on guest needs and keep all results labelled as examples.

Facilitator: What would success look like?
Client: A useful set of questions across ChatGPT, Gemini and Perplexity, covering
the three audiences. We will use the exported CSV to inspect the user experience.

END OF SYNTHETIC TRANSCRIPT
`,
  SAMPLE_DATES = ["2026-07-01", "2026-08-15", "2026-09-01", "2026-09-15", "2026-09-30", "2026-10-02"],
  SAMPLE_ENGINES = ["chatgpt_gui", "gemini_gui", "perplexity_gui"],
  SAMPLE_QUERIES = [
    {
      topic: "Family coastal stay",
      query: "Which fictional Lantern Bay hotel has connecting rooms for a family beach stay?",
      answer: "Harbour Lantern Hotel is an invented option with family suites and a kitchenette.",
    },
    {
      topic: "Couples weekend",
      query: "Where could a couple plan a quiet spa and dining weekend in fictional Lantern Bay?",
      answer: "Harbour Lantern Hotel is an invented option with a small spa and restaurant.",
    },
    {
      topic: "Small business retreat",
      query: "Which fictional Lantern Bay hotel could host a two-day retreat for a team of 12?",
      answer:
        "Harbour Lantern Hotel is an invented option with two meeting rooms and a shared lunch package.",
    },
  ],
  csvQuote = (A) => `"${String(A).replaceAll('"', '""')}"`,
  SAMPLE_COLUMNS = [
    "timestamp",
    "query",
    "ai_engine",
    "result_text",
    "brand_reference",
    "brand_found",
    "brand_name_mentioned",
    "brand_rank",
    "sentiment",
    "topic_name",
    "data_type",
  ],
  SAMPLE_ROWS = SAMPLE_DATES.flatMap((A, e) =>
    SAMPLE_ENGINES.flatMap((t, i) =>
      SAMPLE_QUERIES.map((n, o) => {
        const a = (e + i + o) % 4 !== 0;
        return [
          `${A}T09:${String(o * 10).padStart(2, "0")}:00Z`,
          n.query,
          t,
          `SYNTHETIC EXAMPLE ONLY. ${a ? n.answer : "This invented answer gives general planning advice and does not name a property."} This is not a real response from an AI engine.`,
          "Harbour Lantern Hotel (fictional)",
          a ? "yes" : "no",
          a ? "Harbour Lantern Hotel (fictional)" : "",
          a ? 1 + ((e + i + o) % 3) : "",
          a ? "0.6" : "",
          n.topic,
          "synthetic_example",
        ];
      }),
    ),
  ),
  SAMPLE_RANKSCALE_CSV =
    [SAMPLE_COLUMNS, ...SAMPLE_ROWS].map((A) => A.map(csvQuote).join(",")).join(`\r
`) +
    `\r
`,
  SAMPLE_FILES = Object.freeze({
    prompt: Object.freeze({
      filename: "Komosion-Prompt-Synthetic-Transcript.txt",
      type: "text/plain;charset=utf-8",
      label: "Sample transcript",
      description: "Fictional hotel kickoff transcript for the Prompt import flow.",
      content: SAMPLE_TRANSCRIPT,
    }),
    rankscale: Object.freeze({
      filename: "Komosion-Rankscale-Synthetic-Data.csv",
      type: "text/csv;charset=utf-8",
      label: "Sample Rankscale data",
      description:
        "54 fictional records, 3 prompts and 3 engines, from 1 July to 2 October 2026. September contains 27 records.",
      content: SAMPLE_RANKSCALE_CSV,
    }),
  });
function downloadSample(A) {
  const e = SAMPLE_FILES[A];
  if (!e) {
    throw new Error("Choose a Prompt or Rankscale sample.");
  }
  const t = URL.createObjectURL(
      new Blob([e.content], {
        type: e.type,
      }),
    ),
    i = document.createElement("a");
  i.href = t;
  i.download = e.filename;
  document.body.append(i);
  i.click();
  i.remove();
  setTimeout(() => URL.revokeObjectURL(t), 1e3);
}
export { downloadSample };
