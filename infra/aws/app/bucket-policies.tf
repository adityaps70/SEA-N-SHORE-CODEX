# Round 14 (2.13): every app bucket refuses plain HTTP, and the media bucket refuses the old
# private-migrations/ prefix outright; the legacy SQL dump now lives in the migration bucket
# (moved, and every media-bucket version purged, by scripts/aws/private-migration-relocate.sh).
# Deny-only, so it lives apart from storage.tf, whose IAM grants stay least-privilege (no "s3:*").
resource "aws_s3_bucket_policy" "app" {
  for_each = aws_s3_bucket.app

  bucket = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid       = "DenyInsecureTransport"
          Effect    = "Deny"
          Principal = "*"
          Action    = "s3:*"
          Resource  = [each.value.arn, "${each.value.arn}/*"]
          Condition = { Bool = { "aws:SecureTransport" = "false" } }
        }
      ],
      each.key == "media" ? [
        {
          Sid       = "DenyPrivateMigrationsPrefix"
          Effect    = "Deny"
          Principal = "*"
          Action    = "s3:*"
          Resource  = "${each.value.arn}/private-migrations/*"
        }
      ] : []
    )
  })

  depends_on = [aws_s3_bucket_public_access_block.app]
}
