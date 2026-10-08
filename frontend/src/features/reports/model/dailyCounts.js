/** Distinct answers per day and per engine for a set of normalised Rankscale records. */
const dayMs = (A) => new Date(`${A}T00:00:00.000Z`).getTime(),
  isoDay = (A) => new Date(A).toISOString().slice(0, 10);
function dailyAndEngineCounts(A, e) {
  const t = new Map(),
    i = new Map();
  for (const a of A) {
    if (!t.has(a.date)) {
      t.set(a.date, {
        date: a.date,
        answers: new Set(),
        recordCount: 0,
      });
    }
    const r = t.get(a.date);
    r.answers.add(a.answerId);
    r.recordCount += 1;
    if (!i.has(a.engine)) {
      i.set(a.engine, {
        engine: a.engine,
        answers: new Set(),
        prompts: new Set(),
        recordCount: 0,
      });
    }
    const l = i.get(a.engine);
    l.answers.add(a.answerId);
    l.prompts.add(a.prompt);
    l.recordCount += 1;
  }
  const n = [...t.values()]
      .sort((a, r) => a.date.localeCompare(r.date))
      .map(({ date, answers, recordCount }) => ({
        date: date,
        answerCount: answers.size,
        recordCount: recordCount,
      })),
    o = new Map(n.map((a) => [a.date, a]));
  if (e?.from && e?.to) {
    const a = dayMs(e.from),
      r = dayMs(e.to);
    if (Number.isFinite(a) && Number.isFinite(r) && a <= r) {
      const l = (s) => {
        if (s < a || s > r) {
          return;
        }
        const c = isoDay(s);
        if (!o.has(c)) {
          o.set(c, {
            date: c,
            answerCount: 0,
            recordCount: 0,
          });
        }
      };
      l(a);
      l(r);
      for (const s of n) {
        const c = dayMs(s.date);
        l(c - 864e5);
        l(c + 864e5);
      }
    }
  }
  return {
    daily: n,
    chartDays: [...o.values()].sort((a, r) => a.date.localeCompare(r.date)),
    engines: [...i.values()]
      .map(({ engine, answers, prompts, recordCount }) => ({
        engine: engine,
        answerCount: answers.size,
        promptCount: prompts.size,
        recordCount: recordCount,
      }))
      .sort((a, r) => r.answerCount - a.answerCount || a.engine.localeCompare(r.engine)),
  };
}
export { dailyAndEngineCounts };
