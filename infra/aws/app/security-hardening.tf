# Round 14, Phase 1: alarms that reach the owner.

# Round 15: phone/SMS sign-in is retired. The OTP limits table, its IAM policies, the SMS spend and
# OTP global-cap alarms are destroyed by scripts/aws/sms-retirement-infra.sh. The account-level SMS
# preferences are only dropped from Terraform state: the USD 1 monthly SMS spend limit stays on the
# account as a backstop, and nothing in the stack can send SMS any more.
removed {
  from = aws_sns_sms_preferences.account

  lifecycle {
    destroy = false
  }
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
