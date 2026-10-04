# Round 14 (1.4): CloudFront is the only way in. The ALB gets an HTTPS listener for
# origin-staging.seaandshore.in that forwards only requests carrying the secret X-Origin-Verify
# header (CloudFront adds it; anyone else gets 403), and a security group that admits CloudFront's
# origin-facing range on 443. Zero-downtime order: (A) this listener, DNS name and group are added
# beside the existing HTTP path; (B) CloudFront switches to https-only with the header; (C) port 80
# and the open 0.0.0.0/0 rules are removed.

resource "aws_route53_record" "origin_tls_validation" {
  for_each = {
    for option in aws_acm_certificate.origin_tls.domain_validation_options :
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

resource "aws_acm_certificate_validation" "origin_tls" {
  certificate_arn         = aws_acm_certificate.origin_tls.arn
  validation_record_fqdns = [for record in aws_route53_record.origin_tls_validation : record.fqdn]

  timeouts {
    create = "30m"
  }
}

resource "aws_route53_record" "origin_staging" {
  zone_id = aws_route53_zone.seaandshore.zone_id
  name    = var.origin_tls_hostname
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = false
  }
}

# Shared secret between CloudFront and the ALB. Alphanumeric so the ALB header condition matches it
# literally (ALB conditions treat * and ? as wildcards).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "origin_verify" {
  name                    = "${local.name_prefix}/origin-verify"
  description             = "Header value CloudFront sends to the ALB origin (X-Origin-Verify)."
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id     = aws_secretsmanager_secret.origin_verify.id
  secret_string = random_password.origin_verify.result
}

resource "aws_lb_listener" "origin_https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.origin_tls.certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  lifecycle {
    precondition {
      condition     = var.certificate_arn == ""
      error_message = "origin_https owns port 443; leave certificate_arn empty (the legacy https listener would collide)."
    }
  }

  tags = local.common_tags
}

resource "aws_lb_listener_rule" "origin_https_verified" {
  listener_arn = aws_lb_listener.origin_https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  tags = local.common_tags
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Its own group: the CloudFront prefix list counts as about 55 rules against the per-group quota.
resource "aws_security_group" "alb_cloudfront" {
  name        = "${local.name_prefix}-alb-cloudfront"
  description = "CloudFront origin-facing HTTPS to the Sea N Shore ALB"
  vpc_id      = aws_vpc.app.id

  ingress {
    description     = "HTTPS from CloudFront"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-alb-cloudfront" })
}
