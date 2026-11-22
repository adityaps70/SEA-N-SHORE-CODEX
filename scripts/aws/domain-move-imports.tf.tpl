# Domain move, import step. Copied into infra/aws/app only by scripts/aws/domain-move-infra.sh, in its own host
# checkout, for its own plan; never committed under infra/aws/app (no other runner may import as a side effect).
# Ids from the Phase 0 report (18 Nov).

import {
  to = aws_route53_zone.seanshore_net
  id = local.seanshore_net_zone_id
}

import {
  for_each = local.console_zone_ids
  to       = aws_route53_zone.console[each.key]
  id       = each.value
}

import {
  provider = aws.us_east_1
  to       = aws_acm_certificate.console_redirect
  id       = "arn:aws:acm:us-east-1:310356785722:certificate/4a7934fb-4dcd-4247-82ed-cd0c6203d4af"
}

import {
  to = aws_cloudfront_function.console_redirect
  id = "seanshore-redirect-domains"
}

import {
  to = aws_cloudfront_distribution.console_redirect
  id = "E2MCZ79G101LLD"
}

import {
  for_each = local.console_redirect_alias_records
  to       = aws_route53_record.console_redirect_alias[each.key]
  id       = "${local.console_zone_ids[each.value.zone]}_${each.value.host}_${each.value.type}"
}

import {
  for_each = local.console_redirect_validation_records
  to       = aws_route53_record.console_redirect_validation[each.key]
  id       = "${local.console_zone_ids[each.value.zone]}_${each.key}_CNAME"
}

import {
  to = aws_route53_record.seanshore_google_site_verification
  id = "Z01082983RI8SO9NKBBHW_seanshore.in_TXT"
}

import {
  to = aws_route53_record.seanshore_resend_dkim
  id = "Z01082983RI8SO9NKBBHW_resend._domainkey.mail.seanshore.in_TXT"
}

import {
  for_each = local.resend_return_path
  to       = aws_route53_record.seanshore_resend_return_path[each.key]
  id       = "Z01082983RI8SO9NKBBHW_${each.key}.mail.seanshore.in_CNAME"
}
