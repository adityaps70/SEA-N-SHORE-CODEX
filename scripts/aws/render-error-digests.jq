# Read-only log diagnostic (hotfix, Oct 2026). Input: `aws logs filter-log-events` JSON for the web container.
# Output, one TSV row per server render error digest: count, digest, first seen (UTC), last seen (UTC), then the
# lines before its first `digest:` line in the same log stream (where Next.js prints the error and its stack).
# The browser only shows the digest ("reference 1014826221"); this ties it to the server-side message.
[.events[]]
| group_by(.logStreamName)
| [
    .[] as $stream
    | $stream
    | range(0; length) as $i
    | ($stream[$i].message | capture("digest: *['\"]?(?<digest>[A-Za-z0-9@_-]+)")) as $match
    | {
        digest: $match.digest,
        at: (($stream[$i].timestamp / 1000) | floor | todate),
        context: ([$stream[([$i - 6, 0] | max):($i + 1)][] | .message | gsub("\\s+"; " ")] | join(" ") | .[0:700])
      }
  ]
| group_by(.digest)
| map(sort_by(.at) | {count: length, digest: .[0].digest, first: .[0].at, last: .[-1].at, context: .[0].context})
| sort_by(-.count)
| .[]
| [.count, .digest, .first, .last, .context]
| @tsv
