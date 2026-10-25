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

# Round H (H1): operations monitoring. Alarms go to the same SNS topic, now also emailed to the
# operations inbox (that inbox must confirm the subscription once). Round P3: the owner moved it from
# operations@ to info@beaufortmarine.in.
variable "operations_alert_email" {
  description = "Operations inbox that receives the web alarms (the SNS subscription must be confirmed from that inbox)."
  type        = string
  default     = "info@beaufortmarine.in"
}

resource "aws_sns_topic_subscription" "alerts_operations_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.operations_alert_email
}

# App 5xx rate: responses the web tasks themselves answered with 5xx, as a share of all requests.
# Only judged when there were at least 50 requests in the 5 minutes.
resource "aws_cloudwatch_metric_alarm" "alb_target_5xx_rate" {
  alarm_name          = "${local.name_prefix}-alb-target-5xx-rate"
  alarm_description   = "More than 2% of requests answered 5xx by the web app in two 5-minute periods in a row."
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags

  metric_query {
    id          = "target_5xx_rate"
    expression  = "IF(FILL(requests, 0) >= 50, 100 * FILL(errors, 0) / requests, 0)"
    label       = "Target 5xx %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = local.alb_dimension }
      stat        = "Sum"
      period      = 300
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = { LoadBalancer = local.alb_dimension }
      stat        = "Sum"
      period      = 300
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "web_cpu_high" {
  alarm_name          = "${local.name_prefix}-web-cpu-high"
  alarm_description   = "Web service CPU (average) above 70% for 10 minutes."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = local.web_service_dimensions
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 70
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

# Server errors by area, from the app's own metric lines (src/instrumentation.ts, namespace
# SeaNShore/App). ALB metrics cannot tell the APIs apart.
locals {
  key_api_areas      = toset(["feed", "impressions", "messaging", "jobs", "learning", "payments-webhooks"])
  site_health_checks = toset(["home", "api-health"])
}

resource "aws_cloudwatch_metric_alarm" "api_server_errors" {
  for_each = local.key_api_areas

  alarm_name          = "${local.name_prefix}-api-${each.key}-server-errors"
  alarm_description   = "At least 5 server errors in ${each.key} in 5 minutes."
  namespace           = "SeaNShore/App"
  metric_name         = "ServerErrors"
  dimensions          = { Area = each.key }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

# Outside-in check from the outbox worker once a minute (src/features/ops/site-health-probe.ts).
# Only a failed check pages: missing data (the probe paused, for example while the outbox worker restarts) is
# not treated as down, so the alarm never fires while the site is up. A real outage still shows as SiteUp 0,
# and the ALB 5xx, 502/503/504 and running-tasks alarms cover the web service itself.
resource "aws_cloudwatch_metric_alarm" "site_health" {
  for_each = local.site_health_checks

  alarm_name          = "${local.name_prefix}-site-${each.key}-down"
  alarm_description   = "The ${each.key} check on the public site failed for 3 minutes in a row."
  namespace           = "SeaNShore/App"
  metric_name         = "SiteUp"
  dimensions          = { Check = each.key }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

# Round P3 (B6): scale on requests per task as well as CPU and memory, up to 8 tasks. A task holds
# about 525 requests a minute at 70% CPU (P3 capacity report), so tracking 400 adds tasks before
# CPU gets there. Target tracking waits for 3 one-minute datapoints, so a sudden burst also has
# one-minute step alarms that add tasks at once.
data "aws_lb_target_group" "web" {
  name = substr("${local.name_prefix}-web", 0, 32)
}

locals {
  web_target_group_dimension = data.aws_lb_target_group.web.arn_suffix
}

resource "aws_appautoscaling_policy" "requests" {
  name               = "${local.name_prefix}-requests"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 400
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${local.alb_dimension}/${local.web_target_group_dimension}"
    }
  }
}

resource "aws_appautoscaling_policy" "requests_burst" {
  name               = "${local.name_prefix}-requests-burst"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Average"

    # 600-900 requests per task in a minute: one more task; above 900: two more.
    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 300
      scaling_adjustment          = 1
    }

    step_adjustment {
      metric_interval_lower_bound = 300
      scaling_adjustment          = 2
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "web_requests_burst" {
  alarm_name          = "${local.name_prefix}-web-requests-burst"
  alarm_description   = "More than 600 requests per web task in one minute: add tasks now."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "RequestCountPerTarget"
  dimensions          = { TargetGroup = local.web_target_group_dimension }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 600
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.requests_burst.arn]
  tags                = local.common_tags
}

resource "aws_appautoscaling_policy" "cpu_burst" {
  name               = "${local.name_prefix}-cpu-burst"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "web_cpu_burst" {
  alarm_name          = "${local.name_prefix}-web-cpu-burst"
  alarm_description   = "Web service CPU (average) above 80% for 2 minutes: add a task now."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = local.web_service_dimensions
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.cpu_burst.arn]
  tags                = local.common_tags
}

# Round P3 (B8): slow pages and Lambda throttles page the owner.
resource "aws_cloudwatch_metric_alarm" "web_latency_p95" {
  alarm_name          = "${local.name_prefix}-web-latency-p95"
  alarm_description   = "p95 response time from the web tasks above 1 second in 3 of the last 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = local.alb_dimension }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

# Account-wide: realtime messaging and the Cognito sign-up and email triggers share the Lambda
# concurrency limit, so any throttle anywhere means a member-facing failure.
resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "${local.name_prefix}-lambda-throttles"
  alarm_description   = "At least one Lambda invocation throttled in 5 minutes (account-wide concurrency limit)."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.common_tags
}

# Round P3 (Part D): MediaConvert (course lesson and trailer videos) may cost at most about
# ₹1,000 a month: US$11.40 at ₹88 per dollar. Email at 80% forecast and at 100% actual.
resource "aws_budgets_budget" "mediaconvert" {
  name         = "${local.name_prefix}-mediaconvert-monthly"
  budget_type  = "COST"
  limit_amount = "11.40"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "Service"
    values = ["AWS Elemental MediaConvert"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email, var.operations_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email, var.operations_alert_email]
  }
}
