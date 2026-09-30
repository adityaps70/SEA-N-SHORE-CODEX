#!/usr/bin/env bash
set -euo pipefail

PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://seanshore.in}"
EXPECTED_COGNITO_ORIGIN="https://sea-n-shore-staging-310356785722.auth.ap-south-1.amazoncognito.com"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

for page in sign-in sign-up; do
  BODY="$WORK_DIR/$page.html"
  STATUS="$(curl --silent --show-error --max-time 45 -o "$BODY" -w '%{http_code}' "${PUBLIC_SITE_URL%/}/auth/$page?googleProbe=1")"
  [[ "$STATUS" == "200" ]] || { echo "Unexpected auth page status: $STATUS" >&2; exit 1; }
  grep -Fq 'Continue with Google' "$BODY" || { echo "Google button missing on auth page." >&2; exit 1; }
  echo "GOOGLE_BUTTON_VERIFIED=/$page"
done

HEADERS="$WORK_DIR/google-start.headers"
STATUS="$(curl --silent --show-error --max-time 45 -D "$HEADERS" -o /dev/null -w '%{http_code}' "${PUBLIC_SITE_URL%/}/auth/google/start?intent=sign-in")"
[[ "$STATUS" =~ ^30[1278]$ ]] || { echo "Unexpected Google start status: $STATUS" >&2; exit 1; }
LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); gsub("\r",""); print}' "$HEADERS" | tail -n 1)"
[[ "$LOCATION" == "$EXPECTED_COGNITO_ORIGIN/oauth2/authorize"* ]] || { echo "Google start did not redirect to expected Cognito endpoint." >&2; exit 1; }
[[ "$LOCATION" == *"identity_provider=Google"* ]] || { echo "Google start redirect is missing identity_provider=Google." >&2; exit 1; }

echo "GOOGLE_COGNITO_START_VERIFIED=true"
echo "GOOGLE_AUTH_LIVE_VERIFIED=true"
