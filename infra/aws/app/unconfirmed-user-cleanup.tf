# Round 14 (2.7): the outbox worker's daily sweep lists the user pool and removes sign-ups that
# never finished (unconfirmed email users and unverified mobile users older than 24 h).
resource "aws_iam_role_policy" "outbox_worker_cognito_cleanup" {
  name = "${local.name_prefix}-outbox-worker-cognito-cleanup"
  role = aws_iam_role.outbox_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RemoveAbandonedSignUps"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsers", "cognito-idp:AdminDeleteUser"]
        Resource = aws_cognito_user_pool.app.arn
      }
    ]
  })
}
