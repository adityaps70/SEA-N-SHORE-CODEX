resource "aws_cognito_user_pool" "app" {
  name                     = "${local.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"
  deletion_protection      = "ACTIVE"

  lambda_config {
    define_auth_challenge          = aws_lambda_function.cognito_define_auth_challenge.arn
    create_auth_challenge          = aws_lambda_function.cognito_create_auth_challenge.arn
    verify_auth_challenge_response = aws_lambda_function.cognito_verify_auth_challenge.arn
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  email_configuration {
    email_sending_account  = var.enable_cognito_ses_email ? "DEVELOPER" : "COGNITO_DEFAULT"
    source_arn             = var.enable_cognito_ses_email ? aws_sesv2_email_identity.transactional_domain.arn : null
    from_email_address     = var.enable_cognito_ses_email ? "${var.ses_from_display_name} <${var.ses_from_address}>" : null
    reply_to_email_address = var.enable_cognito_ses_email ? var.ses_from_address : null
    configuration_set      = var.enable_cognito_ses_email ? aws_sesv2_configuration_set.transactional.configuration_set_name : null
  }

  depends_on = [
    aws_lambda_permission.cognito_define_auth_challenge,
    aws_lambda_permission.cognito_create_auth_challenge,
    aws_lambda_permission.cognito_verify_auth_challenge
  ]

  tags = local.common_tags
}

resource "aws_cognito_user_pool_domain" "app" {
  domain       = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.app.id
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.app.id

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_CUSTOM_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  supported_identity_providers         = var.enable_google_identity_provider ? ["COGNITO", "Google"] : ["COGNITO"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = ["${trimsuffix(var.site_url, "/")}/auth/google/callback"]
  logout_urls                          = [trimsuffix(var.site_url, "/")]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  depends_on = [aws_cognito_identity_provider.google]
}

resource "aws_secretsmanager_secret" "google_oauth" {
  name                    = "${local.name_prefix}/google-oauth"
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

data "aws_secretsmanager_secret_version" "google_oauth" {
  count     = var.enable_google_identity_provider ? 1 : 0
  secret_id = aws_secretsmanager_secret.google_oauth.id
}

locals {
  google_oauth_credentials = var.enable_google_identity_provider ? jsondecode(
    data.aws_secretsmanager_secret_version.google_oauth[0].secret_string
    ) : {
    client_id     = ""
    client_secret = ""
  }
}

resource "aws_cognito_identity_provider" "google" {
  count         = var.enable_google_identity_provider ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.app.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    authorize_scopes = "openid email profile"
    client_id        = local.google_oauth_credentials.client_id
    client_secret    = local.google_oauth_credentials.client_secret
  }

  attribute_mapping = {
    email = "email"
    name  = "name"
  }
}

data "archive_file" "cognito_define_auth_challenge" {
  type        = "zip"
  source_file = "${path.module}/lambda/cognito-define-auth-challenge.mjs"
  output_path = "${path.module}/.terraform/cognito-define-auth-challenge.zip"
}

data "archive_file" "cognito_create_auth_challenge" {
  type        = "zip"
  source_file = "${path.module}/lambda/cognito-create-auth-challenge.mjs"
  output_path = "${path.module}/.terraform/cognito-create-auth-challenge.zip"
}

data "archive_file" "cognito_verify_auth_challenge" {
  type        = "zip"
  source_file = "${path.module}/lambda/cognito-verify-auth-challenge.mjs"
  output_path = "${path.module}/.terraform/cognito-verify-auth-challenge.zip"
}

resource "aws_iam_role" "cognito_auth_challenge" {
  name = "${local.name_prefix}-cognito-auth-challenge"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "cognito_auth_challenge_logs" {
  role       = aws_iam_role.cognito_auth_challenge.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "cognito_auth_challenge_sms" {
  name = "${local.name_prefix}-cognito-auth-challenge-sms"
  role = aws_iam_role.cognito_auth_challenge.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "SendPhoneOtp"
      Effect   = "Allow"
      Action   = ["sns:Publish"]
      Resource = "*"
    }]
  })
}

resource "aws_cloudwatch_log_group" "cognito_define_auth_challenge" {
  name              = "/aws/lambda/${local.name_prefix}-cognito-define-auth-challenge"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "cognito_create_auth_challenge" {
  name              = "/aws/lambda/${local.name_prefix}-cognito-create-auth-challenge"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "cognito_verify_auth_challenge" {
  name              = "/aws/lambda/${local.name_prefix}-cognito-verify-auth-challenge"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_lambda_function" "cognito_define_auth_challenge" {
  function_name    = "${local.name_prefix}-cognito-define-auth-challenge"
  role             = aws_iam_role.cognito_auth_challenge.arn
  runtime          = "nodejs22.x"
  handler          = "cognito-define-auth-challenge.handler"
  filename         = data.archive_file.cognito_define_auth_challenge.output_path
  source_code_hash = data.archive_file.cognito_define_auth_challenge.output_base64sha256
  timeout          = 10
  memory_size      = 128

  depends_on = [
    aws_cloudwatch_log_group.cognito_define_auth_challenge,
    aws_iam_role_policy_attachment.cognito_auth_challenge_logs
  ]

  tags = local.common_tags
}

resource "aws_lambda_function" "cognito_create_auth_challenge" {
  function_name    = "${local.name_prefix}-cognito-create-auth-challenge"
  role             = aws_iam_role.cognito_auth_challenge.arn
  runtime          = "nodejs22.x"
  handler          = "cognito-create-auth-challenge.handler"
  filename         = data.archive_file.cognito_create_auth_challenge.output_path
  source_code_hash = data.archive_file.cognito_create_auth_challenge.output_base64sha256
  timeout          = 10
  memory_size      = 128

  depends_on = [
    aws_cloudwatch_log_group.cognito_create_auth_challenge,
    aws_iam_role_policy_attachment.cognito_auth_challenge_logs,
    aws_iam_role_policy.cognito_auth_challenge_sms
  ]

  tags = local.common_tags
}

resource "aws_lambda_function" "cognito_verify_auth_challenge" {
  function_name    = "${local.name_prefix}-cognito-verify-auth-challenge"
  role             = aws_iam_role.cognito_auth_challenge.arn
  runtime          = "nodejs22.x"
  handler          = "cognito-verify-auth-challenge.handler"
  filename         = data.archive_file.cognito_verify_auth_challenge.output_path
  source_code_hash = data.archive_file.cognito_verify_auth_challenge.output_base64sha256
  timeout          = 10
  memory_size      = 128

  depends_on = [
    aws_cloudwatch_log_group.cognito_verify_auth_challenge,
    aws_iam_role_policy_attachment.cognito_auth_challenge_logs
  ]

  tags = local.common_tags
}

resource "aws_lambda_permission" "cognito_define_auth_challenge" {
  statement_id   = "AllowCognitoDefineAuthChallenge"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.cognito_define_auth_challenge.function_name
  principal      = "cognito-idp.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"
}

resource "aws_lambda_permission" "cognito_create_auth_challenge" {
  statement_id   = "AllowCognitoCreateAuthChallenge"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.cognito_create_auth_challenge.function_name
  principal      = "cognito-idp.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"
}

resource "aws_lambda_permission" "cognito_verify_auth_challenge" {
  statement_id   = "AllowCognitoVerifyAuthChallenge"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.cognito_verify_auth_challenge.function_name
  principal      = "cognito-idp.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"
}

resource "aws_iam_role_policy" "ecs_task_cognito_admin" {
  name = "${local.name_prefix}-cognito-admin-runtime"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AdministerUserAccounts"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminEnableUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:ListUsers",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminUpdateUserAttributes"
        ]
        Resource = aws_cognito_user_pool.app.arn
      }
    ]
  })
}
