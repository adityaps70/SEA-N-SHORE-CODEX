# Round 15: shared token for the deep health check (/api/health/home). The web task gets it as
# HEALTH_CHECK_TOKEN; the verify workflows read it with the GitHub deploy role and send it in the
# x-health-check-token header. Everyone else gets 404 from the route. Its own random value, so it
# never shares a key with the newsletter or realtime secrets; the value is generated here and is
# never printed by any runner.
resource "random_password" "health_check_token" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "health_check_token" {
  name                    = "${local.name_prefix}/health-check-token"
  description             = "Token the verify workflows send to the Sea N Shore deep health check (x-health-check-token)."
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "health_check_token" {
  secret_id     = aws_secretsmanager_secret.health_check_token.id
  secret_string = random_password.health_check_token.result
}

# ECS injects the secret at task start, so only the execution role reads it, and only this secret.
resource "aws_iam_role_policy" "ecs_execution_health_check_token_secret" {
  name = "${local.name_prefix}-health-check-token-secret"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadHealthCheckTokenSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.health_check_token.arn
      }
    ]
  })
}

output "health_check_token_secret_arn" {
  description = "Secrets Manager ARN used by ECS to inject HEALTH_CHECK_TOKEN into the web container."
  value       = aws_secretsmanager_secret.health_check_token.arn
}
