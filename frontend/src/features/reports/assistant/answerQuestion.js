import { text } from "./reportContext";
const STOP_WORDS = new Set(
    "a an the what whats is are was were be been do does did can could would should i we you our us my your this that it its for of to in on at by with and or as how why please tell me about explain show give report client hotel property brand score main key best most much many has have had from them they their than which when where want know need help understand tell me".split(
      " ",
    ),
  ),
  keywords = (A) => [
    ...new Set(
      text(A)
        .toLowerCase()
        .replace(/['’]s\b/g, "")
        .replace(/[^a-z0-9.]+/g, " ")
        .split(/\s+/)
        .filter((e) => e && !STOP_WORDS.has(e)),
    ),
  ],
  OUT_OF_SCOPE =
    /\b(revenue|profit|roi|bookings?|occupancy|weather|stock|investment|medical|recipe|code|javascript|password|forecast|predict|guarantee|guaranteed|guarantees)\b/i,
  CONFIDENCE_QUESTION = /\b(confidence|certain|reliable|trust|accuracy)\b/i;
function noAnswer(A, e = "No sufficiently specific topic match was found in this report.") {
  return {
    text: A?.ready
      ? `I can answer questions covered by ${A.client.name}\u2019s report for ${A.periodLabel}. I could not find enough evidence here to answer that question. Try the summary, detection rate, recommendations or methodology.`
      : "A report is needed before I can answer questions. Choose a client and reporting dates with available data.",
    confidence: null,
    confidenceReason: e,
    sources: [],
    supported: false,
  };
}
function answerQuestion(A, e) {
  if (!A?.ready || !Array.isArray(A.topics)) {
    return noAnswer(A, "No report is available for the selected client and dates.");
  }
  const t = text(e).slice(0, 2e3),
    i = keywords(t);
  if (!i.length) {
    return noAnswer(A);
  }
  if (OUT_OF_SCOPE.test(t)) {
    return noAnswer(A, "The requested outcome or topic is not measured in this report.");
  }
  if (/\b(ignore|override|instructions?|system prompt|pretend|make up|invent)\b/i.test(t)) {
    return noAnswer(A, "This assistant only retrieves evidence from the selected report.");
  }
  const n = A.topics
    .map((M) => {
      const h = new Set(keywords(M.terms)),
        U = i.filter((I) => h.has(I));
      return {
        item: M,
        matched: U,
      };
    })
    .filter((M) => M.matched.length)
    .sort((M, h) => h.matched.length - M.matched.length);
  if (!n.length) {
    return noAnswer(A);
  }
  const o = n.filter((M) => !["summary", "method"].includes(M.item.id)),
    a = o.length ? o[0] : n[0],
    r = [a],
    l = i.filter((M) => !a.matched.includes(M)),
    s = n.find(
      (M) => M !== a && M.matched.some((h) => l.includes(h)) && !["summary", "method"].includes(M.item.id),
    );
  if (s && l.length > 0) {
    r.push(s);
  }
  const c = new Set(r.flatMap((M) => M.matched)),
    d = Math.round((c.size / i.length) * 100);
  if (d < 50) {
    return noAnswer(
      A,
      "Fewer than half of the question\u2019s topic terms matched evidence available in this report.",
    );
  }
  const B = [...new Map(r.flatMap((M) => M.item.sources).map((M) => [M.id, M])).values()];
  return {
    text:
      (CONFIDENCE_QUESTION.test(t)
        ? `Chat confidence measures how closely question keywords match report topics. It is not the probability that an answer is correct, and it does not rate the underlying dataset.

`
        : "") +
      r.map((M) => M.item.text).join(`

`),
    confidence: d,
    confidenceReason: `${c.size} of ${i.length} topic terms matched the cited report sections. This is a keyword evidence-match score, not a probability of correctness.`,
    sources: B,
    supported: true,
  };
}
export { answerQuestion };
