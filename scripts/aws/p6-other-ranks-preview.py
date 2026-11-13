#!/usr/bin/env python3
"""P6: the old typed "Other" ranks on jobs, read-only. Reads "count<TAB>text" lines (one per distinct typed text) on
stdin and prints counts, plus the normalised text of each one that clearly names existing ranks with those ranks.
Unclear texts are counted only, never printed. Matching is exactly src/features/roles/other-rank-matcher.ts, with its
lookup from src/features/roles/other-rank-lookup.json (a test keeps the two equal)."""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "..", "..", "src", "features", "roles", "other-rank-lookup.json"), encoding="utf-8"))
LOOKUP = DATA["lookup"]
SEPARATORS = DATA["separators"]


def normalise(text):
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return re.sub(r"\s+", " ", text)


def match_part(text, depth):
    key = LOOKUP.get(normalise(text)) if normalise(text) else None
    if key:
        return [key]
    if depth > 3:
        return None
    for separator in SEPARATORS:
        if separator not in text:
            continue
        parts = [part.strip() for part in text.split(separator) if part.strip()]
        if len(parts) < 2:
            continue
        keys = []
        for part in parts:
            matched = match_part(part, depth + 1)
            if matched is None:
                return None
            keys.extend(matched)
        seen = []
        for key in keys:
            if key not in seen:
                seen.append(key)
        return seen
    return None


def match(text):
    if not text or not text.strip():
        return None
    return match_part(text.lower(), 0)


def main():
    jobs = texts = clear_jobs = clear_texts = 0
    clear = {}
    for line in sys.stdin:
        line = line.rstrip("\n")
        if not line or "\t" not in line:
            continue
        count, text = line.split("\t", 1)
        count = int(count)
        jobs += count
        texts += 1
        keys = match(text)
        if keys:
            clear_jobs += count
            clear_texts += 1
            pattern = normalise(text)
            entry = clear.setdefault((pattern, ",".join(keys)), 0)
            clear[(pattern, ",".join(keys))] = entry + count
    print("P6_OTHER_RANKS jobs_with_typed_other=%d distinct_texts=%d clear_jobs=%d clear_texts=%d unclear_jobs=%d unclear_texts=%d"
          % (jobs, texts, clear_jobs, clear_texts, jobs - clear_jobs, texts - clear_texts))
    for (pattern, keys), count in sorted(clear.items(), key=lambda item: (-item[1], item[0])):
        print("P6_OTHER_RANK_CLEAR pattern=%s ranks=%s jobs=%d" % (json.dumps(pattern), keys, count))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--match-json":
        # Test hook: JSON list of texts in, JSON list of matches out.
        print(json.dumps([match(text) for text in json.loads(sys.stdin.read())]))
    else:
        main()
