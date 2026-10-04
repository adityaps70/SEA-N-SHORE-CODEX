# Round 14 (2.6): DMARC for seanshore.in at p=quarantine. Resend signs account mail as
# mail.seanshore.in (resend._domainkey.mail) and uses send.mail.seanshore.in as its MAIL FROM (SPF
# and feedback MX), so both DKIM and SPF align with seanshore.in under relaxed alignment. The record
# existed outside Terraform at p=none; allow_overwrite takes it over.
variable "seanshore_dmarc_rua" {
  description = "Mailbox for DMARC aggregate reports (rua). Empty publishes the policy without reports."
  type        = string
  default     = ""
}

resource "aws_route53_record" "seanshore_dmarc" {
  zone_id         = aws_route53_zone.seanshore.zone_id
  name            = "_dmarc.seanshore.in"
  type            = "TXT"
  ttl             = 300
  allow_overwrite = true
  records = [
    var.seanshore_dmarc_rua == ""
    ? "v=DMARC1; p=quarantine; adkim=r; aspf=r"
    : "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:${var.seanshore_dmarc_rua}"
  ]
}
