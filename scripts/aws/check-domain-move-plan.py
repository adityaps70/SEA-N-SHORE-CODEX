#!/usr/bin/env python3
"""Domain move, Phase 1 (owner-approved 18 Nov): checks the targeted plans of scripts/aws/domain-move-infra.sh.

  check-domain-move-plan.py import PLAN_JSON
      Exits 0 only if the plan imports exactly the console-made resources (EXPECTED_IMPORTS) and changes nothing at
      all: every import is a no-op, nothing is created, updated, replaced or destroyed. Prints
      DOMAIN_MOVE_PLAN=IMPORT imports=<n>, or DOMAIN_MOVE_PLAN=NO_CHANGES once they are in state.
  check-domain-move-plan.py create PLAN_JSON APP_DISTRIBUTION_ID REDIRECT_DISTRIBUTION_ID
      Exits 0 only if the plan creates exactly EXPECTED_CREATES with the approved settings and changes nothing else,
      except one update: the main distribution's viewer-request function, to the repository template rendered as
      edge.tf renders it (it sets x-sns-viewer-host from the real Host; owner, 21 Nov). Prints
      DOMAIN_MOVE_PLAN=CREATE creates=<n> updates=<0|1>, or DOMAIN_MOVE_PLAN=NO_CHANGES once nothing is left.
  check-domain-move-plan.py serve PLAN_JSON APP_DISTRIBUTION_ID SITE_EDGE_CERTIFICATE_ARN
      Exits 0 only if the plan serves seanshore.net next to seanshore.in and changes nothing else: the main
      distribution's aliases and certificate, the viewer function's code, the page cache key, the four seanshore.net
      alias records (created), and the browser origins in the Cognito client, the media upload CORS rule and the
      realtime authorizer, each with exactly the approved values. Prints DOMAIN_MOVE_PLAN=SERVE updates=<n>
      creates=<n>, or DOMAIN_MOVE_PLAN=NO_CHANGES once it is applied.

Prints addresses and counts only.
"""
import json
import sys
from pathlib import Path

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

# The main distribution's viewer-request function (edge.tf). The only change the create step may make to anything that
# already exists: x-sns-viewer-host is set from the Host CloudFront answered on, never kept from the client.
FUNCTION_ADDRESS = "aws_cloudfront_function.canonical_host_redirect"
FUNCTION_NAME = "sea-n-shore-staging-canonical-host-redirect"
FUNCTION_TEMPLATE = Path(__file__).resolve().parents[2] / "infra" / "aws" / "app" / "cloudfront" / "canonical-host-redirect.js.tftpl"
# code, plus what CloudFront computes from it (never set from configuration).
FUNCTION_UPDATABLE = {"code", "etag", "live_stage_etag", "status"}

# serve-once (owner-approved 18 Nov; owner 21 Nov: header fix first, then serve).
CANONICAL_HOST = "seanshore.in"
ALIAS_HOSTS = ["seanshore.net"]
EDGE_HOST = "d3prih0q6jofyr.cloudfront.net"
CLOUDFRONT_ZONE_ID = "Z2FDTNDATAQYW2"
SEANSHORE_NET_ZONE_ID = "Z09758912UIE2T2PK09U"
SERVE_ALIASES = sorted([CANONICAL_HOST, "www." + CANONICAL_HOST] + [h for host in ALIAS_HOSTS for h in (host, "www." + host)])
BROWSER_ORIGINS = ["https://" + CANONICAL_HOST] + ["https://" + host for host in ALIAS_HOSTS] + ["https://" + EDGE_HOST]
PAGE_KEY_HEADERS = sorted(["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch", "x-sns-viewer-host"])
NET_ALIAS_RECORDS = sorted(f'aws_route53_record.site_net_alias["{host} {kind}"]' for host in ("seanshore.net", "www.seanshore.net") for kind in ("A", "AAAA"))
# For each update: (attributes whose known value may change, computed attributes that may become unknown).
SERVE_UPDATES = {
    "aws_cloudfront_distribution.app": ({"aliases", "viewer_certificate"},
                                        {"etag", "last_modified_time", "status", "in_progress_validation_batches",
                                         "trusted_key_groups", "trusted_signers"}),
    FUNCTION_ADDRESS: ({"code"}, {"etag", "live_stage_etag", "status"}),
    "aws_cloudfront_cache_policy.public_pages": ({"parameters_in_cache_key_and_forwarded_to_origin"}, {"etag"}),
    "aws_cognito_user_pool_client.web": ({"callback_urls", "logout_urls"}, set()),
    "aws_s3_bucket_cors_configuration.media": ({"cors_rule"}, set()),
    "aws_lambda_function.realtime_authorizer": ({"environment"},
                                                {"last_modified", "qualified_arn", "qualified_invoke_arn", "version",
                                                 "code_sha256", "source_code_size"}),
}

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


def rendered_function_code():
    """The repository template rendered exactly as edge.tf's templatefile() renders it (cloudfront.net -> apex on)."""
    return (FUNCTION_TEMPLATE.read_text()
            .replace("${canonical_host}", "seanshore.in")
            .replace("${alias_hosts}", json.dumps(ALIAS_HOSTS, separators=(",", ":")))
            .replace("${edge_host}", "d3prih0q6jofyr.cloudfront.net")
            .replace("${redirect_edge_host}", "true"))


def check_function_update(change):
    attributes = changed_attributes(change)
    if "code" not in attributes or not set(attributes) <= FUNCTION_UPDATABLE:
        refuse(f"address={FUNCTION_ADDRESS} attributes={','.join(attributes) or '-'}")
    body = after(change)
    if body.get("name") != FUNCTION_NAME or body.get("runtime") != "cloudfront-js-2.0" or body.get("publish") is not True:
        refuse(f"address={FUNCTION_ADDRESS} name, runtime or publish")
    if body.get("code") != rendered_function_code():
        refuse(f"address={FUNCTION_ADDRESS} code is not the repository template")


def has_unknown(value):
    if value is True:
        return True
    if isinstance(value, dict):
        return any(has_unknown(v) for v in value.values())
    if isinstance(value, list):
        return any(has_unknown(v) for v in value)
    return False


def split_attributes(change):
    """(known attributes that change, attributes left unknown): names only, never values."""
    body = change.get("change") or {}
    before, later, unknown = body.get("before") or {}, body.get("after") or {}, body.get("after_unknown") or {}
    unknown_names = {k for k, v in unknown.items() if has_unknown(v)}
    known = {k for k in set(before) | set(later) if k not in unknown_names and before.get(k) != later.get(k)}
    return known, unknown_names


def check_serve(plan, app_id, certificate_arn):
    if app_id != "EF1K45UVP11XZ" or not certificate_arn.startswith(f"arn:aws:acm:us-east-1:{ACCOUNT}:certificate/"):
        refuse("distribution or certificate")
    changes = managed_changes(plan)
    by = {c["address"]: c for c in changes}
    updated, created, unexpected = [], [], []
    for change in changes:
        address, actions = change["address"], (change.get("change") or {}).get("actions")
        if (change.get("change") or {}).get("importing"):
            refuse(f"address={address} imports in the serve step")
        if actions == ["no-op"]:
            continue
        if actions == ["create"] and address in NET_ALIAS_RECORDS:
            created.append(address)
            continue
        known, unknown = split_attributes(change)
        allowed_known, allowed_unknown = SERVE_UPDATES.get(address, (set(), set()))
        if actions != ["update"] or address not in SERVE_UPDATES or not known or not known <= allowed_known or not unknown <= allowed_unknown:
            unexpected.append((address, actions, known | unknown))
            continue
        updated.append(address)
    # Run 44995638740 named only the first: every unexpected change is listed (attribute names, never values).
    for address, actions, names in unexpected:
        print(f"DOMAIN_MOVE_PLAN_DIFF address={address} actions={'+'.join(actions or [])} attributes={','.join(sorted(names)) or '-'}")
    if unexpected:
        refuse(f"changes={len(unexpected)}")
    if not updated and not created:
        missing = [a for a in [*SERVE_UPDATES, *NET_ALIAS_RECORDS] if a not in by]
        if missing:
            refuse(f"missing from the plan: {len(missing)}")
        print("DOMAIN_MOVE_PLAN=NO_CHANGES")
        return
    # Partly applied is never expected: the step is one apply.
    if sorted(updated) != sorted(SERVE_UPDATES) or sorted(created) != NET_ALIAS_RECORDS:
        refuse(f"serve changes differ: updates={len(updated)} creates={len(created)}")

    dist = after(by["aws_cloudfront_distribution.app"])
    if sorted(dist.get("aliases") or []) != SERVE_ALIASES:
        refuse("distribution aliases")
    cert = dist.get("viewer_certificate") or [{}]
    if (len(cert) != 1 or cert[0].get("acm_certificate_arn") != certificate_arn or cert[0].get("ssl_support_method") != "sni-only"
            or cert[0].get("minimum_protocol_version") != "TLSv1.2_2021" or cert[0].get("cloudfront_default_certificate")):
        refuse("distribution certificate")
    check_function_update(by[FUNCTION_ADDRESS])

    pages = (after(by["aws_cloudfront_cache_policy.public_pages"]).get("parameters_in_cache_key_and_forwarded_to_origin") or [{}])[0]
    headers = (pages.get("headers_config") or [{}])[0]
    items = ((headers.get("headers") or [{}])[0]).get("items") or []
    if headers.get("header_behavior") != "whitelist" or sorted(i.lower() for i in items) != PAGE_KEY_HEADERS:
        refuse("page cache key headers")

    client = after(by["aws_cognito_user_pool_client.web"])
    if sorted(client.get("callback_urls") or []) != sorted(o + "/auth/google/callback" for o in BROWSER_ORIGINS):
        refuse("cognito callback urls")
    if sorted(client.get("logout_urls") or []) != sorted(BROWSER_ORIGINS):
        refuse("cognito logout urls")

    rules = after(by["aws_s3_bucket_cors_configuration.media"]).get("cors_rule") or []
    if (len(rules) != 1 or sorted(rules[0].get("allowed_origins") or []) != sorted(BROWSER_ORIGINS)
            or rules[0].get("allowed_methods") != ["PUT"] or rules[0].get("allowed_headers") != ["Content-Type"]):
        refuse("media upload cors")

    authorizer = by["aws_lambda_function.realtime_authorizer"]["change"]
    before_vars = ((authorizer.get("before") or {}).get("environment") or [{}])[0].get("variables") or {}
    after_vars = ((authorizer.get("after") or {}).get("environment") or [{}])[0].get("variables") or {}
    if after_vars.get("REALTIME_ALLOWED_ORIGINS") != ",".join(BROWSER_ORIGINS):
        refuse("realtime allowed origins")
    if {k: v for k, v in before_vars.items() if k != "REALTIME_ALLOWED_ORIGINS"} != {k: v for k, v in after_vars.items() if k != "REALTIME_ALLOWED_ORIGINS"}:
        refuse("realtime authorizer environment beyond its allowed origins")

    for address in NET_ALIAS_RECORDS:
        record = after(by[address])
        host, kind = address.split('"')[1].split(" ")
        alias = (record.get("alias") or [{}])[0]
        if (record.get("name") != host or record.get("type") != kind or record.get("zone_id") != SEANSHORE_NET_ZONE_ID
                or alias.get("name") != EDGE_HOST or alias.get("zone_id") != CLOUDFRONT_ZONE_ID
                or alias.get("evaluate_target_health") is not False or record.get("records")):
            refuse(f"address={address} record")
    print(f"DOMAIN_MOVE_PLAN=SERVE updates={len(updated)} creates={len(created)}")


def check_create(plan, app_id, redirect_id):
    changes = managed_changes(plan)
    created = sorted(c["address"] for c in changes if (c.get("change") or {}).get("actions") == ["create"])
    updated = 0
    for change in changes:
        actions = (change.get("change") or {}).get("actions")
        if (change.get("change") or {}).get("importing"):
            refuse(f"address={change['address']} imports in the create step")
        if change["address"] == FUNCTION_ADDRESS and actions == ["update"]:
            check_function_update(change)
            updated += 1
        elif actions not in (["no-op"], ["create"]):
            refuse(f"address={change['address']} actions={'+'.join(actions or [])}")
    if not created:
        in_plan = {c["address"] for c in changes}
        missing = [a for a in EXPECTED_CREATES if a not in in_plan]
        if missing:
            refuse(f"missing from the plan: {len(missing)}")
        print(f"DOMAIN_MOVE_PLAN=CREATE creates=0 updates={updated}" if updated else "DOMAIN_MOVE_PLAN=NO_CHANGES")
        return
    if created != EXPECTED_CREATES:
        extra = sorted(set(created) - set(EXPECTED_CREATES))
        missing = sorted(set(EXPECTED_CREATES) - set(created))
        refuse(f"creates differ: extra={extra[:3]} missing={missing[:3]}")
    by = {c["address"]: after(c) for c in changes}

    def names(cert):
        # Run 44904143142: the AWS provider (6.62.0) plans subject_alternative_names with the domain name included, so
        # the names are compared as a set.
        return sorted(set([cert.get("domain_name")] + list(cert.get("subject_alternative_names") or [])))

    site_edge, legacy = by["aws_acm_certificate.site_edge"], by["aws_acm_certificate.legacy_redirect"]
    if site_edge.get("domain_name") != "seanshore.in" or names(site_edge) != sorted(SITE_EDGE_NAMES):
        refuse("site_edge names")
    if legacy.get("domain_name") != "seaandshore.in" or names(legacy) != sorted(LEGACY_NAMES) or len(LEGACY_NAMES) != 10:
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
    print(f"DOMAIN_MOVE_PLAN=CREATE creates={len(created)} updates={updated}")


def main(argv):
    if len(argv) == 3 and argv[1] == "import":
        with open(argv[2]) as handle:
            check_import(json.load(handle))
        return
    if len(argv) == 5 and argv[1] == "serve":
        with open(argv[2]) as handle:
            check_serve(json.load(handle), argv[3], argv[4])
        return
    if len(argv) == 5 and argv[1] == "create":
        with open(argv[2]) as handle:
            check_create(json.load(handle), argv[3], argv[4])
        return
    refuse("usage")


if __name__ == "__main__":
    main(sys.argv)
