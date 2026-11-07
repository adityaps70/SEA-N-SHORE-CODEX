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

        # Round P3 (B7): signed media (/m/*) is not counted. Each photo is one request, and many
        # people share one ship or office address; CloudFront refuses any /m/ request without a
        # valid signature before it reaches the bucket.
        # ARCH decision 6 (ship IPs): signed-in requests (with the session cookie) are not counted
        # here either, so one busy ship cannot block itself; PerSessionRateLimit limits each session
        # and PerIpCeiling stays as the hard limit per address.
        scope_down_statement {
          and_statement {
            statement {
              not_statement {
                statement {
                  byte_match_statement {
                    field_to_match {
                      uri_path {}
                    }
                    positional_constraint = "STARTS_WITH"
                    search_string         = "/m/"
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
            statement {
              not_statement {
                statement {
                  size_constraint_statement {
                    comparison_operator = "GT"
                    size                = 0
                    field_to_match {
                      cookies {
                        match_pattern {
                          included_cookies = ["sns_cognito_refresh"]
                        }
                        match_scope       = "VALUE"
                        oversize_handling = "MATCH"
                      }
                    }
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
      metric_name                = "${local.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # ARCH decision 6: signed-in traffic is limited per session (the refresh-token cookie), not per
  # address, at 1,000 requests per 5 minutes. A request without that cookie is not counted here.
  rule {
    name     = "PerSessionRateLimit"
    priority = 21
    action {
      block {}
    }

    statement {
      rate_based_statement {
        aggregate_key_type    = "CUSTOM_KEYS"
        evaluation_window_sec = 300
        limit                 = 1000

        custom_key {
          cookie {
            name = "sns_cognito_refresh"
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }

        scope_down_statement {
          not_statement {
            statement {
              byte_match_statement {
                field_to_match {
                  uri_path {}
                }
                positional_constraint = "STARTS_WITH"
                search_string         = "/m/"
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

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-session-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # ARCH decision 6: a hard ceiling per address for all traffic (signed-in or not), 10x the
  # signed-out limit, so a whole ship of signed-in people fits under it.
  rule {
    name     = "PerIpCeiling"
    priority = 22
    action {
      block {}
    }

    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        limit                 = 20000

        scope_down_statement {
          not_statement {
            statement {
              byte_match_statement {
                field_to_match {
                  uri_path {}
                }
                positional_constraint = "STARTS_WITH"
                search_string         = "/m/"
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

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-ip-ceiling"
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

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# Round 14 (3.1): hashed build assets and public brand images are cached at the edge, keyed on the
# path only. (Round P3: pages moved from CachingDisabled to public_pages below; the legacy redirect
# distribution still uses CachingDisabled.)
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# Optimized images (/_next/image): keyed on the image URL, width and quality plus Accept (the
# format the browser takes), never on cookies. The origin's Cache-Control decides how long.
resource "aws_cloudfront_cache_policy" "next_image" {
  name        = "${local.name_prefix}-next-image"
  comment     = "Next.js optimized images: url, w, q and Accept; no cookies."
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Accept"]
      }
    }

    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["url", "w", "q"]
      }
    }
  }
}

# Round P3 (B4): the default behavior (pages and API) stores only what the origin marks public:
# default TTL 0 honours Next's `private, no-store` on every dynamic response, and the app marks just
# signed-out loads of a few public pages (src/lib/http/public-page-cache.ts) for a minute plus
# stale-while-revalidate. Nothing stays longer than 5 minutes. The key holds the two session
# cookies, so a signed-in request never shares a signed-out copy, the RSC/router headers, so an
# RSC request never gets cached HTML, and the whole query string. Everything is still forwarded to
# the origin by the AllViewerExceptHostHeader origin request policy.
resource "aws_cloudfront_cache_policy" "public_pages" {
  name        = "${local.name_prefix}-public-pages"
  comment     = "Pages: only origin-marked public responses; keyed on session cookies, RSC headers, query."
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "whitelist"
      cookies {
        items = ["sns_cognito_access", "sns_cognito_refresh"]
      }
    }

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch"]
      }
    }

    query_strings_config {
      query_string_behavior = "all"
    }
  }
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
  default     = true
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

  # Round 14 (1.4): HTTPS to the ALB's dedicated origin hostname with the shared X-Origin-Verify
  # secret; the ALB answers 403 to anything without it.
  origin {
    domain_name = var.origin_tls_hostname
    origin_id   = "sea-n-shore-staging-alb"

    custom_header {
      name  = "X-Forwarded-Host"
      value = "d3prih0q6jofyr.cloudfront.net"
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Round P3 (B7): the private media bucket, read through origin access control (media-cdn.tf).
  origin {
    domain_name              = aws_s3_bucket.app["media"].bucket_regional_domain_name
    origin_id                = local.media_cdn_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id         = "sea-n-shore-staging-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.public_pages.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical_host_redirect.arn
    }
  }

  # Round P3 (B7): signed media only. Every request must carry a signature from the media key group;
  # there is no viewer function (the redirect function must not rewrite a signed URL).
  ordered_cache_behavior {
    path_pattern           = "/m/*"
    target_origin_id       = local.media_cdn_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    cache_policy_id        = aws_cloudfront_cache_policy.media_cdn.id
    trusted_key_groups     = [aws_cloudfront_key_group.media_cdn.id]
  }
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "sea-n-shore-staging-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical_host_redirect.arn
    }
  }
  ordered_cache_behavior {
    path_pattern           = "/_next/image*"
    target_origin_id       = "sea-n-shore-staging-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.next_image.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical_host_redirect.arn
    }
  }
  ordered_cache_behavior {
    path_pattern           = "/brand/*"
    target_origin_id       = "sea-n-shore-staging-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical_host_redirect.arn
    }
  }
  ordered_cache_behavior {
    path_pattern           = "/landing/*"
    target_origin_id       = "sea-n-shore-staging-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical_host_redirect.arn
    }
  }
  ordered_cache_behavior {
    path_pattern           = "/favicon.ico"
    target_origin_id       = "sea-n-shore-staging-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

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
