# Branded Cognito hosted domain so Google's consent screen shows auth.seanshore.in instead of
# the amazoncognito.com prefix. AWS_COGNITO_DOMAIN points here; the prefix domain
# (aws_cognito_user_pool_domain.app) stays in place for its already-registered redirect URI.
locals {
  cognito_custom_auth_domain = "auth.seanshore.in"
}

# Cognito custom domains are served by CloudFront, so the certificate must live in us-east-1.
resource "aws_acm_certificate" "cognito_auth" {
  provider          = aws.us_east_1
  domain_name       = local.cognito_custom_auth_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = "${local.cognito_custom_auth_domain} Cognito certificate"
  })
}

resource "aws_route53_record" "cognito_auth_validation" {
  for_each = {
    for option in aws_acm_certificate.cognito_auth.domain_validation_options :
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

resource "aws_acm_certificate_validation" "cognito_auth" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cognito_auth.arn
  validation_record_fqdns = [for record in aws_route53_record.cognito_auth_validation : record.fqdn]
}

resource "aws_cognito_user_pool_domain" "custom" {
  domain          = local.cognito_custom_auth_domain
  certificate_arn = aws_acm_certificate_validation.cognito_auth.certificate_arn
  user_pool_id    = aws_cognito_user_pool.app.id
}

resource "aws_route53_record" "cognito_auth_a" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = local.cognito_custom_auth_domain
  type    = "A"

  alias {
    name                   = aws_cognito_user_pool_domain.custom.cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.custom.cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "cognito_auth_aaaa" {
  zone_id = aws_route53_zone.seanshore.zone_id
  name    = local.cognito_custom_auth_domain
  type    = "AAAA"

  alias {
    name                   = aws_cognito_user_pool_domain.custom.cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.custom.cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}
