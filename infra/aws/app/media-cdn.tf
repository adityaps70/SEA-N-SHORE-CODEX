# Round P3 (B7, Part D): media delivery through the site's own CloudFront distribution.
#
# CloudFront serves `/m/*` from the media bucket through origin access control, and only to signed
# requests: the behaviour trusts one key group, and the web task signs a custom policy per photo or
# file folder with the matching private key (src/lib/media-cdn/signer.ts). The bucket stays private
# (public access block on) and the distribution may read only the `m/` prefix, where the app writes
# resized photos and the as-uploaded copies of videos and GIFs. Nothing is public.
#
# The key is ECDSA P-256 (shorter signatures than RSA, so every photo URL is about 300 characters
# shorter). Terraform generates it; the private half goes to Secrets Manager for the web task and
# never appears in a plan (sensitive) or a log.

locals {
  # The app distribution (edge.tf). Named here instead of referenced so that targeted plans of the
  # bucket policy never pull pending distribution changes in; media-cdn-infra.sh checks it against
  # the state.
  app_distribution_id  = "EF1K45UVP11XZ"
  app_distribution_arn = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${local.app_distribution_id}"
  media_cdn_origin_id  = "${local.name_prefix}-media"
}

resource "tls_private_key" "media_cdn" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "aws_secretsmanager_secret" "media_cdn_signing_key" {
  name                    = "${local.name_prefix}/media-cdn-signing-key"
  description             = "ECDSA P-256 private key the web task signs CloudFront media URLs with."
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "media_cdn_signing_key" {
  secret_id     = aws_secretsmanager_secret.media_cdn_signing_key.id
  secret_string = tls_private_key.media_cdn.private_key_pem_pkcs8
}

resource "aws_cloudfront_public_key" "media_cdn" {
  name        = "${local.name_prefix}-media-cdn"
  comment     = "Verifies signed media URLs (/m/*)."
  encoded_key = tls_private_key.media_cdn.public_key_pem
}

resource "aws_cloudfront_key_group" "media_cdn" {
  name    = "${local.name_prefix}-media-cdn"
  comment = "Signers for /m/* media."
  items   = [aws_cloudfront_public_key.media_cdn.id]
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${local.name_prefix}-media"
  description                       = "CloudFront reads the media bucket's m/ prefix (signed requests only)."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Objects under m/ are unique per stored upload and never rewritten, so they are kept for a year at
# the edge. The key is the path alone: the CloudFront signature parameters are checked before the
# cache and are never part of the key, so every signed URL of one object shares one cached copy.
resource "aws_cloudfront_cache_policy" "media_cdn" {
  name        = "${local.name_prefix}-media-cdn"
  comment     = "Media under /m/*: path only, one year (objects are immutable)."
  min_ttl     = 86400
  default_ttl = 31536000
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_iam_role_policy" "ecs_execution_media_cdn_signing_key" {
  name = "${local.name_prefix}-media-cdn-signing-key"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadMediaCdnSigningKey"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.media_cdn_signing_key.arn
      }
    ]
  })
}

output "media_cdn_key_pair_id" {
  description = "CloudFront public key id the web task names in signed media URLs (MEDIA_CDN_KEY_PAIR_ID)."
  value       = aws_cloudfront_public_key.media_cdn.id
}

output "media_cdn_signing_key_secret_arn" {
  description = "Secrets Manager ARN used by ECS to inject MEDIA_CDN_SIGNING_KEY."
  value       = aws_secretsmanager_secret.media_cdn_signing_key.arn
}
