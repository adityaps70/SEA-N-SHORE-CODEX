# Round P3 (Part D, option a): MediaConvert renditions of course trailers and lesson videos.
#
# MediaConvert reads the uploaded video from learning/ and writes the 720p MP4 and HLS 360p/720p ladder under
# m/v/ (served by the signed media CDN, media-cdn.tf); its role can do nothing else. The outbox worker starts and
# polls the jobs (src/features/learning/media-renditions.ts) and may pass only this role, only to MediaConvert.
# Spend is bounded by the worker's monthly minute cap and watched by the MediaConvert budget (web-resilience.tf).

locals {
  mediaconvert_role_name = "${local.name_prefix}-mediaconvert"
}

resource "aws_iam_role" "mediaconvert" {
  name = local.mediaconvert_role_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "mediaconvert.amazonaws.com" }
        Action    = "sts:AssumeRole"
        Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
      }
    ]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "mediaconvert_media" {
  name = "${local.name_prefix}-mediaconvert-media"
  role = aws_iam_role.mediaconvert.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadCourseVideoUploads"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.app["media"].arn}/learning/*"
      },
      {
        Sid      = "WriteCourseVideoRenditions"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.app["media"].arn}/m/v/*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "outbox_worker_mediaconvert" {
  name = "${local.name_prefix}-outbox-worker-mediaconvert"
  role = aws_iam_role.outbox_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StartAndReadCourseVideoJobs"
        Effect = "Allow"
        Action = ["mediaconvert:CreateJob", "mediaconvert:GetJob"]
        Resource = [
          "arn:aws:mediaconvert:${var.aws_region}:${data.aws_caller_identity.current.account_id}:queues/Default",
          "arn:aws:mediaconvert:${var.aws_region}:${data.aws_caller_identity.current.account_id}:jobs/*"
        ]
      },
      {
        Sid       = "PassOnlyTheMediaConvertRole"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = aws_iam_role.mediaconvert.arn
        Condition = { StringEquals = { "iam:PassedToService" = "mediaconvert.amazonaws.com" } }
      }
    ]
  })
}

output "mediaconvert_role_arn" {
  description = "Role the outbox worker passes to MediaConvert jobs (MEDIA_TRANSCODE_ROLE_ARN)."
  value       = aws_iam_role.mediaconvert.arn
}
