resource "aws_sesv2_configuration_set" "transactional" {
  configuration_set_name = "${local.name_prefix}-transactional"

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }

  reputation_options {
    reputation_metrics_enabled = true
  }
}

resource "aws_sesv2_email_identity" "transactional_domain" {
  email_identity         = var.ses_domain
  configuration_set_name = aws_sesv2_configuration_set.transactional.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = local.common_tags
}

data "aws_iam_policy_document" "cognito_ses_sender" {
  statement {
    sid       = "AuthorizeSeaNShoreCognito"
    effect    = "Allow"
    actions   = ["SES:SendEmail", "SES:SendRawEmail"]
    resources = [aws_sesv2_email_identity.transactional_domain.arn]

    principals {
      type        = "Service"
      identifiers = ["email.cognito-idp.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_cognito_user_pool.app.arn]
    }
  }
}

resource "aws_ses_identity_policy" "cognito_sender" {
  identity = aws_sesv2_email_identity.transactional_domain.arn
  name     = "${local.name_prefix}-cognito-sender"
  policy   = data.aws_iam_policy_document.cognito_ses_sender.json
}
