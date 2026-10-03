import { describe, expect, it } from 'vitest'
import { evaluateTerraformPlan } from './check-terraform-plan.mjs'

const base = { format_version: '1.2', resource_changes: [] }

describe('evaluateTerraformPlan', () => {
  it('accepts additive and in-place changes', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        { address: 'aws_s3_bucket.app["media"]', type: 'aws_s3_bucket', change: { actions: ['create'], after: {} } },
        { address: 'aws_ecs_service.web', type: 'aws_ecs_service', change: { actions: ['update'], after: {} } },
      ],
    })
    expect(result.errors).toEqual([])
  })

  it('rejects deletes and replacements', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        { address: 'aws_vpc.app', type: 'aws_vpc', change: { actions: ['delete'], after: null } },
        { address: 'aws_lb.app', type: 'aws_lb', change: { actions: ['delete', 'create'], after: {} } },
      ],
    })
    expect(result.errors).toEqual([
      'Destructive action on aws_vpc.app: delete',
      'Destructive action on aws_lb.app: delete,create',
    ])
  })

  it('rejects a publicly accessible RDS cluster instance', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        {
          address: 'aws_rds_cluster_instance.aurora_writer',
          type: 'aws_rds_cluster_instance',
          change: { actions: ['create'], after: { publicly_accessible: true } },
        },
      ],
    })
    expect(result.errors).toEqual([
      'Unsafe RDS instance aws_rds_cluster_instance.aurora_writer: publicly_accessible=true',
    ])
  })
})
