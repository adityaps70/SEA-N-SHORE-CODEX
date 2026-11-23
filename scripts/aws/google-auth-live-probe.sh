#!/usr/bin/env bash
set -euo pipefail

PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://seanshore.in}"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL%/}"
# Domain move: the probe also runs against an alias domain the site answers on (scripts/aws/site-alias-hosts.txt), never
# any other host. The callback and sign-out checks below follow the site probed.
CANONICAL_SITE_URL="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
SITE_HOST="${PUBLIC_SITE_URL#https://}"
if [[ "$PUBLIC_SITE_URL" != "$CANONICAL_SITE_URL" ]]; then
  [[ "$PUBLIC_SITE_URL" =~ ^https://[a-z0-9.-]+$ ]] && tr -s '[:space:],' '\n' < scripts/aws/site-alias-hosts.txt | grep -qxF "$SITE_HOST" || {
    echo "PUBLIC_SITE_URL must be the canonical site or an alias host from scripts/aws/site-alias-hosts.txt." >&2
    exit 1
  }
fi
CALLBACK_PARAM="redirect_uri=$(jq -rn --arg value "$PUBLIC_SITE_URL/auth/google/callback" '$value | @uri')"
LOGOUT_PARAM="logout_uri=$(jq -rn --arg value "$PUBLIC_SITE_URL" '$value | @uri')"
echo "GOOGLE_AUTH_PROBE_SITE=$PUBLIC_SITE_URL"
EXPECTED_COGNITO_ORIGIN="https://auth.seanshore.in"
EXPECTED_GOOGLE_ORIGIN="https://accounts.google.com"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

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
  [[ "$LOCATION" == *"$CALLBACK_PARAM"* ]] || {
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
  "$EXPECTED_COGNITO_ORIGIN/logout?client_id=$CLIENT_ID&$LOGOUT_PARAM")"
LOGOUT_LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); gsub("\r",""); print}' "$LOGOUT_HEADERS" | tail -n 1)"
[[ "$LOGOUT_STATUS" =~ ^30[1278]$ && ( "$LOGOUT_LOCATION" == "$PUBLIC_SITE_URL" || "$LOGOUT_LOCATION" == "$PUBLIC_SITE_URL/" ) ]] || {
  echo "Cognito sign-out did not return to the site (status $LOGOUT_STATUS)." >&2
  echo "LOGOUT_LOCATION=$LOGOUT_LOCATION" >&2
  exit 1
}
echo "COGNITO_SIGN_OUT_VERIFIED=true"

# An alias domain's www name redirects to its apex (the main distribution's viewer function).
if [[ "$PUBLIC_SITE_URL" != "$CANONICAL_SITE_URL" ]]; then
  WWW_RESULT="$(curl --silent --show-error --max-time 45 -o /dev/null -w '%{http_code} %{redirect_url}' "https://www.$SITE_HOST/auth/sign-in?googleProbe=1")"
  [[ "$WWW_RESULT" == "301 $PUBLIC_SITE_URL/auth/sign-in?googleProbe=1" ]] || { echo "www.$SITE_HOST did not redirect to $PUBLIC_SITE_URL." >&2; exit 1; }
  echo "ALIAS_WWW_REDIRECT_VERIFIED=true"
fi

echo "GOOGLE_AUTH_LIVE_VERIFIED=true"
