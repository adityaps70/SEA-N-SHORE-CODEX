# Round 14 (2.12): database least privilege. The web task and the workers move from the master
# secret to sea_n_shore_app (DML only; created by migration 0066), with its own secret rotated every
# 30 days by a small Lambda that uses the RDS Data API and the master secret (no VPC networking).
# Migrations keep using the master secret. The deploy switches credentials only when
# scripts/aws/aurora-app-credentials.txt says "app".
locals {
  aurora_app_role = "sea_n_shore_app"
}

resource "random_password" "aurora_app_initial" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "aurora_app" {
  name        = "${local.name_prefix}/aurora-app"
  description = "Credentials for the least-privilege Sea N Shore app database role (rotated)."
  tags        = local.common_tags
}

# Rotation replaces this placeholder password (and sets it on the role) as soon as rotation is enabled.
resource "aws_secretsmanager_secret_version" "aurora_app_initial" {
  secret_id = aws_secretsmanager_secret.aurora_app.id
  secret_string = jsonencode({
    engine   = "postgres"
    host     = aws_rds_cluster.aurora.endpoint
    port     = 5432
    dbname   = aws_rds_cluster.aurora.database_name
    username = local.aurora_app_role
    password = random_password.aurora_app_initial.result
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

data "archive_file" "aurora_app_secret_rotation" {
  type        = "zip"
  source_file = "${path.module}/lambda/aurora-app-secret-rotation.mjs"
  output_path = "${path.module}/.terraform/aurora-app-secret-rotation.zip"
}

resource "aws_iam_role" "aurora_app_secret_rotation" {
  name = "${local.name_prefix}-aurora-app-secret-rotation"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "aurora_app_secret_rotation_logs" {
  role       = aws_iam_role.aurora_app_secret_rotation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "aurora_app_secret_rotation" {
  name = "${local.name_prefix}-aurora-app-secret-rotation"
  role = aws_iam_role.aurora_app_secret_rotation.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RotateAppSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue", "secretsmanager:UpdateSecretVersionStage"]
        Resource = aws_secretsmanager_secret.aurora_app.arn
      },
      {
        Sid      = "GeneratePasswords"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetRandomPassword"]
        Resource = "*"
      },
      {
        Sid      = "SetRolePasswordThroughDataApi"
        Effect   = "Allow"
        Action   = ["rds-data:ExecuteStatement"]
        Resource = aws_rds_cluster.aurora.arn
      },
      {
        Sid      = "UseMasterSecretForDataApi"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.aurora_master_secret_arn
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "aurora_app_secret_rotation" {
  name              = "/aws/lambda/${local.name_prefix}-aurora-app-secret-rotation"
  retention_in_days = 90
  tags              = local.common_tags
}

resource "aws_lambda_function" "aurora_app_secret_rotation" {
  function_name    = "${local.name_prefix}-aurora-app-secret-rotation"
  role             = aws_iam_role.aurora_app_secret_rotation.arn
  runtime          = "nodejs22.x"
  handler          = "aurora-app-secret-rotation.handler"
  filename         = data.archive_file.aurora_app_secret_rotation.output_path
  source_code_hash = data.archive_file.aurora_app_secret_rotation.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      AURORA_MASTER_SECRET_ARN = local.aurora_master_secret_arn
      AURORA_CLUSTER_ARN       = aws_rds_cluster.aurora.arn
      AURORA_DATABASE          = aws_rds_cluster.aurora.database_name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.aurora_app_secret_rotation,
    aws_iam_role_policy.aurora_app_secret_rotation,
    aws_iam_role_policy_attachment.aurora_app_secret_rotation_logs
  ]
  tags = local.common_tags
}

resource "aws_lambda_permission" "aurora_app_secret_rotation" {
  statement_id  = "AllowSecretsManagerRotation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.aurora_app_secret_rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.aurora_app.arn
}

resource "aws_secretsmanager_secret_rotation" "aurora_app" {
  secret_id           = aws_secretsmanager_secret.aurora_app.id
  rotation_lambda_arn = aws_lambda_function.aurora_app_secret_rotation.arn

  rotation_rules {
    automatically_after_days = 30
  }

  depends_on = [aws_lambda_permission.aurora_app_secret_rotation, aws_secretsmanager_secret_version.aurora_app_initial]
}

# ECS pulls the credentials at task start (execution role); the web task and the workers reload the
# secret after a rotation (task roles).
resource "aws_iam_role_policy" "aurora_app_secret_read" {
  for_each = {
    execution           = aws_iam_role.ecs_execution.id
    web                 = aws_iam_role.ecs_task.id
    outbox_worker       = aws_iam_role.outbox_worker.id
    notification_worker = aws_iam_role.notification_worker.id
  }

  name = "${local.name_prefix}-aurora-app-secret-read"
  role = each.value
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadAppDatabaseSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.aurora_app.arn
      }
    ]
  })
}

output "aurora_app_secret_arn" {
  description = "Set as AURORA_APP_SECRET_ARN in the staging deploy at cutover."
  value       = aws_secretsmanager_secret.aurora_app.arn
}
