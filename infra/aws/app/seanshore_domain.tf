resource "aws_route53_zone" "seanshore" {
  name = "seanshore.in"

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = "seanshore.in"
  })
}

resource "aws_acm_certificate" "seanshore_edge" {
  provider                  = aws.us_east_1
  domain_name               = "seanshore.in"
  subject_alternative_names = ["www.seanshore.in"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }

  tags = merge(local.common_tags, {
    Name = "seanshore.in edge certificate"
  })
}
