variable "aurora_engine_version" {
  description = "Aurora PostgreSQL 16.x engine version verified as available for db.serverless in ap-south-1."
  type        = string

  validation {
    condition     = can(regex("^16\\.", var.aurora_engine_version))
    error_message = "aurora_engine_version must be an Aurora PostgreSQL 16.x version."
  }
}

variable "aurora_min_acu" {
  # Round 14 (3.5, owner-approved): 0.5 ACU floor with no auto-pause, so the first request after
  # an idle spell no longer waits ~15 s for the database to resume. Zero re-enables auto-pause.
  description = "Minimum Aurora Serverless v2 ACUs for staging. Zero enables supported auto-pause."
  type        = number
  default     = 0.5
}

variable "aurora_max_acu" {
  # Round DB (owner-approved 12 Nov): 2 -> 4. Capacity above 2 ACU is paid per use and watched by the hourly
  # extra-capacity check in aurora-capacity.tf.
  description = "Maximum Aurora Serverless v2 ACUs for staging."
  type        = number
  default     = 4
}

variable "aurora_extra_acu_allowance_hours" {
  # Round DB (owner-approved 12 Nov): about ₹700 a month at ₹17.8 per ACU-hour incl. GST.
  description = "Monthly ACU-hours above 2 ACU after which the alerts topic is emailed once."
  type        = number
  default     = 39
}

variable "aurora_auto_pause_seconds" {
  description = "Idle seconds before Aurora Serverless v2 auto-pauses when min ACU is zero."
  type        = number
  default     = 900
}

variable "enable_google_identity_provider" {
  description = "Enable Cognito Google federation after the Google OAuth JSON secret has been populated in Secrets Manager."
  type        = bool
  default     = true
}

variable "ses_domain" {
  description = "SES domain identity used for transactional email."
  type        = string
  default     = "seanshore.in"
}

variable "ses_from_address" {
  description = "Approved transactional FROM address."
  type        = string
  default     = "no-reply@seanshore.in"
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
