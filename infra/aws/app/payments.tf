# Payments (Cashfree): the web task reads its Cashfree keys at runtime from one
# Secrets Manager secret named "sea-n-shore/staging/cashfree" (created by the site
# owner, not by Terraform, so the keys never enter Terraform state). The trailing
# wildcard matches the random suffix Secrets Manager adds to the secret ARN.
# Released with .github/workflows/aws-ecs-task-cashfree-secret-policy.yml.

locals {
  cashfree_secret_arn_pattern = "arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore/staging/cashfree*"
}

resource "aws_iam_role_policy" "ecs_task_cashfree_secret" {
  name = "${local.name_prefix}-cashfree-secret-runtime"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadCashfreePaymentKeys"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.cashfree_secret_arn_pattern
      }
    ]
  })
}
