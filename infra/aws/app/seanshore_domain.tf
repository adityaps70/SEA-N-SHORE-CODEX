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


resource "aws_route53_record" "seanshore_legacy_apex" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = "seanshore.in"
  type    = "A"
  ttl     = 300
  records = ["162.215.226.7"]
}

resource "aws_route53_record" "seanshore_legacy_www" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = "www.seanshore.in"
  type    = "A"
  ttl     = 300
  records = ["162.215.226.7"]
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

# SES verification records are additive; preserve the legacy website A/WWW records until the production cutover is separately approved.
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
