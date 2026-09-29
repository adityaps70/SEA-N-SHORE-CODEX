# Restore ownership of the existing CloudFront-scoped ACL; do not recreate it.
resource "aws_wafv2_web_acl" "edge" {
  provider = aws.us_east_1
  name     = "${local.name_prefix}-edge"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10
    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # Profile photos and cover images are submitted as authenticated Next.js
        # Server Action multipart bodies. Keep the managed rule visible in metrics,
        # but let the application's 6 MB action limit and 5 MB image validator make
        # the allow/reject decision for legitimate uploads.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }

        # Binary multipart image bytes can falsely match the CRS body-XSS signature.
        # Count the managed match so its label remains available to the bounded rule
        # below, which restores blocking everywhere except exact POST /profile uploads.
        rule_action_override {
          name = "CrossSiteScripting_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "BlockManagedBodyXssExceptProfileMedia"
    priority = 15

    action {
      block {}
    }

    statement {
      and_statement {
        statement {
          label_match_statement {
            scope = "LABEL"
            key   = "awswaf:managed:aws:core-rule-set:CrossSiteScripting_Body"
          }
        }

        statement {
          not_statement {
            statement {
              and_statement {
                statement {
                  byte_match_statement {
                    field_to_match {
                      method {}
                    }
                    positional_constraint = "EXACTLY"
                    search_string         = "POST"
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }

                statement {
                  byte_match_statement {
                    field_to_match {
                      uri_path {}
                    }
                    positional_constraint = "EXACTLY"
                    search_string         = "/profile"
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-body-xss-block"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "PerIpRateLimit"
    priority = 20
    action {
      block {}
    }

    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        limit                 = 2000
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-edge"
    sampled_requests_enabled   = true
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = local.common_tags
}

# Read the existing ALB without pulling app-resource changes into an edge recovery plan.
data "aws_lb" "edge_origin" {
  name = "sea-n-shore-staging-alb"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  canonical_site_host = "seanshore.in"
  canonical_site_url  = "https://${local.canonical_site_host}"
  edge_host           = "d3prih0q6jofyr.cloudfront.net"
  edge_site_url       = "https://${aws_cloudfront_distribution.app.domain_name}"

  # Browser origins the application accepts: the canonical domain first, then the AWS-managed
  # CloudFront hostname that keeps working during the domain move (Cognito callbacks, S3 CORS,
  # realtime authorizer, Server Actions all derive from this list).
  browser_site_urls = [local.canonical_site_url, local.edge_site_url]
}

variable "redirect_edge_host_to_canonical" {
  description = "Phase 4 switch: 301 the *.cloudfront.net hostname to https://seanshore.in for everything except /api/* (payment webhooks keep answering on the old host)."
  type        = bool
  default     = false
}

# Viewer-request function: www -> apex, and (once enabled) cloudfront.net -> apex except /api/*.
resource "aws_cloudfront_function" "canonical_host_redirect" {
  name    = "${local.name_prefix}-canonical-host-redirect"
  runtime = "cloudfront-js-2.0"
  comment = "www.seanshore.in -> seanshore.in; optional cloudfront.net -> seanshore.in except /api/*"
  publish = true

  code = templatefile("${path.module}/cloudfront/canonical-host-redirect.js.tftpl", {
    canonical_host     = local.canonical_site_host
    edge_host          = local.edge_host
    redirect_edge_host = var.redirect_edge_host_to_canonical
  })
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Sea N Shore staging HTTPS edge"
  web_acl_id      = aws_wafv2_web_acl.edge.arn
  aliases         = [local.canonical_site_host, "www.${local.canonical_site_host}"]

  origin {
    domain_name = data.aws_lb.edge_origin.dns_name
    origin_id   = "sea-n-shore-staging-alb"

    custom_header {
      name  = "X-Forwarded-Host"
      value = "d3prih0q6jofyr.cloudfront.net"
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "sea-n-shore-staging-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical_host_redirect.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.seanshore_edge.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = aws_acm_certificate.seanshore_edge.status == "ISSUED"
      error_message = "The seanshore.in edge certificate must be ISSUED before CloudFront can serve the custom domain."
    }
  }

  tags = local.common_tags
}
