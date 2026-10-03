#!/usr/bin/env bash
set -euo pipefail

PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://seanshore.in}"
EXPECTED_COGNITO_ORIGIN="https://auth.seanshore.in"
EXPECTED_GOOGLE_ORIGIN="https://accounts.google.com"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

for page in sign-in sign-up; do
  BODY="$WORK_DIR/$page.html"
  STATUS="$(curl --silent --show-error --max-time 45 -o "$BODY" -w '%{http_code}' "${PUBLIC_SITE_URL%/}/auth/$page?googleProbe=1")"
  [[ "$STATUS" == "200" ]] || { echo "Unexpected auth page status for $page: $STATUS" >&2; exit 1; }
  grep -Fq 'Continue with Google' "$BODY" || { echo "Google button missing on auth page: $page." >&2; exit 1; }
  echo "GOOGLE_BUTTON_VERIFIED=/$page"
done

for intent in sign-in sign-up; do
  HEADERS="$WORK_DIR/google-start-$intent.headers"
  STATUS="$(curl --silent --show-error --max-time 45 -D "$HEADERS" -o /dev/null -w '%{http_code}' "${PUBLIC_SITE_URL%/}/auth/google/start?intent=$intent")"
  [[ "$STATUS" =~ ^30[1278]$ ]] || { echo "Unexpected Google start status for $intent: $STATUS" >&2; exit 1; }

  LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); gsub("\r",""); print}' "$HEADERS" | tail -n 1)"
  [[ "$LOCATION" == "$EXPECTED_COGNITO_ORIGIN/oauth2/authorize"* ]] || { echo "Google start did not redirect to expected Cognito endpoint for $intent." >&2; exit 1; }
  [[ "$LOCATION" == *"identity_provider=Google"* ]] || { echo "Google start redirect is missing identity_provider=Google for $intent." >&2; exit 1; }
  [[ "$LOCATION" == *"scope=openid+email+profile+aws.cognito.signin.user.admin"* ]] || {
    echo "Google start redirect is missing aws.cognito.signin.user.admin for $intent." >&2
    echo "LOCATION=$LOCATION" >&2
    exit 1
  }
  [[ "$LOCATION" == *"prompt=select_account"* ]] || {
    echo "Google start redirect is missing prompt=select_account for $intent." >&2
    echo "LOCATION=$LOCATION" >&2
    exit 1
  }
  [[ "$LOCATION" == *"redirect_uri=https%3A%2F%2Fseanshore.in%2Fauth%2Fgoogle%2Fcallback"* ]] || {
    echo "Google start redirect uses an unexpected callback URI for $intent." >&2
    echo "LOCATION=$LOCATION" >&2
    exit 1
  }
  echo "GOOGLE_COGNITO_START_VERIFIED=$intent"

  COGNITO_HEADERS="$WORK_DIR/cognito-$intent.headers"
  COGNITO_STATUS="$(curl --silent --show-error --max-time 45 -D "$COGNITO_HEADERS" -o "$WORK_DIR/cognito-$intent.body" -w '%{http_code}' "$LOCATION")"
  COGNITO_LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); gsub("\r",""); print}' "$COGNITO_HEADERS" | tail -n 1)"

  [[ "$COGNITO_STATUS" =~ ^30[1278]$ ]] || {
    echo "Cognito did not redirect Google OAuth for $intent (status $COGNITO_STATUS)." >&2
    head -c 1000 "$WORK_DIR/cognito-$intent.body" >&2 || true
    exit 1
  }
  [[ "$COGNITO_LOCATION" == "$EXPECTED_GOOGLE_ORIGIN/"* ]] || {
    echo "Cognito redirected $intent to an unexpected provider URL." >&2
    echo "COGNITO_LOCATION=$COGNITO_LOCATION" >&2
    exit 1
  }
  echo "GOOGLE_PROVIDER_REDIRECT_VERIFIED=$intent"

  # Google answers an unregistered redirect_uri with a 400 or a redirect to /signin/oauth/error.
  GOOGLE_HEADERS="$WORK_DIR/google-$intent.headers"
  GOOGLE_STATUS="$(curl --silent --show-error --max-time 45 -D "$GOOGLE_HEADERS" -o "$WORK_DIR/google-$intent.body" -w '%{http_code}' "$COGNITO_LOCATION")"
  GOOGLE_LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); gsub("\r",""); print}' "$GOOGLE_HEADERS" | tail -n 1)"
  if [[ ! "$GOOGLE_STATUS" =~ ^(200|30[1278])$ || "$GOOGLE_LOCATION" == *"/signin/oauth/error"* ]] || grep -q 'redirect_uri_mismatch' "$WORK_DIR/google-$intent.body"; then
    echo "Google rejected the Cognito redirect URI for $intent (status $GOOGLE_STATUS)." >&2
    exit 1
  fi
  echo "GOOGLE_REDIRECT_URI_ACCEPTED=$intent"
done

CLIENT_ID="$(grep -o 'client_id=[^&]*' <<<"$LOCATION" | head -n 1 | cut -d= -f2)"
[[ "$CLIENT_ID" =~ ^[a-z0-9]+$ ]] || { echo "Could not read the Cognito client id from the Google start redirect." >&2; exit 1; }
LOGOUT_HEADERS="$WORK_DIR/logout.headers"
LOGOUT_STATUS="$(curl --silent --show-error --max-time 45 -D "$LOGOUT_HEADERS" -o /dev/null -w '%{http_code}' \
  "$EXPECTED_COGNITO_ORIGIN/logout?client_id=$CLIENT_ID&logout_uri=https%3A%2F%2Fseanshore.in")"
LOGOUT_LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); gsub("\r",""); print}' "$LOGOUT_HEADERS" | tail -n 1)"
[[ "$LOGOUT_STATUS" =~ ^30[1278]$ && "$LOGOUT_LOCATION" =~ ^https://seanshore\.in/?$ ]] || {
  echo "Cognito sign-out did not return to the site (status $LOGOUT_STATUS)." >&2
  echo "LOGOUT_LOCATION=$LOGOUT_LOCATION" >&2
  exit 1
}
echo "COGNITO_SIGN_OUT_VERIFIED=true"

echo "GOOGLE_AUTH_LIVE_VERIFIED=true"
