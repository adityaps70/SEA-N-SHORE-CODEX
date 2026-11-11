# Round ARCH (signed-in load test): the S3 hand-off of the sealed load-test sessions, applied by
# scripts/aws/load-test-handoff-infra.sh (apply-once). Owner-approved: ₹88/month (the KMS key, $1), everything else ₹0.
#
# The sessions task (the web task definition, run once by scripts/aws/load-test-accounts.sh) writes ONE object,
# sessions/<run id>-<attempt>.sealed: the run's sessions already sealed to the runner's one-time RSA key, so S3 and KMS
# are a second lock. The GitHub runner reads it, deletes it and checks the prefix is empty; the report job deletes it
# again whatever happened. Lifecycle expiry (1 day, the shortest S3 allows) is the backstop.
#
#   - web task role: s3:PutObject on sessions/* only (no read, list or delete);
#   - GitHub deploy role (scripts/aws/github-deploy-iam.sh): s3:GetObject and s3:DeleteObject on sessions/*, and
#     s3:ListBucket limited to the sessions/ prefix;
#   - the key: the account may administer it but not use it (no Encrypt, Decrypt, GenerateDataKey or CreateGrant); the task role may only generate data keys through S3
#     for this bucket, the GitHub deploy role may only decrypt through S3 for this bucket. No one else can decrypt.

locals {
  load_test_handoff_bucket   = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}-load-test-handoff"
  load_test_handoff_github   = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-github-deploy"
  load_test_handoff_s3_arn   = "arn:aws:s3:::${local.name_prefix}-${data.aws_caller_identity.current.account_id}-load-test-handoff"
  load_test_handoff_s3_via   = "s3.${var.aws_region}.amazonaws.com"
  load_test_handoff_contexts = [local.load_test_handoff_s3_arn, "${local.load_test_handoff_s3_arn}/sessions/*"]
}

resource "aws_kms_key" "load_test_handoff" {
  description             = "${local.name_prefix} load-test sessions hand-off (S3 SSE-KMS)"
  enable_key_rotation     = true
  deletion_window_in_days = 7

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdministersButCannotUse"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action = [
          "kms:CreateAlias", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*",
          "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
          "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion"
        ]
        Resource = "*"
      },
      {
        Sid       = "SessionsTaskEncryptsThroughS3"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.ecs_task.arn }
        Action    = ["kms:GenerateDataKey"]
        Resource  = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = local.load_test_handoff_s3_via }
          StringLike   = { "kms:EncryptionContext:aws:s3:arn" = local.load_test_handoff_contexts }
        }
      },
      {
        Sid       = "RunnerDecryptsThroughS3"
        Effect    = "Allow"
        Principal = { AWS = local.load_test_handoff_github }
        Action    = ["kms:Decrypt"]
        Resource  = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = local.load_test_handoff_s3_via }
          StringLike   = { "kms:EncryptionContext:aws:s3:arn" = local.load_test_handoff_contexts }
        }
      }
    ]
  })

  tags = merge(local.common_tags, { Purpose = "load-test-handoff" })
}

resource "aws_kms_alias" "load_test_handoff" {
  name          = "alias/${local.name_prefix}-load-test-handoff"
  target_key_id = aws_kms_key.load_test_handoff.key_id
}

# Not versioned, so a delete removes the object for good.
resource "aws_s3_bucket" "load_test_handoff" {
  bucket        = local.load_test_handoff_bucket
  force_destroy = false

  tags = merge(local.common_tags, { Purpose = "load-test-handoff" })
}

resource "aws_s3_bucket_public_access_block" "load_test_handoff" {
  bucket = aws_s3_bucket.load_test_handoff.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "load_test_handoff" {
  bucket = aws_s3_bucket.load_test_handoff.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "load_test_handoff" {
  bucket = aws_s3_bucket.load_test_handoff.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.load_test_handoff.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "load_test_handoff" {
  bucket = aws_s3_bucket.load_test_handoff.id

  rule {
    id     = "expire-sessions-after-1-day"
    status = "Enabled"

    filter {}

    expiration {
      days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# HTTPS only, and every object takes the bucket's default encryption (the key above): an upload that names any
# encryption of its own is refused.
resource "aws_s3_bucket_policy" "load_test_handoff" {
  bucket = aws_s3_bucket.load_test_handoff.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [local.load_test_handoff_s3_arn, "${local.load_test_handoff_s3_arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyOwnEncryptionHeaders"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${local.load_test_handoff_s3_arn}/*"
        Condition = { Null = { "s3:x-amz-server-side-encryption" = "false" } }
      },
      {
        Sid       = "DenyCustomerKeys"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${local.load_test_handoff_s3_arn}/*"
        Condition = { Null = { "s3:x-amz-server-side-encryption-customer-algorithm" = "false" } }
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.load_test_handoff]
}

resource "aws_iam_role_policy" "ecs_task_load_test_handoff" {
  name = "${local.name_prefix}-load-test-handoff"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteSealedLoadTestSessions"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${local.load_test_handoff_s3_arn}/sessions/*"
      }
    ]
  })
}
