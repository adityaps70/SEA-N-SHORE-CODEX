resource "aws_cognito_user_pool" "app" {
  name                     = "${local.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  # Round 14 (2.11): optional authenticator-app (TOTP) MFA; the app requires it for platform
  # administrators. Software tokens only: no SMS MFA (so no sms_configuration), and no paid
  # Plus tier, threat protection or advanced security.
  mfa_configuration   = "OPTIONAL"
  deletion_protection = "ACTIVE"

  software_token_mfa_configuration {
    enabled = true
  }

  # Round 15: phone/SMS sign-in is retired, so the custom-auth (define/create/verify auth
  # challenge) triggers are gone; sign-in is email + password (SRP) or Google only.
  lambda_config {
    pre_sign_up = aws_lambda_function.cognito_pre_sign_up_link.arn
    # Account emails go through Resend (cognito-email-sender.tf); the key encrypts the codes.
    kms_key_id = var.enable_cognito_resend_email ? aws_kms_key.cognito_email_sender.arn : null

    dynamic "custom_email_sender" {
      for_each = var.enable_cognito_resend_email ? [1] : []
      content {
        lambda_arn     = aws_lambda_function.cognito_resend_email_sender.arn
        lambda_version = "V1_0"
      }
    }
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
    aws_lambda_permission.cognito_pre_sign_up_link,
    aws_lambda_permission.cognito_resend_email_sender
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

  # Round 14 (1.2): a write_attributes list without phone_number was rejected by Cognito
  # ("Invalid write attributes specified"), so the client's attributes stay as they were.
  # Round 15 leaves them unchanged too: phone_number_verified can never be client-writable, and
  # without a list Cognito has accepted, any change here risks the same rejection. With custom auth
  # gone, a phone number on an account no longer signs anybody in.

  # Round 15: ALLOW_CUSTOM_AUTH (phone/SMS sign-in codes) is retired.
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  supported_identity_providers         = var.enable_google_identity_provider ? ["COGNITO", "Google"] : ["COGNITO"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile", "aws.cognito.signin.user.admin"]
  # The canonical domain first, then the CloudFront hostname that keeps working during the move.
  callback_urls = [for origin in local.browser_site_urls : "${origin}/auth/google/callback"]
  logout_urls   = local.browser_site_urls

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
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    authorize_scopes              = "openid email profile"
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    client_id                     = local.google_oauth_credentials.client_id
    client_secret                 = local.google_oauth_credentials.client_secret
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    name           = "name"
    username       = "sub"
  }
}

data "archive_file" "cognito_pre_sign_up_link" {
  type        = "zip"
  source_file = "${path.module}/lambda/cognito-pre-sign-up-link.mjs"
  output_path = "${path.module}/.terraform/cognito-pre-sign-up-link.zip"
}

resource "aws_iam_role" "cognito_pre_sign_up_link" {
  name = "${local.name_prefix}-cognito-pre-sign-up-link"

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

resource "aws_iam_role_policy_attachment" "cognito_pre_sign_up_link_logs" {
  role       = aws_iam_role.cognito_pre_sign_up_link.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "cognito_pre_sign_up_link" {
  name = "${local.name_prefix}-cognito-pre-sign-up-link"
  role = aws_iam_role.cognito_pre_sign_up_link.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "LinkVerifiedGoogleIdentity"
      Effect = "Allow"
      Action = [
        "cognito-idp:ListUsers",
        "cognito-idp:AdminLinkProviderForUser"
      ]
      Resource = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/${var.aws_region}_*"
    }]
  })
}

resource "aws_cloudwatch_log_group" "cognito_pre_sign_up_link" {
  name              = "/aws/lambda/${local.name_prefix}-cognito-pre-sign-up-link"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_lambda_function" "cognito_pre_sign_up_link" {
  function_name    = "${local.name_prefix}-cognito-pre-sign-up-link"
  role             = aws_iam_role.cognito_pre_sign_up_link.arn
  runtime          = "nodejs22.x"
  handler          = "cognito-pre-sign-up-link.handler"
  filename         = data.archive_file.cognito_pre_sign_up_link.output_path
  source_code_hash = data.archive_file.cognito_pre_sign_up_link.output_base64sha256
  timeout          = 10
  memory_size      = 128

  depends_on = [
    aws_cloudwatch_log_group.cognito_pre_sign_up_link,
    aws_iam_role_policy_attachment.cognito_pre_sign_up_link_logs,
    aws_iam_role_policy.cognito_pre_sign_up_link
  ]

  tags = local.common_tags
}

resource "aws_lambda_permission" "cognito_pre_sign_up_link" {
  statement_id   = "AllowCognitoPreSignUpLink"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.cognito_pre_sign_up_link.function_name
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
          "cognito-idp:AdminUpdateUserAttributes",
          # Round H (H3): a 2FA backup code turns the member's authenticator app off (resetting 2FA).
          "cognito-idp:AdminSetUserMFAPreference"
        ]
        Resource = aws_cognito_user_pool.app.arn
      }
    ]
  })
}
