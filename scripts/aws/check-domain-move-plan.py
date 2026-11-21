#!/usr/bin/env python3
"""Domain move, Phase 1 (owner-approved 18 Nov): checks the targeted plans of scripts/aws/domain-move-infra.sh.

  check-domain-move-plan.py import PLAN_JSON
      Exits 0 only if the plan imports exactly the console-made resources (EXPECTED_IMPORTS) and changes nothing at
      all: every import is a no-op, nothing is created, updated, replaced or destroyed. Prints
      DOMAIN_MOVE_PLAN=IMPORT imports=<n>, or DOMAIN_MOVE_PLAN=NO_CHANGES once they are in state.
  check-domain-move-plan.py create PLAN_JSON APP_DISTRIBUTION_ID REDIRECT_DISTRIBUTION_ID
      Exits 0 only if the plan creates exactly EXPECTED_CREATES with the approved settings and changes nothing else.
      Prints DOMAIN_MOVE_PLAN=CREATE creates=<n>, or DOMAIN_MOVE_PLAN=NO_CHANGES once they exist.

Prints addresses and counts only.
"""
import json
import sys

ACCOUNT = "310356785722"
CONSOLE_ZONES = ["seaandshore.si", "seanshore.nl", "seanshore.ph", "seanshore.si"]
CONSOLE_HOSTS = [h for zone in CONSOLE_ZONES for h in (zone, "www." + zone)]
CONSOLE_VALIDATION = [
    "_7174cb4244bac86afafb95ddeaabf6db.seanshore.ph", "_87fc76e948b4883bc1974376f292aca6.www.seanshore.ph",
    "_50d2b904c17f8fb011ecc4ec8ce4b283.seanshore.nl", "_3f9bb0ee552791619aae8c75f274c910.www.seanshore.nl",
    "_593f2bd7eb81c6d456d1edfd572e40e3.seanshore.si", "_fc37b62195dcf025867ce7cf1c6f52b5.www.seanshore.si",
    "_87316a6386dd4c23ab5534d20a0c00b7.seaandshore.si", "_b200d0fa6c54695a0cefbf3cb32f0009.www.seaandshore.si",
]

EXPECTED_IMPORTS = sorted(
    ["aws_route53_zone.seanshore_net"]
    + [f'aws_route53_zone.console["{z}"]' for z in CONSOLE_ZONES]
    + ["aws_acm_certificate.console_redirect", "aws_cloudfront_function.console_redirect",
       "aws_cloudfront_distribution.console_redirect"]
    + [f'aws_route53_record.console_redirect_alias["{h} {t}"]' for h in CONSOLE_HOSTS for t in ("A", "AAAA")]
    + [f'aws_route53_record.console_redirect_validation["{n}"]' for n in CONSOLE_VALIDATION]
    + ["aws_route53_record.seanshore_google_site_verification", "aws_route53_record.seanshore_resend_dkim",
       'aws_route53_record.seanshore_resend_return_path["rsend"]',
       'aws_route53_record.seanshore_resend_return_path["send"]']
)

EXPECTED_CREATES = sorted([
    "aws_route53_record.seanshore_net_resend_dkim",
    'aws_route53_record.seanshore_net_resend_return_path["rsend"]',
    'aws_route53_record.seanshore_net_resend_return_path["send"]',
    "aws_route53_record.seanshore_net_dmarc",
    "aws_acm_certificate.site_edge",
    'aws_route53_record.site_edge_validation["seanshore.net"]',
    'aws_route53_record.site_edge_validation["www.seanshore.net"]',
    "aws_acm_certificate_validation.site_edge",
    "aws_acm_certificate.legacy_redirect",
    "aws_acm_certificate_validation.legacy_redirect",
    "aws_s3_bucket.edge_logs",
    "aws_s3_bucket_public_access_block.edge_logs",
    "aws_s3_bucket_ownership_controls.edge_logs",
    "aws_s3_bucket_server_side_encryption_configuration.edge_logs",
    "aws_s3_bucket_lifecycle_configuration.edge_logs",
    "aws_s3_bucket_policy.edge_logs",
    'aws_cloudwatch_log_delivery_source.edge["app"]',
    'aws_cloudwatch_log_delivery_source.edge["redirect"]',
    "aws_cloudwatch_log_delivery_destination.edge_logs",
    'aws_cloudwatch_log_delivery.edge["app"]',
    'aws_cloudwatch_log_delivery.edge["redirect"]',
])

EDGE_LOGS_BUCKET = f"sea-n-shore-staging-{ACCOUNT}-edge-logs"
SITE_EDGE_NAMES = ["seanshore.in", "www.seanshore.in", "seanshore.net", "www.seanshore.net"]
LEGACY_NAMES = ["seaandshore.in", "www.seaandshore.in"] + CONSOLE_HOSTS


def refuse(message):
    print(f"DOMAIN_MOVE_PLAN_REFUSED {message}")
    sys.exit(1)


def managed_changes(plan):
    return [c for c in plan.get("resource_changes") or [] if c.get("mode") == "managed"]


def changed_attributes(change):
    """Names (never values) of the top-level attributes a change would set differently, or leaves unknown."""
    body = change.get("change") or {}
    before, after, unknown = body.get("before") or {}, body.get("after") or {}, body.get("after_unknown") or {}
    names = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
    names |= {k for k, v in unknown.items() if v}
    return sorted(names)


def check_import(plan):
    changes = managed_changes(plan)
    imported = sorted(c["address"] for c in changes if (c.get("change") or {}).get("importing"))
    # Every change is listed (address, actions, attribute names only), so one run shows all there is to fix.
    refused = [c for c in changes if (c.get("change") or {}).get("actions") != ["no-op"]]
    for change in refused:
        actions = (change.get("change") or {}).get("actions")
        print(f"DOMAIN_MOVE_PLAN_DIFF address={change['address']} actions={'+'.join(actions or [])} "
              f"attributes={','.join(changed_attributes(change)) or '-'}")
    if refused:
        refuse(f"changes={len(refused)}")
    if not imported:
        in_plan = {c["address"] for c in changes}
        missing = [a for a in EXPECTED_IMPORTS if a not in in_plan]
        if missing:
            refuse(f"not in state and not imported: {len(missing)}")
        print("DOMAIN_MOVE_PLAN=NO_CHANGES")
        return
    if imported != EXPECTED_IMPORTS:
        extra = sorted(set(imported) - set(EXPECTED_IMPORTS))
        missing = sorted(set(EXPECTED_IMPORTS) - set(imported))
        refuse(f"imports differ: extra={extra[:3]} missing={missing[:3]}")
    print(f"DOMAIN_MOVE_PLAN=IMPORT imports={len(imported)}")


def after(change):
    return (change.get("change") or {}).get("after") or {}


def check_create(plan, app_id, redirect_id):
    changes = managed_changes(plan)
    created = sorted(c["address"] for c in changes if (c.get("change") or {}).get("actions") == ["create"])
    for change in changes:
        actions = (change.get("change") or {}).get("actions")
        if (change.get("change") or {}).get("importing"):
            refuse(f"address={change['address']} imports in the create step")
        if actions not in (["no-op"], ["create"]):
            refuse(f"address={change['address']} actions={'+'.join(actions or [])}")
    if not created:
        in_plan = {c["address"] for c in changes}
        missing = [a for a in EXPECTED_CREATES if a not in in_plan]
        if missing:
            refuse(f"missing from the plan: {len(missing)}")
        print("DOMAIN_MOVE_PLAN=NO_CHANGES")
        return
    if created != EXPECTED_CREATES:
        extra = sorted(set(created) - set(EXPECTED_CREATES))
        missing = sorted(set(EXPECTED_CREATES) - set(created))
        refuse(f"creates differ: extra={extra[:3]} missing={missing[:3]}")
    by = {c["address"]: after(c) for c in changes}

    def names(cert):
        return sorted([cert.get("domain_name")] + list(cert.get("subject_alternative_names") or []))

    if names(by["aws_acm_certificate.site_edge"]) != sorted(SITE_EDGE_NAMES):
        refuse("site_edge names")
    if names(by["aws_acm_certificate.legacy_redirect"]) != sorted(LEGACY_NAMES) or len(LEGACY_NAMES) != 10:
        refuse("legacy_redirect names")
    for address in ("aws_acm_certificate.site_edge", "aws_acm_certificate.legacy_redirect"):
        if by[address].get("validation_method") != "DNS":
            refuse(f"{address} validation")
    dmarc = by["aws_route53_record.seanshore_net_dmarc"]
    if dmarc.get("name") != "_dmarc.seanshore.net" or dmarc.get("records") != ["v=DMARC1; p=quarantine; adkim=r; aspf=r"]:
        refuse("dmarc")
    expected_return_path = {"send": "send.forge.rmta.net", "rsend": "rsend-apne1.forge.rmta.net"}
    for key, value in expected_return_path.items():
        record = by[f'aws_route53_record.seanshore_net_resend_return_path["{key}"]']
        if record.get("name") != f"{key}.mail.seanshore.net" or record.get("type") != "CNAME" or record.get("records") != [value]:
            refuse(f"resend {key}")
    dkim = by["aws_route53_record.seanshore_net_resend_dkim"]
    if dkim.get("name") != "resend._domainkey.mail.seanshore.net" or dkim.get("type") != "TXT" or len(dkim.get("records") or []) != 1:
        refuse("resend dkim")
    if by["aws_s3_bucket.edge_logs"].get("bucket") != EDGE_LOGS_BUCKET:
        refuse("edge logs bucket name")
    pab = by["aws_s3_bucket_public_access_block.edge_logs"]
    if not all(pab.get(k) is True for k in ("block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets")):
        refuse("edge logs public access block")
    own = by["aws_s3_bucket_ownership_controls.edge_logs"].get("rule") or [{}]
    if own[0].get("object_ownership") != "BucketOwnerEnforced":
        refuse("edge logs ownership")
    sse = (by["aws_s3_bucket_server_side_encryption_configuration.edge_logs"].get("rule") or [{}])[0]
    if ((sse.get("apply_server_side_encryption_by_default") or [{}])[0]).get("sse_algorithm") != "AES256":
        refuse("edge logs encryption")
    rules = by["aws_s3_bucket_lifecycle_configuration.edge_logs"].get("rule") or []
    if len(rules) != 1 or rules[0].get("status") != "Enabled" or ((rules[0].get("expiration") or [{}])[0]).get("days") != 30:
        refuse("edge logs lifecycle")
    for key, dist in (("app", app_id), ("redirect", redirect_id)):
        source = by[f'aws_cloudwatch_log_delivery_source.edge["{key}"]']
        if source.get("resource_arn") != f"arn:aws:cloudfront::{ACCOUNT}:distribution/{dist}" or source.get("log_type") != "ACCESS_LOGS":
            refuse(f"log source {key}")
    print(f"DOMAIN_MOVE_PLAN=CREATE creates={len(created)}")


def main(argv):
    if len(argv) == 3 and argv[1] == "import":
        with open(argv[2]) as handle:
            check_import(json.load(handle))
        return
    if len(argv) == 5 and argv[1] == "create":
        with open(argv[2]) as handle:
            check_create(json.load(handle), argv[3], argv[4])
        return
    refuse("usage")


if __name__ == "__main__":
    main(sys.argv)
