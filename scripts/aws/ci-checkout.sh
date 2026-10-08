#!/usr/bin/env bash
# Runner side of the bootstrap host checkout (private repository: the host never talks to GitHub).
#
#   publish <sha> [--history]  Bundle the exact commit checked out on this runner (depth 1, or the full history of the
#                              deploy branch with --history), upload it to the private migration bucket under a
#                              per-run key and record it in $RUNNER_TEMP/ci-checkout.json for scripts/aws/ci_checkout.py.
#                              Also starts the branch-head publisher below.
#   serve-head <key>           Every 5 s, write the live head of the deploy branch (git ls-remote on this runner, with
#                              the job's own token) to s3://<bucket>/<key>.head, keeping only the latest version. The
#                              host's moved-branch checks read it through scripts/aws/branch-head.sh.
#   cleanup                    Stop the publisher and delete every object version this job wrote (if: always()).
#
# The runner's deploy role may only put, delete and delete versions under ci-checkouts/; it cannot read or list.
set -euo pipefail
umask 077

BUCKET="sea-n-shore-staging-310356785722-migration"
REGION="ap-south-1"
BRANCH="feat/aws-native-phase-0-1"
STATE_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}"
STATE="$STATE_DIR/ci-checkout.json"
SERVE_DIR="$STATE_DIR/ci-checkout-serve"

s3() { aws s3api --region "$REGION" "$@"; }

publish() {
  local sha="${1:-}" history=false
  [[ "${2:-}" == "--history" ]] && history=true
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "ci-checkout: expected an exact commit SHA." >&2; exit 1; }
  [[ "$(git rev-parse HEAD)" == "$sha" ]] || { echo "ci-checkout: the runner checkout is not at $sha." >&2; exit 1; }
  [[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ && "${GITHUB_JOB:-}" =~ ^[A-Za-z0-9_-]+$ ]] || {
    echo "ci-checkout: GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT and GITHUB_JOB are required." >&2; exit 1; }

  local refs=(refs/ci-checkout)
  if [[ "$history" == true ]]; then
    [[ "$(git rev-parse --is-shallow-repository)" == false ]] || { echo "ci-checkout: --history needs fetch-depth: 0." >&2; exit 1; }
    git merge-base --is-ancestor "$sha" "refs/remotes/origin/$BRANCH" || {
      echo "ci-checkout: $sha is not on origin/$BRANCH." >&2; exit 1; }
    refs+=("refs/remotes/origin/$BRANCH")
  fi

  [[ -f "$STATE" ]] || echo '[]' > "$STATE"
  local seq key bundle version
  seq="$(jq 'length' "$STATE")"
  key="ci-checkouts/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_JOB}-${seq}-${sha}"
  bundle="$(mktemp "$STATE_DIR/ci-checkout.XXXXXXXX")"
  git update-ref refs/ci-checkout "$sha"
  git bundle create --quiet "$bundle" "${refs[@]}"
  git update-ref -d refs/ci-checkout
  version="$(s3 put-object --bucket "$BUCKET" --key "$key.bundle" --body "$bundle" --query VersionId --output text)"
  rm -f -- "$bundle"
  [[ "$version" =~ ^[A-Za-z0-9._-]+$ && "$version" != None && "$version" != null ]] || {
    echo "ci-checkout: the bucket did not return a version id." >&2; exit 1; }
  jq --arg sha "$sha" --arg key "$key" --arg version "$version" --argjson history "$history" \
    '. + [{sha: $sha, key: $key, version: $version, history: $history}]' "$STATE" > "$STATE.tmp"
  mv -- "$STATE.tmp" "$STATE"
  echo "CI_CHECKOUT_PUBLISHED key=$key history=$history"

  mkdir -p "$SERVE_DIR"
  setsid nohup bash "${BASH_SOURCE[0]}" serve-head "$key" > "$SERVE_DIR/$seq.log" 2>&1 < /dev/null &
  echo "$!" > "$SERVE_DIR/$seq.pid"
}

serve_head() {
  local key="${1:-}" seq version="" previous="" head body
  [[ "$key" =~ ^ci-checkouts/[0-9]+-[0-9]+-[A-Za-z0-9_-]+-([0-9]+)-[0-9a-f]{40}$ ]] || exit 1
  seq="${BASH_REMATCH[1]}"
  body="$(mktemp "$STATE_DIR/ci-checkout-head.XXXXXXXX")"
  # At most two hours, the longest job timeout; cleanup stops it sooner.
  for _ in $(seq 1 1440); do
    [[ -e "$SERVE_DIR/$seq.stop" ]] && break
    head="$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)" || head=""
    if [[ "$head" =~ ^[0-9a-f]{40}$ ]]; then
      printf '%s\trefs/heads/%s\n' "$head" "$BRANCH" > "$body"
      if version="$(s3 put-object --bucket "$BUCKET" --key "$key.head" --body "$body" --query VersionId --output text)"; then
        echo "$version" > "$SERVE_DIR/$seq.version"
        [[ -z "$previous" ]] || s3 delete-object --bucket "$BUCKET" --key "$key.head" --version-id "$previous" >/dev/null || true
        previous="$version"
      fi
    fi
    sleep 5
  done
  rm -f -- "$body"
}

cleanup() {
  [[ -f "$STATE" ]] || { echo "CI_CHECKOUT_CLEANUP nothing published"; return 0; }
  local failed=0 n seq key version
  n="$(jq 'length' "$STATE")"
  for ((seq = 0; seq < n; seq++)); do
    touch "$SERVE_DIR/$seq.stop" 2>/dev/null || true
  done
  for ((seq = 0; seq < n; seq++)); do
    local pid=""
    pid="$(cat "$SERVE_DIR/$seq.pid" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      kill -9 "$pid" 2>/dev/null || true
    fi
    key="$(jq -r ".[$seq].key" "$STATE")"
    version="$(jq -r ".[$seq].version" "$STATE")"
    # Deleting a version that the host already deleted succeeds.
    s3 delete-object --bucket "$BUCKET" --key "$key.bundle" --version-id "$version" >/dev/null || failed=1
    version="$(cat "$SERVE_DIR/$seq.version" 2>/dev/null || true)"
    if [[ -n "$version" ]]; then
      s3 delete-object --bucket "$BUCKET" --key "$key.head" --version-id "$version" >/dev/null || failed=1
    fi
  done
  rm -rf -- "$STATE" "$SERVE_DIR"
  [[ "$failed" == 0 ]] || { echo "ci-checkout: could not delete every checkout object." >&2; exit 1; }
  echo "CI_CHECKOUT_CLEANUP deleted=$n"
}

case "${1:-}" in
  publish) shift; publish "$@" ;;
  serve-head) shift; serve_head "$@" ;;
  cleanup) cleanup ;;
  *) echo "usage: ci-checkout.sh publish <sha> [--history] | serve-head <key> | cleanup" >&2; exit 1 ;;
esac
