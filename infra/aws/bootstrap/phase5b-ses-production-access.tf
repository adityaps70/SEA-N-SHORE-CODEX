resource "aws_iam_role_policy" "github_deploy_phase5b_ses_production_access" {
  name = "${local.name_prefix}-phase5b-ses-production-access"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Phase5bSesProductionAccess"
        Effect   = "Allow"
        Action   = ["ses:PutAccountDetails"]
        Resource = "*"
      }
    ]
  })
}
