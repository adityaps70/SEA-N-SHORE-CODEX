#!/usr/bin/env bash
# Infra CI change scope (Actions minutes). Writes application=, terraform=, guard=, container=
# (true/false) to $GITHUB_OUTPUT. A heavy job is skipped only when every file it reads is
# byte-identical to a commit whose Infra CI passed; anything uncertain runs everything.
#   1. A merge whose tree is exactly its second parent's (an up-to-date PR branch): that branch's
#      passing run already verified this exact tree.
#   2. Otherwise, against the previous head of the branch (the push's "before"), if its run passed:
#      - Application verify and the Docker build read everything except workflows, docs, guard
#        values (scripts/aws/*-action.txt) and Terraform files;
#      - Terraform validate reads infra/aws/**;
#      - the plan guard tests read scripts/**, infra/aws/** and the npm manifests.
# The SSM execution contract job (guard and runner contract tests) is not scoped: it always runs.
#
# The Docker build runs only on the feature branch (the staging deploy builds the image again anyway). A push to
# any other branch never builds it. On the feature branch it builds when the image's inputs changed since the
# previous head whose Infra CI passed, including a merge that reuses its PR branch's checks (that branch did not
# build the image).
set -euo pipefail

FEATURE_REF="refs/heads/feat/aws-native-phase-0-1"
APP_IGNORED='^(\.github/|docs/|scripts/aws/[a-z0-9-]+-action\.txt$|infra/aws/.*\.(tf|hcl)$)'

ZERO=0000000000000000000000000000000000000000
JOBS=(application terraform guard container)

all() {
  for job in "${JOBS[@]}"; do echo "$job=$1"; done
}

ci_passed() {
  local api="https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=$1&event=push&per_page=100"
  curl -fsSL -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$api" \
    | jq -r '[.workflow_runs[] | select(.name == "AWS Infrastructure CI")][0].conclusion // "missing"' \
    || echo unavailable
}

# true when any changed file matches $1 (and, if given, does not match $2)
changed_any() {
  local hits
  hits="$(grep -E "$1" <<<"$CHANGED" || true)"
  [[ -n "${2:-}" && -n "$hits" ]] && hits="$(grep -vE "$2" <<<"$hits" || true)"
  [[ -n "$hits" ]]
}

# For a merge that reuses its PR branch's checks: did the image's inputs change since the previous head of this
# branch, and did that head's Infra CI pass? Any doubt builds the image.
image_changed_since_before() {
  if [[ ! "${BEFORE:-}" =~ ^[0-9a-f]{40}$ || "$BEFORE" == "$ZERO" ]]; then echo true; return; fi
  if ! git cat-file -e "${BEFORE}^{commit}" 2>/dev/null && ! git fetch --quiet --no-tags --depth=1 origin "$BEFORE"; then echo true; return; fi
  if [[ "$(ci_passed "$BEFORE")" != "success" ]]; then echo true; return; fi
  if git diff --name-only "$BEFORE" "$GITHUB_SHA" | grep -vE "$APP_IGNORED" | grep -q .; then echo true; else echo false; fi
}

decide() {
  if [[ "${GITHUB_EVENT_NAME:-}" != "push" ]]; then
    echo "reason=not a push" >&2; all true; return
  fi
  local head_tree parent2
  head_tree="$(git rev-parse "${GITHUB_SHA}^{tree}")"
  if parent2="$(git rev-parse --verify --quiet "${GITHUB_SHA}^2")"; then
    if [[ "$(git rev-parse "${parent2}^{tree}")" == "$head_tree" && "$(ci_passed "$parent2")" == "success" ]]; then
      echo "reason=same tree as $parent2, whose Infra CI passed" >&2
      for job in application terraform guard; do echo "$job=false"; done
      echo "container=$(image_changed_since_before)"
      return
    fi
  fi
  if [[ ! "${BEFORE:-}" =~ ^[0-9a-f]{40}$ || "$BEFORE" == "$ZERO" ]]; then
    echo "reason=no previous head" >&2; all true; return
  fi
  if ! git cat-file -e "${BEFORE}^{commit}" 2>/dev/null && ! git fetch --quiet --no-tags --depth=1 origin "$BEFORE"; then
    echo "reason=previous head not fetchable" >&2; all true; return
  fi
  local parent
  parent="$(ci_passed "$BEFORE")"
  if [[ "$parent" != "success" ]]; then
    echo "reason=previous head's Infra CI: $parent" >&2; all true; return
  fi
  CHANGED="$(git diff --name-only "$BEFORE" "$GITHUB_SHA")"
  if [[ -z "$CHANGED" ]]; then
    echo "reason=same tree as the previous head" >&2; all false; return
  fi
  local guard_value='^scripts/aws/[a-z0-9-]+-action\.txt$'
  if changed_any '.' "$APP_IGNORED"; then
    echo application=true; echo container=true
  else
    echo application=false; echo container=false
  fi
  if changed_any '^infra/aws/'; then echo terraform=true; else echo terraform=false; fi
  if changed_any '^(scripts/|infra/aws/|package(-lock)?\.json$|vitest\.config\.ts$|tsconfig\.json$)' "$guard_value"; then
    echo guard=true
  else
    echo guard=false
  fi
  echo "reason=changed since the previous head (whose Infra CI passed): $(wc -l <<<"$CHANGED") files" >&2
}

# A push to any branch but the feature branch never builds the image.
if [[ "${GITHUB_EVENT_NAME:-}" == "push" && -n "${GITHUB_REF:-}" && "$GITHUB_REF" != "$FEATURE_REF" ]]; then
  decide | sed 's/^container=true$/container=false/' >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "container: not built on a push to $GITHUB_REF" >&2
else
  decide >> "${GITHUB_OUTPUT:-/dev/stdout}"
fi
