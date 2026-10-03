resource "aws_route53_zone" "seanshore" {
  name = "seanshore.in"

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = "seanshore.in"
  })
}

resource "aws_acm_certificate" "seanshore_edge" {
  provider                  = aws.us_east_1
  domain_name               = "seanshore.in"
  subject_alternative_names = ["www.seanshore.in"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }

  tags = merge(local.common_tags, {
    Name = "seanshore.in edge certificate"
  })
}


# Production cutover (phase 2): apex + www alias to the app CloudFront distribution. The two
# "legacy" resources are the original website A records updated in place to aliases; they keep
# their resource names because `moved` blocks would break every -target plan in the guarded
# scripts until the move is applied.
locals {
  seanshore_site_records = {
    apex_a    = { name = "seanshore.in", type = "A" }
    apex_aaaa = { name = "seanshore.in", type = "AAAA" }
    www_a     = { name = "www.seanshore.in", type = "A" }
    www_aaaa  = { name = "www.seanshore.in", type = "AAAA" }
  }
}

resource "aws_route53_record" "seanshore_legacy_apex" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = local.seanshore_site_records.apex_a.name
  type    = local.seanshore_site_records.apex_a.type

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "seanshore_apex_aaaa" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = local.seanshore_site_records.apex_aaaa.name
  type    = local.seanshore_site_records.apex_aaaa.type

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "seanshore_legacy_www" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = local.seanshore_site_records.www_a.name
  type    = local.seanshore_site_records.www_a.type

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "seanshore_www_aaaa" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = local.seanshore_site_records.www_aaaa.name
  type    = local.seanshore_site_records.www_aaaa.type

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "seanshore_edge_validation" {
  for_each = {
    for option in aws_acm_certificate.seanshore_edge.domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      type   = option.resource_record_type
      record = option.resource_record_value
    }
  }

  zone_id = aws_route53_zone.seanshore.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}


data "aws_sesv2_email_identity" "seanshore_transactional" {
  email_identity = var.ses_domain
}

# SES verification records are additive and independent of the website records above.
resource "aws_route53_record" "seanshore_ses_dkim" {
  for_each = toset(
    data.aws_sesv2_email_identity.seanshore_transactional.dkim_signing_attributes[0].tokens
  )

  zone_id = aws_route53_zone.seanshore.zone_id
  name    = "${each.value}._domainkey.${var.ses_domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["${each.value}.dkim.amazonses.com"]
}
