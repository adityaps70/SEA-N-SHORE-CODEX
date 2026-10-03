resource "aws_subnet" "private_db_a" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.40.30.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = false
  tags                    = merge(local.common_tags, { Name = "${local.name_prefix}-private-db-a" })
}

resource "aws_subnet" "private_db_b" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.40.40.0/24"
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = false
  tags                    = merge(local.common_tags, { Name = "${local.name_prefix}-private-db-b" })
}

resource "aws_route_table" "private_db" {
  vpc_id = aws_vpc.app.id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-private-db" })
}

resource "aws_route_table_association" "private_db_a" {
  subnet_id      = aws_subnet.private_db_a.id
  route_table_id = aws_route_table.private_db.id
}

resource "aws_route_table_association" "private_db_b" {
  subnet_id      = aws_subnet.private_db_b.id
  route_table_id = aws_route_table.private_db.id
}

resource "aws_db_subnet_group" "aurora" {
  name       = "${local.name_prefix}-aurora"
  subnet_ids = [aws_subnet.private_db_a.id, aws_subnet.private_db_b.id]
  tags       = local.common_tags
}

resource "aws_security_group" "aurora" {
  name        = "${local.name_prefix}-aurora"
  description = "Aurora PostgreSQL reachable only from Sea N Shore ECS tasks"
  vpc_id      = aws_vpc.app.id

  ingress {
    description     = "PostgreSQL from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-aurora" })
}
