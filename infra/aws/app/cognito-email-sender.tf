# Cognito account emails (sign-up codes, resend code, forgot password, email change) go
# through Resend instead of Cognito's built-in sender, which caps the pool at about 50 emails
# a day. Cognito encrypts each code with the KMS key below and invokes the custom email sender
# Lambda, which decrypts it and sends a branded email from the Resend-verified
# mail.seanshore.in sender using the existing owner-managed "sea-n-shore/resend" secret.
# Rollback: set enable_cognito_resend_email = false and apply; Cognito returns to its default
# sender while the key and function stay in place.

variable "enable_cognito_resend_email" {
  description = "Send Cognito account emails through the Resend custom email sender Lambda."
  type        = bool
  default     = true
}

variable "cognito_email_from_address" {
  description = "Resend-verified FROM address for Cognito account emails."
  type        = string
  default     = "Sea N Shore <accounts@mail.seanshore.in>"
}

resource "aws_kms_key" "cognito_email_sender" {
  description             = "Encrypts Cognito account-email codes for the Resend custom email sender"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableAccountAdministration"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowCognitoToEncryptAccountEmailCodes"
        Effect    = "Allow"
        Principal = { Service = "cognito-idp.amazonaws.com" }
        Action = [
          "kms:CreateGrant",
          "kms:Encrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_kms_alias" "cognito_email_sender" {
  name          = "alias/${local.name_prefix}-cognito-email-sender"
  target_key_id = aws_kms_key.cognito_email_sender.key_id
}

data "archive_file" "cognito_resend_email_sender" {
  type        = "zip"
  source_file = "${path.module}/lambda/cognito-resend-email-sender.mjs"
  output_path = "${path.module}/.terraform/cognito-resend-email-sender.zip"
}

resource "aws_iam_role" "cognito_resend_email_sender" {
  name = "${local.name_prefix}-cognito-resend-email-sender"

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

resource "aws_iam_role_policy_attachment" "cognito_resend_email_sender_logs" {
  role       = aws_iam_role.cognito_resend_email_sender.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "cognito_resend_email_sender" {
  name = "${local.name_prefix}-cognito-resend-email-sender"
  role = aws_iam_role.cognito_resend_email_sender.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DecryptCognitoAccountEmailCodes"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.cognito_email_sender.arn
      },
      {
        Sid      = "ReadResendApiKey"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.resend_secret_arn_pattern
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "cognito_resend_email_sender" {
  name              = "/aws/lambda/${local.name_prefix}-cognito-resend-email-sender"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_lambda_function" "cognito_resend_email_sender" {
  function_name    = "${local.name_prefix}-cognito-resend-email-sender"
  role             = aws_iam_role.cognito_resend_email_sender.arn
  runtime          = "nodejs22.x"
  handler          = "cognito-resend-email-sender.handler"
  filename         = data.archive_file.cognito_resend_email_sender.output_path
  source_code_hash = data.archive_file.cognito_resend_email_sender.output_base64sha256
  timeout          = 20
  memory_size      = 256

  environment {
    variables = {
      COGNITO_EMAIL_KMS_KEY_ARN = aws_kms_key.cognito_email_sender.arn
      RESEND_SECRET_ID          = "sea-n-shore/resend"
      EMAIL_FROM                = var.cognito_email_from_address
      SITE_URL                  = var.site_url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.cognito_resend_email_sender,
    aws_iam_role_policy_attachment.cognito_resend_email_sender_logs,
    aws_iam_role_policy.cognito_resend_email_sender
  ]

  tags = local.common_tags
}

resource "aws_lambda_permission" "cognito_resend_email_sender" {
  statement_id   = "AllowCognitoCustomEmailSender"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.cognito_resend_email_sender.function_name
  principal      = "cognito-idp.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"
}
