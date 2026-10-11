#!/usr/bin/env python3
"""Redirect the extra Sea N Shore domains to https://seanshore.in over HTTP and HTTPS.

Creates, in the AWS account the AWS CLI is logged in to:
  - a Route 53 hosted zone per domain
  - one ACM certificate (us-east-1) covering every domain and its www name
  - a CloudFront Function that answers every request with a 301 to TARGET
  - one CloudFront distribution serving all the domains with that function
  - Route 53 alias records (A + AAAA) pointing each name at the distribution

Run it in AWS CloudShell. It is safe to re-run: each run picks up where the last
one stopped and prints the next step. To add a domain later (e.g. seanshore.sg),
add it to DOMAINS and run again.
"""
import json
import subprocess
import sys
import tempfile
import time

DOMAINS = ["seanshore.nl", "seanshore.ph"]  # add "seanshore.sg" once it is registered
TARGET = "https://seanshore.in"
TAG = "seanshore-redirect-domains"
CLOUDFRONT_HOSTED_ZONE_ID = "Z2FDTNDATAQYW2"  # fixed zone ID for every CloudFront alias
CACHING_DISABLED_POLICY_ID = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # AWS managed policy

FUNCTION_CODE = """function handler(event) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: { location: { value: '%s' + event.request.uri } }
  };
}
""" % TARGET


class AwsError(Exception):
    pass


def aws(*args, region=None):
    cmd = ["aws", *args, "--output", "json"]
    if region:
        cmd += ["--region", region]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise AwsError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def acm(*args):
    return aws("acm", *args, region="us-east-1")  # CloudFront only accepts us-east-1 certificates


def hosted_zone(domain):
    for zone in aws("route53", "list-hosted-zones-by-name", "--dns-name", domain + ".")["HostedZones"]:
        if zone["Name"] == domain + "." and not zone["Config"].get("PrivateZone"):
            return zone["Id"].split("/")[-1]
    zone = aws("route53", "create-hosted-zone", "--name", domain,
               "--caller-reference", f"{domain}-{int(time.time())}")
    print(f"Created Route 53 hosted zone for {domain}")
    return zone["HostedZone"]["Id"].split("/")[-1]


def nameservers(zone_id):
    return aws("route53", "get-hosted-zone", "--id", zone_id)["DelegationSet"]["NameServers"]


def upsert(zone_id, records):
    batch = {"Changes": [{"Action": "UPSERT", "ResourceRecordSet": r} for r in records]}
    aws("route53", "change-resource-record-sets", "--hosted-zone-id", zone_id,
        "--change-batch", json.dumps(batch))


def certificate(names):
    summaries = acm("list-certificates", "--certificate-statuses",
                    "PENDING_VALIDATION", "ISSUED")["CertificateSummaryList"]
    for summary in summaries:
        if summary["DomainName"] != names[0]:
            continue
        cert = acm("describe-certificate", "--certificate-arn", summary["CertificateArn"])["Certificate"]
        if sorted(cert["SubjectAlternativeNames"]) == sorted(names):
            return cert
    arn = acm("request-certificate", "--domain-name", names[0],
              "--subject-alternative-names", *names[1:],
              "--validation-method", "DNS")["CertificateArn"]
    print(f"Requested certificate for {', '.join(names)}")
    for _ in range(30):  # validation records appear a few seconds after the request
        cert = acm("describe-certificate", "--certificate-arn", arn)["Certificate"]
        if all("ResourceRecord" in o for o in cert["DomainValidationOptions"]):
            return cert
        time.sleep(5)
    sys.exit("ACM did not return validation records in time. Run the script again.")


def apex_of(name):
    return next(d for d in DOMAINS if name == d or name.endswith("." + d))


def redirect_function():
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(FUNCTION_CODE)
    code = f"fileb://{f.name}"
    config = json.dumps({"Comment": f"301 to {TARGET}", "Runtime": "cloudfront-js-2.0"})
    try:
        etag = aws("cloudfront", "describe-function", "--name", TAG)["ETag"]
        etag = aws("cloudfront", "update-function", "--name", TAG, "--if-match", etag,
                   "--function-config", config, "--function-code", code)["ETag"]
    except AwsError as e:
        if "NoSuchFunctionExists" not in str(e):
            raise
        etag = aws("cloudfront", "create-function", "--name", TAG,
                   "--function-config", config, "--function-code", code)["ETag"]
        print("Created CloudFront redirect function")
    published = aws("cloudfront", "publish-function", "--name", TAG, "--if-match", etag)
    return published["FunctionSummary"]["FunctionMetadata"]["FunctionARN"]


def distribution(aliases, cert_arn, function_arn):
    def apply(cfg):
        cfg["Aliases"] = {"Quantity": len(aliases), "Items": aliases}
        cfg["ViewerCertificate"] = {"ACMCertificateArn": cert_arn, "SSLSupportMethod": "sni-only",
                                    "MinimumProtocolVersion": "TLSv1.2_2021"}
        cfg["DefaultCacheBehavior"]["FunctionAssociations"] = {
            "Quantity": 1, "Items": [{"EventType": "viewer-request", "FunctionARN": function_arn}]}

    items = aws("cloudfront", "list-distributions").get("DistributionList", {}).get("Items", [])
    existing = next((d for d in items if d["Comment"] == TAG), None)
    if existing:
        current = aws("cloudfront", "get-distribution-config", "--id", existing["Id"])
        cfg = current["DistributionConfig"]
        apply(cfg)
        dist = aws("cloudfront", "update-distribution", "--id", existing["Id"],
                   "--if-match", current["ETag"], "--distribution-config", json.dumps(cfg))
        print("Updated CloudFront distribution")
    else:
        cfg = {
            "CallerReference": f"{TAG}-{int(time.time())}",
            "Comment": TAG,
            "Enabled": True,
            "PriceClass": "PriceClass_200",
            "HttpVersion": "http2and3",
            "IsIPV6Enabled": True,
            # Never contacted: the viewer-request function answers every request itself.
            "Origins": {"Quantity": 1, "Items": [{
                "Id": "unused-origin",
                "DomainName": TARGET.split("://")[1],
                "CustomOriginConfig": {"HTTPPort": 80, "HTTPSPort": 443,
                                       "OriginProtocolPolicy": "https-only",
                                       "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]}},
            }]},
            "DefaultCacheBehavior": {
                "TargetOriginId": "unused-origin",
                "ViewerProtocolPolicy": "allow-all",  # http and https both get the 301 directly
                "CachePolicyId": CACHING_DISABLED_POLICY_ID,
            },
        }
        apply(cfg)
        dist = aws("cloudfront", "create-distribution", "--distribution-config", json.dumps(cfg))
        print("Created CloudFront distribution")
    return dist["Distribution"]["DomainName"]


def main():
    names = [n for d in DOMAINS for n in (d, "www." + d)]
    zones = {d: hosted_zone(d) for d in DOMAINS}
    cert = certificate(names)

    if cert["Status"] != "ISSUED":
        for option in cert["DomainValidationOptions"]:
            record = option["ResourceRecord"]
            upsert(zones[apex_of(option["DomainName"])], [{
                "Name": record["Name"], "Type": record["Type"], "TTL": 300,
                "ResourceRecords": [{"Value": record["Value"]}]}])
        print("\nCertificate is waiting for validation (status: %s)." % cert["Status"])
        print("In Namecheap, set each domain's nameservers to Custom DNS with these values:\n")
        for d in DOMAINS:
            print(f"  {d}:")
            for ns in nameservers(zones[d]):
                print(f"    {ns}")
        print("\nThen run this script again (it will finish once the certificate is issued,"
              " usually 15 min to a few hours after the nameserver change).")
        return

    function_arn = redirect_function()
    target = distribution(names, cert["CertificateArn"], function_arn)
    for d in DOMAINS:
        upsert(zones[d], [
            {"Name": name, "Type": rtype, "AliasTarget": {
                "HostedZoneId": CLOUDFRONT_HOSTED_ZONE_ID, "DNSName": target,
                "EvaluateTargetHealth": False}}
            for name in (d, "www." + d) for rtype in ("A", "AAAA")])
    print(f"\nDone. {', '.join(names)} now redirect to {TARGET} (CloudFront takes 5-15 min to deploy).")


if __name__ == "__main__":
    try:
        main()
    except AwsError as e:
        sys.exit(f"AWS error: {e}")
