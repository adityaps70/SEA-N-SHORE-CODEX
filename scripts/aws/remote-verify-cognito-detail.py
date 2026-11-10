#!/usr/bin/env python3
"""Round ARCH: report-only detail for "CognitoApiError: Cognito request failed." in Remote Verify.

That message hides which Cognito error it was (src/lib/auth/cognito-api.ts: any code without a safe message, a
transport error or timeout, or an unexpected response). For each such log line, this reads the lines the same log
stream wrote within the next 2 seconds (Node prints the error's fields and stack as separate lines) and prints only:
  - the error code, from a line like `code: 'TransportError'` (letters only);
  - the app route, from a stack frame path like `.next/server/app/api/realtime/ticket/route.js` (code paths only).
Nothing else from the log is printed, so no member data can come out. It never changes the run's result.

Usage: remote-verify-cognito-detail.py CLOUDWATCH_FILTER_LOG_EVENTS_JSON
Prints: COGNITO_FAILED_DETAIL count=<n> code=<code|unknown> route=<route|unknown>  (one line per combination)
        COGNITO_FAILED_TOTAL=<n>
"""
import json
import re
import sys
from collections import Counter

MARKER = re.compile(r"\[CognitoApiError\]: Cognito request failed\.")
CODE = re.compile(r"\bcode: '([A-Za-z]{1,64})'")
ROUTE = re.compile(r"\.next/server/app/((?:[A-Za-z0-9_\-\[\]().@]+/){0,8}?)(page|route)\.js")
WINDOW_MS = 2_000
MAX_FOLLOWING = 60


def detail(events):
    by_stream = {}
    for event in events:
        by_stream.setdefault(event.get("logStreamName", ""), []).append(event)
    counts = Counter()
    for stream_events in by_stream.values():
        stream_events.sort(key=lambda e: (e.get("timestamp", 0), e.get("eventId", "")))
        for index, event in enumerate(stream_events):
            message = event.get("message", "")
            if not MARKER.search(message):
                continue
            code, route = None, None
            # The error's own event may already hold its fields and stack (multi-line message).
            candidates = [message]
            for following in stream_events[index + 1:index + 1 + MAX_FOLLOWING]:
                if following.get("timestamp", 0) - event.get("timestamp", 0) > WINDOW_MS:
                    break
                if MARKER.search(following.get("message", "")):
                    break
                candidates.append(following.get("message", ""))
            for text in candidates:
                if code is None:
                    match = CODE.search(text)
                    if match:
                        code = match.group(1)
                if route is None:
                    match = ROUTE.search(text)
                    if match:
                        route = "/" + match.group(1).rstrip("/") if match.group(1) else "/"
                        route += " (%s)" % match.group(2)
            counts[(code or "unknown", route or "unknown")] += 1
    return counts


def main(argv):
    with open(argv[1]) as handle:
        events = json.load(handle).get("events", [])
    counts = detail(events)
    for (code, route), count in counts.most_common():
        print("COGNITO_FAILED_DETAIL count=%d code=%s route=%s" % (count, code, route))
    print("COGNITO_FAILED_TOTAL=%d" % sum(counts.values()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
