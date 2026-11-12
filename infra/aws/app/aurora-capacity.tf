# Round DB (owner-approved 12 Nov): Aurora Serverless v2 may scale to 4 ACU (var.aurora_max_acu, floor unchanged at
# 0.5). Capacity above 2 ACU is paid per use, so an hourly check emails the alerts topic (the owner's address and the
# operations inbox) once this month's capacity above 2 ACU passes the approved allowance: 39 ACU-hours, about ₹700 at
# ₹17.8 per ACU-hour incl. GST (our own bill: $0.1715 per ACU-hour at ₹88 to the dollar, plus 18% GST).
#
# The check reads only the cluster's ServerlessDatabaseCapacity metric. Its own cost: about 1,460 GetMetricData
# metric reads a month (about ₹1.3) and the error alarm below (about ₹8.8), Lambda and EventBridge inside the free
# tier: about ₹12 a month with GST. Applied by scripts/aws/aurora-capacity-infra.sh.

locals {
  aurora_extra_acu_check_name = "${local.name_prefix}-aurora-extra-acu-check"
}

data "archive_file" "aurora_extra_acu_check" {
  type        = "zip"
  source_file = "${path.module}/lambda/aurora-extra-acu-check.mjs"
  output_path = "${path.module}/.terraform/aurora-extra-acu-check.zip"
}

resource "aws_iam_role" "aurora_extra_acu_check" {
  name = local.aurora_extra_acu_check_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "aurora_extra_acu_check" {
  name = local.aurora_extra_acu_check_name
  role = aws_iam_role.aurora_extra_acu_check.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # GetMetricData has no resource-level permissions.
        Sid      = "ReadCapacityMetric"
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricData"]
        Resource = "*"
      },
      {
        Sid      = "EmailTheAlertsTopic"
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.alerts.arn
      },
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        # Built from the name (not the log group's ARN) so the policy is known when the plan is checked.
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.aurora_extra_acu_check_name}:*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "aurora_extra_acu_check" {
  name              = "/aws/lambda/${local.aurora_extra_acu_check_name}"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_lambda_function" "aurora_extra_acu_check" {
  function_name    = local.aurora_extra_acu_check_name
  role             = aws_iam_role.aurora_extra_acu_check.arn
  runtime          = "nodejs22.x"
  handler          = "aurora-extra-acu-check.handler"
  filename         = data.archive_file.aurora_extra_acu_check.output_path
  source_code_hash = data.archive_file.aurora_extra_acu_check.output_base64sha256
  timeout          = 60
  memory_size      = 128

  # One hourly run; never more than one at a time.
  reserved_concurrent_executions = 1

  environment {
    variables = {
      AURORA_CLUSTER_ID   = "${local.name_prefix}-aurora"
      ALERT_TOPIC_ARN     = aws_sns_topic.alerts.arn
      BASE_ACU            = "2"
      ALLOWANCE_ACU_HOURS = tostring(var.aurora_extra_acu_allowance_hours)
      RUPEES_PER_ACU_HOUR = "17.8"
    }
  }

  depends_on = [aws_cloudwatch_log_group.aurora_extra_acu_check, aws_iam_role_policy.aurora_extra_acu_check]
  tags       = local.common_tags
}

# Fifteen minutes past each hour, when the last full hour's one-minute capacity data is in.
resource "aws_cloudwatch_event_rule" "aurora_extra_acu_check" {
  name                = local.aurora_extra_acu_check_name
  description         = "Hourly: email once this month's Aurora capacity above 2 ACU passes the approved allowance."
  schedule_expression = "cron(15 * * * ? *)"
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "aurora_extra_acu_check" {
  rule = aws_cloudwatch_event_rule.aurora_extra_acu_check.name
  arn  = aws_lambda_function.aurora_extra_acu_check.arn
}

resource "aws_lambda_permission" "aurora_extra_acu_check" {
  statement_id   = "AllowHourlySchedule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.aurora_extra_acu_check.function_name
  principal      = "events.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = aws_cloudwatch_event_rule.aurora_extra_acu_check.arn
}

# A check that fails must not go quiet: an error in any hour emails the alerts topic.
resource "aws_cloudwatch_metric_alarm" "aurora_extra_acu_check_errors" {
  alarm_name          = "${local.aurora_extra_acu_check_name}-errors"
  alarm_description   = "The hourly Aurora extra-capacity cost check failed; the ₹700 email may not come."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = local.aurora_extra_acu_check_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}
