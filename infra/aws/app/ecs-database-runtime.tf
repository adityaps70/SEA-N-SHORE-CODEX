locals {
  aurora_master_secret_arn = aws_rds_cluster.aurora.master_user_secret[0].secret_arn
}

resource "aws_iam_role_policy" "ecs_execution_aurora_secret" {
  name = "${local.name_prefix}-aurora-secret"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadAuroraManagedMasterSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.aurora_master_secret_arn
      }
    ]
  })
}
