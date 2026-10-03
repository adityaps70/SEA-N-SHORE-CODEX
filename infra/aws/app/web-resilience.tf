# Round 13: the single web task was OOM-killed roughly hourly (502 bursts). Besides the image
# optimizer fix in the app, keep at least two tasks, scale on memory as well as CPU, and alert the
# owner before memory, task count or 5xx problems become an outage.

variable "alert_email" {
  description = "Address that receives web alarms and OOM notices (the SNS subscription must be confirmed from that inbox)."
  type        = string
  default     = "hunupunu@gmail.com"
}

resource "aws_appautoscaling_policy" "memory" {
  name               = "${local.name_prefix}-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdministration"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = ["sns:Publish", "sns:Subscribe", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:ListSubscriptionsByTopic"]
        Resource  = aws_sns_topic.alerts.arn
      },
      {
        Sid       = "CloudWatchAlarmsPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      },
      {
        Sid       = "EventBridgePublish"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      }
    ]
  })
}

# Names and the ALB data source instead of resource references, so a targeted plan of these
# alarms never drags in the ECS service, its task definition or the load balancer itself.
data "aws_lb" "web" {
  name = substr("${local.name_prefix}-alb", 0, 32)
}

locals {
  web_service_dimensions = {
    ClusterName = local.name_prefix
    ServiceName = "${local.name_prefix}-web"
  }
  alb_dimension   = data.aws_lb.web.arn_suffix
  ecs_cluster_arn = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/${local.name_prefix}"
}

resource "aws_cloudwatch_metric_alarm" "web_memory_high" {
  alarm_name          = "${local.name_prefix}-web-memory-high"
  alarm_description   = "Web task memory (max) above 80% for 15 minutes."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = local.web_service_dimensions
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "web_running_tasks_low" {
  alarm_name          = "${local.name_prefix}-web-running-tasks-low"
  alarm_description   = "Fewer than 2 web tasks running for 5 minutes."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = local.web_service_dimensions
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 2
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_gateway_errors" {
  alarm_name          = "${local.name_prefix}-alb-502-503-504"
  alarm_description   = "At least 5 ALB 502/503/504 responses in 5 minutes."
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags

  metric_query {
    id          = "gateway_errors"
    expression  = "FILL(e502, 0) + FILL(e503, 0) + FILL(e504, 0)"
    label       = "ALB 502 + 503 + 504"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = {
      e502 = "HTTPCode_ELB_502_Count"
      e503 = "HTTPCode_ELB_503_Count"
      e504 = "HTTPCode_ELB_504_Count"
    }
    content {
      id = metric_query.key
      metric {
        namespace   = "AWS/ApplicationELB"
        metric_name = metric_query.value
        dimensions  = { LoadBalancer = local.alb_dimension }
        stat        = "Sum"
        period      = 300
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_target_connection_errors" {
  alarm_name          = "${local.name_prefix}-alb-target-connection-errors"
  alarm_description   = "The ALB could not connect to a web task (task dying or gone) in the last 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetConnectionErrorCount"
  dimensions          = { LoadBalancer = local.alb_dimension }
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

resource "aws_cloudwatch_metric_alarm" "web_ephemeral_storage_high" {
  alarm_name          = "${local.name_prefix}-web-ephemeral-storage-high"
  alarm_description   = "Web task ephemeral storage above 80% (image cache growth) for 15 minutes."
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags

  metric_query {
    id          = "ephemeral_percent"
    expression  = "100 * used / reserved"
    label       = "Ephemeral storage used %"
    return_data = true
  }

  metric_query {
    id = "used"
    metric {
      namespace   = "ECS/ContainerInsights"
      metric_name = "EphemeralStorageUtilized"
      dimensions  = local.web_service_dimensions
      stat        = "Maximum"
      period      = 300
    }
  }

  metric_query {
    id = "reserved"
    metric {
      namespace   = "ECS/ContainerInsights"
      metric_name = "EphemeralStorageReserved"
      dimensions  = local.web_service_dimensions
      stat        = "Maximum"
      period      = 300
    }
  }
}

resource "aws_cloudwatch_event_rule" "ecs_out_of_memory" {
  name        = "${local.name_prefix}-ecs-out-of-memory"
  description = "An ECS task in this cluster stopped because a container ran out of memory."

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [local.ecs_cluster_arn]
      lastStatus = ["STOPPED"]
      containers = {
        reason = [{ prefix = "OutOfMemoryError" }]
      }
    }
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "ecs_out_of_memory" {
  rule      = aws_cloudwatch_event_rule.ecs_out_of_memory.name
  target_id = "alerts"
  arn       = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      group   = "$.detail.group"
      stopped = "$.detail.stoppedAt"
      reason  = "$.detail.stoppedReason"
    }
    input_template = "\"Sea N Shore: an ECS task in <group> was stopped for running out of memory at <stopped> (<reason>).\""
  }
}
