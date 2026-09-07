variable "social_worker_desired_count" {
  description = "Desired count for each social event worker service."
  type        = number
  default     = 1
}

resource "aws_cloudwatch_event_bus" "social" {
  name = "${local.name_prefix}-social-events"
  tags = local.common_tags
}

resource "aws_sqs_queue" "notification_dlq" {
  name                      = "${local.name_prefix}-notification-events-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = local.common_tags
}

resource "aws_sqs_queue" "notification_events" {
  name                       = "${local.name_prefix}-notification-events"
  visibility_timeout_seconds = 90
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notification_dlq.arn
    maxReceiveCount     = 5
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_rule" "notification_events" {
  name           = "${local.name_prefix}-notification-events"
  event_bus_name = aws_cloudwatch_event_bus.social.name

  event_pattern = jsonencode({
    source      = ["sea-n-shore.social"]
    detail-type = ["user.followed", "connection.requested", "connection.accepted"]
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "notification_queue" {
  rule           = aws_cloudwatch_event_rule.notification_events.name
  event_bus_name = aws_cloudwatch_event_bus.social.name
  arn            = aws_sqs_queue.notification_events.arn
}

resource "aws_sqs_queue_policy" "notification_events" {
  queue_url = aws_sqs_queue.notification_events.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEventBridgeDelivery"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.notification_events.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_cloudwatch_event_rule.notification_events.arn
          }
        }
      }
    ]
  })
}

locals {
  social_worker_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  social_worker_database_environment = [
    { name = "AURORA_HOST", value = aws_rds_cluster.aurora.endpoint },
    { name = "AURORA_PORT", value = tostring(aws_rds_cluster.aurora.port) },
    { name = "AURORA_DATABASE", value = aws_rds_cluster.aurora.database_name },
    { name = "AURORA_SSL", value = "true" },
    { name = "NODE_ENV", value = "production" }
  ]

  social_worker_database_secrets = [
    {
      name      = "AURORA_USER"
      valueFrom = "${local.aurora_master_secret_arn}:username::"
    },
    {
      name      = "AURORA_PASSWORD"
      valueFrom = "${local.aurora_master_secret_arn}:password::"
    }
  ]
}

resource "aws_iam_role" "outbox_worker" {
  name               = "${local.name_prefix}-outbox-worker"
  assume_role_policy = local.social_worker_assume_role_policy
  tags               = local.common_tags
}

resource "aws_iam_role_policy" "outbox_worker" {
  name = "${local.name_prefix}-outbox-worker"
  role = aws_iam_role.outbox_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishSocialEvents"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.social.arn
      }
    ]
  })
}

resource "aws_iam_role" "notification_worker" {
  name               = "${local.name_prefix}-notification-worker"
  assume_role_policy = local.social_worker_assume_role_policy
  tags               = local.common_tags
}

resource "aws_iam_role_policy" "notification_worker" {
  name = "${local.name_prefix}-notification-worker"
  role = aws_iam_role.notification_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConsumeNotificationQueue"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.notification_events.arn
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "outbox_worker" {
  name              = "/ecs/${local.name_prefix}/outbox-worker"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "notification_worker" {
  name              = "/ecs/${local.name_prefix}/notification-worker"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_ecs_task_definition" "outbox_worker" {
  family                   = "${local.name_prefix}-outbox-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.outbox_worker.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "outbox-worker"
      image     = "${data.aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true
      command   = ["npm", "run", "worker:outbox"]
      environment = concat(local.social_worker_database_environment, [
        { name = "SOCIAL_EVENT_BUS_NAME", value = aws_cloudwatch_event_bus.social.name }
      ])
      secrets = local.social_worker_database_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.outbox_worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
      linuxParameters = { initProcessEnabled = true }
      stopTimeout     = 30
    }
  ])

  depends_on = [
    aws_iam_role_policy.ecs_execution_aurora_secret,
    aws_iam_role_policy.outbox_worker
  ]

  tags = local.common_tags
}

resource "aws_ecs_task_definition" "notification_worker" {
  family                   = "${local.name_prefix}-notification-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.notification_worker.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "notification-worker"
      image     = "${data.aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true
      command   = ["npm", "run", "worker:notifications"]
      environment = concat(local.social_worker_database_environment, [
        { name = "SOCIAL_NOTIFICATION_QUEUE_URL", value = aws_sqs_queue.notification_events.url }
      ])
      secrets = local.social_worker_database_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.notification_worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
      linuxParameters = { initProcessEnabled = true }
      stopTimeout     = 30
    }
  ])

  depends_on = [
    aws_iam_role_policy.ecs_execution_aurora_secret,
    aws_iam_role_policy.notification_worker
  ]

  tags = local.common_tags
}

resource "aws_ecs_service" "outbox_worker" {
  name             = "${local.name_prefix}-outbox-worker"
  cluster          = aws_ecs_cluster.app.id
  task_definition  = aws_ecs_task_definition.outbox_worker.arn
  desired_count    = var.social_worker_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  tags = local.common_tags
}

resource "aws_ecs_service" "notification_worker" {
  name             = "${local.name_prefix}-notification-worker"
  cluster          = aws_ecs_cluster.app.id
  task_definition  = aws_ecs_task_definition.notification_worker.arn
  desired_count    = var.social_worker_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "notification_dlq_depth" {
  alarm_name          = "${local.name_prefix}-notification-dlq-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Notification events have reached the dead-letter queue."

  dimensions = {
    QueueName = aws_sqs_queue.notification_dlq.name
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "notification_queue_age" {
  alarm_name          = "${local.name_prefix}-notification-queue-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 300
  alarm_description   = "Notification event processing is more than five minutes behind."

  dimensions = {
    QueueName = aws_sqs_queue.notification_events.name
  }

  tags = local.common_tags
}

output "social_event_bus_name" {
  value = aws_cloudwatch_event_bus.social.name
}

output "social_notification_queue_url" {
  value = aws_sqs_queue.notification_events.url
}

output "social_notification_dlq_url" {
  value = aws_sqs_queue.notification_dlq.url
}

output "social_outbox_worker_service" {
  value = aws_ecs_service.outbox_worker.name
}

output "social_notification_worker_service" {
  value = aws_ecs_service.notification_worker.name
}
