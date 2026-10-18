# Read-only log diagnostic (hotfix, Oct 2026). Input: `aws logs filter-log-events` JSON holding the web container's
# csp_violation_summary lines (src/lib/security/csp-report-summary.ts: directive, bare blocked host, count; no URLs,
# paths or samples). Output: SUMMARY_LINES, TOTAL_REPORTS, FIRST and LAST (UTC), then one TSV row per directive and
# blocked host, most reports first.
[.events[] | {at: ((.timestamp / 1000) | floor | todate), summary: (.message | fromjson? // empty)} | select(.summary.event == "csp_violation_summary")]
| . as $lines
| ([$lines[].summary.violations[]?] | group_by([.directive, .blocked]) | map({directive: .[0].directive, blocked: .[0].blocked, count: (map(.count) | add)}) | sort_by(-.count)) as $rows
| "CSP_SUMMARY_LINES=\($lines | length)",
  "CSP_TOTAL_REPORTS=\([$lines[].summary.total] | add // 0)",
  "CSP_FIRST_SUMMARY_AT=\($lines | map(.at) | min // "none")",
  "CSP_LAST_SUMMARY_AT=\($lines | map(.at) | max // "none")",
  ($rows[] | [.count, .directive, .blocked] | @tsv)
