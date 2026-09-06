variable "aurora_engine_version" {
  description = "Aurora PostgreSQL 16.x engine version verified as available for db.serverless in ap-south-1."
  type        = string

  validation {
    condition     = can(regex("^16\\.", var.aurora_engine_version))
    error_message = "aurora_engine_version must be an Aurora PostgreSQL 16.x version."
  }
}

variable "aurora_min_acu" {
  description = "Minimum Aurora Serverless v2 ACUs for staging. Zero enables supported auto-pause."
  type        = number
  default     = 0
}

variable "aurora_max_acu" {
  description = "Maximum Aurora Serverless v2 ACUs for staging."
  type        = number
  default     = 2
}

variable "aurora_auto_pause_seconds" {
  description = "Idle seconds before Aurora Serverless v2 auto-pauses when min ACU is zero."
  type        = number
  default     = 900
}

variable "enable_google_identity_provider" {
  description = "Enable Cognito Google federation after the Google OAuth JSON secret has been populated in Secrets Manager."
  type        = bool
  default     = false
}

variable "ses_domain" {
  description = "SES domain identity used for transactional email."
  type        = string
  default     = "seaandshore.in"
}

variable "ses_from_address" {
  description = "Approved transactional FROM address."
  type        = string
  default     = "no-reply@seaandshore.in"
}

variable "ses_from_display_name" {
  description = "Display name for transactional email."
  type        = string
  default     = "Sea N Shore"
}

variable "enable_cognito_ses_email" {
  description = "Switch Cognito from default email delivery to verified SES after readiness gates pass."
  type        = bool
  default     = false
}
