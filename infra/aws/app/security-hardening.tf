# Round 14, Phase 1: SMS abuse limits, SMS spend cap and alarms that reach the owner.

variable "allowed_phone_calling_codes" {
  description = "Comma-separated calling codes (digits after +) allowed for mobile sign-in codes."
  type        = string
  default     = "91"
}

variable "sms_monthly_spend_limit_usd" {
  description = "Account-level SNS SMS monthly spend limit in USD."
  type        = number
  default     = 20
}

# Counters for phone OTP limits (per number, per IP, global), expired by DynamoDB TTL. Shared by
# the Cognito create-challenge Lambda and the web task.
resource "aws_dynamodb_table" "otp_limits" {
  name         = "${local.name_prefix}-otp-limits"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.common_tags
}

resource "aws_iam_role_policy" "cognito_auth_challenge_otp_limits" {
  name = "${local.name_prefix}-cognito-auth-challenge-otp-limits"
  role = aws_iam_role.cognito_auth_challenge.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "CountOtpLimits"
      Effect   = "Allow"
      Action   = ["dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.otp_limits.arn
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_otp_limits" {
  name = "${local.name_prefix}-otp-limits-runtime"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "CountOtpPerIp"
      Effect   = "Allow"
      Action   = ["dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.otp_limits.arn
    }]
  })
}

resource "aws_sns_sms_preferences" "account" {
  monthly_spend_limit = var.sms_monthly_spend_limit_usd
  default_sms_type    = "Transactional"
}

resource "aws_cloudwatch_metric_alarm" "sms_spend_high" {
  alarm_name          = "${local.name_prefix}-sms-spend-high"
  alarm_description   = "SNS SMS month-to-date spend passed 75% of the monthly limit."
  namespace           = "AWS/SNS"
  metric_name         = "SMSMonthToDateSpentUSD"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.sms_monthly_spend_limit_usd * 0.75
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_log_metric_filter" "otp_global_cap" {
  name           = "${local.name_prefix}-otp-global-cap"
  log_group_name = aws_cloudwatch_log_group.cognito_create_auth_challenge.name
  pattern        = "\"otp_global_cap_reached\""

  metric_transformation {
    name          = "OtpGlobalCapReached"
    namespace     = "SeaNShore/Auth"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "otp_global_cap" {
  alarm_name          = "${local.name_prefix}-otp-global-cap-reached"
  alarm_description   = "Phone sign-in codes hit the global hourly cap (possible SMS pumping)."
  namespace           = "SeaNShore/Auth"
  metric_name         = "OtpGlobalCapReached"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "aurora_cpu_high" {
  alarm_name          = "${local.name_prefix}-aurora-cpu-high"
  alarm_description   = "Aurora CPU above 80% for 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBClusterIdentifier = "${local.name_prefix}-aurora" }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "aurora_capacity_at_max" {
  alarm_name          = "${local.name_prefix}-aurora-capacity-at-max"
  alarm_description   = "Aurora Serverless capacity pinned at its maximum ACU for 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "ServerlessDatabaseCapacity"
  dimensions          = { DBClusterIdentifier = "${local.name_prefix}-aurora" }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.aurora_max_acu
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "aurora_connections_high" {
  alarm_name          = "${local.name_prefix}-aurora-connections-high"
  alarm_description   = "More than 150 Aurora connections for 10 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBClusterIdentifier = "${local.name_prefix}-aurora" }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 150
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}
