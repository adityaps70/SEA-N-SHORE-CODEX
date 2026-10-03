# Newsletter link signing secret. This is a separate HMAC key from the Resend
# API key and realtime ticket key, so compromise or rotation of one subsystem
# does not invalidate the others.
resource "random_password" "newsletter_token" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "newsletter_token" {
  name                    = "${local.name_prefix}/newsletter-token-signing"
  description             = "HMAC signing secret for Sea N Shore newsletter confirmation and unsubscribe links."
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "newsletter_token" {
  secret_id     = aws_secretsmanager_secret.newsletter_token.id
  secret_string = random_password.newsletter_token.result
}

resource "aws_iam_role_policy" "ecs_execution_newsletter_token_secret" {
  name = "${local.name_prefix}-newsletter-token-secret"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadNewsletterTokenSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.newsletter_token.arn
      }
    ]
  })
}

output "newsletter_token_secret_arn" {
  description = "Secrets Manager ARN used by ECS to inject NEWSLETTER_TOKEN_SECRET."
  value       = aws_secretsmanager_secret.newsletter_token.arn
}
