locals {
  realtime_ticket_audience              = "sea-n-shore-realtime"
  realtime_profile_index                = "profile_id-index"
  realtime_websocket_url                = "wss://${aws_apigatewayv2_api.realtime.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.realtime.name}"
  realtime_management_url               = "https://${aws_apigatewayv2_api.realtime.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.realtime.name}"
  realtime_lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "random_password" "realtime_ticket" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "realtime_ticket" {
  name                    = "${local.name_prefix}/realtime-ticket-signing"
  description             = "HMAC signing secret for short-lived Sea N Shore realtime connection tickets."
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "realtime_ticket" {
  secret_id     = aws_secretsmanager_secret.realtime_ticket.id
  secret_string = random_password.realtime_ticket.result
}

resource "aws_iam_role_policy" "ecs_execution_realtime_ticket_secret" {
  name = "${local.name_prefix}-realtime-ticket-secret"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadRealtimeTicketSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.realtime_ticket.arn
      }
    ]
  })
}

resource "aws_dynamodb_table" "realtime_connections" {
  name         = "${local.name_prefix}-realtime-connections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connection_id"

  attribute {
    name = "connection_id"
    type = "S"
  }

  attribute {
    name = "profile_id"
    type = "S"
  }

  global_secondary_index {
    name               = local.realtime_profile_index
    hash_key           = "profile_id"
    projection_type    = "INCLUDE"
    non_key_attributes = ["expires_at"]
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.common_tags
}

resource "aws_sqs_queue" "realtime_dlq" {
  name                      = "${local.name_prefix}-realtime-events-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = local.common_tags
}

resource "aws_sqs_queue" "realtime_events" {
  name                       = "${local.name_prefix}-realtime-events"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.realtime_dlq.arn
    maxReceiveCount     = 5
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_rule" "realtime_events" {
  name           = "${local.name_prefix}-realtime-events"
  event_bus_name = aws_cloudwatch_event_bus.social.name

  event_pattern = jsonencode({
    source        = ["sea-n-shore.social"]
    "detail-type" = [
      "message.created",
      "conversation.read_cursor_advanced"
    ]
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "realtime_queue" {
  rule           = aws_cloudwatch_event_rule.realtime_events.name
  event_bus_name = aws_cloudwatch_event_bus.social.name
  arn            = aws_sqs_queue.realtime_events.arn
}

resource "aws_sqs_queue_policy" "realtime_events" {
  queue_url = aws_sqs_queue.realtime_events.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEventBridgeRealtimeDelivery"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.realtime_events.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_cloudwatch_event_rule.realtime_events.arn
          }
        }
      }
    ]
  })
}

data "archive_file" "realtime_authorizer" {
  type        = "zip"
  source_file = "${path.module}/lambda/realtime-authorizer.mjs"
  output_path = "${path.module}/.terraform/realtime-authorizer.zip"
}

data "archive_file" "realtime_connection" {
  type        = "zip"
  source_file = "${path.module}/lambda/realtime-connection.mjs"
  output_path = "${path.module}/.terraform/realtime-connection.zip"
}

data "archive_file" "realtime_fanout" {
  type        = "zip"
  source_file = "${path.module}/lambda/realtime-fanout.mjs"
  output_path = "${path.module}/.terraform/realtime-fanout.zip"
}

resource "aws_iam_role" "realtime_authorizer" {
  name               = "${local.name_prefix}-realtime-authorizer"
  assume_role_policy = local.realtime_lambda_assume_role_policy
  tags               = local.common_tags
}

resource "aws_iam_role" "realtime_connection" {
  name               = "${local.name_prefix}-realtime-connection"
  assume_role_policy = local.realtime_lambda_assume_role_policy
  tags               = local.common_tags
}

resource "aws_iam_role" "realtime_fanout" {
  name               = "${local.name_prefix}-realtime-fanout"
  assume_role_policy = local.realtime_lambda_assume_role_policy
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "realtime_authorizer_logs" {
  role       = aws_iam_role.realtime_authorizer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "realtime_connection_logs" {
  role       = aws_iam_role.realtime_connection.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "realtime_fanout_logs" {
  role       = aws_iam_role.realtime_fanout.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "realtime_authorizer" {
  name = "${local.name_prefix}-realtime-authorizer"
  role = aws_iam_role.realtime_authorizer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadRealtimeTicketSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.realtime_ticket.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "realtime_connection" {
  name = "${local.name_prefix}-realtime-connection"
  role = aws_iam_role.realtime_connection.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "MaintainRealtimeConnections"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:DeleteItem"
        ]
        Resource = aws_dynamodb_table.realtime_connections.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "realtime_fanout" {
  name = "${local.name_prefix}-realtime-fanout"
  role = aws_iam_role.realtime_fanout.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadAndCleanRealtimeConnections"
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:DeleteItem"
        ]
        Resource = [
          aws_dynamodb_table.realtime_connections.arn,
          "${aws_dynamodb_table.realtime_connections.arn}/index/${local.realtime_profile_index}"
        ]
      },
      {
        Sid    = "ConsumeRealtimeQueue"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.realtime_events.arn
      },
      {
        Sid      = "PushRealtimeConnections"
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections"]
        Resource = "${aws_apigatewayv2_api.realtime.execution_arn}/${aws_apigatewayv2_stage.realtime.name}/POST/@connections/*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "realtime_authorizer" {
  name              = "/aws/lambda/${local.name_prefix}-realtime-authorizer"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "realtime_connection" {
  name              = "/aws/lambda/${local.name_prefix}-realtime-connection"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "realtime_fanout" {
  name              = "/aws/lambda/${local.name_prefix}-realtime-fanout"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_lambda_function" "realtime_authorizer" {
  function_name    = "${local.name_prefix}-realtime-authorizer"
  role             = aws_iam_role.realtime_authorizer.arn
  runtime          = "nodejs22.x"
  handler          = "realtime-authorizer.handler"
  filename         = data.archive_file.realtime_authorizer.output_path
  source_code_hash = data.archive_file.realtime_authorizer.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      REALTIME_TICKET_AUDIENCE   = local.realtime_ticket_audience
      REALTIME_TICKET_SECRET_ARN = aws_secretsmanager_secret.realtime_ticket.arn
      REALTIME_ALLOWED_ORIGIN     = var.site_url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.realtime_authorizer,
    aws_iam_role_policy.realtime_authorizer,
    aws_iam_role_policy_attachment.realtime_authorizer_logs
  ]

  tags = local.common_tags
}

resource "aws_lambda_function" "realtime_connection" {
  function_name    = "${local.name_prefix}-realtime-connection"
  role             = aws_iam_role.realtime_connection.arn
  runtime          = "nodejs22.x"
  handler          = "realtime-connection.handler"
  filename         = data.archive_file.realtime_connection.output_path
  source_code_hash = data.archive_file.realtime_connection.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      REALTIME_CONNECTIONS_TABLE = aws_dynamodb_table.realtime_connections.name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.realtime_connection,
    aws_iam_role_policy.realtime_connection,
    aws_iam_role_policy_attachment.realtime_connection_logs
  ]

  tags = local.common_tags
}

resource "aws_apigatewayv2_api" "realtime" {
  name                       = "${local.name_prefix}-realtime"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
  tags                       = local.common_tags
}

resource "aws_lambda_permission" "realtime_authorizer_apigateway" {
  statement_id  = "AllowRealtimeApiAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.realtime_authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.realtime.execution_arn}/*"
}

resource "aws_apigatewayv2_authorizer" "realtime_connect" {
  api_id           = aws_apigatewayv2_api.realtime.id
  name             = "realtime-connect"
  authorizer_type  = "REQUEST"
  authorizer_uri   = aws_lambda_function.realtime_authorizer.invoke_arn
  identity_sources = ["route.request.querystring.ticket"]
}

resource "aws_apigatewayv2_integration" "realtime_connection" {
  api_id             = aws_apigatewayv2_api.realtime.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.realtime_connection.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "realtime_connect" {
  api_id             = aws_apigatewayv2_api.realtime.id
  route_key          = "$connect"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.realtime_connect.id
  target             = "integrations/${aws_apigatewayv2_integration.realtime_connection.id}"
}

resource "aws_apigatewayv2_route" "realtime_disconnect" {
  api_id             = aws_apigatewayv2_api.realtime.id
  route_key          = "$disconnect"
  authorization_type = "NONE"
  target             = "integrations/${aws_apigatewayv2_integration.realtime_connection.id}"
}

resource "aws_apigatewayv2_route" "realtime_default" {
  api_id             = aws_apigatewayv2_api.realtime.id
  route_key          = "$default"
  authorization_type = "NONE"
  target             = "integrations/${aws_apigatewayv2_integration.realtime_connection.id}"
}

resource "aws_lambda_permission" "realtime_connection_apigateway" {
  statement_id  = "AllowRealtimeApiRoutes"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.realtime_connection.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.realtime.execution_arn}/*/*"
}

resource "aws_cloudwatch_log_group" "realtime_api" {
  name              = "/aws/apigateway/${local.name_prefix}/realtime"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_apigatewayv2_stage" "realtime" {
  api_id      = aws_apigatewayv2_api.realtime.id
  name        = var.environment
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.realtime_api.arn
    format = jsonencode({
      requestId    = "$context.requestId"
      routeKey     = "$context.routeKey"
      status       = "$context.status"
      connectionId = "$context.connectionId"
      error        = "$context.error.message"
    })
  }

  default_route_settings {
    throttling_burst_limit = 500
    throttling_rate_limit  = 1000
  }

  tags = local.common_tags
}

resource "aws_lambda_function" "realtime_fanout" {
  function_name    = "${local.name_prefix}-realtime-fanout"
  role             = aws_iam_role.realtime_fanout.arn
  runtime          = "nodejs22.x"
  handler          = "realtime-fanout.handler"
  filename         = data.archive_file.realtime_fanout.output_path
  source_code_hash = data.archive_file.realtime_fanout.output_base64sha256
  timeout          = 20
  memory_size      = 256

  environment {
    variables = {
      REALTIME_CONNECTIONS_TABLE   = aws_dynamodb_table.realtime_connections.name
      REALTIME_PROFILE_INDEX       = local.realtime_profile_index
      REALTIME_MANAGEMENT_ENDPOINT = local.realtime_management_url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.realtime_fanout,
    aws_iam_role_policy.realtime_fanout,
    aws_iam_role_policy_attachment.realtime_fanout_logs
  ]

  tags = local.common_tags
}

resource "aws_lambda_event_source_mapping" "realtime_events" {
  event_source_arn        = aws_sqs_queue.realtime_events.arn
  function_name           = aws_lambda_function.realtime_fanout.arn
  batch_size              = 10
  enabled                 = true
  function_response_types = ["ReportBatchItemFailures"]

  depends_on = [aws_iam_role_policy.realtime_fanout]
}

resource "aws_cloudwatch_metric_alarm" "realtime_dlq_depth" {
  alarm_name          = "${local.name_prefix}-realtime-dlq-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Realtime messaging events have reached the dead-letter queue."

  dimensions = {
    QueueName = aws_sqs_queue.realtime_dlq.name
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "realtime_queue_age" {
  alarm_name          = "${local.name_prefix}-realtime-queue-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 60
  alarm_description   = "Realtime messaging fan-out is more than one minute behind."

  dimensions = {
    QueueName = aws_sqs_queue.realtime_events.name
  }

  tags = local.common_tags
}

output "realtime_websocket_url" {
  description = "Runtime REALTIME_WEBSOCKET_URL for authenticated Sea N Shore clients."
  value       = local.realtime_websocket_url
}

output "realtime_ticket_secret_arn" {
  description = "Secrets Manager ARN injected as REALTIME_TICKET_SECRET into the web task and read by the authorizer."
  value       = aws_secretsmanager_secret.realtime_ticket.arn
}

output "realtime_connections_table" {
  value = aws_dynamodb_table.realtime_connections.name
}

output "realtime_events_queue_url" {
  value = aws_sqs_queue.realtime_events.url
}
