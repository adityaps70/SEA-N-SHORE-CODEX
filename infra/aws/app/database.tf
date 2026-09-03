resource "aws_cloudwatch_log_group" "aurora_postgresql" {
  name              = "/aws/rds/cluster/${local.name_prefix}-aurora/postgresql"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_rds_cluster" "aurora" {
  cluster_identifier = "${local.name_prefix}-aurora"
  engine             = "aurora-postgresql"
  engine_version     = var.aurora_engine_version
  database_name      = "sea_n_shore"
  master_username    = "sns_cluster_admin"

  manage_master_user_password = true
  enable_http_endpoint        = true
  storage_encrypted           = true
  db_subnet_group_name        = aws_db_subnet_group.aurora.name
  vpc_security_group_ids      = [aws_security_group.aurora.id]

  backup_retention_period      = 1
  preferred_backup_window      = "18:00-19:00"
  preferred_maintenance_window = "sun:19:30-sun:20:30"
  copy_tags_to_snapshot        = true
  deletion_protection          = true
  skip_final_snapshot          = true

  enabled_cloudwatch_logs_exports = ["postgresql"]

  serverlessv2_scaling_configuration {
    min_capacity             = var.aurora_min_acu
    max_capacity             = var.aurora_max_acu
    seconds_until_auto_pause = var.aurora_auto_pause_seconds
  }

  depends_on = [aws_cloudwatch_log_group.aurora_postgresql]
  tags       = local.common_tags
}

resource "aws_rds_cluster_instance" "aurora_writer" {
  identifier          = "${local.name_prefix}-aurora-writer"
  cluster_identifier  = aws_rds_cluster.aurora.id
  instance_class      = "db.serverless"
  engine              = aws_rds_cluster.aurora.engine
  engine_version      = aws_rds_cluster.aurora.engine_version
  publicly_accessible = false
  tags                = local.common_tags
}
