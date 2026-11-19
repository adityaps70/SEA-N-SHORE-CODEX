# Domain move (seanshore.net), Phase 1 (owner-approved 18 Nov). Applied only by scripts/aws/domain-move-infra.sh, in
# two guarded steps; no other runner targets anything here.
#
#   import-once  Brings what was made in the console under Terraform, unchanged: the seanshore.net zone, the
#                .ph/.nl/.si/seaandshore.si zones with their records, the console redirect distribution, its function
#                and certificate, and four records in the seanshore.in zone. The plan must show imports with no
#                change at all. The import blocks live in the runner (scripts/aws/domain-move-imports.tf.tpl), never
#                here, so no other runner can import as a side effect.
#   create-once  Creates only: the new main certificate (seanshore.in + seanshore.net, apex and www), the one
#                redirect certificate for all ten old names (Phase 2), the Resend and DMARC records for
#                seanshore.net, and the private edge-logs bucket with CloudFront log delivery (30 days, owner D4).
#
# Serving seanshore.net (aliases, the certificate swap, origins in Cognito/CORS/realtime) is a later step: changing
# the main distribution here now would show up in every other edge run's plan.

locals {
  # Console-made zones of the move (Route 53 ids from the Phase 0 report, 18 Nov).
  seanshore_net_zone_id = "Z09758912UIE2T2PK09U"
  console_zone_ids = {
    "seanshore.ph"   = "Z05197552XYDOWN0X9CW4"
    "seanshore.nl"   = "Z052963238K0EY0F47OHA"
    "seanshore.si"   = "Z062621815JNY5E5LWNPL"
    "seaandshore.si" = "Z08656012EDRU2YXY3ZT8"
  }
  console_redirect_hosts = flatten([for zone in sort(keys(local.console_zone_ids)) : [zone, "www.${zone}"]])
  console_redirect_alias_records = {
    for pair in setproduct(local.console_redirect_hosts, ["A", "AAAA"]) : "${pair[0]} ${pair[1]}" => {
      host = pair[0]
      type = pair[1]
      zone = trimprefix(pair[0], "www.")
    }
  }
  # ACM validation records of the console redirect certificate (they also validate the new redirect certificate:
  # ACM keeps one validation record per name and account).
  console_redirect_validation_records = {
    "_7174cb4244bac86afafb95ddeaabf6db.seanshore.ph"       = { zone = "seanshore.ph", value = "_563fda170d09e6965621981e095ef382.wzccmgtwzk.acm-validations.aws." }
    "_87fc76e948b4883bc1974376f292aca6.www.seanshore.ph"   = { zone = "seanshore.ph", value = "_e073dfeca34a96c55b63526de0dd61e4.wzccmgtwzk.acm-validations.aws." }
    "_50d2b904c17f8fb011ecc4ec8ce4b283.seanshore.nl"       = { zone = "seanshore.nl", value = "_fc244fe28deb6e7f5d00329e50390b5a.wzccmgtwzk.acm-validations.aws." }
    "_3f9bb0ee552791619aae8c75f274c910.www.seanshore.nl"   = { zone = "seanshore.nl", value = "_4078639fcee5bd8fb24c77f9f9ade53f.wzccmgtwzk.acm-validations.aws." }
    "_593f2bd7eb81c6d456d1edfd572e40e3.seanshore.si"       = { zone = "seanshore.si", value = "_a033186f10b1e323f017a536ea7e076a.wzccmgtwzk.acm-validations.aws." }
    "_fc37b62195dcf025867ce7cf1c6f52b5.www.seanshore.si"   = { zone = "seanshore.si", value = "_feeda725491e5bb1032b193d0bc8f4c3.wzccmgtwzk.acm-validations.aws." }
    "_87316a6386dd4c23ab5534d20a0c00b7.seaandshore.si"     = { zone = "seaandshore.si", value = "_4d31057fbf54eefaac93a55e7b04231b.wzccmgtwzk.acm-validations.aws." }
    "_b200d0fa6c54695a0cefbf3cb32f0009.www.seaandshore.si" = { zone = "seaandshore.si", value = "_67b9c33267349b4fc5d555cb4e6635c8.wzccmgtwzk.acm-validations.aws." }
  }

  # Resend sending records (Tokyo region). mail.seanshore.in has no receiving MX, so neither does mail.seanshore.net.
  resend_dkim = {
    "seanshore.in"  = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDSX2dfDfpngwgc/gDhY+eVdgUAxA2NR96kVGTB2woQIbte47G+D0CwgEb3EG7gQRYROv3O9sxHMYaQafahwOKK67hO/OKGbotvaMO+UeR2QPM1ByUIVV9PUya2lbueR5xO+AFoJ3GXP9YX8dz1o28jyGdQIKK7hoqOFXnQAvhU0QIDAQAB"
    "seanshore.net" = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDKmZ7G5zJOhhhDqfJlAw034K9glh0NEU/PJcOEjnHp96b9CdIoqEnSzbUIaash/BZ0KOAx7REKBisFRsdwk0VfoNEwSsjQZvisORzWDN5Fsj/CgcwcSxqHI4b4aWWm71ZMTXszyaFPn2+ysI+M6CM3lPY5yW6+sSya19hgym5mPQIDAQAB"
  }
  resend_return_path = {
    send  = "send.forge.rmta.net"
    rsend = "rsend-apne1.forge.rmta.net"
  }

  # The ten old names that redirect to the main site from Phase 2 (one redirect distribution, owner D3).
  legacy_redirect_names = concat(["seaandshore.in", "www.seaandshore.in"], local.console_redirect_hosts)

  # CloudFront log delivery (owner D4): the main and the redirect distribution, by id (no Terraform dependency on
  # the distributions, so this step never plans them). scripts/aws/domain-move-infra.sh checks both ids against state.
  edge_log_distribution_ids = {
    app      = "EF1K45UVP11XZ"
    redirect = "EK1KQZWPWQZNQ"
  }
  edge_logs_bucket = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}-edge-logs"
}

# --- import-once: console-made resources, unchanged ----------------------------------------------------------------

resource "aws_route53_zone" "seanshore_net" {
  name    = "seanshore.net"
  comment = "Primary domain for Sea N Shore. Import into Terraform."

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_zone" "console" {
  for_each = local.console_zone_ids

  name = each.key

  # These zones were made in the console with no comment. The provider cannot hold an empty comment (it falls back to
  # "Managed by Terraform"), so the import would plan a comment change; the comment is only a label.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [comment]
  }
}

resource "aws_acm_certificate" "console_redirect" {
  provider          = aws.us_east_1
  domain_name       = "seanshore.nl"
  validation_method = "DNS"
  # The provider lists the alternative names without the certificate's own domain name.
  subject_alternative_names = [
    "www.seanshore.nl", "seanshore.ph", "www.seanshore.ph",
    "seanshore.si", "www.seanshore.si", "seaandshore.si", "www.seaandshore.si",
  ]

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudfront_function" "console_redirect" {
  name    = "seanshore-redirect-domains"
  runtime = "cloudfront-js-2.0"
  comment = ""
  publish = true
  code    = file("${path.module}/cloudfront/console-redirect-domains.js.tftpl")

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudfront_distribution" "console_redirect" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "seanshore-redirect-domains"
  price_class     = "PriceClass_200"
  aliases         = local.console_redirect_hosts

  # The viewer-request function answers every request; CloudFront still requires an origin.
  origin {
    domain_name         = local.canonical_site_host
    origin_id           = "unused-origin"
    connection_attempts = 3
    connection_timeout  = 10

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_keepalive_timeout = 5
      origin_read_timeout      = 30
    }
  }

  default_cache_behavior {
    target_origin_id       = "unused-origin"
    viewer_protocol_policy = "allow-all"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_disabled.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.console_redirect.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.console_redirect.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "console_redirect_alias" {
  for_each = local.console_redirect_alias_records

  zone_id = aws_route53_zone.console[each.value.zone].zone_id
  name    = each.value.host
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.console_redirect.domain_name
    zone_id                = aws_cloudfront_distribution.console_redirect.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "console_redirect_validation" {
  for_each = local.console_redirect_validation_records

  zone_id = aws_route53_zone.console[each.value.zone].zone_id
  name    = each.key
  type    = "CNAME"
  ttl     = 300
  records = [each.value.value]
}

# seanshore.in records made outside Terraform: Search Console verification (keep: Change of Address needs it) and
# the Resend sending records for mail.seanshore.in.
resource "aws_route53_record" "seanshore_google_site_verification" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = "seanshore.in"
  type    = "TXT"
  ttl     = 300
  records = ["google-site-verification=2XCuh2y7maMBH_pp6vDLIewDGWB9Z3QnNO7lZ3BaMO4"]
}

resource "aws_route53_record" "seanshore_resend_dkim" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = "resend._domainkey.mail.seanshore.in"
  type    = "TXT"
  ttl     = 300
  records = [local.resend_dkim["seanshore.in"]]
}

resource "aws_route53_record" "seanshore_resend_return_path" {
  for_each = local.resend_return_path

  zone_id = aws_route53_zone.seanshore.zone_id
  name    = "${each.key}.mail.seanshore.in"
  type    = "CNAME"
  ttl     = 300
  records = [each.value]
}

# --- create-once: new resources only ----------------------------------------------------------------------------

resource "aws_route53_record" "seanshore_net_resend_dkim" {
  zone_id = aws_route53_zone.seanshore_net.zone_id
  name    = "resend._domainkey.mail.seanshore.net"
  type    = "TXT"
  ttl     = 300
  records = [local.resend_dkim["seanshore.net"]]
}

resource "aws_route53_record" "seanshore_net_resend_return_path" {
  for_each = local.resend_return_path

  zone_id = aws_route53_zone.seanshore_net.zone_id
  name    = "${each.key}.mail.seanshore.net"
  type    = "CNAME"
  ttl     = 300
  records = [each.value]
}

# Same policy as seanshore.in (email-dns.tf). Nothing sends from seanshore.net until the owner moves the From
# addresses (about 2 weeks after the switch).
resource "aws_route53_record" "seanshore_net_dmarc" {
  zone_id = aws_route53_zone.seanshore_net.zone_id
  name    = "_dmarc.seanshore.net"
  type    = "TXT"
  ttl     = 300
  records = ["v=DMARC1; p=quarantine; adkim=r; aspf=r"]
}

# The main distribution's next certificate: the current names plus seanshore.net (apex and www). One certificate per
# distribution, so it covers both domains during the move. The seanshore.in names validate through the records that
# already exist (aws_route53_record.seanshore_edge_validation); only the seanshore.net names get new ones.
resource "aws_acm_certificate" "site_edge" {
  provider                  = aws.us_east_1
  domain_name               = "seanshore.in"
  subject_alternative_names = ["www.seanshore.in", "seanshore.net", "www.seanshore.net"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }

  tags = merge(local.common_tags, {
    Name = "seanshore.in + seanshore.net edge certificate"
  })
}

resource "aws_route53_record" "site_edge_validation" {
  for_each = {
    for option in aws_acm_certificate.site_edge.domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      type   = option.resource_record_type
      record = option.resource_record_value
    } if endswith(option.domain_name, "seanshore.net")
  }

  zone_id = aws_route53_zone.seanshore_net.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "site_edge" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.site_edge.arn
  validation_record_fqdns = concat(
    [for record in aws_route53_record.seanshore_edge_validation : record.fqdn],
    [for record in aws_route53_record.site_edge_validation : record.fqdn],
  )

  timeouts {
    create = "45m"
  }
}

# Phase 2's one redirect distribution (owner D3): all ten old names. Every name already has its validation record
# (seaandshore.in through seaandshore_edge_validation, the rest through the imported console records). Ten names is
# the default ACM limit per certificate.
resource "aws_acm_certificate" "legacy_redirect" {
  provider                  = aws.us_east_1
  domain_name               = local.legacy_redirect_names[0]
  subject_alternative_names = slice(local.legacy_redirect_names, 1, length(local.legacy_redirect_names))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }

  tags = merge(local.common_tags, {
    Name = "legacy domains redirect certificate"
  })
}

resource "aws_acm_certificate_validation" "legacy_redirect" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.legacy_redirect.arn
  validation_record_fqdns = concat(
    [for record in aws_route53_record.seaandshore_edge_validation : record.fqdn],
    [for record in aws_route53_record.console_redirect_validation : record.fqdn],
  )

  timeouts {
    create = "45m"
  }
}

# Private edge-logs bucket (owner D4): CloudFront access logs hold visitor IP addresses, so the bucket is private,
# encrypted, refuses plain HTTP, and deletes every log after 30 days. Logs never go into Actions logs or PR comments.
resource "aws_s3_bucket" "edge_logs" {
  provider      = aws.us_east_1
  bucket        = local.edge_logs_bucket
  force_destroy = false

  tags = merge(local.common_tags, {
    Purpose = "edge-logs"
  })
}

resource "aws_s3_bucket_public_access_block" "edge_logs" {
  provider = aws.us_east_1
  bucket   = aws_s3_bucket.edge_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "edge_logs" {
  provider = aws.us_east_1
  bucket   = aws_s3_bucket.edge_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "edge_logs" {
  provider = aws.us_east_1
  bucket   = aws_s3_bucket.edge_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "edge_logs" {
  provider = aws.us_east_1
  bucket   = aws_s3_bucket.edge_logs.id

  rule {
    id     = "expire-edge-logs-after-30-days"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "edge_logs" {
  provider = aws.us_east_1
  bucket   = aws_s3_bucket.edge_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.edge_logs.arn, "${aws_s3_bucket.edge_logs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "CloudFrontLogDeliveryWrites"
        Effect    = "Allow"
        Principal = { Service = "delivery.logs.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.edge_logs.arn}/*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
          ArnLike      = { "aws:SourceArn" = "arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*" }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.edge_logs]
}

resource "aws_cloudwatch_log_delivery_source" "edge" {
  provider = aws.us_east_1
  for_each = local.edge_log_distribution_ids

  name         = "${local.name_prefix}-edge-${each.key}"
  log_type     = "ACCESS_LOGS"
  resource_arn = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${each.value}"

  tags = local.common_tags
}

resource "aws_cloudwatch_log_delivery_destination" "edge_logs" {
  provider      = aws.us_east_1
  name          = "${local.name_prefix}-edge-logs"
  output_format = "json"

  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.edge_logs.arn
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_delivery" "edge" {
  provider = aws.us_east_1
  for_each = local.edge_log_distribution_ids

  delivery_source_name     = aws_cloudwatch_log_delivery_source.edge[each.key].name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.edge_logs.arn

  s3_delivery_configuration {
    suffix_path = "${each.key}/{yyyy}/{MM}/{dd}/{HH}"
  }

  tags = local.common_tags

  depends_on = [aws_s3_bucket_policy.edge_logs]
}
