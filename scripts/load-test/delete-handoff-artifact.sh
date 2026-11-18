#!/usr/bin/env bash
# The repository is public (18 Nov): deletes this run's sealed-handoff artifact (the shards' sealed sessions) and
# prints how many are left, which must be 0. Used by the monitor (once every shard has opened its part) and by the
# report job (whatever happened). Needs GH_TOKEN with actions: write.
set -euo pipefail
API="${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY}"
HEADERS=(-H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json")
LIST="$API/actions/runs/${GITHUB_RUN_ID}/artifacts?name=sealed-handoff&per_page=100"
for id in $(curl -fsS "${HEADERS[@]}" "$LIST" | jq -r '.artifacts[].id'); do
  [[ "$id" =~ ^[0-9]+$ ]] || { echo "Unexpected artifact id." >&2; exit 1; }
  curl -fsS -X DELETE "${HEADERS[@]}" "$API/actions/artifacts/$id" >/dev/null
done
LEFT="$(curl -fsS "${HEADERS[@]}" "$LIST" | jq '.total_count')"
echo "LOAD_TEST_HANDOFF_ARTIFACTS_LEFT=$LEFT"
[[ "$LEFT" == 0 ]]
