#!/usr/bin/env python3
"""Creates the Resend delivery-event webhook for seanshore.in and stores its signing secret in Secrets Manager.

Run by scripts/aws/resend-delivery-webhook.sh on the bootstrap host (never directly). It uses only the full-access
admin key ("sea-n-shore/resend-admin", the key in plaintext); the production sending key is never read here. Neither
key nor the webhook signing secret is ever printed, logged, put on a command line or written outside a 0600
temporary file that is deleted on exit.

Both actions first confirm the admin secret can be read, before anything else.

  plan        read-only: what exists at Resend and in Secrets Manager, whether the endpoint is live, domain tracking
  apply-once  1. make sure the Secrets Manager secret exists (placeholder first, so a missing permission stops the run
                 before anything is created at Resend);
              2. create the webhook (or reuse the one already pointing at the endpoint);
              3. store its signing secret; 4. turn off open and click tracking on the sending domain if on (the legacy
                 emails carry no tracking pixels and their claim links must not be rewritten);
              5. prove the live endpoint accepts a delivery signed with the stored secret and refuses an unsigned one.
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

MARKER = "RESEND_DELIVERY_WEBHOOK"
ADMIN_KEY_SECRET = "sea-n-shore/resend-admin"
WEBHOOK_SECRET = "sea-n-shore/resend-webhook-signing"
SENDING_DOMAIN = "mail.seanshore.in"
EVENTS = [
    "email.delivered",
    "email.bounced",
    "email.complained",
    "email.delivery_delayed",
    "email.failed",
    "email.suppressed",
]
REGION = os.environ.get("AWS_REGION", "ap-south-1")
# Consecutive matching answers that show every web task behind the load balancer has the new secret.
STABLE_PROBES = 6


def local_override(name, default):
    """Tests point these at a local fake; anything but a loopback URL is refused."""
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    if not (value.startswith("http://127.0.0.1:") or value.startswith("http://localhost:")):
        fail(f"{name} may only point at a local test server")
    return value.rstrip("/")


RESEND_API = local_override("RESEND_DELIVERY_WEBHOOK_TEST_RESEND_API", "https://api.resend.com")
SITE = local_override("RESEND_DELIVERY_WEBHOOK_TEST_SITE", "https://seanshore.in")
ENDPOINT = "https://seanshore.in/api/email/resend/webhook"
PROBE_URL = SITE + "/api/email/resend/webhook"
# Seconds between verification probes; the local test fake answers at once.
PROBE_INTERVAL = 0.05 if os.environ.get("RESEND_DELIVERY_WEBHOOK_TEST_SITE") else 3


def out(line):
    print(f"{MARKER}_{line}", flush=True)


def fail(message):
    print(message, file=sys.stderr, flush=True)
    sys.exit(1)


def aws(*args, input_file=None, check=True):
    command = ["aws", *args, "--region", REGION]
    result = subprocess.run(command, capture_output=True, text=True)
    if check and result.returncode != 0:
        # Error text from the CLI names the operation and resource, never a secret value.
        fail(f"aws {args[0]} {args[1]} failed: {result.stderr.strip()[:300]}")
    return result


def resend_admin_key():
    """The full-access key, stored in plaintext. Read first; nothing else happens if it cannot be read."""
    result = aws("secretsmanager", "get-secret-value", "--secret-id", ADMIN_KEY_SECRET, "--query", "SecretString", "--output", "text", check=False)
    if result.returncode != 0:
        out("ADMIN_SECRET_READABLE=false")
        reason = "it does not exist" if "ResourceNotFoundException" in result.stderr else "access was refused or failed"
        fail(f"Cannot read the Resend admin key secret {ADMIN_KEY_SECRET}: {reason}.")
    key = result.stdout.strip()
    if not key.startswith("re_") or len(key) < 8 or any(character.isspace() for character in key):
        out("ADMIN_SECRET_READABLE=false")
        fail(f"The Resend admin key secret {ADMIN_KEY_SECRET} is not a plaintext Resend API key.")
    out("ADMIN_SECRET_READABLE=true")
    return key


def request(method, url, key=None, body=None, headers=None):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    request_headers = {"Accept": "application/json", "User-Agent": "sea-n-shore-ops"}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    if key:
        request_headers["Authorization"] = "Bearer " + key
    request_headers.update(headers or {})
    for attempt in range(5):
        req = urllib.request.Request(url, data=data, method=method, headers=request_headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                text = response.read().decode()
                return response.status, (json.loads(text) if text.strip().startswith("{") else {})
        except urllib.error.HTTPError as error:
            text = error.read().decode(errors="replace")
            if error.code == 429 and attempt < 4:
                time.sleep(int(error.headers.get("retry-after") or 2))
                continue
            try:
                return error.code, json.loads(text)
            except ValueError:
                return error.code, {}
        except urllib.error.URLError as error:
            if attempt < 4:
                time.sleep(2)
                continue
            fail(f"{method} {url.split('?')[0]} failed: {error.reason}")
    fail(f"{method} {url} kept being rate limited")


def resend(method, path, key, body=None):
    status, payload = request(method, RESEND_API + path, key=key, body=body)
    if status in (401, 403):
        out("KEY_CANNOT_MANAGE=true")
        fail(f"The Resend admin key may not {method} {path.split('?')[0]} (HTTP {status}); it needs full access.")
    if status >= 400:
        fail(f"Resend {method} {path.split('?')[0]} returned HTTP {status}: {str(payload.get('message', ''))[:200]}")
    return payload


def endpoint_webhooks(key):
    hooks, after = [], None
    for _ in range(20):
        payload = resend("GET", "/webhooks?limit=100" + (f"&after={after}" if after else ""), key)
        data = payload.get("data") or []
        hooks += [hook for hook in data if hook.get("endpoint") == ENDPOINT]
        if not payload.get("has_more") or not data:
            return hooks
        after = data[-1]["id"]
    return hooks


def secret_state():
    result = aws("secretsmanager", "describe-secret", "--secret-id", WEBHOOK_SECRET, "--output", "json", check=False)
    if result.returncode != 0:
        if "ResourceNotFoundException" in result.stderr:
            return None
        fail(f"aws secretsmanager describe-secret failed: {result.stderr.strip()[:300]}")
    return json.loads(result.stdout)


def stored_signing_secret():
    result = aws("secretsmanager", "get-secret-value", "--secret-id", WEBHOOK_SECRET, "--query", "SecretString", "--output", "text", check=False)
    if result.returncode != 0:
        return None
    try:
        value = json.loads(result.stdout.strip())
        secret = str(value.get("signing_secret") or "")
        return {"secret": secret, "webhook_id": value.get("webhook_id")} if secret.startswith("whsec_") else None
    except ValueError:
        return None


def write_secret(work_dir, value, create):
    path = os.path.join(work_dir, "secret.json")
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
        json.dump(value, handle)
    try:
        if create:
            aws("secretsmanager", "create-secret", "--name", WEBHOOK_SECRET,
                "--description", "Svix signing secret of the Resend delivery-event webhook for seanshore.in.",
                "--secret-string", f"file://{path}")
        else:
            aws("secretsmanager", "put-secret-value", "--secret-id", WEBHOOK_SECRET, "--secret-string", f"file://{path}")
    finally:
        os.remove(path)


def sign(secret, message_id, timestamp, body):
    key = base64.b64decode(secret[len("whsec_"):])
    digest = hmac.new(key, f"{message_id}.{timestamp}.{body}".encode(), hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode()


def probe(secret=None):
    body = json.dumps({"type": "sea_n_shore.webhook_check", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "data": {}})
    headers = {}
    if secret:
        message_id = f"msg_ops_check_{int(time.time())}"
        timestamp = str(int(time.time()))
        headers = {"svix-id": message_id, "svix-timestamp": timestamp, "svix-signature": sign(secret, message_id, timestamp, body)}
    status, payload = request("POST", PROBE_URL, body=body.encode(), headers=headers)
    return status, payload


def sending_domain(key):
    payload = resend("GET", "/domains", key)
    for domain in payload.get("data") or []:
        if domain.get("name") == SENDING_DOMAIN:
            return resend("GET", f"/domains/{domain['id']}", key)
    fail(f"The sending domain {SENDING_DOMAIN} is not on the Resend account.")


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action not in ("plan", "apply-once"):
        fail("Unsupported action.")
    key = resend_admin_key()
    out(f"ACTION={action}")
    out(f"ENDPOINT={ENDPOINT}")
    out("EVENTS=" + ",".join(EVENTS))
    hooks = endpoint_webhooks(key)
    if len(hooks) > 1:
        fail(f"{len(hooks)} Resend webhooks already point at {ENDPOINT}; remove the extras by hand first.")
    hook = hooks[0] if hooks else None
    out(f"EXISTING_WEBHOOK={'true' if hook else 'false'}")
    if hook and sorted(hook.get("events") or []) != sorted(EVENTS):
        fail("The existing webhook subscribes to different events: " + ",".join(sorted(hook.get("events") or [])))

    existing_secret = secret_state()
    stored = stored_signing_secret() if existing_secret else None
    out(f"SECRET_EXISTS={'true' if existing_secret else 'false'}")
    out(f"SECRET_HAS_SIGNING_KEY={'true' if stored else 'false'}")

    domain = sending_domain(key)
    tracking = {"open_tracking": bool(domain.get("open_tracking")), "click_tracking": bool(domain.get("click_tracking"))}
    out(f"DOMAIN_OPEN_TRACKING={str(tracking['open_tracking']).lower()}")
    out(f"DOMAIN_CLICK_TRACKING={str(tracking['click_tracking']).lower()}")

    status, _ = probe()
    live = status in (400, 503)
    out(f"ENDPOINT_UNSIGNED_STATUS={status}")
    out(f"ENDPOINT_LIVE={'true' if live else 'false'}")

    configured = bool(hook and stored and stored.get("webhook_id") == hook.get("id")) and not any(tracking.values())
    if action == "plan":
        out(f"WOULD={'nothing' if configured else 'configure'}")
        out("PLAN_VERIFIED=true")
        out("PLAN_ONLY_NO_APPLY")
        return

    if not live:
        fail("The webhook endpoint is not deployed yet (an unsigned POST should get 400 or 503). Deploy first.")

    with tempfile.TemporaryDirectory(prefix="resend-webhook.") as work_dir:
        os.chmod(work_dir, 0o700)
        if not existing_secret:
            write_secret(work_dir, {"pending": True}, create=True)
            out("SECRET_CREATED=true")

        if hook:
            created = False
            full = resend("GET", f"/webhooks/{hook['id']}", key)
        else:
            created = True
            full = resend("POST", "/webhooks", key, {"endpoint": ENDPOINT, "events": EVENTS})
        webhook_id = str(full.get("id") or (hook or {}).get("id") or "")
        signing_secret = str(full.get("signing_secret") or "")
        if not webhook_id or not signing_secret.startswith("whsec_"):
            fail("Resend did not return the webhook id and signing secret.")
        out(f"WEBHOOK_CREATED={'true' if created else 'false'}")
        out(f"WEBHOOK_ID={webhook_id}")

        if not stored or stored.get("secret") != signing_secret or stored.get("webhook_id") != webhook_id:
            write_secret(work_dir, {"signing_secret": signing_secret, "webhook_id": webhook_id}, create=False)
        out("SECRET_STORED=true")

    if any(tracking.values()):
        resend("PATCH", f"/domains/{domain['id']}", key, {"open_tracking": False, "click_tracking": False})
        after = resend("GET", f"/domains/{domain['id']}", key)
        if after.get("open_tracking") or after.get("click_tracking"):
            fail("Open or click tracking is still on for the sending domain.")
        out("DOMAIN_TRACKING_TURNED_OFF=true")

    # Every web task caches a missing secret for 30 s, and the load balancer spreads probes across tasks, so one good
    # answer proves only one task. Require several in a row (a wrong answer resets the count), for up to 3 minutes.
    def settled(check, label):
        streak, last = 0, None
        for _ in range(60):
            ok, last = check()
            streak = streak + 1 if ok else 0
            if streak >= STABLE_PROBES:
                return
            time.sleep(PROBE_INTERVAL)
        fail(f"{label} (last HTTP {last}).")

    def signed_ok():
        status, payload = probe(signing_secret)
        return status == 200 and payload.get("status") == "ignored", status

    def unsigned_refused():
        status, _ = probe()
        return status == 400, status

    settled(signed_ok, "The endpoint did not keep accepting deliveries signed with the stored secret")
    out("SIGNED_PROBE_ACCEPTED=true")
    settled(unsigned_refused, "The endpoint did not keep refusing unsigned deliveries")
    out("UNSIGNED_PROBE_REFUSED=true")
    out("APPLY_VERIFIED=true")


if __name__ == "__main__":
    main()
