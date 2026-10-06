#!/usr/bin/env bash
# Owner-approval guard for armed runs (replaces the staging-apply required reviewer, which GitHub Pro does not
# enforce on private repositories). Runs on the GitHub runner, in the job that reads the guard value.
#
# A guard value of plan or discover is read-only and passes. Any other value (apply-once, deploy-once,
# migrate-once, run-once, ...) must be written as "<action> <40-hex SHA>" and passes only when ALL of these hold:
#   1. the run's commit (GITHUB_SHA) is the merge commit of a pull request into feat/aws-native-phase-0-1 that is
#      merged and was merged by adityaps70;
#   2. that pull request changed exactly one file: this guard file;
#   3. the SHA in the guard file is an ancestor of GITHUB_SHA and the two differ only in this guard file, so the
#      code that runs is byte-for-byte the commit the arm names.
# Anything missing or unexpected refuses.
set -euo pipefail

OWNER_LOGIN="adityaps70"
BRANCH="feat/aws-native-phase-0-1"
GUARD_FILE="${GUARD_FILE:?GUARD_FILE is required}"
API="${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:?}"

[[ "$GUARD_FILE" =~ ^scripts/aws/[a-z0-9-]+-action\.txt$ ]] || { echo "arm-commit-guard: unexpected guard file $GUARD_FILE" >&2; exit 1; }
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "arm-commit-guard: GITHUB_SHA is required." >&2; exit 1; }
[[ -f "$GUARD_FILE" ]] || { echo "arm-commit-guard: $GUARD_FILE is missing." >&2; exit 1; }

CONTENT="$(cat "$GUARD_FILE")"
if [[ "$CONTENT" =~ ^(plan|discover)$ ]]; then
  echo "ARM_COMMIT_GUARD read_only action=${BASH_REMATCH[1]}"
  exit 0
fi
[[ "$CONTENT" =~ ^([a-z][a-z0-9:-]*)\ ([0-9a-f]{40})$ ]] || {
  echo "arm-commit-guard: an armed guard must read '<action> <40-hex SHA of the commit it arms>'." >&2
  exit 1
}
ACTION="${BASH_REMATCH[1]}"
ARMED_SHA="${BASH_REMATCH[2]}"
[[ "$ACTION" != plan && "$ACTION" != discover ]] || { echo "arm-commit-guard: a read-only value carries no SHA." >&2; exit 1; }

api() {
  curl -fsSL --retry 3 --retry-all-errors \
    -H "Authorization: Bearer ${GH_TOKEN:?GH_TOKEN is required}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$API/$1"
}

# 3. The run's code is exactly the armed commit plus the guard change.
COMPARE="$(api "compare/${ARMED_SHA}...${GITHUB_SHA}")"
jq -e --arg file "$GUARD_FILE" '
  .status == "ahead" and .behind_by == 0
  and ([.files[].filename] == [$file])
' <<<"$COMPARE" >/dev/null || {
  echo "arm-commit-guard: $GITHUB_SHA is not $ARMED_SHA plus only $GUARD_FILE (refusing; re-arm against the current head)." >&2
  exit 1
}

# 1. GITHUB_SHA is the merge commit of a merged PR into the deploy branch. The commit-to-PR index can lag a merge
# by a few seconds, so look a few times.
PR=""
for attempt in 1 2 3 4 5 6; do
  PR="$(api "commits/${GITHUB_SHA}/pulls" | jq -r --arg sha "$GITHUB_SHA" --arg base "$BRANCH" \
    '[.[] | select(.merge_commit_sha == $sha and .base.ref == $base and .merged_at != null)] | if length == 1 then .[0].number else "" end')"
  [[ -n "$PR" ]] && break
  sleep 10
done
[[ "$PR" =~ ^[0-9]+$ ]] || { echo "arm-commit-guard: $GITHUB_SHA is not the merge commit of a merged pull request into $BRANCH." >&2; exit 1; }

PULL="$(api "pulls/$PR")"
jq -e --arg sha "$GITHUB_SHA" --arg base "$BRANCH" --arg owner "$OWNER_LOGIN" '
  .merged == true and .merge_commit_sha == $sha and .base.ref == $base and .merged_by.login == $owner
' <<<"$PULL" >/dev/null || {
  echo "arm-commit-guard: pull request #$PR was not merged into $BRANCH by $OWNER_LOGIN." >&2
  exit 1
}

# 2. The pull request is the arm and nothing else.
FILES="$(api "pulls/$PR/files?per_page=100")"
jq -e --arg file "$GUARD_FILE" '[.[].filename] == [$file]' <<<"$FILES" >/dev/null || {
  echo "arm-commit-guard: pull request #$PR changed more than $GUARD_FILE." >&2
  exit 1
}

echo "ARM_COMMIT_GUARD armed action=$ACTION armed_sha=$ARMED_SHA pr=$PR merged_by=$OWNER_LOGIN"
