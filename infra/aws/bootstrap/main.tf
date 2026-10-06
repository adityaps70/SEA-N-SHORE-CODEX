terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.1"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "Primary AWS region."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Short lowercase project identifier used in AWS resource names."
  type        = string
  default     = "sea-n-shore"
}

variable "environment" {
  description = "GitHub/AWS environment bootstrapped by this stack."
  type        = string
  default     = "staging"
}

variable "github_repository" {
  description = "GitHub repository in owner/name form."
  type        = string
  default     = "adityaps70/SEA-N-SHORE-CODEX"
}

variable "github_owner_id" {
  description = "Immutable numeric GitHub owner ID used in OIDC subject claims for repositories created after 2026-07-15."
  type        = string
  default     = "167612148"
}

variable "github_repository_id" {
  description = "Immutable numeric GitHub repository ID used in OIDC subject claims for repositories created after 2026-07-15."
  type        = string
  default     = "1354507962"
}

variable "github_environment" {
  description = "GitHub Environment allowed to assume the AWS deploy role."
  type        = string
  default     = "staging"
}

variable "ecr_repository_name" {
  description = "ECR repository that stores Sea N Shore images."
  type        = string
  default     = "sea-n-shore"
}

variable "phase5b_cognito_user_pool_id" {
  description = "Exact staging Cognito user pool ID allowed for Phase 5B discovery reads."
  type        = string
  default     = "ap-south-1_FKyi5lJsY"
}

variable "existing_github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN. Leave blank to create one."
  type        = string
  default     = ""
}

data "aws_caller_identity" "current" {}

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = {
    Project     = "Sea N Shore"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

resource "aws_s3_bucket" "terraform_state" {
  bucket        = "${var.project_name}-${data.aws_caller_identity.current.account_id}-${var.aws_region}-tfstate"
  force_destroy = false
  tags          = local.common_tags
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_ecr_repository" "app" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the latest 30 application images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.existing_github_oidc_provider_arn == "" ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]

  tags = local.common_tags
}

locals {
  github_oidc_provider_arn = var.existing_github_oidc_provider_arn != "" ? var.existing_github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
}

resource "aws_iam_role" "github_deploy" {
  name = "${local.name_prefix}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = local.github_oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = "repo:${split("/", var.github_repository)[0]}@${var.github_owner_id}/${split("/", var.github_repository)[1]}@${var.github_repository_id}:environment:${var.github_environment}"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "${local.name_prefix}-github-deploy"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
          "ecr:BatchGetImage"
        ]
        Resource = aws_ecr_repository.app.arn
      },
      {
        Sid    = "EcsDeploy"
        Effect = "Allow"
        Action = [
          "ecs:DescribeClusters",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
          "ecs:TagResource"
        ]
        Resource = "*"
      },
      {
        Sid    = "PassEcsRoles"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-ecs-execution",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-ecs-task",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-outbox-worker",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-notification-worker"
        ]
      },
      {
        Sid    = "ReviewStagingApplicationLogs"
        Effect = "Allow"
        Action = ["logs:FilterLogEvents"]
        Resource = [
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/web",
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/web:*"
        ]
      },
      {
        Sid      = "Phase5bSesAccountRead"
        Effect   = "Allow"
        Action   = ["ses:GetAccount"]
        Resource = "*"
      },
      {
        Sid    = "Phase5bSesResourceRead"
        Effect = "Allow"
        Action = [
          "ses:GetEmailIdentity",
          "ses:GetConfigurationSet"
        ]
        Resource = [
          "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/seanshore.in",
          "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:configuration-set/sea-n-shore-staging-transactional"
        ]
      },
      {
        Sid      = "Phase5bSesIdentityCreate"
        Effect   = "Allow"
        Action   = ["ses:CreateEmailIdentity"]
        Resource = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/seanshore.in"
      },
      {
        Sid    = "Phase5bSesIdentityManage"
        Effect = "Allow"
        Action = [
          "ses:PutEmailIdentityConfigurationSetAttributes",
          "ses:PutEmailIdentityDkimSigningAttributes",
          "ses:UpdateEmailIdentityPolicy"
        ]
        Resource = [
          "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/seanshore.in",
          "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:configuration-set/sea-n-shore-staging-transactional"
        ]
      },
      {
        Sid      = "Phase5bSesConfigurationSetCreate"
        Effect   = "Allow"
        Action   = ["ses:CreateConfigurationSet"]
        Resource = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:configuration-set/sea-n-shore-staging-transactional"
      },
      {
        Sid    = "Phase5bCognitoRead"
        Effect = "Allow"
        Action = [
          "cognito-idp:DescribeUserPool",
          "cognito-idp:UpdateUserPool"
        ]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/${var.phase5b_cognito_user_pool_id}"
      },
      {
        Sid    = "ReviewCognitoSignupCapacity"
        Effect = "Allow"
        Action = [
          "cognito-idp:GetProvisionedLimit",
          "cloudwatch:GetMetricStatistics"
        ]
        Resource = "*"
      },
      {
        Sid    = "ManageStagingMediaCors"
        Effect = "Allow"
        Action = [
          "s3:PutBucketCORS",
          "s3:GetBucketCORS"
        ]
        Resource = "arn:aws:s3:::${local.name_prefix}-${data.aws_caller_identity.current.account_id}-media"
      },
      {
        Sid      = "LegacyDumpUploadObject"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "arn:aws:s3:::${local.name_prefix}-${data.aws_caller_identity.current.account_id}-media/private-migrations/beaufortmarine.sql"
      },
      {
        # Exact-SHA git bundles handed to the bootstrap host (the host never clones from GitHub).
        Sid      = "CiCheckoutBundles"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = "arn:aws:s3:::${local.name_prefix}-${data.aws_caller_identity.current.account_id}-migration/ci-checkouts/*"
      },
      {
        Sid      = "DiscoverBootstrapInstance"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      {
        Sid      = "SsmRunShellDocument"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
      },
      {
        Sid      = "SsmSendToBootstrap"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*"
        Condition = {
          StringEquals = {
            "ssm:resourceTag/Name" = "sea-n-shore-bootstrap"
          }
        }
      },
      {
        Sid    = "SsmReadCommandResult"
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations"
        ]
        Resource = "*"
      }
    ]
  })
}

# Round 15: the USD 50 Terraform budget (sea-n-shore-staging-monthly-budget) and the billing_email
# variable that only fed it are retired; the owner's console budget and cost anomaly subscription
# (not managed here) cover cost alerts. scripts/aws/bootstrap-budget-retirement.sh destroys it.

# Round 15: the verify workflows read the deep health check token with this role. A separate
# inline policy (scripts/aws/github-deploy-iam.sh reconciles only the main one), limited to that
# one secret: its value (verify workflows) and its ARN (the staging deploy wires it into the web
# task). The 6-character suffix is the random part Secrets Manager adds to every secret ARN.
resource "aws_iam_role_policy" "github_deploy_health_check_token" {
  name = "${local.name_prefix}-github-deploy-health-check-token"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadHealthCheckTokenSecret"
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${local.name_prefix}/health-check-token-??????"
      }
    ]
  })
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "terraform_state_bucket" {
  value = aws_s3_bucket.terraform_state.bucket
}

output "ecr_repository_name" {
  value = aws_ecr_repository.app.name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}
