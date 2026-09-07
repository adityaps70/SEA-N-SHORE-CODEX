variable "origin_tls_hostname" {
  description = "Dedicated staging origin hostname used for CloudFront-to-ALB HTTPS."
  type        = string
  default     = "origin-staging.seaandshore.in"
}

resource "aws_acm_certificate" "origin_tls" {
  domain_name       = var.origin_tls_hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-origin-tls"
    Purpose = "CloudFront-to-ALB origin TLS"
  })
}

output "origin_tls_certificate_arn" {
  description = "Regional ACM certificate ARN for the dedicated staging origin hostname."
  value       = aws_acm_certificate.origin_tls.arn
}

output "origin_tls_dns_validation_records" {
  description = "DNS validation records that must be added at the authoritative DNS provider."
  value = [
    for option in aws_acm_certificate.origin_tls.domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ]
}
