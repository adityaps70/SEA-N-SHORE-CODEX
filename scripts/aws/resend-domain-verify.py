#!/usr/bin/env python3
"""Domain move (seanshore.net), Phase 1: asks Resend to verify the mail.seanshore.net sending domain.

Run by scripts/aws/resend-domain-verify.sh on the bootstrap host (never directly). The DNS records Resend checks
(DKIM, the send/rsend return-path CNAMEs and DMARC) are in Route 53 since the domain move create step
(infra/aws/app/domain-move.tf). It uses only the full-access admin key ("sea-n-shore/resend-admin"); the production
sending key is never read. The key is never printed, logged or put on a command line.

  plan         read only: whether mail.seanshore.net exists at Resend, its status and each record's status
  verify-once  POST /domains/{id}/verify (unless already verified), then wait until Resend reports it verified

It never creates, changes or deletes a domain, and never calls Resend about any other domain (mail.seanshore.in
keeps sending as it does). Prints status words and counts only.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

MARKER = "RESEND_DOMAIN_VERIFY"
ADMIN_KEY_SECRET = "sea-n-shore/resend-admin"
DOMAIN = "mail.seanshore.net"
REGION = os.environ.get("AWS_REGION", "ap-south-1")
STATUSES = {"not_started", "pending", "verified", "failed", "temporary_failure"}


def local_override(name, default):
    """Tests point the API at a local fake; anything but a loopback URL is refused."""
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    if not (value.startswith("http://127.0.0.1:") or value.startswith("http://localhost:")):
        fail(f"{name} may only point at a local test server")
    return value.rstrip("/")


RESEND_API = local_override("RESEND_DOMAIN_VERIFY_TEST_RESEND_API", "https://api.resend.com")
TESTING = bool(os.environ.get("RESEND_DOMAIN_VERIFY_TEST_RESEND_API"))
# Waits for Resend to check the records: every 15 seconds for up to 15 minutes (the local fake answers at once).
POLL_INTERVAL = 0.01 if TESTING else 15
POLL_ATTEMPTS = 60


def out(line):
    print(f"{MARKER}_{line}", flush=True)


def fail(message):
    print(message, file=sys.stderr, flush=True)
    sys.exit(1)


def resend_admin_key():
    """The full-access key, stored in plaintext. Read first; nothing else happens if it cannot be read."""
    result = subprocess.run(["aws", "secretsmanager", "get-secret-value", "--secret-id", ADMIN_KEY_SECRET,
                             "--query", "SecretString", "--output", "text", "--region", REGION],
                            capture_output=True, text=True)
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


def resend(method, path, key):
    url = RESEND_API + path
    headers = {"Accept": "application/json", "User-Agent": "sea-n-shore-ops", "Authorization": "Bearer " + key}
    data = b"{}" if method == "POST" else None
    if data is not None:
        headers["Content-Type"] = "application/json"
    for attempt in range(5):
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                text = response.read().decode()
                return json.loads(text) if text.strip().startswith("{") else {}
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 4:
                time.sleep(0 if TESTING else int(error.headers.get("retry-after") or 2))
                continue
            if error.code in (401, 403):
                out("KEY_CANNOT_MANAGE=true")
                fail(f"The Resend admin key may not {method} {path} (HTTP {error.code}); it needs full access.")
            fail(f"Resend {method} {path} returned HTTP {error.code}.")
        except urllib.error.URLError as error:
            if attempt < 4:
                time.sleep(0 if TESTING else 2)
                continue
            fail(f"{method} {path} failed: {error.reason}")
    fail(f"{method} {path} kept being rate limited")


def find_domain(key):
    """The one mail.seanshore.net domain at Resend, or None. Paged; never more than one."""
    matches, after = [], None
    for _ in range(20):
        payload = resend("GET", "/domains" + (f"?after={after}" if after else ""), key)
        data = payload.get("data") or []
        matches += [domain for domain in data if str(domain.get("name", "")).lower() == DOMAIN]
        if not payload.get("has_more") or not data:
            break
        after = data[-1].get("id")
    if len(matches) > 1:
        fail(f"More than one {DOMAIN} domain at Resend; refusing.")
    return matches[0] if matches else None


def status_of(domain):
    status = str(domain.get("status", "")).lower()
    return status if status in STATUSES else "unknown"


def report(domain):
    """Status words and counts only (record names and values are never printed)."""
    records = domain.get("records") or []
    by_status = {}
    for record in records:
        state = str(record.get("status", "")).lower()
        by_status[state if state in STATUSES else "unknown"] = by_status.get(state if state in STATUSES else "unknown", 0) + 1
        kind = str(record.get("record", "")).upper() or "-"
        out(f"RECORD kind={kind if kind in ('SPF', 'DKIM', 'MX', 'DMARC', 'RECEIVING') else 'OTHER'} type={str(record.get('type', '-')).upper()} status={state if state in STATUSES else 'unknown'}")
    out(f"STATUS={status_of(domain)} records={len(records)} " + " ".join(f"{k}={v}" for k, v in sorted(by_status.items())))


def main(action):
    if action not in ("plan", "verify-once"):
        fail("Unsupported Resend domain verify action.")
    key = resend_admin_key()
    found = find_domain(key)
    out(f"DOMAIN_FOUND={'true' if found else 'false'}")
    if not found:
        if action == "plan":
            out("PLAN_ONLY_NO_APPLY")
            return
        fail(f"{DOMAIN} is not at Resend; this runner never creates a domain.")
    domain_id = str(found.get("id", ""))
    if not domain_id or "/" in domain_id or "?" in domain_id:
        fail("Unexpected Resend domain id.")
    domain = resend("GET", f"/domains/{domain_id}", key)
    if str(domain.get("name", "")).lower() != DOMAIN:
        fail("Resend returned another domain; refusing.")
    report(domain)
    if action == "plan":
        out("PLAN_ONLY_NO_APPLY")
        return

    if status_of(domain) != "verified":
        resend("POST", f"/domains/{domain_id}/verify", key)
        out("VERIFY_REQUESTED=true")
        for attempt in range(1, POLL_ATTEMPTS + 1):
            time.sleep(POLL_INTERVAL)
            domain = resend("GET", f"/domains/{domain_id}", key)
            if status_of(domain) in ("verified", "failed"):
                break
        out(f"POLLS={attempt}")
        report(domain)
    else:
        out("VERIFY_REQUESTED=false already_verified=true")
    if status_of(domain) != "verified":
        fail(f"{DOMAIN} is {status_of(domain)} at Resend, not verified.")
    out("APPLY_VERIFIED=true")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("usage: resend-domain-verify.py plan|verify-once")
    main(sys.argv[1])
