locals {
  storage_bucket_names = {
    media             = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-media"
    private_documents = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-private"
    migration_backup  = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-migration"
  }
}

resource "aws_s3_bucket" "app" {
  for_each = local.storage_bucket_names

  bucket        = each.value
  force_destroy = false

  tags = merge(local.common_tags, {
    Purpose = each.key
  })
}

resource "aws_s3_bucket_public_access_block" "app" {
  for_each = aws_s3_bucket.app

  bucket = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "app" {
  for_each = aws_s3_bucket.app

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  for_each = aws_s3_bucket.app

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "migration_backup" {
  bucket = aws_s3_bucket.app["migration_backup"].id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [
    aws_s3_bucket_versioning.app
  ]
}
