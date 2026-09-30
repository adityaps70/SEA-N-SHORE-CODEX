# Legacy domain seaandshore.in (phase 3).
#
# Stage A (seaandshore_redirect_live = false): the Route 53 hosted zone with every record copied
# exactly from the previous name servers (ns1/ns2.bhin-pp-wb5.webhostbox.net, snapshot taken on
# 2026-09-29 via direct queries at 216.10.253.21), the ACM certificate request (validated through
# this zone once the registrar delegates the domain), and a redirect-only CloudFront distribution
# still served under its *.cloudfront.net name. Google Workspace mail (MX/SPF/site verification)
# keeps working unchanged after the delegation.
#
# Stage B (seaandshore_redirect_live = true, only after the certificate is ISSUED): the
# distribution takes the certificate and the apex/www aliases, and the apex A / www records become
# aliases to it. Every request then 301s to https://seanshore.in (see cloudfront/legacy-domain-redirect.js.tftpl).

variable "seaandshore_redirect_live" {
  description = "Stage B switch for seaandshore.in: attach the certificate and aliases to the redirect distribution and point apex + www at it. Requires the registrar delegation to Route 53 and an ISSUED certificate."
  type        = bool
  default     = true
}

locals {
  seaandshore_domain       = "seaandshore.in"
  seaandshore_legacy_ip    = "216.10.253.21"
  seaandshore_legacy_ttl   = 21600
  seaandshore_redirect_url = "https://${local.canonical_site_host}"
}

resource "aws_route53_zone" "seaandshore" {
  name = local.seaandshore_domain

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = local.seaandshore_domain
  })
}

# --- Records copied exactly from the previous DNS host -------------------------------------------

resource "aws_route53_record" "seaandshore_mx" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = local.seaandshore_domain
  type    = "MX"
  ttl     = local.seaandshore_legacy_ttl
  records = ["1 smtp.google.com."]
}

resource "aws_route53_record" "seaandshore_txt" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = local.seaandshore_domain
  type    = "TXT"
  ttl     = local.seaandshore_legacy_ttl
  records = [
    "v=spf1 include:_spf.google.com ~all",
    "google-site-verification=bg3lvB1nw4ODMIG7ExwNWTI5t8zW8AkR0DexUVLD1H4",
  ]
}

resource "aws_route53_record" "seaandshore_mail_a" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "mail.${local.seaandshore_domain}"
  type    = "A"
  ttl     = local.seaandshore_legacy_ttl
  records = [local.seaandshore_legacy_ip]
}

resource "aws_route53_record" "seaandshore_webmail_a" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "webmail.${local.seaandshore_domain}"
  type    = "A"
  ttl     = local.seaandshore_legacy_ttl
  records = [local.seaandshore_legacy_ip]
}

resource "aws_route53_record" "seaandshore_ftp_cname" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "ftp.${local.seaandshore_domain}"
  type    = "CNAME"
  ttl     = local.seaandshore_legacy_ttl
  records = [local.seaandshore_domain]
}

resource "aws_route53_record" "seaandshore_ns1_a" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "ns1.${local.seaandshore_domain}"
  type    = "A"
  ttl     = local.seaandshore_legacy_ttl
  records = [local.seaandshore_legacy_ip]
}

resource "aws_route53_record" "seaandshore_ns2_a" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "ns2.${local.seaandshore_domain}"
  type    = "A"
  ttl     = local.seaandshore_legacy_ttl
  records = [local.seaandshore_legacy_ip]
}

# cPanel AutoSSL validation token of the old host; copied for exactness, harmless once the site moves.
resource "aws_route53_record" "seaandshore_acme_challenge_txt" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "_acme-challenge.${local.seaandshore_domain}"
  type    = "TXT"
  ttl     = local.seaandshore_legacy_ttl
  records = ["coLRxfhIhhYaWhwZE_BBLN8nw1jEVxQpbXTphW4vU1A"]
}

# --- Website records: exact copy in stage A, aliases to the redirect distribution in stage B ------

resource "aws_route53_record" "seaandshore_apex_a" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = local.seaandshore_domain
  type    = "A"
  ttl     = var.seaandshore_redirect_live ? null : local.seaandshore_legacy_ttl
  records = var.seaandshore_redirect_live ? null : [local.seaandshore_legacy_ip]

  dynamic "alias" {
    for_each = var.seaandshore_redirect_live ? [1] : []
    content {
      name                   = aws_cloudfront_distribution.seaandshore_redirect.domain_name
      zone_id                = aws_cloudfront_distribution.seaandshore_redirect.hosted_zone_id
      evaluate_target_health = false
    }
  }
}

# www is a CNAME to the apex today; in stage B it becomes an A alias (CloudFront cannot be a CNAME
# target for a zone apex-style alias pair, and the CNAME would block the AAAA record below).
resource "aws_route53_record" "seaandshore_www" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "www.${local.seaandshore_domain}"
  type    = var.seaandshore_redirect_live ? "A" : "CNAME"
  ttl     = var.seaandshore_redirect_live ? null : local.seaandshore_legacy_ttl
  records = var.seaandshore_redirect_live ? null : [local.seaandshore_domain]

  dynamic "alias" {
    for_each = var.seaandshore_redirect_live ? [1] : []
    content {
      name                   = aws_cloudfront_distribution.seaandshore_redirect.domain_name
      zone_id                = aws_cloudfront_distribution.seaandshore_redirect.hosted_zone_id
      evaluate_target_health = false
    }
  }
}

resource "aws_route53_record" "seaandshore_apex_aaaa" {
  count = var.seaandshore_redirect_live ? 1 : 0

  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = local.seaandshore_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.seaandshore_redirect.domain_name
    zone_id                = aws_cloudfront_distribution.seaandshore_redirect.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "seaandshore_www_aaaa" {
  count = var.seaandshore_redirect_live ? 1 : 0

  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = "www.${local.seaandshore_domain}"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.seaandshore_redirect.domain_name
    zone_id                = aws_cloudfront_distribution.seaandshore_redirect.hosted_zone_id
    evaluate_target_health = false
  }

  # The www CNAME must be gone before an AAAA can exist at the same name.
  depends_on = [aws_route53_record.seaandshore_www]
}

# --- Certificate (validated through the new zone once the registrar delegates) -------------------

resource "aws_acm_certificate" "seaandshore_edge" {
  provider                  = aws.us_east_1
  domain_name               = local.seaandshore_domain
  subject_alternative_names = ["www.${local.seaandshore_domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }

  tags = merge(local.common_tags, {
    Name = "seaandshore.in redirect certificate"
  })
}

resource "aws_route53_record" "seaandshore_edge_validation" {
  for_each = {
    for option in aws_acm_certificate.seaandshore_edge.domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      type   = option.resource_record_type
      record = option.resource_record_value
    }
  }

  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}

# --- Redirect-only distribution -------------------------------------------------------------------

resource "aws_cloudfront_function" "legacy_domain_redirect" {
  name    = "${local.name_prefix}-legacy-domain-redirect"
  runtime = "cloudfront-js-2.0"
  comment = "seaandshore.in -> https://seanshore.in (301, old pages mapped, query kept)"
  publish = true

  code = templatefile("${path.module}/cloudfront/legacy-domain-redirect.js.tftpl", {
    canonical_host = local.canonical_site_host
  })
}

resource "aws_cloudfront_distribution" "seaandshore_redirect" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Sea N Shore legacy domain redirect (seaandshore.in -> seanshore.in)"
  aliases         = var.seaandshore_redirect_live ? [local.seaandshore_domain, "www.${local.seaandshore_domain}"] : []

  # The viewer-request function answers every request; CloudFront still requires an origin.
  origin {
    domain_name = local.canonical_site_host
    origin_id   = "seanshore-canonical"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "seanshore-canonical"
    viewer_protocol_policy = "allow-all"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_disabled.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.legacy_domain_redirect.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.seaandshore_redirect_live ? [1] : []
    content {
      acm_certificate_arn      = aws_acm_certificate.seaandshore_edge.arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.seaandshore_redirect_live ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = !var.seaandshore_redirect_live || aws_acm_certificate.seaandshore_edge.status == "ISSUED"
      error_message = "The seaandshore.in certificate must be ISSUED before the redirect distribution can serve the domain."
    }
  }

  tags = merge(local.common_tags, {
    Name = "seaandshore.in redirect"
  })
}

output "seaandshore_name_servers" {
  description = "Route 53 name servers to set at the seaandshore.in registrar."
  value       = aws_route53_zone.seaandshore.name_servers
}

output "seaandshore_redirect_domain_name" {
  value = aws_cloudfront_distribution.seaandshore_redirect.domain_name
}
