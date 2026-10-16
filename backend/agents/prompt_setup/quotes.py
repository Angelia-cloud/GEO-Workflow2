"""Find the transcript passage an LLM quoted, even when the quote is not character-perfect.

Models often change punctuation, casing, curly quotes, speaker labels or a word or two when they "copy"
a passage. An exact-substring check then throws away intents the transcript really supports. Here a quote
is accepted when (almost) all of its words appear, in order, in one place in the transcript, and the
passage returned is the transcript's own text, so what is stored and shown is always a real excerpt.
"""
from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher

WORD = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)?")
MIN_WORDS = 3          # shorter quotes prove nothing
MIN_COVERAGE = 0.8     # share of the quote's words that must match, in order


def _words(text: str) -> list[str]:
    return WORD.findall(str(text).lower().replace("’", "'").replace("‘", "'"))


class Transcript:
    def __init__(self, text: str):
        self.text = str(text or "")
        lowered = self.text.lower().replace("’", "'").replace("‘", "'")
        self.words: list[str] = []
        self.spans: list[tuple[int, int]] = []
        for match in WORD.finditer(lowered):
            self.words.append(match.group())
            self.spans.append(match.span())
        self._shingles: dict[tuple[str, str, str], list[int]] = {}
        for i in range(len(self.words) - 2):
            self._shingles.setdefault(tuple(self.words[i:i + 3]), []).append(i)

    def _excerpt(self, first: int, last: int) -> str:
        start, end = self.spans[first][0], self.spans[last][1]
        return " ".join(self.text[start:end].split())

    def find(self, quote: str) -> str | None:
        """The transcript passage the quote comes from, or None when the transcript does not say it."""
        words = _words(quote)
        if len(words) < MIN_WORDS or not self.words:
            return None
        # where in the transcript do the quote's three-word sequences point?
        votes: Counter[int] = Counter()
        for offset in range(len(words) - 2):
            for position in self._shingles.get(tuple(words[offset:offset + 3]), ()):
                votes[position - offset] += 1
        best: tuple[float, int, int] | None = None
        for start, _count in votes.most_common(5):
            lo = max(0, start - 3)
            hi = min(len(self.words), start + len(words) + 3)
            window = self.words[lo:hi]
            matcher = SequenceMatcher(None, words, window, autojunk=False)
            blocks = [b for b in matcher.get_matching_blocks() if b.size]
            matched = sum(b.size for b in blocks)
            coverage = matched / len(words)
            if blocks and (best is None or coverage > best[0]):
                first = lo + blocks[0].b
                last = lo + blocks[-1].b + blocks[-1].size - 1
                best = (coverage, first, last)
        if best is None or best[0] < MIN_COVERAGE:
            return None
        return self._excerpt(best[1], best[2])
