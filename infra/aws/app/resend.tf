# Resend API key runtime access. The secret itself is created by the site owner
# outside Terraform as "sea-n-shore/resend", so its value never enters state.
# The web task needs it for immediate newsletter confirmations/admin readiness;
# the outbox worker needs it for confirmation retries and campaign batches.

locals {
  resend_secret_arn_pattern = "arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore/resend*"
}

resource "aws_iam_role_policy" "ecs_task_resend_secret" {
  name = "${local.name_prefix}-resend-secret-runtime"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadResendApiKey"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.resend_secret_arn_pattern
      }
    ]
  })
}

resource "aws_iam_role_policy" "outbox_worker_resend_secret" {
  name = "${local.name_prefix}-resend-secret-runtime"
  role = aws_iam_role.outbox_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadResendApiKey"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.resend_secret_arn_pattern
      }
    ]
  })
}
